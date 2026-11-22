process.env.DATABASE_URL = 'postgres://postgres@127.0.0.1:55432/sgh';
process.env.DATABASE_SSL = 'false';
import express, { Router } from 'express';
const { getDatabasePool } = await import('../server/config/database.ts');
const { errorHandler } = await import('../server/middleware/error-handler.ts');
const { registerM1Gestion } = await import('../server/modules/gestion/m1.ts');
const { registerM3Gestion } = await import('../server/modules/gestion/m3.ts');
const { registerM4Gestion } = await import('../server/modules/gestion/m4.ts');
const s4 = await import('../server/modules/m4/service.ts');
const m3repo = await import('../server/modules/m3/repository.ts');
const pool = getDatabasePool();
const one = async (sql: string, p: any[] = []) => (await pool.query(sql, p)).rows[0];

const u4 = await one(`select id_usuario from g4_finanzas.usuario order by 1 limit 1`);
const admin: any = { authUserId: '00000000-0000-0000-0000-000000000001', usuarioId: '1', codigoUsuario: 'verif', nombre: 'V', departamento: 'TI', roles: ['ADMINISTRADOR'], permisos: ['*'], canViewFullPII: true, idUsuarioG4: u4.id_usuario };
const sinPermiso: any = { ...admin, roles: ['CAJERO'], permisos: ['m4.caja.operar'] };
let currentCtx: any = admin;

const app = express();
app.use(express.json());
const mount = (prefix: string, reg: (r: Router) => void) => {
  const r = Router();
  r.use((req, _res, next) => { (req as any).authContext = currentCtx; next(); });
  reg(r);
  app.use(prefix, r);
};
mount('/m1', registerM1Gestion);
mount('/m3', registerM3Gestion);
mount('/m4', registerM4Gestion);
app.use(errorHandler);
const server = await new Promise<any>((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
const base = `http://127.0.0.1:${server.address().port}`;

let ok = 0, bad = 0;
async function call(method: string, path: string, body?: any) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'SGH-ERP' }, body: body ? JSON.stringify(body) : undefined });
  let json: any = null; try { json = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, json };
}
function check(name: string, cond: boolean, extra = '') {
  if (cond) { console.log(`OK   ${name}`); ok++; } else { console.log(`FAIL ${name} ${extra}`); bad++; }
}

// ---------------- M1
let r = await call('GET', '/m1/catalogos');
check('GET catalogos', r.status === 200 && r.json.data.tipos.length > 0 && r.json.data.temporadas.length > 0 && r.json.data.canales.length > 0, JSON.stringify(r.json).slice(0, 200));
const tipo = r.json.data.tipos[0], temp = r.json.data.temporadas[0], canal = r.json.data.canales[0];

const numero = `T${Date.now() % 100000}`;
r = await call('POST', '/m1/habitaciones', { numero, piso: 9, id_tipo_habitacion: tipo.id });
check('POST habitaciones => 201', r.status === 201 && r.json.data.numero === numero, JSON.stringify(r.json).slice(0, 250));
const hab = r.json?.data;
const est = hab && (await one(`select id_estado from g2_housekeeping.v_estado_actual where id_habitacion=$1::bigint`, [hab.id_habitacion]));
check('habitación nueva queda Disponible (DIS)', est?.id_estado === 'DIS', JSON.stringify(est));
r = await call('POST', '/m1/habitaciones', { numero, piso: 9, id_tipo_habitacion: tipo.id });
check('habitación duplicada => 409', r.status === 409, JSON.stringify(r.json).slice(0, 200));
r = await call('POST', '/m1/habitaciones', { numero: '', piso: 'x', id_tipo_habitacion: 'abc' });
check('habitación inválida => 400', r.status === 400, `status ${r.status}`);
r = await call('PUT', `/m1/habitaciones/${hab.id_habitacion}`, { piso: 10, estado_registro: 'INACTIVA' });
check('PUT habitaciones', r.status === 200 && r.json.data.piso === 10 && r.json.data.estado_registro === 'INACTIVA', JSON.stringify(r.json).slice(0, 200));
r = await call('PUT', `/m1/habitaciones/999999`, { piso: 1 });
check('PUT habitación inexistente => 404', r.status === 404);
r = await call('PUT', `/m1/habitaciones/${hab.id_habitacion}`, {});
check('PUT sin campos => 400', r.status === 400);

r = await call('POST', '/m1/tarifas', { id_tipo_habitacion: tipo.id, id_temporada: temp.id, id_canal_reserva: canal.id, nombre: `Tarifa prueba ${numero}`, precio_base: '455.50', fecha_inicio: '2031-01-01', fecha_fin: '2031-12-31' });
check('POST tarifas => 201', r.status === 201 && r.json.data.precio_base === '455.50' && r.json.data.estado === 'ACTIVA', JSON.stringify(r.json).slice(0, 250));
const tar = r.json?.data;
r = await call('PUT', `/m1/tarifas/${tar.id_tarifa}`, { precio_base: '480', estado: 'INACTIVA' });
check('PUT tarifas', r.status === 200 && r.json.data.precio_base === '480.00' && r.json.data.estado === 'INACTIVA', JSON.stringify(r.json).slice(0, 200));
r = await call('POST', '/m1/tarifas', { id_tipo_habitacion: tipo.id, id_temporada: temp.id, id_canal_reserva: canal.id, nombre: 'Fechas malas', precio_base: '100', fecha_inicio: '2031-02-01', fecha_fin: '2031-01-01' });
check('tarifa con fechas invertidas => 400', r.status === 400);
r = await call('POST', '/m1/tarifas', { id_tipo_habitacion: '9999999', id_temporada: temp.id, id_canal_reserva: canal.id, nombre: 'Tipo inexistente', precio_base: '100', fecha_inicio: '2031-01-01', fecha_fin: '2031-02-01' });
check('tarifa con tipo inexistente => 422', r.status === 422, `status ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
// el listado del servidor ve la habitación nueva y su tarifa
const m1repo = await import('../server/modules/m1/repository.ts');
const lst = await pool.connect();
const habs = await m1repo.listHabitaciones(lst, { page: 1, pageSize: 100, sortOrder: 'desc' } as any); lst.release();
check('listado de habitaciones sigue funcionando', habs.total >= 40);

// ---------------- M3
r = await call('GET', '/m3/proveedores');
check('GET proveedores', r.status === 200 && r.json.data.length >= 10 && 'razon_social' in r.json.data[0], JSON.stringify(r.json).slice(0, 160));
const ruc = String(20000000000 + (Date.now() % 1000000000)).padStart(11, '0');
r = await call('POST', '/m3/proveedores', { ruc, razon_social: 'Proveedor de Prueba SAC', telefono: '999888777', correo: null });
check('POST proveedores => 201 con código PRV-nn', r.status === 201 && /^PRV-\d{2,}$/.test(r.json.data.id_proveedor) && r.json.data.estado === 'activo', JSON.stringify(r.json).slice(0, 250));
r = await call('POST', '/m3/proveedores', { ruc, razon_social: 'Duplicado SAC', correo: 'a@b.pe' });
check('RUC duplicado => 409', r.status === 409, JSON.stringify(r.json).slice(0, 160));
r = await call('POST', '/m3/proveedores', { ruc: '123', razon_social: 'X' });
check('proveedor inválido => 400', r.status === 400);
r = await call('POST', '/m3/proveedores', { ruc: '20999999999', razon_social: 'Sin contacto SAC' });
check('proveedor sin contacto => 400', r.status === 400);
const c1 = await pool.connect();
const ocs = await m3repo.listOrdenesCompra(c1, { page: 1, pageSize: 3, sortOrder: 'desc' } as any); c1.release();
const det = (ocs.rows[0] as any).detalles;
check('órdenes de compra traen sus líneas', Array.isArray(det) && det.length > 0 && 'id_detalle_orden' in det[0] && 'articulo' in det[0], JSON.stringify(det).slice(0, 200));

// ---------------- M4
const cuenta = await one(`select id_cuenta from g4_finanzas.cuenta where estado='ACTIVA' order by id_cuenta limit 1`);
const cxc = await one(`insert into g4_finanzas.cuenta_por_cobrar (id_cuenta, razon_social_cliente, fecha_vencimiento, monto_original) values ($1, 'Cliente CxC Prueba', current_date + 30, 1000) returning id_cuenta_por_cobrar id`, [cuenta.id_cuenta]);
r = await call('POST', `/m4/cuentas-por-cobrar/${cxc.id}/pagos`, { monto: '400', nota: 'Primer abono' });
check('CxC pago parcial', r.status === 201 || r.status === 200, `status ${r.status}`);
check('  saldo 600 y sigue vigente', r.json?.data?.saldo_pendiente === '600.00' && r.json?.data?.estado === 'VIGENTE', JSON.stringify(r.json).slice(0, 220));
r = await call('POST', `/m4/cuentas-por-cobrar/${cxc.id}/pagos`, { monto: '700' });
check('CxC pago mayor al saldo => 422', r.status === 422, `status ${r.status}`);
r = await call('POST', `/m4/cuentas-por-cobrar/${cxc.id}/pagos`, { monto: '600', nota: 'Liquidación' });
check('CxC pago total => PAGADA', r.json?.data?.estado === 'PAGADA' && r.json?.data?.saldo_pendiente === '0.00', JSON.stringify(r.json).slice(0, 220));
const nota = await one(`select nota_seguimiento from g4_finanzas.cuenta_por_cobrar where id_cuenta_por_cobrar=$1`, [cxc.id]);
check('  notas acumuladas', nota.nota_seguimiento === 'Primer abono | Liquidación', nota.nota_seguimiento);
r = await call('POST', `/m4/cuentas-por-cobrar/${cxc.id}/pagos`, { monto: '1' });
check('CxC ya pagada => 422', r.status === 422);
r = await call('POST', `/m4/cuentas-por-cobrar/NO-EXISTE/pagos`, { monto: '1' });
check('CxC inexistente => 404', r.status === 404);
r = await call('POST', `/m4/cuentas-por-cobrar/${cxc.id}/pagos`, { monto: '-5' });
check('monto negativo => 400', r.status === 400);

const turno = await s4.abrirTurnoCajaService(admin, { turno: 'TARDE', saldo_inicial: '200.00' });
r = await call('POST', `/m4/turnos-caja/${turno.id_turno_caja}/movimientos`, { tipo: 'INGRESO', importe: '50', motivo: 'Reposición de caja chica' });
check('movimiento INGRESO => 201', r.status === 201 && r.json.data.importe === '50.00', JSON.stringify(r.json).slice(0, 220));
r = await call('POST', `/m4/turnos-caja/${turno.id_turno_caja}/movimientos`, { tipo: 'EGRESO', importe: '185.50', motivo: 'Compra de flores recepción' });
check('movimiento EGRESO => 201', r.status === 201);
r = await call('POST', `/m4/turnos-caja/${turno.id_turno_caja}/movimientos`, { tipo: 'OTRO', importe: '5', motivo: 'xxx' });
check('tipo inválido => 400', r.status === 400);
r = await call('GET', `/m4/turnos-caja/${turno.id_turno_caja}/movimientos`);
check('GET movimientos (2)', r.status === 200 && r.json.data.length === 2, JSON.stringify(r.json).slice(0, 200));
// el cierre toma en cuenta los movimientos: esperado = 200 + 50 - 185.50 = 64.50
const cierre = await s4.cerrarTurnoCajaService(admin, turno.id_turno_caja, { saldo_final: '64.50' } as any);
check('cierre cuadra con movimientos (esperado 64.50)', cierre.saldo_esperado === '64.50' && cierre.estado === 'CERRADA', JSON.stringify(cierre));
r = await call('POST', `/m4/turnos-caja/${turno.id_turno_caja}/movimientos`, { tipo: 'INGRESO', importe: '5', motivo: 'Turno cerrado' });
check('turno cerrado => 422', r.status === 422, `status ${r.status}`);
r = await call('POST', `/m4/turnos-caja/${turno.id_turno_caja}/movimientos`, { tipo: 'INGRESO', importe: '5', motivo: 'ok ok' });

const cb = await s4.emitirComprobanteService(admin, { id_cuenta: cuenta.id_cuenta, tipo: 'BOLETA', serie: 'B001', tipo_documento_cliente: 'DNI', numero_documento_cliente: '12345678', razon_social_cliente: 'Cliente Prueba', operacion_gravada: '100.00' } as any);
r = await call('POST', `/m4/comprobantes/${cb.id_comprobante}/anular`, { motivo_nota: 'Error en el importe facturado' });
check('anular comprobante => 201 con nota de crédito', r.status === 201 && r.json.data.nota_credito.tipo === 'NOTA_CREDITO' && r.json.data.nota_credito.serie === 'BC01', JSON.stringify(r.json).slice(0, 300));
const orig = await one(`select estado from g4_finanzas.comprobante where id_comprobante=$1`, [cb.id_comprobante]);
const nc = await one(`select total::text t, id_comprobante_ref ref, motivo_nota, numero_documento_cliente doc from g4_finanzas.comprobante where tipo='NOTA_CREDITO' and id_comprobante_ref=$1`, [cb.id_comprobante]);
check('  original queda ANULADO', orig.estado === 'ANULADO');
check('  nota por el total (118.00), con el documento sin enmascarar', nc?.t === '118.00' && nc?.doc === '12345678' && nc?.motivo_nota === 'Error en el importe facturado', JSON.stringify(nc));
r = await call('POST', `/m4/comprobantes/${cb.id_comprobante}/anular`, { motivo_nota: 'Segunda anulación' });
check('anular dos veces => 422', r.status === 422);
r = await call('POST', `/m4/comprobantes/${(await one(`select id_comprobante id from g4_finanzas.comprobante where tipo='NOTA_CREDITO' limit 1`)).id}/anular`, { motivo_nota: 'Anular una nota' });
check('anular una nota de crédito => 422', r.status === 422);
r = await call('POST', `/m4/comprobantes/NO-EXISTE/anular`, { motivo_nota: 'No existe el comprobante' });
check('comprobante inexistente => 404', r.status === 404);
r = await call('POST', `/m4/comprobantes/${cb.id_comprobante}/anular`, { motivo_nota: 'ab' });
check('motivo corto => 400', r.status === 400);

// ---------------- permisos: sin el permiso adecuado => 403
currentCtx = sinPermiso;
r = await call('POST', '/m1/habitaciones', { numero: 'Z1', piso: 1, id_tipo_habitacion: tipo.id });
check('sin permiso (habitaciones) => 403', r.status === 403, `status ${r.status}`);
r = await call('POST', '/m3/proveedores', { ruc: '20111111111', razon_social: 'No debe crearse', correo: 'x@y.pe' });
check('sin permiso (proveedores) => 403', r.status === 403);
r = await call('POST', `/m4/cuentas-por-cobrar/${cxc.id}/pagos`, { monto: '1' });
check('sin permiso (CxC) => 403', r.status === 403);
r = await call('POST', `/m4/turnos-caja/${turno.id_turno_caja}/movimientos`, { tipo: 'INGRESO', importe: '5', motivo: 'permiso caja operar' });
check('con m4.caja.operar el permiso pasa (turno cerrado => 422, no 403)', r.status === 422, `status ${r.status}`);

console.log(`\n${ok} OK · ${bad} FAIL`);
server.close();
await pool.end();
