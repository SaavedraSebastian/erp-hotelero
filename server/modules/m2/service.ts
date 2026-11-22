import { withReadOnlyClient, withTransaction } from '../../shared/database/transaction.ts';
import { DomainRuleError, NotFoundError } from '../../shared/errors/app-error.ts';
import { buildPaginatedResponse } from '../../shared/pagination/index.ts';
import type { AuthContext, PaginationParams } from '../../shared/types/context.ts';
import * as repo from './repository.ts';

export async function getEstadosHabitacionService(ctx: AuthContext) {
  return withReadOnlyClient((client) => repo.listEstadosHabitacion(client), ctx);
}

export async function cambiarEstadoHabitacionService(
  ctx: AuthContext,
  idHabitacion: string,
  input: { id_estado_nuevo: string; origen: string; motivo?: string | null }
) {
  return withTransaction(ctx, async (client) => {
    const actualRes = await client.query<{ id_estado: string | null }>(
      `SELECT id_estado FROM g2_housekeeping.v_estado_actual WHERE id_habitacion = $1::bigint`,
      [idHabitacion]
    );
    const idEstadoAnterior = actualRes.rows[0]?.id_estado ?? null;

    if (idEstadoAnterior) {
      const transRes = await client.query<{ requiere_motivo: boolean }>(
        `SELECT requiere_motivo
         FROM g2_housekeeping.transicion_permitida
         WHERE id_estado_origen = $1 AND id_estado_destino = $2`,
        [idEstadoAnterior, input.id_estado_nuevo]
      );
      const trans = transRes.rows[0];
      if (!trans) {
        throw new DomainRuleError(
          `Transición de habitación no permitida: ${idEstadoAnterior} -> ${input.id_estado_nuevo}.`
        );
      }
      if (trans.requiere_motivo && (!input.motivo || !input.motivo.trim())) {
        throw new DomainRuleError('Esta transición exige especificar un motivo obligatorio.');
      }
    }

    const res = await client.query<{ id_cambio: string; id_estado_nuevo: string; fecha_hora: string }>(
      `INSERT INTO g2_housekeeping.cambio_estado_habitacion (
         id_habitacion, id_estado_anterior, id_estado_nuevo, id_personal, origen, motivo
       ) VALUES ($1::bigint, $2, $3, $4::bigint, $5, $6)
       RETURNING id_cambio::text AS id_cambio, id_estado_nuevo, fecha_hora::text AS fecha_hora`,
      [
        idHabitacion,
        idEstadoAnterior,
        input.id_estado_nuevo,
        ctx.idPersonalG2 ?? null,
        input.origen,
        input.motivo ?? null,
      ]
    );
    return res.rows[0];
  });
}

export async function getOrdenesLimpiezaService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listOrdenesLimpieza(client, params), ctx);
  return buildPaginatedResponse(rows, total, params.page, params.pageSize);
}

export async function createOrdenLimpiezaService(
  ctx: AuthContext,
  input: {
    id_habitacion: string;
    id_turno: 'M' | 'T' | 'N';
    fecha_programada?: string;
    tipo_limpieza: string;
    origen: string;
    prioridad: string;
    observaciones?: string | null;
  }
) {
  return withTransaction(ctx, async (client) => {
    const res = await client.query<{ numero_orden: string; estado: string }>(
      `INSERT INTO g2_housekeeping.orden_limpieza (
         id_habitacion, id_turno, fecha_programada, tipo_limpieza, origen, prioridad, observaciones
       ) VALUES ($1::bigint, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7)
       RETURNING numero_orden::text AS numero_orden, estado`,
      [
        input.id_habitacion,
        input.id_turno,
        input.fecha_programada ?? null,
        input.tipo_limpieza,
        input.origen,
        input.prioridad,
        input.observaciones ?? null,
      ]
    );
    return res.rows[0];
  });
}

export async function asignarOrdenLimpiezaService(
  ctx: AuthContext,
  numeroOrden: string,
  input: { id_personal: string; origen_asignacion: string; motivo_reasignacion?: string | null }
) {
  return withTransaction(ctx, async (client) => {
    const ordRes = await client.query<{ estado: string }>(
      `SELECT estado FROM g2_housekeeping.orden_limpieza WHERE numero_orden = $1::bigint FOR UPDATE`,
      [numeroOrden]
    );
    const ord = ordRes.rows[0];
    if (!ord) throw new NotFoundError('Orden de limpieza no encontrada.');
    if (['Cerrada', 'Anulada'].includes(ord.estado)) {
      throw new DomainRuleError('No se puede asignar una orden cerrada o anulada.');
    }

    const hadAssignment = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM g2_housekeeping.asignacion_limpieza WHERE numero_orden = $1::bigint) AS exists`,
      [numeroOrden]
    );
    if (hadAssignment.rows[0]?.exists && (!input.motivo_reasignacion || !input.motivo_reasignacion.trim())) {
      throw new DomainRuleError('La reasignación de personal exige indicar motivo_reasignacion.');
    }

    await client.query(
      `UPDATE g2_housekeeping.asignacion_limpieza
       SET vigente = FALSE
       WHERE numero_orden = $1::bigint AND vigente = TRUE`,
      [numeroOrden]
    );

    await client.query(
      `INSERT INTO g2_housekeeping.asignacion_limpieza (
         numero_orden, id_personal, origen_asignacion, motivo_reasignacion, vigente
       ) VALUES ($1::bigint, $2::bigint, $3, $4, TRUE)`,
      [numeroOrden, input.id_personal, input.origen_asignacion, input.motivo_reasignacion ?? null]
    );

    if (ord.estado === 'Pendiente') {
      await client.query(
        `UPDATE g2_housekeeping.orden_limpieza SET estado = 'Asignada' WHERE numero_orden = $1::bigint`,
        [numeroOrden]
      );
    }

    return { numero_orden: numeroOrden, id_personal: input.id_personal, estado: 'Asignada' };
  });
}

export async function avanzarOrdenLimpiezaService(
  ctx: AuthContext,
  numeroOrden: string,
  accion: 'iniciar' | 'finalizar'
) {
  return withTransaction(ctx, async (client) => {
    const ordRes = await client.query<{ id_habitacion: string; estado: string }>(
      `SELECT id_habitacion::text AS id_habitacion, estado
       FROM g2_housekeeping.orden_limpieza
       WHERE numero_orden = $1::bigint FOR UPDATE`,
      [numeroOrden]
    );
    const ord = ordRes.rows[0];
    if (!ord) throw new NotFoundError('Orden de limpieza no encontrada.');

    if (accion === 'iniciar') {
      if (!['Pendiente', 'Asignada'].includes(ord.estado)) {
        throw new DomainRuleError(`La orden en estado "${ord.estado}" no puede iniciarse.`);
      }
      await client.query(
        `UPDATE g2_housekeeping.orden_limpieza
         SET estado = 'En limpieza', fecha_hora_inicio = COALESCE(fecha_hora_inicio, CURRENT_TIMESTAMP)
         WHERE numero_orden = $1::bigint`,
        [numeroOrden]
      );
      await cambiarEstadoHabitacionSafe(client, ord.id_habitacion, 'ELI', ctx.idPersonalG2 ?? null, 'Limpieza', `Inicio orden #${numeroOrden}`);
      return { numero_orden: numeroOrden, estado: 'En limpieza' };
    }

    if (ord.estado !== 'En limpieza') {
      throw new DomainRuleError(`La orden debe estar "En limpieza" para finalizarse.`);
    }
    await client.query(
      `UPDATE g2_housekeeping.orden_limpieza
       SET estado = 'Pendiente inspección', fecha_hora_fin = CURRENT_TIMESTAMP
       WHERE numero_orden = $1::bigint`,
      [numeroOrden]
    );
    await cambiarEstadoHabitacionSafe(client, ord.id_habitacion, 'LIM', ctx.idPersonalG2 ?? null, 'Limpieza', `Fin orden #${numeroOrden}`);
    return { numero_orden: numeroOrden, estado: 'Pendiente inspección' };
  });
}

async function cambiarEstadoHabitacionSafe(
  client: import('pg').PoolClient,
  idHabitacion: string,
  nuevo: string,
  idPersonal: string | null,
  origen: string,
  motivo: string
) {
  const actualRes = await client.query<{ id_estado: string | null }>(
    `SELECT id_estado FROM g2_housekeeping.v_estado_actual WHERE id_habitacion = $1::bigint`,
    [idHabitacion]
  );
  const anterior = actualRes.rows[0]?.id_estado ?? null;
  if (anterior === nuevo) return;
  await client.query(
    `INSERT INTO g2_housekeeping.cambio_estado_habitacion (
       id_habitacion, id_estado_anterior, id_estado_nuevo, id_personal, origen, motivo
     ) VALUES ($1::bigint, $2, $3, $4::bigint, $5, $6)`,
    [idHabitacion, anterior, nuevo, idPersonal, origen, motivo]
  );
}

export async function registrarInspeccionService(
  ctx: AuthContext,
  input: {
    numero_orden: string;
    id_supervisor?: string;
    resultado: 'Conforme' | 'No conforme';
    motivo_rechazo?: string | null;
    lista_verificacion: Record<string, boolean>;
  }
) {
  return withTransaction(ctx, async (client) => {
    const idSupervisor = input.id_supervisor ?? ctx.idPersonalG2;
    if (!idSupervisor) {
      throw new DomainRuleError('Se requiere identificar el supervisor de Housekeeping para registrar la inspección.');
    }

    const ordRes = await client.query<{ id_habitacion: string; estado: string }>(
      `SELECT id_habitacion::text AS id_habitacion, estado
       FROM g2_housekeeping.orden_limpieza
       WHERE numero_orden = $1::bigint FOR UPDATE`,
      [input.numero_orden]
    );
    const ord = ordRes.rows[0];
    if (!ord) throw new NotFoundError('Orden de limpieza no encontrada.');

    const inspRes = await client.query<{ id_inspeccion: string }>(
      `INSERT INTO g2_housekeeping.inspeccion (
         numero_orden, id_supervisor, resultado, motivo_rechazo, lista_verificacion
       ) VALUES ($1::bigint, $2::bigint, $3, $4, $5::jsonb)
       RETURNING id_inspeccion::text AS id_inspeccion`,
      [
        input.numero_orden,
        idSupervisor,
        input.resultado,
        input.motivo_rechazo ?? null,
        JSON.stringify(input.lista_verificacion),
      ]
    );

    if (input.resultado === 'Conforme') {
      await client.query(
        `UPDATE g2_housekeeping.orden_limpieza SET estado = 'Cerrada' WHERE numero_orden = $1::bigint`,
        [input.numero_orden]
      );
      await cambiarEstadoHabitacionSafe(
        client,
        ord.id_habitacion,
        'DIS',
        idSupervisor,
        'Inspección',
        `Inspección conforme #${inspRes.rows[0].id_inspeccion}`
      );
    } else {
      await client.query(
        `UPDATE g2_housekeeping.orden_limpieza SET estado = 'En limpieza' WHERE numero_orden = $1::bigint`,
        [input.numero_orden]
      );
      await cambiarEstadoHabitacionSafe(
        client,
        ord.id_habitacion,
        'ELI',
        idSupervisor,
        'Inspección',
        input.motivo_rechazo ?? 'Rechazada en inspección'
      );
    }

    return { id_inspeccion: inspRes.rows[0].id_inspeccion, resultado: input.resultado };
  });
}

export async function getIncidenciasService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listIncidencias(client, params), ctx);
  return buildPaginatedResponse(rows, total, params.page, params.pageSize);
}

export async function createIncidenciaService(
  ctx: AuthContext,
  input: {
    id_habitacion?: string | null;
    id_activo?: string | null;
    id_reclamo?: string | null;
    numero_orden?: string | null;
    descripcion: string;
    criticidad: string;
    origen: string;
  }
) {
  return withTransaction(ctx, async (client) => {
    const res = await client.query<{ numero_incidencia: string; estado: string }>(
      `INSERT INTO g2_housekeeping.incidencia (
         id_habitacion, id_activo, id_personal, id_reclamo, numero_orden,
         descripcion, criticidad, origen
       ) VALUES ($1::bigint, $2::bigint, $3::bigint, $4::bigint, $5::bigint, $6, $7, $8)
       RETURNING numero_incidencia::text AS numero_incidencia, estado`,
      [
        input.id_habitacion ?? null,
        input.id_activo ?? null,
        ctx.idPersonalG2 ?? null,
        input.id_reclamo ?? null,
        input.numero_orden ?? null,
        input.descripcion,
        input.criticidad,
        input.origen,
      ]
    );
    return res.rows[0];
  });
}

export async function getOrdenesTrabajoService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listOrdenesTrabajo(client, params), ctx);
  return buildPaginatedResponse(rows, total, params.page, params.pageSize);
}

export async function createOrdenTrabajoService(
  ctx: AuthContext,
  input: {
    tipo_ot: 'Correctiva' | 'Preventiva';
    id_activo?: string | null;
    id_tecnico?: string | null;
    id_centro_costo: string;
    descripcion_tarea: string;
    prioridad: string;
    numero_incidencia?: string | null;
    diagnostico?: string | null;
    id_plan?: string | null;
    id_alerta?: string | null;
    fecha_programada?: string;
  }
) {
  return withTransaction(ctx, async (client) => {
    const estadoInicial = input.id_tecnico ? 'Asignada' : 'Pendiente';
    const otRes = await client.query<{ numero_ot: string; estado: string }>(
      `INSERT INTO g2_housekeeping.orden_trabajo (
         id_activo, id_tecnico, id_centro_costo, tipo_ot, descripcion_tarea, prioridad, estado
       ) VALUES ($1::bigint, $2::bigint, $3::bigint, $4, $5, $6, $7)
       RETURNING numero_ot::text AS numero_ot, estado`,
      [
        input.id_activo ?? null,
        input.id_tecnico ?? null,
        input.id_centro_costo,
        input.tipo_ot,
        input.descripcion_tarea,
        input.prioridad,
        estadoInicial,
      ]
    );
    const numeroOt = otRes.rows[0].numero_ot;

    if (input.tipo_ot === 'Correctiva') {
      await client.query(
        `INSERT INTO g2_housekeeping.ot_correctiva (numero_ot, numero_incidencia, diagnostico)
         VALUES ($1::bigint, $2::bigint, $3)`,
        [numeroOt, input.numero_incidencia, input.diagnostico ?? null]
      );
      await client.query(
        `UPDATE g2_housekeeping.incidencia SET estado = 'En atención' WHERE numero_incidencia = $1::bigint AND estado = 'Abierta'`,
        [input.numero_incidencia]
      );
    } else {
      await client.query(
        `INSERT INTO g2_housekeeping.ot_preventiva (numero_ot, id_plan, id_alerta, fecha_programada)
         VALUES ($1::bigint, $2::bigint, $3::bigint, COALESCE($4::date, CURRENT_DATE))`,
        [numeroOt, input.id_plan ?? null, input.id_alerta ?? null, input.fecha_programada ?? null]
      );
    }

    return otRes.rows[0];
  });
}

export async function ponerOtEnEsperaService(ctx: AuthContext, numeroOt: string, motivoEspera: string) {
  return withTransaction(ctx, async (client) => {
    const res = await client.query<{ numero_ot: string; estado: string }>(
      `UPDATE g2_housekeeping.orden_trabajo
       SET estado = 'En espera', motivo_espera = $2
       WHERE numero_ot = $1::bigint AND estado NOT IN ('Cerrada', 'Anulada')
       RETURNING numero_ot::text AS numero_ot, estado`,
      [numeroOt, motivoEspera]
    );
    if (!res.rows[0]) throw new NotFoundError('Orden de trabajo no encontrada o ya cerrada.');
    return res.rows[0];
  });
}

export async function cerrarOrdenTrabajoService(
  ctx: AuthContext,
  numeroOt: string,
  input: { trabajo_realizado: string; horas_trabajadas: number; costo_total: string }
) {
  return withTransaction(ctx, async (client) => {
    const res = await client.query<{ numero_ot: string; estado: string }>(
      `UPDATE g2_housekeeping.orden_trabajo
       SET
         estado = 'Cerrada',
         fecha_hora_inicio = COALESCE(fecha_hora_inicio, fecha_hora_creacion),
         fecha_hora_cierre = CURRENT_TIMESTAMP,
         trabajo_realizado = $2,
         horas_trabajadas = $3,
         costo_total = $4::numeric(12,2)
       WHERE numero_ot = $1::bigint
       RETURNING numero_ot::text AS numero_ot, estado`,
      [numeroOt, input.trabajo_realizado, input.horas_trabajadas, input.costo_total]
    );
    if (!res.rows[0]) throw new NotFoundError('Orden de trabajo no encontrada.');

    await client.query(
      `UPDATE g2_housekeeping.incidencia i
       SET estado = 'Cerrada', fecha_hora_cierre = CURRENT_TIMESTAMP
       FROM g2_housekeeping.ot_correctiva c
       WHERE c.numero_ot = $1::bigint AND i.numero_incidencia = c.numero_incidencia AND i.estado <> 'Cerrada'`,
      [numeroOt]
    );

    return res.rows[0];
  });
}

export async function getInsumosService(ctx: AuthContext) {
  const rows = await withReadOnlyClient((client) => repo.listInsumos(client), ctx);
  return { data: rows };
}

export async function registrarMovimientoInsumoService(
  ctx: AuthContext,
  input: {
    id_insumo: string;
    id_personal?: string;
    numero_ot?: string | null;
    tipo_movimiento: 'Entrada' | 'Salida' | 'Ajuste';
    cantidad: number;
    signo: '+' | '-';
    costo_unitario: string;
    motivo?: string | null;
  }
) {
  return withTransaction(ctx, async (client) => {
    const idPersonal = input.id_personal ?? ctx.idPersonalG2;
    if (!idPersonal) {
      throw new DomainRuleError('Se requiere identificar el personal operativo responsable del movimiento.');
    }

    const res = await client.query<{ id_movimiento: string; saldo_posterior: string }>(
      `INSERT INTO g2_housekeeping.movimiento_insumo (
         id_insumo, id_personal, numero_ot, tipo_movimiento, cantidad, signo, costo_unitario, motivo
       ) VALUES ($1::bigint, $2::bigint, $3::bigint, $4, $5, $6, $7::numeric(12,2), $8)
       RETURNING id_movimiento::text AS id_movimiento, saldo_posterior::text AS saldo_posterior`,
      [
        input.id_insumo,
        idPersonal,
        input.numero_ot ?? null,
        input.tipo_movimiento,
        input.cantidad,
        input.signo,
        input.costo_unitario,
        input.motivo ?? null,
      ]
    );
    return res.rows[0];
  });
}
