import os, re

def rw(p, fn):
    s = open(p, encoding='utf-8').read()
    s = fn(s)
    open(p + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(p + '.tmp', p)

def rep(s, a, b):
    assert s.count(a) == 1, (a[:80], s.count(a))
    return s.replace(a, b)

# ============ mapeos exportados
def mappers(s):
    s = rep(s, "      assignedStaffId: optId(o.id_personal_asignado),\n      status,\n      sourceFlow",
               "      assignedStaffId: optId(o.id_personal_asignado),\n      assignedStaffName: o.personal_asignado || '',\n      status,\n      sourceFlow")
    s = rep(s, "      assignedStaffId: optId(w.id_tecnico),\n      priority: w.prioridad || '',",
               "      assignedStaffId: optId(w.id_tecnico),\n      assignedStaffName: w.tecnico_nombre || '',\n      priority: w.prioridad || '',")
    s = rep(s, "/** Tarifa dinámica:", """/** Mapeos de filas sueltas (listados paginados). */
export const mapCleaningRows = (rows) => mapM2({ ordenesLimpieza: rows }).cleaningOrders;
export const mapIncidentRows = (rows) => mapM2({ incidencias: rows }).incidents;
export const mapWorkOrderRows = (rows) => mapM2({ ordenesTrabajo: rows }).workOrders;
export const mapInspectionRows = (rows) => mapM2({ inspecciones: rows }).inspections;

/** Tarifa dinámica:""")
    return s
rw('src/js/services/erp-mappers.js', mappers)

# ============ adaptador: solo lo operativo
def adapter(s):
    s = rep(s, "    ['ordenesLimpieza', 'órdenes de limpieza', paged('/m2/ordenes-limpieza')],",
               "    // Solo lo abierto (el historial se pagina en cada pantalla).\n    ['ordenesLimpieza', 'órdenes de limpieza abiertas', paged(`/m2/ordenes-limpieza?status=${encodeURIComponent('Pendiente,Asignada,En limpieza,Pendiente inspección')}`)],")
    s = rep(s, "    ['incidencias', 'incidencias', paged('/m2/incidencias')],",
               "    ['incidencias', 'incidencias abiertas', paged(`/m2/incidencias?status=${encodeURIComponent('Abierta,En atención')}`)],")
    s = rep(s, "    ['ordenesTrabajo', 'órdenes de trabajo', paged('/m2/ordenes-trabajo')],",
               "    ['ordenesTrabajo', 'órdenes de trabajo abiertas', paged(`/m2/ordenes-trabajo?status=${encodeURIComponent('Pendiente,Asignada,En proceso,En espera')}`)],")
    s = rep(s, "    ['inspecciones', 'historial de inspecciones', data('/m2/inspecciones')],\n", "")
    s = rep(s, "      inspecciones: list('inspecciones'),\n", "")
    return s
rw('src/js/services/data-adapter.js', adapter)

def actions(s):
    return rep(s, "{ refreshKeys: ['ordenesLimpieza', 'habitaciones', 'inspecciones'] }", "{ refreshKeys: ['ordenesLimpieza', 'habitaciones'] }")
rw('src/js/services/erp-actions.js', actions)

# ============ plantillas
def tpl_limpieza(s):
    a = s.index('<div class="stack-md">')
    b = s.index('<template data-tpl="fila-limpieza">')
    new = '''<div class="stack-md">
  <div class="row-between">
    <div data-ref="filters-slot"></div>
    <button type="button" class="btn btn-primary btn-sm hidden" data-ref="new-btn">
      <span data-ref="plus-icon"></span>
      <span>Nueva orden</span>
    </button>
  </div>

  <div class="card">
    <div class="table-scroll" data-ref="table-wrap"></div>
    <div data-ref="footer-slot"></div>
  </div>
</div>

<template data-tpl="tabla-limpieza">
  <table class="erp-table">
    <thead>
      <tr>
        <th>Habitación / Tipo</th>
        <th>Prioridad</th>
        <th>Responsable</th>
        <th>Origen / Notas</th>
        <th>Estado</th>
        <th class="text-right hidden" data-ref="actions-th">Acciones</th>
      </tr>
    </thead>
    <tbody data-ref="tbody"></tbody>
  </table>
</template>

'''
    return s[:a] + new + s[b:]
rw('src/html/modules/housekeeping/limpieza.html', tpl_limpieza)

def tpl_inc(s):
    a = s.index('<div class="stack-md">')
    b = s.index('<template data-tpl="fila-incidencia">')
    new = '''<div class="stack-md">
  <div class="row-between">
    <div data-ref="filters-slot"></div>
    <button type="button" class="btn btn-primary btn-sm hidden" data-ref="new-btn">
      <span data-ref="plus-icon"></span>
      <span>Reportar incidencia</span>
    </button>
  </div>

  <div class="card">
    <div class="table-scroll" data-ref="table-wrap"></div>
    <div data-ref="footer-slot"></div>
  </div>
</div>

<template data-tpl="tabla-incidencias">
  <table class="erp-table">
    <thead>
      <tr>
        <th>Código / Ubicación</th>
        <th>Descripción</th>
        <th>Prioridad</th>
        <th>Estado</th>
        <th class="text-right hidden" data-ref="actions-th">Acción</th>
      </tr>
    </thead>
    <tbody data-ref="tbody"></tbody>
  </table>
</template>

'''
    return s[:a] + new + s[b:]
rw('src/html/modules/housekeeping/incidencias.html', tpl_inc)

def tpl_ot(s):
    a = s.index('<div class="stack-md">')
    b = s.index('<template data-tpl="card-ot">')
    new = '''<div class="stack-md">
  <div data-ref="filters-slot"></div>
  <div class="card">
    <div class="p-4" data-ref="grid-wrap"></div>
    <div data-ref="footer-slot"></div>
  </div>
</div>

'''
    return s[:a] + new + s[b:]
rw('src/html/modules/housekeeping/mant-correctivo.html', tpl_ot)

def tpl_insp(s):
    return rep(s, '''    <h2 class="card-title">Historial de Inspecciones Recientes</h2>
    <div class="divide-y" data-ref="history-list"></div>''', '''    <h2 class="card-title">Historial de inspecciones</h2>
    <div data-ref="history-filters"></div>
    <div class="divide-y" data-ref="history-list"></div>
    <div data-ref="history-footer"></div>''')
rw('src/html/modules/housekeeping/inspeccion.html', tpl_insp)

# ============ módulo
def mod(s):
    # ---- órdenes de limpieza
    a = s.index("      mountRef(\n        tabBody,\n        'tbody',\n        scopedCleaningOrders.map((ord) => {")
    b = s.index("    } else if (activeTab === 'inspeccion') {")
    block = s[a:b]
    m = re.search(r"scopedCleaningOrders\.map\(\(ord\) => \{(.*)\}\)\n      \);\n$", block, flags=re.S)
    assert m, 'limpieza'
    body = m.group(1).replace("const stf = staffById.get(ord.assignedStaffId);\n", "").replace("setText(tr, 'staff', stf?.name || '—');", "setText(tr, 'staff', ord.assignedStaffName || staffById.get(ord.assignedStaffId)?.name || '—');")
    new = '''      const renderCleaningTable = (rows) => {
        const tbl = clone('tabla-limpieza');
        if (canEditCurrentTab) setVisible(tbl, 'actions-th', true);
        mountRef(
          tbl,
          'tbody',
          rows.map((ord) => {''' + body + '''})
        );
        return tbl;
      };
      if (onlyMine) {
        // Personal con vista restringida: solo sus tareas abiertas, que ya están cargadas.
        const lp = localPager('m2.limpieza', scopedCleaningOrders, renderContent, 20);
        mountRef(tabBody, 'table-wrap', scopedCleaningOrders.length ? renderCleaningTable(lp.slice) : EmptyState({ iconName: 'sparkles', title: 'Sin tareas asignadas', description: 'No tienes órdenes de limpieza abiertas.' }));
        mountRef(tabBody, 'footer-slot', lp.footer);
      } else {
        const cleanList = getPagedList('m2.limpieza', { path: '/m2/ordenes-limpieza', map: mapCleaningRows, pageSize: 20 });
        bindPagedView({
          key: 'm2.limpieza',
          list: cleanList,
          filtersSlot: getRef(tabBody, 'filters-slot'),
          bodySlot: getRef(tabBody, 'table-wrap'),
          footerSlot: getRef(tabBody, 'footer-slot'),
          filters: {
            searchPlaceholder: 'Buscar habitación, tipo o responsable…',
            dates: true,
            statusOptions: [
              { value: '', label: 'Todos los estados' },
              { value: 'Pendiente,Asignada', label: 'Pendiente' },
              { value: 'En limpieza', label: 'En proceso' },
              { value: 'Pendiente inspección', label: 'Pendiente de inspección' },
              { value: 'Cerrada', label: 'Cerrada' },
              { value: 'Anulada', label: 'Anulada' },
            ],
          },
          renderBody: renderCleaningTable,
          empty: { iconName: 'sparkles', title: 'Sin órdenes de limpieza', description: 'Aún no hay órdenes registradas.' },
          noMatch: { iconName: 'sparkles', title: 'Sin órdenes coincidentes', description: 'Prueba con otro estado, fechas o búsqueda.' },
        });
      }
'''
    s = s[:a] + new + s[b:]
    s = rep(s, """      if (canEditCurrentTab) {
        setVisible(tabBody, 'actions-th', true);
        if (!onlyMine) {
          setVisible(tabBody, 'top-bar', true);
          setVisible(tabBody, 'new-btn', true);""", """      if (canEditCurrentTab) {
        if (!onlyMine) {
          setVisible(tabBody, 'new-btn', true);""")

    # ---- incidencias
    a = s.index("    } else if (activeTab === 'incidencias') {")
    b = s.index("    } else if (activeTab === 'mant_preventivo') {")
    block = s[a:b]
    m = re.search(r"state\.incidents\.map\(\(inc\) => \{(.*)\}\)\n      \);\n$", block, flags=re.S)
    assert m, 'incidencias'
    body = m.group(1)
    new = '''    } else if (activeTab === 'incidencias') {
      const maintStaff = state.staff.filter((s) => s.area === 'Mantenimiento');
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.incidencias);
      tabBody = view;
      if (canEditCurrentTab) {
        setVisible(tabBody, 'new-btn', true);
        mountRef(tabBody, 'plus-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn')?.addEventListener('click', openIncidentModal);
      }
      const renderIncidentTable = (rows) => {
        const tbl = clone('tabla-incidencias');
        if (canEditCurrentTab) setVisible(tbl, 'actions-th', true);
        mountRef(
          tbl,
          'tbody',
          rows.map((inc) => {''' + body + '''})
        );
        return tbl;
      };
      const incList = getPagedList('m2.incidencias', { path: '/m2/incidencias', map: mapIncidentRows, pageSize: 20 });
      bindPagedView({
        key: 'm2.incidencias',
        list: incList,
        filtersSlot: getRef(tabBody, 'filters-slot'),
        bodySlot: getRef(tabBody, 'table-wrap'),
        footerSlot: getRef(tabBody, 'footer-slot'),
        filters: {
          searchPlaceholder: 'Buscar habitación, equipo o descripción…',
          dates: true,
          statusOptions: [
            { value: '', label: 'Todos los estados' },
            { value: 'Abierta', label: 'Abierta' },
            { value: 'En atención', label: 'En reparación' },
            { value: 'Cerrada', label: 'Resuelta' },
            { value: 'Anulada', label: 'Anulada' },
          ],
        },
        renderBody: renderIncidentTable,
        empty: { iconName: 'wrench', title: 'Sin incidencias', description: 'No hay incidencias reportadas.' },
        noMatch: { iconName: 'wrench', title: 'Sin incidencias coincidentes', description: 'Prueba con otro estado, fechas o búsqueda.' },
      });
'''
    s = s[:a] + new + s[b:]

    # ---- OT
    a = s.index("    } else if (activeTab === 'mant_correctivo') {")
    b = s.index("    } else if (activeTab === 'activos') {")
    block = s[a:b]
    m = re.search(r"scopedWorkOrders\.map\(\(wo\) => \{(.*)\}\)\n      \);\n$", block, flags=re.S)
    assert m, 'ot'
    body = m.group(1).replace("const stf = staffById.get(wo.assignedStaffId);\n", "").replace("setText(card, 'staff', stf?.name || '—');", "setText(card, 'staff', wo.assignedStaffName || staffById.get(wo.assignedStaffId)?.name || '—');")
    new = '''    } else if (activeTab === 'mant_correctivo') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.mant_correctivo);
      tabBody = view;
      const renderWorkOrderCards = (rows) =>
        h('div', { className: 'grid-2' },
          ...rows.map((wo) => {''' + body + '''}));
      if (onlyMine) {
        const lp = localPager('m2.ot', scopedWorkOrders, renderContent, 20);
        mountRef(tabBody, 'grid-wrap', scopedWorkOrders.length ? renderWorkOrderCards(lp.slice) : EmptyState({ iconName: 'wrench', title: 'Sin órdenes asignadas', description: 'No tienes órdenes de trabajo abiertas.' }));
        mountRef(tabBody, 'footer-slot', lp.footer);
      } else {
        const otList = getPagedList('m2.ot', { path: '/m2/ordenes-trabajo', map: mapWorkOrderRows, pageSize: 20 });
        bindPagedView({
          key: 'm2.ot',
          list: otList,
          filtersSlot: getRef(tabBody, 'filters-slot'),
          bodySlot: getRef(tabBody, 'grid-wrap'),
          footerSlot: getRef(tabBody, 'footer-slot'),
          filters: {
            searchPlaceholder: 'Buscar equipo, tarea, técnico o número…',
            dates: true,
            statusOptions: [
              { value: '', label: 'Todos los estados' },
              { value: 'Pendiente,Asignada', label: 'Pendiente' },
              { value: 'En proceso', label: 'En ejecución' },
              { value: 'En espera', label: 'En espera' },
              { value: 'Cerrada', label: 'Completada' },
              { value: 'Anulada', label: 'Anulada' },
            ],
          },
          renderBody: renderWorkOrderCards,
          empty: { iconName: 'wrench', title: 'Sin órdenes de trabajo', description: 'Aún no hay órdenes registradas.' },
          noMatch: { iconName: 'wrench', title: 'Sin órdenes coincidentes', description: 'Prueba con otro estado, fechas o búsqueda.' },
        });
      }
'''
    s = s[:a] + new + s[b:]

    # ---- historial de inspecciones
    a = s.index("      mountRef(\n        tabBody,\n        'history-list',\n        state.inspections.slice(0, 8).map((ins) => {")
    b = s.index("    } else if (activeTab === 'personal') {")
    block = s[a:b]
    m = re.search(r"state\.inspections\.slice\(0, 8\)\.map\(\(ins\) => \{(.*)\}\)\n      \);\n$", block, flags=re.S)
    assert m, 'inspecciones'
    body = m.group(1)
    new = '''      const renderInspectionRows = (rows) =>
        h('div', { className: 'divide-y' },
          ...rows.map((ins) => {''' + body + '''}));
      const inspList = getPagedList('m2.inspecciones', { path: '/m2/inspecciones', map: mapInspectionRows, pageSize: 10 });
      bindPagedView({
        key: 'm2.inspecciones',
        list: inspList,
        filtersSlot: getRef(tabBody, 'history-filters'),
        bodySlot: getRef(tabBody, 'history-list'),
        footerSlot: getRef(tabBody, 'history-footer'),
        filters: {
          searchPlaceholder: 'Buscar habitación o supervisor…',
          dates: true,
          statusOptions: [
            { value: '', label: 'Todos los resultados' },
            { value: 'Conforme', label: 'Aprobadas' },
            { value: 'No conforme', label: 'Rechazadas' },
          ],
        },
        renderBody: renderInspectionRows,
        empty: { iconName: 'clipboardCheck', title: 'Sin inspecciones', description: 'Aún no hay inspecciones registradas.' },
        noMatch: { iconName: 'clipboardCheck', title: 'Sin inspecciones coincidentes', description: 'Prueba con otro resultado, fechas o búsqueda.' },
      });
'''
    s = s[:a] + new + s[b:]

    # ---- encabezado: kicker de la plantilla de historial ya no usa 'history-list' como contenedor de filas
    s = rep(s, "  function renderContent() {\n", "  function renderContent() {\n    setActivePagedList(null); // cada pantalla paginada se vuelve a enlazar al dibujarse\n")
    # importaciones
    s = rep(s, "import { renderStackedBarChart", "import { renderStackedBarChart") if "import { renderStackedBarChart" in s else s
    return s
rw('src/js/modules/housekeeping-mantenimiento.js', mod)
print('ok')
