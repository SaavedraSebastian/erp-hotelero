import os, re

def rw(p, fn):
    s = open(p, encoding='utf-8').read()
    s = fn(s)
    open(p + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(p + '.tmp', p)

def rep(s, a, b):
    assert s.count(a) == 1, (a[:80], s.count(a))
    return s.replace(a, b)

# ================= plantillas
def tpl_guests(s):
    return '''<div class="stack-md">
  <div class="row-between">
    <div data-ref="filters-slot"></div>
    <button type="button" class="btn btn-primary btn-sm hidden" data-ref="new-guest-btn">
      <span data-ref="plus-icon"></span>
      <span>Nuevo huésped</span>
    </button>
  </div>

  <div class="card">
    <div class="table-scroll" data-ref="table-wrap"></div>
    <div data-ref="footer-slot"></div>
  </div>
</div>

<template data-tpl="tabla-huespedes">
  <table class="erp-table">
    <thead>
      <tr>
        <th>Huésped / Empresa</th>
        <th>Documento</th>
        <th>Contacto</th>
        <th>Nacionalidad</th>
        <th>Privacidad</th>
        <th class="text-right hidden" data-ref="actions-th">Acciones</th>
      </tr>
    </thead>
    <tbody data-ref="tbody"></tbody>
  </table>
</template>

<template data-tpl="fila-huesped">
  <tr>
    <td>
      <div class="font-semibold text-navy" data-ref="name"></div>
      <div class="text-11 text-slate-500" data-ref="company"></div>
    </td>
    <td class="font-mono text-xs text-slate-700" data-ref="doc"></td>
    <td>
      <div class="text-11 text-slate-700" data-ref="email"></div>
      <div class="text-11 font-mono text-slate-500" data-ref="phone"></div>
    </td>
    <td class="text-xs text-slate-700" data-ref="nationality"></td>
    <td data-ref="privacy"></td>
    <td class="text-right hidden" data-ref="action"></td>
  </tr>
</template>
'''
rw('src/html/modules/reservas/huespedes.html', tpl_guests)

def tpl_wait(s):
    a = s.index('<div class="stack-md">')
    b = s.index('<template data-tpl="fila-espera">')
    new = '''<div class="stack-md">
  <div class="row-between">
    <div data-ref="filters-slot"></div>
    <button type="button" class="btn btn-primary btn-sm hidden" data-ref="new-waitlist-btn">
      <span data-ref="plus-icon"></span>
      <span>Registrar en lista de espera</span>
    </button>
  </div>

  <div class="card">
    <div class="table-scroll" data-ref="table-wrap"></div>
    <div data-ref="footer-slot"></div>
  </div>
</div>

<template data-tpl="tabla-espera">
  <table class="erp-table">
    <thead>
      <tr>
        <th>Registro</th>
        <th>Solicitante</th>
        <th>Categoría y estadía</th>
        <th>Estado</th>
        <th class="text-right">Acciones</th>
      </tr>
    </thead>
    <tbody data-ref="tbody"></tbody>
  </table>
</template>

'''
    return s[:a] + new + s[b:]
rw('src/html/modules/reservas/lista-espera.html', tpl_wait)

# ================= módulo
def mod(s):
    # --- huéspedes
    a = s.index("      const renderGuestsTable = () => {")
    b = s.index("    } else if (activeTab === 'ia_tarifas') {")
    guests = '''      const guestList = getPagedList('m1.huespedes', { path: '/m1/huespedes', map: mapGuests, pageSize: 20 });
      const renderGuestsTable = (rows) => {
        const tbl = clone('tabla-huespedes');
        if (canEditCurrentTab) setVisible(tbl, 'actions-th', true);
        mountRef(
          tbl,
          'tbody',
          rows.map((g) => {
            const tr = clone('fila-huesped');
            setText(tr, 'name', g.fullName);
            setText(tr, 'company', g.company || '—');
            setText(tr, 'doc', `${g.documentType} ${maskDocument(g.documentNumber, canViewFullPII)}`);
            setText(tr, 'email', maskEmail(g.email, canViewFullPII));
            setText(tr, 'phone', maskPhone(g.phone, canViewFullPII));
            setText(tr, 'nationality', g.nationality || '—');
            mountRef(tr, 'privacy', StatusText({ label: g.privacyConsentISO27701 ? 'Consentido' : 'Pendiente', variant: g.privacyConsentISO27701 ? 'success' : 'warning' }));
            if (canEditCurrentTab) {
              setVisible(tr, 'action', true);
              mountRef(tr, 'action', h('button', { type: 'button', className: 'btn btn-outline btn-xs', onClick: () => openGuestModal(g) }, 'Editar'));
            }
            return tr;
          })
        );
        return tbl;
      };

      bindPagedView({
        key: 'm1.huespedes',
        list: guestList,
        filtersSlot: getRef(tabBody, 'filters-slot'),
        bodySlot: getRef(tabBody, 'table-wrap'),
        footerSlot: getRef(tabBody, 'footer-slot'),
        filters: { searchPlaceholder: 'Buscar nombre, documento, correo o empresa…' },
        renderBody: renderGuestsTable,
        empty: { iconName: 'users', title: 'Sin huéspedes', description: 'Aún no hay huéspedes registrados.' },
        noMatch: { iconName: 'users', title: 'Sin huéspedes coincidentes', description: 'Prueba con otra búsqueda.' },
      });
'''
    s = s[:a] + guests + s[b:]

    # --- lista de espera
    a = s.index("      mountRef(\n        tabBody,\n        'tbody',\n        state.waitlist.map((w) => {")
    b = s.index("    } else if (activeTab === 'ocupacion') {")
    block = s[a:b]
    # reutiliza el cuerpo de la fila: convierte state.waitlist.map(...) en una función de filas
    m = re.search(r"state\.waitlist\.map\(\(w\) => \{(.*)\}\)\n      \);\n$", block, flags=re.S)
    assert m, 'cuerpo de lista de espera'
    row_body = m.group(1)
    wait = '''      const waitList = getPagedList('m1.espera', { path: '/m1/lista-espera', map: mapWaitlist, pageSize: 20, filters: { status: 'PENDIENTE' } });
      const renderWaitTable = (rows) => {
        const tbl = clone('tabla-espera');
        mountRef(
          tbl,
          'tbody',
          rows.map((w) => {''' + row_body + '''})
        );
        return tbl;
      };

      bindPagedView({
        key: 'm1.espera',
        list: waitList,
        filtersSlot: getRef(tabBody, 'filters-slot'),
        bodySlot: getRef(tabBody, 'table-wrap'),
        footerSlot: getRef(tabBody, 'footer-slot'),
        filters: {
          searchPlaceholder: 'Buscar huésped o tipo de habitación…',
          statusOptions: [
            { value: '', label: 'Todos los estados' },
            { value: 'PENDIENTE', label: 'Pendiente' },
            { value: 'ATENDIDA', label: 'Atendida' },
            { value: 'CANCELADA', label: 'Cancelada' },
            { value: 'VENCIDA', label: 'Vencida' },
          ],
        },
        renderBody: renderWaitTable,
        empty: { iconName: 'clock', title: 'Sin solicitudes en espera', description: 'No hay solicitudes registradas.' },
        noMatch: { iconName: 'clock', title: 'Sin solicitudes coincidentes', description: 'Prueba con otro estado o búsqueda.' },
      });
'''
    s = s[:a] + wait + s[b:]

    s = rep(s, "  function renderContent() {\n    const state = erpStore.state;\n", "  function renderContent() {\n    setActivePagedList(null); // cada pantalla paginada se vuelve a enlazar al dibujarse\n    const state = erpStore.state;\n")
    s = rep(s, "import { TODAY } from '../data/empty-state.js';\nimport {\n  AccessDeniedCard,", "import { TODAY } from '../data/empty-state.js';\nimport {\n  AccessDeniedCard,")
    s = s.replace("  ModuleHeader,\n  StatTile,", "  ModuleHeader,\n  SearchInput,\n  StatTile,", 1)
    s = s.replace("  guestSearch: '',\n", "", 1)
    return s
rw('src/js/modules/reservas-recepcion.js', mod)

def store(s):
    s = rep(s, "  loadERPState,\n} from '../services/data-adapter.js';", "  loadERPState,\n} from '../services/data-adapter.js';\nimport { reloadActivePagedList, resetPagedLists } from '../services/paged-list.js';")
    s = rep(s, "    storeData.state = state;\n    storeData.loadInfo = { source, errors, truncated, forbidden };\n",
               "    storeData.state = state;\n    storeData.loadInfo = { source, errors, truncated, forbidden };\n    if (keys?.length) reloadActivePagedList(); // tras guardar: vuelve a leer la lista que está a la vista\n    else resetPagedLists(); // carga completa: descarta lo paginado anterior\n")
    return s
rw('src/js/core/store.js', store)
print('ok')
