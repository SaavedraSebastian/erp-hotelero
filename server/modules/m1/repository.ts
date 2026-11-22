import type { PoolClient } from 'pg';
import type { PaginationParams } from '../../shared/types/context.ts';

export interface HabitacionEstadoRow {
  id_habitacion: string;
  numero: string;
  piso: number;
  estado_registro: string;
  caracteristicas: unknown;
  id_tipo_habitacion: string;
  tipo_nombre: string;
  capacidad: number;
  estado_hk: string | null;
  estado_hk_nombre: string | null;
  permite_venta: boolean | null;
  color_tablero: string | null;
  estado_hk_fecha: string | null;
}

export interface HuespedRow {
  id_huesped: string;
  tipo_documento: string;
  numero_documento: string;
  nombres: string;
  apellidos: string;
  telefono: string | null;
  correo: string | null;
  nacionalidad: string | null;
  empresa: string | null;
  consentimiento_iso27701: boolean;
  fecha_consentimiento: string | null;
  marketing_opt_in: boolean;
  notas: string | null;
  fecha_registro: string;
  estado: string;
}

export async function listHabitaciones(
  client: PoolClient,
  params: PaginationParams
): Promise<{ rows: HabitacionEstadoRow[]; total: number }> {
  const values: unknown[] = [];
  const where: string[] = ["h.estado_registro = 'ACTIVA'"];

  if (params.search) {
    values.push(`%${params.search}%`);
    where.push(`(h.numero ILIKE $${values.length} OR th.nombre ILIKE $${values.length})`);
  }
  if (params.status) {
    values.push(params.status);
    where.push(`COALESCE(vea.id_estado, 'DIS') = $${values.length}`);
  }

  const whereClause = `WHERE ${where.join(' AND ')}`;
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM g1_reservas.habitacion h
     JOIN g1_reservas.tipo_habitacion th ON th.id_tipo_habitacion = h.id_tipo_habitacion
     LEFT JOIN g2_housekeeping.v_estado_actual vea ON vea.id_habitacion = h.id_habitacion
     ${whereClause}`,
    values
  );

  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  const dataRes = await client.query<HabitacionEstadoRow>(
    `SELECT
       h.id_habitacion::text AS id_habitacion,
       h.numero,
       h.piso,
       h.estado_registro,
       COALESCE(to_jsonb(th.caracteristicas), '[]'::jsonb) AS caracteristicas,
       th.id_tipo_habitacion::text AS id_tipo_habitacion,
       th.nombre AS tipo_nombre,
       th.capacidad,
       vea.id_estado AS estado_hk,
       eh.nombre AS estado_hk_nombre,
       eh.permite_venta,
       eh.color_tablero,
       vea.fecha_hora::text AS estado_hk_fecha
     FROM g1_reservas.habitacion h
     JOIN g1_reservas.tipo_habitacion th ON th.id_tipo_habitacion = h.id_tipo_habitacion
     LEFT JOIN g2_housekeeping.v_estado_actual vea ON vea.id_habitacion = h.id_habitacion
     LEFT JOIN g2_housekeeping.estado_habitacion eh ON eh.id_estado = vea.id_estado
     ${whereClause}
     ORDER BY h.piso ASC, h.numero ASC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return {
    rows: dataRes.rows,
    total: Number(countRes.rows[0]?.total ?? 0),
  };
}

export async function listHuespedes(
  client: PoolClient,
  params: PaginationParams
): Promise<{ rows: HuespedRow[]; total: number }> {
  const values: unknown[] = [];
  const where: string[] = [];

  if (params.search) {
    values.push(`%${params.search}%`);
    where.push(
      `(nombres ILIKE $${values.length} OR apellidos ILIKE $${values.length} OR numero_documento ILIKE $${values.length})`
    );
  }
  if (params.status) {
    values.push(params.status);
    where.push(`estado = $${values.length}`);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM g1_reservas.huesped ${whereClause}`,
    values
  );

  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  const dataRes = await client.query<HuespedRow>(
    `SELECT
       id_huesped::text AS id_huesped,
       tipo_documento,
       numero_documento,
       nombres,
       apellidos,
       telefono,
       correo,
       nacionalidad,
       empresa,
       consentimiento_iso27701,
       fecha_consentimiento::text AS fecha_consentimiento,
       marketing_opt_in,
       notas,
       fecha_registro::text AS fecha_registro,
       estado
     FROM g1_reservas.huesped
     ${whereClause}
     ORDER BY id_huesped DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return {
    rows: dataRes.rows,
    total: Number(countRes.rows[0]?.total ?? 0),
  };
}

export async function insertHuesped(
  client: PoolClient,
  input: {
    tipo_documento: string;
    numero_documento: string;
    nombres: string;
    apellidos: string;
    telefono: string | null;
    correo: string | null;
    nacionalidad: string | null;
    empresa: string | null;
    consentimiento_iso27701: boolean;
    fecha_consentimiento: string | null;
    marketing_opt_in: boolean;
    notas: string | null;
  }
): Promise<HuespedRow> {
  const res = await client.query<HuespedRow>(
    `INSERT INTO g1_reservas.huesped (
       tipo_documento, numero_documento, nombres, apellidos,
       telefono, correo, nacionalidad, empresa,
       consentimiento_iso27701, fecha_consentimiento, marketing_opt_in, notas
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11, $12)
     RETURNING
       id_huesped::text AS id_huesped, tipo_documento, numero_documento, nombres, apellidos,
       telefono, correo, nacionalidad, empresa, consentimiento_iso27701,
       fecha_consentimiento::text AS fecha_consentimiento, marketing_opt_in, notas,
       fecha_registro::text AS fecha_registro, estado`,
    [
      input.tipo_documento,
      input.numero_documento,
      input.nombres,
      input.apellidos,
      input.telefono,
      input.correo,
      input.nacionalidad,
      input.empresa,
      input.consentimiento_iso27701,
      input.fecha_consentimiento,
      input.marketing_opt_in,
      input.notas,
    ]
  );
  return res.rows[0];
}

export async function updateHuesped(
  client: PoolClient,
  idHuesped: string,
  input: {
    tipo_documento: string;
    numero_documento: string;
    nombres: string;
    apellidos: string;
    telefono: string | null;
    correo: string | null;
    nacionalidad: string | null;
    empresa: string | null;
    consentimiento_iso27701: boolean;
    fecha_consentimiento: string | null;
    marketing_opt_in: boolean;
    notas: string | null;
  }
): Promise<HuespedRow | null> {
  const res = await client.query<HuespedRow>(
    `UPDATE g1_reservas.huesped
     SET
       tipo_documento = $2,
       numero_documento = $3,
       nombres = $4,
       apellidos = $5,
       telefono = $6,
       correo = $7,
       nacionalidad = $8,
       empresa = $9,
       consentimiento_iso27701 = $10,
       fecha_consentimiento = $11::date,
       marketing_opt_in = $12,
       notas = $13
     WHERE id_huesped = $1::bigint
     RETURNING
       id_huesped::text AS id_huesped, tipo_documento, numero_documento, nombres, apellidos,
       telefono, correo, nacionalidad, empresa, consentimiento_iso27701,
       fecha_consentimiento::text AS fecha_consentimiento, marketing_opt_in, notas,
       fecha_registro::text AS fecha_registro, estado`,
    [
      idHuesped,
      input.tipo_documento,
      input.numero_documento,
      input.nombres,
      input.apellidos,
      input.telefono,
      input.correo,
      input.nacionalidad,
      input.empresa,
      input.consentimiento_iso27701,
      input.fecha_consentimiento,
      input.marketing_opt_in,
      input.notas,
    ]
  );
  return res.rows[0] ?? null;
}

export async function listTarifas(client: PoolClient) {
  const res = await client.query<{
    id_tarifa: string;
    nombre: string;
    precio_base: string;
    fecha_inicio: string;
    fecha_fin: string;
    estado: string;
    id_tipo_habitacion: string;
    tipo_habitacion: string;
    id_temporada: string;
    temporada: string;
    factor_ajuste: string;
    id_canal_reserva: string;
    canal: string;
  }>(
    `SELECT
       t.id_tarifa::text AS id_tarifa,
       t.nombre,
       t.precio_base::text AS precio_base,
       t.fecha_inicio::text AS fecha_inicio,
       t.fecha_fin::text AS fecha_fin,
       t.estado,
       th.id_tipo_habitacion::text AS id_tipo_habitacion,
       th.nombre AS tipo_habitacion,
       tmp.id_temporada::text AS id_temporada,
       tmp.nombre AS temporada,
       tmp.factor_ajuste::text AS factor_ajuste,
       c.id_canal_reserva::text AS id_canal_reserva,
       c.nombre AS canal
     FROM g1_reservas.tarifa t
     JOIN g1_reservas.tipo_habitacion th ON th.id_tipo_habitacion = t.id_tipo_habitacion
     JOIN g1_reservas.temporada tmp ON tmp.id_temporada = t.id_temporada
     JOIN g1_reservas.canal_reserva c ON c.id_canal_reserva = t.id_canal_reserva
     ORDER BY t.id_tarifa DESC`
  );
  return res.rows;
}

export async function listReservas(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];

  if (params.status) {
    values.push(params.status);
    where.push(`r.estado = $${values.length}`);
  }
  if (params.fromDate) {
    values.push(params.fromDate);
    where.push(`r.fecha_ingreso >= $${values.length}::date`);
  }
  if (params.toDate) {
    values.push(params.toDate);
    where.push(`r.fecha_salida <= $${values.length}::date`);
  }
  if (params.search) {
    values.push(`%${params.search}%`);
    where.push(`(h.nombres ILIKE $${values.length} OR h.apellidos ILIKE $${values.length} OR r.id_reserva::text ILIKE $${values.length})`);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM g1_reservas.reserva r
     JOIN g1_reservas.huesped h ON h.id_huesped = r.id_huesped
     ${whereClause}`,
    values
  );

  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  const dataRes = await client.query<{
    id_reserva: string;
    id_huesped: string;
    huesped_nombres: string;
    huesped_apellidos: string;
    canal: string;
    tarifa_nombre: string;
    fecha_reserva: string;
    fecha_ingreso: string;
    fecha_salida: string;
    cantidad_huespedes: number;
    estado: string;
    observaciones: string | null;
    detalles: unknown;
  }>(
    `SELECT
       r.id_reserva::text AS id_reserva,
       r.id_huesped::text AS id_huesped,
       h.nombres AS huesped_nombres,
       h.apellidos AS huesped_apellidos,
       c.nombre AS canal,
       t.nombre AS tarifa_nombre,
       r.fecha_reserva::text AS fecha_reserva,
       r.fecha_ingreso::text AS fecha_ingreso,
       r.fecha_salida::text AS fecha_salida,
       r.cantidad_huespedes,
       r.estado,
       r.observaciones,
       COALESCE(
         (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id_detalle_reserva', dr.id_detalle_reserva::text,
               'id_habitacion', dr.id_habitacion::text,
               'numero_habitacion', hab.numero,
               'precio_noche', dr.precio_noche::text,
               'cantidad_huespedes', dr.cantidad_huespedes,
               'id_estadia', (SELECT e.id_estadia::text FROM g1_reservas.estadia e WHERE e.id_detalle_reserva = dr.id_detalle_reserva),
               'estado_estadia', (SELECT e.estado FROM g1_reservas.estadia e WHERE e.id_detalle_reserva = dr.id_detalle_reserva)
             )
           )
           FROM g1_reservas.detalle_reserva dr
           JOIN g1_reservas.habitacion hab ON hab.id_habitacion = dr.id_habitacion
           WHERE dr.id_reserva = r.id_reserva
         ),
         '[]'::jsonb
       ) AS detalles
     FROM g1_reservas.reserva r
     JOIN g1_reservas.huesped h ON h.id_huesped = r.id_huesped
     JOIN g1_reservas.canal_reserva c ON c.id_canal_reserva = r.id_canal_reserva
     JOIN g1_reservas.tarifa t ON t.id_tarifa = r.id_tarifa
     ${whereClause}
     ORDER BY r.fecha_reserva DESC, r.id_reserva DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return {
    rows: dataRes.rows,
    total: Number(countRes.rows[0]?.total ?? 0),
  };
}

export async function listListaEspera(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  if (params.status) {
    values.push(params.status);
    where.push(`le.estado = $${values.length}`);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM g1_reservas.lista_espera le ${whereClause}`,
    values
  );
  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  const dataRes = await client.query<{
    id_lista_espera: string;
    id_huesped: string;
    huesped_nombre: string;
    id_tipo_habitacion: string;
    tipo_habitacion: string;
    fecha_ingreso: string;
    fecha_salida: string;
    fecha_registro: string;
    prioridad: number;
    estado: string;
  }>(
    `SELECT
       le.id_lista_espera::text AS id_lista_espera,
       le.id_huesped::text AS id_huesped,
       (h.nombres || ' ' || h.apellidos) AS huesped_nombre,
       le.id_tipo_habitacion::text AS id_tipo_habitacion,
       th.nombre AS tipo_habitacion,
       le.fecha_ingreso::text AS fecha_ingreso,
       le.fecha_salida::text AS fecha_salida,
       le.fecha_registro::text AS fecha_registro,
       le.prioridad,
       le.estado
     FROM g1_reservas.lista_espera le
     JOIN g1_reservas.huesped h ON h.id_huesped = le.id_huesped
     JOIN g1_reservas.tipo_habitacion th ON th.id_tipo_habitacion = le.id_tipo_habitacion
     ${whereClause}
     ORDER BY le.prioridad DESC, le.fecha_registro ASC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return {
    rows: dataRes.rows,
    total: Number(countRes.rows[0]?.total ?? 0),
  };
}
