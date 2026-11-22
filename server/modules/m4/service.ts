import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { withReadOnlyClient, withTransaction } from '../../shared/database/transaction.ts';
import { DomainRuleError, NotFoundError } from '../../shared/errors/app-error.ts';
import { buildPaginatedResponse } from '../../shared/pagination/index.ts';
import { maskDocument } from '../../shared/privacy/masking.ts';
import type { AuthContext, PaginationParams } from '../../shared/types/context.ts';
import * as repo from './repository.ts';

function requireG4UserId(ctx: AuthContext): number {
  if (!ctx.idUsuarioG4) {
    throw new DomainRuleError(
      'Tu usuario del sistema no tiene asignado un identificador operativo en Finanzas (id_usuario_g4).'
    );
  }
  return ctx.idUsuarioG4;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildUblXml(params: {
  tipo: string;
  serie: string;
  correlativo: number;
  fechaEmision: string;
  tipoDocCliente: string;
  numDocCliente: string;
  razonSocial: string;
  gravada: string;
  igv: string;
  total: string;
}): { xml: string; hashCpe: string } {
  const docCode = params.tipo === 'FACTURA' ? '01' : params.tipo === 'BOLETA' ? '03' : '07';
  const idFormatted = `${params.serie}-${String(params.correlativo).padStart(8, '0')}`;
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">',
    `  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>`,
    `  <cbc:ID>${escapeXml(idFormatted)}</cbc:ID>`,
    `  <cbc:IssueDate>${escapeXml(params.fechaEmision.slice(0, 10))}</cbc:IssueDate>`,
    `  <cbc:InvoiceTypeCode>${docCode}</cbc:InvoiceTypeCode>`,
    `  <cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>`,
    `  <cac:AccountingSupplierParty><cbc:RegistrationName>Hotel Boulevard</cbc:RegistrationName></cac:AccountingSupplierParty>`,
    `  <cac:AccountingCustomerParty>`,
    `    <cbc:AdditionalAccountID>${escapeXml(params.tipoDocCliente)}</cbc:AdditionalAccountID>`,
    `    <cbc:ID>${escapeXml(params.numDocCliente)}</cbc:ID>`,
    `    <cbc:RegistrationName>${escapeXml(params.razonSocial)}</cbc:RegistrationName>`,
    `  </cac:AccountingCustomerParty>`,
    `  <cac:TaxTotal><cbc:TaxAmount currencyID="PEN">${params.igv}</cbc:TaxAmount></cac:TaxTotal>`,
    `  <cac:LegalMonetaryTotal>`,
    `    <cbc:TaxExclusiveAmount currencyID="PEN">${params.gravada}</cbc:TaxExclusiveAmount>`,
    `    <cbc:PayableAmount currencyID="PEN">${params.total}</cbc:PayableAmount>`,
    `  </cac:LegalMonetaryTotal>`,
    '</Invoice>',
  ].join('\n');

  const hashCpe = crypto.createHash('sha256').update(xml).digest('hex');
  return { xml, hashCpe };
}

export async function getCuentasService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listCuentas(client, params), ctx);
  return buildPaginatedResponse(rows, total, params.page, params.pageSize);
}

export async function getCuentaDetalleService(ctx: AuthContext, idCuenta: string) {
  const detail = await withReadOnlyClient((client) => repo.getCuentaDetalle(client, idCuenta), ctx);
  if (!detail) throw new NotFoundError('Cuenta no encontrada.');
  return { data: detail };
}

export async function agregarConsumoCuentaService(
  ctx: AuthContext,
  idCuenta: string,
  input: {
    id_centro_costo?: number | null;
    numero_consumo_origen?: string | null;
    concepto: string;
    importe: string;
    area: string;
  }
) {
  const idUsuario = requireG4UserId(ctx);
  return withTransaction(ctx, async (client) => {
    const cuentaRes = await client.query<{ estado: string }>(
      `SELECT estado FROM g4_finanzas.cuenta WHERE id_cuenta = $1 FOR UPDATE`,
      [idCuenta]
    );
    const cuenta = cuentaRes.rows[0];
    if (!cuenta) throw new NotFoundError('Cuenta no encontrada.');
    if (cuenta.estado !== 'ACTIVA') throw new DomainRuleError('La cuenta está cerrada.');

    const consRes = await client.query<{ id_consumo: string }>(
      `INSERT INTO g4_finanzas.consumo (
         id_cuenta, id_usuario, id_centro_costo, numero_consumo_origen, concepto, importe, area
       ) VALUES ($1, $2, $3, $4, $5, $6::numeric(12,2), $7)
       RETURNING id_consumo`,
      [
        idCuenta,
        idUsuario,
        input.id_centro_costo ?? null,
        input.numero_consumo_origen ?? null,
        input.concepto,
        input.importe,
        input.area,
      ]
    );

    await client.query(
      `UPDATE g4_finanzas.cuenta
       SET saldo_pendiente = saldo_pendiente + $2::numeric(12,2)
       WHERE id_cuenta = $1`,
      [idCuenta, input.importe]
    );

    await client.query(
      `INSERT INTO g4_finanzas.historial_cuenta (
         id_cuenta, id_usuario, tipo_movimiento, importe, detalle
       ) VALUES ($1, $2, 'CONSUMO', $3::numeric(12,2), $4::jsonb)`,
      [idCuenta, idUsuario, input.importe, JSON.stringify({ concepto: input.concepto, area: input.area })]
    );

    return { id_consumo: consRes.rows[0].id_consumo, id_cuenta: idCuenta, importe: input.importe };
  });
}

export async function transferirConsumosService(
  ctx: AuthContext,
  input: {
    id_cuenta_origen: string;
    id_cuenta_destino: string;
    motivo: string;
    ids_consumo: string[];
  }
) {
  const idUsuario = requireG4UserId(ctx);
  return withTransaction(ctx, async (client) => {
    const cuentasRes = await client.query<{ id_cuenta: string; estado: string }>(
      `SELECT id_cuenta, estado FROM g4_finanzas.cuenta
       WHERE id_cuenta IN ($1, $2) ORDER BY id_cuenta FOR UPDATE`,
      [input.id_cuenta_origen, input.id_cuenta_destino]
    );
    const origen = cuentasRes.rows.find((c) => c.id_cuenta === input.id_cuenta_origen);
    const destino = cuentasRes.rows.find((c) => c.id_cuenta === input.id_cuenta_destino);
    if (!origen || !destino) throw new NotFoundError('Cuenta origen o destino no encontrada.');
    if (origen.estado !== 'ACTIVA' || destino.estado !== 'ACTIVA') {
      throw new DomainRuleError('Ambas cuentas deben estar ACTIVAS para transferir consumos.');
    }

    const consRes = await client.query<{ id_consumo: string; importe: string; estado: string }>(
      `SELECT id_consumo, importe::text AS importe, estado
       FROM g4_finanzas.consumo
       WHERE id_consumo = ANY($1::varchar[]) AND id_cuenta = $2 AND estado = 'VIGENTE'
       FOR UPDATE`,
      [input.ids_consumo, input.id_cuenta_origen]
    );
    if (consRes.rows.length !== input.ids_consumo.length) {
      throw new DomainRuleError('Uno o más consumos no pertenecen a la cuenta origen o no están vigentes.');
    }

    const transfRes = await client.query<{ id_transferencia: string }>(
      `INSERT INTO g4_finanzas.transferencia_consumo (
         id_cuenta_origen, id_cuenta_destino, id_usuario, motivo
       ) VALUES ($1, $2, $3, $4)
       RETURNING id_transferencia`,
      [input.id_cuenta_origen, input.id_cuenta_destino, idUsuario, input.motivo]
    );
    const idTransferencia = transfRes.rows[0].id_transferencia;

    let montoTotal = 0;
    for (const c of consRes.rows) {
      montoTotal += Number(c.importe);
      await client.query(
        `INSERT INTO g4_finanzas.detalle_transferencia (id_transferencia, id_consumo, importe)
         VALUES ($1, $2, $3::numeric(12,2))`,
        [idTransferencia, c.id_consumo, c.importe]
      );
      await client.query(
        `UPDATE g4_finanzas.consumo SET id_cuenta = $2 WHERE id_consumo = $1`,
        [c.id_consumo, input.id_cuenta_destino]
      );
    }

    const totalStr = montoTotal.toFixed(2);
    await client.query(
      `UPDATE g4_finanzas.cuenta SET saldo_pendiente = GREATEST(0, saldo_pendiente - $2::numeric(12,2)) WHERE id_cuenta = $1`,
      [input.id_cuenta_origen, totalStr]
    );
    await client.query(
      `UPDATE g4_finanzas.cuenta SET saldo_pendiente = saldo_pendiente + $2::numeric(12,2) WHERE id_cuenta = $1`,
      [input.id_cuenta_destino, totalStr]
    );

    await client.query(
      `INSERT INTO g4_finanzas.historial_cuenta (id_cuenta, id_usuario, tipo_movimiento, importe, motivo)
       VALUES ($1, $2, 'TRANSFERENCIA', $3::numeric(12,2), $4), ($5, $2, 'TRANSFERENCIA', $3::numeric(12,2), $4)`,
      [input.id_cuenta_origen, idUsuario, totalStr, input.motivo, input.id_cuenta_destino]
    );

    return { id_transferencia: idTransferencia, total_transferido: totalStr };
  });
}

export async function getComprobantesService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listComprobantes(client, params), ctx);
  const masked = rows.map((row) => ({
    ...row,
    numero_documento_cliente: maskDocument(String(row.numero_documento_cliente ?? ''), ctx.canViewFullPII),
  }));
  return buildPaginatedResponse(masked, total, params.page, params.pageSize);
}

export async function emitirComprobanteService(
  ctx: AuthContext,
  input: {
    id_cuenta: string;
    tipo: 'BOLETA' | 'FACTURA' | 'NOTA_CREDITO';
    serie: string;
    tipo_documento_cliente: 'DNI' | 'RUC' | 'CE' | 'PAS';
    numero_documento_cliente: string;
    razon_social_cliente: string;
    direccion_cliente?: string | null;
    operacion_gravada: string;
    id_comprobante_ref?: string | null;
    motivo_nota?: string | null;
  },
  externalClient?: PoolClient
) {
  const idUsuario = requireG4UserId(ctx);
  const run = async (client: PoolClient) => {
    const corrRes = await client.query<{ next_corr: number }>(
      `SELECT COALESCE(MAX(correlativo), 0) + 1 AS next_corr
       FROM g4_finanzas.comprobante
       WHERE tipo = $1 AND serie = $2`,
      [input.tipo, input.serie]
    );
    const correlativo = corrRes.rows[0].next_corr;
    const gravadaNum = Number(input.operacion_gravada);
    const igvNum = Number((gravadaNum * 0.18).toFixed(2));
    const totalNum = Number((gravadaNum + igvNum).toFixed(2));
    const gravadaStr = gravadaNum.toFixed(2);
    const igvStr = igvNum.toFixed(2);
    const totalStr = totalNum.toFixed(2);
    const todayIso = new Date().toISOString();

    const { xml, hashCpe } = buildUblXml({
      tipo: input.tipo,
      serie: input.serie,
      correlativo,
      fechaEmision: todayIso,
      tipoDocCliente: input.tipo_documento_cliente,
      numDocCliente: input.numero_documento_cliente,
      razonSocial: input.razon_social_cliente,
      gravada: gravadaStr,
      igv: igvStr,
      total: totalStr,
    });

    const insertRes = await client.query<{
      id_comprobante: string;
      tipo: string;
      serie: string;
      correlativo: number;
      estado: string;
      hash_cpe: string;
    }>(
      `INSERT INTO g4_finanzas.comprobante (
         id_cuenta, id_usuario, id_comprobante_ref, tipo, serie, correlativo,
         tipo_documento_cliente, numero_documento_cliente, razon_social_cliente, direccion_cliente,
         operacion_gravada, igv, total, estado, motivo_nota, xml_ubl, hash_cpe
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10,
         $11::numeric(12,2), $12::numeric(12,2), $13::numeric(12,2), 'FIRMADO', $14, $15, $16
       )
       RETURNING id_comprobante, tipo, serie, correlativo, estado, hash_cpe`,
      [
        input.id_cuenta,
        idUsuario,
        input.id_comprobante_ref ?? null,
        input.tipo,
        input.serie,
        correlativo,
        input.tipo_documento_cliente,
        input.numero_documento_cliente,
        input.razon_social_cliente,
        input.direccion_cliente ?? null,
        gravadaStr,
        igvStr,
        totalStr,
        input.motivo_nota ?? null,
        xml,
        hashCpe,
      ]
    );

    return insertRes.rows[0];
  };
  // Con `externalClient` se ejecuta dentro de la transacción del llamador (p. ej. anulación con nota de crédito).
  return externalClient ? run(externalClient) : withTransaction(ctx, run);
}

export async function getTurnosCajaService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listTurnosCaja(client, params), ctx);
  return buildPaginatedResponse(rows, total, params.page, params.pageSize);
}

export async function abrirTurnoCajaService(
  ctx: AuthContext,
  input: { turno: 'MANANA' | 'TARDE' | 'NOCHE'; saldo_inicial: string }
) {
  const idUsuario = requireG4UserId(ctx);
  return withTransaction(ctx, async (client) => {
    const res = await client.query<{ id_turno_caja: string; estado: string }>(
      `INSERT INTO g4_finanzas.turno_caja (id_usuario, turno, saldo_inicial, estado)
       VALUES ($1, $2, $3::numeric(12,2), 'ABIERTA')
       RETURNING id_turno_caja, estado`,
      [idUsuario, input.turno, input.saldo_inicial]
    );
    return res.rows[0];
  });
}

export async function cerrarTurnoCajaService(
  ctx: AuthContext,
  idTurnoCaja: string,
  input: {
    saldo_final: string;
    justificacion_diferencia?: string | null;
    motivo_excepcion?: string | null;
    id_usuario_autoriza?: number | null;
  }
) {
  return withTransaction(ctx, async (client) => {
    const turnoRes = await client.query<{ saldo_inicial: string; estado: string }>(
      `SELECT saldo_inicial::text AS saldo_inicial, estado
       FROM g4_finanzas.turno_caja
       WHERE id_turno_caja = $1 FOR UPDATE`,
      [idTurnoCaja]
    );
    const turno = turnoRes.rows[0];
    if (!turno) throw new NotFoundError('Turno de caja no encontrado.');
    if (turno.estado !== 'ABIERTA') throw new DomainRuleError('El turno de caja ya está cerrado.');

    const cobrosEfectivoRes = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(monto), 0)::text AS total
       FROM g4_finanzas.cobro
       WHERE id_turno_caja = $1 AND estado = 'REGISTRADO' AND medio_pago = 'EFECTIVO'`,
      [idTurnoCaja]
    );
    const movsRes = await client.query<{ neto: string }>(
      `SELECT COALESCE(SUM(CASE WHEN tipo = 'INGRESO' THEN importe ELSE -importe END), 0)::text AS neto
       FROM g4_finanzas.movimiento_caja WHERE id_turno_caja = $1`,
      [idTurnoCaja]
    );

    const esperado = (
      Number(turno.saldo_inicial) +
      Number(cobrosEfectivoRes.rows[0]?.total ?? 0) +
      Number(movsRes.rows[0]?.neto ?? 0)
    ).toFixed(2);

    const diff = Number(input.saldo_final) - Number(esperado);
    if (Math.abs(diff) > 0.001 && (!input.justificacion_diferencia || !input.justificacion_diferencia.trim())) {
      throw new DomainRuleError(
        `Existe una diferencia de S/ ${diff.toFixed(2)} respecto al esperado (S/ ${esperado}). Debe ingresar justificación.`
      );
    }

    const res = await client.query<{
      id_turno_caja: string;
      saldo_esperado: string;
      saldo_final: string;
      diferencia: string;
      estado: string;
    }>(
      `UPDATE g4_finanzas.turno_caja
       SET
         saldo_esperado = $2::numeric(12,2),
         saldo_final = $3::numeric(12,2),
         justificacion_diferencia = $4,
         id_usuario_autoriza = $5,
         motivo_excepcion = $6,
         fecha_cierre = CURRENT_TIMESTAMP,
         estado = 'CERRADA'
       WHERE id_turno_caja = $1
       RETURNING id_turno_caja, saldo_esperado::text AS saldo_esperado, saldo_final::text AS saldo_final, diferencia::text AS diferencia, estado`,
      [
        idTurnoCaja,
        esperado,
        input.saldo_final,
        input.justificacion_diferencia ?? null,
        input.id_usuario_autoriza ?? null,
        input.motivo_excepcion ?? null,
      ]
    );

    return res.rows[0];
  });
}

export async function registrarCobroService(
  ctx: AuthContext,
  input: {
    id_cuenta: string;
    id_turno_caja: string;
    id_comprobante?: string | null;
    monto: string;
    medio_pago: 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | 'BILLETERA_DIGITAL';
  }
) {
  const idUsuario = requireG4UserId(ctx);
  return withTransaction(ctx, async (client) => {
    const turnoRes = await client.query<{ estado: string }>(
      `SELECT estado FROM g4_finanzas.turno_caja WHERE id_turno_caja = $1 FOR UPDATE`,
      [input.id_turno_caja]
    );
    if (!turnoRes.rows[0] || turnoRes.rows[0].estado !== 'ABIERTA') {
      throw new DomainRuleError('El cobro requiere un turno de caja en estado ABIERTA.');
    }

    const cuentaRes = await client.query<{ saldo_pendiente: string; estado: string }>(
      `SELECT saldo_pendiente::text AS saldo_pendiente, estado
       FROM g4_finanzas.cuenta WHERE id_cuenta = $1 FOR UPDATE`,
      [input.id_cuenta]
    );
    const cuenta = cuentaRes.rows[0];
    if (!cuenta) throw new NotFoundError('Cuenta no encontrada.');
    if (cuenta.estado !== 'ACTIVA') throw new DomainRuleError('No se pueden registrar cobros en una cuenta cerrada.');

    const saldoActual = Number(cuenta.saldo_pendiente);
    const montoCobro = Number(input.monto);
    if (montoCobro > saldoActual + 0.001) {
      throw new DomainRuleError(`El monto (S/ ${montoCobro.toFixed(2)}) supera el saldo pendiente (S/ ${saldoActual.toFixed(2)}).`);
    }

    const cobroRes = await client.query<{ id_cobro: string; estado: string }>(
      `INSERT INTO g4_finanzas.cobro (
         id_cuenta, id_turno_caja, id_usuario, id_comprobante, monto, medio_pago
       ) VALUES ($1, $2, $3, $4, $5::numeric(12,2), $6)
       RETURNING id_cobro, estado`,
      [input.id_cuenta, input.id_turno_caja, idUsuario, input.id_comprobante ?? null, input.monto, input.medio_pago]
    );

    const nuevoSaldo = Math.max(0, saldoActual - montoCobro).toFixed(2);
    await client.query(
      `UPDATE g4_finanzas.cuenta SET saldo_pendiente = $2::numeric(12,2) WHERE id_cuenta = $1`,
      [input.id_cuenta, nuevoSaldo]
    );

    await client.query(
      `INSERT INTO g4_finanzas.historial_cuenta (
         id_cuenta, id_usuario, tipo_movimiento, importe, detalle
       ) VALUES ($1, $2, 'COBRO', $3::numeric(12,2), $4::jsonb)`,
      [input.id_cuenta, idUsuario, input.monto, JSON.stringify({ medio_pago: input.medio_pago })]
    );

    return { ...cobroRes.rows[0], saldo_restante: nuevoSaldo };
  });
}

export async function getGastosService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listGastos(client, params), ctx);
  return buildPaginatedResponse(rows, total, params.page, params.pageSize);
}

export async function createGastoService(
  ctx: AuthContext,
  input: {
    id_centro_costo: number;
    categoria: string;
    proveedor: string;
    concepto: string;
    monto: string;
    comprobante_sustento: string;
  }
) {
  const idUsuario = requireG4UserId(ctx);
  return withTransaction(ctx, async (client) => {
    const res = await client.query<{ id_gasto: string; estado: string }>(
      `INSERT INTO g4_finanzas.gasto (
         id_usuario, id_centro_costo, categoria, proveedor, concepto, monto, comprobante_sustento, estado
       ) VALUES ($1, $2, $3, $4, $5, $6::numeric(12,2), $7, 'PENDIENTE')
       RETURNING id_gasto, estado`,
      [idUsuario, input.id_centro_costo, input.categoria, input.proveedor, input.concepto, input.monto, input.comprobante_sustento]
    );
    return res.rows[0];
  });
}

export async function decidirGastoService(
  ctx: AuthContext,
  idGasto: string,
  decision: 'APROBADO' | 'RECHAZADO'
) {
  const idAprobador = requireG4UserId(ctx);
  return withTransaction(ctx, async (client) => {
    const res = await client.query<{ id_gasto: string; estado: string; fecha_aprobacion: string }>(
      `UPDATE g4_finanzas.gasto
       SET estado = $2, id_usuario_aprobador = $3, fecha_aprobacion = CURRENT_TIMESTAMP
       WHERE id_gasto = $1 AND estado = 'PENDIENTE'
       RETURNING id_gasto, estado, fecha_aprobacion::text AS fecha_aprobacion`,
      [idGasto, decision, idAprobador]
    );
    if (!res.rows[0]) throw new NotFoundError('Gasto no encontrado o ya fue decidido.');
    return res.rows[0];
  });
}

export async function getCuentasPorCobrarService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listCuentasPorCobrar(client, params), ctx);
  return buildPaginatedResponse(rows, total, params.page, params.pageSize);
}

export async function getAlertasFinancierasService(ctx: AuthContext, params: PaginationParams) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listAlertasFinancieras(client, params), ctx);
  return buildPaginatedResponse(rows, total, params.page, params.pageSize);
}

export async function decidirAlertaFinancieraService(
  ctx: AuthContext,
  idAlerta: string,
  input: { clasificacion: 'CONFIRMADA' | 'JUSTIFICADA' | 'FALSO_POSITIVO'; justificacion: string }
) {
  const idRevisor = requireG4UserId(ctx);
  return withTransaction(ctx, async (client) => {
    const res = await client.query<{ id_alerta: string; clasificacion: string }>(
      `UPDATE g4_finanzas.alerta_financiera
       SET
         clasificacion = $2,
         justificacion = $3,
         id_usuario_revisor = $4,
         fecha_revision = CURRENT_TIMESTAMP
       WHERE id_alerta = $1
       RETURNING id_alerta, clasificacion`,
      [idAlerta, input.clasificacion, input.justificacion, idRevisor]
    );
    if (!res.rows[0]) throw new NotFoundError('Alerta financiera no encontrada.');
    return res.rows[0];
  });
}
