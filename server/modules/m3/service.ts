import crypto from 'crypto';
import { setMotivoCambioPrecio, withReadOnlyClient, withTransaction } from '../../shared/database/transaction.ts';
import { DomainRuleError, ForbiddenError, NotFoundError } from '../../shared/errors/app-error.ts';
import { buildPaginatedResponse } from '../../shared/pagination/index.ts';
import type { AuthContext, PaginationParams } from '../../shared/types/context.ts';
import { aplicarMovimientoStock } from '../gestion/stock.ts';
import * as repo from './repository.ts';

function genCode(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`.slice(0, 30);
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
    let mesaNombre: string | null = null;
    if (input.modalidad === 'mesa') {
      const mesaRes = await client.query<{ nombre: string; estado: string }>(
        `SELECT nombre, estado FROM g3_servicios.mesa WHERE id_mesa = $1`,
        [input.id_mesa]
      );
      if (!mesaRes.rows[0] || mesaRes.rows[0].estado !== 'activa') {
        throw new DomainRuleError('La mesa seleccionada no existe o está inactiva.');
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
        input.id_estadia_externa ?? null,
      ]
    );

    for (const item of input.items) {
      const itemRes = await client.query<{ precio_vigente: string; estado: string }>(
        `SELECT precio_vigente::text AS precio_vigente, estado
         FROM g3_servicios.item_catalogo
         WHERE id_item_catalogo = $1`,
        [item.id_item_catalogo]
      );
      const cat = itemRes.rows[0];
      if (!cat || cat.estado !== 'activo') {
        throw new DomainRuleError('Uno de los ítems seleccionados no existe o está inactivo.');
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

export async function cambiarEstadoComandaService(
  ctx: AuthContext,
  numeroComanda: string,
  nuevoEstado: 'en preparación' | 'lista' | 'cancelada',
  motivoCancelacion?: string
) {
  return withTransaction(ctx, async (client) => {
    const res = await client.query<{ numero_comanda: string; estado: string }>(
      `UPDATE g3_servicios.comanda
       SET
         estado = $2::varchar,
         motivo_cancelacion = CASE WHEN $2::varchar = 'cancelada' THEN $3 ELSE motivo_cancelacion END
       WHERE numero_comanda = $1
       RETURNING numero_comanda, estado`,
      [numeroComanda, nuevoEstado, motivoCancelacion ?? null]
    );
    if (!res.rows[0]) throw new NotFoundError('Comanda no encontrada.');
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
    const numeroConsumo = genCode('CON');
    const resolvedLines: Array<{
      id_item_catalogo: string;
      cantidad: number;
      precio_capturado: string;
      importe_lista: string;
      importe: string;
    }> = [];

    for (const item of input.items) {
      const catRes = await client.query<{ precio_vigente: string; estado: string }>(
        `SELECT precio_vigente::text AS precio_vigente, estado
         FROM g3_servicios.item_catalogo WHERE id_item_catalogo = $1`,
        [item.id_item_catalogo]
      );
      const cat = catRes.rows[0];
      if (!cat || cat.estado !== 'activo') {
        throw new DomainRuleError('Ítem de catálogo inexistente o inactivo.');
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
        input.id_estadia_externa ?? null,
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

export async function confirmarConsumoService(ctx: AuthContext, numeroConsumo: string) {
  return withTransaction(ctx, async (client) => {
    const conRes = await client.query<{ numero_consumo: string; estado: string }>(
      `SELECT numero_consumo, estado FROM g3_servicios.consumo WHERE numero_consumo = $1 FOR UPDATE`,
      [numeroConsumo]
    );
    if (!conRes.rows[0]) throw new NotFoundError('Consumo no encontrado.');

    const detRes = await client.query<{
      id_articulo_descuento: string | null;
      cantidad: string;
    }>(
      `SELECT ic.id_articulo_descuento, dc.cantidad::text AS cantidad
       FROM g3_servicios.detalle_consumo dc
       JOIN g3_servicios.item_catalogo ic ON ic.id_item_catalogo = dc.id_item_catalogo
       WHERE dc.numero_consumo = $1`,
      [numeroConsumo]
    );

    for (const d of detRes.rows) {
      if (!d.id_articulo_descuento) continue;
      // La venta ya ocurrió: se descuenta lo disponible (por lotes) sin bloquear la confirmación si falta stock.
      await aplicarMovimientoStock(client, {
        id_articulo: d.id_articulo_descuento,
        tipo_movimiento: 'Consumo POS',
        signo: 'salida',
        cantidad: Number(d.cantidad),
        motivo: `Confirmación consumo ${numeroConsumo}`,
        id_origen: numeroConsumo,
        modulo_origen: 'Almacén',
        permitirParcial: true,
      });
    }

    const upd = await client.query<{ numero_consumo: string; estado: string }>(
      `UPDATE g3_servicios.consumo
       SET estado = 'confirmado', fecha_hora_confirmacion = CURRENT_TIMESTAMP
       WHERE numero_consumo = $1
       RETURNING numero_consumo, estado`,
      [numeroConsumo]
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
    const query =
      accion === 'descartar'
        ? `UPDATE g3_servicios.consumo SET estado = 'descartado', motivo_descarte = $2 WHERE numero_consumo = $1 RETURNING numero_consumo, estado`
        : `UPDATE g3_servicios.consumo SET estado = 'anulado', motivo_anulacion = $2 WHERE numero_consumo = $1 RETURNING numero_consumo, estado`;
    const res = await client.query<{ numero_consumo: string; estado: string }>(query, [numeroConsumo, motivo]);
    if (!res.rows[0]) throw new NotFoundError('Consumo no encontrado.');
    return res.rows[0];
  });
}

export async function getInventarioService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listInventario(client, params), ctx);
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
    const res = await client.query<{ numero_orden: string; estado: string }>(
      `UPDATE g3_servicios.orden_compra
       SET estado = 'enviada', medio_envio = $2, fecha_hora_envio = CURRENT_TIMESTAMP, resultado_envio = 'enviada'
       WHERE numero_orden = $1
       RETURNING numero_orden, estado`,
      [numeroOrden, medioEnvio]
    );
    if (!res.rows[0]) throw new NotFoundError('Orden de compra no encontrada.');
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

    const idRecepcion = crypto.randomUUID();
    await client.query(
      `INSERT INTO g3_servicios.recepcion_compra (
         id_recepcion, numero_orden, fecha_hora, numero_guia_factura, estado
       ) VALUES ($1, $2, CURRENT_TIMESTAMP, $3, 'registrada')`,
      [idRecepcion, numeroOrden, input.numero_guia_factura ?? null]
    );

    for (const item of input.items) {
      const detRes = await client.query<{ id_articulo: string }>(
        `SELECT id_articulo
         FROM g3_servicios.detalle_orden_compra
         WHERE id_detalle_orden = $1 AND numero_orden = $2`,
        [item.id_detalle_orden, numeroOrden]
      );
      const det = detRes.rows[0];
      if (!det) throw new DomainRuleError('Detalle de orden de compra no corresponde a la orden.');

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

    const hasRejected = input.items.some((i) => i.cantidad_rechazada > 0);
    const nextEstado = hasRejected ? 'parcialmente recibida' : 'completada';
    await client.query(
      `UPDATE g3_servicios.orden_compra SET estado = $2 WHERE numero_orden = $1`,
      [numeroOrden, nextEstado]
    );

    return { id_recepcion: idRecepcion, numero_orden: numeroOrden, estado: nextEstado };
  });
}
