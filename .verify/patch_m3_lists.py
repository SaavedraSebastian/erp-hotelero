import os, re

def rw(p, fn):
    s = open(p, encoding='utf-8').read()
    s = fn(s)
    open(p + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(p + '.tmp', p)

def rep(s, a, b, count=1):
    assert s.count(a) == count, (a[:80], s.count(a))
    return s.replace(a, b)

# ---------- helper para contenedores ya existentes en las plantillas
def pv(s):
    return s + '''
/**
 * Igual que bindPagedView, pero crea los espacios de filtros y pie alrededor de un contenedor que ya existe
 * en la plantilla (lista de filas, o un <tbody> dentro de una tabla).
 */
export function bindPagedContainer({ container, ...config }) {
  const isBody = container.tagName === 'TBODY';
  const anchor = isBody ? container.closest('.table-scroll') ?? container.closest('table') : container;
  const filtersSlot = h('div', { className: 'p-3' });
  const footerSlot = h('div');
  anchor.before(filtersSlot);
  anchor.after(footerSlot);
  const asRows = (node) => (isBody && node ? h('tr', null, h('td', { colSpan: 20 }, node)) : node);
  return bindPagedView({
    ...config,
    filtersSlot,
    footerSlot,
    bodySlot: container,
    renderBody: (rows) => config.renderBody(rows),
    wrapEmpty: asRows,
  });
}
'''
rw('src/js/components/paged-view.js', pv)

def pv2(s):
    s = rep(s, "  noMatch = { iconName: 'search', title: 'Sin resultados', description: 'Prueba con otra búsqueda o limpia los filtros.' },\n}) {",
               "  noMatch = { iconName: 'search', title: 'Sin resultados', description: 'Prueba con otra búsqueda o limpia los filtros.' },\n  wrapEmpty = (node) => node,\n}) {")
    s = rep(s, "      mount(bodySlot, h('p', { className: 'text-xs text-slate-500 p-4' }, 'Cargando…'));", "      mount(bodySlot, wrapEmpty(h('p', { className: 'text-xs text-slate-500 p-4' }, 'Cargando…')));")
    s = rep(s, "      mount(bodySlot, EmptyState({ iconName: 'lock', title: 'Sin acceso', description: 'Tu rol no tiene permiso para ver estos datos.' }));", "      mount(bodySlot, wrapEmpty(EmptyState({ iconName: 'lock', title: 'Sin acceso', description: 'Tu rol no tiene permiso para ver estos datos.' })));")
    s = rep(s, """      mount(
        bodySlot,
        EmptyState({
          iconName: 'alertTriangle',
          title: 'No se pudo cargar',
          description: st.error.message || 'Error al leer la base de datos.',
          action: h('button', { type: 'button', className: 'btn btn-outline btn-sm', onClick: () => list.load() }, 'Reintentar'),
        })
      );""", """      mount(
        bodySlot,
        wrapEmpty(
          EmptyState({
            iconName: 'alertTriangle',
            title: 'No se pudo cargar',
            description: st.error.message || 'Error al leer la base de datos.',
            action: h('button', { type: 'button', className: 'btn btn-outline btn-sm', onClick: () => list.load() }, 'Reintentar'),
          })
        )
      );""")
    s = rep(s, "      mount(bodySlot, EmptyState(hasFilters() ? noMatch : empty));", "      mount(bodySlot, wrapEmpty(EmptyState(hasFilters() ? noMatch : empty)));")
    return s
rw('src/js/components/paged-view.js', pv2)

# ---------- mapeos
def mappers(s):
    s = rep(s, "      source: c.modalidad === 'habitación' ? 'Room Service' : 'Restaurante',\n      tableNumber: c.nombre_mesa_capturado || undefined,\n      roomId: '',\n      roomNumber: '',\n      guestName: '',",
               "      source: c.modalidad === 'habitación' ? 'Room Service' : 'Restaurante',\n      tableNumber: c.nombre_mesa_capturado || undefined,\n      roomId: '',\n      roomNumber: c.numero_habitacion || '',\n      guestName: c.huesped_nombre || '',")
    s = rep(s, "      source: /minibar/i.test(c.punto_venta_nombre || '') ? 'Minibar' : 'Servicios Complementarios',\n      roomId: '',\n      roomNumber: '',\n      guestName: '',",
               "      source: /minibar/i.test(c.punto_venta_nombre || '') ? 'Minibar' : 'Servicios Complementarios',\n      roomId: '',\n      roomNumber: c.numero_habitacion || '',\n      guestName: c.huesped_nombre || '',")
    s = rep(s, "/** Mapeos de filas sueltas (listados paginados). */", "/** Mapeos de filas sueltas (listados paginados). */\nexport const mapComandaRows = (rows) => mapM3({ comandas: rows }).posOrders;\nexport const mapConsumoRows = (rows) => mapM3({ consumos: rows }).posOrders;\nexport const mapPurchaseOrderRows = (rows) => mapM3({ ordenesCompra: rows }).purchaseOrders;")
    return s
rw('src/js/services/erp-mappers.js', mappers)

# ---------- adaptador
def adapter(s):
    s = rep(s, "    ['comandas', 'comandas', paged('/m3/comandas')],",
               "    ['comandas', 'comandas abiertas', paged(`/m3/comandas?status=${encodeURIComponent('pendiente,en preparación,lista')}`)],")
    s = rep(s, "    ['consumos', 'consumos', paged('/m3/consumos')],",
               "    ['consumos', 'consumos por confirmar', paged(`/m3/consumos?status=${encodeURIComponent('por confirmar')}`)],")
    s = rep(s, "    ['ordenesCompra', 'órdenes de compra', paged('/m3/ordenes-compra')],",
               "    ['ordenesCompra', 'órdenes de compra abiertas', paged(`/m3/ordenes-compra?status=${encodeURIComponent('pendiente de aprobación,aprobada,enviada,parcialmente recibida')}`)],")
    return s
rw('src/js/services/data-adapter.js', adapter)

# ---------- módulo
def mod(s):
    # --- restaurante: monitor de comandas
    a = s.index("      mountRef(\n        tabBody,\n        'orders-list',\n        state.posOrders.map((ord) => {")
    b = s.index("    } else if (activeTab === 'room_service') {")
    block = s[a:b]
    m = re.search(r"state\.posOrders\.map\(\(ord\) => \{(.*)\}\)\n      \);\n$", block, flags=re.S)
    assert m, 'restaurante'
    body = m.group(1)
    new = '''      const renderOrderRows = (rows) =>
        h('div', null, ...rows.map((ord) => {''' + body + '''}));
      bindPagedContainer({
        container: getRef(tabBody, 'orders-list'),
        key: 'm3.comandas',
        list: getPagedList('m3.comandas', { path: '/m3/comandas', map: mapComandaRows, pageSize: 20 }),
        filters: {
          searchPlaceholder: 'Buscar comanda, mesa, habitación o huésped…',
          dates: true,
          statusOptions: [
            { value: '', label: 'Todos los estados' },
            { value: 'pendiente,en preparación,lista', label: 'Abiertas' },
            { value: 'pendiente', label: 'Pendiente' },
            { value: 'en preparación', label: 'Preparando' },
            { value: 'lista', label: 'Lista' },
            { value: 'entregada', label: 'Entregada' },
            { value: 'cancelada', label: 'Cancelada' },
          ],
        },
        renderBody: renderOrderRows,
        empty: { iconName: 'utensils', title: 'Sin comandas', description: 'Aún no hay comandas registradas.' },
        noMatch: { iconName: 'utensils', title: 'Sin comandas coincidentes', description: 'Prueba con otro estado, fechas o búsqueda.' },
      });
'''
    s = s[:a] + new + s[b:]

    # --- room service
    a = s.index("      mountRef(\n        tabBody,\n        'orders-list',\n        orders.length === 0\n          ? h('div', { className: 'p-4' }, EmptyState({\n              iconName: 'utensils',\n              title: 'Sin pedidos recientes de Room Service',")
    b = s.index("    } else if (activeTab === 'minibar') {")
    block = s[a:b]
    m = re.search(r": orders\.map\(\(ord\) => \{(.*)\}\)\n      \);\n$", block, flags=re.S)
    assert m, 'room service'
    body = m.group(1)
    new = '''      const renderRoomServiceRows = (rows) =>
        h('div', null, ...rows.map((ord) => {''' + body + '''}));
      bindPagedContainer({
        container: getRef(tabBody, 'orders-list'),
        key: 'm3.roomservice',
        list: getPagedList('m3.roomservice', { path: '/m3/comandas?modalidad=' + encodeURIComponent('habitación'), map: mapComandaRows, pageSize: 20 }),
        filters: {
          searchPlaceholder: 'Buscar pedido, habitación o huésped…',
          dates: true,
          statusOptions: [
            { value: '', label: 'Todos los estados' },
            { value: 'pendiente,en preparación,lista', label: 'En curso' },
            { value: 'entregada', label: 'Entregado' },
            { value: 'cancelada', label: 'Cancelado' },
          ],
        },
        renderBody: renderRoomServiceRows,
        empty: { iconName: 'utensils', title: 'Sin pedidos de Room Service', description: 'Registra un pedido desde el formulario para cargarlo a la habitación.' },
        noMatch: { iconName: 'utensils', title: 'Sin pedidos coincidentes', description: 'Prueba con otro estado, fechas o búsqueda.' },
      });
'''
    s = s[:a] + new + s[b:]
    s = rep(s, "      const orders = state.posOrders.filter((o) => o.source === 'Room Service');\n", "")

    # --- minibar
    a = s.index("      mountRef(\n        tabBody,\n        'orders-list',\n        orders.length === 0\n          ? h('div', { className: 'p-4' }, EmptyState({\n              iconName: 'utensils',\n              title: 'Sin consumos de Minibar registrados',")
    b = s.index("    } else if (activeTab === 'servicios_comp') {")
    block = s[a:b]
    m = re.search(r": orders\.map\(\(ord\) => \{(.*)\}\)\n      \);\n$", block, flags=re.S)
    assert m, 'minibar'
    body = m.group(1)
    new = '''      const renderMinibarRows = (rows) =>
        h('div', null, ...rows.map((ord) => {''' + body + '''}));
      bindPagedContainer({
        container: getRef(tabBody, 'orders-list'),
        key: 'm3.minibar',
        list: getPagedList('m3.minibar', { path: '/m3/consumos?puntoVenta=PV-MINI', map: mapConsumoRows, pageSize: 20 }),
        filters: {
          searchPlaceholder: 'Buscar consumo, habitación o huésped…',
          dates: true,
        },
        renderBody: renderMinibarRows,
        empty: { iconName: 'utensils', title: 'Sin consumos de Minibar', description: 'Registra consumos desde el panel izquierdo.' },
        noMatch: { iconName: 'utensils', title: 'Sin consumos coincidentes', description: 'Prueba con otras fechas o búsqueda.' },
      });
'''
    s = s[:a] + new + s[b:]
    s = rep(s, "      const orders = state.posOrders.filter((o) => o.source === 'Minibar');\n", "")

    # --- órdenes de compra
    a = s.index("      mountRef(\n        tabBody,\n        'po-tbody',\n        state.purchaseOrders.map((po) => {")
    b = s.index("      mountRef(\n        tabBody,\n        'sup-grid',")
    block = s[a:b]
    m = re.search(r"state\.purchaseOrders\.map\(\(po\) => \{(.*)\}\)\n      \);\n\n$", block, flags=re.S)
    assert m, 'oc'
    body = m.group(1).replace("const showReceive = canEditCurrentTab && po.status !== 'Recibida';", "const showReceive = canEditCurrentTab && ['Aprobada', 'Enviada', 'Parcialmente recibida'].includes(po.status);")
    new = '''      const renderPurchaseRows = (rows) => {
        const frag = document.createDocumentFragment();
        for (const po of rows) {
          frag.appendChild((() => {''' + body + '''})());
        }
        return frag;
      };
      bindPagedContainer({
        container: getRef(tabBody, 'po-tbody'),
        key: 'm3.oc',
        list: getPagedList('m3.oc', { path: '/m3/ordenes-compra', map: mapPurchaseOrderRows, pageSize: 20 }),
        filters: {
          searchPlaceholder: 'Buscar orden o proveedor…',
          dates: true,
          statusOptions: [
            { value: '', label: 'Todos los estados' },
            { value: 'pendiente de aprobación', label: 'Pendiente de aprobación' },
            { value: 'aprobada,enviada', label: 'Aprobada / enviada' },
            { value: 'parcialmente recibida', label: 'Parcialmente recibida' },
            { value: 'completada', label: 'Recibida' },
            { value: 'rechazada,cancelada', label: 'Rechazada / cancelada' },
          ],
        },
        renderBody: renderPurchaseRows,
        empty: { iconName: 'truck', title: 'Sin órdenes de compra', description: 'Aún no hay órdenes registradas.' },
        noMatch: { iconName: 'truck', title: 'Sin órdenes coincidentes', description: 'Prueba con otro estado, fechas o búsqueda.' },
      });

'''
    s = s[:a] + new + s[b:]

    s = rep(s, "  function renderContent() {\n", "  function renderContent() {\n    setActivePagedList(null); // cada pantalla paginada se vuelve a enlazar al dibujarse\n")
    return s
rw('src/js/modules/servicios-pos-almacen.js', mod)

def imp(s):
    a = "import { erpStore } from '../core/store.js';\n"
    assert s.count(a) == 1
    return s.replace(a, a + "import { bindPagedContainer } from '../components/paged-view.js';\nimport { getPagedList, setActivePagedList } from '../services/paged-list.js';\nimport { mapComandaRows, mapConsumoRows, mapPurchaseOrderRows } from '../services/erp-mappers.js';\n")
rw('src/js/modules/servicios-pos-almacen.js', imp)
print('ok')
