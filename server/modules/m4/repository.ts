import type { PoolClient } from 'pg';
import type { PaginationParams } from '../../shared/types/context.ts';
import { pushDateRange, pushSearchFilter, pushStatusFilter } from '../../shared/pagination/index.ts';

export async function listCuentas(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  pushStatusFilter(values, where, 'c.estado', params.status);
  pushSearchFilter(values, where, ['h.nombres', 'h.apellidos', "(h.nombres || ' ' || h.apellidos)", 'hab.numero'], params.search);
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
     ORDER BY c.fecha_apertura DESC, c.id_cuenta DESC
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
  pushStatusFilter(values, where, 'estado', params.status);
  pushDateRange(values, where, 'fecha_emision', params.fromDate, params.toDate);
  pushSearchFilter(values, where, ["(serie || '-' || correlativo::text)", 'razon_social_cliente', 'numero_documento_cliente', 'tipo'], params.search);
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
       hash_cpe
     FROM g4_finanzas.comprobante
     ${whereClause}
     ORDER BY fecha_emision DESC, id_comprobante DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { rows: res.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function listTurnosCaja(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  pushStatusFilter(values, where, 't.estado', params.status);
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM g4_finanzas.turno_caja t ${whereClause}`,
    values
  );
  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  // saldo_calculado = saldo vigente del turno con el mismo criterio del cierre:
  // saldo inicial + cobros en efectivo + movimientos manuales (ingresos - egresos).
  const res = await client.query(
    `SELECT
       t.id_turno_caja, t.id_usuario, t.id_usuario_autoriza, t.turno,
       t.saldo_inicial::text AS saldo_inicial,
       t.saldo_esperado::text AS saldo_esperado,
       t.saldo_final::text AS saldo_final,
       t.diferencia::text AS diferencia,
       t.justificacion_diferencia, t.motivo_excepcion,
       t.fecha_apertura::text AS fecha_apertura,
       t.fecha_cierre::text AS fecha_cierre,
       t.estado,
       cf.cobros_efectivo::text AS cobros_efectivo,
       mv.ingresos::text AS ingresos_manuales,
       mv.egresos::text AS egresos_manuales,
       (t.saldo_inicial + cf.cobros_efectivo + mv.ingresos - mv.egresos)::text AS saldo_calculado
     FROM g4_finanzas.turno_caja t
     CROSS JOIN LATERAL (
       SELECT COALESCE(SUM(c.monto), 0) AS cobros_efectivo
       FROM g4_finanzas.cobro c
       WHERE c.id_turno_caja = t.id_turno_caja AND c.estado = 'REGISTRADO' AND c.medio_pago = 'EFECTIVO'
     ) cf
     CROSS JOIN LATERAL (
       SELECT COALESCE(SUM(m.importe) FILTER (WHERE m.tipo = 'INGRESO'), 0) AS ingresos,
              COALESCE(SUM(m.importe) FILTER (WHERE m.tipo = 'EGRESO'), 0) AS egresos
       FROM g4_finanzas.movimiento_caja m WHERE m.id_turno_caja = t.id_turno_caja
     ) mv
     ${whereClause}
     ORDER BY t.fecha_apertura DESC, t.id_turno_caja DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { rows: res.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function listGastos(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  pushStatusFilter(values, where, 'g.estado', params.status);
  pushDateRange(values, where, 'g.fecha', params.fromDate, params.toDate);
  pushSearchFilter(values, where, ['g.concepto', 'g.proveedor', 'g.categoria', 'cc.nombre'], params.search);
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM g4_finanzas.gasto g
     JOIN g4_finanzas.centro_costo cc ON cc.id_centro_costo = g.id_centro_costo
     ${whereClause}`,
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
     ORDER BY g.fecha DESC, g.id_gasto DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { rows: res.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function listCuentasPorCobrar(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  pushStatusFilter(values, where, 'cxc.estado', params.status);
  pushSearchFilter(values, where, ['cxc.razon_social_cliente', "(cb.serie || '-' || cb.correlativo::text)", 'cb.numero_documento_cliente'], params.search);
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM g4_finanzas.cuenta_por_cobrar cxc
     LEFT JOIN g4_finanzas.comprobante cb ON cb.id_comprobante = cxc.id_comprobante
     ${whereClause}`,
    values
  );
  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  // El comprobante aporta la referencia y el documento del cliente; la cuenta, el huésped.
  const res = await client.query(
    `SELECT
       cxc.id_cuenta_por_cobrar AS id_cxc, cxc.id_cuenta, cxc.id_comprobante,
       cu.id_huesped::text AS id_huesped,
       CASE WHEN cb.id_comprobante IS NOT NULL THEN cb.serie || '-' || cb.correlativo::text END AS referencia_documento,
       cxc.razon_social_cliente, cb.numero_documento_cliente,
       cxc.fecha_emision::text AS fecha_emision, cxc.fecha_vencimiento::text AS fecha_vencimiento,
       cxc.monto_original::text AS monto_original, cxc.monto_pagado::text AS monto_pagado,
       cxc.saldo_pendiente::text AS saldo_pendiente, cxc.estado, cxc.nota_seguimiento
     FROM g4_finanzas.cuenta_por_cobrar cxc
     LEFT JOIN g4_finanzas.comprobante cb ON cb.id_comprobante = cxc.id_comprobante
     LEFT JOIN g4_finanzas.cuenta cu ON cu.id_cuenta = cxc.id_cuenta
     ${whereClause}
     ORDER BY cxc.fecha_vencimiento ASC, cxc.id_cuenta_por_cobrar ASC
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
