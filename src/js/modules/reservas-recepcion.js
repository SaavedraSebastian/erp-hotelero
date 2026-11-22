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
import modalesHtml from '../../html/modules/reservas/modales.html?raw';
import habitacionesHtml from '../../html/modules/reservas/habitaciones.html?raw';
import disponibilidadHtml from '../../html/modules/reservas/disponibilidad.html?raw';
import reservasHtml from '../../html/modules/reservas/reservas.html?raw';
import tarifasHtml from '../../html/modules/reservas/tarifas.html?raw';
import checkinHtml from '../../html/modules/reservas/checkin.html?raw';
import checkoutHtml from '../../html/modules/reservas/checkout.html?raw';
import listaEsperaHtml from '../../html/modules/reservas/lista-espera.html?raw';
import ocupacionHtml from '../../html/modules/reservas/ocupacion.html?raw';
import huespedesHtml from '../../html/modules/reservas/huespedes.html?raw';
import iaTarifasHtml from '../../html/modules/reservas/ia-tarifas.html?raw';
import { formatCurrency } from '../utils/formatters.js';
import { getRoute, navigateToView } from '../core/router.js';
import { erpStore } from '../core/store.js';
import { maskDocument, maskEmail, maskPhone } from '../data/rbac.js';
import { TODAY } from '../data/seed-data.js';
import {
  AccessDeniedCard,
  EmptyState,
  ModuleAIAdvisor,
  ModuleHeader,
  SearchInput,
  StatTile,
  StatusText,
  SubmoduleBar,
  openModal,
} from '../components/ui-components.js';
import { renderStackedBarChart } from '../components/charts.js';

const cloneModal = createTemplateLibrary(modalesHtml);

const VIEW_HTML = {
  habitaciones: habitacionesHtml,
  disponibilidad: disponibilidadHtml,
  reservas: reservasHtml,
  tarifas: tarifasHtml,
  checkin: checkinHtml,
  checkout: checkoutHtml,
  lista_espera: listaEsperaHtml,
  ocupacion: ocupacionHtml,
  huespedes: huespedesHtml,
  ia_tarifas: iaTarifasHtml,
};

const M1_TABS = [
  { id: 'habitaciones', label: 'Habitaciones', subtitle: 'Estado comercial vs. estado físico sincronizado con Housekeeping.' },
  { id: 'disponibilidad', label: 'Disponibilidad', subtitle: 'Calendario semanal real cruzado con reservas y bloqueos físicos.' },
  { id: 'reservas', label: 'Reservas', subtitle: 'Control integral de reservas, estados, canales e historial operativo.' },
  { id: 'tarifas', label: 'Tarifas', subtitle: 'Planes tarifarios por temporada y actualización sincronizada de habitaciones.' },
  { id: 'checkin', label: 'Check-in', subtitle: 'Ingreso con verificación del estado físico de limpieza de habitación.' },
  { id: 'checkout', label: 'Check-out', subtitle: 'Validación de Folio, traslado a Cuentas por Cobrar y orden de limpieza.' },
  { id: 'lista_espera', label: 'Sobreventa / Espera', subtitle: 'Resolución autorizada de conflictos de fechas y solicitudes en espera.' },
  { id: 'ocupacion', label: 'Ocupación', subtitle: 'KPIs de ADR, RevPAR y comparativa gráfica por categoría.' },
  { id: 'huespedes', label: 'Huéspedes', subtitle: 'Directorio de perfiles, preferencias, fidelización y privacidad.' },
  { id: 'ia_tarifas', label: 'IA Tarifas y No-Show', subtitle: 'Tarifas dinámicas explicables, predicción de no-show y análisis asistido.' },
];

const m1Ui = {
  roomSearch: '',
  roomTypeFilter: 'Todos',
  resSearch: '',
  statusFilter: 'Todas',
  dispIn: TODAY,
  dispOut: '2026-11-22',
  dispType: 'Todos',
  guestSearch: '',
  checkInRoomOverride: {},
};

export function renderReservasModule() {
  const root = parseHtmlTemplate(moduleShellHtml);
  const headerSlot = getRef(root, 'header-slot');
  const tabsSlot = getRef(root, 'tabs-slot');
  const bodySlot = getRef(root, 'body-slot');

  function getStatusVariant(status) {
    if (status === 'Confirmada' || status === 'Check-in' || status === 'Disponible' || status === 'Inspeccionada' || status === 'Limpia' || status === 'Asignada') return 'success';
    if (status === 'Pendiente' || status === 'Sucia' || status === 'En limpieza' || status === 'Reservada' || status === 'Lista de espera') return 'warning';
    if (status === 'Cancelada' || status === 'No-Show' || status === 'Fuera de servicio' || status === 'Bloqueada' || status === 'Sobreventa') return 'danger';
    return 'info';
  }

  function openRoomModal(editingRoom) {
    const formState = editingRoom
      ? { ...editingRoom, features: [...(editingRoom.features || [])] }
      : {
          number: '',
          floor: 2,
          type: 'Superior',
          capacity: 2,
          baseRate: 340,
          commercialStatus: 'Disponible',
          housekeepingStatus: 'Inspeccionada',
          features: ['Wi-Fi 6', 'Smart TV 50"', 'Minibar'],
        };

    openModal({
      title: editingRoom ? `Editar Habitación ${editingRoom.number}` : 'Registrar Nueva Habitación',
      subtitle: 'La disponibilidad comercial y física se sincroniza con Housekeeping.',
      renderBody: (close) => {
        const form = cloneModal('modal-habitacion');
        const num = getRef(form, 'number');
        const floor = getRef(form, 'floor');
        const type = getRef(form, 'type');
        const cap = getRef(form, 'capacity');
        const rate = getRef(form, 'baseRate');
        const hk = getRef(form, 'hkStatus');
        const features = getRef(form, 'features');

        num.value = formState.number;
        floor.value = String(formState.floor);
        type.value = formState.type;
        cap.value = String(formState.capacity);
        rate.value = String(formState.baseRate);
        hk.value = formState.housekeepingStatus;
        features.value = (formState.features || []).join(', ');

        setText(form, 'submit-btn', editingRoom ? 'Guardar cambios' : 'Registrar habitación');
        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          formState.number = num.value.trim();
          formState.floor = Number(floor.value);
          formState.type = type.value;
          formState.capacity = Number(cap.value);
          formState.baseRate = Number(rate.value);
          formState.housekeepingStatus = hk.value;
          formState.features = features.value.split(',').map((s) => s.trim()).filter(Boolean);
          if (!formState.number) return;
          erpStore.upsertRoom(formState);
          close();
        });
        return form;
      },
    });
  }

  function openReservationModal() {
    const state = erpStore.state;
    if (!state) return;
    const defaultRoom = state.rooms.find((r) => r.commercialStatus === 'Disponible') || state.rooms[0];
    const formState = {
      guestId: state.guests[0]?.id || '',
      roomId: defaultRoom?.id || '',
      checkInDate: TODAY,
      checkOutDate: '2026-11-23',
      adults: 2,
      children: 0,
      channel: 'Directo Web',
      nightlyRate: defaultRoom?.baseRate || 340,
      specialRequests: '',
    };

    openModal({
      title: 'Nueva Reserva de Alojamiento',
      subtitle: 'Valida automáticamente cruces de fechas. Si hay conflicto, deriva a Sobreventa / Lista de Espera.',
      size: 'lg',
      renderBody: (close) => {
        const form = cloneModal('modal-reserva');
        const guestSel = getRef(form, 'guestId');
        const roomSel = getRef(form, 'roomId');
        const inDate = getRef(form, 'checkInDate');
        const outDate = getRef(form, 'checkOutDate');
        const channel = getRef(form, 'channel');
        const rate = getRef(form, 'nightlyRate');
        const adults = getRef(form, 'adults');
        const children = getRef(form, 'children');
        const reqs = getRef(form, 'specialRequests');

        mount(guestSel, state.guests.map((g) => h('option', { value: g.id, selected: formState.guestId === g.id }, `${g.fullName} (${g.loyaltyTier})`)));
        mount(roomSel, state.rooms.map((rm) => h('option', { value: rm.id, selected: formState.roomId === rm.id }, `Hab. ${rm.number} · ${rm.type} (${rm.commercialStatus} / ${rm.housekeepingStatus})`)));

        inDate.value = formState.checkInDate;
        outDate.value = formState.checkOutDate;
        channel.value = formState.channel;
        rate.value = String(formState.nightlyRate);
        adults.value = String(formState.adults);
        children.value = String(formState.children);

        roomSel.addEventListener('change', (e) => {
          const rm = state.rooms.find((r) => r.id === e.target.value);
          if (rm) rate.value = String(rm.baseRate);
        });
        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          erpStore.createReservation({
            guestId: guestSel.value,
            roomId: roomSel.value,
            checkInDate: inDate.value,
            checkOutDate: outDate.value,
            adults: Number(adults.value),
            children: Number(children.value),
            channel: channel.value,
            nightlyRate: Number(rate.value),
            specialRequests: reqs.value,
          });
          close();
        });
        return form;
      },
    });
  }

  function openHistoryModal(res) {
    const state = erpStore.state;
    const guest = state?.guests.find((g) => g.id === res.guestId);
    openModal({
      title: `Historial de Reserva ${res.code}`,
      subtitle: `${guest?.fullName || 'Huésped'} · ${res.checkInDate} → ${res.checkOutDate}`,
      renderBody: () =>
        h(
          'div',
          { className: 'stack-sm' },
          res.history.map((hItem) =>
            h('div', { className: 'p-3 border rounded-md row-between items-start' },
              h('div', null,
                h('div', { className: 'text-xs font-semibold text-navy' }, hItem.action),
                h('div', { className: 'text-11 text-slate-500 mt-0.5' }, `Usuario: ${hItem.user}`)
              ),
              h('span', { className: 'font-mono text-11 text-slate-400' }, hItem.timestamp)
            )
          )
        ),
    });
  }

  function openRateModal(rp) {
    const formState = rp
      ? { id: rp.id, name: rp.name, roomType: rp.roomType, season: rp.season, startDate: rp.startDate, endDate: rp.endDate, price: rp.price, active: rp.active, reason: '' }
      : { name: 'Tarifa Temporada Especial', roomType: 'Superior', season: 'Alta', startDate: TODAY, endDate: '2026-12-31', price: 360, active: true, reason: 'Creación inicial' };

    openModal({
      title: rp ? `Editar Tarifa · ${rp.roomType}` : 'Nuevo Plan Tarifario',
      subtitle: 'Los cambios actualizan la tarifa base de las habitaciones del tipo seleccionado.',
      renderBody: (close) => {
        const form = cloneModal('modal-tarifa');
        const name = getRef(form, 'name');
        const roomType = getRef(form, 'roomType');
        const season = getRef(form, 'season');
        const price = getRef(form, 'price');
        const startDate = getRef(form, 'startDate');
        const endDate = getRef(form, 'endDate');
        const reason = getRef(form, 'reason');

        name.value = formState.name;
        roomType.value = formState.roomType;
        season.value = formState.season;
        price.value = String(formState.price);
        startDate.value = formState.startDate;
        endDate.value = formState.endDate;
        reason.value = formState.reason;

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          erpStore.upsertRatePlan({
            ...formState,
            name: name.value,
            roomType: roomType.value,
            season: season.value,
            price: Number(price.value),
            startDate: startDate.value,
            endDate: endDate.value,
            reason: reason.value,
          });
          close();
        });
        return form;
      },
    });
  }

  function openGuestModal(editingGuest) {
    const formState = editingGuest
      ? { ...editingGuest, preferences: [...(editingGuest.preferences || [])] }
      : {
          fullName: '',
          documentType: 'DNI',
          documentNumber: '',
          nationality: 'Perú',
          email: '',
          phone: '',
          company: '',
          segment: 'Vacacional',
          loyaltyTier: 'Bronce',
          loyaltyPoints: 100,
          preferences: [],
          privacyConsentISO27701: true,
          marketingOptIn: false,
          consentDate: TODAY,
          notes: '',
        };

    openModal({
      title: editingGuest ? `Editar Huésped · ${editingGuest.fullName}` : 'Registrar Nuevo Huésped',
      subtitle: 'Control de privacidad y minimización de datos personales del huésped.',
      size: 'lg',
      renderBody: (close) => {
        const form = cloneModal('modal-huesped');
        const fullName = getRef(form, 'fullName');
        const documentType = getRef(form, 'documentType');
        const documentNumber = getRef(form, 'documentNumber');
        const nationality = getRef(form, 'nationality');
        const email = getRef(form, 'email');
        const phone = getRef(form, 'phone');
        const segment = getRef(form, 'segment');
        const company = getRef(form, 'company');
        const preferences = getRef(form, 'preferences');
        const privacy = getRef(form, 'privacyConsentISO27701');
        const optIn = getRef(form, 'marketingOptIn');

        fullName.value = formState.fullName;
        documentType.value = formState.documentType;
        documentNumber.value = formState.documentNumber;
        nationality.value = formState.nationality;
        email.value = formState.email;
        phone.value = formState.phone;
        segment.value = formState.segment;
        company.value = formState.company || '';
        preferences.value = formState.preferences.join(', ');
        privacy.checked = Boolean(formState.privacyConsentISO27701);
        optIn.checked = Boolean(formState.marketingOptIn);

        setText(form, 'submit-btn', editingGuest ? 'Actualizar huésped' : 'Registrar huésped');
        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!fullName.value.trim()) return;
          erpStore.upsertGuest({
            ...formState,
            fullName: fullName.value,
            documentType: documentType.value,
            documentNumber: documentNumber.value,
            nationality: nationality.value,
            email: email.value,
            phone: phone.value,
            segment: segment.value,
            company: company.value,
            preferences: preferences.value.split(',').map((s) => s.trim()).filter(Boolean),
            privacyConsentISO27701: privacy.checked,
            marketingOptIn: optIn.checked,
          });
          close();
        });
        return form;
      },
    });
  }

  function openWaitlistModal() {
    openModal({
      title: 'Nuevo Registro en Sobreventa / Lista de Espera',
      renderBody: (close) => {
        const form = cloneModal('modal-espera');
        const guestName = getRef(form, 'guestName');
        const contact = getRef(form, 'contact');
        const roomType = getRef(form, 'roomType');
        const conflictType = getRef(form, 'conflictType');
        const checkInDate = getRef(form, 'checkInDate');
        const checkOutDate = getRef(form, 'checkOutDate');

        roomType.value = 'Suite Junior';
        checkInDate.value = TODAY;
        checkOutDate.value = '2026-11-23';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!guestName.value.trim()) return;
          erpStore.createWaitlistEntry({
            guestName: guestName.value,
            contact: contact.value,
            roomType: roomType.value,
            conflictType: conflictType.value,
            checkInDate: checkInDate.value,
            checkOutDate: checkOutDate.value,
          });
          close();
        });
        return form;
      },
    });
  }

  function renderContent() {
    const state = erpStore.state;
    const currentUser = erpStore.currentUser;
    const canViewFullPII = erpStore.canViewFullPII;
    if (!state || !currentUser) return;

    const route = getRoute();
    const visibleTabs = M1_TABS.filter((t) => erpStore.canViewTab('m1', t.id));
    const defaultTab = erpStore.getDefaultTab('m1') || visibleTabs[0]?.id || 'habitaciones';
    const requestedTab = route.tab || defaultTab;
    const activeTab = visibleTabs.some((t) => t.id === requestedTab) ? requestedTab : defaultTab;
    const isTabDenied = Boolean(route.tab && !erpStore.canViewTab('m1', route.tab));
    const canEditCurrentTab = erpStore.canEditTab('m1', activeTab);

    const guestById = new Map(state.guests.map((g) => [g.id, g]));
    const roomById = new Map(state.rooms.map((r) => [r.id, r]));
    const folioByResId = new Map(state.folios.map((f) => [f.reservationId, f]));

    let tabBody = null;

    if (isTabDenied) {
      tabBody = AccessDeniedCard({
        resourceName: `Reservas y Recepción · ${M1_TABS.find((t) => t.id === route.tab)?.label || route.tab}`,
        roleLabel: currentUser.roleLabel,
        onBack: () => navigateToView('/reservas', defaultTab, true),
      });
    } else if (activeTab === 'habitaciones') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.habitaciones);
      tabBody = view;

      const typeSel = getRef(tabBody, 'type-select');
      if (typeSel) {
        typeSel.value = m1Ui.roomTypeFilter;
        typeSel.addEventListener('change', (e) => {
          m1Ui.roomTypeFilter = e.target.value;
          renderRoomsRows();
        });
      }

      if (canEditCurrentTab) {
        setVisible(tabBody, 'new-room-btn', true);
        setVisible(tabBody, 'actions-th', true);
        mountRef(tabBody, 'plus-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-room-btn')?.addEventListener('click', () => openRoomModal(null));
      }

      const renderRoomsRows = () => {
        const q = m1Ui.roomSearch.trim().toLowerCase();
        const filteredRooms = state.rooms.filter((rm) => {
          const matchType = m1Ui.roomTypeFilter === 'Todos' || rm.type === m1Ui.roomTypeFilter;
          const matchQ =
            !q ||
            rm.number.toLowerCase().includes(q) ||
            rm.type.toLowerCase().includes(q) ||
            (rm.features || []).some((f) => f.toLowerCase().includes(q));
          return matchType && matchQ;
        });

        mountRef(
          tabBody,
          'tbody',
          filteredRooms.map((rm) => {
            const tr = clone('fila-habitacion');
            setText(tr, 'number', `Hab. ${rm.number}`);
            setText(tr, 'floor', ` · P${rm.floor}`);
            setText(tr, 'type', rm.type);
            setText(tr, 'capacity', `Hasta ${rm.capacity} huéspedes`);
            setText(tr, 'features', (rm.features || []).join(' · '));
            setText(tr, 'rate', formatCurrency(rm.baseRate));
            mountRef(tr, 'commercial-status', StatusText({ label: rm.commercialStatus, variant: getStatusVariant(rm.commercialStatus) }));
            mountRef(tr, 'hk-status', StatusText({ label: rm.housekeepingStatus, variant: getStatusVariant(rm.housekeepingStatus) }));
            if (canEditCurrentTab) {
              setVisible(tr, 'actions-td', true);
              mountRef(tr, 'edit-icon', icon('edit', 'w-3'));
              getRef(tr, 'edit-btn')?.addEventListener('click', () => openRoomModal(rm));
            }
            return tr;
          })
        );
      };

      mountRef(tabBody, 'search-slot', SearchInput({
        value: m1Ui.roomSearch,
        placeholder: 'Buscar por número, tipo o característica...',
        onChange: (v) => {
          m1Ui.roomSearch = v;
          renderRoomsRows();
        },
      }));
      renderRoomsRows();
    } else if (activeTab === 'disponibilidad') {
      const days = ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24'];
      const { root: view } = loadViewTemplate(VIEW_HTML.disponibilidad);
      tabBody = view;
      mountRef(tabBody, 'cal-icon', icon('calendar', 'w-4 text-teal'));

      const filterIn = getRef(tabBody, 'filter-in');
      const filterOut = getRef(tabBody, 'filter-out');
      const filterType = getRef(tabBody, 'filter-type');
      if (filterIn) {
        filterIn.value = m1Ui.dispIn;
        filterIn.addEventListener('change', (e) => { m1Ui.dispIn = e.target.value; renderCalendarRows(); });
      }
      if (filterOut) {
        filterOut.value = m1Ui.dispOut;
        filterOut.addEventListener('change', (e) => { m1Ui.dispOut = e.target.value; renderCalendarRows(); });
      }
      if (filterType) {
        filterType.value = m1Ui.dispType;
        filterType.addEventListener('change', (e) => { m1Ui.dispType = e.target.value; renderCalendarRows(); });
      }

      const headRow = getRef(tabBody, 'head-row');
      days.forEach((d) => {
        headRow?.appendChild(
          h('th', { className: `text-center font-mono${d === TODAY ? ' cal-col-today' : ''}` }, d.slice(5))
        );
      });
      headRow?.appendChild(h('th', { className: 'text-right' }, 'Acción rango'));

      const renderCalendarRows = () => {
        const rooms = state.rooms.filter((rm) => m1Ui.dispType === 'Todos' || rm.type === m1Ui.dispType);
        mountRef(
          tabBody,
          'tbody',
          rooms.map((rm) => {
            const isOos = rm.housekeepingStatus === 'Fuera de servicio';
            const rangeRes = state.reservations.find(
              (r) => r.roomId === rm.id && !['Cancelada', 'No-Show', 'Check-out'].includes(r.status) && m1Ui.dispIn < r.checkOutDate && m1Ui.dispOut > r.checkInDate
            );
            let rangeSummary = 'Disponible y Lista';
            let summaryCls = 'text-11 font-medium text-teal';
            if (isOos) {
              rangeSummary = 'Fuera de servicio (Mant.)';
              summaryCls = 'text-11 font-medium text-danger';
            } else if (rangeRes) {
              rangeSummary = `Reservada (${rangeRes.code})`;
              summaryCls = 'text-11 text-slate-600';
            } else if (rm.housekeepingStatus !== 'Inspeccionada' && rm.housekeepingStatus !== 'Limpia') {
              rangeSummary = `Libre · ${rm.housekeepingStatus} (HK)`;
              summaryCls = 'text-11 text-warning font-medium';
            }

            return h(
              'tr',
              null,
              h('td', { className: 'text-xs' },
                h('strong', { className: 'font-mono text-navy' }, `Hab. ${rm.number}`),
                h('span', { className: 'text-slate-500' }, ` · ${rm.type}`)
              ),
              h('td', null, StatusText({ label: rm.housekeepingStatus, variant: getStatusVariant(rm.housekeepingStatus) })),
              days.map((d) => {
                const tdCls = `text-center${d === TODAY ? ' cal-col-today' : ''}`;
                if (isOos) {
                  return h('td', { className: tdCls }, h('span', { className: 'cal-pill cal-pill-blocked' }, 'Bloqueada'));
                }
                const res = state.reservations.find(
                  (r) => r.roomId === rm.id && !['Cancelada', 'No-Show', 'Check-out'].includes(r.status) && d >= r.checkInDate && d < r.checkOutDate
                );
                if (res) {
                  const g = guestById.get(res.guestId);
                  const firstName = (g?.fullName || res.code).split(' ')[0];
                  const pillCls = res.status === 'Check-in' ? 'cal-pill cal-pill-checkin' : 'cal-pill cal-pill-confirmed';
                  return h('td', { className: tdCls, title: `${res.code} · ${g?.fullName || ''}` }, h('span', { className: pillCls }, firstName));
                }
                return h('td', { className: tdCls }, h('span', { className: 'cal-pill cal-pill-free' }, 'Libre'));
              }),
              h('td', { className: `text-right ${summaryCls}` }, rangeSummary)
            );
          })
        );
      };

      renderCalendarRows();
    } else if (activeTab === 'reservas') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.reservas);
      tabBody = view;
      const tableWrap = getRef(tabBody, 'table-wrap');

      const renderReservasRows = () => {
        const q = m1Ui.resSearch.trim().toLowerCase();
        const filtered = state.reservations.filter((r) => {
          const g = guestById.get(r.guestId);
          const rm = roomById.get(r.roomId);
          const matchStatus = m1Ui.statusFilter === 'Todas' || r.status === m1Ui.statusFilter;
          const matchSearch =
            !q ||
            r.code.toLowerCase().includes(q) ||
            (g?.fullName || '').toLowerCase().includes(q) ||
            (rm?.number || '').includes(q);
          return matchStatus && matchSearch;
        });

        if (filtered.length === 0) {
          mount(tableWrap, EmptyState({ iconName: 'calendar', title: 'Sin reservas coincidentes', description: 'Intenta con otro filtro de estado o búsqueda.' }));
          return;
        }
        const tbl = clone('tabla-reservas');
        mountRef(
          tbl,
          'tbody',
          filtered.map((r) => {
            const g = guestById.get(r.guestId);
            const rm = roomById.get(r.roomId);
            const tr = clone('fila-reserva');
            setText(tr, 'code', r.code);
            setText(tr, 'channel', r.channel);
            setText(tr, 'guest', g?.fullName || '—');
            setText(tr, 'pax', `${r.adults} ad.${r.children > 0 ? ` · ${r.children} niños` : ''}`);
            setText(tr, 'room', rm ? `Hab. ${rm.number} · ${rm.type}` : '—');
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
        mount(tableWrap, tbl);
      };

      const statusSel = getRef(tabBody, 'status-select');
      if (statusSel) {
        statusSel.value = m1Ui.statusFilter;
        statusSel.addEventListener('change', (e) => {
          m1Ui.statusFilter = e.target.value;
          renderReservasRows();
        });
      }

      mountRef(tabBody, 'search-slot', SearchInput({
        value: m1Ui.resSearch,
        placeholder: 'Buscar código, huésped o habitación...',
        onChange: (v) => {
          m1Ui.resSearch = v;
          renderReservasRows();
        },
      }));
      renderReservasRows();
    } else if (activeTab === 'tarifas') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.tarifas);
      tabBody = view;
      if (canEditCurrentTab) {
        setVisible(tabBody, 'new-rate-btn', true);
        mountRef(tabBody, 'plus-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-rate-btn')?.addEventListener('click', () => openRateModal(null));
      }
      mountRef(
        tabBody,
        'grid',
        state.ratePlans.map((rp) => {
          const card = clone('card-tarifa');
          setText(card, 'kicker', `${rp.roomType} · Temporada ${rp.season}`);
          setText(card, 'name', rp.name);
          setText(card, 'dates', `${rp.startDate} → ${rp.endDate}`);
          setText(card, 'price', formatCurrency(rp.price));

          if (rp.history && rp.history.length > 0) {
            setVisible(card, 'history-box', true);
            mountRef(
              card,
              'history-list',
              rp.history.slice(0, 2).map((item) =>
                h('div', { className: 'text-11 text-slate-500 font-mono' },
                  `${item.date}: ${formatCurrency(item.previousPrice)} → ${formatCurrency(item.newPrice)} · `,
                  h('span', { className: 'font-sans' }, `${item.reason} (${item.user})`)
                )
              )
            );
          }

          if (canEditCurrentTab) {
            setVisible(card, 'actions-row', true);
            getRef(card, 'edit-btn')?.addEventListener('click', () => openRateModal(rp));
          }
          return card;
        })
      );
    } else if (activeTab === 'checkin') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.checkin);
      tabBody = view;
      const pending = state.reservations.filter((r) => r.status === 'Confirmada' || r.status === 'Pendiente');
      if (pending.length === 0) {
        mountRef(tabBody, 'content', EmptyState({ iconName: 'logIn', title: 'Sin ingresos pendientes', description: 'Todas las reservas confirmadas ya realizaron check-in.' }));
      } else {
        const readyOptions = state.rooms.filter((opt) => opt.commercialStatus === 'Disponible' && (opt.housekeepingStatus === 'Inspeccionada' || opt.housekeepingStatus === 'Limpia'));
        mountRef(
          tabBody,
          'content',
          h(
            'div',
            { className: 'grid-2' },
            pending.map((r) => {
              const g = guestById.get(r.guestId);
              const selectedRoomId = m1Ui.checkInRoomOverride[r.id] || r.roomId;
              const rm = roomById.get(selectedRoomId);
              const assignedRm = roomById.get(r.roomId);
              const ready = rm && (rm.housekeepingStatus === 'Inspeccionada' || rm.housekeepingStatus === 'Limpia');
              const card = clone('card-checkin');
              setText(card, 'code-channel', `${r.code} · ${r.channel}`);
              setText(card, 'guest', g?.fullName || '—');
              setText(card, 'meta', `${g?.documentType || ''} ${maskDocument(g?.documentNumber || '', canViewFullPII)} · ${r.checkInDate} → ${r.checkOutDate} (${r.nights}n)`);
              setText(card, 'total', formatCurrency(r.totalAmount));

              const sel = getRef(card, 'room-select');
              mount(
                sel,
                assignedRm
                  ? h('option', { value: assignedRm.id, selected: selectedRoomId === assignedRm.id }, `Hab. ${assignedRm.number} (${assignedRm.type}) — HK: ${assignedRm.housekeepingStatus} · ${assignedRm.commercialStatus}`)
                  : null,
                readyOptions
                  .filter((o) => o.id !== r.roomId)
                  .map((o) => h('option', { value: o.id, selected: selectedRoomId === o.id }, `Reasignar → Hab. ${o.number} (${o.type}) — HK: ${o.housekeepingStatus}`))
              );
              sel.disabled = !canEditCurrentTab;
              sel.addEventListener('change', (e) => {
                m1Ui.checkInRoomOverride[r.id] = e.target.value;
                renderContent();
              });

              if (r.specialRequests) {
                setVisible(card, 'note-box', true);
                setText(card, 'note-box', `Nota huésped: ${r.specialRequests}`);
              }

              if (!ready) {
                setVisible(card, 'blocked-alert', true);
                mountRef(card, 'warn-icon', icon('alertTriangle', 'w-4 shrink-0'));
                setText(card, 'blocked-text', `Check-in bloqueado en Hab. ${rm?.number}: estado físico "${rm?.housekeepingStatus}". Reasigne una habitación limpia/inspeccionada o complete la inspección en Housekeeping.`);
              }
              if (canEditCurrentTab) {
                setVisible(card, 'actions-row', true);
                mountRef(card, 'checkin-icon', icon('logIn', 'w-3.5'));
                getRef(card, 'checkin-btn')?.addEventListener('click', () => erpStore.performCheckIn(r.id, m1Ui.checkInRoomOverride[r.id]));
              }
              return card;
            })
          )
        );
      }
    } else if (activeTab === 'checkout') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.checkout);
      tabBody = view;
      const activeStays = state.reservations.filter((r) => r.status === 'Check-in');
      if (activeStays.length === 0) {
        mountRef(tabBody, 'content', EmptyState({ iconName: 'logOut', title: 'Sin estadías activas para salida', description: 'No hay habitaciones ocupadas con check-in vigente.' }));
      } else {
        mountRef(
          tabBody,
          'content',
          h(
            'div',
            { className: 'grid-2' },
            activeStays.map((r) => {
              const g = guestById.get(r.guestId);
              const rm = roomById.get(r.roomId);
              const folio = folioByResId.get(r.id);
              const hasBalance = folio && folio.balance > 0.01;
              const card = clone('card-checkout');
              setText(card, 'room-code', `Hab. ${rm?.number || '—'} · ${r.code}${folio ? ` · ${folio.code}` : ''}`);
              setText(card, 'guest', g?.fullName || '—');
              setText(card, 'date', `Salida programada: ${r.checkOutDate}`);
              mountRef(card, 'balance-status', StatusText({ label: hasBalance ? `Saldo ${formatCurrency(folio.balance)}` : 'Folio Liquidado', variant: hasBalance ? 'warning' : 'success' }));

              if (folio) {
                setVisible(card, 'folio-box', true);
                setText(card, 'charges-label', `Cargos (${folio.charges.length})`);
                setText(card, 'folio-charges', formatCurrency(folio.totalCharges));
                setText(card, 'folio-payments', formatCurrency(folio.totalPayments));
                setText(card, 'folio-balance', formatCurrency(folio.balance));
              }

              getRef(card, 'folio-btn')?.addEventListener('click', () => navigateToView('/facturacion', 'folios'));
              if (canEditCurrentTab) {
                if (hasBalance) {
                  setVisible(card, 'cxc-btn', true);
                  getRef(card, 'cxc-btn')?.addEventListener('click', () => erpStore.performCheckOut(r.id, true));
                }
                setVisible(card, 'checkout-btn', true);
                mountRef(card, 'checkout-icon', icon('logOut', 'w-3.5'));
                getRef(card, 'checkout-btn')?.addEventListener('click', () => erpStore.performCheckOut(r.id, false));
              }
              return card;
            })
          )
        );
      }
    } else if (activeTab === 'lista_espera') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.lista_espera);
      tabBody = view;
      if (canEditCurrentTab) {
        setVisible(tabBody, 'new-waitlist-btn', true);
        mountRef(tabBody, 'plus-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-waitlist-btn')?.addEventListener('click', openWaitlistModal);
      }
      mountRef(
        tabBody,
        'tbody',
        state.waitlist.map((w) => {
          const tr = clone('fila-espera');
          mountRef(tr, 'conflict-badge', StatusText({ label: w.conflictType, variant: w.conflictType === 'Sobreventa' ? 'danger' : 'warning' }));
          setText(tr, 'created-at', w.createdAt || TODAY);
          setText(tr, 'guest', w.guestName);
          setText(tr, 'contact', w.contact);
          setText(tr, 'room-type', w.roomType);
          setText(tr, 'dates', `${w.checkInDate} → ${w.checkOutDate}`);
          mountRef(tr, 'status-badge', StatusText({ label: w.status, variant: w.status === 'Asignada' ? 'success' : w.status === 'Cancelada' ? 'neutral' : 'warning' }));
          if (w.authorizedBy) {
            setVisible(tr, 'auth-note', true);
            setText(tr, 'auth-note', `${w.decisionNote || ''} (${w.authorizedBy})`);
          }
          mountRef(
            tr,
            'resolution',
            w.status === 'Pendiente' && canEditCurrentTab
              ? h('div', { className: 'row-wrap justify-end' },
                  h('button', {
                    type: 'button',
                    className: 'btn btn-outline btn-xs text-teal',
                    onClick: () => erpStore.resolveWaitlistEntry(w.id, 'Asignada', 'Upgrade o asignación aprobada'),
                  }, 'Aprobar / Upgrade'),
                  h('button', {
                    type: 'button',
                    className: 'btn btn-outline-muted btn-xs',
                    onClick: () => erpStore.resolveWaitlistEntry(w.id, 'Reubicada', 'Reubicado en habitación disponible equivalente'),
                  }, 'Reubicar')
                )
              : h('span', { className: 'text-11 text-slate-500' }, w.authorizedBy || w.status)
          );
          return tr;
        })
      );
    } else if (activeTab === 'ocupacion') {
      const occupiedCount = state.rooms.filter((r) => r.commercialStatus === 'Ocupada').length;
      const totalCount = Math.max(1, state.rooms.length);
      const occPct = Math.round((occupiedCount / totalCount) * 100);
      const activeStays = state.reservations.filter((r) => r.status === 'Check-in');
      const adr = activeStays.length > 0
        ? Math.round(activeStays.reduce((sum, r) => sum + r.nightlyRate, 0) / activeStays.length)
        : 0;
      const revpar = Math.round((occupiedCount * adr) / totalCount);
      const arrivalsToday = state.reservations.filter((r) => r.checkInDate === TODAY && r.status === 'Confirmada').length;
      const blockedCount = state.rooms.filter((r) => r.housekeepingStatus === 'Fuera de servicio' || r.commercialStatus === 'Bloqueada').length;
      const freeCommercial = state.rooms.filter((r) => r.commercialStatus === 'Disponible').length;

      const categories = [
        { match: 'Estándar', label: 'Estándar' },
        { match: 'Superior', label: 'Superior' },
        { match: 'Deluxe Vista Mar', label: 'Deluxe Mar' },
        { match: 'Suite Junior', label: 'Suite Junior' },
        { match: 'Suite Presidencial', label: 'Presid.' },
      ];
      const byType = categories.map((cat) => {
        const subset = state.rooms.filter((r) => r.type === cat.match);
        const comprometidas = subset.filter((r) => r.commercialStatus === 'Ocupada' || r.commercialStatus === 'Reservada').length;
        const libres = subset.filter((r) => r.commercialStatus === 'Disponible').length;
        return {
          type: cat.label,
          comprometidas,
          libres,
        };
      });

      const { root: view } = loadViewTemplate(VIEW_HTML.ocupacion);
      tabBody = view;
      mountRef(
        tabBody,
        'kpis',
        StatTile({ label: 'Ocupación Actual', value: `${occPct}%`, meta: `${occupiedCount} de ${totalCount} habitaciones`, tone: 'teal' }),
        StatTile({ label: 'ADR (Tarifa Promedio)', value: formatCurrency(adr), meta: 'Estadías activas hoy' }),
        StatTile({ label: 'RevPAR', value: formatCurrency(revpar), meta: 'Ingreso por habitación disponible' }),
        StatTile({ label: 'Llegadas / Bloqueadas', value: `${arrivalsToday} / ${blockedCount}`, meta: `${freeCommercial} libres comerciales` })
      );
      mountRef(
        tabBody,
        'chart-slot',
        renderStackedBarChart({
          data: byType,
          labelKey: 'type',
          series: [
            { key: 'comprometidas', name: 'Comprometidas (Ocupadas + Reservadas)', color: '#0F172A' },
            { key: 'libres', name: 'Libres', color: '#0D9488' },
          ],
          height: 250,
        })
      );
    } else if (activeTab === 'huespedes') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.huespedes);
      tabBody = view;
      if (canEditCurrentTab) {
        setVisible(tabBody, 'new-guest-btn', true);
        setVisible(tabBody, 'actions-th', true);
        mountRef(tabBody, 'plus-icon', icon('userPlus', 'w-3.5'));
        getRef(tabBody, 'new-guest-btn')?.addEventListener('click', () => openGuestModal(null));
      }

      const renderGuestsTable = () => {
        const q = m1Ui.guestSearch.trim().toLowerCase();
        const filtered = state.guests.filter(
          (g) =>
            !q ||
            g.fullName.toLowerCase().includes(q) ||
            (g.company || '').toLowerCase().includes(q) ||
            (g.documentNumber || '').toLowerCase().includes(q) ||
            g.segment.toLowerCase().includes(q)
        );
        mountRef(
          tabBody,
          'tbody',
          filtered.map((g) => {
            const tr = clone('fila-huesped');
            setText(tr, 'name', g.fullName);
            setText(tr, 'company', g.company || g.nationality || '—');
            setText(tr, 'doc', `${g.documentType} ${maskDocument(g.documentNumber, canViewFullPII)}`);
            setText(tr, 'email', maskEmail(g.email, canViewFullPII));
            setText(tr, 'phone', maskPhone(g.phone, canViewFullPII));
            setText(tr, 'segment', g.segment);
            setText(tr, 'loyalty', g.loyaltyTier);
            setText(tr, 'stays', `${g.totalStays} estadías`);
            setText(tr, 'spent', formatCurrency(g.totalSpent || 0));
            mountRef(tr, 'privacy', StatusText({ label: g.privacyConsentISO27701 ? 'Consentido' : 'Pendiente', variant: g.privacyConsentISO27701 ? 'success' : 'warning' }));
            if (canEditCurrentTab) {
              setVisible(tr, 'action', true);
              mountRef(tr, 'action', h('button', { type: 'button', className: 'btn btn-outline btn-xs', onClick: () => openGuestModal(g) }, 'Editar'));
            }
            return tr;
          })
        );
      };

      mountRef(tabBody, 'search-slot', SearchInput({
        value: m1Ui.guestSearch,
        placeholder: 'Buscar huésped, documento o empresa...',
        onChange: (v) => {
          m1Ui.guestSearch = v;
          renderGuestsTable();
        },
      }));
      renderGuestsTable();
    } else if (activeTab === 'ia_tarifas') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.ia_tarifas);
      tabBody = view;

      const dynamicRows = [
        { category: 'Estándar', demandPct: 50, suggestedRate: 260, deltaLabel: '0%', reason: 'Demanda estable en rango esperado.', actionable: false },
        { category: 'Superior', demandPct: 33, suggestedRate: 340, deltaLabel: '0%', reason: 'Demanda estable en rango esperado.', actionable: false },
        { category: 'Deluxe Vista Mar', demandPct: 50, suggestedRate: 505, deltaLabel: '+10%', reason: 'Alta demanda (50% comprometido + 1 en lista de espera).', actionable: true },
        { category: 'Suite Junior', demandPct: 100, suggestedRate: 680, deltaLabel: '+10%', reason: 'Alta demanda (100% comprometido + 1 en lista de espera).', actionable: true },
        { category: 'Suite Presidencial', demandPct: 0, suggestedRate: 1080, deltaLabel: '-6%', reason: 'Baja ocupación inmediata (0%); tarifa promocional para impulsar conversión directa.', actionable: true },
      ];

      mountRef(
        tabBody,
        'dynamic-rates-tbody',
        dynamicRows.map((row) => {
          const rp = state.ratePlans.find((r) => r.roomType === row.category);
          const currentRate = rp ? rp.price : row.suggestedRate;
          const alreadyApplied = currentRate === row.suggestedRate;
          const tr = clone('fila-tarifa-ia');
          setText(tr, 'category', row.category);
          setText(tr, 'demand', `${row.demandPct}%`);
          setText(tr, 'current-rate', formatCurrency(currentRate));
          const sugEl = setText(tr, 'suggested-rate', `${formatCurrency(row.suggestedRate)} (${row.deltaLabel})`);
          if (sugEl) {
            sugEl.classList.add(row.deltaLabel.startsWith('-') ? 'text-warning' : 'text-teal');
          }
          setText(tr, 'reason', row.reason);
          if (!row.actionable || alreadyApplied) {
            mountRef(tr, 'action', h('span', { className: 'text-11 text-slate-400' }, alreadyApplied && row.actionable ? 'Aplicada' : 'Sin cambio'));
          } else if (canEditCurrentTab) {
            mountRef(
              tr,
              'action',
              h('button', {
                type: 'button',
                className: 'btn btn-teal btn-xs',
                onClick: () => erpStore.applyDynamicRate(row.category, row.suggestedRate, row.reason),
              }, '✓ Aprobar y aplicar')
            );
          } else {
            mountRef(tr, 'action', h('span', { className: 'text-11 text-slate-400' }, 'Requiere autorización'));
          }
          return tr;
        })
      );

      mountRef(tabBody, 'noshow-icon', icon('alertTriangle', 'w-4 text-warning'));
      const upcoming = state.reservations.filter((r) => r.status === 'Confirmada' || r.status === 'Pendiente');
      mountRef(
        tabBody,
        'noshow-list',
        upcoming.map((r) => {
          const g = guestById.get(r.guestId);
          const risk = r.noShowRisk || 12;
          const riskLevel = risk >= 50 ? 'Alto' : risk >= 25 ? 'Moderado' : 'Bajo';
          const riskVariant = risk >= 50 ? 'danger' : risk >= 25 ? 'warning' : 'success';
          const row = clone('fila-noshow-ia');
          setText(row, 'title', `${r.code} · ${g?.fullName || '—'} (${r.channel})`);
          setText(row, 'factors', `Factores: ${risk >= 50 ? 'Sin garantía de tarjeta confirmada · ' : ''}Canal ${r.channel} · Ingreso ${r.checkInDate}`);
          mountRef(
            row,
            'right',
            StatusText({ label: `Riesgo ${risk}% (${riskLevel})`, variant: riskVariant }),
            risk >= 25
              ? h('button', {
                  type: 'button',
                  className: 'btn btn-outline btn-xs',
                  onClick: () => erpStore.pushToast({ title: `Reconfirmación registrada (${r.code})`, detail: `Se envió recordatorio y solicitud de garantía a ${g?.fullName || 'huésped'}.`, type: 'success' }),
                }, 'Registrar reconfirmación')
              : null
          );
          return row;
        })
      );

      mountRef(
        tabBody,
        'advisor-slot',
        ModuleAIAdvisor({
          moduleId: 'm1-reservas-ia',
          moduleName: 'Reservas y Recepción',
          title: 'Asesor IA de Revenue Management y Recepción',
          description: 'Consulta sobre estrategia de tarifas dinámicas, gestión de sobreventa y prevención de no-shows.',
          suggestedPrompts: [
            'Evalúa las reservas con mayor riesgo de no-show y sugiere un plan de acción para recepción.',
            '¿Qué estrategia de sobreventa controlada recomiendas para Suite Junior este fin de semana?',
            'Analiza el RevPAR actual y propón ajustes tarifarios por canal.',
          ],
          contextData: {
            tarifas: state.ratePlans.map((r) => ({ tipo: r.roomType, precio: r.price, temporada: r.season })),
            reservas: state.reservations.map((r) => ({ code: r.code, status: r.status, channel: r.channel, noShowRisk: r.noShowRisk })),
            waitlist: state.waitlist,
          },
        })
      );
    }

    const tabCounts = {
      habitaciones: state.rooms.length,
      reservas: state.reservations.length,
      tarifas: state.ratePlans.length,
      checkin: state.reservations.filter((r) => r.status === 'Confirmada').length,
      checkout: state.reservations.filter((r) => r.status === 'Check-in').length,
      lista_espera: state.waitlist.filter((w) => w.status === 'Pendiente').length,
      huespedes: state.guests.length,
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
          ? 'Módulo 01 · Operaciones Front Desk'
          : 'Módulo 01 · Operaciones Front Desk · Modo consulta (solo lectura)',
        title: 'Reservas y Recepción',
        subtitle: 'Gestión de habitaciones, disponibilidad real sincronizada con Housekeeping, reservas, tarifas, check-in/out e IA.',
        actions: canEditCurrentTab
          ? h('div', { className: 'row-wrap' },
              erpStore.canEditTab('m1', 'huespedes')
                ? h('button', { type: 'button', className: 'btn btn-outline', onClick: () => openGuestModal(null) }, icon('userPlus', 'w-4'), h('span', null, 'Nuevo Huésped'))
                : null,
              erpStore.canEditTab('m1', 'reservas')
                ? h('button', { type: 'button', className: 'btn btn-primary', onClick: openReservationModal }, icon('plus', 'w-4'), h('span', null, 'Nueva Reserva'))
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
            onChange: (nextTab) => navigateToView('/reservas', nextTab),
          })
        : null
    );
    mount(bodySlot, tabBody);
  }

  renderContent();
  return root;
}
