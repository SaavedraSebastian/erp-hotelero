process.env.DATABASE_URL = 'postgres://postgres@127.0.0.1:55432/sgh';
process.env.DATABASE_SSL = 'false';
const { getDatabasePool } = await import('../server/config/database.ts');
const pool = getDatabasePool();
const wc = async (fn: (c: any) => Promise<any>) => { const c = await pool.connect(); try { return await fn(c); } finally { c.release(); } };
const P = { page: 1, pageSize: 5, sortOrder: 'desc' } as any;

const m1 = await import('../server/modules/m1/repository.ts');
const m2 = await import('../server/modules/m2/repository.ts');
const m3 = await import('../server/modules/m3/repository.ts');
const m4 = await import('../server/modules/m4/repository.ts');
const m5 = await import('../server/modules/m5/repository.ts');
const dash = await import('../server/modules/dashboard/routes.ts');
const aud = await import('../server/modules/auditoria/routes.ts');

const ctx = { authUserId: '00000000-0000-0000-0000-000000000000', codigoUsuario: 'verif' } as any;
const tests: Array<[string, () => Promise<any>]> = [
  ['m1 habitaciones', () => wc((c) => m1.listHabitaciones(c, P))],
  ['m1 huespedes', () => wc((c) => m1.listHuespedes(c, P))],
  ['m1 tarifas', () => wc((c) => m1.listTarifas(c))],
  ['m1 reservas', () => wc((c) => m1.listReservas(c, P))],
  ['m1 lista-espera', () => wc((c) => m1.listListaEspera(c, P))],
  ['m2 estados', () => wc((c) => m2.listEstadosHabitacion(c))],
  ['m2 ordenes-limpieza', () => wc((c) => m2.listOrdenesLimpieza(c, P))],
  ['m2 incidencias', () => wc((c) => m2.listIncidencias(c, P))],
  ['m2 ordenes-trabajo', () => wc((c) => m2.listOrdenesTrabajo(c, P))],
  ['m2 insumos', () => wc((c) => m2.listInsumos(c))],
  ['m3 catalogo', () => wc((c) => m3.listCatalogo(c))],
  ['m3 comandas', () => wc((c) => m3.listComandas(c, P))],
  ['m3 consumos', () => wc((c) => m3.listConsumos(c, P))],
  ['m3 inventario', () => wc((c) => m3.listInventario(c, P))],
  ['m3 ordenes-compra', () => wc((c) => m3.listOrdenesCompra(c, P))],
  ['m4 cuentas', () => wc((c) => m4.listCuentas(c, { ...P, status: 'ACTIVA' }))],
  ['m4 comprobantes', () => wc((c) => m4.listComprobantes(c, P))],
  ['m4 turnos', () => wc((c) => m4.listTurnosCaja(c, P))],
  ['m4 gastos', () => wc((c) => m4.listGastos(c, P))],
  ['m4 cxc', () => wc((c) => m4.listCuentasPorCobrar(c, P))],
  ['m4 alertas', () => wc((c) => m4.listAlertasFinancieras(c, P))],
  ['m5 perfiles', () => wc((c) => m5.listPerfiles(c, 5, 0))],
  ['m5 segmentos', () => wc((c) => m5.listSegmentosDistribucion(c))],
  ['m5 reclamos', () => wc((c) => m5.listReclamos(c, 5, 0))],
  ['m5 campanas', () => wc((c) => m5.listCampanas(c, 5, 0))],
  ['m5 opiniones', () => wc((c) => m5.listOpiniones(c, 5, 0))],
  ['m5 solicitudes', () => wc((c) => m5.listSolicitudesHuesped(c, 5, 0))],
  ['dashboard resumen', async () => dash.getDashboardResumenService(ctx)],
  ['auditoria bitacoras', async () => aud.listBitacorasPorModulo(ctx, 'ALL', 1, 5)],
];
let ok = 0, bad = 0;
for (const [name, fn] of tests) {
  try {
    const r = await fn();
    const n = Array.isArray(r) ? r.length : Array.isArray(r?.rows) ? `${r.rows.length}/${r.total}` : Array.isArray(r?.data) ? r.data.length : 'obj';
    console.log(`OK   ${name} (${n})`); ok++;
  } catch (e: any) { console.log(`FAIL ${name}: ${String(e.message).split('\n')[0]}`); bad++; }
}
console.log(`\n${ok} OK · ${bad} FAIL`);
await pool.end();
