import os, re

def rw(p, fn):
    s = open(p, encoding='utf-8').read()
    s = fn(s)
    open(p + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(p + '.tmp', p)

def rep(s, a, b):
    assert s.count(a) == 1, (a[:80], s.count(a))
    return s.replace(a, b)

def tpl(s):
    a = s.index('<div class="stack-md">')
    b = s.index('<template data-tpl="card-tarifa">')
    new = '''<div class="stack-md">
  <div class="row-between">
    <div data-ref="filters-slot"></div>
    <button type="button" class="btn btn-primary btn-sm hidden" data-ref="new-rate-btn">
      <span data-ref="plus-icon"></span>
      <span>Nueva tarifa</span>
    </button>
  </div>
  <div class="card">
    <div data-ref="grid-wrap" class="p-4"></div>
    <div data-ref="footer-slot"></div>
  </div>
</div>

'''
    return s[:a] + new + s[b:]
rw('src/html/modules/reservas/tarifas.html', tpl)

def mod(s):
    a = s.index("      mountRef(\n        tabBody,\n        'grid',\n        state.ratePlans.map((rp) => {")
    b = s.index("    } else if (activeTab === 'checkin') {")
    block = s[a:b]
    m = re.search(r"state\.ratePlans\.map\(\(rp\) => \{(.*)\}\)\n      \);\n$", block, flags=re.S)
    assert m, 'cuerpo de tarifas'
    body = m.group(1)
    new = '''      const rateList = getPagedList('m1.tarifas', { path: '/m1/tarifas', map: mapRatePlans, pageSize: 20 });
      const renderRateCards = (rows) =>
        h('div', { className: 'grid-2' },
          ...rows.map((rp) => {''' + body + '''}));

      bindPagedView({
        key: 'm1.tarifas',
        list: rateList,
        filtersSlot: getRef(tabBody, 'filters-slot'),
        bodySlot: getRef(tabBody, 'grid-wrap'),
        footerSlot: getRef(tabBody, 'footer-slot'),
        filters: {
          searchPlaceholder: 'Buscar tarifa, tipo, canal o temporada…',
          statusOptions: [
            { value: '', label: 'Todas' },
            { value: 'ACTIVA', label: 'Activas' },
            { value: 'INACTIVA', label: 'Inactivas' },
          ],
        },
        renderBody: renderRateCards,
        empty: { iconName: 'receipt', title: 'Sin tarifas', description: 'Aún no hay tarifas registradas.' },
        noMatch: { iconName: 'receipt', title: 'Sin tarifas coincidentes', description: 'Prueba con otra búsqueda o estado.' },
      });
'''
    s = s[:a] + new + s[b:]
    s = rep(s, "import { mapGuests, mapReservations, mapWaitlist } from '../services/data-adapter.js';", "import { mapGuests, mapRatePlans, mapReservations, mapWaitlist } from '../services/data-adapter.js';")
    return s
rw('src/js/modules/reservas-recepcion.js', mod)

def adapter(s):
    return rep(s, "    ['tarifas', 'tarifas', data('/m1/tarifas')],", "    ['tarifas', 'tarifas vigentes', data('/m1/tarifas?vigentes=true')],")
rw('src/js/services/data-adapter.js', adapter)
print('ok')
