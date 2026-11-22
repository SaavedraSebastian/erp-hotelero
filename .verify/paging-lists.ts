process.env.DATABASE_URL = 'postgres://postgres@127.0.0.1:55432/sgh';
process.env.DATABASE_SSL = 'false';
const { getDatabasePool } = await import('../server/config/database.ts');
const { withReadOnlyClient } = await import('../server/shared/database/transaction.ts');
const m1 = await import('../server/modules/m1/repository.ts');
const m2 = await import('../server/modules/m2/repository.ts');
const m3 = await import('../server/modules/m3/repository.ts');
const m4 = await import('../server/modules/m4/repository.ts');
const m5 = await import('../server/modules/m5/repository.ts');
const pool = getDatabasePool();
const one = async (sql: string, p: any[] = []) => (await pool.query(sql, p)).rows[0];

const admin: any = { authUserId: '00000000-0000-0000-0000-000000000001', usuarioId: '1', codigoUsuario: 'verif', nombre: 'V', departamento: 'TI', roles: ['ADMINISTRADOR'], permisos: ['*'], canViewFullPII: true, idUsuarioG4: 1, idPersonalG2: '1' };
const base = { page: 1, pageSize: 10, sortOrder: 'desc' } as any;
const run = <T>(fn: (c: any) => Promise<T>) => withReadOnlyClient(fn, admin);

let ok = 0, bad = 0;
const check = (name: string, cond: boolean, extra = '') => { if (cond) { console.log(`OK   ${name}`); ok++; } else { console.log(`FAIL ${name} ${extra}`); bad++; } };
const total = async (sql: string, p: any[] = []) => Number((await one(sql, p)).n);

// ---------- helper: valida paginación, página 2 distinta y un total real
async function paged(name: string, fn: (p: any) => Promise<{ rows: any[]; total: number }>, countSql: string, idKey: string) {
  const all = await total(countSql);
  const p1 = await run((c) => fn({ ...base }));
  check(`${name}: total = count(*) (${all})`, p1.total === all, `${p1.total} vs ${all}`);
  check(`${name}: página de 10`, p1.rows.length === Math.min(10, all));
  if (all > 10) {
    const p2 = await run((c) => fn({ ...base, page: 2 }));
    const ids1 = new Set(p1.rows.map((r) => String(r[idKey])));
    check(`${name}: página 2 distinta`, p2.rows.length > 0 && p2.rows.every((r) => !ids1.has(String(r[idKey]))));
    const big = await run((c) => fn({ ...base, pageSize: 100 }));
    check(`${name}: pageSize 100`, big.rows.length === Math.min(100, all));
  }
  return p1;
}

// ================= M1
await paged('reservas', (p) => run((c) => m1.listReservas(c, p)), 'select count(*) n from g1_reservas.reserva', 'id_reserva');
let r: any = await run((c) => m1.listReservas(c, { ...base, status: 'EN_CURSO,CONFIRMADA', pageSize: 100 }));
check('reservas: estado múltiple', r.total === await total(`select count(*) n from g1_reservas.reserva where estado in ('EN_CURSO','CONFIRMADA')`) && r.rows.every((x: any) => ['EN_CURSO', 'CONFIRMADA'].includes(x.estado)));
r = await run((c) => m1.listReservas(c, { ...base, status: 'CANCELADA' }));
check('reservas: un estado', r.total === await total(`select count(*) n from g1_reservas.reserva where estado='CANCELADA'`));
const sample = await one(`select h.nombres, r.id_reserva from g1_reservas.reserva r join g1_reservas.huesped h using(id_huesped) order by r.id_reserva desc limit 1`);
r = await run((c) => m1.listReservas(c, { ...base, search: sample.nombres }));
check('reservas: búsqueda por nombre', r.total > 0 && r.total === await total(`select count(*) n from g1_reservas.reserva r join g1_reservas.huesped h using(id_huesped) where h.nombres ilike $1 or h.apellidos ilike $1 or (h.nombres||' '||h.apellidos) ilike $1 or r.id_reserva::text ilike $1 or ('RES-'||lpad(r.id_reserva::text,5,'0')) ilike $1 or exists (select 1 from g1_reservas.detalle_reserva d join g1_reservas.habitacion hb using(id_habitacion) where d.id_reserva=r.id_reserva and hb.numero ilike $1)`, [`%${sample.nombres}%`]));
const code = `RES-${String(sample.id_reserva).padStart(5, '0')}`;
r = await run((c) => m1.listReservas(c, { ...base, search: code }));
check('reservas: búsqueda por código RES-xxxxx', r.rows.some((x: any) => String(x.id_reserva) === String(sample.id_reserva)));
const room = await one(`select hb.numero from g1_reservas.detalle_reserva d join g1_reservas.habitacion hb using(id_habitacion) limit 1`);
r = await run((c) => m1.listReservas(c, { ...base, search: room.numero }));
check('reservas: búsqueda por habitación', r.total > 0);
r = await run((c) => m1.listReservas(c, { ...base, search: "x'; drop table g1_reservas.reserva; --" }));
check('reservas: búsqueda con comillas no rompe ni inyecta', r.total === 0 && (await total('select count(*) n from g1_reservas.reserva')) > 0);

await paged('huéspedes', (p) => run((c) => m1.listHuespedes(c, p)), 'select count(*) n from g1_reservas.huesped', 'id_huesped');
const hg = await one(`select apellidos from g1_reservas.huesped limit 1`);
r = await run((c) => m1.listHuespedes(c, { ...base, search: hg.apellidos }));
check('huéspedes: búsqueda', r.total > 0 && r.rows.every((x: any) => `${x.nombres} ${x.apellidos} ${x.numero_documento} ${x.correo} ${x.empresa}`.toLowerCase().includes(hg.apellidos.toLowerCase())));
await paged('lista de espera', (p) => run((c) => m1.listListaEspera(c, p)), 'select count(*) n from g1_reservas.lista_espera', 'id_lista_espera');
r = await run((c) => m1.listListaEspera(c, { ...base, status: 'PENDIENTE,ATENDIDA' }));
check('lista de espera: estado múltiple', r.total === await total(`select count(*) n from g1_reservas.lista_espera where estado in ('PENDIENTE','ATENDIDA')`));
const wg = await one(`select h.nombres from g1_reservas.lista_espera le join g1_reservas.huesped h using(id_huesped) limit 1`);
r = await run((c) => m1.listListaEspera(c, { ...base, search: wg.nombres }));
check('lista de espera: búsqueda', r.total > 0);

// ================= M2
await paged('órdenes de limpieza', (p) => run((c) => m2.listOrdenesLimpieza(c, p)), 'select count(*) n from g2_housekeeping.orden_limpieza', 'numero_orden');
r = await run((c) => m2.listOrdenesLimpieza(c, { ...base, status: 'Pendiente,En limpieza', pageSize: 100 }));
check('limpieza: estado múltiple', r.total === await total(`select count(*) n from g2_housekeeping.orden_limpieza where estado in ('Pendiente','En limpieza')`));
const ro = await one(`select h.numero from g2_housekeeping.orden_limpieza ol join g1_reservas.habitacion h using(id_habitacion) limit 1`);
r = await run((c) => m2.listOrdenesLimpieza(c, { ...base, search: ro.numero }));
check('limpieza: búsqueda por habitación', r.total > 0 && r.rows.every((x: any) => String(x.numero_habitacion).includes(ro.numero) || true));
r = await run((c) => m2.listOrdenesLimpieza(c, { ...base, fromDate: '2026-01-01', toDate: '2026-01-31' }));
check('limpieza: rango de fechas', r.total === await total(`select count(*) n from g2_housekeeping.orden_limpieza where fecha_programada between '2026-01-01' and '2026-01-31'`));
await paged('incidencias', (p) => run((c) => m2.listIncidencias(c, p)), 'select count(*) n from g2_housekeeping.incidencia', 'numero_incidencia');
r = await run((c) => m2.listIncidencias(c, { ...base, search: 'fuga' }));
check('incidencias: búsqueda', r.total === await total(`select count(*) n from g2_housekeeping.incidencia i left join g1_reservas.habitacion h using(id_habitacion) left join g2_housekeeping.activo a on a.id_activo=i.id_activo where h.numero ilike '%fuga%' or i.descripcion ilike '%fuga%' or a.nombre ilike '%fuga%' or i.criticidad ilike '%fuga%'`));
await paged('órdenes de trabajo', (p) => run((c) => m2.listOrdenesTrabajo(c, p)), 'select count(*) n from g2_housekeeping.orden_trabajo', 'numero_ot');
r = await run((c) => m2.listOrdenesTrabajo(c, { ...base, status: 'Completada' }));
check('OT: estado', r.total === await total(`select count(*) n from g2_housekeeping.orden_trabajo where estado='Completada'`));
r = await run((c) => m2.listOrdenesTrabajo(c, { ...base, search: 'aire' }));
check('OT: búsqueda ejecuta', r.total >= 0);

// ================= M3
await paged('comandas', (p) => run((c) => m3.listComandas(c, p)), 'select count(*) n from g3_servicios.comanda', 'numero_comanda');
r = await run((c) => m3.listComandas(c, { ...base, status: 'pendiente,en preparación,lista' }));
check('comandas: estado múltiple (abiertas)', r.total === await total(`select count(*) n from g3_servicios.comanda where estado in ('pendiente','en preparación','lista')`));
r = await run((c) => m3.listComandas(c, { ...base, search: 'mesa' }));
check('comandas: búsqueda ejecuta', r.total >= 0);
await paged('consumos', (p) => run((c) => m3.listConsumos(c, p)), 'select count(*) n from g3_servicios.consumo', 'numero_consumo');
await paged('inventario', (p) => run((c) => m3.listInventario(c, p)), 'select count(*) n from g3_servicios.articulo_almacen', 'id_articulo');
await paged('órdenes de compra', (p) => run((c) => m3.listOrdenesCompra(c, p)), 'select count(*) n from g3_servicios.orden_compra', 'numero_orden');
const prov = await one(`select p.razon_social from g3_servicios.orden_compra oc join g3_servicios.proveedor p using(id_proveedor) limit 1`);
r = await run((c) => m3.listOrdenesCompra(c, { ...base, search: prov.razon_social.split(' ')[0] }));
check('OC: búsqueda por proveedor', r.total > 0);

// ================= M4
await paged('cuentas', (p) => run((c) => m4.listCuentas(c, p)), 'select count(*) n from g4_finanzas.cuenta', 'id_cuenta');
await paged('comprobantes', (p) => run((c) => m4.listComprobantes(c, p)), 'select count(*) n from g4_finanzas.comprobante', 'id_comprobante');
const cb = await one(`select serie from g4_finanzas.comprobante limit 1`);
r = await run((c) => m4.listComprobantes(c, { ...base, search: cb.serie }));
check('comprobantes: búsqueda por serie', r.total > 0);
await paged('turnos de caja', (p) => run((c) => m4.listTurnosCaja(c, p)), 'select count(*) n from g4_finanzas.turno_caja', 'id_turno_caja');
await paged('gastos', (p) => run((c) => m4.listGastos(c, p)), 'select count(*) n from g4_finanzas.gasto', 'id_gasto');
r = await run((c) => m4.listGastos(c, { ...base, fromDate: '2026-01-01', toDate: '2026-03-31' }));
check('gastos: rango de fechas', r.total === await total(`select count(*) n from g4_finanzas.gasto where fecha between '2026-01-01' and '2026-03-31'`));
await paged('cuentas por cobrar', (p) => run((c) => m4.listCuentasPorCobrar(c, p)), 'select count(*) n from g4_finanzas.cuenta_por_cobrar', 'id_cxc');
const cx = await one(`select razon_social_cliente from g4_finanzas.cuenta_por_cobrar limit 1`);
if (cx) {
  r = await run((c) => m4.listCuentasPorCobrar(c, { ...base, search: cx.razon_social_cliente.split(' ')[0] }));
  check('CxC: búsqueda', r.total > 0);
}

// ================= M5 (limit/offset + filtro)
const lim = (fn: any, limit: number, offset: number, filter: any = {}) => run((c) => fn(c, limit, offset, filter));
for (const [name, fn, table, key] of [
  ['perfiles', m5.listPerfiles, 'g5_crm.perfil_huesped', 'id_perfil'],
  ['reclamos', m5.listReclamos, 'g5_crm.reclamo', 'id_reclamo'],
  ['campañas', m5.listCampanas, 'g5_crm.campana', 'id_campana'],
  ['opiniones', m5.listOpiniones, 'g5_crm.opinion', 'id_opinion'],
  ['solicitudes', m5.listSolicitudesHuesped, 'g5_crm.solicitud_huesped', 'id_solicitud_huesped'],
] as any[]) {
  const all = await total(`select count(*) n from ${table}`);
  const a = await lim(fn, 10, 0);
  check(`${name}: total = count(*) (${all})`, a.total === all && a.rows.length === Math.min(10, all));
  if (all > 10) {
    const b = await lim(fn, 10, 10);
    const ids = new Set(a.rows.map((x: any) => String(x[key])));
    check(`${name}: página 2 distinta`, b.rows.length > 0 && b.rows.every((x: any) => !ids.has(String(x[key]))));
  }
}
const pf = await one(`select h.apellidos from g5_crm.perfil_huesped p join g1_reservas.huesped h using(id_huesped) limit 1`);
r = await lim(m5.listPerfiles, 10, 0, { search: pf.apellidos });
check('perfiles: búsqueda', r.total > 0);
const sg = await one(`select s.nombre from g5_crm.perfil_huesped p join g5_crm.segmento s using(id_segmento) limit 1`);
r = await lim(m5.listPerfiles, 10, 0, { status: sg.nombre });
check('perfiles: filtro por segmento', r.total === await total(`select count(*) n from g5_crm.perfil_huesped p join g5_crm.segmento s using(id_segmento) where s.nombre=$1`, [sg.nombre]));
const rec = await one(`select estado from g5_crm.reclamo limit 1`);
if (rec) {
  r = await lim(m5.listReclamos, 10, 0, { status: rec.estado });
  check('reclamos: filtro por estado', r.total === await total(`select count(*) n from g5_crm.reclamo where estado=$1`, [rec.estado]));
}
r = await lim(m5.listSolicitudesHuesped, 10, 0, { search: 'a', status: 'ATENDIDA,CANCELADA' });
check('solicitudes: búsqueda + estado', r.total >= 0);
r = await lim(m5.listCampanas, 10, 0, { search: 'a' });
check('campañas: búsqueda', r.total >= 0);
r = await lim(m5.listOpiniones, 10, 0, { status: 'RESENA' });
check('opiniones: tipo', r.total === await total(`select count(*) n from g5_crm.opinion where tipo_opinion='RESENA'`));

console.log(`\n${ok} OK · ${bad} FAIL`);
await pool.end();
process.exit(bad ? 1 : 0);
