import os, re

def rw(p, fn):
    s = open(p, encoding='utf-8').read()
    s = fn(s)
    open(p + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(p + '.tmp', p)

def rep(s, a, b):
    assert s.count(a) == 1, (a[:80], s.count(a))
    return s.replace(a, b)

def adapter(s):
    # 1) fuera el "Cargar más" anterior
    a = s.index("/**\n * Trae las siguientes páginas de reservas")
    b = s.index("/** Endpoint sin paginación: { data: <lista u objeto> }. */")
    s = s[:a] + s[b:]
    s = rep(s, "// Paginación de reservas: páginas ya leídas y total en la base (para \"Cargar más\").\nlet reservasMeta = { pages: 0, total: 0 };\nconst MORE_PAGES_PER_CLICK = 5; // 500 reservas más por cada \"Cargar más\"\n", "")
    s = rep(s, "    reservasMeta = { pages: 0, total: 0 };\n", "")
    s = rep(s, "    if (key === 'reservas') reservasMeta = { pages: r.value.pages ?? 1, total: r.value.total ?? r.value.rows.length };\n", "")
    s = rep(s, "  state.paging = { reservas: { loaded: list('reservas').length, total: Math.max(reservasMeta.total, list('reservas').length) } };\n", "")
    # 2) la carga global de reservas es solo el conjunto operativo (el historial se pagina en su pantalla)
    s = rep(s, "    ['reservas', 'reservas', () => fetchAllPages('/m1/reservas', Math.max(reservasMeta.pages, MAX_PAGES_M1))],",
               "    // Solo lo operativo (en curso, confirmadas y pendientes); el historial completo se pagina en la pantalla de Reservas.\n    ['reservas', 'reservas operativas', paged('/m1/reservas?status=EN_CURSO,CONFIRMADA,PENDIENTE', MAX_PAGES_M1)],")
    # 3) huéspedes: solo la primera página (los demás se buscan o se pagina en su pantalla)
    s = rep(s, "    ['huespedes', 'huéspedes', paged('/m1/huespedes', MAX_PAGES_M1)],",
               "    ['huespedes', 'huéspedes recientes', paged('/m1/huespedes', 1)],")
    # 4) lista de espera: solo pendientes
    s = rep(s, "    ['listaEspera', 'lista de espera', paged('/m1/lista-espera', MAX_PAGES_M1)],",
               "    ['listaEspera', 'lista de espera pendiente', paged('/m1/lista-espera?status=PENDIENTE', MAX_PAGES_M1)],")
    # 5) exportar los mapeos usados por las listas paginadas
    for fn in ['mapRatePlans', 'mapReservations', 'mapGuests', 'mapWaitlist']:
        s = rep(s, f"\nfunction {fn}(", f"\nexport function {fn}(")
    return s

rw('src/js/services/data-adapter.js', adapter)

def store(s):
    a = s.index("  /** Trae más reservas (las más antiguas) y recalcula el estado. */")
    b = s.index("  async refreshState(keys) {")
    s = s[:a] + s[b:]
    s = rep(s, "  loadMoreReservations,\n", "")
    return s
rw('src/js/core/store.js', store)

def empty(s):
    return rep(s, "    paging: { reservas: { loaded: 0, total: 0 } },\n", "")
rw('src/js/data/empty-state.js', empty)

def html(s):
    a = s.index('    <div class="row-between p-3 hidden" data-ref="paging-bar">')
    b = s.index('  </div>\n</div>', a)
    return s[:a] + s[b:]
rw('src/html/modules/reservas/reservas.html', html)

def mod(s):
    a = s.index("      // Paginación: cuántas reservas hay cargadas frente al total en la base.")
    b = s.index("      const statusSel = getRef(tabBody, 'status-select');")
    return s[:a] + s[b:]
rw('src/js/modules/reservas-recepcion.js', mod)
print('ok')
