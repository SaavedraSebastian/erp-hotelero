import type { PoolClient } from 'pg';
import type { PaginationParams } from '../../shared/types/context.ts';

export async function listCuentas(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  if (params.status) {
    values.push(params.status);
    where.push(`c.estado = $${values.length}`);
  }
  if (params.search) {
    values.push(`%${params.search}%`);
    where.push(`(h.nombres ILIKE $${values.length} OR h.apellidos ILIKE $${values.length} OR hab.numero ILIKE $${values.length})`);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM g4_finanzas.cuenta c
     JOIN g1_reservas.huesped h ON h.id_huesped = c.id_huesped
     LEFT JOIN g1_reservas.habitacion hab ON hab.id_habitacion = c.id_habitacion
     ${whereClause}`,
    values
  );

  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  const dataRes = await client.query(
    `SELECT
       c.id_cuenta,
       c.id_huesped::text AS id_huesped,
       (h.nombres || ' ' || h.apellidos) AS huesped_nombre,
       c.id_reserva::text AS id_reserva,
       c.id_habitacion::text AS id_habitacion,
       hab.numero AS numero_habitacion,
       c.saldo_pendiente::text AS saldo_pendiente,
       c.estado,
       c.fecha_apertura::text AS fecha_apertura,
       c.fecha_cierre::text AS fecha_cierre
     FROM g4_finanzas.cuenta c
     JOIN g1_reservas.huesped h ON h.id_huesped = c.id_huesped
     LEFT JOIN g1_reservas.habitacion hab ON hab.id_habitacion = c.id_habitacion
     ${whereClause}
     ORDER BY c.fecha_apertura DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { rows: dataRes.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function getCuentaDetalle(client: PoolClient, idCuenta: string) {
  const cuentaRes = await client.query(
    `SELECT
       c.id_cuenta,
       c.id_huesped::text AS id_huesped,
       (h.nombres || ' ' || h.apellidos) AS huesped_nombre,
       c.id_reserva::text AS id_reserva,
       c.id_habitacion::text AS id_habitacion,
       hab.numero AS numero_habitacion,
       c.saldo_pendiente::text AS saldo_pendiente,
       c.estado,
       c.fecha_apertura::text AS fecha_apertura,
       c.fecha_cierre::text AS fecha_cierre
     FROM g4_finanzas.cuenta c
     JOIN g1_reservas.huesped h ON h.id_huesped = c.id_huesped
     LEFT JOIN g1_reservas.habitacion hab ON hab.id_habitacion = c.id_habitacion
     WHERE c.id_cuenta = $1`,
    [idCuenta]
  );
  if (!cuentaRes.rows[0]) return null;

  const consumosRes = await client.query(
    `SELECT
       id_consumo, id_cuenta, id_usuario, id_centro_costo,
       numero_consumo_origen, concepto, importe::text AS importe,
       fecha::text AS fecha, area, estado
     FROM g4_finanzas.consumo
     WHERE id_cuenta = $1
     ORDER BY fecha DESC`,
    [idCuenta]
  );

  const cobrosRes = await client.query(
    `SELECT
       id_cobro, id_cuenta, id_turno_caja, id_usuario, id_comprobante,
       monto::text AS monto, medio_pago, fecha_hora::text AS fecha_hora, estado
     FROM g4_finanzas.cobro
     WHERE id_cuenta = $1
     ORDER BY fecha_hora DESC`,
    [idCuenta]
  );

  return {
    ...cuentaRes.rows[0],
    consumos: consumosRes.rows,
    cobros: cobrosRes.rows,
  };
}

export async function listComprobantes(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  if (params.status) {
    values.push(params.status);
    where.push(`estado = $${values.length}`);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM g4_finanzas.comprobante ${whereClause}`,
    values
  );
  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  const res = await client.query(
    `SELECT
       id_comprobante, id_cuenta, id_usuario, id_comprobante_ref,
       tipo, serie, correlativo, tipo_documento_cliente, numero_documento_cliente,
       razon_social_cliente, direccion_cliente,
       operacion_gravada::text AS operacion_gravada,
       igv::text AS igv,
       total::text AS total,
       estado, mensaje_rechazo, motivo_nota,
       fecha_emision::text AS fecha_emision,
       hash_cpe, cdr_estado, fecha_envio_sunat::text AS fecha_envio_sunat
     FROM g4_finanzas.comprobante
     ${whereClause}
     ORDER BY fecha_emision DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { rows: res.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function listTurnosCaja(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  if (params.status) {
    values.push(params.status);
    where.push(`estado = $${values.length}`);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM g4_finanzas.turno_caja ${whereClause}`,
    values
  );
  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  const res = await client.query(
    `SELECT
       id_turno_caja, id_usuario, id_usuario_autoriza, turno,
       saldo_inicial::text AS saldo_inicial,
       saldo_esperado::text AS saldo_esperado,
       saldo_final::text AS saldo_final,
       diferencia::text AS diferencia,
       justificacion_diferencia, motivo_excepcion,
       fecha_apertura::text AS fecha_apertura,
       fecha_cierre::text AS fecha_cierre,
       estado
     FROM g4_finanzas.turno_caja
     ${whereClause}
     ORDER BY fecha_apertura DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { rows: res.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function listGastos(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  if (params.status) {
    values.push(params.status);
    where.push(`g.estado = $${values.length}`);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM g4_finanzas.gasto g ${whereClause}`,
    values
  );
  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  const res = await client.query(
    `SELECT
       g.id_gasto, g.id_usuario, g.id_usuario_aprobador, g.id_centro_costo,
       cc.nombre AS centro_costo,
       g.categoria, g.proveedor, g.concepto, g.monto::text AS monto,
       g.fecha::text AS fecha, g.comprobante_sustento, g.estado,
       g.fecha_aprobacion::text AS fecha_aprobacion
     FROM g4_finanzas.gasto g
     JOIN g4_finanzas.centro_costo cc ON cc.id_centro_costo = g.id_centro_costo
     ${whereClause}
     ORDER BY g.fecha DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { rows: res.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function listCuentasPorCobrar(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  if (params.status) {
    values.push(params.status);
    where.push(`estado = $${values.length}`);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM g4_finanzas.cuenta_por_cobrar ${whereClause}`,
    values
  );
  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  const res = await client.query(
    `SELECT
       id_cxc, id_cuenta, id_comprobante, id_huesped::text AS id_huesped,
       referencia_documento, razon_social_cliente, numero_documento_cliente,
       fecha_emision::text AS fecha_emision, fecha_vencimiento::text AS fecha_vencimiento,
       monto_original::text AS monto_original, monto_pagado::text AS monto_pagado,
       saldo_pendiente::text AS saldo_pendiente, estado, nota_seguimiento
     FROM g4_finanzas.cuenta_por_cobrar
     ${whereClause}
     ORDER BY fecha_vencimiento ASC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { rows: res.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function listAlertasFinancieras(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  if (params.status) {
    values.push(params.status);
    where.push(`clasificacion = $${values.length}`);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM g4_finanzas.alerta_financiera ${whereClause}`,
    values
  );
  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  const res = await client.query(
    `SELECT
       id_alerta, id_usuario, id_usuario_revisor, id_cuenta, id_cobro, id_turno_caja,
       tipo_operacion, monto::text AS monto, puntaje_anomalia::text AS puntaje_anomalia,
       severidad, clasificacion, justificacion,
       fecha_hora::text AS fecha_hora, fecha_revision::text AS fecha_revision
     FROM g4_finanzas.alerta_financiera
     ${whereClause}
     ORDER BY fecha_hora DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { rows: res.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}
