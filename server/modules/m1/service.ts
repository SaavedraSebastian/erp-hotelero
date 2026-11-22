import { withReadOnlyClient, withTransaction } from '../../shared/database/transaction.ts';
import { ConflictError, DomainRuleError, NotFoundError } from '../../shared/errors/app-error.ts';
import { buildPaginatedResponse } from '../../shared/pagination/index.ts';
import { maskDocument, maskEmail, maskPhone } from '../../shared/privacy/masking.ts';
import type { AuthContext, PaginationParams } from '../../shared/types/context.ts';
import * as repo from './repository.ts';

export async function getHabitacionesService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listHabitaciones(client, params), ctx);
  return buildPaginatedResponse(rows, total, params.page, params.pageSize);
}

export async function getHuespedesService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listHuespedes(client, params), ctx);
  const masked = rows.map((g) => ({
    ...g,
    numero_documento: maskDocument(g.numero_documento, ctx.canViewFullPII),
    correo: maskEmail(g.correo, ctx.canViewFullPII),
    telefono: maskPhone(g.telefono, ctx.canViewFullPII),
  }));
  return buildPaginatedResponse(masked, total, params.page, params.pageSize);
}

export async function createHuespedService(
  ctx: AuthContext,
  input: Parameters<typeof repo.insertHuesped>[1]
) {
  return withTransaction(ctx, (client) => repo.insertHuesped(client, input));
}

export async function updateHuespedService(
  ctx: AuthContext,
  idHuesped: string,
  input: Parameters<typeof repo.updateHuesped>[2]
) {
  const updated = await withTransaction(ctx, (client) => repo.updateHuesped(client, idHuesped, input));
  if (!updated) {
    throw new NotFoundError('Huésped no encontrado.');
  }
  return updated;
}

export async function getTarifasService(ctx: AuthContext) {
  const rows = await withReadOnlyClient((client) => repo.listTarifas(client), ctx);
  return { data: rows };
}

export async function getReservasService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listReservas(client, params), ctx);
  return buildPaginatedResponse(rows, total, params.page, params.pageSize);
}

export async function createReservaService(
  ctx: AuthContext,
  input: {
    id_huesped: string;
    id_tarifa: string;
    id_canal_reserva: string;
    fecha_ingreso: string;
    fecha_salida: string;
    cantidad_huespedes: number;
    habitaciones: Array<{ id_habitacion: string; cantidad_huespedes: number }>;
    observaciones?: string | null;
  }
) {
  return withTransaction(
    ctx,
    async (client) => {
      const tarifaRes = await client.query<{
        id_tarifa: string;
        id_tipo_habitacion: string;
        precio_base: string;
        factor_ajuste: string;
      }>(
        `SELECT
           t.id_tarifa::text AS id_tarifa,
           t.id_tipo_habitacion::text AS id_tipo_habitacion,
           t.precio_base::text AS precio_base,
           tmp.factor_ajuste::text AS factor_ajuste
         FROM g1_reservas.tarifa t
         JOIN g1_reservas.temporada tmp ON tmp.id_temporada = t.id_temporada
         WHERE t.id_tarifa = $1::bigint
           AND t.estado = 'ACTIVA'`,
        [input.id_tarifa]
      );
      const tarifa = tarifaRes.rows[0];
      if (!tarifa) {
        throw new DomainRuleError('La tarifa seleccionada no existe o no está activa.');
      }

      const precioCalculado = Number(
        (Number(tarifa.precio_base) * Number(tarifa.factor_ajuste)).toFixed(2)
      ).toFixed(2);

      const roomIds = input.habitaciones.map((h) => h.id_habitacion);
      await client.query(
        `SELECT id_habitacion
         FROM g1_reservas.habitacion
         WHERE id_habitacion = ANY($1::bigint[])
         FOR UPDATE`,
        [roomIds]
      );

      const overlapRes = await client.query<{ id_habitacion: string; numero: string; id_reserva: string }>(
        `SELECT
           dr.id_habitacion::text AS id_habitacion,
           hab.numero,
           r.id_reserva::text AS id_reserva
         FROM g1_reservas.detalle_reserva dr
         JOIN g1_reservas.reserva r ON r.id_reserva = dr.id_reserva
         JOIN g1_reservas.habitacion hab ON hab.id_habitacion = dr.id_habitacion
         WHERE dr.id_habitacion = ANY($1::bigint[])
           AND r.estado NOT IN ('CANCELADA', 'NO_SHOW', 'FINALIZADA')
           AND r.fecha_ingreso < $3::date
           AND r.fecha_salida > $2::date
         LIMIT 1`,
        [roomIds, input.fecha_ingreso, input.fecha_salida]
      );
      if (overlapRes.rows[0]) {
        throw new ConflictError(
          `La habitación ${overlapRes.rows[0].numero} ya tiene una reserva activa en ese rango de fechas.`
        );
      }

      const reservaInsert = await client.query<{ id_reserva: string; estado: string }>(
        `INSERT INTO g1_reservas.reserva (
           id_huesped, id_tarifa, id_canal_reserva,
           fecha_ingreso, fecha_salida, cantidad_huespedes, estado, observaciones
         ) VALUES ($1::bigint, $2::bigint, $3::bigint, $4::date, $5::date, $6, 'CONFIRMADA', $7)
         RETURNING id_reserva::text AS id_reserva, estado`,
        [
          input.id_huesped,
          input.id_tarifa,
          input.id_canal_reserva,
          input.fecha_ingreso,
          input.fecha_salida,
          input.cantidad_huespedes,
          input.observaciones ?? null,
        ]
      );
      const idReserva = reservaInsert.rows[0].id_reserva;

      for (const hab of input.habitaciones) {
        await client.query(
          `INSERT INTO g1_reservas.detalle_reserva (
             id_reserva, id_habitacion, precio_noche, cantidad_huespedes
           ) VALUES ($1::bigint, $2::bigint, $3::numeric(12,2), $4)`,
          [idReserva, hab.id_habitacion, precioCalculado, hab.cantidad_huespedes]
        );
      }

      await client.query(
        `INSERT INTO g1_reservas.historial_reserva (
           id_reserva, accion, valores_nuevos, usuario, modulo_origen
         ) VALUES ($1::bigint, 'CREACION_RESERVA', $2::jsonb, $3, 'G1')`,
        [
          idReserva,
          JSON.stringify({
            estado: 'CONFIRMADA',
            fecha_ingreso: input.fecha_ingreso,
            fecha_salida: input.fecha_salida,
            precio_noche: precioCalculado,
          }),
          ctx.codigoUsuario,
        ]
      );

      return {
        id_reserva: idReserva,
        estado: reservaInsert.rows[0].estado,
        precio_noche: precioCalculado,
      };
    },
    { serializable: true }
  );
}

export async function updateReservaEstadoService(
  ctx: AuthContext,
  idReserva: string,
  nuevoEstado: 'CANCELADA' | 'NO_SHOW',
  motivo: string
) {
  return withTransaction(ctx, async (client) => {
    const current = await client.query<{ estado: string }>(
      `SELECT estado FROM g1_reservas.reserva WHERE id_reserva = $1::bigint FOR UPDATE`,
      [idReserva]
    );
    const row = current.rows[0];
    if (!row) throw new NotFoundError('Reserva no encontrada.');
    if (['CHECK_IN', 'FINALIZADA', 'CANCELADA'].includes(row.estado)) {
      throw new DomainRuleError(`La reserva en estado ${row.estado} no puede pasar a ${nuevoEstado}.`);
    }

    await client.query(
      `UPDATE g1_reservas.reserva SET estado = $2 WHERE id_reserva = $1::bigint`,
      [idReserva, nuevoEstado]
    );
    await client.query(
      `INSERT INTO g1_reservas.historial_reserva (
         id_reserva, accion, valores_anteriores, valores_nuevos, usuario, modulo_origen
       ) VALUES ($1::bigint, $2, $3::jsonb, $4::jsonb, $5, 'G1')`,
      [
        idReserva,
        `CAMBIO_ESTADO_${nuevoEstado}`,
        JSON.stringify({ estado: row.estado }),
        JSON.stringify({ estado: nuevoEstado, motivo }),
        ctx.codigoUsuario,
      ]
    );
    return { id_reserva: idReserva, estado: nuevoEstado };
  });
}

export async function performCheckInService(
  ctx: AuthContext,
  idReserva: string,
  input: {
    id_detalle_reserva: string;
    id_habitacion?: string;
    observaciones?: string | null;
    acompanantes: Array<{
      tipo_documento: string;
      numero_documento: string;
      nombres: string;
      apellidos: string;
    }>;
  }
) {
  return withTransaction(
    ctx,
    async (client) => {
      const detRes = await client.query<{
        id_detalle_reserva: string;
        id_reserva: string;
        id_habitacion: string;
        precio_noche: string;
        id_huesped: string;
        fecha_ingreso: string;
        fecha_salida: string;
        reserva_estado: string;
      }>(
        `SELECT
           dr.id_detalle_reserva::text AS id_detalle_reserva,
           dr.id_reserva::text AS id_reserva,
           dr.id_habitacion::text AS id_habitacion,
           dr.precio_noche::text AS precio_noche,
           r.id_huesped::text AS id_huesped,
           r.fecha_ingreso::text AS fecha_ingreso,
           r.fecha_salida::text AS fecha_salida,
           r.estado AS reserva_estado
         FROM g1_reservas.detalle_reserva dr
         JOIN g1_reservas.reserva r ON r.id_reserva = dr.id_reserva
         WHERE dr.id_detalle_reserva = $1::bigint AND dr.id_reserva = $2::bigint
         FOR UPDATE OF dr, r`,
        [input.id_detalle_reserva, idReserva]
      );
      const detalle = detRes.rows[0];
      if (!detalle) {
        throw new NotFoundError('No se encontró el detalle de reserva indicado.');
      }

      const targetHabitacion = input.id_habitacion ?? detalle.id_habitacion;
      const hkStateRes = await client.query<{ id_estado: string | null }>(
        `SELECT vea.id_estado
         FROM g1_reservas.habitacion h
         LEFT JOIN g2_housekeeping.v_estado_actual vea ON vea.id_habitacion = h.id_habitacion
         WHERE h.id_habitacion = $1::bigint`,
        [targetHabitacion]
      );
      const hkState = hkStateRes.rows[0]?.id_estado ?? 'DIS';
      if (hkState !== 'DIS') {
        throw new DomainRuleError(
          `Check-in bloqueado: la habitación está en estado Housekeeping "${hkState}" (debe estar Disponible/Inspeccionada).`
        );
      }

      if (targetHabitacion !== detalle.id_habitacion) {
        await client.query(
          `UPDATE g1_reservas.detalle_reserva SET id_habitacion = $2::bigint WHERE id_detalle_reserva = $1::bigint`,
          [detalle.id_detalle_reserva, targetHabitacion]
        );
      }

      const estadiaRes = await client.query<{ id_estadia: string }>(
        `INSERT INTO g1_reservas.estadia (
           id_detalle_reserva, id_reserva, id_habitacion, estado, observaciones
         ) VALUES ($1::bigint, $2::bigint, $3::bigint, 'EN_CURSO', $4)
         RETURNING id_estadia::text AS id_estadia`,
        [detalle.id_detalle_reserva, idReserva, targetHabitacion, input.observaciones ?? null]
      );
      const idEstadia = estadiaRes.rows[0].id_estadia;

      for (const comp of input.acompanantes) {
        await client.query(
          `INSERT INTO g1_reservas.acompanante (
             id_estadia, tipo_documento, numero_documento, nombres, apellidos
           ) VALUES ($1::bigint, $2, $3, $4, $5)`,
          [idEstadia, comp.tipo_documento, comp.numero_documento, comp.nombres, comp.apellidos]
        );
      }

      await client.query(
        `UPDATE g1_reservas.reserva SET estado = 'CHECK_IN' WHERE id_reserva = $1::bigint`,
        [idReserva]
      );

      // Transición en G2: DIS -> OCU si tiene historial previo o registro inicial
      await client.query(
        `INSERT INTO g2_housekeeping.cambio_estado_habitacion (
           id_habitacion, id_estado_anterior, id_estado_nuevo, origen, motivo
         ) VALUES (
           $1::bigint,
           (SELECT id_estado FROM g2_housekeeping.v_estado_actual WHERE id_habitacion = $1::bigint),
           'OCU',
           'Manual',
           $2
         )`,
        [targetHabitacion, `Check-in estadía #${idEstadia}`]
      );

      // Apertura de cuenta en G4 (respetando ux_cuenta_reserva)
      await client.query(
        `INSERT INTO g4_finanzas.cuenta (id_huesped, id_reserva, id_habitacion, saldo_pendiente, estado)
         VALUES ($1::bigint, $2::bigint, $3::bigint, 0, 'ACTIVA')
         ON CONFLICT (id_reserva) WHERE id_reserva IS NOT NULL DO NOTHING`,
        [detalle.id_huesped, idReserva, targetHabitacion]
      );

      await client.query(
        `INSERT INTO g1_reservas.historial_reserva (
           id_reserva, accion, valores_nuevos, usuario, modulo_origen
         ) VALUES ($1::bigint, 'CHECK_IN', $2::jsonb, $3, 'G1')`,
        [idReserva, JSON.stringify({ id_estadia: idEstadia, id_habitacion: targetHabitacion }), ctx.codigoUsuario]
      );

      return { id_estadia: idEstadia, id_reserva: idReserva, id_habitacion: targetHabitacion, estado: 'EN_CURSO' };
    },
    { serializable: true }
  );
}

export async function performCheckOutService(
  ctx: AuthContext,
  idEstadia: string,
  input: {
    observaciones?: string | null;
    autorizar_saldo_pendiente: boolean;
    motivo_autorizacion?: string | null;
  }
) {
  return withTransaction(ctx, async (client) => {
    const estRes = await client.query<{
      id_estadia: string;
      id_reserva: string;
      id_habitacion: string;
      estado: string;
    }>(
      `SELECT
         id_estadia::text AS id_estadia,
         id_reserva::text AS id_reserva,
         id_habitacion::text AS id_habitacion,
         estado
       FROM g1_reservas.estadia
       WHERE id_estadia = $1::bigint
       FOR UPDATE`,
      [idEstadia]
    );
    const estadia = estRes.rows[0];
    if (!estadia) throw new NotFoundError('Estadía no encontrada.');
    if (estadia.estado !== 'EN_CURSO') {
      throw new DomainRuleError(`La estadía ya se encuentra en estado ${estadia.estado}.`);
    }

    const cuentaRes = await client.query<{ id_cuenta: string; saldo_pendiente: string }>(
      `SELECT id_cuenta, saldo_pendiente::text AS saldo_pendiente
       FROM g4_finanzas.cuenta
       WHERE id_reserva = $1::bigint
       FOR UPDATE`,
      [estadia.id_reserva]
    );
    const cuenta = cuentaRes.rows[0];
    const saldo = Number(cuenta?.saldo_pendiente ?? 0);
    if (saldo > 0.01 && !input.autorizar_saldo_pendiente) {
      throw new DomainRuleError(
        `La cuenta mantiene un saldo pendiente de S/ ${saldo.toFixed(2)}. Liquide el folio o autorice traslado.`
      );
    }

    await client.query(
      `UPDATE g1_reservas.estadia
       SET estado = 'FINALIZADA', fecha_hora_check_out = CURRENT_TIMESTAMP, observaciones = COALESCE($2, observaciones)
       WHERE id_estadia = $1::bigint`,
      [idEstadia, input.observaciones ?? null]
    );

    await client.query(
      `UPDATE g1_reservas.reserva SET estado = 'CHECK_OUT' WHERE id_reserva = $1::bigint`,
      [estadia.id_reserva]
    );

    await client.query(
      `INSERT INTO g2_housekeeping.cambio_estado_habitacion (
         id_habitacion, id_estado_anterior, id_estado_nuevo, origen, motivo
       ) VALUES (
         $1::bigint,
         (SELECT id_estado FROM g2_housekeeping.v_estado_actual WHERE id_habitacion = $1::bigint),
         'SUC',
         'Check-out',
         $2
       )`,
      [estadia.id_habitacion, `Check-out estadía #${idEstadia}`]
    );

    await client.query(
      `INSERT INTO g2_housekeeping.orden_limpieza (
         id_habitacion, id_estadia, id_turno, fecha_programada,
         tipo_limpieza, origen, prioridad, estado, observaciones
       ) VALUES ($1::bigint, $2::bigint, 'M', CURRENT_DATE, 'Salida', 'Check-out', 'Alta', 'Pendiente', $3)
       ON CONFLICT (id_estadia) DO NOTHING`,
      [estadia.id_habitacion, idEstadia, `Generada automáticamente por Check-out de estadía #${idEstadia}`]
    );

    await client.query(
      `INSERT INTO g1_reservas.historial_reserva (
         id_reserva, accion, valores_nuevos, usuario, modulo_origen
       ) VALUES ($1::bigint, 'CHECK_OUT', $2::jsonb, $3, 'G1')`,
      [
        estadia.id_reserva,
        JSON.stringify({
          id_estadia: idEstadia,
          saldo_al_cierre: saldo.toFixed(2),
          motivo_autorizacion: input.motivo_autorizacion ?? null,
        }),
        ctx.codigoUsuario,
      ]
    );

    return { id_estadia: idEstadia, estado: 'FINALIZADA', orden_limpieza_generada: true };
  });
}

export async function getListaEsperaService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listListaEspera(client, params), ctx);
  return buildPaginatedResponse(rows, total, params.page, params.pageSize);
}

export async function createListaEsperaService(
  ctx: AuthContext,
  input: {
    id_huesped: string;
    id_tipo_habitacion: string;
    fecha_ingreso: string;
    fecha_salida: string;
    prioridad: number;
  }
) {
  return withTransaction(ctx, async (client) => {
    const res = await client.query<{ id_lista_espera: string; estado: string }>(
      `INSERT INTO g1_reservas.lista_espera (
         id_huesped, id_tipo_habitacion, fecha_ingreso, fecha_salida, prioridad
       ) VALUES ($1::bigint, $2::bigint, $3::date, $4::date, $5)
       RETURNING id_lista_espera::text AS id_lista_espera, estado`,
      [input.id_huesped, input.id_tipo_habitacion, input.fecha_ingreso, input.fecha_salida, input.prioridad]
    );
    return res.rows[0];
  });
}
