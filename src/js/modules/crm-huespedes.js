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
import {
  AccessDeniedCard,
  EmptyState,
  ModuleAIAdvisor,
  ModuleHeader,
  StatTile,
  StatusText,
  SubmoduleBar,
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
  { id: 'perfil_360', label: 'Perfil 360°' },
  { id: 'segmentacion', label: 'Segmentación' },
  { id: 'fidelizacion', label: 'Fidelización' },
  { id: 'campanas', label: 'Campañas' },
  { id: 'reclamos', label: 'Reclamos' },
  { id: 'solicitudes', label: 'Solicitudes' },
  { id: 'encuestas', label: 'Encuestas' },
  { id: 'resenas', label: 'Reseñas' },
  { id: 'portal_ia', label: 'Autoatención' },
  { id: 'ia_conversacional', label: 'IA Conversacional' },
];

const m5Ui = {
  selectedGuestId: '',
  selectedLoyaltyGuestId: '',
  segmentFilter: 'Todos',
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
  const tabsSlot = getRef(root, 'tabs-slot');
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

  function openComplaintModal() {
    const state = erpStore.state;
    openModal({
      title: 'Registrar Reclamo de Huésped',
      subtitle: 'Si afecta infraestructura o activas escalamiento, crea automáticamente una Incidencia en Mantenimiento.',
      renderBody: (close) => {
        const form = cloneModal('modal-reclamo');
        const guestSel = getRef(form, 'guest');
        const roomIn = getRef(form, 'room');
        const catSel = getRef(form, 'category');
        const sevSel = getRef(form, 'severity');
        const descIn = getRef(form, 'description');
        const escChk = getRef(form, 'escalate');

        mount(guestSel, state.guests.map((g) => h('option', { value: g.id }, g.fullName)));
        roomIn.value = '203';
        sevSel.value = 'Alta';
        escChk.checked = true;

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!descIn.value.trim()) return;
          erpStore.createComplaint({
            guestId: guestSel.value,
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
      subtitle: 'Deriva automáticamente la atención al área correspondiente (Recepción, Housekeeping, Mantenimiento o Restaurante).',
      renderBody: (close) => {
        const form = cloneModal('modal-solicitud');
        const guestSel = getRef(form, 'guest');
        const roomIn = getRef(form, 'room');
        const typeSel = getRef(form, 'type');
        const areaSel = getRef(form, 'target-area');
        const descIn = getRef(form, 'description');

        mount(guestSel, state.guests.map((g) => h('option', { value: g.id }, g.fullName)));
        roomIn.value = '201';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!descIn.value.trim()) return;
          erpStore.createGuestRequest({
            guestId: guestSel.value,
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
    openModal({
      title: 'Nueva Campaña de Marketing (Opt-In)',
      subtitle: 'Solo se enviará a huéspedes con consentimiento comercial vigente.',
      renderBody: (close) => {
        const form = cloneModal('modal-campana');
        const nameIn = getRef(form, 'name');
        const segSel = getRef(form, 'segment');
        const chSel = getRef(form, 'channel');
        const subIn = getRef(form, 'subject');

        segSel.value = 'VIP';

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
        const guestSel = getRef(form, 'guest');
        const overallIn = getRef(form, 'overall');
        const cleanIn = getRef(form, 'cleanliness');
        const srvIn = getRef(form, 'service');
        const npsIn = getRef(form, 'nps');
        const comIn = getRef(form, 'comment');

        mount(guestSel, state.guests.map((g) => h('option', { value: g.id }, g.fullName)));
        overallIn.value = '5';
        cleanIn.value = '5';
        srvIn.value = '5';
        npsIn.value = '9';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const g = state.guests.find((x) => x.id === guestSel.value);
          const clean = Number(cleanIn.value);
          const srv = Number(srvIn.value);
          const npsVal = Number(npsIn.value);
          erpStore.addSurveyResponse({
            guestId: guestSel.value,
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
    const isTabDenied = Boolean(route.tab && !erpStore.canViewTab('m5', route.tab));
    const canEditCurrentTab = erpStore.canEditTab('m5', activeTab);

    if (!m5Ui.selectedGuestId && state.guests.length > 0) m5Ui.selectedGuestId = state.guests[0].id;
    if (!m5Ui.selectedLoyaltyGuestId && state.guests.length > 0) m5Ui.selectedLoyaltyGuestId = state.guests[0].id;
    if (!m5Ui.portalGuestId && state.guests.length > 0) m5Ui.portalGuestId = state.guests[0].id;
    const selectedGuest = state.guests.find((g) => g.id === m5Ui.selectedGuestId) || state.guests[0];
    const selectedLoyaltyGuest = state.guests.find((g) => g.id === m5Ui.selectedLoyaltyGuestId) || state.guests[0];

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

      mountRef(
        tabBody,
        'guests-list',
        state.guests.map((g) => {
          const btn = clone('item-huesped-lista');
          if (selectedGuest?.id === g.id) {
            btn.style.borderColor = 'var(--teal-600)';
          }
          setText(btn, 'name', g.fullName);
          setText(btn, 'tier', g.loyaltyTier);
          setText(btn, 'meta', `${g.segment} · ${g.totalStays} estadías · ${formatCurrency(g.totalSpent)}`);
          btn.addEventListener('click', () => {
            m5Ui.selectedGuestId = g.id;
            renderContent();
          });
          return btn;
        })
      );

      if (selectedGuest) {
        const gRes = state.reservations.filter((r) => r.guestId === selectedGuest.id);
        const gFolios = state.folios.filter((f) => f.guestId === selectedGuest.id);
        const gComplaints = state.complaints.filter((c) => c.guestId === selectedGuest.id);

        const detail = clone('detalle-huesped-360');
        setText(detail, 'segment-tier', `${selectedGuest.segment} · Nivel ${selectedGuest.loyaltyTier}`);
        setText(detail, 'full-name', selectedGuest.fullName);
        setText(
          detail,
          'contact-pii',
          `${selectedGuest.documentType} ${maskDocument(selectedGuest.documentNumber, canViewFullPII)} · ${maskEmail(selectedGuest.email, canViewFullPII)} · ${maskPhone(selectedGuest.phone, canViewFullPII)}`
        );
        mountRef(
          detail,
          'consent-status',
          StatusText({
            label: selectedGuest.privacyConsentISO27701 ? 'Privacidad Consentida' : 'Sin consentimiento',
            variant: selectedGuest.privacyConsentISO27701 ? 'success' : 'warning',
          })
        );

        mountRef(
          detail,
          'kpis',
          StatTile({ label: 'Puntos Fidelización', value: selectedGuest.loyaltyPoints.toLocaleString('es-PE'), tone: 'teal' }),
          StatTile({ label: 'Estadías Acumuladas', value: selectedGuest.totalStays }),
          StatTile({ label: 'Gasto Histórico', value: formatCurrency(selectedGuest.totalSpent) })
        );

        setText(detail, 'preferences', selectedGuest.preferences.length > 0 ? selectedGuest.preferences.join(' · ') : 'Sin preferencias registradas');
        setVisible(detail, 'notes', Boolean(selectedGuest.notes));
        if (selectedGuest.notes) setText(detail, 'notes', `Nota: ${selectedGuest.notes}`);

        setText(detail, 'res-title', `Reservas y Folios (${gRes.length})`);
        const resFolioItems = [
          ...gRes.map((r) => {
            const row = clone('item-huesped-reserva');
            setText(row, 'label', `${r.code} (${r.status})`);
            setText(row, 'amount', formatCurrency(r.totalAmount));
            return row;
          }),
          ...gFolios.map((f) => {
            const row = clone('item-huesped-folio');
            setText(row, 'label', `Folio ${f.code} · Hab. ${f.roomNumber}`);
            setText(row, 'balance', `Saldo ${formatCurrency(f.balance)}`);
            return row;
          }),
        ];
        mountRef(
          detail,
          'res-folio-list',
          resFolioItems.length > 0
            ? resFolioItems
            : h('div', { className: 'text-xs text-slate-400' }, 'Sin reservas ni folios asociados.')
        );

        setText(detail, 'comp-title', `Reclamos Asociados (${gComplaints.length})`);
        mountRef(
          detail,
          'comp-list',
          gComplaints.length === 0
            ? h('div', { className: 'text-xs text-slate-400' }, 'Sin reclamos registrados.')
            : gComplaints.map((c) => {
                const row = clone('item-huesped-reclamo');
                setText(row, 'code', `${c.code} · Hab. ${c.roomNumber || 'N/A'}`);
                mountRef(row, 'status', StatusText({ label: c.status, variant: getStatusVariant(c.status) }));
                setText(row, 'desc', c.description);
                return row;
              })
        );

        mountRef(tabBody, 'detail-slot', detail);
      } else {
        mountRef(
          tabBody,
          'detail-slot',
          EmptyState({ iconName: 'users', title: 'Selecciona un huésped', description: 'Elige un perfil del listado izquierdo.' })
        );
      }
    } else if (activeTab === 'segmentacion') {
      const segments = ['Todos', 'Corporativo', 'VIP', 'Vacacional', 'Frecuente', 'Nuevo'];
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.segmentacion);
      tabBody = view;

      mountRef(
        tabBody,
        'filter-pills',
        segments.map((seg) =>
          h(
            'button',
            {
              type: 'button',
              className: `filter-pill${m5Ui.segmentFilter === seg ? ' is-active' : ''}`,
              onClick: () => {
                m5Ui.segmentFilter = seg;
                renderContent();
              },
            },
            seg
          )
        )
      );

      const filteredGuests =
        m5Ui.segmentFilter === 'Todos'
          ? state.guests
          : state.guests.filter((g) => g.segment === m5Ui.segmentFilter);

      mountRef(
        tabBody,
        'tbody',
        filteredGuests.map((g) => {
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
          return row;
        })
      );
    } else if (activeTab === 'fidelizacion') {
      const rewards = [
        { label: 'Desayuno Buffet para 2 personas', points: 800 },
        { label: 'Circuito Hidrotermal en Spa', points: 1500 },
        { label: 'Upgrade a Suite Junior (1 noche)', points: 2500 },
        { label: 'Noche de cortesía Deluxe Vista Mar', points: 4000 },
      ];
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.fidelizacion);
      tabBody = view;
      mountRef(tabBody, 'award-icon', icon('award', 'w-4 text-teal'));

      mountRef(
        tabBody,
        'guests-list',
        state.guests.map((g) => {
          const item = clone('item-fidelizacion-huesped');
          if (selectedLoyaltyGuest?.id === g.id) item.classList.add('bg-teal-soft');
          setText(item, 'name', g.fullName);
          setText(item, 'meta', `Nivel ${g.loyaltyTier} · ${g.totalStays} estadías`);
          setText(item, 'points', `${g.loyaltyPoints.toLocaleString('es-PE')} pts`);
          item.addEventListener('click', () => {
            m5Ui.selectedLoyaltyGuestId = g.id;
            renderContent();
          });
          return item;
        })
      );

      if (selectedLoyaltyGuest) {
        setText(tabBody, 'rewards-title', `Catálogo de Recompensas (${selectedLoyaltyGuest.fullName})`);
        setText(tabBody, 'points-available', `${selectedLoyaltyGuest.loyaltyPoints.toLocaleString('es-PE')} puntos`);
        mountRef(
          tabBody,
          'rewards-list',
          rewards.map((rw) => {
            const row = clone('item-recompensa');
            setText(row, 'label', rw.label);
            setText(row, 'cost', `${rw.points.toLocaleString('es-PE')} puntos`);
            const btn = getRef(row, 'redeem-btn');
            setVisible(row, 'redeem-btn', canEditCurrentTab);
            if (canEditCurrentTab && btn) {
              btn.disabled = selectedLoyaltyGuest.loyaltyPoints < rw.points;
              btn.addEventListener('click', () => erpStore.redeemLoyaltyPoints(selectedLoyaltyGuest.id, rw.points, rw.label));
            }
            return row;
          })
        );
      }
    } else if (activeTab === 'campanas') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.campanas);
      tabBody = view;
      setVisible(tabBody, 'new-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', openCampaignModal);
      }
      mountRef(
        tabBody,
        'grid',
        state.campaigns.map((cp) => {
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
          return card;
        })
      );
    } else if (activeTab === 'reclamos') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.reclamos);
      tabBody = view;
      setVisible(tabBody, 'new-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', openComplaintModal);
      }
      mountRef(
        tabBody,
        'list',
        state.complaints.map((cmp) => {
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
          return card;
        })
      );
    } else if (activeTab === 'solicitudes') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.solicitudes);
      tabBody = view;
      setVisible(tabBody, 'header-actions', canEditCurrentTab);
      setVisible(tabBody, 'th-actions', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', openRequestModal);
      }
      mountRef(
        tabBody,
        'tbody',
        state.guestRequests.map((req) => {
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
          return row;
        })
      );
    } else if (activeTab === 'encuestas') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.encuestas);
      tabBody = view;
      setVisible(tabBody, 'header-actions', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', openSurveyModal);
      }

      const avgScore = state.surveys.length > 0
        ? (state.surveys.reduce((s, r) => s + Number(r.overallScore || 0), 0) / state.surveys.length).toFixed(2)
        : null;
      const promoters = state.surveys.filter((s) => Number(s.npsScore ?? s.npsRecommend ?? 0) >= 9).length;
      const detractors = state.surveys.filter((s) => Number(s.npsScore ?? s.npsRecommend ?? 0) <= 6).length;
      const npsVal = state.surveys.length > 0 ? Math.round(((promoters - detractors) / state.surveys.length) * 100) : null;

      mountRef(
        tabBody,
        'kpis',
        StatTile({ label: 'Satisfacción Promedio', value: avgScore === null ? '—' : `${avgScore} / 5.0`, tone: 'teal' }),
        StatTile({ label: 'Net Promoter Score (NPS)', value: npsVal === null ? '—' : `${npsVal >= 0 ? '+' : ''}${npsVal}`, tone: 'success' }),
        StatTile({ label: 'Encuestas Respondidas', value: String(state.surveys.length) })
      );

      mountRef(
        tabBody,
        'list',
        state.surveys.map((srv) => {
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
          return row;
        })
      );
    } else if (activeTab === 'resenas') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.resenas);
      tabBody = view;
      mountRef(
        tabBody,
        'list',
        state.reviews.map((rev) => {
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
          return card;
        })
      );
    } else if (activeTab === 'portal_ia') {
      const portalGuest = state.guests.find((g) => g.id === m5Ui.portalGuestId) || state.guests[0];
      const guestFolio = portalGuest ? state.folios.find((f) => f.guestId === portalGuest.id) : null;
      const guestRes = portalGuest ? state.reservations.find((r) => r.guestId === portalGuest.id) : null;
      const guestRoom = guestFolio?.roomNumber || guestRes?.roomNumber || '101';

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
          const rm = f?.roomNumber || r?.roomNumber || '101';
          return h('option', { value: g.id, selected: portalGuest?.id === g.id }, `Huésped activo: ${g.fullName} (Hab. ${rm})`);
        })
      );
      if (portalGuest) guestSel.value = portalGuest.id;
      guestSel.addEventListener('change', (e) => {
        m5Ui.portalGuestId = e.target.value;
        renderContent();
      });

      setText(tabBody, 'stay-title', `Mi Estadía y Estado de Cuenta (Hab. ${guestRoom})`);
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

    const tabCounts = {
      perfil_360: state.guests.length,
      campanas: state.campaigns.length,
      reclamos: state.complaints.filter((c) => c.status !== 'Resuelto').length,
      solicitudes: state.guestRequests.filter((r) => r.status !== 'Atendida').length,
      encuestas: state.surveys.length,
      resenas: state.reviews.length,
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
          ? 'Módulo 05 · Experiencia, Fidelización y Soporte'
          : 'Módulo 05 · Experiencia, Fidelización y Soporte · Modo consulta (solo lectura)',
        title: 'CRM y Atención al Huésped',
        subtitle: 'Perfil 360°, segmentación, fidelización, campañas, reclamos conectados a Mantenimiento, autoatención e IA conversacional.',
      })
    );
    mount(
      tabsSlot,
      !isTabDenied && barTabs.length > 0
        ? SubmoduleBar({
            tabs: barTabs,
            activeTab,
            onChange: (nextTab) => navigateToView('/crm', nextTab),
          })
        : null
    );
    mount(bodySlot, tabBody);
  }

  renderContent();
  return root;
}
