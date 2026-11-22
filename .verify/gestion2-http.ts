process.env.DATABASE_URL = 'postgres://postgres@127.0.0.1:55432/sgh';
process.env.DATABASE_SSL = 'false';
import express, { Router } from 'express';
const { getDatabasePool } = await import('../server/config/database.ts');
const { errorHandler } = await import('../server/middleware/error-handler.ts');
const { registerM2Gestion } = await import('../server/modules/gestion/m2.ts');
const { registerM3Gestion } = await import('../server/modules/gestion/m3.ts');
const s3 = await import('../server/modules/m3/service.ts');
const m3repo = await import('../server/modules/m3/repository.ts');
const pool = getDatabasePool();
const one = async (sql: string, p: any[] = []) => (await pool.query(sql, p)).rows[0];
const rows = async (sql: string, p: any[] = []) => (await pool.query(sql, p)).rows;
const stockOf = async (id: string) => Number((await one(`select coalesce(sum(cantidad_disponible),0)::text s from g3_servicios.lote_articulo where id_articulo=$1`, [id])).s);

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
const uniq = String(Date.now() % 100000);

// ================= STOCK: los movimientos ahora mueven los lotes
const ART = 'ART-ACE';
const s0 = await stockOf(ART);
const mov = (tipo: string, signo: 'entrada' | 'salida', cantidad: number, extra: any = {}) =>
  s3.registrarMovimientoInventarioService(admin, { id_articulo: ART, tipo_movimiento: tipo, cantidad, signo, motivo: 'Prueba de stock', id_origen: 'MANUAL', modulo_origen: 'Almacén', costo_unitario: '2.50', ...extra } as any);
let r1: any = await mov('Entrada', 'entrada', 5);
check('entrada: el stock sube (suma de lotes)', (await stockOf(ART)) === s0 + 5 && Number(r1.saldo_posterior) === s0 + 5, `${await stockOf(ART)} vs ${s0 + 5}`);
const lastMov = await one(`select id_lote, cantidad::text c from g3_servicios.movimiento_inventario where id_articulo=$1 order by fecha_hora desc, id_movimiento limit 1`, [ART]);
check('  el movimiento queda ligado a un lote nuevo', !!lastMov.id_lote);
r1 = await mov('Salida', 'salida', 3);
check('salida: el stock baja', (await stockOf(ART)) === s0 + 2, `${await stockOf(ART)}`);
let threw = false; try { await mov('Salida', 'salida', (await stockOf(ART)) + 1); } catch (e: any) { threw = e.statusCode === 422; }
check('salida mayor al stock => 422 y no cambia nada', threw && (await stockOf(ART)) === s0 + 2);
// FIFO por vencimiento con dos lotes
const artTest = `ART-T${uniq}`;
await pool.query(`insert into g3_servicios.articulo_almacen (id_articulo,id_categoria,id_unidad_medida,nombre,vende_tal_cual,es_insumo,vence,dias_aviso_vencimiento,stock_minimo,estado) values ($1,'CA-ABA','UM-KG',$2,false,true,true,5,1,'activo')`, [artTest, `Artículo FIFO ${uniq}`]);
await pool.query(`insert into g3_servicios.lote_articulo (id_lote,id_articulo,fecha_vencimiento,cantidad_disponible,costo_unitario) values ('L-A-${uniq}',$1,'2031-06-30',4,1),('L-B-${uniq}',$1,'2031-03-01',4,1)`, [artTest]);
await s3.registrarMovimientoInventarioService(admin, { id_articulo: artTest, tipo_movimiento: 'Salida', cantidad: 6, signo: 'salida', motivo: 'FIFO prueba', id_origen: 'MANUAL', modulo_origen: 'Almacén' } as any);
const lotes = await rows(`select id_lote, cantidad_disponible::text c from g3_servicios.lote_articulo where id_articulo=$1 order by id_lote`, [artTest]);
check('FIFO: consume primero el lote que vence antes (B: 4->0) y luego A (4->2)', lotes.find((l) => l.id_lote === `L-B-${uniq}`).c === '0.000' && lotes.find((l) => l.id_lote === `L-A-${uniq}`).c === '2.000', JSON.stringify(lotes));
const movs = await rows(`select cantidad::text c, saldo_posterior::text s from g3_servicios.movimiento_inventario where id_articulo=$1 order by fecha_hora, saldo_posterior desc`, [artTest]);
check('  y deja un movimiento por lote con saldo coherente', movs.length === 2 && movs[1].s === '2.000', JSON.stringify(movs));
// confirmar consumo descuenta stock del artículo ligado
const itemLig = await one(`select ic.id_item_catalogo id, ic.id_punto_venta pv, ic.id_articulo_descuento art from g3_servicios.item_catalogo ic where ic.id_articulo_descuento is not null and ic.estado='activo' limit 1`);
if (itemLig) {
  const antes = await stockOf(itemLig.art);
  const con = await s3.createConsumoService(admin, { id_punto_venta: itemLig.pv, forma_cobro: 'pago directo', items: [{ id_item_catalogo: itemLig.id, cantidad: 1 }] } as any);
  await s3.confirmarConsumoService(admin, con.numero_consumo);
  const despues = await stockOf(itemLig.art);
  check('confirmar un consumo descuenta el stock del artículo ligado', antes > 0 ? despues === antes - 1 : despues === 0, `${antes} -> ${despues}`);
}

// ================= ARTÍCULOS
let r: any = await call('POST', '/m3/articulos', { nombre: `Harina Integral ${uniq}`, id_categoria: 'CA-ABA', id_unidad_medida: 'UM-KG', vence: true, dias_aviso_vencimiento: 10, stock_minimo: 5, stock_inicial: 20, costo_unitario: '3.25', fecha_vencimiento: '2031-08-01' });
check('POST articulos => 201', r.status === 201 && /^ART-HAR\d*$/.test(r.json.data.id_articulo) && Number(r.json.data.stock_actual) === 20, JSON.stringify(r.json).slice(0, 220));
const art = r.json?.data;
const lote = art && (await one(`select cantidad_disponible::text c, costo_unitario::text k, fecha_vencimiento::text v from g3_servicios.lote_articulo where id_articulo=$1`, [art.id_articulo]));
check('  crea su lote con costo y vencimiento', lote?.c === '20.000' && lote?.k === '3.2500' && lote?.v === '2031-08-01', JSON.stringify(lote));
check('  y el movimiento "Stock inicial"', !!(await one(`select 1 from g3_servicios.movimiento_inventario where id_articulo=$1 and tipo_movimiento='Stock inicial'`, [art.id_articulo])));
r = await call('POST', '/m3/articulos', { nombre: `Harina Integral ${uniq}`, id_categoria: 'CA-ABA', id_unidad_medida: 'UM-KG', stock_minimo: 1 });
check('nombre duplicado => 409', r.status === 409, `status ${r.status}`);
r = await call('POST', '/m3/articulos', { nombre: `Sin fecha ${uniq}`, id_categoria: 'CA-ABA', id_unidad_medida: 'UM-KG', vence: true, stock_minimo: 1, stock_inicial: 5 });
check('vence + stock sin fecha => 400', r.status === 400);
r = await call('POST', '/m3/articulos', { nombre: `Cat mala ${uniq}`, id_categoria: 'NO-EXISTE', id_unidad_medida: 'UM-KG', stock_minimo: 1 });
check('categoría inexistente => 422', r.status === 422, `status ${r.status}`);
r = await call('POST', '/m3/articulos', { nombre: `Sin stock ${uniq}`, id_categoria: 'CA-LIM', id_unidad_medida: 'UM-LT', stock_minimo: 2 });
check('artículo sin stock inicial => 201 y sin lotes', r.status === 201 && Number(r.json.data.stock_actual) === 0 && !(await one(`select 1 from g3_servicios.lote_articulo where id_articulo=$1`, [r.json.data.id_articulo])));

// ================= CATÁLOGO
const cat = await m3repo.listCatalogo(await pool.connect());
check('catálogo incluye categorías y unidades', cat.categorias.length >= 18 && cat.unidades.length >= 7 && cat.categorias.some((c: any) => c.uso === 'catálogo'));
r = await call('POST', '/m3/catalogo', { id_punto_venta: 'PV-REST', id_categoria: 'CM-FON', nombre: `Trucha al ajillo ${uniq}`, tipo_item: 'plato', precio_vigente: '58.00', id_articulo_descuento: art.id_articulo });
check('POST catalogo => 201', r.status === 201 && /^IT-TRU\d*$/.test(r.json.data.id_item_catalogo) && r.json.data.precio_vigente === '58.00' && r.json.data.estado === 'activo', JSON.stringify(r.json).slice(0, 220));
const item = r.json?.data;
const cc = await one(`select condicion_cobro from g3_servicios.item_catalogo where id_item_catalogo=$1`, [item.id_item_catalogo]);
check('  condición de cobro por pedido', cc.condicion_cobro === 'por pedido');
r = await call('POST', '/m3/catalogo', { id_punto_venta: 'PV-REST', id_categoria: 'CM-FON', nombre: `Trucha al ajillo ${uniq}`, tipo_item: 'plato', precio_vigente: '58' });
check('ítem duplicado en el mismo punto => 409', r.status === 409, `status ${r.status}`);
r = await call('POST', '/m3/catalogo', { id_punto_venta: 'PV-SPA', id_categoria: 'CM-SPA', nombre: `Masaje de piedras ${uniq}`, tipo_item: 'servicio', precio_vigente: '210', duracion_estimada: 75 });
check('servicio => condición "por servicio"', r.status === 201 && (await one(`select condicion_cobro c, duracion_estimada d from g3_servicios.item_catalogo where id_item_catalogo=$1`, [r.json.data.id_item_catalogo])).c === 'por servicio');
r = await call('POST', '/m3/catalogo', { id_punto_venta: 'PV-NO', id_categoria: 'CM-FON', nombre: 'Punto inexistente', tipo_item: 'plato', precio_vigente: '10' });
check('punto de venta inexistente => 422', r.status === 422);
r = await call('PUT', `/m3/catalogo/${item.id_item_catalogo}`, { nombre: `Trucha al ajillo (carta) ${uniq}`, duracion_estimada: 20 });
check('PUT catalogo (renombrar)', r.status === 200 && r.json.data.nombre.startsWith('Trucha al ajillo (carta)'));
r = await call('PUT', `/m3/catalogo/${item.id_item_catalogo}`, { estado: 'inactivo' });
check('desactivar sin motivo => 400', r.status === 400);
r = await call('PUT', `/m3/catalogo/${item.id_item_catalogo}`, { estado: 'inactivo', motivo_desactivacion: 'Fuera de temporada' });
check('desactivar con motivo', r.status === 200 && r.json.data.estado === 'inactivo');
r = await call('PUT', `/m3/catalogo/${item.id_item_catalogo}`, { estado: 'activo' });
const reac = await one(`select estado, motivo_desactivacion m from g3_servicios.item_catalogo where id_item_catalogo=$1`, [item.id_item_catalogo]);
check('reactivar limpia el motivo', reac.estado === 'activo' && reac.m === null);
r = await call('PUT', `/m3/catalogo/NO-EXISTE`, { nombre: 'No existe xx' });
check('ítem inexistente => 404', r.status === 404);
// el cambio de precio existente sigue dejando historial
await s3.actualizarPrecioItemService(admin, item.id_item_catalogo, '61.50', 'Ajuste de temporada');
check('cambio de precio deja historial', !!(await one(`select 1 from g3_servicios.historial_precio_item where id_item_catalogo=$1 and precio_nuevo=61.50`, [item.id_item_catalogo])));

// ================= RECETAS
const ing2 = (await one(`select id_articulo id from g3_servicios.articulo_almacen where id_articulo not in ($1) order by id_articulo limit 1`, [art.id_articulo])).id;
r = await call('POST', '/m3/recetas', { id_item_catalogo: item.id_item_catalogo, ingredientes: [{ id_articulo: art.id_articulo, cantidad_por_porcion: 0.25 }, { id_articulo: ing2, cantidad_por_porcion: 0.1 }] });
check('POST recetas => v1', r.status === 201 && r.json.data.numero_version === 1 && r.json.data.ingredientes === 2, JSON.stringify(r.json).slice(0, 200));
r = await call('GET', '/m3/recetas');
const rec = r.json.data.find((x: any) => x.id_item_catalogo === item.id_item_catalogo);
check('GET recetas trae ingredientes con unidad y costo', r.status === 200 && rec?.ingredientes.length === 2 && rec.ingredientes.some((i: any) => i.id_articulo === art.id_articulo && i.costo_unitario === '3.2500' && i.unidad === 'kg'), JSON.stringify(rec).slice(0, 300));
r = await call('POST', '/m3/recetas', { id_item_catalogo: item.id_item_catalogo, ingredientes: [{ id_articulo: art.id_articulo, cantidad_por_porcion: 0.3 }] });
check('nueva versión => v2', r.status === 201 && r.json.data.numero_version === 2);
const estados = await rows(`select numero_version v, estado e, vigente_hasta is not null h from g3_servicios.receta where id_item_catalogo=$1 order by 1`, [item.id_item_catalogo]);
check('  la anterior queda reemplazada y solo hay una vigente', estados.length === 2 && estados[0].e === 'reemplazada' && estados[0].h && estados[1].e === 'vigente', JSON.stringify(estados));
r = await call('GET', '/m3/recetas');
check('  GET solo muestra la vigente (1 línea de ingredientes)', r.json.data.filter((x: any) => x.id_item_catalogo === item.id_item_catalogo).length === 1 && r.json.data.find((x: any) => x.id_item_catalogo === item.id_item_catalogo).ingredientes.length === 1);
r = await call('POST', '/m3/recetas', { id_item_catalogo: item.id_item_catalogo, ingredientes: [{ id_articulo: art.id_articulo, cantidad_por_porcion: 1 }, { id_articulo: art.id_articulo, cantidad_por_porcion: 2 }] });
check('ingrediente repetido => 400', r.status === 400);
r = await call('POST', '/m3/recetas', { id_item_catalogo: item.id_item_catalogo, ingredientes: [] });
check('receta vacía => 400', r.status === 400);
r = await call('POST', '/m3/recetas', { id_item_catalogo: 'IT-NO', ingredientes: [{ id_articulo: art.id_articulo, cantidad_por_porcion: 1 }] });
check('ítem inexistente => 404', r.status === 404);
r = await call('POST', '/m3/recetas', { id_item_catalogo: item.id_item_catalogo, ingredientes: [{ id_articulo: 'ART-NO', cantidad_por_porcion: 1 }] });
check('artículo inexistente => 422 y la versión vigente no se pierde', r.status === 422 && !!(await one(`select 1 from g3_servicios.receta where id_item_catalogo=$1 and estado='vigente'`, [item.id_item_catalogo])), `status ${r.status}`);

// ================= REQUISICIONES (Housekeeping pide, Almacén atiende)
const jab = await one(`select i.id_insumo::text id, i.stock_actual::text s from g2_housekeeping.insumo i where i.id_articulo='ART-JAB'`);
await s3.registrarMovimientoInventarioService(admin, { id_articulo: 'ART-JAB', tipo_movimiento: 'Entrada', cantidad: 100, signo: 'entrada', motivo: 'Stock para pruebas', id_origen: 'MANUAL', modulo_origen: 'Almacén', costo_unitario: '1.00' } as any);
const stockJab0 = await stockOf('ART-JAB');
r = await call('POST', '/m2/requisiciones', { id_articulo: 'ART-JAB', cantidad: 30 });
check('M2 crea requisición => 201 con código SRP-fecha-artículo', r.status === 201 && /^SRP-\d{4}-\d{2}-\d{2}-ART-JAB(-\d+)?$/.test(r.json.data.id) && r.json.data.estado === 'pendiente', JSON.stringify(r.json).slice(0, 200));
const sr1 = r.json?.data;
r = await call('POST', '/m2/requisiciones', { id_articulo: 'ART-JAB', cantidad: 10 });
check('segunda del mismo día no choca (sufijo)', r.status === 201 && r.json.data.id !== sr1.id, JSON.stringify(r.json).slice(0, 160));
const sr2 = r.json?.data;
r = await call('POST', '/m2/requisiciones', { id_articulo: 'ART-NO', cantidad: 1 });
check('artículo inexistente => 422', r.status === 422);
r = await call('POST', '/m2/requisiciones', { id_articulo: 'ART-JAB', cantidad: 0 });
check('cantidad 0 => 400', r.status === 400);
r = await call('GET', '/m3/requisiciones');
check('GET requisiciones: pendientes primero, con stock', r.status === 200 && r.json.data[0].estado === 'pendiente' && 'stock_actual' in r.json.data[0] && r.json.data.some((x: any) => x.id === sr1.id));
r = await call('POST', `/m3/requisiciones/${sr1.id}/atender`, {});
check('atender (total) => atendida', r.status === 200 && r.json.data.estado === 'atendida' && Number(r.json.data.cantidad_atendida) === 30, JSON.stringify(r.json).slice(0, 200));
check('  baja el stock de almacén', (await stockOf('ART-JAB')) === stockJab0 - 30, `${await stockOf('ART-JAB')} vs ${stockJab0 - 30}`);
const jab1 = await one(`select stock_actual::text s from g2_housekeeping.insumo where id_insumo=$1::bigint`, [jab.id]);
check('  y sube el stock local de Housekeeping', Number(jab1.s) === Number(jab.s) + 30, `${jab.s} -> ${jab1.s}`);
r = await call('POST', `/m3/requisiciones/${sr1.id}/atender`, {});
check('atender dos veces => 422', r.status === 422);
r = await call('POST', `/m3/requisiciones/${sr2.id}/atender`, { cantidad: 4 });
check('atender parcial => parcialmente atendida', r.status === 200 && r.json.data.estado === 'parcialmente atendida' && Number(r.json.data.cantidad_atendida) === 4, JSON.stringify(r.json).slice(0, 200));
const sr3 = (await call('POST', '/m2/requisiciones', { id_articulo: 'ART-JAB', cantidad: 5 })).json.data;
r = await call('POST', `/m3/requisiciones/${sr3.id}/atender`, { cantidad: 9 });
check('despachar más de lo solicitado => 422', r.status === 422);
const srBig = (await call('POST', '/m2/requisiciones', { id_articulo: 'ART-JAB', cantidad: 900000 })).json.data;
const stockAntes = await stockOf('ART-JAB');
r = await call('POST', `/m3/requisiciones/${srBig.id}/atender`, {});
check('sin stock suficiente => 422 y no cambia nada', r.status === 422 && (await stockOf('ART-JAB')) === stockAntes && (await one(`select estado e from g3_servicios.solicitud_reposicion where id_solicitud_externa=$1`, [srBig.id])).e === 'pendiente', JSON.stringify(r.json).slice(0, 160));
r = await call('POST', `/m3/requisiciones/${srBig.id}/rechazar`, { motivo: 'Sin stock; se generará orden de compra' });
check('rechazar => no atendida con motivo', r.status === 200 && r.json.data.estado === 'no atendida');
r = await call('POST', `/m3/requisiciones/${srBig.id}/rechazar`, { motivo: 'Segundo intento válido' });
check('rechazar una ya cerrada => 422', r.status === 422);
r = await call('POST', `/m3/requisiciones/NO-EXISTE/atender`, {});
check('requisición inexistente => 404', r.status === 404);

// ================= ACTIVOS
r = await call('GET', '/m2/catalogos');
check('GET catálogos M2', r.status === 200 && r.json.data.tipos_activo.length >= 9 && r.json.data.areas.length >= 5);
const tipoA = r.json.data.tipos_activo[0], area = r.json.data.areas[0];
r = await call('GET', '/m2/activos');
check('GET activos (con ubicación y probabilidad de falla)', r.status === 200 && r.json.data.length >= 168 && 'numero_habitacion' in r.json.data[0] && r.json.data.some((a: any) => a.probabilidad_falla !== null));
const n0 = r.json.data.length;
r = await call('POST', '/m2/activos', { nombre: `Bomba de recirculación ${uniq}`, id_tipo_activo: tipoA.id, id_area: area.id, marca: 'Pedrollo', modelo: 'PK-60', fecha_instalacion: '2026-10-01', horas_uso_acumuladas: 120 });
check('POST activos (en un área) => 201 con código ACT-nnnnn', r.status === 201 && /^ACT-\d{5}$/.test(r.json.data.codigo_activo) && r.json.data.estado === 'Operativo', JSON.stringify(r.json).slice(0, 200));
const act = r.json?.data;
check('  el código es consecutivo', Number(act.codigo_activo.slice(4)) === n0 + 1 || Number(act.codigo_activo.slice(4)) > n0, act.codigo_activo);
r = await call('POST', '/m2/activos', { nombre: `Aire hab ${uniq}`, id_tipo_activo: tipoA.id, id_habitacion: '3', fecha_instalacion: '2026-10-01' });
check('POST activos (en una habitación) => 201', r.status === 201);
r = await call('POST', '/m2/activos', { nombre: `Ambos ${uniq}`, id_tipo_activo: tipoA.id, id_habitacion: '3', id_area: area.id, fecha_instalacion: '2026-10-01' });
check('habitación y área a la vez => 400', r.status === 400);
r = await call('POST', '/m2/activos', { nombre: `Ninguno ${uniq}`, id_tipo_activo: tipoA.id, fecha_instalacion: '2026-10-01' });
check('sin ubicación => 400', r.status === 400);
r = await call('POST', '/m2/activos', { nombre: `Tipo malo ${uniq}`, id_tipo_activo: '9999', id_area: area.id, fecha_instalacion: '2026-10-01' });
check('tipo inexistente => 422', r.status === 422);
r = await call('PUT', `/m2/activos/${act.id_activo}`, { estado: 'En reparación', horas_uso_acumuladas: 150, marca: null });
check('PUT activos', r.status === 200 && r.json.data.estado === 'En reparación');
r = await call('PUT', `/m2/activos/99999999`, { estado: 'Operativo' });
check('activo inexistente => 404', r.status === 404);
r = await call('PUT', `/m2/activos/${act.id_activo}`, { estado: 'Roto' });
check('estado inválido => 400', r.status === 400);

// ================= PREVENTIVO
r = await call('POST', '/m2/preventivo', { id_activo: act.id_activo, tarea: 'Revisión de sellos y rodamientos', tipo_periodicidad: 'Meses', valor_periodicidad: 3 });
check('POST preventivo => 201 con próxima fecha en +3 meses', r.status === 201 && !!r.json.data.fecha_proxima_ejecucion, JSON.stringify(r.json).slice(0, 220));
const esperado = (await one(`select (current_date + interval '3 month')::date::text d`)).d;
check('  fecha calculada correcta', r.json.data.fecha_proxima_ejecucion === esperado, `${r.json.data.fecha_proxima_ejecucion} vs ${esperado}`);
const plan1 = r.json?.data;
r = await call('POST', '/m2/preventivo', { id_activo: act.id_activo, tarea: 'Revisión de sellos y rodamientos', tipo_periodicidad: 'Meses', valor_periodicidad: 3 });
check('misma tarea al mismo activo => 409', r.status === 409, `status ${r.status}`);
const act2 = (await call('POST', '/m2/activos', { nombre: `Bomba gemela ${uniq}`, id_tipo_activo: tipoA.id, id_area: area.id, fecha_instalacion: '2026-10-01', horas_uso_acumuladas: 1000 })).json.data;
r = await call('POST', '/m2/preventivo', { id_activo: act2.id_activo, tarea: 'Revisión de sellos y rodamientos', tipo_periodicidad: 'Meses', valor_periodicidad: 3, fecha_proxima: '2027-01-15' });
check('otro activo del mismo tipo reutiliza el plan y respeta la fecha dada', r.status === 201 && r.json.data.id_plan === plan1.id_plan && r.json.data.fecha_proxima_ejecucion === '2027-01-15', JSON.stringify(r.json).slice(0, 220));
r = await call('POST', '/m2/preventivo', { id_activo: act2.id_activo, tarea: 'Cambio de aceite cada 500 h', tipo_periodicidad: 'HorasUso', valor_periodicidad: 500 });
check('por horas de uso => sin fecha y horas próximas = 1000 + 500', r.status === 201 && r.json.data.fecha_proxima_ejecucion === null && (await one(`select horas_proxima_ejecucion::text h from g2_housekeeping.programacion_preventiva where id_plan=$1::bigint and id_activo=$2::bigint`, [r.json.data.id_plan, act2.id_activo])).h === '1500', JSON.stringify(r.json).slice(0, 200));
const planH = r.json?.data;
r = await call('POST', '/m2/preventivo', { id_activo: '99999999', tarea: 'Tarea cualquiera', tipo_periodicidad: 'Días', valor_periodicidad: 7 });
check('activo inexistente => 404', r.status === 404);
r = await call('POST', '/m2/preventivo', { id_activo: act.id_activo, tarea: 'abc', tipo_periodicidad: 'Años', valor_periodicidad: 0 });
check('datos inválidos => 400', r.status === 400);
r = await call('GET', '/m2/preventivo');
check('GET preventivo con ubicación y tarea', r.status === 200 && r.json.data.length >= 168 && r.json.data.some((x: any) => x.id_activo === act.id_activo && x.tarea.startsWith('Revisión de sellos') && x.ubicacion));
r = await call('POST', `/m2/preventivo/${plan1.id_plan}/${act.id_activo}/ejecutar`);
check('ejecutar => última hoy y próxima +3 meses', r.status === 200 && r.json.data.fecha_ultima_ejecucion === (await one(`select current_date::text d`)).d && r.json.data.fecha_proxima_ejecucion === esperado, JSON.stringify(r.json).slice(0, 200));
r = await call('POST', `/m2/preventivo/${planH.id_plan}/${act2.id_activo}/ejecutar`);
const ph = await one(`select horas_ultima_ejecucion::text u, horas_proxima_ejecucion::text p, fecha_proxima_ejecucion f from g2_housekeeping.programacion_preventiva where id_plan=$1::bigint and id_activo=$2::bigint`, [planH.id_plan, act2.id_activo]);
check('ejecutar por horas => próxima = horas actuales + 500', r.status === 200 && ph.u === '1000' && ph.p === '1500' && ph.f === null, JSON.stringify(ph));
r = await call('POST', `/m2/preventivo/999999/${act.id_activo}/ejecutar`);
check('programación inexistente => 404', r.status === 404);

// ================= permisos
currentCtx = cajero;
for (const [m, p, b] of [['POST', '/m3/articulos', { nombre: 'No debe crearse', id_categoria: 'CA-ABA', id_unidad_medida: 'UM-KG', stock_minimo: 1 }], ['POST', '/m3/catalogo', { id_punto_venta: 'PV-REST', id_categoria: 'CM-FON', nombre: 'No debe crearse', tipo_item: 'plato', precio_vigente: '1' }], ['POST', '/m3/recetas', { id_item_catalogo: item.id_item_catalogo, ingredientes: [{ id_articulo: art.id_articulo, cantidad_por_porcion: 1 }] }], ['POST', `/m3/requisiciones/${sr3.id}/atender`, {}], ['POST', '/m2/activos', { nombre: 'No debe crearse', id_tipo_activo: tipoA.id, id_area: area.id, fecha_instalacion: '2026-01-01' }], ['POST', '/m2/requisiciones', { id_articulo: 'ART-JAB', cantidad: 1 }], ['GET', '/m3/recetas', undefined]] as any[]) {
  r = await call(m, p, b);
  check(`sin permiso: ${m} ${p.split('/').slice(0, 3).join('/')} => 403`, r.status === 403, `status ${r.status}`);
}

console.log(`\n${ok} OK · ${bad} FAIL`);
server.close();
await pool.end();
