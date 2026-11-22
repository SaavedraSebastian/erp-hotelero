import os

def rw(p, fn):
    s = open(p, encoding='utf-8').read()
    s = fn(s)
    open(p + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(p + '.tmp', p)

def rep(s, a, b):
    assert s.count(a) == 1, (a[:80], s.count(a))
    return s.replace(a, b)

# ---- plantilla
def tpl(s):
    a = s.index('<div class="stack-md">')
    b = s.index('<template data-tpl="tabla-reservas">')
    new = '''<div class="stack-md">
  <div data-ref="filters-slot"></div>

  <div class="card">
    <div class="table-scroll" data-ref="table-wrap"></div>
    <div data-ref="footer-slot"></div>
  </div>
</div>

'''
    return s[:a] + new + s[b:]
rw('src/html/modules/reservas/reservas.html', tpl)

# ---- pestaña
def mod(s):
    a = s.index("    } else if (activeTab === 'reservas') {")
    b = s.index("    } else if (activeTab === 'tarifas') {")
    new = '''    } else if (activeTab === 'reservas') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.reservas);
      tabBody = view;
      // Historial completo, paginado desde el servidor (con búsqueda, estado y fechas).
      const list = getPagedList('m1.reservas', { path: '/m1/reservas', map: mapReservations, pageSize: 20 });

      const renderReservasTable = (rows) => {
        const tbl = clone('tabla-reservas');
        mountRef(
          tbl,
          'tbody',
          rows.map((r) => {
            const rm = roomById.get(r.roomId);
            const tr = clone('fila-reserva');
            setText(tr, 'code', r.code);
            setText(tr, 'channel', r.channel);
            setText(tr, 'guest', r.guestName || '—');
            setText(tr, 'pax', `${r.adults} ad.${r.children > 0 ? ` · ${r.children} niños` : ''}`);
            setText(tr, 'room', rm ? `Hab. ${rm.number} · ${rm.type}` : (r.roomIds?.length ? `Hab. ${r.roomIds.map((id) => roomById.get(id)?.number || id).join(', ')}` : '—'));
            setText(tr, 'stay', `${r.checkInDate} → ${r.checkOutDate} (${r.nights}n)`);
            setText(tr, 'total', formatCurrency(r.totalAmount));
            mountRef(tr, 'status', StatusText({ label: r.status, variant: getStatusVariant(r.status) }));

            const histBtn = getRef(tr, 'history-btn');
            if (histBtn) {
              mount(histBtn, icon('history', 'w-3'));
              histBtn.addEventListener('click', () => openHistoryModal(r));
            }
            if (canEditCurrentTab && (r.status === 'Confirmada' || r.status === 'Pendiente')) {
              setVisible(tr, 'cancel-btn', true);
              getRef(tr, 'cancel-btn')?.addEventListener('click', () => erpStore.updateReservationStatus(r.id, 'Cancelada', 'Cancelada desde Recepción'));
            }
            if (canEditCurrentTab && r.status === 'Confirmada') {
              setVisible(tr, 'noshow-btn', true);
              getRef(tr, 'noshow-btn')?.addEventListener('click', () => erpStore.updateReservationStatus(r.id, 'No-Show', 'Marcada No-Show'));
            }
            return tr;
          })
        );
        return tbl;
      };

      bindPagedView({
        key: 'm1.reservas',
        list,
        filtersSlot: getRef(tabBody, 'filters-slot'),
        bodySlot: getRef(tabBody, 'table-wrap'),
        footerSlot: getRef(tabBody, 'footer-slot'),
        filters: {
          searchPlaceholder: 'Buscar código, huésped o habitación…',
          dates: true,
          statusOptions: [
            { value: '', label: 'Todos los estados' },
            { value: 'CONFIRMADA', label: 'Confirmada' },
            { value: 'EN_CURSO', label: 'Check-in (en curso)' },
            { value: 'FINALIZADA,CHECK_OUT', label: 'Check-out (finalizada)' },
            { value: 'PENDIENTE', label: 'Pendiente' },
            { value: 'CANCELADA', label: 'Cancelada' },
            { value: 'NO_SHOW', label: 'No-Show' },
          ],
        },
        renderBody: renderReservasTable,
        empty: { iconName: 'calendar', title: 'Sin reservas', description: 'Aún no hay reservas registradas.' },
        noMatch: { iconName: 'calendar', title: 'Sin reservas coincidentes', description: 'Prueba con otra búsqueda, estado o rango de fechas.' },
      });
'''
    s = s[:a] + new + s[b:]
    s = rep(s, "import { renderStackedBarChart } from '../components/charts.js';\n",
               "import { renderStackedBarChart } from '../components/charts.js';\nimport { bindPagedView } from '../components/paged-view.js';\nimport { getPagedList, setActivePagedList } from '../services/paged-list.js';\nimport { mapGuests, mapReservations, mapWaitlist } from '../services/data-adapter.js';\n")
    s = rep(s, "  SearchInput,\n", "")
    s = rep(s, "  resSearch: '',\n  statusFilter: 'Todas',\n", "")
    return s
rw('src/js/modules/reservas-recepcion.js', mod)
print('ok')
