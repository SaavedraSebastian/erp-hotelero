import {
  createTemplateLibrary,
  getRef,
  h,
  icon,
  mount,
  mountRef,
  parseHtmlTemplate,
  setText,
} from '../utils/dom.js';
import { formatCurrency } from '../utils/formatters.js';
import { navigate } from '../core/router.js';
import { erpStore } from '../core/store.js';
import { TODAY } from '../data/empty-state.js';
import { addDays } from '../utils/dates.js';
import { fetchFinanceSummary } from '../services/data-adapter.js';
import { ModuleAIAdvisor, ModuleHeader, StatTile, StatusText } from '../components/ui-components.js';
import { renderDonutChart, renderGroupedBarChart } from '../components/charts.js';
import dashboardHtml from '../../html/pages/dashboard.html?raw';

const cloneDashTpl = createTemplateLibrary(dashboardHtml);

const dashUi = {
  dateRange: 'hoy',
};

// Resúmenes financieros por rango (calculados en el servidor) y consultas en curso.
const summaries = new Map();
const pendingSummaries = new Set();

export function renderDashboardPage() {
  const root = parseHtmlTemplate(dashboardHtml);
  const headerSlot = getRef(root, 'header-slot');
  const kpisSlot = getRef(root, 'kpis-slot');
  const specializedSlot = getRef(root, 'specialized-slot');
  const shortcutsSlot = getRef(root, 'shortcuts-slot');
  const chartsSlot = getRef(root, 'charts-slot');
  const insightsSlot = getRef(root, 'insights-slot');
  const advisorSlot = getRef(root, 'advisor-slot');

  function renderContent() {
    const state = erpStore.state;
    const currentUser = erpStore.currentUser;
    const currentPermissions = erpStore.currentPermissions;
    if (!state || !currentUser) return;

    const rangeDays = dashUi.dateRange === 'hoy' ? 1 : dashUi.dateRange === '7d' ? 7 : 30;
    const rangeFrom = addDays(TODAY, -(rangeDays - 1));

    const totalRooms = state.rooms.length;
    const occupiedRooms = state.rooms.filter((r) => r.commercialStatus === 'Ocupada').length;
    const freeReadyRooms = state.rooms.filter(
      (r) => r.commercialStatus === 'Disponible' && ['Inspeccionada', 'Limpia'].includes(r.housekeepingStatus)
    ).length;
    const reservedTodayRooms = state.rooms.filter((r) => r.commercialStatus === 'Reservada').length;
    const cleaningOrBlockedRooms = state.rooms.filter((r) =>
      ['Sucia', 'En limpieza', 'Fuera de servicio'].includes(r.housekeepingStatus)
    ).length;
    const occupancyPct = Math.round((occupiedRooms / Math.max(1, totalRooms)) * 100);

    const arrToday = state.reservations.filter((r) => r.checkInDate === TODAY && r.status === 'Confirmada').length;
    const depToday = state.reservations.filter((r) => r.checkOutDate === TODAY && r.status === 'Check-in').length;
    const dirtyOrCleaning = state.rooms.filter(
      (r) => r.housekeepingStatus === 'Sucia' || r.housekeepingStatus === 'En limpieza'
    ).length;

    const onlyMine = Boolean(currentPermissions?.onlyAssignedTasks);
    const visibleCleaningOrders = onlyMine
      ? state.cleaningOrders.filter((c) => c.assignedStaffId === currentUser.assignedStaffId)
      : state.cleaningOrders;
    const openIncidents = state.incidents.filter((i) => i.status !== 'Resuelta').length;
    const openWOs = state.workOrders.filter((w) => w.status !== 'Completada').length;

    const criticalStock = state.inventory.filter((i) => i.stock <= i.minStock * 0.85).length;
    const pendingReqs = state.supplyRequisitions.filter((r) => r.status === 'Solicitada').length;

    // Cifras financieras del rango elegido, calculadas por el servidor.
    const sumKey = `${rangeFrom}|${TODAY}`;
    const cached = summaries.get(sumKey);
    const summary = cached?.data ?? null;
    const stale = !cached || Date.now() - cached.at > 60_000; // se refresca cada minuto
    if (stale && !pendingSummaries.has(sumKey) && erpStore.canView('m4')) {
      pendingSummaries.add(sumKey);
      fetchFinanceSummary(rangeFrom, TODAY)
        .then((r) => summaries.set(sumKey, { at: Date.now(), data: r ?? { areas: [] } }))
        .catch(() => summaries.set(sumKey, { at: Date.now(), data: { areas: [] } }))
        .finally(() => {
          pendingSummaries.delete(sumKey);
          renderContent();
        });
    }
    const dash = (n) => (summary && summary.billed !== undefined ? formatCurrency(n) : '—');
    const totalRevenue = summary?.billed ?? 0;
    const openReceivables = (summary?.receivable ?? 0) + state.folios.reduce((sum, f) => sum + f.balance, 0);
    const totalExpenses = summary?.expenses ?? 0;
    const posTotal = summary?.servicesSales ?? 0;
    const pendingPayablesCount =
      state.expenses.filter((e) => e.status === 'Pendiente').length +
      state.purchaseOrders.filter((p) => !['Recibida', 'Rechazada', 'Cancelada'].includes(p.status)).length;

    const openComplaints = state.complaints.filter((c) => c.status !== 'Resuelto').length;
    const avgSatisfaction =
      state.surveys.length > 0
        ? (state.surveys.reduce((s, r) => s + r.overallScore, 0) / state.surveys.length).toFixed(2)
        : '—';

    // Ingresos = consumos por área; costos = gastos aprobados por centro de costo, dentro del rango elegido.
    const revenueExpenseData = (summary?.areas ?? []).slice(0, 6).map((a) => ({ name: a.name, ingresos: a.ingresos, costos: a.costos }));

    const roomDistribution = [
      { name: 'Ocupadas', value: occupiedRooms, color: '#0F172A' },
      { name: 'Disponibles Listas', value: freeReadyRooms, color: '#0D9488' },
      { name: 'Reservadas Hoy', value: reservedTodayRooms, color: '#0369A1' },
      { name: 'Limpieza / Bloqueada', value: cleaningOrBlockedRooms, color: '#F59E0B' },
    ];

    const canM1 = erpStore.canView('m1');
    const canM2 = erpStore.canView('m2');
    const canM3 = erpStore.canView('m3');
    const canM4 = erpStore.canView('m4');
    const canM5 = erpStore.canView('m5');

    const role = currentUser.role;
    const isAdminOrExec = ['admin', 'gerente_finanzas', 'jefe_finanzas', 'auditor'].includes(role);
    const isFinancialRole = ['admin', 'cajero', 'costos', 'jefe_finanzas', 'gerente_finanzas', 'auditor'].includes(role);
    const isOpsFrontRole = ['admin', 'recepcionista', 'supervisor_hk', 'atencion', 'comercial', 'auditor'].includes(role);

    const kpis = [];
    if (canM1) {
      kpis.push(
        StatTile({
          label: 'Reservas y movimientos hoy',
          value: String(state.reservations.length),
          meta: `Check-ins hoy: ${arrToday} · Check-outs: ${depToday}`,
          onClick: () => navigate('/reservas/reservas'),
        }),
        StatTile({
          label: 'Habitaciones ocupadas / libres',
          value: `${occupiedRooms} / ${freeReadyRooms}`,
          meta: `Ocupación ${occupancyPct}% de ${totalRooms} habitaciones`,
          tone: 'teal',
          onClick: () => navigate('/reservas/ocupacion'),
        })
      );
    }
    if (canM2) {
      kpis.push(
        StatTile({
          label: 'Pendientes de limpieza',
          value: String(dirtyOrCleaning),
          meta: `Órdenes visibles: ${visibleCleaningOrders.length}`,
          onClick: () => navigate('/housekeeping/limpieza'),
        }),
        StatTile({
          label: 'Incidencias de mantenimiento',
          value: String(openIncidents),
          meta: `OT activas: ${openWOs}`,
          tone: openIncidents > 0 ? 'danger' : 'success',
          onClick: () => navigate('/housekeeping/incidencias'),
        })
      );
    }
    if (canM3) {
      kpis.push(
        StatTile({
          label: 'Ventas Restaurante y Servicios',
          value: dash(posTotal),
          meta: summary ? `${summary.servicesCount} consumos en el período` : 'Calculando…',
          tone: 'teal',
          onClick: () => navigate('/servicios/pos'),
        }),
        StatTile({
          label: 'Alertas de inventario',
          value: String(criticalStock),
          meta: `Solicitudes internas: ${pendingReqs}`,
          tone: criticalStock > 0 ? 'warning' : 'success',
          onClick: () => navigate('/servicios/inventario'),
        })
      );
    }
    if (canM4) {
      kpis.push(
        StatTile({
          label: 'Ingresos consolidados',
          value: dash(totalRevenue),
          meta: `Por cobrar: ${dash(openReceivables)}`,
          tone: 'teal',
          onClick: () => navigate('/finanzas/folios'),
        }),
        StatTile({
          label: 'Gastos operativos',
          value: dash(totalExpenses),
          meta: `${pendingPayablesCount} pendiente(s) de pago o aprobación`,
          onClick: () => navigate('/finanzas/gastos'),
        })
      );
    }
    if (canM5) {
      kpis.push(
        StatTile({
          label: 'Satisfacción y Reclamos',
          value: `${avgSatisfaction} / 5.0`,
          meta: `${openComplaints} reclamo(s) abierto(s)`,
          tone: openComplaints > 0 ? 'warning' : 'success',
          onClick: () => navigate('/crm/reclamos'),
        })
      );
    }

    const myCleaningOrders = visibleCleaningOrders.filter((c) => c.status !== 'Inspeccionada');
    const myWorkOrders = state.workOrders.filter(
      (w) => (!onlyMine || w.assignedStaffId === currentUser.assignedStaffId) && w.status !== 'Completada'
    );
    const activeShift = state.cashShifts.find((c) => c.status === 'Abierta');

    const specializedCards = [];
    if (role === 'limpieza') {
      const card = cloneDashTpl('card-limpieza');
      getRef(card, 'go-btn')?.addEventListener('click', () => navigate('/housekeeping/limpieza'));
      mountRef(
        card,
        'list',
        myCleaningOrders.length === 0
          ? h('p', { className: 'text-xs text-slate-500' }, 'No tienes órdenes pendientes en este turno.')
          : myCleaningOrders.map((ord) => {
              const row = cloneDashTpl('limpieza-item');
              setText(row, 'room', `Hab. ${ord.roomNumber}`);
              setText(row, 'meta', `${ord.type} · ${ord.priority}`);
              mountRef(row, 'status', StatusText({ label: ord.status, variant: ord.status === 'Completada' ? 'success' : 'warning' }));
              return row;
            })
      );
      specializedCards.push(card);
    }

    if (role === 'tecnico') {
      const card = cloneDashTpl('card-tecnico');
      getRef(card, 'go-btn')?.addEventListener('click', () => navigate('/housekeeping/mant-correctivo'));
      mountRef(
        card,
        'list',
        myWorkOrders.length === 0
          ? h('p', { className: 'text-xs text-slate-500' }, 'Sin órdenes de trabajo abiertas asignadas.')
          : myWorkOrders.map((wo) => {
              const row = cloneDashTpl('tecnico-item');
              setText(row, 'code', `${wo.code} · ${wo.location}`);
              mountRef(row, 'priority', StatusText({ label: wo.priority, variant: wo.priority === 'Urgente' ? 'danger' : 'warning' }));
              setText(row, 'description', wo.description);
              return row;
            })
      );
      specializedCards.push(card);
    }

    if (role === 'cajero') {
      const card = cloneDashTpl('card-cajero');
      setText(card, 'title', activeShift ? 'Turno de caja activo' : 'Caja cerrada actualmente');
      setText(
        card,
        'subtitle',
        activeShift
          ? `Saldo esperado en caja: ${formatCurrency(activeShift.expectedBalance)} · ${state.folios.filter((f) => f.balance > 0).length} folios con saldo pendiente.`
          : 'Abre tu turno de caja en Finanzas para comenzar a recibir cobros.'
      );
      getRef(card, 'pay-btn')?.addEventListener('click', () => navigate('/finanzas/pagos'));
      getRef(card, 'cash-btn')?.addEventListener('click', () => navigate('/finanzas/caja'));
      specializedCards.push(card);
    }

    if (role === 'auditor') {
      const card = cloneDashTpl('card-auditor');
      setText(card, 'subtitle', `${state.auditLog.length} eventos trazados · Auditoría operativa y segregación RBAC.`);
      getRef(card, 'go-btn')?.addEventListener('click', () => navigate('/configuracion/auditoria'));
      specializedCards.push(card);
    }

    const shortcutDefs = [
      {
        mod: 'm1',
        path: '/reservas',
        iconName: 'calendar',
        kicker: 'Front Desk',
        title: 'Reservas y Recepción',
        desc: `${state.reservations.length} reservas · ${occupancyPct}% ocup.`,
      },
      {
        mod: 'm2',
        path: '/housekeeping',
        iconName: 'sparkles',
        kicker: 'Operaciones',
        title: 'Housekeeping y Mant.',
        desc: `${dirtyOrCleaning} limpieza · ${openIncidents} incid.`,
      },
      {
        mod: 'm3',
        path: '/servicios',
        iconName: 'utensils',
        kicker: 'Consumos',
        title: 'Servicios, POS y Almacén',
        desc: `${dash(posTotal)} · ${criticalStock} alertas`,
      },
      {
        mod: 'm4',
        path: '/finanzas',
        iconName: 'receipt',
        kicker: 'Tesorería',
        title: 'Facturación y Finanzas',
        desc: `${dash(totalRevenue)} · CxC ${dash(openReceivables)}`,
      },
      {
        mod: 'm5',
        path: '/crm',
        iconName: 'heart',
        kicker: 'Experiencia',
        title: 'CRM y Atención',
        desc: `Satisf. ${avgSatisfaction}/5 · ${openComplaints} recl.`,
      },
    ].filter((s) => erpStore.canView(s.mod));

    let chartsSection = null;
    if ((canM4 && isFinancialRole) || (canM1 && isOpsFrontRole)) {
      chartsSection = cloneDashTpl('charts-section');
      const showFin = canM4 && isFinancialRole;
      const showRooms = canM1 && isOpsFrontRole;
      if (showFin) {
        const finCard = getRef(chartsSection, 'finance-card');
        finCard.classList.remove('hidden');
        finCard.classList.add(showRooms ? 'col-span-2-lg' : 'col-span-3-lg');
        mountRef(
          chartsSection,
          'finance-chart',
          revenueExpenseData.length === 0
            ? h('p', { className: 'text-xs text-slate-500 p-4' }, summary ? 'Sin ingresos ni gastos registrados en el período seleccionado.' : 'Calculando…')
            : renderGroupedBarChart({
            data: revenueExpenseData,
            labelKey: 'name',
            series: [
              { key: 'ingresos', name: 'Ingresos (S/)', color: '#0F172A' },
              { key: 'costos', name: 'Costos (S/)', color: '#0D9488' },
            ],
            legendSeries: [
              { key: 'costos', name: 'Costos (S/)', color: '#0D9488' },
              { key: 'ingresos', name: 'Ingresos (S/)', color: '#0F172A' },
            ],
            formatValue: (v) => formatCurrency(v),
            height: 250,
          })
        );
      }
      if (showRooms) {
        const rmCard = getRef(chartsSection, 'rooms-card');
        rmCard.classList.remove('hidden');
        if (!showFin) rmCard.classList.add('col-span-3-lg');
        setText(chartsSection, 'rooms-subtitle', 'Sincronizado entre Recepción y Housekeeping');
        mountRef(
          chartsSection,
          'rooms-chart',
          renderDonutChart({ data: roomDistribution, unit: 'habs.', size: 176, showCenterLabel: false })
        );
        mountRef(
          chartsSection,
          'rooms-legend',
          roomDistribution.map((d) => {
            const item = cloneDashTpl('legend-item');
            const swatch = getRef(item, 'swatch');
            if (swatch) swatch.style.backgroundColor = d.color;
            setText(item, 'label', d.name);
            setText(item, 'value', `${d.value} hab.`);
            return item;
          })
        );
      }
    }

    const aiAlerts = [];
    if (canM3 && criticalStock > 0) {
      aiAlerts.push({
        mod: 'Almacén',
        headline: `Reponer ${criticalStock} insumos en nivel mínimo`,
        detail: 'El consumo POS proyectado y solicitudes de Housekeeping superan el margen de seguridad.',
        to: '/servicios/inventario',
      });
    }
    if (canM2 && dirtyOrCleaning > 0) {
      aiAlerts.push({
        mod: 'Housekeeping',
        headline: `Priorizar ${dirtyOrCleaning} tarea(s) de limpieza pendiente(s)`,
        detail: 'Optimizar el orden de habitaciones asegura disponibilidad oportuna para próximas llegadas.',
        to: '/housekeeping/limpieza',
      });
    }
    if (canM5 && openComplaints > 0) {
      aiAlerts.push({
        mod: 'CRM y Atención',
        headline: `Seguimiento a ${openComplaints} reclamo(s) abierto(s)`,
        detail: 'Atender incidencias vinculadas en menos de 2 horas protege el puntaje NPS de clientes VIP.',
        to: '/crm/reclamos',
      });
    }
    if (canM1) {
      aiAlerts.push({
        mod: 'Tarifas IA',
        headline: 'Ajuste dinámico sugerido +8% en Deluxe Vista Mar',
        detail: 'Demanda de fin de semana con lista de espera activa y solo 1 unidad libre de esa categoría.',
        to: '/reservas/ia-tarifas',
      });
    }
    if (canM2 && openIncidents > 0) {
      aiAlerts.push({
        mod: 'Mantenimiento',
        headline: `${openIncidents} incidencia(s) activa(s) requieren cierre`,
        detail: 'Resolver las órdenes correctivas habilita habitaciones bloqueadas y cierra reclamos CRM vinculados.',
        to: '/housekeeping/mant-correctivo',
      });
    }

    const insightsGrid = cloneDashTpl('insights-section');
    mountRef(
      insightsGrid,
      'alerts-list',
      aiAlerts.map((a) => {
        const row = cloneDashTpl('ai-alert-row');
        setText(row, 'mod', a.mod);
        setText(row, 'headline', a.headline);
        setText(row, 'detail', a.detail);
        const btn = getRef(row, 'action-btn');
        if (btn) {
          btn.addEventListener('click', () => navigate(a.to));
        }
        return row;
      })
    );

    mountRef(
      insightsGrid,
      'activity-list',
      state.notifications.slice(0, 6).map((n) => {
        const row = cloneDashTpl('activity-row');
        const sev = n.severity || 'info';
        const iconName = sev === 'error' ? 'xCircle' : sev === 'warning' ? 'alertCircle' : 'checkCircle';
        const toneClass =
          sev === 'error' ? 'text-danger' : sev === 'warning' ? 'text-warning' : 'text-teal';
        mountRef(row, 'status-icon', icon(iconName, `w-3.5 ${toneClass}`));
        const titleEl = setText(row, 'title', n.title);
        if (titleEl) titleEl.classList.add(toneClass);
        setText(row, 'message', n.message);
        setText(row, 'time', n.timestamp);
        return row;
      })
    );

    const advisor = isAdminOrExec
      ? ModuleAIAdvisor({
          moduleId: 'dashboard-exec',
          moduleName: 'Dashboard Ejecutivo Hotel Boulevard',
          title: 'Asesor Operativo con Inteligencia Artificial',
          description: 'Analiza únicamente los indicadores autorizados para tu perfil y emite recomendaciones explicables.',
          suggestedPrompts: [
            'Genera un resumen ejecutivo del día con los riesgos prioritarios dentro de mi alcance.',
            '¿Qué acciones inmediatas recomiendas coordinar con otras áreas del hotel hoy?',
          ],
          contextData: {
            ocupacionPct: occupancyPct,
            habitacionesOcupadas: occupiedRooms,
            habitacionesLibresListas: freeReadyRooms,
            totalHabitaciones: totalRooms,
            llegadasHoy: arrToday,
            salidasHoy: depToday,
            ingresosFolios: totalRevenue,
            saldoPorCobrar: openReceivables,
            gastosOperativos: totalExpenses,
            stockCritico: criticalStock,
            incidenciasAbiertas: openIncidents,
            reclamosAbiertos: openComplaints,
          },
        })
      : null;

    const actions = cloneDashTpl('header-actions');
    actions.querySelectorAll('[data-range]').forEach((btn) => {
      if (btn.dataset.range === dashUi.dateRange) btn.classList.add('is-active');
      btn.addEventListener('click', () => {
        dashUi.dateRange = btn.dataset.range;
        renderContent();
      });
    });

    mount(
      headerSlot,
      ModuleHeader({
        moduleNumber: currentUser.roleLabel,
        title: `Panel de ${currentUser.roleLabel}`,
        subtitle: 'Resumen ejecutivo, funciones administrativas autorizadas y gestión de usuarios/permisos.',
        actions,
      })
    );
    mount(kpisSlot, kpis);
    mount(specializedSlot, specializedCards);
    if (shortcutDefs.length > 0) {
      shortcutsSlot.classList.remove('hidden');
      mount(
        shortcutsSlot,
        shortcutDefs.map((s) => {
          const card = cloneDashTpl('shortcut-card');
          setText(card, 'kicker', s.kicker);
          mountRef(card, 'icon', icon(s.iconName, 'w-4 text-slate-400'));
          setText(card, 'title', s.title);
          setText(card, 'desc', s.desc);
          card.addEventListener('click', () => navigate(s.path));
          return card;
        })
      );
    } else {
      shortcutsSlot.classList.add('hidden');
      shortcutsSlot.replaceChildren();
    }
    mount(chartsSlot, chartsSection);
    mount(insightsSlot, insightsGrid);
    mount(advisorSlot, advisor);
  }

  renderContent();
  return root;
}
