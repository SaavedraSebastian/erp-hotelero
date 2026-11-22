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
import {
  AccessDeniedCard,
  ModuleAIAdvisor,
  ModuleHeader,
  SearchInput,
  StatTile,
  StatusText,
  SubmoduleBar,
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
  { id: 'estado_habitaciones', label: 'Estado Habitaciones', subtitle: 'Control físico de habitaciones sincronizado con Recepción.' },
  { id: 'limpieza', label: 'Órdenes Limpieza', subtitle: 'Asignaciones por salida, estadía y limpieza profunda.' },
  { id: 'inspeccion', label: 'Inspecciones', subtitle: 'Checklist de calidad para liberar habitaciones para Check-in.' },
  { id: 'personal', label: 'Personal', subtitle: 'Disponibilidad, turno y balance de carga del equipo operativo.' },
  { id: 'incidencias', label: 'Incidencias', subtitle: 'Reportes de averías, infraestructura y casos escalados desde CRM.' },
  { id: 'mant_preventivo', label: 'Preventivo', subtitle: 'Calendario de revisiones periódicas para equipos críticos.' },
  { id: 'mant_correctivo', label: 'Correctivo (OT)', subtitle: 'Órdenes de trabajo técnicas con control de costos operativos.' },
  { id: 'activos', label: 'Activos y Equipos', subtitle: 'Catálogo de equipos, horas acumuladas y riesgo de falla estimado.' },
  { id: 'insumos', label: 'Insumos Limpieza', subtitle: 'Stock operativo de piso y solicitudes enviadas a Almacén.' },
  { id: 'ia_operativa', label: 'IA Operativa', subtitle: 'Asignación sugerida de limpieza, alertas predictivas y asesor IA.' },
];

const m2Ui = {
  hkFilter: 'Todas',
  assetSearch: '',
  inspRoomId: '',
};

export function renderHousekeepingModule() {
  const root = parseHtmlTemplate(moduleShellHtml);
  const headerSlot = getRef(root, 'header-slot');
  const tabsSlot = getRef(root, 'tabs-slot');
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
    const maintStaff = state.staff.filter((s) => s.area === 'Mantenimiento');
    openModal({
      title: 'Reportar Incidencia de Mantenimiento',
      renderBody: (close) => {
        const form = cloneModal('modal-incidencia');
        const roomSel = getRef(form, 'roomId');
        const location = getRef(form, 'location');
        const category = getRef(form, 'category');
        const priority = getRef(form, 'priority');
        const desc = getRef(form, 'description');

        mount(
          roomSel,
          h('option', { value: '' }, 'Área común / Ninguna'),
          state.rooms.map((rm) => h('option', { value: rm.id }, `Hab. ${rm.number}`))
        );
        location.value = 'Habitación 203';
        roomSel.addEventListener('change', (e) => {
          const rm = state.rooms.find((r) => r.id === e.target.value);
          if (rm) location.value = `Habitación ${rm.number}`;
        });

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!desc.value.trim()) return;
          erpStore.createIncident({
            roomId: roomSel.value || undefined,
            location: location.value,
            category: category.value,
            priority: priority.value,
            assignedStaffId: maintStaff[0]?.id || undefined,
            description: desc.value,
          });
          close();
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
        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          erpStore.completeWorkOrder(wo.id, notes.value || 'Trabajo ejecutado y validado', parts.value);
          close();
        });
        return form;
      },
    });
  }

  function openPreventiveModal(prefillAsset) {
    const state = erpStore.state;
    const maintStaff = state.staff.filter((s) => s.area === 'Mantenimiento');
    openModal({
      title: 'Programar Mantenimiento Preventivo',
      renderBody: (close) => {
        const form = cloneModal('modal-preventivo');
        const assetName = getRef(form, 'assetName');
        const location = getRef(form, 'location');
        const freqSel = getRef(form, 'frequency');
        const nextDate = getRef(form, 'nextDate');
        const staffSel = getRef(form, 'assignedStaffId');
        const notes = getRef(form, 'notes');

        mount(staffSel, maintStaff.map((s) => h('option', { value: s.id }, s.name)));
        assetName.value = prefillAsset ? `${prefillAsset.name} (${prefillAsset.code})` : (state.assets[0]?.name || '');
        location.value = prefillAsset ? `Hab./Área ${prefillAsset.roomNumber}` : 'Azotea Técnica';
        nextDate.value = '2026-11-25';
        notes.value = prefillAsset
          ? `Revisión preventiva recomendada (${prefillAsset.hoursUsed}h acumuladas, riesgo ${prefillAsset.predictedFailureRisk}%).`
          : 'Limpieza de filtros y verificación técnica';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!assetName.value.trim()) return;
          erpStore.addPreventiveSchedule({
            assetName: assetName.value.trim(),
            location: location.value.trim() || 'Áreas Comunes',
            frequency: freqSel.value,
            nextDate: nextDate.value,
            assignedStaffId: staffSel.value || 'stf-4',
            notes: notes.value.trim(),
          });
          close();
        });
        return form;
      },
    });
  }

  function openAssetModal(editingAsset) {
    const formState = editingAsset
      ? { ...editingAsset }
      : {
          code: 'EQ-NEW-01',
          name: '',
          category: 'Climatización',
          roomNumber: '202',
          brand: 'Daikin',
          purchaseDate: '2026-01-15',
          hoursUsed: 0,
          condition: 'Óptimo',
          predictedFailureRisk: 10,
        };
    openModal({
      title: editingAsset ? `Editar Activo ${editingAsset.code}` : 'Registrar Nuevo Activo Hotelero',
      renderBody: (close) => {
        const form = cloneModal('modal-activo');
        const code = getRef(form, 'code');
        const name = getRef(form, 'name');
        const category = getRef(form, 'category');
        const roomNumber = getRef(form, 'roomNumber');
        const brand = getRef(form, 'brand');
        const purchaseDate = getRef(form, 'purchaseDate');
        const hoursUsed = getRef(form, 'hoursUsed');
        const condition = getRef(form, 'condition');
        const risk = getRef(form, 'predictedFailureRisk');

        code.value = formState.code;
        name.value = formState.name;
        category.value = formState.category;
        roomNumber.value = formState.roomNumber || '';
        brand.value = formState.brand || '';
        purchaseDate.value = formState.purchaseDate || '2026-01-15';
        hoursUsed.value = String(formState.hoursUsed ?? 0);
        condition.value = formState.condition || 'Óptimo';
        risk.value = String(formState.predictedFailureRisk ?? 10);

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!name.value.trim()) return;
          erpStore.upsertAsset({
            ...formState,
            code: code.value.trim(),
            name: name.value.trim(),
            category: category.value.trim(),
            roomNumber: roomNumber.value.trim(),
            brand: brand.value.trim(),
            purchaseDate: purchaseDate.value,
            hoursUsed: Number(hoursUsed.value || 0),
            condition: condition.value,
            predictedFailureRisk: Number(risk.value || 0),
          });
          close();
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
    const state = erpStore.state;
    const currentUser = erpStore.currentUser;
    const currentPermissions = erpStore.currentPermissions;
    if (!state || !currentUser) return;

    const route = getRoute();
    const visibleTabs = M2_TABS.filter((t) => erpStore.canViewTab('m2', t.id));
    const defaultTab = erpStore.getDefaultTab('m2') || visibleTabs[0]?.id || 'estado_habitaciones';
    const requestedTab = route.tab || defaultTab;
    const activeTab = visibleTabs.some((t) => t.id === requestedTab) ? requestedTab : defaultTab;
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
        setVisible(tabBody, 'actions-th', true);
        if (!onlyMine) {
          setVisible(tabBody, 'top-bar', true);
          setVisible(tabBody, 'new-btn', true);
          mountRef(tabBody, 'plus-icon', icon('plus', 'w-3.5'));
          getRef(tabBody, 'new-btn')?.addEventListener('click', openCleaningModal);
        }
      }
      mountRef(
        tabBody,
        'tbody',
        scopedCleaningOrders.map((ord) => {
          const stf = staffById.get(ord.assignedStaffId);
          const tr = clone('fila-limpieza');
          setText(tr, 'room', `Hab. ${ord.roomNumber}`);
          setText(tr, 'type', ord.type);
          mountRef(tr, 'priority', StatusText({ label: ord.priority, variant: getStatusVariant(ord.priority) }));
          setText(tr, 'staff', stf?.name || '—');
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

      mountRef(
        tabBody,
        'history-list',
        state.inspections.slice(0, 8).map((ins) => {
          const row = clone('fila-historial-inspeccion');
          setText(row, 'room', `Hab. ${ins.roomNumber}`);
          setText(row, 'obs', ins.observations || 'Inspección conforme.');
          setText(row, 'meta', `Inspector: ${ins.inspector} · ${ins.date}`);
          mountRef(row, 'result', StatusText({ label: ins.result, variant: ins.result === 'Aprobada' ? 'success' : 'danger' }));
          return row;
        })
      );
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
          setText(card, 'load-text', `${st.activeTasks} / ${st.maxCapacity} tareas (${pct}%)`);
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
        setVisible(tabBody, 'top-bar', true);
        setVisible(tabBody, 'new-btn', true);
        setVisible(tabBody, 'actions-th', true);
        mountRef(tabBody, 'plus-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn')?.addEventListener('click', openIncidentModal);
      }
      mountRef(
        tabBody,
        'tbody',
        state.incidents.map((inc) => {
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
                    onClick: () => erpStore.createWorkOrderFromIncident(inc.id, inc.assignedStaffId || maintStaff[0]?.id || 'stf-4', 180, inc.description),
                  }, 'Generar OT')
                : h('span', { className: 'text-11 text-slate-400' }, inc.status)
            );
          }
          return tr;
        })
      );
    } else if (activeTab === 'mant_preventivo') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.mant_preventivo);
      tabBody = view;
      if (canEditCurrentTab) {
        setVisible(tabBody, 'new-btn', true);
        setVisible(tabBody, 'actions-th', true);
        mountRef(tabBody, 'plus-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn')?.addEventListener('click', () => openPreventiveModal(null));
      }
      mountRef(
        tabBody,
        'tbody',
        state.preventiveSchedules.map((p) => {
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
      mountRef(
        tabBody,
        'grid',
        scopedWorkOrders.map((wo) => {
          const stf = staffById.get(wo.assignedStaffId);
          const card = clone('card-ot');
          setText(card, 'code-location', `${wo.code} · ${wo.location}`);
          setText(card, 'desc', wo.description);
          mountRef(card, 'status', StatusText({ label: wo.status, variant: getStatusVariant(wo.status) }));
          setText(card, 'staff', stf?.name || '—');
          setText(card, 'cost', formatCurrency(wo.estimatedCost));
          if (wo.status !== 'Completada' && canEditCurrentTab) {
            setVisible(card, 'complete-btn', true);
            getRef(card, 'complete-btn')?.addEventListener('click', () => openResolveWOModal(wo));
          }
          return card;
        })
      );
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
        mountRef(
          tabBody,
          'tbody',
          filtered.map((a) => {
            const tr = clone('fila-activo');
            setText(tr, 'code', a.code);
            setText(tr, 'name', a.name);
            setText(tr, 'location', `Hab./Área: ${a.roomNumber || 'Áreas Comunes'}`);
            setText(tr, 'brand-date', `${a.brand || '—'} · ${a.purchaseDate || '—'}`);
            setText(tr, 'hours', `${Number(a.hoursUsed || 0).toLocaleString('en-US')} h`);
            mountRef(tr, 'condition', StatusText({ label: a.condition || 'Óptimo', variant: getStatusVariant(a.condition) }));
            const risk = Number(a.predictedFailureRisk || 0);
            const riskEl = setText(tr, 'risk', `${risk}%`);
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

    const tabCounts = {
      estado_habitaciones: state.rooms.length,
      limpieza: scopedCleaningOrders.filter((c) => c.status !== 'Inspeccionada').length,
      inspeccion: state.inspections.length,
      personal: state.staff.length,
      incidencias: state.incidents.filter((i) => i.status !== 'Resuelta').length,
      mant_preventivo: state.preventiveSchedules.length,
      mant_correctivo: scopedWorkOrders.filter((w) => w.status !== 'Completada').length,
      activos: state.assets.length,
      insumos: state.hkSupplies.length,
    };

    const barTabs = visibleTabs.map((t) => ({
      id: t.id,
      label: t.label,
      ...(tabCounts[t.id] !== undefined ? { count: tabCounts[t.id] } : {}),
    }));

    mount(
      headerSlot,
      ModuleHeader({
        moduleNumber: canEditCurrentTab
          ? 'Módulo 02 · Operaciones de Planta'
          : 'Módulo 02 · Operaciones de Planta · Modo consulta (solo lectura)',
        title: 'Housekeeping y Mantenimiento',
        subtitle: 'Control físico de habitaciones sincronizado con Recepción, inspecciones con checklist, incidencias, órdenes de trabajo y reposición con Almacén.',
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
    mount(
      tabsSlot,
      !isTabDenied && barTabs.length > 0
        ? SubmoduleBar({
            tabs: barTabs,
            activeTab,
            onChange: (nextTab) => navigateToView('/housekeeping', nextTab),
          })
        : null
    );
    mount(bodySlot, tabBody);
  }

  renderContent();
  return root;
}
