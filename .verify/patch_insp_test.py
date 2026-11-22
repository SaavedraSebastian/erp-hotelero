p = '.verify/gestion3-http.ts'
s = open(p, encoding='utf-8').read()
a = s.index("r = await call('GET', '/m2/inspecciones');\nconst insp")
b = s.index("currentCtx = cajero;\nr = await call('GET', '/m2/inspecciones');")
new = """r = await call('GET', '/m2/inspecciones?page=1&pageSize=20');
const insp = r.json?.data;
const total = await one(`select count(*)::int n from g2_housekeeping.inspeccion`);
check('GET inspecciones => 200 paginado', r.status === 200 && Array.isArray(insp) && insp.length === Math.min(20, total.n) && r.json.pagination.total === total.n, JSON.stringify(r).slice(0, 200));
check('  campos esperados', ['id_inspeccion', 'numero_orden', 'resultado', 'lista_verificacion', 'fecha_hora', 'numero_habitacion', 'supervisor'].every((k) => k in insp[0]), JSON.stringify(insp[0]));
check('  orden por fecha descendente', insp.every((x: any, i: number) => i === 0 || new Date(insp[i - 1].fecha_hora) >= new Date(x.fecha_hora)));
check('  hay supervisor con nombre', insp.some((x: any) => x.supervisor));
const r2 = await call('GET', '/m2/inspecciones?page=2&pageSize=20');
check('  página 2 distinta', r2.json.data.length > 0 && r2.json.data.every((x: any) => !insp.some((y: any) => y.id_inspeccion === x.id_inspeccion)));
const rr = await call('GET', '/m2/inspecciones?pageSize=100&status=' + encodeURIComponent('No conforme'));
const nc = await one(`select count(*)::int n from g2_housekeeping.inspeccion where resultado='No conforme'`);
check('  filtro por resultado', rr.json.pagination.total === nc.n && rr.json.data.every((x: any) => x.resultado === 'No conforme'));
const hn = insp[0].numero_habitacion;
const rs = await call('GET', '/m2/inspecciones?pageSize=100&search=' + encodeURIComponent(hn));
check('  búsqueda por habitación', rs.json.data.length > 0);
"""
s = s[:a] + new + s[b:]
s = s.replace("currentCtx = cajero;\nr = await call('GET', '/m2/inspecciones');", "currentCtx = cajero;\nr = await call('GET', '/m2/inspecciones?page=1');")
open(p + '.tmp', 'w', encoding='utf-8').write(s)
import os; os.replace(p + '.tmp', p)
