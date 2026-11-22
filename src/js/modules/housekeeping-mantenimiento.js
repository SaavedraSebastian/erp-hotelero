import {
  createTemplateLibrary,
  getRef,
  h,
  icon,
  loadViewTemplate,
  mount,
  mountRef,
  parseHtmlTemplate,
  setText,
  setVisible,
} from '../utils/dom.js';
import moduleShellHtml from '../../html/modules/modulo-base.html?raw';
import modalesHtml from '../../html/modules/housekeeping/modales.html?raw';
import estadoHabitacionesHtml from '../../html/modules/housekeeping/estado-habitaciones.html?raw';
import limpiezaHtml from '../../html/modules/housekeeping/limpieza.html?raw';
import inspeccionHtml from '../../html/modules/housekeeping/inspeccion.html?raw';
import personalHtml from '../../html/modules/housekeeping/personal.html?raw';
import incidenciasHtml from '../../html/modules/housekeeping/incidencias.html?raw';
import mantPreventivoHtml from '../../html/modules/housekeeping/mant-preventivo.html?raw';
import mantCorrectivoHtml from '../../html/modules/housekeeping/mant-correctivo.html?raw';
import activosHtml from '../../html/modules/housekeeping/activos.html?raw';
import insumosHtml from '../../html/modules/housekeeping/insumos.html?raw';
import iaOperativaHtml from '../../html/modules/housekeeping/ia-operativa.html?raw';
import { formatCurrency } from '../utils/formatters.js';
import { getRoute, navigateToView } from '../core/router.js';
import { erpStore } from '../core/store.js';
import { bindPagedView } from '../components/paged-view.js';
import { localPager, resetLocalPager } from '../components/pagination.js';
import { getPagedList, setActivePagedList } from '../services/paged-list.js';
import { mapCleaningRows, mapIncidentRows, mapInspectionRows, mapWorkOrderRows } from '../services/erp-mappers.js';
import {
  AccessDeniedCard,
  ModuleAIAdvisor,
  EmptyState,
  ModuleHeader,
  SearchInput,
  StatTile,
  StatusText,
  openModal,
} from '../components/ui-components.js';

const cloneModal = createTemplateLibrary(modalesHtml);

const VIEW_HTML = {
  estado_habitaciones: estadoHabitacionesHtml,
  limpieza: limpiezaHtml,
  inspeccion: inspeccionHtml,
  personal: personalHtml,
  incidencias: incidenciasHtml,
  mant_preventivo: mantPreventivoHtml,
  mant_correctivo: mantCorrectivoHtml,
  activos: activosHtml,
  insumos: insumosHtml,
  ia_operativa: iaOperativaHtml,
};

const M2_TABS = [
  { id: 'estado_habitaciones', label: 'Estado Habitaciones', subtitle: 'Estado físico de las habitaciones y su disponibilidad para la venta.' },
  { id: 'limpieza', label: 'Órdenes Limpieza', subtitle: 'Órdenes de limpieza por salida, estadía y limpieza profunda.' },
  { id: 'inspeccion', label: 'Inspecciones', subtitle: 'Inspección de calidad para liberar habitaciones.' },
  { id: 'personal', label: 'Personal', subtitle: 'Personal operativo, turno y carga de trabajo.' },
  { id: 'incidencias', label: 'Incidencias', subtitle: 'Reportes de averías e incidencias de infraestructura.' },
  { id: 'mant_preventivo', label: 'Preventivo', subtitle: 'Calendario de mantenimiento preventivo por equipo.' },
  { id: 'mant_correctivo', label: 'Correctivo (OT)', subtitle: 'Órdenes de trabajo de mantenimiento y sus costos.' },
  { id: 'activos', label: 'Activos y Equipos', subtitle: 'Equipos e instalaciones, horas de uso y riesgo de falla.' },
  { id: 'insumos', label: 'Insumos Limpieza', subtitle: 'Stock de insumos de limpieza y reposición desde Almacén.' },
  { id: 'ia_operativa', label: 'IA Operativa', subtitle: 'Sugerencias de asignación y alertas operativas.' },
];

const m2Ui = {
  hkFilter: 'Todas',
  assetSearch: '',
  inspRoomId: '',
};

export function renderHousekeepingModule() {
  const root = parseHtmlTemplate(moduleShellHtml);
  const headerSlot = getRef(root, 'header-slot');
  const bodySlot = getRef(root, 'body-slot');

  function getStatusVariant(status) {
    if (['Inspeccionada', 'Limpia', 'Completada', 'Aprobada', 'Resuelta', 'Óptimo', 'Ejecutado', 'Disponible'].includes(status)) return 'success';
    if (['En limpieza', 'En proceso', 'Pendiente', 'Asignada', 'En reparación', 'Requiere revisión', 'Media', 'Solicitada'].includes(status)) return 'warning';
    if (['Sucia', 'Fuera de servicio', 'Urgente', 'Alta', 'Crítica', 'Rechazada', 'Vencido'].includes(status)) return 'danger';
    return 'info';
  }

  function openCleaningModal() {
    const state = erpStore.state;
    const hkStaff = state.staff.filter((s) => s.area === 'Housekeeping');
    openModal({
      title: 'Nueva Orden de Limpieza',
      renderBody: (close) => {
        const form = cloneModal('modal-limpieza');
        const roomSel = getRef(form, 'roomId');
        const typeSel = getRef(form, 'type');
        const prioSel = getRef(form, 'priority');
        const staffSel = getRef(form, 'assignedStaffId');
        const notes = getRef(form, 'notes');

        mount(roomSel, state.rooms.map((rm) => h('option', { value: rm.id }, `Hab. ${rm.number} (${rm.housekeepingStatus})`)));
        mount(staffSel, hkStaff.map((s) => h('option', { value: s.id }, s.name)));

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          erpStore.createCleaningOrder({
            roomId: roomSel.value,
            type: typeSel.value,
            priority: prioSel.value,
            assignedStaffId: staffSel.value || 'stf-2',
            notes: notes.value,
          });
          close();
        });
        return form;
      },
    });
  }

  function openIncidentModal() {
    const state = erpStore.state;
    openModal({
      title: 'Reportar incidencia',
      subtitle: 'Registra una avería o problema en una habitación o equipo para que Mantenimiento lo atienda.',
      renderBody: (close) => {
        const form = cloneModal('modal-incidencia');
        const roomSel = getRef(form, 'roomId');
        const assetSel = getRef(form, 'assetId');
        const location = getRef(form, 'location');
        const priority = getRef(form, 'priority');
        const origin = getRef(form, 'origin');
        const desc = getRef(form, 'description');
        const counter = getRef(form, 'counter');

        mount(roomSel, h('option', { value: '' }, '— Ninguna —'), state.rooms.map((rm) => h('option', { value: rm.id }, `Hab. ${rm.number} · ${rm.type}`)));
        mount(assetSel, h('option', { value: '' }, '— Ninguno —'), state.assets.map((a) => h('option', { value: a.id }, `${a.name}${a.roomNumber ? ` · ${/^\d/.test(a.roomNumber) ? `Hab. ${a.roomNumber}` : a.roomNumber}` : ''}`)));

        const syncLocation = () => {
          const rm = state.rooms.find((r) => r.id === roomSel.value);
          const asset = state.assets.find((a) => a.id === assetSel.value);
          location.value = rm ? `Habitación ${rm.number}` : asset ? (/^\d/.test(asset.roomNumber || '') ? `Habitación ${asset.roomNumber}` : asset.roomNumber || '') : '';
        };
        roomSel.addEventListener('change', syncLocation);
        assetSel.addEventListener('change', () => {
          // Si el equipo está en una habitación, la selecciona para mantener la incidencia ubicada.
          const asset = state.assets.find((a) => a.id === assetSel.value);
          if (asset?.roomId && !roomSel.value) roomSel.value = asset.roomId;
          syncLocation();
        });
        desc.addEventListener('input', () => {
          counter.textContent = `${desc.value.length} / 300`;
        });

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!desc.value.trim()) return;
          if (!roomSel.value && !assetSel.value) {
            erpStore.pushToast({ title: 'Falta la ubicación', detail: 'Elige una habitación, un equipo o ambos.', type: 'warning' });
            return;
          }
          const res = await erpStore.createIncident({
            roomId: roomSel.value || undefined,
            assetId: assetSel.value || undefined,
            priority: priority.value,
            origin: origin.value,
            description: desc.value,
          });
          if (res?.ok) close();
        });
        return form;
      },
    });
  }

  function openResolveWOModal(wo) {
    openModal({
      title: `Completar Orden de Trabajo ${wo.code}`,
      subtitle: `${wo.location} · Si proviene de un reclamo CRM, se marcará Resuelto automáticamente.`,
      renderBody: (close) => {
        const form = cloneModal('modal-completar-ot');
        const notes = getRef(form, 'notes');
        const parts = getRef(form, 'parts');
        const hours = getRef(form, 'hours');
        const cost = getRef(form, 'cost');
        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const res = await erpStore.completeWorkOrder(wo.id, notes.value, parts.value, hours.value, cost.value);
          if (res?.ok) close(); // si el servidor rechaza, el formulario queda abierto para corregir
        });
        return form;
      },
    });
  }

  function openPreventiveModal(prefillAsset) {
    const state = erpStore.state;
    openModal({
      title: 'Programar Mantenimiento Preventivo',
      renderBody: (close) => {
        const form = cloneModal('modal-preventivo');
        const assetSel = getRef(form, 'asset');
        const freqSel = getRef(form, 'frequency');
        const nextDate = getRef(form, 'nextDate');
        const notes = getRef(form, 'notes');

        mount(assetSel, state.assets.map((a) => h('option', { value: a.id }, `${a.name} (${a.code}) · ${a.roomNumber || 'Áreas comunes'}`)));
        if (prefillAsset) {
          assetSel.value = prefillAsset.id;
          const risk = prefillAsset.predictedFailureRisk;
          notes.value = `Revisión preventiva recomendada (${prefillAsset.hoursUsed} h acumuladas${risk != null ? `, riesgo ${risk}%` : ''})`;
        }

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const res = await erpStore.addPreventiveSchedule({
            assetId: assetSel.value,
            frequency: freqSel.value,
            nextDate: nextDate.value,
            task: notes.value.trim(),
          });
          if (res?.ok) close();
        });
        return form;
      },
    });
  }

  function openAssetModal(editingAsset) {
    const cat = erpStore.state?.catalogs ?? {};
    const rooms = erpStore.state?.rooms ?? [];
    const initial = editingAsset
      ? { ...editingAsset }
      : { name: '', typeId: cat.assetTypes?.[0]?.id || '', brand: '', model: '', purchaseDate: '', hoursUsed: 0, condition: 'Operativo' };
    openModal({
      title: editingAsset ? `Editar Activo ${editingAsset.code}` : 'Registrar Nuevo Activo Hotelero',
      subtitle: editingAsset ? 'Tipo, ubicación y fecha de instalación no se modifican.' : undefined,
      renderBody: (close) => {
        const form = cloneModal('modal-activo');
        const name = getRef(form, 'name');
        const typeSel = getRef(form, 'type');
        const locSel = getRef(form, 'location');
        const brand = getRef(form, 'brand');
        const model = getRef(form, 'model');
        const installDate = getRef(form, 'installDate');
        const hoursUsed = getRef(form, 'hoursUsed');
        const condition = getRef(form, 'condition');

        mount(typeSel, (cat.assetTypes ?? []).map((t) => h('option', { value: t.id }, t.name)));
        mount(locSel, [
          ...rooms.map((r) => h('option', { value: `h:${r.id}` }, `Habitación ${r.number}`)),
          ...(cat.areas ?? []).map((a) => h('option', { value: `a:${a.id}` }, a.name)),
        ]);

        name.value = initial.name || '';
        typeSel.value = initial.typeId || '';
        locSel.value = initial.roomId ? `h:${initial.roomId}` : initial.areaId ? `a:${initial.areaId}` : '';
        brand.value = initial.brand || '';
        model.value = initial.model || '';
        installDate.value = initial.purchaseDate || '';
        hoursUsed.value = String(initial.hoursUsed ?? 0);
        condition.value = initial.condition || 'Operativo';
        if (editingAsset) for (const el of [typeSel, locSel, installDate]) el.disabled = true;
        else condition.disabled = true; // un activo nuevo siempre entra como Operativo

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!name.value.trim()) return;
          const res = await erpStore.upsertAsset({
            id: editingAsset?.id,
            code: editingAsset?.code,
            name: name.value.trim(),
            typeId: typeSel.value,
            location: locSel.value,
            brand: brand.value.trim(),
            model: model.value.trim(),
            installDate: installDate.value,
            hoursUsed: Number(hoursUsed.value || 0),
            condition: editingAsset ? condition.value : undefined,
          });
          if (res?.ok) close();
        });
        return form;
      },
    });
  }

  function openReqModal(supply) {
    openModal({
      title: `Solicitar a Almacén · ${supply.name}`,
      subtitle: 'Envía requisición directa al Almacén Central para reposición.',
      renderBody: (close) => {
        const form = cloneModal('modal-requisicion');
        setText(form, 'qty-label', `Cantidad (${supply.unit})`);
        const qty = getRef(form, 'qty');
        const notes = getRef(form, 'notes');
        qty.value = String(Math.max(5, supply.minStock * 2 - supply.localStock));
        notes.value = `Reposición urgente para ${supply.name}`;

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          erpStore.requestSupplyFromWarehouse(supply.id, Number(qty.value), 'Housekeeping', notes.value);
          close();
        });
        return form;
      },
    });
  }

  function renderContent() {
    setActivePagedList(null); // cada pantalla paginada se vuelve a enlazar al dibujarse
    const state = erpStore.state;
    const currentUser = erpStore.currentUser;
    const currentPermissions = erpStore.currentPermissions;
    if (!state || !currentUser) return;

    const route = getRoute();
    const visibleTabs = M2_TABS.filter((t) => erpStore.canViewTab('m2', t.id));
    const defaultTab = erpStore.getDefaultTab('m2') || visibleTabs[0]?.id || 'estado_habitaciones';
    const requestedTab = route.tab || defaultTab;
    const activeTab = visibleTabs.some((t) => t.id === requestedTab) ? requestedTab : defaultTab;
    const activeMeta = M2_TABS.find((t) => t.id === activeTab);
    const isTabDenied = Boolean(route.tab && !erpStore.canViewTab('m2', route.tab));
    const canEditCurrentTab = erpStore.canEditTab('m2', activeTab);
    const onlyMine = Boolean(currentPermissions?.onlyAssignedTasks);

    const staffById = new Map(state.staff.map((s) => [s.id, s]));
    const scopedCleaningOrders = onlyMine
      ? state.cleaningOrders.filter((c) => c.assignedStaffId === currentUser.assignedStaffId)
      : state.cleaningOrders;
    const scopedWorkOrders = onlyMine
      ? state.workOrders.filter((w) => w.assignedStaffId === currentUser.assignedStaffId)
      : state.workOrders;

    let tabBody = null;

    if (isTabDenied) {
      tabBody = AccessDeniedCard({
        resourceName: `Housekeeping y Mantenimiento · ${M2_TABS.find((t) => t.id === route.tab)?.label || route.tab}`,
        roleLabel: currentUser.roleLabel,
        onBack: () => navigateToView('/housekeeping', defaultTab, true),
      });
    } else if (activeTab === 'estado_habitaciones') {
      const counts = {
        Sucia: state.rooms.filter((r) => r.housekeepingStatus === 'Sucia').length,
        'En limpieza': state.rooms.filter((r) => r.housekeepingStatus === 'En limpieza').length,
        Limpia: state.rooms.filter((r) => r.housekeepingStatus === 'Limpia').length,
        Inspeccionada: state.rooms.filter((r) => r.housekeepingStatus === 'Inspeccionada').length,
        'Fuera de servicio': state.rooms.filter((r) => r.housekeepingStatus === 'Fuera de servicio').length,
      };
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.estado_habitaciones);
      tabBody = view;

      mountRef(
        tabBody,
        'kpis',
        StatTile({ label: 'Sucia', value: counts.Sucia, tone: counts.Sucia > 0 ? 'warning' : 'default' }),
        StatTile({ label: 'En limpieza', value: counts['En limpieza'], tone: counts['En limpieza'] > 0 ? 'warning' : 'default' }),
        StatTile({ label: 'Limpia', value: counts.Limpia, tone: 'success' }),
        StatTile({ label: 'Inspeccionada', value: counts.Inspeccionada, tone: 'success' }),
        StatTile({ label: 'Fuera de servicio', value: counts['Fuera de servicio'], tone: counts['Fuera de servicio'] > 0 ? 'danger' : 'default' })
      );

      tabBody.querySelectorAll('[data-filter]').forEach((btn) => {
        if (btn.dataset.filter === m2Ui.hkFilter) btn.classList.add('is-active');
        btn.addEventListener('click', () => {
          m2Ui.hkFilter = btn.dataset.filter;
          renderContent();
        });
      });

      const filtered = state.rooms.filter((r) => m2Ui.hkFilter === 'Todas' || r.housekeepingStatus === m2Ui.hkFilter);
      mountRef(
        tabBody,
        'grid',
        filtered.map((rm) => {
          const card = clone('card-estado-hab');
          setText(card, 'number', `Hab. ${rm.number}`);
          setText(card, 'floor-type', `Piso ${rm.floor} · ${rm.type}`);
          mountRef(card, 'status', StatusText({ label: rm.housekeepingStatus, variant: getStatusVariant(rm.housekeepingStatus) }));
          setText(card, 'commercial', rm.commercialStatus);
          if (canEditCurrentTab) {
            setVisible(card, 'hk-select', true);
            const sel = getRef(card, 'hk-select');
            sel.value = rm.housekeepingStatus;
            sel.addEventListener('change', (e) => erpStore.updateRoomHousekeepingStatus(rm.id, e.target.value));
          }
          return card;
        })
      );
    } else if (activeTab === 'limpieza') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.limpieza);
      tabBody = view;
      if (canEditCurrentTab) {
        if (!onlyMine) {
          setVisible(tabBody, 'new-btn', true);
          mountRef(tabBody, 'plus-icon', icon('plus', 'w-3.5'));
          getRef(tabBody, 'new-btn')?.addEventListener('click', openCleaningModal);
        }
      }
      const renderCleaningTable = (rows) => {
        const tbl = clone('tabla-limpieza');
        if (canEditCurrentTab) setVisible(tbl, 'actions-th', true);
        mountRef(
          tbl,
          'tbody',
          rows.map((ord) => {
                    const tr = clone('fila-limpieza');
          setText(tr, 'room', `Hab. ${ord.roomNumber}`);
          setText(tr, 'type', ord.type);
          mountRef(tr, 'priority', StatusText({ label: ord.priority, variant: getStatusVariant(ord.priority) }));
          setText(tr, 'staff', ord.assignedStaffName || staffById.get(ord.assignedStaffId)?.name || '—');
          if (ord.sourceFlow) {
            setVisible(tr, 'origin', true);
            setText(tr, 'origin', ord.sourceFlow.replace(/^Flujo\s+[A-F]:\s*/i, ''));
          }
          setText(tr, 'notes', ord.notes || '—');
          mountRef(tr, 'status', StatusText({ label: ord.status, variant: getStatusVariant(ord.status) }));
          if (canEditCurrentTab) {
            setVisible(tr, 'actions', true);
            if (ord.status === 'Pendiente') {
              setVisible(tr, 'start-btn', true);
              getRef(tr, 'start-btn')?.addEventListener('click', () => erpStore.advanceCleaningOrder(ord.id, 'En proceso'));
            }
            if (ord.status === 'En proceso') {
              setVisible(tr, 'finish-btn', true);
              getRef(tr, 'finish-btn')?.addEventListener('click', () => erpStore.advanceCleaningOrder(ord.id, 'Completada'));
            }
          }
          return tr;
        })
        );
        return tbl;
      };
      if (onlyMine) {
        // Personal con vista restringida: solo sus tareas abiertas, que ya están cargadas.
        const lp = localPager('m2.limpieza', scopedCleaningOrders, renderContent, 20);
        mountRef(tabBody, 'table-wrap', scopedCleaningOrders.length ? renderCleaningTable(lp.slice) : EmptyState({ iconName: 'sparkles', title: 'Sin tareas asignadas', description: 'No tienes órdenes de limpieza abiertas.' }));
        mountRef(tabBody, 'footer-slot', lp.footer);
      } else {
        const cleanList = getPagedList('m2.limpieza', { path: '/m2/ordenes-limpieza', map: mapCleaningRows, pageSize: 10 });
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
    } else if (activeTab === 'inspeccion') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.inspeccion);
      tabBody = view;
      mountRef(tabBody, 'form-icon', icon('clipboardCheck', 'w-4 text-teal'));

      const inspectableRooms = state.rooms.filter((r) => r.housekeepingStatus !== 'Fuera de servicio');
      const sortedRooms = [
        ...inspectableRooms.filter((r) => r.housekeepingStatus === 'Limpia'),
        ...inspectableRooms.filter((r) => r.housekeepingStatus !== 'Limpia'),
      ];
      if (!m2Ui.inspRoomId || !sortedRooms.some((r) => r.id === m2Ui.inspRoomId)) {
        m2Ui.inspRoomId = sortedRooms[0]?.id || state.rooms[0]?.id || '';
      }

      const roomSel = getRef(tabBody, 'room-select');
      mount(
        roomSel,
        sortedRooms.map((rm) =>
          h('option', { value: rm.id, selected: rm.id === m2Ui.inspRoomId }, `Hab. ${rm.number} (${rm.type}) — Estado actual: ${rm.housekeepingStatus}`)
        )
      );
      roomSel?.addEventListener('change', (e) => { m2Ui.inspRoomId = e.target.value; });

      const checklist = {
        ropaCama: true,
        banoSanitizado: true,
        minibarRepuesto: true,
        amenitiesCompletos: true,
        equiposOperativos: true,
      };
      tabBody.querySelectorAll('[data-check]').forEach((cb) => {
        cb.addEventListener('change', () => { checklist[cb.dataset.check] = cb.checked; });
      });
      const obsInput = getRef(tabBody, 'observations');

      if (canEditCurrentTab) {
        setVisible(tabBody, 'actions', true);
        mountRef(tabBody, 'check-icon', icon('check', 'w-3.5'));
        getRef(tabBody, 'reject-btn')?.addEventListener('click', () => {
          const rmId = roomSel.value;
          const ord = state.cleaningOrders.find((c) => c.roomId === rmId && c.status === 'Completada');
          erpStore.submitInspection({
            roomId: rmId,
            cleaningOrderId: ord?.id,
            checklist: { ...checklist },
            result: 'Rechazada',
            observations: obsInput?.value.trim() || 'Requiere repaso según checklist',
          });
        });
        getRef(tabBody, 'approve-btn')?.addEventListener('click', () => {
          const rmId = roomSel.value;
          const ord = state.cleaningOrders.find((c) => c.roomId === rmId && c.status === 'Completada');
          erpStore.submitInspection({
            roomId: rmId,
            cleaningOrderId: ord?.id,
            checklist: { ...checklist },
            result: 'Aprobada',
            observations: obsInput?.value.trim() || 'Aprobada para check-in inmediato',
          });
        });
      }

      const renderInspectionRows = (rows) =>
        h('div', { className: 'divide-y' },
          ...rows.map((ins) => {
          const row = clone('fila-historial-inspeccion');
          setText(row, 'room', `Hab. ${ins.roomNumber}`);
          setText(row, 'obs', ins.observations || 'Inspección conforme.');
          setText(row, 'meta', `Inspector: ${ins.inspector} · ${ins.date}`);
          mountRef(row, 'result', StatusText({ label: ins.result, variant: ins.result === 'Aprobada' ? 'success' : 'danger' }));
          return row;
        }));
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
    } else if (activeTab === 'personal') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.personal);
      tabBody = view;
      mountRef(
        tabBody,
        'grid',
        state.staff.map((st) => {
          const pct = Math.min(100, Math.round((st.activeTasks / Math.max(1, st.maxCapacity)) * 100));
          const card = clone('card-personal');
          setText(card, 'kicker', `${st.area} · Turno ${st.shift}`);
          setText(card, 'name', st.name);
          setText(card, 'specialty', st.specialty);
          mountRef(card, 'availability', StatusText({ label: st.available ? 'Disponible' : 'Ocupado', variant: st.available ? 'success' : 'warning' }));
          setText(card, 'load-text', st.maxCapacity > 0 ? `${st.activeTasks} / ${st.maxCapacity} tareas (${pct}%)` : `${st.activeTasks} tarea(s) activa(s)`);
          const fill = getRef(card, 'progress-fill');
          if (fill) fill.style.width = `${pct}%`;
          return card;
        })
      );
    } else if (activeTab === 'incidencias') {
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
          rows.map((inc) => {
          const tr = clone('fila-incidencia');
          setText(tr, 'code', inc.code);
          setText(tr, 'location', inc.location);
          if (inc.linkedComplaintId) setVisible(tr, 'crm-link', true);
          setText(tr, 'category', inc.category);
          setText(tr, 'desc', inc.description);
          setText(tr, 'reporter', `Reportó: ${inc.reportedBy} · ${inc.createdAt}`);
          mountRef(tr, 'priority', StatusText({ label: inc.priority, variant: getStatusVariant(inc.priority) }));
          mountRef(tr, 'status', StatusText({ label: inc.status, variant: getStatusVariant(inc.status) }));
          if (canEditCurrentTab) {
            setVisible(tr, 'action', true);
            mountRef(
              tr,
              'action',
              inc.status === 'Abierta' || inc.status === 'Asignada'
                ? h('button', {
                    type: 'button',
                    className: 'btn btn-teal btn-xs',
                    onClick: () => erpStore.createWorkOrderFromIncident(inc.id, inc.assignedStaffId || maintStaff[0]?.id || null, 0, inc.description),
                  }, 'Generar OT')
                : h('span', { className: 'text-11 text-slate-400' }, inc.status)
            );
          }
          return tr;
        })
        );
        return tbl;
      };
      const incList = getPagedList('m2.incidencias', { path: '/m2/incidencias', map: mapIncidentRows, pageSize: 10 });
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
    } else if (activeTab === 'mant_preventivo') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.mant_preventivo);
      tabBody = view;
      if (canEditCurrentTab) {
        setVisible(tabBody, 'new-btn', true);
        setVisible(tabBody, 'actions-th', true);
        mountRef(tabBody, 'plus-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn')?.addEventListener('click', () => openPreventiveModal(null));
      }
      const prevPager = localPager('m2.preventivo', state.preventiveSchedules, renderContent, 20);
      mountRef(tabBody, 'footer-slot', prevPager.footer);
      mountRef(
        tabBody,
        'tbody',
        prevPager.slice.map((p) => {
          const stf = staffById.get(p.assignedStaffId);
          const tr = clone('fila-preventivo');
          setText(tr, 'asset', p.assetName);
          setText(tr, 'location-notes', `${p.location || 'Hotel'} · ${p.notes || ''}`);
          setText(tr, 'frequency', p.frequency);
          setText(tr, 'date', p.nextDate);
          setText(tr, 'staff', stf?.name || '—');
          mountRef(tr, 'status', StatusText({ label: p.status, variant: getStatusVariant(p.status) }));
          if (canEditCurrentTab) {
            setVisible(tr, 'action', true);
            mountRef(
              tr,
              'action',
              p.status !== 'Ejecutado'
                ? h('button', { type: 'button', className: 'btn btn-teal btn-xs', onClick: () => erpStore.completePreventiveSchedule(p.id) }, 'Registrar ejecución')
                : h('span', { className: 'text-11 text-slate-400' }, p.lastCompletedDate || p.status)
            );
          }
          return tr;
        })
      );
    } else if (activeTab === 'mant_correctivo') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.mant_correctivo);
      tabBody = view;
      const renderWorkOrderCards = (rows) =>
        h('div', { className: 'grid-2' },
          ...rows.map((wo) => {
                    const card = clone('card-ot');
          setText(card, 'code-location', `${wo.code} · ${wo.location}`);
          setText(card, 'desc', wo.description);
          mountRef(card, 'status', StatusText({ label: wo.status, variant: getStatusVariant(wo.status) }));
          setText(card, 'staff', wo.assignedStaffName || staffById.get(wo.assignedStaffId)?.name || '—');
          setText(card, 'cost', formatCurrency(wo.estimatedCost));
          if (wo.status !== 'Completada' && canEditCurrentTab) {
            setVisible(card, 'complete-btn', true);
            getRef(card, 'complete-btn')?.addEventListener('click', () => openResolveWOModal(wo));
          }
          return card;
        }));
      if (onlyMine) {
        const lp = localPager('m2.ot', scopedWorkOrders, renderContent, 20);
        mountRef(tabBody, 'grid-wrap', scopedWorkOrders.length ? renderWorkOrderCards(lp.slice) : EmptyState({ iconName: 'wrench', title: 'Sin órdenes asignadas', description: 'No tienes órdenes de trabajo abiertas.' }));
        mountRef(tabBody, 'footer-slot', lp.footer);
      } else {
        const otList = getPagedList('m2.ot', { path: '/m2/ordenes-trabajo', map: mapWorkOrderRows, pageSize: 10 });
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
    } else if (activeTab === 'activos') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.activos);
      tabBody = view;
      if (canEditCurrentTab) {
        setVisible(tabBody, 'new-btn', true);
        setVisible(tabBody, 'actions-th', true);
        mountRef(tabBody, 'plus-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn')?.addEventListener('click', () => openAssetModal(null));
      }

      const renderAssetRows = () => {
        const q = m2Ui.assetSearch.trim().toLowerCase();
        const filtered = state.assets.filter(
          (a) =>
            !q ||
            a.code.toLowerCase().includes(q) ||
            a.name.toLowerCase().includes(q) ||
            (a.brand || '').toLowerCase().includes(q) ||
            String(a.roomNumber || '').toLowerCase().includes(q)
        );
        const lp = localPager('m2.activos', filtered, renderAssetRows, 20);
        mountRef(tabBody, 'footer-slot', lp.footer);
        mountRef(
          tabBody,
          'tbody',
          lp.slice.map((a) => {
            const tr = clone('fila-activo');
            setText(tr, 'code', a.code);
            setText(tr, 'name', a.name);
            setText(tr, 'location', `Hab./Área: ${a.roomNumber || 'Áreas Comunes'}`);
            setText(tr, 'brand-date', `${a.brand || '—'} · ${a.purchaseDate || '—'}`);
            setText(tr, 'hours', `${Number(a.hoursUsed || 0).toLocaleString('en-US')} h`);
            mountRef(tr, 'condition', StatusText({ label: a.condition || '—', variant: getStatusVariant(a.condition) }));
            const hasRisk = a.predictedFailureRisk != null;
            const risk = hasRisk ? Number(a.predictedFailureRisk) : 0;
            const riskEl = setText(tr, 'risk', hasRisk ? `${risk}%` : 'Sin evaluar');
            if (riskEl) riskEl.classList.add(risk >= 50 ? 'text-danger' : 'text-teal');
            if (canEditCurrentTab) {
              setVisible(tr, 'action', true);
              mountRef(tr, 'action', h('button', { type: 'button', className: 'btn btn-outline btn-xs', onClick: () => openAssetModal(a) }, 'Editar'));
            }
            return tr;
          })
        );
      };

      mountRef(tabBody, 'search-slot', SearchInput({
        value: m2Ui.assetSearch,
        placeholder: 'Buscar equipo, marca o habitación...',
        onChange: (v) => {
          m2Ui.assetSearch = v;
          resetLocalPager('m2.activos');
          renderAssetRows();
        },
      }));
      renderAssetRows();
    } else if (activeTab === 'insumos') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.insumos);
      tabBody = view;
      mountRef(
        tabBody,
        'supplies-grid',
        state.hkSupplies.map((s) => {
          const low = s.localStock < s.minStock;
          const card = clone('card-insumo-hk');
          setText(card, 'name', s.name);
          setText(card, 'daily', `Consumo diario prom.: ${s.dailyConsumption} ${s.unit}`);
          mountRef(card, 'status', StatusText({ label: low ? 'Bajo mínimo' : 'OK', variant: low ? 'danger' : 'success' }));
          setText(card, 'stock', String(s.localStock));
          setText(card, 'unit-min', `${s.unit} (Mín: ${s.minStock})`);
          if (canEditCurrentTab) {
            setVisible(card, 'actions', true);
            getRef(card, 'consume-btn')?.addEventListener('click', () => erpStore.consumeHKSupply(s.id, 1));
            mountRef(card, 'pkg-icon', icon('packagePlus', 'w-3'));
            getRef(card, 'req-btn')?.addEventListener('click', () => openReqModal(s));
          }
          return card;
        })
      );

      mountRef(
        tabBody,
        'requisitions-list',
        state.supplyRequisitions.map((req) => {
          const row = clone('fila-requisicion-hk');
          setText(row, 'code', req.code);
          setText(row, 'desc', ` · ${req.quantity} ${req.unit} de ${req.itemName} (${req.requestedByArea})`);
          mountRef(row, 'status', StatusText({ label: req.status, variant: req.status === 'Entregada' ? 'success' : 'warning' }));
          return row;
        })
      );
    } else if (activeTab === 'ia_operativa') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.ia_operativa);
      tabBody = view;
      mountRef(tabBody, 'alert-icon', icon('alertTriangle', 'w-4 text-warning'));

      const hkStaffSorted = state.staff
        .filter((s) => s.area === 'Housekeeping' && s.available)
        .sort((a, b) => a.activeTasks - b.activeTasks);
      const dirtyOrCleaning = state.rooms.filter((r) => r.housekeepingStatus === 'Sucia');
      const suggestions = dirtyOrCleaning.length > 0
        ? dirtyOrCleaning.map((rm, idx) => {
            const staff = hkStaffSorted[idx % Math.max(1, hkStaffSorted.length)];
            return {
              room: rm,
              staff,
              priority: rm.floor === 1 ? 'Alta' : 'Media',
              reason: `Balanceo de piso ${rm.floor} según capacidad disponible (${staff ? `${staff.activeTasks}/${staff.maxCapacity}` : '1/6'}).`,
            };
          })
        : [{
            room: state.rooms.find((r) => r.housekeepingStatus === 'En limpieza') || state.rooms[0],
            staff: hkStaffSorted[0],
            priority: 'Media',
            reason: 'Optimización de turno según carga actual de habitaciones.',
          }];

      mountRef(
        tabBody,
        'cleaning-suggestions',
        suggestions.map((sug) => {
          const row = clone('fila-asignacion-ia');
          setText(row, 'title', `Hab. ${sug.room.number} → ${sug.staff?.name || 'Rosa Quispe'} (${sug.priority})`);
          setText(row, 'detail', sug.reason);
          if (canEditCurrentTab) {
            setVisible(row, 'apply-btn', true);
            getRef(row, 'apply-btn')?.addEventListener('click', () => {
              erpStore.createCleaningOrder({
                roomId: sug.room.id,
                type: 'Salida (Check-out)',
                priority: sug.priority,
                assignedStaffId: sug.staff?.id || 'stf-1',
                notes: sug.reason,
              });
            });
          }
          return row;
        })
      );

      const highRiskAssets = state.assets.filter((a) => (a.predictedFailureRisk || 0) >= 40);
      mountRef(
        tabBody,
        'predictive-alerts',
        highRiskAssets.map((a) => {
          const row = clone('fila-alerta-predictiva');
          setText(row, 'title', `${a.name} (${a.code})`);
          setText(row, 'detail', `Ubicación: ${a.roomNumber || 'Áreas Comunes'} · ${a.hoursUsed}h acumuladas`);
          setText(row, 'risk', `${a.predictedFailureRisk}% riesgo`);
          if (canEditCurrentTab) {
            setVisible(row, 'schedule-btn', true);
            getRef(row, 'schedule-btn')?.addEventListener('click', () => openPreventiveModal(a));
          }
          return row;
        })
      );

      mountRef(
        tabBody,
        'advisor-slot',
        ModuleAIAdvisor({
          moduleId: 'm2-housekeeping-ia',
          moduleName: 'Housekeeping y Mantenimiento',
          title: 'Asesor IA de Operaciones de Planta y Mantenimiento Predictivo',
          description: 'Optimiza turnos de limpieza, prioriza órdenes de trabajo vinculadas a reclamos y planifica mantenimientos preventivos.',
          suggestedPrompts: [
            'Sugiere el orden óptimo de limpieza para liberar habitaciones antes de las 14:00.',
            'Prioriza las incidencias y activos de alto riesgo considerando impacto en huéspedes VIP.',
            'Analiza el consumo de insumos de limpieza y proyecta reposiciones para los próximos 7 días.',
          ],
          contextData: {
            habitaciones: state.rooms.map((r) => ({ num: r.number, com: r.commercialStatus, hk: r.housekeepingStatus })),
            ordenesLimpieza: scopedCleaningOrders,
            incidencias: state.incidents,
            activos: state.assets,
            insumos: state.hkSupplies,
          },
        })
      );
    }

    mount(
      headerSlot,
      ModuleHeader({
        moduleNumber: canEditCurrentTab ? 'Housekeeping y Mantenimiento' : 'Housekeeping y Mantenimiento · Solo lectura',
        title: activeMeta?.label ?? 'Housekeeping y Mantenimiento',
        subtitle: activeMeta?.subtitle ?? '',
        actions: canEditCurrentTab && !onlyMine
          ? h('div', { className: 'row-wrap' },
              erpStore.canEditTab('m2', 'incidencias')
                ? h('button', { type: 'button', className: 'btn btn-outline', onClick: openIncidentModal }, icon('wrench', 'w-4'), h('span', null, 'Reportar Incidencia'))
                : null,
              erpStore.canEditTab('m2', 'limpieza')
                ? h('button', { type: 'button', className: 'btn btn-primary', onClick: openCleaningModal }, icon('plus', 'w-4'), h('span', null, 'Orden Limpieza'))
                : null
            )
          : null,
      })
    );
    mount(bodySlot, tabBody);
  }

  renderContent();
  return root;
}
