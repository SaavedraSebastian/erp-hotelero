import os, re

def rw(p, fn):
    s = open(p, encoding='utf-8').read()
    s = fn(s)
    open(p + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(p + '.tmp', p)

def rep(s, a, b):
    assert s.count(a) == 1, (a[:80], s.count(a))
    return s.replace(a, b)

def pag(s):
    s = rep(s, "    placeholder: searchPlaceholder,\n    value: st.filters.search ?? '',", "    placeholder: searchPlaceholder,\n    dataset: { focusId: 'list-search' },\n    value: st.filters.search ?? '',")
    s += '''
// -------------------------------------------------------------------------------------------
// Paginación en memoria para conjuntos acotados que ya están cargados (p. ej. ingresos del día).
// -------------------------------------------------------------------------------------------
const localState = new Map();

/** Devuelve { slice, footer }: la página visible de `rows` y su pie de paginación. */
export function localPager(key, rows, rerender, defaultSize = 20) {
  const st = localState.get(key) ?? { page: 1, pageSize: defaultSize };
  localState.set(key, st);
  const pages = Math.max(1, Math.ceil(rows.length / st.pageSize));
  if (st.page > pages) st.page = pages;
  const slice = rows.slice((st.page - 1) * st.pageSize, st.page * st.pageSize);
  const footer = rows.length
    ? Pagination({
        page: st.page,
        pageSize: st.pageSize,
        total: rows.length,
        onPage: (p) => {
          st.page = p;
          rerender();
        },
        onPageSize: (n) => {
          st.pageSize = n;
          st.page = 1;
          rerender();
        },
      })
    : null;
  return { slice, footer };
}

/** Vuelve a la primera página de una lista en memoria (al cambiar un filtro). */
export function resetLocalPager(key) {
  const st = localState.get(key);
  if (st) st.page = 1;
}
'''
    return s
rw('src/js/components/pagination.js', pag)

def mod(s):
    # ---- check-in
    s = rep(s, "      const pending = state.reservations.filter((r) => r.status === 'Confirmada' || r.status === 'Pendiente');\n      if (pending.length === 0) {",
               """      const ciQ = m1Ui.checkinSearch.trim().toLowerCase();
      const pendingAll = state.reservations.filter((r) => r.status === 'Confirmada' || r.status === 'Pendiente');
      const pending = ciQ
        ? pendingAll.filter((r) => r.code.toLowerCase().includes(ciQ) || (r.guestName || '').toLowerCase().includes(ciQ) || r.roomIds?.some((id) => (roomById.get(id)?.number || '').includes(ciQ)))
        : pendingAll;
      const ciPager = localPager('m1.checkin', pending, renderContent, 10);
      if (pendingAll.length === 0) {""")
    s = rep(s, "        mountRef(\n          tabBody,\n          'content',\n          h(\n            'div',\n            { className: 'grid-2' },\n            pending.map((r) => {",
               "        mountRef(\n          tabBody,\n          'content',\n          h('div', { className: 'stack-md' },\n            h('div', null, SearchInput({ value: m1Ui.checkinSearch, placeholder: 'Buscar código, huésped o habitación…', focusId: 'm1-checkin-search', onChange: (v) => { m1Ui.checkinSearch = v; resetLocalPager('m1.checkin'); renderContent(); } })),\n            pending.length === 0 ? EmptyState({ iconName: 'search', title: 'Sin coincidencias', description: 'Prueba con otra búsqueda.' }) : null,\n          h(\n            'div',\n            { className: 'grid-2' },\n            ciPager.slice.map((r) => {")
    s = rep(s, "              return card;\n            })\n          )\n        );\n      }\n    } else if (activeTab === 'checkout') {",
               "              return card;\n            })\n          ),\n          h('div', { className: 'card' }, ciPager.footer)\n          )\n        );\n      }\n    } else if (activeTab === 'checkout') {")
    # ---- check-out
    s = rep(s, "      const activeStays = state.reservations.filter((r) => r.status === 'Check-in');\n      if (activeStays.length === 0) {",
               """      const coQ = m1Ui.checkoutSearch.trim().toLowerCase();
      const activeAll = state.reservations.filter((r) => r.status === 'Check-in');
      const activeStays = coQ
        ? activeAll.filter((r) => r.code.toLowerCase().includes(coQ) || (r.guestName || '').toLowerCase().includes(coQ) || r.roomIds?.some((id) => (roomById.get(id)?.number || '').includes(coQ)))
        : activeAll;
      const coPager = localPager('m1.checkout', activeStays, renderContent, 10);
      if (activeAll.length === 0) {""")
    s = rep(s, "        mountRef(\n          tabBody,\n          'content',\n          h(\n            'div',\n            { className: 'grid-2' },\n            activeStays.map((r) => {",
               "        mountRef(\n          tabBody,\n          'content',\n          h('div', { className: 'stack-md' },\n            h('div', null, SearchInput({ value: m1Ui.checkoutSearch, placeholder: 'Buscar código, huésped o habitación…', focusId: 'm1-checkout-search', onChange: (v) => { m1Ui.checkoutSearch = v; resetLocalPager('m1.checkout'); renderContent(); } })),\n            activeStays.length === 0 ? EmptyState({ iconName: 'search', title: 'Sin coincidencias', description: 'Prueba con otra búsqueda.' }) : null,\n          h(\n            'div',\n            { className: 'grid-2' },\n            coPager.slice.map((r) => {")
    s = rep(s, "              return card;\n            })\n          )\n        );\n      }\n    } else if (activeTab === 'lista_espera') {",
               "              return card;\n            })\n          ),\n          h('div', { className: 'card' }, coPager.footer)\n          )\n        );\n      }\n    } else if (activeTab === 'lista_espera') {")
    s = rep(s, "  checkInRoomOverride: {},\n};", "  checkInRoomOverride: {},\n  checkinSearch: '',\n  checkoutSearch: '',\n};")
    s = rep(s, "import { GuestPicker } from '../components/guest-picker.js';\n", "import { GuestPicker } from '../components/guest-picker.js';\nimport { localPager, resetLocalPager } from '../components/pagination.js';\n")
    # fecha fija en el calendario de disponibilidad
    s = rep(s, "  dispOut: '2026-11-22',", "  dispOut: new Date(Date.parse(TODAY) + 7 * 86_400_000).toISOString().slice(0, 10),")
    return s
rw('src/js/modules/reservas-recepcion.js', mod)
print('ok')
