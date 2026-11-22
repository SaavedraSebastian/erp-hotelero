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
import modalesHtml from '../../html/modules/finanzas/modales.html?raw';
import foliosHtml from '../../html/modules/finanzas/folios.html?raw';
import facturacionHtml from '../../html/modules/finanzas/facturacion.html?raw';
import pagosHtml from '../../html/modules/finanzas/pagos.html?raw';
import cxcHtml from '../../html/modules/finanzas/cxc.html?raw';
import cajaHtml from '../../html/modules/finanzas/caja.html?raw';
import gastosHtml from '../../html/modules/finanzas/gastos.html?raw';
import costosHtml from '../../html/modules/finanzas/costos.html?raw';
import reportesHtml from '../../html/modules/finanzas/reportes.html?raw';
import sunatHtml from '../../html/modules/finanzas/sunat.html?raw';
import iaFinancieraHtml from '../../html/modules/finanzas/ia-financiera.html?raw';
import { formatCurrency } from '../utils/formatters.js';
import { getRoute, navigateToView } from '../core/router.js';
import { erpStore } from '../core/store.js';
import { bindPagedContainer } from '../components/paged-view.js';
import { getPagedList, setActivePagedList } from '../services/paged-list.js';
import { mapExpenseRows, mapInvoiceRows, mapReceivableRows } from '../services/erp-mappers.js';
import { TODAY } from '../data/empty-state.js';
import {
  AccessDeniedCard,
  EmptyState,
  ModuleAIAdvisor,
  ModuleHeader,
  StatTile,
  StatusText,
  openModal,
} from '../components/ui-components.js';
import { renderAreaComparisonChart, renderGroupedBarChart } from '../components/charts.js';

const cloneModal = createTemplateLibrary(modalesHtml);

const VIEW_HTML = {
  folios: foliosHtml,
  facturacion: facturacionHtml,
  pagos: pagosHtml,
  cxc: cxcHtml,
  caja: cajaHtml,
  gastos: gastosHtml,
  costos: costosHtml,
  reportes: reportesHtml,
  sunat: sunatHtml,
  ia_financiera: iaFinancieraHtml,
};

const M4_TABS = [
  { id: 'folios', label: 'Cuenta del Huésped', subtitle: 'Cuentas abiertas de huéspedes: cargos, pagos y saldo.' },
  { id: 'facturacion', label: 'Facturación', subtitle: 'Comprobantes de pago emitidos y su estado.' },
  { id: 'pagos', label: 'Pagos', subtitle: 'Cobros registrados por medio de pago.' },
  { id: 'cxc', label: 'Cuentas por Cobrar', subtitle: 'Cuentas por cobrar, vencimientos y cobranza.' },
  { id: 'caja', label: 'Caja', subtitle: 'Turnos de caja, movimientos y arqueo.' },
  { id: 'gastos', label: 'Gastos', subtitle: 'Gastos operativos por centro de costo.' },
  { id: 'costos', label: 'Costos', subtitle: 'Ingresos y costos por área.' },
  { id: 'reportes', label: 'Reportes', subtitle: 'Ingresos y egresos por período.' },
  { id: 'sunat', label: 'SUNAT', subtitle: 'Comprobantes electrónicos y borrador del XML.' },
  { id: 'ia_financiera', label: 'IA Financiera', subtitle: 'Análisis y alertas financieras.' },
];

const m4Ui = {
  selectedFolioId: '',
  sunatXmlPreviewId: '',
  payMethod: 'Tarjeta Crédito/Débito',
  payRef: '',
  payAmount: '200',
  cashMoveType: 'Egreso',
  cashMoveMethod: 'Efectivo',
  cashMoveConcept: '',
  cashMoveAmount: '50',
  countedClose: '',
  reportPeriod: 'mensual',
};

export function renderFinanzasModule() {
  const root = parseHtmlTemplate(moduleShellHtml);
  const headerSlot = getRef(root, 'header-slot');
  const bodySlot = getRef(root, 'body-slot');

  function getStatusVariant(status) {
    if (['Liquidado', 'Emitida', 'Emitida (Interna)', 'Cobrada', 'Pagado', 'Abierta', 'Cerrado'].includes(status)) return 'success';
    if (['Abierto', 'Vigente', 'Pendiente', 'Cerrada'].includes(status)) return 'warning';
    if (['Vencida', 'Anulada'].includes(status)) return 'danger';
    return 'info';
  }

  function formatChargeOrigin(charge) {
    const cat = charge.category || '';
    if (charge.sourceModule === 'M1' || cat === 'Alojamiento') return 'Recepción · Alojamiento';
    if (charge.sourceModule === 'M3') return `Servicios · ${cat || 'POS'}`;
    if (charge.sourceModule === 'M2') return 'Mantenimiento';
    return `Finanzas · ${cat || 'Manual'}`;
  }

  function openManualChargeModal(folio) {
    openModal({
      title: `Agregar Cargo Manual · ${folio.code}`,
      subtitle: `${folio.guestName} · Hab. ${folio.roomNumber}`,
      renderBody: (close) => {
        const form = cloneModal('modal-cargo-manual');
        const descIn = getRef(form, 'description');
        const catSel = getRef(form, 'category');
        const amtIn = getRef(form, 'amount');
        amtIn.value = '45';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!descIn.value.trim()) return;
          erpStore.addManualFolioCharge(folio.id, descIn.value.trim(), catSel.value, Number(amtIn.value));
          close();
        });
        return form;
      },
    });
  }

  function openIssueInvoiceModal() {
    const state = erpStore.state;
    const defaultFolio = state.folios[0];
    openModal({
      title: 'Emitir Comprobante Interno',
      subtitle: 'Calcula subtotal e IGV (18%) automáticamente según los cargos vinculados.',
      renderBody: (close) => {
        const form = cloneModal('modal-comprobante');
        const typeSel = getRef(form, 'type');
        const folioSel = getRef(form, 'folio');
        const nameIn = getRef(form, 'customer-name');
        const docIn = getRef(form, 'customer-doc');
        const descIn = getRef(form, 'description');
        const amtIn = getRef(form, 'amount');

        mount(
          folioSel,
          state.folios.map((f) => h('option', { value: f.id }, `${f.code} · ${f.guestName} (${formatCurrency(f.totalCharges)})`))
        );
        if (defaultFolio) folioSel.value = defaultFolio.id;
        nameIn.value = defaultFolio?.guestName || '';
        docIn.value = '';
        descIn.value = `Servicios de hospedaje y consumos (${defaultFolio?.code || 'FOL'})`;
        amtIn.value = defaultFolio ? String(defaultFolio.totalCharges) : '';

        folioSel.addEventListener('change', () => {
          const f = state.folios.find((x) => x.id === folioSel.value);
          if (f) {
            nameIn.value = f.guestName;
            amtIn.value = String(f.totalCharges);
            descIn.value = `Servicios de hospedaje y consumos (${f.code})`;
          }
        });

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          erpStore.issueInvoice({
            type: typeSel.value,
            folioId: folioSel.value || undefined,
            customerName: nameIn.value.trim(),
            customerDoc: docIn.value.trim(),
            items: [{ description: descIn.value.trim(), amount: Number(amtIn.value) }],
          });
          close();
        });
        return form;
      },
    });
  }

  function openPreviewInvoiceModal(inv) {
    openModal({
      title: `${inv.type} ${inv.series}-${inv.number}`,
      subtitle: `${inv.issuedAt} · Estado: ${inv.status}`,
      renderBody: (close) => {
        const box = cloneModal('modal-vista-comprobante');
        setText(box, 'buyer', `Adquiriente: ${inv.customerName} (${inv.customerDoc})`);
        setText(box, 'sunat-status', inv.sunatStatus);
        mountRef(
          box,
          'items-tbody',
          inv.items.map((it) => {
            const row = cloneModal('fila-item-comprobante');
            setText(row, 'desc', it.description);
            setText(row, 'amount', formatCurrency(it.amount));
            return row;
          })
        );
        setText(box, 'subtotal', formatCurrency(inv.subtotal));
        setText(box, 'igv', formatCurrency(inv.igv));
        setText(box, 'total', formatCurrency(inv.total));
        mountRef(box, 'print-icon', icon('printer', 'w-3.5'));
        getRef(box, 'print-btn')?.addEventListener('click', () => window.print());
        getRef(box, 'close-btn')?.addEventListener('click', close);
        return box;
      },
    });
  }

  function openExpenseModal() {
    openModal({
      title: 'Registrar Gasto Operativo',
      renderBody: (close) => {
        const form = cloneModal('modal-gasto');
        const catSel = getRef(form, 'category');
        const ccSel = getRef(form, 'cost-center');
        const supIn = getRef(form, 'supplier');
        const docIn = getRef(form, 'doc-ref');
        const amtIn = getRef(form, 'amount');
        const statusSel = getRef(form, 'status');
        const descIn = getRef(form, 'description');

        catSel.value = 'Servicios Básicos';
        ccSel.value = 'Administración';
        docIn.value = 'F002-00412';
        amtIn.value = '350';
        statusSel.value = 'Pagado';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!supIn.value.trim() || !descIn.value.trim()) return;
          erpStore.addOperatingExpense({
            date: TODAY,
            category: catSel.value,
            costCenter: ccSel.value,
            supplier: supIn.value.trim(),
            description: descIn.value.trim(),
            amount: Number(amtIn.value),
            status: statusSel.value,
            documentRef: docIn.value.trim(),
          });
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
    if (!state || !currentUser) return;

    const route = getRoute();
    const visibleTabs = M4_TABS.filter((t) => erpStore.canViewTab('m4', t.id));

    const defaultTab = erpStore.getDefaultTab('m4') || visibleTabs[0]?.id || 'folios';
    const requestedTab = route.tab || defaultTab;
    const activeTab = visibleTabs.some((t) => t.id === requestedTab) ? requestedTab : defaultTab;
    const activeMeta = M4_TABS.find((t) => t.id === activeTab);
    const isTabDenied = Boolean(route.tab && !erpStore.canViewTab('m4', route.tab));
    const canEditCurrentTab = erpStore.canEditTab('m4', activeTab);

    if (!m4Ui.selectedFolioId && state.folios.length > 0) m4Ui.selectedFolioId = state.folios[0].id;
    const selectedFolio = state.folios.find((f) => f.id === m4Ui.selectedFolioId) || state.folios[0];
    const activeCashShift = state.cashShifts.find((c) => c.status === 'Abierta');

    // Totales de los últimos 30 días, calculados en la base de datos.
    const fin = state.financeSummary;
    const totalBilled = fin?.billed ?? 0;
    const totalCollected = fin?.collected ?? 0;
    const totalPending = fin?.receivable ?? 0;
    const totalExpenses = fin?.expenses ?? 0;

    let tabBody = null;

    if (isTabDenied) {
      tabBody = AccessDeniedCard({
        resourceName: `Facturación y Finanzas · ${route.tab}`,
        roleLabel: currentUser.roleLabel,
        onBack: () => navigateToView('/finanzas', defaultTab, true),
      });
    } else if (activeTab === 'folios') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.folios);
      tabBody = view;

      setText(tabBody, 'folios-heading', `Folios de Estadías (${state.folios.length})`);
      mountRef(
        tabBody,
        'folios-list',
        state.folios.map((f) => {
          const btn = clone('item-folio-lista');
          if (selectedFolio?.id === f.id) {
            btn.style.borderColor = 'var(--teal-600)';
          }
          setText(btn, 'code-room', `${f.code} · Hab. ${f.roomNumber}`);
          mountRef(btn, 'status', StatusText({ label: f.status, variant: getStatusVariant(f.status) }));
          setText(btn, 'guest', f.guestName);
          setText(btn, 'total', `Cargos: ${formatCurrency(f.totalCharges)}`);
          const balEl = getRef(btn, 'balance');
          balEl.textContent = `Saldo: ${formatCurrency(f.balance)}`;
          balEl.classList.add(f.balance > 0 ? 'text-warning' : 'text-success');
          btn.addEventListener('click', () => {
            m4Ui.selectedFolioId = f.id;
            renderContent();
          });
          return btn;
        })
      );

      if (selectedFolio) {
        const detail = clone('detalle-folio');
        setText(detail, 'code-room', `${selectedFolio.code} · Habitación ${selectedFolio.roomNumber}`);
        setText(detail, 'guest', selectedFolio.guestName);
        setText(detail, 'opened-at', `Apertura: ${selectedFolio.openedAt}`);

        setVisible(detail, 'charge-btn', canEditCurrentTab);
        if (canEditCurrentTab) {
          mountRef(detail, 'charge-icon', icon('plus', 'w-3.5'));
          getRef(detail, 'charge-btn').addEventListener('click', () => openManualChargeModal(selectedFolio));
        }

        const showCollect = erpStore.canEditTab('m4', 'pagos') && selectedFolio.balance > 0;
        setVisible(detail, 'collect-btn', showCollect);
        if (showCollect) {
          getRef(detail, 'collect-btn').addEventListener('click', () => {
            m4Ui.selectedFolioId = selectedFolio.id;
            m4Ui.payAmount = String(selectedFolio.balance);
            navigateToView('/finanzas', 'pagos');
          });
        }

        mountRef(
          detail,
          'kpis',
          StatTile({ label: 'Total Cargos', value: formatCurrency(selectedFolio.totalCharges) }),
          StatTile({ label: 'Pagos Recibidos', value: formatCurrency(selectedFolio.totalPayments), tone: 'success' }),
          StatTile({ label: 'Saldo Pendiente', value: formatCurrency(selectedFolio.balance), tone: selectedFolio.balance > 0 ? 'warning' : 'teal' })
        );

        mountRef(
          detail,
          'charges-tbody',
          selectedFolio.charges.map((c) => {
            const row = clone('fila-cargo-folio');
            setText(row, 'date', c.date);
            setText(row, 'source', formatChargeOrigin(c));
            setText(row, 'desc', c.description);
            setText(row, 'amount', formatCurrency(c.amount));
            return row;
          })
        );

        mountRef(
          detail,
          'payments-list',
          selectedFolio.payments.length === 0
            ? h('div', { className: 'p-3 text-xs text-slate-500' }, 'Sin pagos aplicados aún.')
            : selectedFolio.payments.map((p) => {
                const row = clone('fila-pago-aplicado');
                setText(row, 'summary', `${p.date} · ${p.method}`);
                setText(row, 'meta', `(${p.reference} · ${p.receivedBy})`);
                setText(row, 'amount', `-${formatCurrency(p.amount)}`);
                return row;
              })
        );

        mountRef(tabBody, 'detail-slot', detail);
      } else {
        mountRef(
          tabBody,
          'detail-slot',
          EmptyState({ iconName: 'receipt', title: 'Selecciona un folio', description: 'Elige una cuenta de huésped para ver el detalle.' })
        );
      }
    } else if (activeTab === 'facturacion') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.facturacion);
      tabBody = view;
      setVisible(tabBody, 'issue-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'issue-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'issue-btn').addEventListener('click', openIssueInvoiceModal);
      }
      const renderInvoiceRows = (rows) => {
        const frag = document.createDocumentFragment();
        for (const inv of rows) {
          frag.appendChild((() => {
          const row = clone('fila-comprobante');
          setText(row, 'doc-title', `${inv.type} ${inv.series}-${inv.number}`);
          setText(row, 'issued-at', inv.issuedAt);
          setText(row, 'customer-name', inv.customerName);
          setText(row, 'customer-doc', inv.customerDoc);
          setText(row, 'subtotal-igv', `${formatCurrency(inv.subtotal)} / ${formatCurrency(inv.igv)}`);
          setText(row, 'total', formatCurrency(inv.total));
          const displayStatus = inv.status === 'Emitida' ? 'Emitida (Interna)' : inv.status;
          mountRef(row, 'status', StatusText({ label: displayStatus, variant: getStatusVariant(displayStatus) }));
          mountRef(row, 'preview-icon', icon('printer', 'w-3.5'));
          getRef(row, 'preview-btn').addEventListener('click', () => openPreviewInvoiceModal(inv));

          const showVoid = canEditCurrentTab && !['Anulado', 'Rechazado'].includes(inv.status);
          setVisible(row, 'void-btn', showVoid);
          if (showVoid) {
            getRef(row, 'void-btn').addEventListener('click', () => {
              const reason = window.prompt(`Motivo de la anulación de ${inv.series}-${inv.number} (se emite una nota de crédito):`);
              if (reason === null) return;
              erpStore.voidInvoice(inv.id, reason);
            });
          }
          return row;
        })());
        }
        return frag;
      };
      bindPagedContainer({
        container: getRef(tabBody, 'tbody'),
        key: 'm4.comprobantes',
        list: getPagedList('m4.comprobantes', { path: '/m4/comprobantes', map: mapInvoiceRows, pageSize: 10 }),
        filters: {
          searchPlaceholder: 'Buscar serie-número, cliente o documento…',
          dates: true,
          statusOptions: [
            { value: '', label: 'Todos los estados' },
            { value: 'ACEPTADO', label: 'Aceptado' },
            { value: 'ENVIADO,FIRMADO', label: 'Enviado / firmado' },
            { value: 'RECHAZADO', label: 'Rechazado' },
            { value: 'ANULADO', label: 'Anulado' },
          ],
        },
        renderBody: renderInvoiceRows,
        empty: { iconName: 'fileText', title: 'Sin comprobantes', description: 'Aún no se han emitido comprobantes.' },
        noMatch: { iconName: 'fileText', title: 'Sin comprobantes coincidentes', description: 'Prueba con otro estado, fechas o búsqueda.' },
      });
    } else if (activeTab === 'pagos') {
      const openPaymentFolios = state.folios.filter((f) => f.balance > 0.01);
      if (!m4Ui.payAmount && selectedFolio) m4Ui.payAmount = String(selectedFolio.balance || '');

      const { root: view, clone } = loadViewTemplate(VIEW_HTML.pagos);
      tabBody = view;
      mountRef(tabBody, 'pay-icon', icon('creditCard', 'w-4 text-teal'));

      const folioSel = getRef(tabBody, 'folio-select');
      mount(
        folioSel,
        state.folios.map((f) =>
          h('option', { value: f.id, selected: selectedFolio?.id === f.id }, `${f.code} — ${f.guestName} (Hab. ${f.roomNumber}) · Saldo: ${formatCurrency(f.balance)}`)
        )
      );
      if (selectedFolio) folioSel.value = selectedFolio.id;
      folioSel.addEventListener('change', (e) => {
        m4Ui.selectedFolioId = e.target.value;
        const found = state.folios.find((x) => x.id === e.target.value);
        if (found) m4Ui.payAmount = String(found.balance);
        renderContent();
      });

      const methodSel = getRef(tabBody, 'method-select');
      methodSel.value = m4Ui.payMethod;
      methodSel.addEventListener('change', (e) => {
        m4Ui.payMethod = e.target.value;
      });

      const amtIn = getRef(tabBody, 'amount-input');
      amtIn.value = m4Ui.payAmount || String(selectedFolio?.balance || 0);
      amtIn.addEventListener('input', (e) => {
        m4Ui.payAmount = e.target.value;
      });

      const refIn = getRef(tabBody, 'ref-input');
      refIn.value = m4Ui.payRef;
      refIn.addEventListener('input', (e) => {
        m4Ui.payRef = e.target.value;
      });

      setVisible(tabBody, 'confirm-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'confirm-icon', icon('check', 'w-4'));
        getRef(tabBody, 'confirm-btn').addEventListener('click', () => {
          const amt = Number(m4Ui.payAmount || selectedFolio?.balance || 0);
          if (!selectedFolio || amt <= 0) return;
          erpStore.registerFolioPayment(selectedFolio.id, amt, m4Ui.payMethod, m4Ui.payRef);
          m4Ui.payRef = '';
          m4Ui.payAmount = '';
        });
      }

      setText(tabBody, 'pending-title', 'Saldos Pendientes por Liquidar');
      mountRef(
        tabBody,
        'pending-list',
        openPaymentFolios.length === 0
          ? clone('pagos-todos-liquidados')
          : openPaymentFolios.map((f) => {
              const row = clone('fila-folio-pendiente');
              setText(row, 'title', `${f.code} · ${f.guestName} (Hab. ${f.roomNumber})`);
              setText(row, 'paid-meta', `Pagado: ${formatCurrency(f.totalPayments)} de ${formatCurrency(f.totalCharges)}`);
              setText(row, 'balance', formatCurrency(f.balance));
              return row;
            })
      );
    } else if (activeTab === 'cxc') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.cxc);
      tabBody = view;
      const renderReceivableRows = (rows) => {
        const frag = document.createDocumentFragment();
        for (const ar of rows) {
          frag.appendChild((() => {
          const row = clone('fila-cxc');
          setText(row, 'client', ar.clientName);
          setText(row, 'doc', ar.documentRef);
          setText(row, 'dates', `${ar.issueDate || TODAY} → ${ar.dueDate}`);
          const origAmt = ar.originalAmount ?? ar.pendingAmount;
          const paidAmt = ar.paidAmount ?? 0;
          setText(row, 'orig-paid', `${formatCurrency(origAmt)} / ${formatCurrency(paidAmt)}`);
          setText(row, 'pending', formatCurrency(ar.pendingAmount));
          mountRef(row, 'status', StatusText({ label: ar.status, variant: getStatusVariant(ar.status) }));
          setText(row, 'note', ar.followUpNote || '');

          const canPay = ar.pendingAmount > 0 && canEditCurrentTab;
          setVisible(row, 'pay-btn', canPay);
          if (canPay) {
            getRef(row, 'pay-btn').addEventListener('click', () =>
              erpStore.registerReceivablePayment(ar.id, ar.pendingAmount, 'Liquidación total registrada')
            );
          }
          return row;
        })());
        }
        return frag;
      };
      bindPagedContainer({
        container: getRef(tabBody, 'tbody'),
        key: 'm4.cxc',
        list: getPagedList('m4.cxc', { path: '/m4/cuentas-por-cobrar', map: mapReceivableRows, pageSize: 10 }),
        filters: {
          searchPlaceholder: 'Buscar cliente o documento…',
          statusOptions: [
            { value: '', label: 'Todas' },
            { value: 'VIGENTE,VENCIDA', label: 'Pendientes' },
            { value: 'VENCIDA', label: 'Vencidas' },
            { value: 'PAGADA', label: 'Pagadas' },
          ],
        },
        renderBody: renderReceivableRows,
        empty: { iconName: 'wallet', title: 'Sin cuentas por cobrar', description: 'No hay cuentas por cobrar registradas.' },
        noMatch: { iconName: 'wallet', title: 'Sin cuentas coincidentes', description: 'Prueba con otro estado o búsqueda.' },
      });
    } else if (activeTab === 'caja') {
      const { root: cajaWrapper, clone } = loadViewTemplate(VIEW_HTML.caja);
      tabBody = cajaWrapper;

      if (!activeCashShift) {
        const closedView = clone('vista-caja-cerrada');
        setVisible(closedView, 'open-shift-btn', canEditCurrentTab);
        if (canEditCurrentTab) {
          getRef(closedView, 'open-shift-btn').addEventListener('click', () => {
            const raw = window.prompt('Saldo inicial de caja (S/):');
            if (raw === null) return;
            erpStore.openCashShift(Number(String(raw).replace(',', '.')));
          });
        }
        mount(tabBody, closedView);
      } else {
        const openView = clone('vista-caja-abierta');
        mountRef(
          openView,
          'kpis',
          StatTile({ label: 'Estado Turno Caja', value: activeCashShift.status, meta: `Cajero: ${activeCashShift.cashier}`, tone: 'teal' }),
          StatTile({ label: 'Fondo Inicial', value: formatCurrency(activeCashShift.openingBalance), meta: activeCashShift.openedAt }),
          StatTile({ label: 'Ingresos / Egresos', value: `${formatCurrency(activeCashShift.totalInflows)} / -${formatCurrency(activeCashShift.totalOutflows)}` }),
          StatTile({ label: 'Saldo Esperado', value: formatCurrency(activeCashShift.expectedBalance), tone: 'success' })
        );

        mountRef(openView, 'wallet-icon', icon('wallet', 'w-4 text-teal'));
        const typeSel = getRef(openView, 'move-type');
        const conceptIn = getRef(openView, 'move-concept');
        const amtIn = getRef(openView, 'move-amount');
        const countedIn = getRef(openView, 'close-counted');

        typeSel.value = m4Ui.cashMoveType;
        conceptIn.value = m4Ui.cashMoveConcept;
        amtIn.value = m4Ui.cashMoveAmount;
        typeSel.disabled = !canEditCurrentTab;
        conceptIn.disabled = !canEditCurrentTab;
        amtIn.disabled = !canEditCurrentTab;

        setVisible(openView, 'actions-wrap', canEditCurrentTab);
        if (canEditCurrentTab) {
          countedIn.placeholder = `Arqueo contado (esperado: ${activeCashShift.expectedBalance})`;
          countedIn.value = m4Ui.countedClose;

          typeSel.addEventListener('change', (e) => { m4Ui.cashMoveType = e.target.value; });
          conceptIn.addEventListener('input', (e) => { m4Ui.cashMoveConcept = e.target.value; });
          amtIn.addEventListener('input', (e) => { m4Ui.cashMoveAmount = e.target.value; });
          countedIn.addEventListener('input', (e) => { m4Ui.countedClose = e.target.value; });

          getRef(openView, 'add-move-btn').addEventListener('click', () => {
            const amt = Number(m4Ui.cashMoveAmount);
            if (!m4Ui.cashMoveConcept.trim() || amt <= 0) return;
            erpStore.addCashMovement(m4Ui.cashMoveType, m4Ui.cashMoveMethod, m4Ui.cashMoveConcept, amt);
            m4Ui.cashMoveConcept = '';
            m4Ui.cashMoveAmount = '50';
          });

          getRef(openView, 'close-shift-btn').addEventListener('click', () => {
            erpStore.closeCashShift(Number(m4Ui.countedClose || activeCashShift.expectedBalance));
          });
        }

        setText(openView, 'movements-title', 'Movimientos del Turno Actual');
        mountRef(
          openView,
          'movements-list',
          activeCashShift.movements.map((mv) => {
            const row = clone('fila-movimiento-caja');
            setText(row, 'title', mv.concept);
            setText(row, 'meta', `${mv.time} · ${mv.method}`);
            const amtEl = getRef(row, 'amount');
            amtEl.textContent = `${mv.type === 'Ingreso' ? '+' : '-'}${formatCurrency(mv.amount)}`;
            amtEl.classList.add(mv.type === 'Ingreso' ? 'text-success' : 'text-danger');
            return row;
          })
        );
        mount(tabBody, openView);
      }
    } else if (activeTab === 'gastos') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.gastos);
      tabBody = view;
      setVisible(tabBody, 'new-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', openExpenseModal);
      }
      const renderExpenseRows = (rows) => {
        const frag = document.createDocumentFragment();
        for (const ex of rows) {
          frag.appendChild((() => {
          const row = clone('fila-gasto');
          setText(row, 'date', ex.date);
          setText(row, 'doc-ref', ex.documentRef || '—');
          setText(row, 'category', ex.category);
          setText(row, 'cost-center', ex.costCenter);
          setText(row, 'supplier', ex.supplier);
          setText(row, 'description', ex.description);
          setText(row, 'amount', formatCurrency(ex.amount));
          mountRef(row, 'status', StatusText({ label: ex.status, variant: getStatusVariant(ex.status) }));
          return row;
        })());
        }
        return frag;
      };
      bindPagedContainer({
        container: getRef(tabBody, 'tbody'),
        key: 'm4.gastos',
        list: getPagedList('m4.gastos', { path: '/m4/gastos', map: mapExpenseRows, pageSize: 10 }),
        filters: {
          searchPlaceholder: 'Buscar concepto, proveedor o centro de costo…',
          dates: true,
          statusOptions: [
            { value: '', label: 'Todos los estados' },
            { value: 'PENDIENTE', label: 'Pendiente' },
            { value: 'APROBADO', label: 'Aprobado' },
            { value: 'RECHAZADO', label: 'Rechazado' },
          ],
        },
        renderBody: renderExpenseRows,
        empty: { iconName: 'receipt', title: 'Sin gastos', description: 'Aún no hay gastos registrados.' },
        noMatch: { iconName: 'receipt', title: 'Sin gastos coincidentes', description: 'Prueba con otro estado, fechas o búsqueda.' },
      });
    } else if (activeTab === 'costos') {
      // Ingresos por área (consumos) y costos por centro de costo (gastos aprobados), de los últimos 30 días.
      const costCenters = (state.financeSummary?.areas ?? []).slice(0, 8).map((a) => ({ area: a.name, ingresos: a.ingresos, costos: a.costos }));
      const maxCostChartVal = Math.max(0, ...costCenters.flatMap((c) => [c.ingresos, c.costos]));

      const { root: view } = loadViewTemplate(VIEW_HTML.costos);
      tabBody = view;
      mountRef(
        tabBody,
        'chart-slot',
        renderGroupedBarChart({
          data: costCenters,
          labelKey: 'area',
          series: [
            { key: 'ingresos', name: 'Ingreso Asociado (S/)', color: '#0D9488' },
            { key: 'costos', name: 'Costo / Gasto (S/)', color: '#0F172A' },
          ],
          legendSeries: [
            { key: 'costos', name: 'Costo / Gasto (S/)', color: '#0F172A' },
            { key: 'ingresos', name: 'Ingreso Asociado (S/)', color: '#0D9488' },
          ],
          formatValue: (v) => formatCurrency(v),
          height: 260,
          yMax: null,
        })
      );
    } else if (activeTab === 'reportes') {
      const monthlySeries = state.financeSummary?.weekly ?? [];
      const quarterlySeries = state.financeSummary?.monthly ?? [];

      const { root: view } = loadViewTemplate(VIEW_HTML.reportes);
      tabBody = view;

      mountRef(
        tabBody,
        'kpis',
        StatTile({ label: 'Facturado (30 días)', value: formatCurrency(totalBilled), tone: 'teal' }),
        StatTile({ label: 'Cobrado (30 días)', value: formatCurrency(totalCollected), tone: 'success' }),
        StatTile({ label: 'Cuentas por Cobrar', value: formatCurrency(totalPending), tone: 'warning' }),
        StatTile({ label: 'Gastos aprobados (30 días)', value: formatCurrency(totalExpenses) })
      );

      const toggleGroup = getRef(tabBody, 'period-toggle');
      if (toggleGroup) {
        toggleGroup.querySelectorAll('[data-period]').forEach((btn) => {
          if (btn.dataset.period === m4Ui.reportPeriod) btn.classList.add('is-active');
          btn.addEventListener('click', () => {
            m4Ui.reportPeriod = btn.dataset.period;
            renderContent();
          });
        });
      }

      const isMensual = m4Ui.reportPeriod === 'mensual';
      mountRef(
        tabBody,
        'chart-slot',
        renderAreaComparisonChart({
          data: isMensual ? monthlySeries : quarterlySeries,
          labelKey: 'month',
          series: [
            { key: 'egresos', name: 'Egresos (S/)', color: '#0F172A' },
            { key: 'ingresos', name: 'Ingresos (S/)', color: '#0D9488' },
          ],
          formatValue: (v) => formatCurrency(v),
          height: 250,
          yMax: null,
        })
      );
    } else if (activeTab === 'sunat') {
      if (!m4Ui.sunatXmlPreviewId && state.invoices.length > 0) {
        m4Ui.sunatXmlPreviewId = state.invoices[0].id;
      }
      const estCfg = erpStore.establishmentConfig;
      const supplierRuc = estCfg?.ruc || 'RUC NO CONFIGURADO';
      const supplierName = estCfg?.razonSocial || estCfg?.nombreHotel || 'EMISOR NO CONFIGURADO';
      const sunatTarget = state.invoices.find((i) => i.id === m4Ui.sunatXmlPreviewId) || state.invoices[0];
      const xmlPreview = sunatTarget
        ? `<?xml version="1.0" encoding="UTF-8"?>\n<!-- BORRADOR TÉCNICO UBL 2.1 — NO EMITIDO OFICIALMENTE ANTE SUNAT / OSE -->\n<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">\n  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>\n  <cbc:ID>${sunatTarget.series}-${sunatTarget.number}</cbc:ID>\n  <cbc:IssueDate>${sunatTarget.issuedAt.slice(0, 10)}</cbc:IssueDate>\n  <cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>\n  <cac:AccountingSupplierParty>\n    <cbc:CustomerAssignedAccountID>${supplierRuc}</cbc:CustomerAssignedAccountID>\n    <cac:PartyLegalEntity><cbc:RegistrationName>${supplierName}</cbc:RegistrationName></cac:PartyLegalEntity>\n  </cac:AccountingSupplierParty>\n  <cac:AccountingCustomerParty>\n    <cbc:CustomerAssignedAccountID>${sunatTarget.customerDoc}</cbc:CustomerAssignedAccountID>\n    <cac:PartyLegalEntity><cbc:RegistrationName>${sunatTarget.customerName}</cbc:RegistrationName></cac:PartyLegalEntity>\n  </cac:AccountingCustomerParty>\n  <cac:LegalMonetaryTotal>\n    <cbc:TaxExclusiveAmount currencyID="PEN">${sunatTarget.subtotal.toFixed(2)}</cbc:TaxExclusiveAmount>\n    <cbc:PayableAmount currencyID="PEN">${sunatTarget.total.toFixed(2)}</cbc:PayableAmount>\n  </cac:LegalMonetaryTotal>\n</Invoice>`
        : 'Sin comprobantes emitidos.';

      const { root: view, clone } = loadViewTemplate(VIEW_HTML.sunat);
      tabBody = view;
      mountRef(tabBody, 'queue-icon', icon('fileText', 'w-4 text-teal'));
      mountRef(tabBody, 'xml-icon', icon('fileCode', 'w-4 text-navy'));

      mountRef(
        tabBody,
        'queue-list',
        state.invoices.map((inv) => {
          const item = clone('item-cola-sunat');
          if (sunatTarget?.id === inv.id) item.classList.add('bg-teal-soft');
          setText(item, 'title', `${inv.type} ${inv.series}-${inv.number}`);
          setText(item, 'subtitle', `${inv.customerName} · ${formatCurrency(inv.total)}`);
          mountRef(item, 'status', StatusText({ label: 'Pendiente OSE/SUNAT (No oficial)', variant: 'info' }));
          item.addEventListener('click', () => {
            m4Ui.sunatXmlPreviewId = inv.id;
            renderContent();
          });
          return item;
        })
      );
      setText(tabBody, 'xml-pre', xmlPreview);
    } else if (activeTab === 'ia_financiera') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.ia_financiera);
      tabBody = view;
      mountRef(tabBody, 'alert-icon', icon('alertTriangle', 'w-4 text-warning'));

      const overdueAr = state.receivables.filter((r) => r.status === 'Vencida');
      const overdueSum = overdueAr.reduce((s, r) => s + r.pendingAmount, 0);
      const highFolios = state.folios.filter((f) => f.status === 'Abierto' && f.balance > 600);

      const alerts = [];
      if (overdueAr.length > 0) {
        alerts.push({
          variant: 'danger',
          iconName: 'xCircle',
          headline: `${overdueAr.length} cuenta(s) por cobrar vencida(s)`,
          detail: `Monto en mora: ${formatCurrency(overdueSum)}. Requiere gestión prioritaria de cobranza.`,
        });
      }
      if (highFolios.length > 0) {
        alerts.push({
          variant: 'warning',
          iconName: 'clock',
          headline: `${highFolios.length} folio(s) abierto(s) superan S/ 600 de saldo`,
          detail: `Solicitar pre-autorización o abono parcial antes del check-out (${highFolios.map((f) => f.code).join(', ')}).`,
        });
      }
      if (alerts.length === 0) {
        alerts.push({
          variant: 'success',
          iconName: 'checkCircle',
          headline: 'Sin anomalías críticas de cartera ni folios abiertos',
          detail: 'Los saldos por cobrar y la liquidez del turno actual se encuentran dentro de los parámetros esperados.',
        });
      }

      mountRef(
        tabBody,
        'alerts-list',
        alerts.map((al) => {
          const item = clone('item-alerta-financiera');
          const colorCls = al.variant === 'danger' ? 'text-danger' : al.variant === 'warning' ? 'text-warning' : 'text-success';
          getRef(item, 'headline-wrap').classList.add(colorCls);
          mountRef(item, 'icon', icon(al.iconName, 'w-3.5'));
          setText(item, 'headline', al.headline);
          setText(item, 'detail', al.detail);
          return item;
        })
      );

      mountRef(
        tabBody,
        'advisor-slot',
        ModuleAIAdvisor({
          moduleId: 'm4-finanzas',
          moduleName: 'Facturación y Finanzas',
          title: 'Asesor IA de Proyecciones Financieras y Detección de Anomalías',
          description: 'Analiza liquidez, flujo de caja, margen por centro de costo y riesgos en cuentas por cobrar.',
          suggestedPrompts: [
            'Genera una proyección de flujo de caja a 30 días considerando cuentas por cobrar y gastos recurrentes.',
            'Identifica oportunidades para mejorar el margen operativo entre Alojamiento y Alimentos y Bebidas.',
            'Sugiere acciones de control interno para las alertas financieras actuales.',
          ],
          contextData: {
            totalCargosFolios: totalBilled,
            totalCobrado: totalCollected,
            saldoPendienteTotal: totalPending,
            totalGastos: totalExpenses,
            cxc: state.receivables,
            cajaActiva: activeCashShift,
          },
        })
      );
    }

    mount(
      headerSlot,
      ModuleHeader({
        moduleNumber: canEditCurrentTab ? 'Facturación y Finanzas' : 'Facturación y Finanzas · Solo lectura',
        title: activeMeta?.label ?? 'Facturación y Finanzas',
        subtitle: activeMeta?.subtitle ?? '',
      })
    );
    mount(bodySlot, tabBody);
  }

  renderContent();
  return root;
}
