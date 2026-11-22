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
import modalesHtml from '../../html/modules/crm/modales.html?raw';
import perfil360Html from '../../html/modules/crm/perfil-360.html?raw';
import segmentacionHtml from '../../html/modules/crm/segmentacion.html?raw';
import fidelizacionHtml from '../../html/modules/crm/fidelizacion.html?raw';
import campanasHtml from '../../html/modules/crm/campanas.html?raw';
import reclamosHtml from '../../html/modules/crm/reclamos.html?raw';
import solicitudesHtml from '../../html/modules/crm/solicitudes.html?raw';
import encuestasHtml from '../../html/modules/crm/encuestas.html?raw';
import resenasHtml from '../../html/modules/crm/resenas.html?raw';
import portalIaHtml from '../../html/modules/crm/portal-ia.html?raw';
import iaConversacionalHtml from '../../html/modules/crm/ia-conversacional.html?raw';
import { formatCurrency } from '../utils/formatters.js';
import { getRoute, navigateToView } from '../core/router.js';
import { erpStore } from '../core/store.js';
import { maskDocument, maskEmail, maskPhone } from '../data/rbac.js';
import { sendCRMChatMessage } from '../services/ai-client.js';
import { apiV1Request } from '../services/api-client.js';
import { bindPagedContainer } from '../components/paged-view.js';
import { GuestPicker } from '../components/guest-picker.js';
import { getPagedList } from '../services/paged-list.js';
import {
  mapCRMProfiles,
  mapCampaignRows,
  mapComplaintRows,
  mapGuestRequestRows,
  mapReviewRows,
  mapSurveyRows,
} from '../services/erp-mappers.js';
import {
  AccessDeniedCard,
  EmptyState,
  ModuleAIAdvisor,
  ModuleHeader,
  StatTile,
  StatusText,
  openModal,
} from '../components/ui-components.js';

const cloneModal = createTemplateLibrary(modalesHtml);

const VIEW_HTML = {
  perfil_360: perfil360Html,
  segmentacion: segmentacionHtml,
  fidelizacion: fidelizacionHtml,
  campanas: campanasHtml,
  reclamos: reclamosHtml,
  solicitudes: solicitudesHtml,
  encuestas: encuestasHtml,
  resenas: resenasHtml,
  portal_ia: portalIaHtml,
  ia_conversacional: iaConversacionalHtml,
};

const M5_TABS = [
  { id: 'perfil_360', label: 'Perfil 360°', subtitle: 'Ficha integral del huésped: estadías, consumos y preferencias.' },
  { id: 'segmentacion', label: 'Segmentación', subtitle: 'Segmentos de huéspedes.' },
  { id: 'fidelizacion', label: 'Fidelización', subtitle: 'Puntos y beneficios de fidelización.' },
  { id: 'campanas', label: 'Campañas', subtitle: 'Campañas de marketing por segmento y canal.' },
  { id: 'reclamos', label: 'Reclamos', subtitle: 'Registro y seguimiento de reclamos.' },
  { id: 'solicitudes', label: 'Solicitudes', subtitle: 'Solicitudes de los huéspedes.' },
  { id: 'encuestas', label: 'Encuestas', subtitle: 'Resultados de las encuestas de satisfacción.' },
  { id: 'resenas', label: 'Reseñas', subtitle: 'Reseñas de huéspedes y sus respuestas.' },
  { id: 'portal_ia', label: 'Autoatención', subtitle: 'Solicitudes de autoatención del huésped.' },
  { id: 'ia_conversacional', label: 'IA Conversacional', subtitle: 'Asistente conversacional para consultas de CRM.' },
];

const m5Ui = {
  rewards: null, // null = aún sin leer; [] = leído sin beneficios
  rewardsLoading: false,
  profileDetails: new Map(),
  profileDetailsLoading: new Set(),
  selectedGuestId: '',
  selectedLoyaltyGuestId: '',
  reviewReplyDraft: {},
  portalGuestId: '',
  portalReqType: 'Amenity / Almohadas',
  portalReqDesc: '',
  chatInput: '',
  chatLoading: false,
  chatMessages: [
    {
      role: 'assistant',
      text: 'Hola, soy el asistente conversacional CRM de Hotel Boulevard. Puedo clasificar reclamos, analizar sentimiento o redactar respuestas empáticas para tus huéspedes.',
    },
  ],
};

export function renderCRMModule() {
  const root = parseHtmlTemplate(moduleShellHtml);
  const headerSlot = getRef(root, 'header-slot');
  const bodySlot = getRef(root, 'body-slot');

  function getStatusVariant(status) {
    if (['Resuelto', 'ATENDIDA', 'Atendida', 'Activa', 'Positivo', 'Excelente', 'Autorizado'].includes(status)) return 'success';
    if (['En seguimiento', 'EN_ATENCION', 'DERIVADA', 'Derivada', 'REGISTRADA', 'Pendiente', 'Programada', 'Pausada', 'Finalizada', 'Neutral', 'Media'].includes(status)) return 'warning';
    if (['Escalado a Mantenimiento', 'Abierto', 'Crítica', 'Alta', 'Muy Negativo', 'Negativo', 'CANCELADA', 'Cancelada'].includes(status)) return 'danger';
    return 'info';
  }

  function cleanNoteText(text) {
    return String(text || '').replace(/^Flujo [A-F]:\s*/i, '');
  }

  function roomForGuest(state, guestId) {
    const folio = state.folios.find((item) => item.guestId === guestId && item.status === 'Abierto');
    if (folio?.roomNumber) return folio.roomNumber;
    return state.reservations.find((item) => item.guestId === guestId && item.roomNumber)?.roomNumber || '';
  }

  function mountCRMGuestPicker(slot, state, roomInput) {
    const picker = GuestPicker({
      source: 'perfiles',
      onSelect: (guest) => {
        erpStore.ensureGuest(guest);
        if (roomInput) roomInput.value = roomForGuest(state, guest.id);
      },
    });
    mount(slot, picker);
    return picker;
  }

  function openComplaintModal() {
    const state = erpStore.state;
    openModal({
      title: 'Registrar Reclamo de Huésped',
      subtitle: 'Si afecta infraestructura o activas escalamiento, crea automáticamente una Incidencia en Mantenimiento.',
      renderBody: (close) => {
        const form = cloneModal('modal-reclamo');
        const guestSlot = getRef(form, 'guest');
        const roomIn = getRef(form, 'room');
        const catSel = getRef(form, 'category');
        const sevSel = getRef(form, 'severity');
        const descIn = getRef(form, 'description');
        const escChk = getRef(form, 'escalate');

        const guestPicker = mountCRMGuestPicker(guestSlot, state, roomIn);

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!guestPicker.getValue() || !descIn.value.trim()) return;
          erpStore.createComplaint({
            guestId: guestPicker.getValue(),
            roomNumber: roomIn.value.trim(),
            category: catSel.value,
            severity: sevSel.value,
            description: descIn.value.trim(),
            escalateToMaintenance: escChk.checked,
          });
          close();
        });
        return form;
      },
    });
  }

  function openRequestModal() {
    const state = erpStore.state;
    openModal({
      title: 'Nueva Solicitud de Huésped',
      subtitle: 'Deriva automáticamente la atención a Recepción, Housekeeping o Mantenimiento.',
      renderBody: (close) => {
        const form = cloneModal('modal-solicitud');
        const guestSlot = getRef(form, 'guest');
        const roomIn = getRef(form, 'room');
        const typeSel = getRef(form, 'type');
        const areaSel = getRef(form, 'target-area');
        const descIn = getRef(form, 'description');

        const guestPicker = mountCRMGuestPicker(guestSlot, state, roomIn);

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!guestPicker.getValue() || !descIn.value.trim()) return;
          erpStore.createGuestRequest({
            guestId: guestPicker.getValue(),
            roomNumber: roomIn.value.trim(),
            type: typeSel.value,
            targetArea: areaSel.value,
            description: descIn.value.trim(),
            source: 'Recepción/CRM',
          });
          close();
        });
        return form;
      },
    });
  }

  function openCampaignModal() {
    const state = erpStore.state;
    openModal({
      title: 'Nueva Campaña de Marketing (Opt-In)',
      subtitle: 'Solo se enviará a huéspedes con consentimiento comercial vigente.',
      renderBody: (close) => {
        const form = cloneModal('modal-campana');
        const nameIn = getRef(form, 'name');
        const segSel = getRef(form, 'segment');
        const chSel = getRef(form, 'channel');
        const subIn = getRef(form, 'subject');

        mount(segSel, (state?.segments ?? []).map((segment) => h('option', { value: segment.name }, segment.name)));

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!nameIn.value.trim()) return;
          erpStore.createCampaign({
            name: nameIn.value.trim(),
            segment: segSel.value,
            channel: chSel.value,
            subject: subIn.value.trim(),
            offerDescription: subIn.value.trim(),
            status: 'Activa',
          });
          close();
        });
        return form;
      },
    });
  }

  function openSurveyModal() {
    const state = erpStore.state;
    openModal({
      title: 'Registrar Encuesta de Satisfacción',
      renderBody: (close) => {
        const form = cloneModal('modal-encuesta');
        const guestSlot = getRef(form, 'guest');
        const overallIn = getRef(form, 'overall');
        const cleanIn = getRef(form, 'cleanliness');
        const srvIn = getRef(form, 'service');
        const npsIn = getRef(form, 'nps');
        const comIn = getRef(form, 'comment');

        const guestPicker = mountCRMGuestPicker(guestSlot, state);

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!guestPicker.getValue()) return;
          const g = guestPicker.getSelected();
          const clean = Number(cleanIn.value);
          const srv = Number(srvIn.value);
          const npsVal = Number(npsIn.value);
          erpStore.addSurveyResponse({
            guestId: guestPicker.getValue(),
            guestName: g?.fullName || '',
            overallScore: Number(overallIn.value),
            cleanliness: clean,
            cleanlinessScore: clean,
            service: srv,
            serviceScore: srv,
            food: Number(overallIn.value),
            npsScore: npsVal,
            npsRecommend: npsVal,
            comment: comIn.value.trim(),
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
    const visibleTabs = M5_TABS.filter((t) => erpStore.canViewTab('m5', t.id));

    const defaultTab = erpStore.getDefaultTab('m5') || visibleTabs[0]?.id || 'perfil_360';
    const requestedTab = route.tab || defaultTab;
    const activeTab = visibleTabs.some((t) => t.id === requestedTab) ? requestedTab : defaultTab;
    const activeMeta = M5_TABS.find((t) => t.id === activeTab);
    const isTabDenied = Boolean(route.tab && !erpStore.canViewTab('m5', route.tab));
    const canEditCurrentTab = erpStore.canEditTab('m5', activeTab);

    if (!m5Ui.selectedGuestId && state.guests.length > 0) m5Ui.selectedGuestId = state.guests[0].id;
    if (!m5Ui.selectedLoyaltyGuestId && state.guests.length > 0) m5Ui.selectedLoyaltyGuestId = state.guests[0].id;
    if (!m5Ui.portalGuestId && state.guests.length > 0) m5Ui.portalGuestId = state.guests[0].id;
    const selectedGuest = state.guests.find((g) => g.id === m5Ui.selectedGuestId) || state.guests[0];

    let tabBody = null;

    if (isTabDenied) {
      tabBody = AccessDeniedCard({
        resourceName: `CRM y Huésped · ${route.tab}`,
        roleLabel: currentUser.roleLabel,
        onBack: () => navigateToView('/crm', defaultTab, true),
      });
    } else if (activeTab === 'perfil_360') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.perfil_360);
      tabBody = view;

      const renderProfileDetail = (guest) => {
        if (!guest) {
          mountRef(tabBody, 'detail-slot', EmptyState({ iconName: 'users', title: 'Selecciona un huésped', description: 'Elige un perfil del listado izquierdo.' }));
          return;
        }
        const cached = m5Ui.profileDetails.get(guest.profileId);
        const detailGuest = cached?.guest || guest;
        const detail = clone('detalle-huesped-360');
        setText(detail, 'segment-tier', detailGuest.segment);
        setText(detail, 'full-name', detailGuest.fullName);
        setText(detail, 'contact-pii', `${detailGuest.documentType} ${maskDocument(detailGuest.documentNumber, canViewFullPII)} · ${maskEmail(detailGuest.email, canViewFullPII)} · ${maskPhone(detailGuest.phone, canViewFullPII)}`);
        mountRef(detail, 'consent-status', StatusText({
          label: detailGuest.privacyConsentISO27701 ? 'Privacidad consentida' : 'Sin consentimiento',
          variant: detailGuest.privacyConsentISO27701 ? 'success' : 'warning',
        }));
        mountRef(
          detail,
          'kpis',
          StatTile({ label: 'Puntos de fidelización', value: detailGuest.loyaltyPoints.toLocaleString('es-PE'), tone: 'teal' }),
          StatTile({ label: 'Estadías acumuladas', value: detailGuest.totalStays }),
          StatTile({ label: 'Gasto histórico', value: formatCurrency(detailGuest.totalSpent) })
        );
        const preferences = cached?.preferences ?? [];
        setText(detail, 'preferences', preferences.length > 0 ? preferences.join(' · ') : (cached ? 'Sin preferencias registradas' : 'Cargando preferencias…'));
        setVisible(detail, 'notes', Boolean(detailGuest.notes));
        if (detailGuest.notes) setText(detail, 'notes', `Nota: ${detailGuest.notes}`);
        const reservations = cached?.reservations ?? [];
        setText(detail, 'res-title', cached ? `Reservas recientes (${reservations.length})` : 'Reservas recientes');
        mountRef(detail, 'res-folio-list', cached
          ? (reservations.length > 0 ? reservations.map((reservation) => {
              const row = clone('item-huesped-reserva');
              setText(row, 'label', `${reservation.codigo_reserva} (${reservation.estado_reserva})`);
              setText(row, 'amount', formatCurrency(Number(reservation.total_reserva) || 0));
              return row;
            }) : h('div', { className: 'text-xs text-slate-400' }, 'Sin reservas asociadas.'))
          : h('div', { className: 'text-xs text-slate-400' }, 'Cargando…'));
        const complaints = cached?.complaints ?? [];
        setText(detail, 'comp-title', cached ? `Reclamos recientes (${complaints.length})` : 'Reclamos recientes');
        mountRef(detail, 'comp-list', cached
          ? (complaints.length > 0 ? complaints.map((complaint) => {
              const row = clone('item-huesped-reclamo');
              setText(row, 'code', complaint.codigo_seguimiento || String(complaint.id_reclamo));
              mountRef(row, 'status', StatusText({ label: complaint.estado, variant: getStatusVariant(complaint.estado) }));
              setText(row, 'desc', complaint.descripcion || 'Sin descripción');
              return row;
            }) : h('div', { className: 'text-xs text-slate-400' }, 'Sin reclamos registrados.'))
          : h('div', { className: 'text-xs text-slate-400' }, 'Cargando…'));
        mountRef(tabBody, 'detail-slot', detail);

        if (!cached && !m5Ui.profileDetailsLoading.has(guest.profileId)) {
          m5Ui.profileDetailsLoading.add(guest.profileId);
          apiV1Request(`/m5/perfiles/${encodeURIComponent(guest.profileId)}`)
            .then((response) => {
              const data = response?.data;
              const mappedGuest = data?.perfil ? mapCRMProfiles([data.perfil])[0] : guest;
              m5Ui.profileDetails.set(guest.profileId, {
                guest: mappedGuest,
                preferences: (data?.preferencias ?? []).filter((item) => item.vigente).map((item) => item.descripcion),
                reservations: data?.reservas ?? [],
                complaints: data?.reclamos ?? [],
              });
              if (m5Ui.selectedGuestId === guest.id) renderProfileDetail(mappedGuest);
            })
            .catch(() => {
              m5Ui.profileDetails.set(guest.profileId, { guest, preferences: [], reservations: [], complaints: [] });
              if (m5Ui.selectedGuestId === guest.id) renderProfileDetail(guest);
            })
            .finally(() => m5Ui.profileDetailsLoading.delete(guest.profileId));
        }
      };

      const renderProfileRows = (rows) => {
        const selected = rows.find((guest) => guest.id === m5Ui.selectedGuestId) || rows[0];
        if (selected && selected.id !== m5Ui.selectedGuestId) m5Ui.selectedGuestId = selected.id;
        renderProfileDetail(selected);
        const fragment = document.createDocumentFragment();
        rows.forEach((g) => {
          const btn = clone('item-huesped-lista');
          if (selected?.id === g.id) {
            btn.style.borderColor = 'var(--teal-600)';
          }
          setText(btn, 'name', g.fullName);
          setText(btn, 'tier', g.loyaltyTier);
          setText(btn, 'meta', `${g.segment} · ${g.totalStays} estadías · ${formatCurrency(g.totalSpent)}`);
          btn.addEventListener('click', () => {
            m5Ui.selectedGuestId = g.id;
            renderProfileDetail(g);
          });
          fragment.appendChild(btn);
        });
        return fragment;
      };
      bindPagedContainer({
        container: getRef(tabBody, 'guests-list'),
        key: 'm5.perfil360',
        list: getPagedList('m5.perfil360', { path: '/m5/perfiles', map: mapCRMProfiles, pageSize: 10 }),
        filters: { searchPlaceholder: 'Buscar huésped, documento, correo o empresa…' },
        renderBody: renderProfileRows,
        empty: { iconName: 'users', title: 'Sin perfiles CRM', description: 'Aún no hay huéspedes con perfil CRM.' },
        noMatch: { iconName: 'search', title: 'Sin perfiles coincidentes', description: 'Prueba con otra búsqueda.' },
      });
    } else if (activeTab === 'segmentacion') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.segmentacion);
      tabBody = view;
      getRef(tabBody, 'filter-pills')?.remove();
      const renderSegmentRows = (rows) => {
        const fragment = document.createDocumentFragment();
        rows.forEach((g) => {
          const row = clone('fila-segmento');
          setText(row, 'name', g.fullName);
          setText(row, 'segment', g.segment);
          setText(row, 'tier', g.loyaltyTier);
          setText(row, 'stays', String(g.totalStays));
          setText(row, 'spent', formatCurrency(g.totalSpent));
          mountRef(
            row,
            'optin',
            StatusText({
              label: g.marketingOptIn ? 'Autorizado' : 'No contactar',
              variant: g.marketingOptIn ? 'success' : 'neutral',
              showIcon: g.marketingOptIn,
            })
          );
          fragment.appendChild(row);
        });
        return fragment;
      };
      bindPagedContainer({
        container: getRef(tabBody, 'tbody'),
        key: 'm5.segmentacion',
        list: getPagedList('m5.segmentacion', { path: '/m5/perfiles', map: mapCRMProfiles, pageSize: 10 }),
        filters: {
          searchPlaceholder: 'Buscar huésped, documento, correo o empresa…',
          statusOptions: [
            { value: '', label: 'Todos los segmentos' },
            ...state.segments.map((segment) => ({ value: segment.name, label: segment.name })),
          ],
        },
        renderBody: renderSegmentRows,
        empty: { iconName: 'users', title: 'Sin perfiles CRM', description: 'Aún no hay huéspedes con perfil CRM.' },
        noMatch: { iconName: 'search', title: 'Sin perfiles coincidentes', description: 'Prueba con otra búsqueda o segmento.' },
      });
    } else if (activeTab === 'fidelizacion') {
      const rewards = m5Ui.rewards ?? [];
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.fidelizacion);
      tabBody = view;
      mountRef(tabBody, 'award-icon', icon('award', 'w-4 text-teal'));

      const renderRewards = (guest) => {
        if (!guest) return;
        setText(tabBody, 'rewards-title', `Catálogo de recompensas (${guest.fullName})`);
        setText(tabBody, 'points-available', `${guest.loyaltyPoints.toLocaleString('es-PE')} puntos`);
        mountRef(tabBody, 'rewards-list',
          m5Ui.rewardsLoading
            ? h('div', { className: 'text-xs text-slate-400' }, 'Cargando recompensas…')
            : rewards.map((rw) => {
                const row = clone('item-recompensa');
                setText(row, 'label', rw.label);
                setText(row, 'cost', `${rw.points.toLocaleString('es-PE')} puntos`);
                const btn = getRef(row, 'redeem-btn');
                setVisible(row, 'redeem-btn', canEditCurrentTab);
                if (canEditCurrentTab && btn) {
                  btn.disabled = guest.loyaltyPoints < rw.points;
                  btn.addEventListener('click', () => erpStore.redeemLoyaltyPoints(guest.id, rw.points, rw.label));
                }
                return row;
              })
        );
        if (m5Ui.rewards === null && !m5Ui.rewardsLoading) {
          m5Ui.rewardsLoading = true;
          apiV1Request(`/m5/fidelizacion/perfiles/${encodeURIComponent(guest.profileId)}`)
            .then((response) => {
              m5Ui.rewards = (response?.data?.beneficios ?? []).map((item) => ({ label: item.nombre, points: Number(item.puntos_requeridos) || 0 }));
            })
            .catch(() => { m5Ui.rewards = []; })
            .finally(() => {
              m5Ui.rewardsLoading = false;
              if (m5Ui.selectedLoyaltyGuestId === guest.id) renderContent();
            });
        }
      };

      const renderLoyaltyRows = (rows) => {
        const selected = rows.find((guest) => guest.id === m5Ui.selectedLoyaltyGuestId) || rows[0];
        if (selected && selected.id !== m5Ui.selectedLoyaltyGuestId) m5Ui.selectedLoyaltyGuestId = selected.id;
        renderRewards(selected);
        const fragment = document.createDocumentFragment();
        rows.forEach((g) => {
          const item = clone('item-fidelizacion-huesped');
          if (selected?.id === g.id) item.classList.add('bg-teal-soft');
          setText(item, 'name', g.fullName);
          setText(item, 'meta', `Nivel ${g.loyaltyTier} · ${g.totalStays} estadías`);
          setText(item, 'points', `${g.loyaltyPoints.toLocaleString('es-PE')} pts`);
          item.addEventListener('click', () => {
            m5Ui.selectedLoyaltyGuestId = g.id;
            renderRewards(g);
          });
          fragment.appendChild(item);
        });
        return fragment;
      };
      bindPagedContainer({
        container: getRef(tabBody, 'guests-list'),
        key: 'm5.fidelizacion',
        list: getPagedList('m5.fidelizacion', { path: '/m5/perfiles', map: mapCRMProfiles, pageSize: 10 }),
        filters: { searchPlaceholder: 'Buscar huésped, documento, correo o empresa…' },
        renderBody: renderLoyaltyRows,
        empty: { iconName: 'award', title: 'Sin perfiles de fidelización', description: 'Aún no hay huéspedes en el programa.' },
        noMatch: { iconName: 'search', title: 'Sin huéspedes coincidentes', description: 'Prueba con otra búsqueda.' },
      });
    } else if (activeTab === 'campanas') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.campanas);
      tabBody = view;
      setVisible(tabBody, 'new-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', openCampaignModal);
      }
      const renderCampaigns = (rows) => {
        const fragment = document.createDocumentFragment();
        rows.forEach((cp) => {
          const card = clone('card-campana');
          setText(card, 'seg-channel', `${cp.segment} · Canal ${cp.channel}`);
          mountRef(card, 'status', StatusText({ label: cp.status, variant: getStatusVariant(cp.status) }));
          setText(card, 'name', cp.name);
          setText(card, 'offer', cp.offerDescription || cp.subject || '');
          setText(card, 'sent', String(cp.sentCount));
          setText(card, 'open-rate', cp.openRate == null ? '—' : `${cp.openRate}%`);
          setText(card, 'conversions', cp.conversionCount == null ? '—' : String(cp.conversionCount));
          setVisible(card, 'actions-wrap', canEditCurrentTab);
          if (canEditCurrentTab) {
            const btn = getRef(card, 'toggle-btn');
            const nextStatus = cp.status === 'Activa' ? 'Finalizada' : 'Activa';
            btn.textContent = cp.status === 'Activa' ? 'Finalizar campaña' : 'Reactivar campaña';
            btn.addEventListener('click', () => erpStore.toggleCampaignStatus(cp.id, nextStatus));
          }
          fragment.appendChild(card);
        });
        return fragment;
      };
      bindPagedContainer({
        container: getRef(tabBody, 'grid'),
        key: 'm5.campanas',
        list: getPagedList('m5.campanas', { path: '/m5/campanas', map: mapCampaignRows, pageSize: 10 }),
        filters: {
          searchPlaceholder: 'Buscar campaña, segmento o canal…',
          statusOptions: [
            { value: '', label: 'Todos los estados' },
            { value: 'PROGRAMADA', label: 'Programada' },
            { value: 'ACTIVA', label: 'Activa' },
            { value: 'CERRADA', label: 'Finalizada' },
            { value: 'CANCELADA', label: 'Cancelada' },
          ],
        },
        renderBody: renderCampaigns,
        empty: { iconName: 'megaphone', title: 'Sin campañas', description: 'Aún no hay campañas registradas.' },
        noMatch: { iconName: 'search', title: 'Sin campañas coincidentes', description: 'Prueba con otra búsqueda o estado.' },
      });
    } else if (activeTab === 'reclamos') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.reclamos);
      tabBody = view;
      setVisible(tabBody, 'new-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', openComplaintModal);
      }
      const renderComplaints = (rows) => {
        const fragment = document.createDocumentFragment();
        rows.forEach((cmp) => {
          const card = clone('fila-reclamo');
          setText(card, 'title', `${cmp.code} · ${cmp.guestName}${cmp.roomNumber ? ` (Hab. ${cmp.roomNumber})` : ''}`);
          setText(card, 'meta', `${cmp.category} · Severidad ${cmp.severity} · Sentimiento IA: ${cmp.sentiment}`);
          setText(card, 'description', cmp.description);
          mountRef(card, 'status', StatusText({ label: cmp.status, variant: getStatusVariant(cmp.status) }));
          const canResolve = canEditCurrentTab && cmp.status !== 'Resuelto';
          setVisible(card, 'resolve-btn', canResolve);
          if (canResolve) {
            getRef(card, 'resolve-btn').addEventListener('click', () =>
              erpStore.updateComplaintStatus(cmp.id, 'Resuelto', 'Resuelto y confirmado con el huésped')
            );
          }
          mountRef(
            card,
            'history-list',
            (cmp.history || []).map((hItem) => {
              const hRow = clone('item-historial-reclamo');
              setText(hRow, 'timestamp', hItem.timestamp);
              setText(hRow, 'user', hItem.user);
              setText(hRow, 'note', cleanNoteText(hItem.note));
              return hRow;
            })
          );
          fragment.appendChild(card);
        });
        return fragment;
      };
      bindPagedContainer({
        container: getRef(tabBody, 'list'),
        key: 'm5.reclamos',
        list: getPagedList('m5.reclamos', { path: '/m5/reclamos', map: mapComplaintRows, pageSize: 10 }),
        filters: {
          searchPlaceholder: 'Buscar código, huésped, tipo o descripción…',
          statusOptions: [
            { value: '', label: 'Todos los estados' },
            { value: 'ABIERTO', label: 'Abierto' },
            { value: 'EN_SEGUIMIENTO', label: 'En seguimiento' },
            { value: 'DERIVADO', label: 'Derivado' },
            { value: 'EN_ATENCION', label: 'En atención' },
            { value: 'CERRADO', label: 'Resuelto' },
          ],
        },
        renderBody: renderComplaints,
        empty: { iconName: 'messageSquare', title: 'Sin reclamos', description: 'Aún no hay reclamos registrados.' },
        noMatch: { iconName: 'search', title: 'Sin reclamos coincidentes', description: 'Prueba con otra búsqueda o estado.' },
      });
    } else if (activeTab === 'solicitudes') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.solicitudes);
      tabBody = view;
      setVisible(tabBody, 'header-actions', canEditCurrentTab);
      setVisible(tabBody, 'th-actions', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', openRequestModal);
      }
      const renderRequestRows = (rows) => {
        const fragment = document.createDocumentFragment();
        rows.forEach((req) => {
          const row = clone('fila-solicitud');
          setText(row, 'code', req.code);
          setText(row, 'source', req.source || 'Portal Autoatención');
          setText(row, 'guest', req.guestName);
          setText(row, 'room', `Hab. ${req.roomNumber}`);
          setText(row, 'type-area', `${req.type} → ${req.targetArea}`);
          setText(row, 'description', req.description);
          mountRef(row, 'status', StatusText({ label: req.status, variant: getStatusVariant(req.status) }));
          setVisible(row, 'td-actions', canEditCurrentTab);
          const canAttend = canEditCurrentTab && !['ATENDIDA', 'Atendida', 'CANCELADA'].includes(req.status);
          setVisible(row, 'attend-btn', canAttend);
          if (canAttend) {
            getRef(row, 'attend-btn').addEventListener('click', () => erpStore.updateGuestRequestStatus(req.id, 'ATENDIDA'));
          }
          fragment.appendChild(row);
        });
        return fragment;
      };
      bindPagedContainer({
        container: getRef(tabBody, 'tbody'),
        key: 'm5.solicitudes',
        list: getPagedList('m5.solicitudes', { path: '/m5/solicitudes', map: mapGuestRequestRows, pageSize: 10 }),
        filters: {
          searchPlaceholder: 'Buscar código, huésped, habitación o solicitud…',
          statusOptions: [
            { value: '', label: 'Todos los estados' },
            { value: 'REGISTRADA', label: 'Registrada' },
            { value: 'DERIVADA', label: 'Derivada' },
            { value: 'EN_ATENCION', label: 'En atención' },
            { value: 'ATENDIDA', label: 'Atendida' },
            { value: 'CANCELADA', label: 'Cancelada' },
          ],
        },
        renderBody: renderRequestRows,
        empty: { iconName: 'clipboardList', title: 'Sin solicitudes', description: 'Aún no hay solicitudes de huéspedes.' },
        noMatch: { iconName: 'search', title: 'Sin solicitudes coincidentes', description: 'Prueba con otra búsqueda o estado.' },
      });
    } else if (activeTab === 'encuestas') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.encuestas);
      tabBody = view;
      setVisible(tabBody, 'header-actions', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', openSurveyModal);
      }

      const surveyList = getPagedList('m5.encuestas', {
        path: '/m5/opiniones?status=ENCUESTA',
        map: mapSurveyRows,
        pageSize: 10,
      });
      const renderSurveys = (rows) => {
        const avgScore = rows.length > 0
          ? (rows.reduce((sum, item) => sum + Number(item.overallScore || 0), 0) / rows.length).toFixed(2)
          : null;
        const promoters = rows.filter((item) => Number(item.npsScore ?? 0) >= 9).length;
        const detractors = rows.filter((item) => Number(item.npsScore ?? 0) <= 6).length;
        const npsVal = rows.length > 0 ? Math.round(((promoters - detractors) / rows.length) * 100) : null;
        mountRef(
          tabBody,
          'kpis',
          StatTile({ label: 'Promedio de esta página', value: avgScore === null ? '—' : `${avgScore} / 5.0`, tone: 'teal' }),
          StatTile({ label: 'NPS de esta página', value: npsVal === null ? '—' : `${npsVal >= 0 ? '+' : ''}${npsVal}`, tone: 'success' }),
          StatTile({ label: 'Encuestas registradas', value: String(surveyList.state.total) })
        );
        const fragment = document.createDocumentFragment();
        rows.forEach((srv) => {
          const row = clone('fila-encuesta');
          setText(row, 'guest', srv.guestName);
          setText(row, 'date', ` · ${srv.date}`);
          setText(row, 'comment', srv.comment || 'Sin comentario adicional');
          const cln = srv.cleanliness ?? srv.cleanlinessScore ?? '—';
          const sr = srv.service ?? srv.serviceScore ?? '—';
          const fd = srv.food ?? '—';
          setText(row, 'breakdown', `Limpieza: ${cln} · Servicio: ${sr} · Gastronomía: ${fd}`);
          setText(row, 'score', `${srv.overallScore} / 5`);
          setText(row, 'nps', `NPS: ${srv.npsScore ?? srv.npsRecommend ?? '—'}/10`);
          fragment.appendChild(row);
        });
        return fragment;
      };
      bindPagedContainer({
        container: getRef(tabBody, 'list'),
        key: 'm5.encuestas',
        list: surveyList,
        filters: { searchPlaceholder: 'Buscar huésped o comentario…' },
        renderBody: renderSurveys,
        empty: { iconName: 'star', title: 'Sin encuestas', description: 'Aún no hay encuestas registradas.' },
        noMatch: { iconName: 'search', title: 'Sin encuestas coincidentes', description: 'Prueba con otra búsqueda.' },
      });
    } else if (activeTab === 'resenas') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.resenas);
      tabBody = view;
      const renderReviews = (rows) => {
        const fragment = document.createDocumentFragment();
        rows.forEach((rev) => {
          const card = clone('card-resena');
          setText(card, 'guest', rev.guestName || rev.author || 'Huésped');
          setText(card, 'channel-date', ` · ${rev.channel} · ${rev.date}`);
          setText(card, 'rating', `★ ${Number(rev.rating || 5).toFixed(1)}`);
          mountRef(card, 'sentiment', StatusText({ label: rev.sentiment, variant: getStatusVariant(rev.sentiment) }));
          setText(card, 'comment', rev.text || rev.comment || '');

          const hasReply = Boolean(rev.hotelReply);
          setVisible(card, 'reply-box', hasReply);
          setVisible(card, 'reply-form', !hasReply && canEditCurrentTab);
          if (hasReply) {
            setText(card, 'reply-text', rev.hotelReply);
          } else if (canEditCurrentTab) {
            const replyIn = getRef(card, 'reply-input');
            replyIn.value = m5Ui.reviewReplyDraft[rev.id] || '';
            replyIn.addEventListener('input', (e) => {
              m5Ui.reviewReplyDraft[rev.id] = e.target.value;
            });
            getRef(card, 'reply-submit').addEventListener('click', () => {
              const txt = (m5Ui.reviewReplyDraft[rev.id] || '').trim();
              if (!txt) return;
              erpStore.replyToReview(rev.id, txt);
              delete m5Ui.reviewReplyDraft[rev.id];
            });
          }
          fragment.appendChild(card);
        });
        return fragment;
      };
      bindPagedContainer({
        container: getRef(tabBody, 'list'),
        key: 'm5.resenas',
        list: getPagedList('m5.resenas', { path: '/m5/opiniones?status=RESENA', map: mapReviewRows, pageSize: 10 }),
        filters: { searchPlaceholder: 'Buscar huésped, título o comentario…' },
        renderBody: renderReviews,
        empty: { iconName: 'star', title: 'Sin reseñas', description: 'Aún no hay reseñas registradas.' },
        noMatch: { iconName: 'search', title: 'Sin reseñas coincidentes', description: 'Prueba con otra búsqueda.' },
      });
    } else if (activeTab === 'portal_ia') {
      const portalGuest = state.guests.find((g) => g.id === m5Ui.portalGuestId) || state.guests[0];
      const guestFolio = portalGuest ? state.folios.find((f) => f.guestId === portalGuest.id) : null;
      const guestRes = portalGuest ? state.reservations.find((r) => r.guestId === portalGuest.id) : null;
      const guestRoom = guestFolio?.roomNumber || guestRes?.roomNumber || '';

      const { root: view, clone } = loadViewTemplate(VIEW_HTML.portal_ia);
      tabBody = view;
      mountRef(tabBody, 'shield-icon', icon('shield', 'w-4'));
      mountRef(tabBody, 'user-icon', icon('users', 'w-4 text-teal'));

      const guestSel = getRef(tabBody, 'portal-guest');
      mount(
        guestSel,
        state.guests.map((g) => {
          const f = state.folios.find((x) => x.guestId === g.id);
          const r = state.reservations.find((x) => x.guestId === g.id);
          const rm = f?.roomNumber || r?.roomNumber || '';
          return h('option', { value: g.id, selected: portalGuest?.id === g.id }, `Huésped activo: ${g.fullName}${rm ? ` (Hab. ${rm})` : ''}`);
        })
      );
      if (portalGuest) guestSel.value = portalGuest.id;
      guestSel.addEventListener('change', (e) => {
        m5Ui.portalGuestId = e.target.value;
        renderContent();
      });

      setText(tabBody, 'stay-title', guestRoom ? `Mi estadía y estado de cuenta (Hab. ${guestRoom})` : 'Sin habitación activa');
      const charges = guestFolio?.charges || [];
      mountRef(
        tabBody,
        'charges-list',
        charges.length === 0
          ? h('div', { className: 'py-2.5 text-xs text-slate-400' }, 'Sin cargos activos en estadía.')
          : charges.map((c) => {
              const row = clone('item-estado-cuenta');
              setText(row, 'desc', c.description);
              setText(row, 'amount', formatCurrency(c.amount));
              return row;
            })
      );
      setText(tabBody, 'current-balance', formatCurrency(guestFolio?.balance ?? 0));

      const reqTypeSel = getRef(tabBody, 'portal-req-type');
      reqTypeSel.value = m5Ui.portalReqType;
      reqTypeSel.addEventListener('change', (e) => { m5Ui.portalReqType = e.target.value; });

      const reqDescIn = getRef(tabBody, 'portal-req-desc');
      reqDescIn.value = m5Ui.portalReqDesc;
      reqDescIn.addEventListener('input', (e) => { m5Ui.portalReqDesc = e.target.value; });

      setVisible(tabBody, 'portal-submit-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        getRef(tabBody, 'portal-submit-btn').addEventListener('click', () => {
          if (!portalGuest || !m5Ui.portalReqDesc.trim()) return;
          erpStore.createGuestRequest({
            guestId: portalGuest.id,
            roomNumber: guestRoom,
            type: m5Ui.portalReqType,
            targetArea:
              m5Ui.portalReqType === 'Soporte Técnico'
                ? 'Mantenimiento'
                : m5Ui.portalReqType === 'Amenity / Almohadas'
                ? 'Housekeeping'
                : 'Recepción',
            description: m5Ui.portalReqDesc.trim(),
            source: 'Portal Autoatención',
          });
          m5Ui.portalReqDesc = '';
          renderContent();
        });
      }
    } else if (activeTab === 'ia_conversacional') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.ia_conversacional);
      tabBody = view;
      mountRef(tabBody, 'chat-icon', icon('messageSquare', 'w-4 text-teal'));
      mountRef(tabBody, 'send-icon', icon('send', 'w-3.5'));

      const chatBox = getRef(tabBody, 'chat-box');
      const chatInputEl = getRef(tabBody, 'chat-input');
      chatInputEl.value = m5Ui.chatInput;
      chatInputEl.addEventListener('input', (e) => {
        m5Ui.chatInput = e.target.value;
      });

      const renderChatHistory = () => {
        mount(
          chatBox,
          m5Ui.chatMessages.map((msg) => {
            const row = clone('chat-mensaje');
            if (msg.role === 'user') row.classList.add('is-user');
            const bubble = getRef(row, 'bubble');
            bubble.classList.add(msg.role === 'user' ? 'is-user' : 'is-assistant');
            bubble.textContent = msg.text;
            return row;
          })
        );
        chatBox.scrollTop = chatBox.scrollHeight;
      };
      renderChatHistory();

      const sendChat = async () => {
        const text = m5Ui.chatInput.trim();
        if (!text || m5Ui.chatLoading) return;
        m5Ui.chatMessages.push({ role: 'user', text });
        m5Ui.chatInput = '';
        chatInputEl.value = '';
        m5Ui.chatLoading = true;
        renderChatHistory();
        try {
          const reply = await sendCRMChatMessage({
            message: text,
            guestContext: selectedGuest
              ? { nombre: selectedGuest.fullName, nivel: selectedGuest.loyaltyTier, preferencias: selectedGuest.preferences }
              : undefined,
          });
          m5Ui.chatMessages.push({
            role: 'assistant',
            text: reply.reply || reply.text || reply.respuesta || 'Consulta atendida.',
          });
        } catch (err) {
          m5Ui.chatMessages.push({
            role: 'assistant',
            text: err instanceof Error ? err.message : 'Error consultando asistente.',
          });
        } finally {
          m5Ui.chatLoading = false;
          renderChatHistory();
        }
      };

      getRef(tabBody, 'chat-form').addEventListener('submit', (e) => {
        e.preventDefault();
        sendChat();
      });

      mountRef(
        tabBody,
        'advisor-slot',
        ModuleAIAdvisor({
          moduleId: 'm5-crm',
          moduleName: 'CRM y Atención al Huésped',
          title: 'Análisis de Sentimiento, Reclamos y Retención',
          description: 'Evalúa reseñas, encuestas NPS y reclamos activos para priorizar acciones de recuperación de servicio.',
          suggestedPrompts: [
            'Resume las tendencias de sentimiento en las reseñas y encuestas recientes.',
            'Propón una campaña personalizada para convertir huéspedes Vacacionales en Frecuentes.',
            'Sugiere protocolos de compensación para reclamos de severidad Alta en huéspedes VIP.',
          ],
          contextData: {
            reclamosAbiertos: state.complaints.filter((c) => c.status !== 'Resuelto'),
            encuestas: state.surveys,
            resenas: state.reviews,
            segmentos: state.guests.map((g) => ({ segment: g.segment, tier: g.loyaltyTier, spent: g.totalSpent })),
          },
        })
      );
    }

    mount(
      headerSlot,
      ModuleHeader({
        moduleNumber: canEditCurrentTab ? 'CRM y Atención' : 'CRM y Atención · Solo lectura',
        title: activeMeta?.label ?? 'CRM y Atención',
        subtitle: activeMeta?.subtitle ?? '',
      })
    );
    mount(bodySlot, tabBody);
  }

  renderContent();
  return root;
}
