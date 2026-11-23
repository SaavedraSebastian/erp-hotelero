import crypto from 'crypto';
import { setMotivoCambioPrecio, withReadOnlyClient, withTransaction } from '../../shared/database/transaction.ts';
import { ConflictError, DomainRuleError, ForbiddenError, NotFoundError } from '../../shared/errors/app-error.ts';
import { buildPaginatedResponse } from '../../shared/pagination/index.ts';
import type { AuthContext, PaginationParams } from '../../shared/types/context.ts';
import { aplicarMovimientoStock } from '../gestion/stock.ts';
import * as repo from './repository.ts';

function genCode(prefix: string): string {
  // 104 bits de entropía dentro del límite VARCHAR(30); evita colisiones entre
  // instancias del servidor y solicitudes creadas en el mismo milisegundo.
  const entropy = crypto.randomUUID().replaceAll('-', '').toUpperCase();
  return `${prefix}-${entropy}`.slice(0, 30);
}

async function registrarEnvioPendiente(
  client: import('pg').PoolClient,
  destino: string,
  tipoEnvio: string,
  idReferencia: string
) {
  const existing = await client.query(
    `SELECT id_envio FROM g3_servicios.envio_externo
     WHERE destino = $1 AND tipo_envio = $2 AND id_referencia = $3
     LIMIT 1`,
    [destino, tipoEnvio, idReferencia]
  );
  if (existing.rows[0]) return existing.rows[0];
  const result = await client.query(
    `INSERT INTO g3_servicios.envio_externo (
       id_envio, destino, tipo_envio, id_referencia, estado, numero_intento, fecha_hora_intento
     ) VALUES ($1, $2, $3, $4, 'pendiente', 0, CURRENT_TIMESTAMP)
     RETURNING id_envio, estado`,
    [crypto.randomUUID(), destino, tipoEnvio, idReferencia]
  );
  return result.rows[0];
}

/**
 * M3 conserva una referencia desacoplada de las estadías de Reservas. La crea
 * bajo demanda para que una estadía real de M1 pueda utilizarse en POS, Room
 * Service y Minibar sin depender de filas puente sembradas manualmente.
 */
async function ensureExternalStay(client: import('pg').PoolClient, idEstadia: string): Promise<string> {
  const existing = await client.query(
    `SELECT 1 FROM g3_servicios.estadia_externa WHERE id_estadia_externa = $1`,
    [idEstadia]
  );
  if (existing.rows[0]) return idEstadia;

  if (!/^\d+$/.test(idEstadia)) {
    throw new DomainRuleError('La estadía indicada no existe en Reservas ni en el registro externo de Servicios.');
  }

  const source = await client.query<{
    id_estadia: string;
    id_habitacion: string;
    id_huesped: string;
    estado_estadia: string;
  }>(
    `SELECT
       e.id_estadia::text AS id_estadia,
       e.id_habitacion::text AS id_habitacion,
       r.id_huesped::text AS id_huesped,
       e.estado AS estado_estadia
     FROM g1_reservas.estadia e
     JOIN g1_reservas.reserva r ON r.id_reserva = e.id_reserva
     WHERE e.id_estadia = $1::bigint
       AND e.estado = 'EN_CURSO'`,
    [idEstadia]
  );
  const stay = source.rows[0];
  if (!stay) {
    throw new DomainRuleError('La estadía indicada no existe o ya no se encuentra activa.');
  }

  await client.query(
    `INSERT INTO g3_servicios.estadia_externa (
       id_estadia_externa, id_habitacion_externa, id_huesped_externo,
       estado_estadia, fecha_hora_consulta
     ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (id_estadia_externa) DO UPDATE SET
       id_habitacion_externa = EXCLUDED.id_habitacion_externa,
       id_huesped_externo = EXCLUDED.id_huesped_externo,
       estado_estadia = EXCLUDED.estado_estadia,
       fecha_hora_consulta = CURRENT_TIMESTAMP`,
    [stay.id_estadia, stay.id_habitacion, stay.id_huesped, stay.estado_estadia]
  );
  return stay.id_estadia;
}

export async function getCatalogoService(ctx: AuthContext) {
  return { data: await withReadOnlyClient((client) => repo.listCatalogo(client), ctx) };
}

export async function actualizarPrecioItemService(
  ctx: AuthContext,
  idItemCatalogo: string,
  precioNuevo: string,
  motivo: string
) {
  return withTransaction(ctx, async (client) => {
    await setMotivoCambioPrecio(client, motivo);
    const res = await client.query<{ id_item_catalogo: string; precio_vigente: string }>(
      `UPDATE g3_servicios.item_catalogo
       SET precio_vigente = $2::numeric(12,2)
       WHERE id_item_catalogo = $1
       RETURNING id_item_catalogo, precio_vigente::text AS precio_vigente`,
      [idItemCatalogo, precioNuevo]
    );
    if (!res.rows[0]) throw new NotFoundError('Ítem de catálogo no encontrado.');
    return res.rows[0];
  });
}

export async function getComandasService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listComandas(client, params), ctx);
  return buildPaginatedResponse(rows, total, params.page, params.pageSize);
}

export async function createComandaService(
  ctx: AuthContext,
  input: {
    id_punto_venta: string;
    modalidad: 'mesa' | 'habitación';
    id_mesa?: string | null;
    id_estadia_externa?: string | null;
    items: Array<{ id_item_catalogo: string; cantidad: number; observacion_preparacion?: string | null }>;
  }
) {
  return withTransaction(ctx, async (client) => {
    const point = await client.query<{ estado: string }>(
      `SELECT estado FROM g3_servicios.punto_venta WHERE id_punto_venta = $1`,
      [input.id_punto_venta]
    );
    if (!point.rows[0] || point.rows[0].estado !== 'activo') {
      throw new DomainRuleError('El punto de venta seleccionado no existe o está inactivo.');
    }
    const externalStayId = input.id_estadia_externa
      ? await ensureExternalStay(client, input.id_estadia_externa)
      : null;
    let mesaNombre: string | null = null;
    if (input.modalidad === 'mesa') {
      // Bloquear la mesa serializa dos clics/solicitudes concurrentes y garantiza
      // que nunca se creen dos comandas abiertas para la misma mesa.
      const mesaRes = await client.query<{ nombre: string; estado: string; id_punto_venta: string }>(
        `SELECT nombre, estado, id_punto_venta
         FROM g3_servicios.mesa
         WHERE id_mesa = $1
         FOR UPDATE`,
        [input.id_mesa]
      );
      if (!mesaRes.rows[0] || mesaRes.rows[0].estado !== 'activa') {
        throw new DomainRuleError('La mesa seleccionada no existe o está inactiva.');
      }
      if (mesaRes.rows[0].id_punto_venta !== input.id_punto_venta) {
        throw new DomainRuleError('La mesa no pertenece al punto de venta seleccionado.');
      }
      const abierta = await client.query(
        `SELECT 1
         FROM g3_servicios.comanda
         WHERE id_mesa = $1
           AND estado NOT IN ('entregada', 'cancelada')
         LIMIT 1`,
        [input.id_mesa]
      );
      if (abierta.rows[0]) {
        throw new DomainRuleError('La mesa ya tiene una comanda abierta. Ciérrala o cancélala antes de registrar otra.');
      }
      mesaNombre = mesaRes.rows[0].nombre;
    }

    const numeroComanda = genCode('CMD');
    await client.query(
      `INSERT INTO g3_servicios.comanda (
         numero_comanda, id_punto_venta, id_mesa, nombre_mesa_capturado,
         modalidad, estado, fecha_hora_apertura, id_estadia_externa
       ) VALUES ($1, $2, $3, $4, $5, 'pendiente', CURRENT_TIMESTAMP, $6)`,
      [
        numeroComanda,
        input.id_punto_venta,
        input.id_mesa ?? null,
        mesaNombre,
        input.modalidad,
        externalStayId,
      ]
    );

    for (const item of input.items) {
      const itemRes = await client.query<{ precio_vigente: string; estado: string; id_punto_venta: string }>(
        `SELECT precio_vigente::text AS precio_vigente, estado, id_punto_venta
         FROM g3_servicios.item_catalogo
         WHERE id_item_catalogo = $1`,
        [item.id_item_catalogo]
      );
      const cat = itemRes.rows[0];
      if (!cat || cat.estado !== 'activo') {
        throw new DomainRuleError('Uno de los ítems seleccionados no existe o está inactivo.');
      }
      if (cat.id_punto_venta !== input.id_punto_venta) {
        throw new DomainRuleError('El ítem no pertenece al punto de venta seleccionado.');
      }

      await client.query(
        `INSERT INTO g3_servicios.detalle_comanda (
           id_detalle_comanda, numero_comanda, id_item_catalogo,
           cantidad, observacion_preparacion, precio_capturado, fecha_hora_agregado
         ) VALUES ($1, $2, $3, $4, $5, $6::numeric(12,2), CURRENT_TIMESTAMP)`,
        [
          crypto.randomUUID(),
          numeroComanda,
          item.id_item_catalogo,
          item.cantidad,
          item.observacion_preparacion ?? null,
          cat.precio_vigente,
        ]
      );
    }

    return { numero_comanda: numeroComanda, estado: 'pendiente' };
  });
}

async function requireEditableComanda(
  client: import('pg').PoolClient,
  ctx: AuthContext,
  numeroComanda: string
) {
  const result = await client.query<{
    estado: string;
    usuario_responsable: string | null;
    usuario_creacion: string | null;
  }>(
    `SELECT estado, usuario_responsable, usuario_creacion
     FROM g3_servicios.comanda
     WHERE numero_comanda = $1
     FOR UPDATE`,
    [numeroComanda]
  );
  const comanda = result.rows[0];
  if (!comanda) throw new NotFoundError('Comanda no encontrada.');
  if (!['pendiente', 'en preparación'].includes(comanda.estado)) {
    throw new ConflictError(
      `La comanda está "${comanda.estado}" y sus ítems ya no pueden modificarse.`,
      'M3_COMANDA_ITEMS_LOCKED'
    );
  }
  const autor = comanda.usuario_responsable ?? comanda.usuario_creacion;
  if (autor && autor !== ctx.authUserId && autor !== ctx.codigoUsuario) {
    throw new ForbiddenError('Solo quien abrió la comanda puede modificar sus ítems.', 'M3_COMANDA_OWNER_REQUIRED');
  }
  return comanda;
}

export async function agregarItemComandaService(
  ctx: AuthContext,
  numeroComanda: string,
  input: { id_item_catalogo: string; cantidad: number; observacion_preparacion?: string | null }
) {
  return withTransaction(ctx, async (client) => {
    await requireEditableComanda(client, ctx, numeroComanda);
    const itemRes = await client.query<{ precio_vigente: string; estado: string }>(
      `SELECT precio_vigente::text AS precio_vigente, estado
       FROM g3_servicios.item_catalogo WHERE id_item_catalogo = $1`,
      [input.id_item_catalogo]
    );
    const item = itemRes.rows[0];
    if (!item || item.estado !== 'activo') throw new DomainRuleError('Ítem de catálogo inexistente o inactivo.');
    const idDetalle = crypto.randomUUID();
    const result = await client.query(
      `INSERT INTO g3_servicios.detalle_comanda (
         id_detalle_comanda, numero_comanda, id_item_catalogo,
         cantidad, observacion_preparacion, precio_capturado, fecha_hora_agregado
       ) VALUES ($1, $2, $3, $4::numeric(14,3), $5, $6::numeric(12,2), CURRENT_TIMESTAMP)
       RETURNING id_detalle_comanda, numero_comanda, id_item_catalogo,
                 cantidad::text AS cantidad, observacion_preparacion,
                 precio_capturado::text AS precio_capturado`,
      [idDetalle, numeroComanda, input.id_item_catalogo, input.cantidad, input.observacion_preparacion ?? null, item.precio_vigente]
    );
    return result.rows[0];
  });
}

export async function actualizarItemComandaService(
  ctx: AuthContext,
  numeroComanda: string,
  idDetalle: string,
  input: { cantidad: number; observacion_preparacion?: string | null }
) {
  return withTransaction(ctx, async (client) => {
    await requireEditableComanda(client, ctx, numeroComanda);
    const result = await client.query(
      `UPDATE g3_servicios.detalle_comanda
       SET cantidad = $3::numeric(14,3), observacion_preparacion = $4
       WHERE numero_comanda = $1 AND id_detalle_comanda = $2
       RETURNING id_detalle_comanda, numero_comanda, id_item_catalogo,
                 cantidad::text AS cantidad, observacion_preparacion,
                 precio_capturado::text AS precio_capturado`,
      [numeroComanda, idDetalle, input.cantidad, input.observacion_preparacion ?? null]
    );
    if (!result.rows[0]) throw new NotFoundError('Línea de comanda no encontrada.');
    return result.rows[0];
  });
}

export async function cambiarEstadoComandaService(
  ctx: AuthContext,
  numeroComanda: string,
  nuevoEstado: 'en preparación' | 'lista' | 'cancelada',
  motivoCancelacion?: string
) {
  return withTransaction(ctx, async (client) => {
    const actualRes = await client.query<{
      numero_comanda: string;
      estado: string;
      usuario_responsable: string | null;
      usuario_creacion: string | null;
    }>(
      `SELECT numero_comanda, estado, usuario_responsable, usuario_creacion
       FROM g3_servicios.comanda
       WHERE numero_comanda = $1
       FOR UPDATE`,
      [numeroComanda]
    );
    const actual = actualRes.rows[0];
    if (!actual) throw new NotFoundError('Comanda no encontrada.');

    const transiciones: Record<string, string[]> = {
      'en preparación': ['pendiente'],
      lista: ['en preparación'],
      cancelada: ['pendiente', 'en preparación', 'lista'],
    };
    if (!transiciones[nuevoEstado].includes(actual.estado)) {
      throw new ConflictError(
        `La comanda está "${actual.estado}" y no puede cambiar a "${nuevoEstado}".`,
        'M3_INVALID_COMANDA_STATE'
      );
    }
    if (nuevoEstado === 'cancelada') {
      const autor = actual.usuario_responsable ?? actual.usuario_creacion;
      if (autor && autor !== ctx.authUserId && autor !== ctx.codigoUsuario) {
        throw new ForbiddenError('Solo quien abrió la comanda puede cancelarla.', 'M3_COMANDA_OWNER_REQUIRED');
      }
    }

    const res = await client.query<{ numero_comanda: string; estado: string }>(
      `UPDATE g3_servicios.comanda
       SET
         estado = $2::varchar,
         motivo_cancelacion = CASE WHEN $2::varchar = 'cancelada' THEN $3 ELSE motivo_cancelacion END
       WHERE numero_comanda = $1
       RETURNING numero_comanda, estado`,
      [numeroComanda, nuevoEstado, motivoCancelacion ?? null]
    );
    return res.rows[0];
  });
}

export async function entregarComandaYCrearConsumoService(
  ctx: AuthContext,
  numeroComanda: string,
  input: {
    forma_cobro: 'pago directo' | 'cargo a la habitación' | 'incluido en paquete';
    id_cuenta_cobro_externa?: string | null;
    id_paquete_externo?: string | null;
  }
) {
  return withTransaction(ctx, async (client) => {
    // Los triggers heredados de M3 contienen referencias no calificadas (p. ej. "consumo").
    // Mantener el esquema de negocio en el search_path evita que PostgreSQL las resuelva
    // contra public o contra el usuario de conexión.
    await client.query('SET LOCAL search_path TO pg_catalog, g3_servicios, seguridad, public, pg_temp');

    const cmdRes = await client.query<{
      numero_comanda: string;
      id_punto_venta: string;
      id_estadia_externa: string | null;
      estado: string;
    }>(
      `SELECT numero_comanda, id_punto_venta, id_estadia_externa, estado
       FROM g3_servicios.comanda
       WHERE numero_comanda = $1 FOR UPDATE`,
      [numeroComanda]
    );
    const comanda = cmdRes.rows[0];
    if (!comanda) throw new NotFoundError('Comanda no encontrada.');
    if (comanda.estado === 'entregada') {
      throw new ConflictError('La comanda ya fue entregada.', 'M3_COMANDA_ALREADY_DELIVERED');
    }
    if (comanda.estado !== 'lista') {
      throw new ConflictError(
        `La comanda debe estar "lista" para entregarse; actualmente está "${comanda.estado}".`,
        'M3_INVALID_COMANDA_STATE'
      );
    }

    const detRes = await client.query<{
      id_item_catalogo: string;
      cantidad_total: string;
      precio_capturado: string;
    }>(
      `SELECT
         id_item_catalogo,
         SUM(cantidad)::text AS cantidad_total,
         MAX(precio_capturado)::text AS precio_capturado
       FROM g3_servicios.detalle_comanda
       WHERE numero_comanda = $1
       GROUP BY id_item_catalogo`,
      [numeroComanda]
    );
    if (detRes.rows.length === 0) {
      throw new DomainRuleError('La comanda no tiene líneas de detalle.');
    }

    await client.query(
      `UPDATE g3_servicios.comanda
       SET estado = 'entregada', fecha_hora_entrega = CURRENT_TIMESTAMP
       WHERE numero_comanda = $1`,
      [numeroComanda]
    );

    const lineas = detRes.rows.map((d) => {
      const cant = Number(d.cantidad_total);
      const precio = Number(d.precio_capturado);
      const importe = Number((cant * precio).toFixed(2));
      return { ...d, importe };
    });
    const importeTotal = lineas.reduce((acc, l) => acc + l.importe, 0).toFixed(2);
    const numeroConsumo = genCode('CON');

    await client.query(
      `INSERT INTO g3_servicios.consumo (
         numero_consumo, id_punto_venta, id_paquete_externo, id_cuenta_cobro_externa,
         importe_total, forma_cobro, estado, fecha_hora_registro, id_estadia_externa
       ) VALUES ($1, $2, $3, $4, $5::numeric(12,2), $6, 'por confirmar', CURRENT_TIMESTAMP, $7)`,
      [
        numeroConsumo,
        comanda.id_punto_venta,
        input.id_paquete_externo ?? null,
        input.id_cuenta_cobro_externa ?? null,
        importeTotal,
        input.forma_cobro,
        comanda.id_estadia_externa,
      ]
    );

    for (const l of lineas) {
      await client.query(
        `INSERT INTO g3_servicios.detalle_consumo (
           id_detalle_consumo, numero_consumo, id_item_catalogo,
           cantidad, precio_capturado, importe_lista, importe
         ) VALUES ($1, $2, $3, $4::numeric(14,3), $5::numeric(12,2), $6::numeric(12,2), $6::numeric(12,2))`,
        [
          crypto.randomUUID(),
          numeroConsumo,
          l.id_item_catalogo,
          l.cantidad_total,
          l.precio_capturado,
          l.importe.toFixed(2),
        ]
      );
    }

    return {
      numero_comanda: numeroComanda,
      estado_comanda: 'entregada',
      numero_consumo: numeroConsumo,
      estado_consumo: 'por confirmar',
      importe_total: importeTotal,
    };
  });
}

export async function getConsumosService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listConsumos(client, params), ctx);
  return buildPaginatedResponse(rows, total, params.page, params.pageSize);
}

export async function getSolicitudesServicioService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listSolicitudesServicio(client, params), ctx);
  return buildPaginatedResponse(rows, total, params.page, params.pageSize);
}

export async function createSolicitudServicioService(
  ctx: AuthContext,
  input: {
    id_estadia_externa: string;
    id_item_catalogo: string;
    cantidad_solicitada: number;
    fecha_hora_prevista?: string | null;
  }
) {
  return withTransaction(ctx, async (client) => {
    const stayId = await ensureExternalStay(client, input.id_estadia_externa);
    const itemRes = await client.query<{ precio_vigente: string; estado: string; tipo_item: string; cupo_por_atencion: number | null }>(
      `SELECT precio_vigente::text AS precio_vigente, estado, tipo_item, cupo_por_atencion
       FROM g3_servicios.item_catalogo WHERE id_item_catalogo = $1`, [input.id_item_catalogo]
    );
    const item = itemRes.rows[0];
    if (!item || item.estado !== 'activo' || item.tipo_item !== 'servicio') {
      throw new DomainRuleError('El servicio indicado no existe o está inactivo.');
    }
    let cupoDisponible: number | null = null;
    if (item.cupo_por_atencion !== null) {
      const used = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(cantidad_solicitada), 0)::text AS total
         FROM g3_servicios.solicitud_servicio
         WHERE id_item_catalogo = $1
           AND estado IN ('solicitada', 'en atención')
           AND fecha_hora_prevista::date = COALESCE($2::timestamptz, CURRENT_TIMESTAMP)::date`,
        [input.id_item_catalogo, input.fecha_hora_prevista ?? null]
      );
      cupoDisponible = Math.max(0, Number(item.cupo_por_atencion) - Number(used.rows[0]?.total ?? 0));
    }
    const numero = genCode('SOL');
    const result = await client.query(
      `INSERT INTO g3_servicios.solicitud_servicio (
         numero_solicitud, id_estadia_externa, id_item_catalogo,
         cantidad_solicitada, precio_capturado, fecha_hora_prevista, estado
       ) VALUES ($1, $2, $3, $4::numeric(14,3), $5::numeric(12,2), $6::timestamptz, 'solicitada')
       RETURNING numero_solicitud, estado, cantidad_solicitada::text AS cantidad_solicitada,
                 precio_capturado::text AS precio_capturado, fecha_hora_prevista::text AS fecha_hora_prevista`,
      [numero, stayId, input.id_item_catalogo, input.cantidad_solicitada, item.precio_vigente, input.fecha_hora_prevista ?? null]
    );
    return { ...result.rows[0], cupo_disponible: cupoDisponible };
  });
}

export async function actualizarSolicitudServicioService(
  ctx: AuthContext,
  numero: string,
  input: { cantidad_solicitada?: number; fecha_hora_prevista?: string | null }
) {
  return withTransaction(ctx, async (client) => {
    const hasFecha = Object.prototype.hasOwnProperty.call(input, 'fecha_hora_prevista');
    const result = await client.query(
      `UPDATE g3_servicios.solicitud_servicio
       SET cantidad_solicitada = COALESCE($2::numeric, cantidad_solicitada),
           fecha_hora_prevista = CASE WHEN $3::boolean THEN $4::timestamptz ELSE fecha_hora_prevista END
       WHERE numero_solicitud = $1 AND estado = 'solicitada'
       RETURNING numero_solicitud, estado, cantidad_solicitada::text AS cantidad_solicitada,
                 precio_capturado::text AS precio_capturado, fecha_hora_prevista::text AS fecha_hora_prevista`,
      [numero, input.cantidad_solicitada ?? null, hasFecha, input.fecha_hora_prevista ?? null]
    );
    if (result.rows[0]) return result.rows[0];
    const exists = await client.query<{ estado: string }>(
      `SELECT estado FROM g3_servicios.solicitud_servicio WHERE numero_solicitud = $1`, [numero]
    );
    if (!exists.rows[0]) throw new NotFoundError('Solicitud de servicio no encontrada.');
    throw new ConflictError('Solo puede modificarse una solicitud todavía no atendida.', 'M3_SERVICE_REQUEST_NOT_EDITABLE');
  });
}

export async function iniciarSolicitudServicioService(ctx: AuthContext, numero: string) {
  return withTransaction(ctx, async (client) => {
    const result = await client.query(
      `UPDATE g3_servicios.solicitud_servicio SET estado = 'en atención'
       WHERE numero_solicitud = $1 AND estado = 'solicitada'
       RETURNING numero_solicitud, estado`, [numero]
    );
    if (result.rows[0]) return result.rows[0];
    const exists = await client.query<{ estado: string }>(
      `SELECT estado FROM g3_servicios.solicitud_servicio WHERE numero_solicitud = $1`, [numero]
    );
    if (!exists.rows[0]) throw new NotFoundError('Solicitud de servicio no encontrada.');
    throw new ConflictError(`La solicitud está "${exists.rows[0].estado}" y no puede iniciarse.`, 'M3_INVALID_SERVICE_REQUEST_STATE');
  });
}

export async function completarSolicitudServicioService(
  ctx: AuthContext,
  numero: string,
  input: {
    cantidad_prestada: number;
    forma_cobro: 'pago directo' | 'cargo a la habitación' | 'incluido en paquete';
    id_cuenta_cobro_externa?: string | null;
    id_paquete_externo?: string | null;
  }
) {
  return withTransaction(ctx, async (client) => {
    const requestRes = await client.query<{
      estado: string;
      id_estadia_externa: string;
      id_item_catalogo: string;
      cantidad_solicitada: string;
      precio_capturado: string;
    }>(
      `SELECT estado, id_estadia_externa, id_item_catalogo,
              cantidad_solicitada::text AS cantidad_solicitada,
              precio_capturado::text AS precio_capturado
       FROM g3_servicios.solicitud_servicio WHERE numero_solicitud = $1 FOR UPDATE`, [numero]
    );
    const request = requestRes.rows[0];
    if (!request) throw new NotFoundError('Solicitud de servicio no encontrada.');
    if (request.estado !== 'en atención') {
      throw new ConflictError('Solo puede completarse una solicitud en atención.', 'M3_INVALID_SERVICE_REQUEST_STATE');
    }
    if (input.cantidad_prestada > Number(request.cantidad_solicitada)) {
      throw new DomainRuleError('La cantidad prestada no puede superar la cantidad solicitada.');
    }
    if (input.forma_cobro === 'cargo a la habitación' && !input.id_cuenta_cobro_externa) {
      throw new DomainRuleError('El cargo a la habitación exige una cuenta de cobro.');
    }
    if (input.forma_cobro === 'incluido en paquete' && !input.id_paquete_externo) {
      throw new DomainRuleError('El servicio incluido exige un paquete vigente.');
    }
    const importe = (input.cantidad_prestada * Number(request.precio_capturado)).toFixed(2);
    const numeroConsumo = genCode('CON');
    await client.query(
      `INSERT INTO g3_servicios.consumo (
         numero_consumo, id_punto_venta, id_paquete_externo, id_cuenta_cobro_externa,
         importe_total, forma_cobro, estado, fecha_hora_registro, id_estadia_externa
       ) SELECT $1, ic.id_punto_venta, $2, $3, $4::numeric(12,2), $5, 'por confirmar', CURRENT_TIMESTAMP, $6
         FROM g3_servicios.item_catalogo ic WHERE ic.id_item_catalogo = $7`,
      [numeroConsumo, input.id_paquete_externo ?? null, input.id_cuenta_cobro_externa ?? null,
       importe, input.forma_cobro, request.id_estadia_externa, request.id_item_catalogo]
    );
    await client.query(
      `INSERT INTO g3_servicios.detalle_consumo (
         id_detalle_consumo, numero_consumo, id_item_catalogo, cantidad,
         precio_capturado, importe_lista, importe
       ) VALUES ($1, $2, $3, $4::numeric(14,3), $5::numeric(12,2), $6::numeric(12,2), $6::numeric(12,2))`,
      [crypto.randomUUID(), numeroConsumo, request.id_item_catalogo, input.cantidad_prestada, request.precio_capturado, importe]
    );
    await client.query(
      `UPDATE g3_servicios.solicitud_servicio
       SET estado = 'completada', cantidad_prestada = $2::numeric(14,3)
       WHERE numero_solicitud = $1`, [numero, input.cantidad_prestada]
    );
    return { numero_solicitud: numero, estado: 'completada', numero_consumo: numeroConsumo, estado_consumo: 'por confirmar' };
  });
}

export async function cancelarSolicitudServicioService(ctx: AuthContext, numero: string, motivo: string) {
  return withTransaction(ctx, async (client) => {
    const result = await client.query(
      `UPDATE g3_servicios.solicitud_servicio
       SET estado = 'cancelada', motivo_cancelacion = $2
       WHERE numero_solicitud = $1 AND estado IN ('solicitada', 'en atención')
       RETURNING numero_solicitud, estado, motivo_cancelacion`, [numero, motivo]
    );
    if (result.rows[0]) return result.rows[0];
    const exists = await client.query<{ estado: string }>(
      `SELECT estado FROM g3_servicios.solicitud_servicio WHERE numero_solicitud = $1`, [numero]
    );
    if (!exists.rows[0]) throw new NotFoundError('Solicitud de servicio no encontrada.');
    throw new ConflictError(`La solicitud está "${exists.rows[0].estado}" y no puede cancelarse.`, 'M3_INVALID_SERVICE_REQUEST_STATE');
  });
}

export async function createConsumoService(
  ctx: AuthContext,
  input: {
    id_punto_venta: string;
    forma_cobro: 'pago directo' | 'cargo a la habitación' | 'incluido en paquete';
    id_estadia_externa?: string | null;
    id_cuenta_cobro_externa?: string | null;
    id_paquete_externo?: string | null;
    items: Array<{ id_item_catalogo: string; cantidad: number; importe_cobrado?: string }>;
  }
) {
  return withTransaction(ctx, async (client) => {
    const point = await client.query<{ estado: string }>(
      `SELECT estado FROM g3_servicios.punto_venta WHERE id_punto_venta = $1`,
      [input.id_punto_venta]
    );
    if (!point.rows[0] || point.rows[0].estado !== 'activo') {
      throw new DomainRuleError('El punto de venta seleccionado no existe o está inactivo.');
    }
    const numeroConsumo = genCode('CON');
    const externalStayId = input.id_estadia_externa
      ? await ensureExternalStay(client, input.id_estadia_externa)
      : null;
    const resolvedLines: Array<{
      id_item_catalogo: string;
      cantidad: number;
      precio_capturado: string;
      importe_lista: string;
      importe: string;
    }> = [];

    for (const item of input.items) {
      const catRes = await client.query<{ precio_vigente: string; estado: string; id_punto_venta: string }>(
        `SELECT precio_vigente::text AS precio_vigente, estado, id_punto_venta
         FROM g3_servicios.item_catalogo WHERE id_item_catalogo = $1`,
        [item.id_item_catalogo]
      );
      const cat = catRes.rows[0];
      if (!cat || cat.estado !== 'activo') {
        throw new DomainRuleError('Ítem de catálogo inexistente o inactivo.');
      }
      if (cat.id_punto_venta !== input.id_punto_venta) {
        throw new DomainRuleError('El ítem no pertenece al punto de venta seleccionado.');
      }
      const lista = Number((item.cantidad * Number(cat.precio_vigente)).toFixed(2));
      const cobrado = item.importe_cobrado !== undefined ? Number(item.importe_cobrado) : lista;
      if (cobrado > lista) {
        throw new DomainRuleError('El importe cobrado no puede superar el importe de lista.');
      }
      resolvedLines.push({
        id_item_catalogo: item.id_item_catalogo,
        cantidad: item.cantidad,
        precio_capturado: cat.precio_vigente,
        importe_lista: lista.toFixed(2),
        importe: cobrado.toFixed(2),
      });
    }

    const total = resolvedLines.reduce((acc, l) => acc + Number(l.importe), 0).toFixed(2);
    await client.query(
      `INSERT INTO g3_servicios.consumo (
         numero_consumo, id_punto_venta, id_paquete_externo, id_cuenta_cobro_externa,
         importe_total, forma_cobro, estado, fecha_hora_registro, id_estadia_externa
       ) VALUES ($1, $2, $3, $4, $5::numeric(12,2), $6, 'por confirmar', CURRENT_TIMESTAMP, $7)`,
      [
        numeroConsumo,
        input.id_punto_venta,
        input.id_paquete_externo ?? null,
        input.id_cuenta_cobro_externa ?? null,
        total,
        input.forma_cobro,
        externalStayId,
      ]
    );

    for (const l of resolvedLines) {
      await client.query(
        `INSERT INTO g3_servicios.detalle_consumo (
           id_detalle_consumo, numero_consumo, id_item_catalogo,
           cantidad, precio_capturado, importe_lista, importe
         ) VALUES ($1, $2, $3, $4, $5::numeric(12,2), $6::numeric(12,2), $7::numeric(12,2))`,
        [
          crypto.randomUUID(),
          numeroConsumo,
          l.id_item_catalogo,
          l.cantidad,
          l.precio_capturado,
          l.importe_lista,
          l.importe,
        ]
      );
    }

    return { numero_consumo: numeroConsumo, estado: 'por confirmar', importe_total: total };
  });
}

export async function actualizarConsumoService(
  ctx: AuthContext,
  numeroConsumo: string,
  input: {
    forma_cobro: 'pago directo' | 'cargo a la habitación' | 'incluido en paquete';
    id_cuenta_cobro_externa?: string | null;
    id_paquete_externo?: string | null;
    items: Array<{ id_item_catalogo: string; cantidad: number; importe_cobrado?: string }>;
  }
) {
  return withTransaction(ctx, async (client) => {
    const consumoRes = await client.query<{ estado: string; id_estadia_externa: string | null }>(
      `SELECT estado, id_estadia_externa
       FROM g3_servicios.consumo
       WHERE numero_consumo = $1
       FOR UPDATE`,
      [numeroConsumo]
    );
    const consumo = consumoRes.rows[0];
    if (!consumo) throw new NotFoundError('Consumo no encontrado.');
    if (consumo.estado !== 'por confirmar') {
      throw new ConflictError('Solo puede actualizarse un consumo por confirmar.', 'M3_CONSUMO_NOT_EDITABLE');
    }
    if (input.forma_cobro === 'cargo a la habitación' && (!consumo.id_estadia_externa || !input.id_cuenta_cobro_externa)) {
      throw new DomainRuleError('El cargo a la habitación exige estadía y cuenta de cobro.');
    }
    if (input.forma_cobro === 'incluido en paquete' && (!consumo.id_estadia_externa || !input.id_paquete_externo)) {
      throw new DomainRuleError('El consumo incluido exige estadía y paquete.');
    }

    const lineas: Array<{
      id_item_catalogo: string;
      cantidad: number;
      precio: string;
      lista: string;
      importe: string;
    }> = [];
    for (const requested of input.items) {
      const itemRes = await client.query<{ precio_vigente: string; estado: string }>(
        `SELECT precio_vigente::text AS precio_vigente, estado
         FROM g3_servicios.item_catalogo WHERE id_item_catalogo = $1`,
        [requested.id_item_catalogo]
      );
      const item = itemRes.rows[0];
      if (!item || item.estado !== 'activo') throw new DomainRuleError('Ítem de catálogo inexistente o inactivo.');
      const lista = Number((requested.cantidad * Number(item.precio_vigente)).toFixed(2));
      const importe = requested.importe_cobrado === undefined ? lista : Number(requested.importe_cobrado);
      if (importe > lista) throw new DomainRuleError('El importe cobrado no puede superar el importe de lista.');
      lineas.push({
        id_item_catalogo: requested.id_item_catalogo,
        cantidad: requested.cantidad,
        precio: item.precio_vigente,
        lista: lista.toFixed(2),
        importe: importe.toFixed(2),
      });
    }
    const total = lineas.reduce((sum, line) => sum + Number(line.importe), 0).toFixed(2);
    await client.query(`DELETE FROM g3_servicios.detalle_consumo WHERE numero_consumo = $1`, [numeroConsumo]);
    for (const line of lineas) {
      await client.query(
        `INSERT INTO g3_servicios.detalle_consumo (
           id_detalle_consumo, numero_consumo, id_item_catalogo,
           cantidad, precio_capturado, importe_lista, importe
         ) VALUES ($1, $2, $3, $4::numeric(14,3), $5::numeric(12,2), $6::numeric(12,2), $7::numeric(12,2))`,
        [crypto.randomUUID(), numeroConsumo, line.id_item_catalogo, line.cantidad, line.precio, line.lista, line.importe]
      );
    }
    const updated = await client.query(
      `UPDATE g3_servicios.consumo
       SET forma_cobro = $2, id_cuenta_cobro_externa = $3,
           id_paquete_externo = $4, importe_total = $5::numeric(12,2)
       WHERE numero_consumo = $1
       RETURNING numero_consumo, estado, forma_cobro, importe_total::text AS importe_total`,
      [numeroConsumo, input.forma_cobro, input.id_cuenta_cobro_externa ?? null, input.id_paquete_externo ?? null, total]
    );
    return updated.rows[0];
  });
}

export async function confirmarConsumoService(ctx: AuthContext, numeroConsumo: string) {
  return withTransaction(ctx, async (client) => {
    const conRes = await client.query<{ numero_consumo: string; estado: string }>(
      `SELECT numero_consumo, estado FROM g3_servicios.consumo WHERE numero_consumo = $1 FOR UPDATE`,
      [numeroConsumo]
    );
    const consumo = conRes.rows[0];
    if (!consumo) throw new NotFoundError('Consumo no encontrado.');
    if (consumo.estado === 'confirmado') return consumo;
    if (consumo.estado !== 'por confirmar') {
      throw new ConflictError(
        `El consumo está "${consumo.estado}" y no puede confirmarse.`,
        'M3_INVALID_CONSUMO_STATE'
      );
    }

    const detRes = await client.query<{
      id_item_catalogo: string;
      id_articulo_descuento: string | null;
      cantidad: string;
    }>(
      `SELECT dc.id_item_catalogo, ic.id_articulo_descuento, dc.cantidad::text AS cantidad
       FROM g3_servicios.detalle_consumo dc
       JOIN g3_servicios.item_catalogo ic ON ic.id_item_catalogo = dc.id_item_catalogo
       WHERE dc.numero_consumo = $1`,
      [numeroConsumo]
    );

    for (const d of detRes.rows) {
      const componentes: Array<{ id_articulo: string; cantidad: number }> = [];
      if (d.id_articulo_descuento) {
        componentes.push({ id_articulo: d.id_articulo_descuento, cantidad: Number(d.cantidad) });
      } else {
        const receta = await client.query<{ id_articulo: string; cantidad_por_porcion: string }>(
          `WITH receta_vigente AS (
             SELECT id_receta
             FROM g3_servicios.receta
             WHERE id_item_catalogo = $1 AND estado = 'vigente'
             ORDER BY numero_version DESC
             LIMIT 1
           )
           SELECT dr.id_articulo, dr.cantidad_por_porcion::text AS cantidad_por_porcion
           FROM receta_vigente rv
           JOIN g3_servicios.detalle_receta dr ON dr.id_receta = rv.id_receta
           ORDER BY dr.id_detalle_receta`,
          [d.id_item_catalogo]
        );
        for (const ingrediente of receta.rows) {
          componentes.push({
            id_articulo: ingrediente.id_articulo,
            cantidad: Number(ingrediente.cantidad_por_porcion) * Number(d.cantidad),
          });
        }
      }
      // La venta ya ocurrió: se descuenta lo disponible por lotes. Cada movimiento
      // queda ligado al consumo para poder revertir exactamente sus ingredientes.
      for (const componente of componentes) {
        await aplicarMovimientoStock(client, {
          id_articulo: componente.id_articulo,
          tipo_movimiento: 'Consumo POS',
          signo: 'salida',
          cantidad: componente.cantidad,
          motivo: `Confirmación consumo ${numeroConsumo}`,
          id_origen: numeroConsumo,
          modulo_origen: 'Almacén',
          permitirParcial: true,
        });
      }
    }

    const upd = await client.query<{ numero_consumo: string; estado: string }>(
      `UPDATE g3_servicios.consumo
       SET estado = 'confirmado', fecha_hora_confirmacion = CURRENT_TIMESTAMP
       WHERE numero_consumo = $1
       RETURNING numero_consumo, estado`,
      [numeroConsumo]
    );

    await registrarEnvioPendiente(
      client,
      'Facturación y Finanzas',
      'Consumo confirmado',
      numeroConsumo
    );

    return upd.rows[0];
  });
}

export async function descartarOAnularConsumoService(
  ctx: AuthContext,
  numeroConsumo: string,
  accion: 'descartar' | 'anular',
  motivo: string
) {
  return withTransaction(ctx, async (client) => {
    const actualRes = await client.query<{ estado: string }>(
      `SELECT estado FROM g3_servicios.consumo WHERE numero_consumo = $1 FOR UPDATE`,
      [numeroConsumo]
    );
    const actual = actualRes.rows[0];
    if (!actual) throw new NotFoundError('Consumo no encontrado.');
    const esperado = accion === 'descartar' ? 'por confirmar' : 'confirmado';
    if (actual.estado !== esperado) {
      throw new ConflictError(
        `Solo puede ${accion === 'descartar' ? 'descartarse un consumo por confirmar' : 'anularse un consumo confirmado'}; el estado actual es "${actual.estado}".`,
        'M3_INVALID_CONSUMO_STATE'
      );
    }
    if (accion === 'anular') {
      const movimientos = await client.query<{
        id_articulo: string;
        id_lote: string | null;
        cantidad: string;
        costo_unitario: string | null;
      }>(
        `SELECT id_articulo, id_lote, cantidad::text AS cantidad,
                costo_unitario::text AS costo_unitario
         FROM g3_servicios.movimiento_inventario
         WHERE id_origen = $1 AND tipo_movimiento = 'Consumo POS'
         ORDER BY fecha_hora, id_movimiento`,
        [numeroConsumo]
      );
      for (const movimiento of movimientos.rows) {
        await aplicarMovimientoStock(client, {
          id_articulo: movimiento.id_articulo,
          id_lote: movimiento.id_lote,
          tipo_movimiento: 'Anulación consumo',
          signo: 'entrada',
          cantidad: Number(movimiento.cantidad),
          motivo,
          id_origen: numeroConsumo,
          modulo_origen: 'Almacén',
          costo_unitario: movimiento.costo_unitario,
        });
      }
    }
    const query =
      accion === 'descartar'
        ? `UPDATE g3_servicios.consumo SET estado = 'descartado', motivo_descarte = $2 WHERE numero_consumo = $1 RETURNING numero_consumo, estado`
        : `UPDATE g3_servicios.consumo SET estado = 'anulado', motivo_anulacion = $2 WHERE numero_consumo = $1 RETURNING numero_consumo, estado`;
    const res = await client.query<{ numero_consumo: string; estado: string }>(query, [numeroConsumo, motivo]);
    return res.rows[0];
  });
}

export async function getInventarioService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listInventario(client, params), ctx);
  return buildPaginatedResponse(rows, total, params.page, params.pageSize);
}

export async function getKardexService(ctx: AuthContext, idArticulo: string | null, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listKardex(client, idArticulo, params), ctx);
  return buildPaginatedResponse(rows, total, params.page, params.pageSize);
}

export async function registrarMovimientoInventarioService(
  ctx: AuthContext,
  input: {
    id_articulo: string;
    id_lote?: string | null;
    tipo_movimiento: string;
    cantidad: number;
    signo: 'entrada' | 'salida';
    motivo: string;
    id_origen: string;
    modulo_origen: 'Almacén' | 'Compras' | 'Housekeeping y Mantenimiento';
    costo_unitario?: string | null;
  }
) {
  // El stock es la suma de los lotes: el movimiento y los lotes se actualizan juntos (ver gestion/stock.ts).
  return withTransaction(ctx, (client) => aplicarMovimientoStock(client, input));
}

export async function getOrdenesCompraService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listOrdenesCompra(client, params), ctx);
  return buildPaginatedResponse(rows, total, params.page, params.pageSize);
}

export async function createOrdenCompraService(
  ctx: AuthContext,
  input: {
    id_proveedor: string;
    fecha_entrega_esperada: string;
    items: Array<{ id_articulo: string; cantidad_solicitada: number; precio_referencia_capturado: string }>;
  }
) {
  return withTransaction(ctx, async (client) => {
    const numeroOrden = genCode('OC');
    const totalEstimado = input.items
      .reduce((acc, i) => acc + i.cantidad_solicitada * Number(i.precio_referencia_capturado), 0)
      .toFixed(2);

    await client.query(
      `INSERT INTO g3_servicios.orden_compra (
         numero_orden, id_proveedor, fecha_hora_preparacion,
         fecha_entrega_esperada, total_estimado, estado
       ) VALUES ($1, $2, CURRENT_TIMESTAMP, $3::date, $4::numeric(12,2), 'pendiente de aprobación')`,
      [numeroOrden, input.id_proveedor, input.fecha_entrega_esperada, totalEstimado]
    );

    for (const item of input.items) {
      await client.query(
        `INSERT INTO g3_servicios.detalle_orden_compra (
           id_detalle_orden, numero_orden, id_articulo, cantidad_solicitada, precio_referencia_capturado
         ) VALUES ($1, $2, $3, $4, $5::numeric(12,2))`,
        [
          crypto.randomUUID(),
          numeroOrden,
          item.id_articulo,
          item.cantidad_solicitada,
          item.precio_referencia_capturado,
        ]
      );
    }

    return { numero_orden: numeroOrden, estado: 'pendiente de aprobación', total_estimado: totalEstimado };
  });
}

export async function actualizarOrdenCompraService(
  ctx: AuthContext,
  numeroOrden: string,
  input: {
    id_proveedor: string;
    fecha_entrega_esperada: string;
    items: Array<{ id_articulo: string; cantidad_solicitada: number; precio_referencia_capturado: string }>;
  }
) {
  return withTransaction(ctx, async (client) => {
    const actual = await client.query<{ estado: string }>(
      `SELECT estado FROM g3_servicios.orden_compra WHERE numero_orden = $1 FOR UPDATE`,
      [numeroOrden]
    );
    if (!actual.rows[0]) throw new NotFoundError('Orden de compra no encontrada.');
    if (actual.rows[0].estado !== 'pendiente de aprobación') {
      throw new ConflictError('Solo puede editarse una orden pendiente de aprobación.', 'M3_PURCHASE_ORDER_NOT_EDITABLE');
    }
    const total = input.items.reduce(
      (sum, item) => sum + item.cantidad_solicitada * Number(item.precio_referencia_capturado),
      0
    ).toFixed(2);
    await client.query(
      `UPDATE g3_servicios.orden_compra
       SET id_proveedor = $2, fecha_entrega_esperada = $3::date, total_estimado = $4::numeric(14,2)
       WHERE numero_orden = $1`,
      [numeroOrden, input.id_proveedor, input.fecha_entrega_esperada, total]
    );
    await client.query(`DELETE FROM g3_servicios.detalle_orden_compra WHERE numero_orden = $1`, [numeroOrden]);
    for (const item of input.items) {
      await client.query(
        `INSERT INTO g3_servicios.detalle_orden_compra (
           id_detalle_orden, numero_orden, id_articulo, cantidad_solicitada, precio_referencia_capturado
         ) VALUES ($1, $2, $3, $4::numeric(14,3), $5::numeric(12,4))`,
        [crypto.randomUUID(), numeroOrden, item.id_articulo, item.cantidad_solicitada, item.precio_referencia_capturado]
      );
    }
    return { numero_orden: numeroOrden, estado: 'pendiente de aprobación', total_estimado: total };
  });
}

export async function cancelarOrdenCompraService(ctx: AuthContext, numeroOrden: string, motivo: string) {
  return withTransaction(ctx, async (client) => {
    const result = await client.query<{ numero_orden: string; estado: string }>(
      `UPDATE g3_servicios.orden_compra
       SET estado = 'cancelada', motivo_cancelacion = $2
       WHERE numero_orden = $1 AND estado = 'pendiente de aprobación'
       RETURNING numero_orden, estado`,
      [numeroOrden, motivo]
    );
    if (result.rows[0]) return result.rows[0];
    const exists = await client.query<{ estado: string }>(
      `SELECT estado FROM g3_servicios.orden_compra WHERE numero_orden = $1`, [numeroOrden]
    );
    if (!exists.rows[0]) throw new NotFoundError('Orden de compra no encontrada.');
    throw new ConflictError(
      `La orden está "${exists.rows[0].estado}" y ya no puede cancelarse.`,
      'M3_INVALID_PURCHASE_ORDER_STATE'
    );
  });
}

export async function decidirOrdenCompraService(
  ctx: AuthContext,
  numeroOrden: string,
  decision: 'aprobada' | 'rechazada',
  motivoDecision: string
) {
  return withTransaction(ctx, async (client) => {
    const ocRes = await client.query<{ usuario_creacion: string; estado: string }>(
      `SELECT usuario_creacion, estado
       FROM g3_servicios.orden_compra
       WHERE numero_orden = $1 FOR UPDATE`,
      [numeroOrden]
    );
    const oc = ocRes.rows[0];
    if (!oc) throw new NotFoundError('Orden de compra no encontrada.');
    if (oc.estado !== 'pendiente de aprobación') {
      throw new ConflictError(
        `La orden está "${oc.estado}" y ya no admite aprobación o rechazo.`,
        'M3_INVALID_PURCHASE_ORDER_STATE'
      );
    }

    if (decision === 'aprobada' && oc.usuario_creacion === ctx.authUserId) {
      throw new ForbiddenError(
        'Segregación de funciones: quien preparó la orden de compra no puede aprobarla.'
      );
    }

    const upd = await client.query<{ numero_orden: string; estado: string }>(
      `UPDATE g3_servicios.orden_compra
       SET
         estado = $2,
         decision_aprobacion = $2,
         motivo_decision = $3,
         fecha_hora_decision = CURRENT_TIMESTAMP
       WHERE numero_orden = $1
       RETURNING numero_orden, estado`,
      [numeroOrden, decision, motivoDecision]
    );
    return upd.rows[0];
  });
}

export async function enviarOrdenCompraService(ctx: AuthContext, numeroOrden: string, medioEnvio: string) {
  return withTransaction(ctx, async (client) => {
    const actual = await client.query<{ estado: string }>(
      `SELECT estado FROM g3_servicios.orden_compra WHERE numero_orden = $1 FOR UPDATE`,
      [numeroOrden]
    );
    if (!actual.rows[0]) throw new NotFoundError('Orden de compra no encontrada.');
    if (actual.rows[0].estado === 'enviada') {
      return { numero_orden: numeroOrden, estado: 'enviada' };
    }
    if (actual.rows[0].estado !== 'aprobada') {
      throw new ConflictError(
        `Solo puede enviarse una orden aprobada; el estado actual es "${actual.rows[0].estado}".`,
        'M3_INVALID_PURCHASE_ORDER_STATE'
      );
    }
    const res = await client.query<{ numero_orden: string; estado: string }>(
      `UPDATE g3_servicios.orden_compra
       SET estado = 'enviada', medio_envio = $2, fecha_hora_envio = CURRENT_TIMESTAMP, resultado_envio = 'enviada'
       WHERE numero_orden = $1
       RETURNING numero_orden, estado`,
      [numeroOrden, medioEnvio]
    );
    return res.rows[0];
  });
}

export async function recibirOrdenCompraService(
  ctx: AuthContext,
  numeroOrden: string,
  input: {
    numero_guia_factura?: string | null;
    items: Array<{
      id_detalle_orden: string;
      cantidad_aceptada: number;
      cantidad_rechazada: number;
      motivo_rechazo?: string | null;
      costo_unitario: string;
      fecha_vencimiento?: string | null;
    }>;
  }
) {
  return withTransaction(ctx, async (client) => {
    const ocRes = await client.query<{ estado: string }>(
      `SELECT estado FROM g3_servicios.orden_compra WHERE numero_orden = $1 FOR UPDATE`,
      [numeroOrden]
    );
    if (!ocRes.rows[0]) throw new NotFoundError('Orden de compra no encontrada.');
    if (!['enviada', 'parcialmente recibida'].includes(ocRes.rows[0].estado)) {
      throw new ConflictError(
        `La orden está "${ocRes.rows[0].estado}" y no admite recepciones.`,
        'M3_INVALID_PURCHASE_ORDER_STATE'
      );
    }

    const idRecepcion = crypto.randomUUID();
    await client.query(
      `INSERT INTO g3_servicios.recepcion_compra (
         id_recepcion, numero_orden, fecha_hora, numero_guia_factura, estado
       ) VALUES ($1, $2, CURRENT_TIMESTAMP, $3, 'registrada')`,
      [idRecepcion, numeroOrden, input.numero_guia_factura ?? null]
    );

    for (const item of input.items) {
      const detRes = await client.query<{ id_articulo: string; cantidad_solicitada: string; cantidad_aceptada: string }>(
        `SELECT d.id_articulo,
                d.cantidad_solicitada::text AS cantidad_solicitada,
                COALESCE(SUM(dr.cantidad_aceptada) FILTER (WHERE rc.id_recepcion IS NOT NULL), 0)::text AS cantidad_aceptada
         FROM g3_servicios.detalle_orden_compra d
         LEFT JOIN g3_servicios.detalle_recepcion dr ON dr.id_detalle_orden = d.id_detalle_orden
         LEFT JOIN g3_servicios.recepcion_compra rc ON rc.id_recepcion = dr.id_recepcion AND rc.estado <> 'anulada'
         WHERE d.id_detalle_orden = $1 AND d.numero_orden = $2
         GROUP BY d.id_articulo, d.cantidad_solicitada`,
        [item.id_detalle_orden, numeroOrden]
      );
      const det = detRes.rows[0];
      if (!det) throw new DomainRuleError('Detalle de orden de compra no corresponde a la orden.');
      const pendiente = Number(det.cantidad_solicitada) - Number(det.cantidad_aceptada);
      if (item.cantidad_aceptada > pendiente + 1e-9) {
        throw new DomainRuleError(
          `La cantidad aceptada supera el saldo pendiente (${pendiente}) de la línea.`,
          'M3_PURCHASE_RECEIPT_EXCEEDS_PENDING'
        );
      }

      let idLote: string | null = null;
      if (item.cantidad_aceptada > 0) {
        idLote = crypto.randomUUID();
        await client.query(
          `INSERT INTO g3_servicios.lote_articulo (
             id_lote, id_articulo, fecha_vencimiento, cantidad_disponible, costo_unitario
           ) VALUES ($1, $2, $3::date, $4, $5::numeric(12,4))`,
          [idLote, det.id_articulo, item.fecha_vencimiento ?? null, item.cantidad_aceptada, item.costo_unitario]
        );

        const stockRes = await client.query<{ total: string }>(
          `SELECT COALESCE(SUM(cantidad_disponible), 0)::text AS total
           FROM g3_servicios.lote_articulo WHERE id_articulo = $1`,
          [det.id_articulo]
        );
        await client.query(
          `INSERT INTO g3_servicios.movimiento_inventario (
             id_movimiento, id_articulo, id_lote, tipo_movimiento, cantidad, signo,
             fecha_hora, saldo_posterior, motivo, id_origen, modulo_origen, costo_unitario
           ) VALUES ($1, $2, $3, 'Recepción de compra', $4, 'entrada', CURRENT_TIMESTAMP, $5, $6, $7, 'Compras', $8::numeric(12,4))`,
          [
            crypto.randomUUID(),
            det.id_articulo,
            idLote,
            item.cantidad_aceptada,
            stockRes.rows[0]?.total ?? item.cantidad_aceptada,
            `Recepción OC ${numeroOrden}`,
            idRecepcion,
            item.costo_unitario,
          ]
        );
      }

      const recibida = item.cantidad_aceptada + item.cantidad_rechazada;
      await client.query(
        `INSERT INTO g3_servicios.detalle_recepcion (
           id_detalle_recepcion, id_recepcion, id_detalle_orden, id_lote,
           cantidad_recibida, cantidad_aceptada, cantidad_rechazada, motivo_rechazo, costo_unitario
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric(12,4))`,
        [
          crypto.randomUUID(),
          idRecepcion,
          item.id_detalle_orden,
          idLote,
          recibida,
          item.cantidad_aceptada,
          item.cantidad_rechazada,
          item.motivo_rechazo ?? null,
          item.costo_unitario,
        ]
      );
    }

    const pendienteRes = await client.query<{ pendientes: string }>(
      `SELECT COUNT(*)::text AS pendientes
       FROM g3_servicios.detalle_orden_compra d
       WHERE d.numero_orden = $1
         AND d.cantidad_solicitada > COALESCE((
           SELECT SUM(dr.cantidad_aceptada)
           FROM g3_servicios.detalle_recepcion dr
           JOIN g3_servicios.recepcion_compra rc ON rc.id_recepcion = dr.id_recepcion
           WHERE dr.id_detalle_orden = d.id_detalle_orden AND rc.estado <> 'anulada'
         ), 0)`,
      [numeroOrden]
    );
    const nextEstado = Number(pendienteRes.rows[0]?.pendientes ?? 0) > 0 ? 'parcialmente recibida' : 'completada';
    await client.query(
      `UPDATE g3_servicios.orden_compra SET estado = $2 WHERE numero_orden = $1`,
      [numeroOrden, nextEstado]
    );

    await registrarEnvioPendiente(
      client,
      'Facturación y Finanzas',
      'Costo de recepción',
      idRecepcion
    );

    return { id_recepcion: idRecepcion, numero_orden: numeroOrden, estado: nextEstado };
  });
}

export async function anularRecepcionCompraService(
  ctx: AuthContext,
  numeroOrden: string,
  idRecepcion: string,
  motivo: string
) {
  return withTransaction(ctx, async (client) => {
    const receiptRes = await client.query<{ estado: string }>(
      `SELECT estado FROM g3_servicios.recepcion_compra
       WHERE id_recepcion = $1 AND numero_orden = $2
       FOR UPDATE`,
      [idRecepcion, numeroOrden]
    );
    const receipt = receiptRes.rows[0];
    if (!receipt) throw new NotFoundError('Recepción de compra no encontrada.');
    if (receipt.estado === 'anulada') {
      return { id_recepcion: idRecepcion, numero_orden: numeroOrden, estado: 'anulada' };
    }
    const details = await client.query<{
      id_articulo: string;
      id_lote: string | null;
      cantidad_aceptada: string;
    }>(
      `SELECT d.id_articulo, dr.id_lote, dr.cantidad_aceptada::text AS cantidad_aceptada
       FROM g3_servicios.detalle_recepcion dr
       JOIN g3_servicios.detalle_orden_compra d ON d.id_detalle_orden = dr.id_detalle_orden
       WHERE dr.id_recepcion = $1 AND dr.cantidad_aceptada > 0`,
      [idRecepcion]
    );
    for (const detail of details.rows) {
      await aplicarMovimientoStock(client, {
        id_articulo: detail.id_articulo,
        id_lote: detail.id_lote,
        tipo_movimiento: 'Anulación recepción',
        signo: 'salida',
        cantidad: Number(detail.cantidad_aceptada),
        motivo,
        id_origen: idRecepcion,
        modulo_origen: 'Compras',
      });
    }
    await client.query(
      `UPDATE g3_servicios.recepcion_compra
       SET estado = 'anulada', motivo_anulacion = $2
       WHERE id_recepcion = $1`,
      [idRecepcion, motivo]
    );
    const accepted = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(dr.cantidad_aceptada), 0)::text AS total
       FROM g3_servicios.detalle_recepcion dr
       JOIN g3_servicios.recepcion_compra rc ON rc.id_recepcion = dr.id_recepcion
       WHERE rc.numero_orden = $1 AND rc.estado <> 'anulada'`,
      [numeroOrden]
    );
    const nextOrderState = Number(accepted.rows[0]?.total ?? 0) > 0 ? 'parcialmente recibida' : 'enviada';
    await client.query(
      `UPDATE g3_servicios.orden_compra SET estado = $2 WHERE numero_orden = $1`,
      [numeroOrden, nextOrderState]
    );
    await registrarEnvioPendiente(
      client,
      'Facturación y Finanzas',
      'Anulación de recepción',
      idRecepcion
    );
    return { id_recepcion: idRecepcion, numero_orden: numeroOrden, estado: 'anulada', estado_orden: nextOrderState };
  });
}
