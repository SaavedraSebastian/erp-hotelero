import type { PoolClient } from 'pg';
import type { PaginationParams } from '../../shared/types/context.ts';

export async function listEstadosHabitacion(client: PoolClient) {
  const roomsRes = await client.query<{
    id_habitacion: string;
    numero: string;
    piso: number;
    id_estado: string;
    estado_nombre: string;
    permite_venta: boolean;
    color_tablero: string;
    fecha_hora: string | null;
  }>(
    `SELECT
       h.id_habitacion::text AS id_habitacion,
       h.numero,
       h.piso,
       COALESCE(vea.id_estado, 'DIS') AS id_estado,
       COALESCE(eh.nombre, 'Disponible') AS estado_nombre,
       COALESCE(eh.permite_venta, true) AS permite_venta,
       COALESCE(eh.color_tablero, '#DCFCE7') AS color_tablero,
       vea.fecha_hora::text AS fecha_hora
     FROM g1_reservas.habitacion h
     LEFT JOIN g2_housekeeping.v_estado_actual vea ON vea.id_habitacion = h.id_habitacion
     LEFT JOIN g2_housekeeping.estado_habitacion eh ON eh.id_estado = COALESCE(vea.id_estado, 'DIS')
     WHERE h.estado_registro = 'ACTIVA'
     ORDER BY h.piso ASC, h.numero ASC`
  );

  const transRes = await client.query<{
    id_estado_origen: string;
    id_estado_destino: string;
    requiere_motivo: boolean;
  }>(
    `SELECT id_estado_origen, id_estado_destino, requiere_motivo
     FROM g2_housekeeping.transicion_permitida`
  );

  return {
    habitaciones: roomsRes.rows,
    transiciones: transRes.rows,
  };
}

export async function listOrdenesLimpieza(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  if (params.status) {
    values.push(params.status);
    where.push(`ol.estado = $${values.length}`);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM g2_housekeeping.orden_limpieza ol ${whereClause}`,
    values
  );

  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  const res = await client.query<{
    numero_orden: string;
    id_habitacion: string;
    numero_habitacion: string;
    id_turno: string;
    fecha_programada: string;
    tipo_limpieza: string;
    origen: string;
    prioridad: string;
    estado: string;
    observaciones: string | null;
    id_personal_asignado: string | null;
    personal_asignado: string | null;
    fecha_hora_creacion: string;
    fecha_hora_inicio: string | null;
    fecha_hora_fin: string | null;
  }>(
    `SELECT
       ol.numero_orden::text AS numero_orden,
       ol.id_habitacion::text AS id_habitacion,
       h.numero AS numero_habitacion,
       ol.id_turno,
       ol.fecha_programada::text AS fecha_programada,
       ol.tipo_limpieza,
       ol.origen,
       ol.prioridad,
       ol.estado,
       ol.observaciones,
       al.id_personal::text AS id_personal_asignado,
       (po.nombres || ' ' || po.apellidos) AS personal_asignado,
       ol.fecha_hora_creacion::text AS fecha_hora_creacion,
       ol.fecha_hora_inicio::text AS fecha_hora_inicio,
       ol.fecha_hora_fin::text AS fecha_hora_fin
     FROM g2_housekeeping.orden_limpieza ol
     JOIN g1_reservas.habitacion h ON h.id_habitacion = ol.id_habitacion
     LEFT JOIN g2_housekeeping.asignacion_limpieza al
       ON al.numero_orden = ol.numero_orden AND al.vigente = TRUE
     LEFT JOIN g2_housekeeping.personal_operativo po ON po.id_personal = al.id_personal
     ${whereClause}
     ORDER BY ol.fecha_hora_creacion DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return {
    rows: res.rows,
    total: Number(countRes.rows[0]?.total ?? 0),
  };
}

export async function listIncidencias(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  if (params.status) {
    values.push(params.status);
    where.push(`i.estado = $${values.length}`);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM g2_housekeeping.incidencia i ${whereClause}`,
    values
  );
  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  const res = await client.query(
    `SELECT
       i.numero_incidencia::text AS numero_incidencia,
       i.id_habitacion::text AS id_habitacion,
       h.numero AS numero_habitacion,
       i.id_activo::text AS id_activo,
       a.nombre AS activo_nombre,
       i.id_reclamo::text AS id_reclamo,
       i.descripcion,
       i.criticidad,
       i.origen,
       i.estado,
       i.fecha_hora_registro::text AS fecha_hora_registro,
       i.fecha_hora_cierre::text AS fecha_hora_cierre
     FROM g2_housekeeping.incidencia i
     LEFT JOIN g1_reservas.habitacion h ON h.id_habitacion = i.id_habitacion
     LEFT JOIN g2_housekeeping.activo a ON a.id_activo = i.id_activo
     ${whereClause}
     ORDER BY i.fecha_hora_registro DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return {
    rows: res.rows,
    total: Number(countRes.rows[0]?.total ?? 0),
  };
}

export async function listOrdenesTrabajo(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  if (params.status) {
    values.push(params.status);
    where.push(`ot.estado = $${values.length}`);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM g2_housekeeping.orden_trabajo ot ${whereClause}`,
    values
  );
  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  const res = await client.query(
    `SELECT
       ot.numero_ot::text AS numero_ot,
       ot.id_activo::text AS id_activo,
       a.nombre AS activo_nombre,
       ot.id_tecnico::text AS id_tecnico,
       (po.nombres || ' ' || po.apellidos) AS tecnico_nombre,
       ot.id_centro_costo::text AS id_centro_costo,
       ot.tipo_ot,
       ot.descripcion_tarea,
       ot.prioridad,
       ot.estado,
       ot.motivo_espera,
       ot.trabajo_realizado,
       ot.horas_trabajadas::text AS horas_trabajadas,
       ot.costo_total::text AS costo_total,
       ot.fecha_hora_creacion::text AS fecha_hora_creacion,
       ot.fecha_hora_inicio::text AS fecha_hora_inicio,
       ot.fecha_hora_cierre::text AS fecha_hora_cierre
     FROM g2_housekeeping.orden_trabajo ot
     LEFT JOIN g2_housekeeping.activo a ON a.id_activo = ot.id_activo
     LEFT JOIN g2_housekeeping.personal_operativo po ON po.id_personal = ot.id_tecnico
     ${whereClause}
     ORDER BY ot.fecha_hora_creacion DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return {
    rows: res.rows,
    total: Number(countRes.rows[0]?.total ?? 0),
  };
}

export async function listInsumos(client: PoolClient) {
  const res = await client.query(
    `SELECT
       id_insumo::text AS id_insumo,
       codigo_insumo,
       id_articulo,
       nombre,
       tipo_insumo,
       unidad_medida,
       stock_actual::text AS stock_actual,
       punto_reposicion::text AS punto_reposicion,
       costo_unitario::text AS costo_unitario,
       estado
     FROM g2_housekeeping.insumo
     ORDER BY nombre ASC`
  );
  return res.rows;
}
