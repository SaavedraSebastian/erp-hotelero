process.env.DATABASE_URL = 'postgres://postgres@127.0.0.1:55432/sgh';
process.env.DATABASE_SSL = 'false';
import express, { Router } from 'express';
const { getDatabasePool } = await import('../server/config/database.ts');
const { errorHandler } = await import('../server/middleware/error-handler.ts');
const { registerM1Gestion } = await import('../server/modules/gestion/m1.ts');
const { registerM2Gestion } = await import('../server/modules/gestion/m2.ts');
const { registerM3Gestion } = await import('../server/modules/gestion/m3.ts');
const pool = getDatabasePool();
const one = async (sql: string, p: any[] = []) => (await pool.query(sql, p)).rows[0];
const rows = async (sql: string, p: any[] = []) => (await pool.query(sql, p)).rows;

const sup = await one(`select id_personal from g2_housekeeping.supervisor order by 1 limit 1`);
const admin: any = { authUserId: '00000000-0000-0000-0000-000000000001', usuarioId: '1', codigoUsuario: 'verif', nombre: 'V', departamento: 'TI', roles: ['ADMINISTRADOR'], permisos: ['*'], canViewFullPII: true, idUsuarioG4: 1, idPersonalG2: String(sup.id_personal) };
const cajero: any = { ...admin, roles: ['CAJERO'], permisos: ['m4.caja.operar'] };
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
mount('/m2', registerM2Gestion);
mount('/m3', registerM3Gestion);
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

// ================= Lista de espera
const pend = await rows(`select id_lista_espera::text id from g1_reservas.lista_espera where estado='PENDIENTE' order by 1 limit 3`);
check('hay entradas pendientes para probar', pend.length >= 2);
currentCtx = cajero;
let r = await call('POST', `/m1/lista-espera/${pend[0].id}/resolver`, { estado: 'ATENDIDA' });
check('sin permiso => 403', r.status === 403, JSON.stringify(r));
currentCtx = admin;
r = await call('POST', `/m1/lista-espera/${pend[0].id}/resolver`, { estado: 'PENDIENTE' });
check('estado inválido => 400', r.status === 400, JSON.stringify(r));
r = await call('POST', `/m1/lista-espera/${pend[0].id}/resolver`, { estado: 'ATENDIDA' });
check('marcar atendida => 200', r.status === 200 && r.json.data.estado === 'ATENDIDA', JSON.stringify(r));
check('  queda en BD', (await one(`select estado from g1_reservas.lista_espera where id_lista_espera=$1`, [pend[0].id])).estado === 'ATENDIDA');
r = await call('POST', `/m1/lista-espera/${pend[0].id}/resolver`, { estado: 'CANCELADA' });
check('resolver una ya atendida => 422', r.status === 422, JSON.stringify(r));
r = await call('POST', `/m1/lista-espera/${pend[1].id}/resolver`, { estado: 'CANCELADA' });
check('cancelar una pendiente => 200', r.status === 200 && r.json.data.estado === 'CANCELADA', JSON.stringify(r));
r = await call('POST', `/m1/lista-espera/99999999/resolver`, { estado: 'ATENDIDA' });
check('inexistente => 404', r.status === 404, JSON.stringify(r));

// ================= Tarifa dinámica
r = await call('GET', '/m1/tarifas/dinamica');
check('GET dinámica => 200 con tipos', r.status === 200 && Array.isArray(r.json.data.tipos) && r.json.data.tipos.length >= 7, JSON.stringify(r).slice(0, 300));
const dyn = r.json.data;
check('  horizonte 7 días y regla con 5 tramos', dyn.horizonte_dias === 7 && dyn.regla.length === 5);
const t1 = dyn.tipos.find((t: any) => t.id_tipo_habitacion === '1');
const ocuManual = await one(
  `select count(*)::int n from g1_reservas.reserva r
     join g1_reservas.detalle_reserva dr on dr.id_reserva=r.id_reserva
     join g1_reservas.habitacion h on h.id_habitacion=dr.id_habitacion
     join generate_series(current_date, current_date+6, interval '1 day') d on d::date>=r.fecha_ingreso and d::date<r.fecha_salida
    where h.id_tipo_habitacion=1 and r.estado in ('CONFIRMADA','EN_CURSO','PENDIENTE')`);
check('  noches ocupadas coinciden con consulta manual', t1.noches_ocupadas === ocuManual.n, `${t1.noches_ocupadas} vs ${ocuManual.n}`);
check('  disponibles = habitaciones x 7', t1.noches_disponibles === t1.habitaciones * 7);
check('  ocupación en [0,1] y ajuste coherente', t1.ocupacion_proyectada >= 0 && t1.ocupacion_proyectada <= 1 &&
  t1.ajuste_sugerido_pct === (t1.ocupacion_proyectada >= 0.85 ? 10 : t1.ocupacion_proyectada >= 0.7 ? 5 : t1.ocupacion_proyectada >= 0.55 ? 0 : t1.ocupacion_proyectada >= 0.4 ? -5 : -10), JSON.stringify(t1));
const espManual = await one(`select count(*)::int n from g1_reservas.lista_espera where estado='PENDIENTE' and id_tipo_habitacion=1`);
check('  espera pendiente coincide', t1.en_espera === espManual.n);
check('  precio vigente = máximo de tarifas activas vigentes', t1.precio_vigente === Number((await one(`select max(precio_base) m from g1_reservas.tarifa where id_tipo_habitacion=1 and estado='ACTIVA' and current_date between fecha_inicio and fecha_fin`)).m));
currentCtx = cajero;
r = await call('GET', '/m1/tarifas/dinamica');
check('GET dinámica sin permiso => 403', r.status === 403);
r = await call('POST', '/m1/tarifas/dinamica/aplicar', { id_tipo_habitacion: '1', porcentaje: 5, motivo: 'Alta demanda' });
check('aplicar sin permiso => 403', r.status === 403);
currentCtx = admin;

const before = await rows(`select id_tarifa::text id, precio_base::text p from g1_reservas.tarifa where id_tipo_habitacion=1 and estado='ACTIVA' and current_date between fecha_inicio and fecha_fin order by 1`);
const outside = await one(`select count(*)::int n, coalesce(sum(precio_base),0)::text s from g1_reservas.tarifa where not (id_tipo_habitacion=1 and estado='ACTIVA' and current_date between fecha_inicio and fecha_fin)`);
for (const bad_ of [{ porcentaje: 0 }, { porcentaje: 31 }, { porcentaje: -31 }, { motivo: 'no' }]) {
  r = await call('POST', '/m1/tarifas/dinamica/aplicar', { id_tipo_habitacion: '1', porcentaje: 5, motivo: 'Alta demanda', ...bad_ });
  check(`aplicar inválido ${JSON.stringify(bad_)} => 400`, r.status === 400, JSON.stringify(r));
}
r = await call('POST', '/m1/tarifas/dinamica/aplicar', { id_tipo_habitacion: '9999', porcentaje: 5, motivo: 'Alta demanda' });
check('tipo sin tarifas vigentes => 422', r.status === 422, JSON.stringify(r));
r = await call('POST', '/m1/tarifas/dinamica/aplicar', { id_tipo_habitacion: '1', porcentaje: 5, motivo: 'Alta demanda' });
check('aplicar +5% => 200', r.status === 200 && r.json.data.tarifas_actualizadas === before.length, JSON.stringify(r).slice(0, 200));
const after = await rows(`select id_tarifa::text id, precio_base::text p from g1_reservas.tarifa where id_tarifa in (${before.map((b) => b.id).join(',') || 0}) order by 1`);
check('  todas subieron 5% (redondeo a 2 decimales)', after.length === before.length && after.every((a, i) => Number(a.p) === Math.round(Number(before[i].p) * 105) / 100), JSON.stringify({ before, after }));
const outside2 = await one(`select count(*)::int n, coalesce(sum(precio_base),0)::text s from g1_reservas.tarifa where not (id_tipo_habitacion=1 and estado='ACTIVA' and current_date between fecha_inicio and fecha_fin)`);
check('  las demás tarifas no cambian', outside.n === outside2.n && outside.s === outside2.s);
// restaurar
for (const b of before) await pool.query(`update g1_reservas.tarifa set precio_base=$2::numeric where id_tarifa=$1::bigint`, [b.id, b.p]);

// ================= Inspecciones
r = await call('GET', '/m2/inspecciones');
const insp = r.json?.data;
check('GET inspecciones => 200 con filas', r.status === 200 && Array.isArray(insp) && insp.length > 0 && insp.length <= 200, JSON.stringify(r).slice(0, 200));
const total = await one(`select count(*)::int n from g2_housekeeping.inspeccion`);
check('  trae min(total,200)', insp.length === Math.min(total.n, 200));
check('  campos esperados', ['id_inspeccion', 'numero_orden', 'resultado', 'lista_verificacion', 'fecha_hora', 'numero_habitacion', 'supervisor'].every((k) => k in insp[0]), JSON.stringify(insp[0]));
check('  orden por fecha descendente', insp.every((x: any, i: number) => i === 0 || new Date(insp[i - 1].fecha_hora) >= new Date(x.fecha_hora)));
check('  hay supervisor con nombre', insp.some((x: any) => x.supervisor));
currentCtx = cajero;
r = await call('GET', '/m2/inspecciones');
check('inspecciones sin permiso => 403', r.status === 403);
currentCtx = admin;

// ================= Mesas
const libre = await one(`select m.id_mesa from g3_servicios.mesa m where m.estado='activa' and not exists (select 1 from g3_servicios.comanda c where c.id_mesa=m.id_mesa and c.estado not in ('entregada','cancelada')) order by 1 limit 1`);
const ocupada = await one(`select m.id_mesa from g3_servicios.mesa m join g3_servicios.comanda c on c.id_mesa=m.id_mesa and c.estado not in ('entregada','cancelada') where m.estado='activa' limit 1`);
check('hay mesa libre', !!libre);
r = await call('PUT', `/m3/mesas/${libre.id_mesa}`, { estado: 'inactiva' });
check('desactivar sin motivo => 400', r.status === 400, JSON.stringify(r));
r = await call('PUT', `/m3/mesas/${libre.id_mesa}`, { estado: 'inactiva', motivo_desactivacion: 'Mesa en reparación' });
check('desactivar con motivo => 200', r.status === 200 && r.json.data.estado === 'inactiva' && r.json.data.motivo_desactivacion === 'Mesa en reparación', JSON.stringify(r));
r = await call('PUT', `/m3/mesas/${libre.id_mesa}`, { estado: 'activa' });
check('reactivar => 200 y borra el motivo', r.status === 200 && r.json.data.estado === 'activa' && r.json.data.motivo_desactivacion === null, JSON.stringify(r));
if (ocupada) {
  r = await call('PUT', `/m3/mesas/${ocupada.id_mesa}`, { estado: 'inactiva', motivo_desactivacion: 'Prueba' });
  check('mesa con comanda abierta => 422', r.status === 422 && (await one(`select estado from g3_servicios.mesa where id_mesa=$1`, [ocupada.id_mesa])).estado === 'activa', JSON.stringify(r));
} else {
  console.log('SKIP mesa con comanda abierta (no hay en los datos)');
}
r = await call('PUT', `/m3/mesas/NO-EXISTE`, { estado: 'activa' });
check('mesa inexistente => 404', r.status === 404, JSON.stringify(r));
currentCtx = cajero;
r = await call('PUT', `/m3/mesas/${libre.id_mesa}`, { estado: 'activa' });
check('mesa sin permiso => 403', r.status === 403);

console.log(`\n${ok} OK, ${bad} FAIL`);
server.close();
await pool.end();
process.exit(bad ? 1 : 0);
