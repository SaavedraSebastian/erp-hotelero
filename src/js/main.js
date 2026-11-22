import { captureFocusState, h, mount, restoreFocusState } from './utils/dom.js';
import { getRoute, navigate, subscribeRouter } from './core/router.js';
import { erpStore } from './core/store.js';
import { AccessDeniedCard, closeModal } from './components/ui-components.js';
import { renderERPLayout, resetLayoutPopovers } from './components/layout.js';
import { renderLoginPage } from './pages/login.js';
import { renderDashboardPage } from './pages/dashboard.js';
import { renderConfigPage } from './pages/configuracion.js';
import { renderReservasModule } from './modules/reservas-recepcion.js';
import { renderHousekeepingModule } from './modules/housekeeping-mantenimiento.js';
import { renderServiciosPOSModule } from './modules/servicios-pos-almacen.js';
import { renderFinanzasModule } from './modules/facturacion-finanzas.js';
import { renderCRMModule } from './modules/crm-huespedes.js';

const MODULE_TITLES = {
  dashboard: 'Dashboard General',
  m1: 'Reservas y Recepción',
  m2: 'Housekeeping y Mantenimiento',
  m3: 'Servicios, POS, Restaurante y Almacén',
  m4: 'Facturación y Finanzas',
  m5: 'CRM y Atención al Huésped',
  config: 'Configuración, Roles RBAC y Auditoría',
};

const appRoot = document.getElementById('app');
let lastPath = null;

const ROUTE_RESOURCES = {
  '/': ['resumen'],
  '/reservas': ['habitaciones', 'huespedes', 'reservas', 'tarifas', 'listaEspera', 'tarifaDinamica', 'catalogos', 'cuentas'],
  '/housekeeping': ['habitaciones', 'reservas', 'ordenesLimpieza', 'incidencias', 'ordenesTrabajo', 'insumos', 'activos', 'preventivo', 'catalogosM2', 'requisiciones'],
  '/servicios': ['habitaciones', 'reservas', 'cuentas', 'catalogo', 'comandas', 'consumos', 'inventario', 'ordenesCompra', 'proveedores', 'recetas', 'requisiciones'],
  '/finanzas': ['cuentas', 'comprobantes', 'reportes', 'turnos', 'gastos', 'cxc'],
  '/crm': ['huespedes', 'reservas', 'cuentas', 'perfiles', 'campanas', 'reclamos', 'opiniones', 'solicitudes', 'segmentos'],
  '/configuracion': ['bitacoras'],
};

function resourcesForRoute(route = getRoute()) {
  return ROUTE_RESOURCES[route.basePath] ?? ['resumen'];
}

function renderProtectedModule(mod, factoryFn) {
  if (!erpStore.canView(mod)) {
    return AccessDeniedCard({
      title: 'Acceso denegado',
      resourceName: MODULE_TITLES[mod] || mod,
      roleLabel: erpStore.currentUser?.roleLabel || 'Usuario',
      onBack: () => navigate('/', { replace: true }),
    });
  }
  return factoryFn();
}

function renderApp() {
  if (!appRoot) return;
  const focusSnap = captureFocusState();

  if (erpStore.authLoading) {
    mount(
      appRoot,
      h(
        'div',
        { className: 'boot-loader' },
        h('div', { className: 'boot-spinner' }),
        h('p', { className: 'boot-text' }, 'Verificando sesión SGH-ERP...')
      )
    );
    return;
  }

  if (!erpStore.currentUser) {
    closeModal();
    resetLayoutPopovers();
    mount(appRoot, renderLoginPage());
    restoreFocusState(focusSnap);
    return;
  }

  const route = getRoute();
  if (lastPath !== route.pathname) {
    lastPath = route.pathname;
    closeModal();
    resetLayoutPopovers();
  }

  let outlet = null;
  if (route.basePath === '/' || route.basePath === '') {
    outlet = renderDashboardPage();
  } else if (route.basePath === '/reservas') {
    outlet = renderProtectedModule('m1', renderReservasModule);
  } else if (route.basePath === '/housekeeping') {
    outlet = renderProtectedModule('m2', renderHousekeepingModule);
  } else if (route.basePath === '/servicios') {
    outlet = renderProtectedModule('m3', renderServiciosPOSModule);
  } else if (route.basePath === '/finanzas') {
    outlet = renderProtectedModule('m4', renderFinanzasModule);
  } else if (route.basePath === '/crm') {
    outlet = renderProtectedModule('m5', renderCRMModule);
  } else if (route.basePath === '/configuracion') {
    outlet = renderProtectedModule('config', renderConfigPage);
  } else {
    navigate('/', { replace: true });
    return;
  }

  mount(appRoot, renderERPLayout(outlet));
  restoreFocusState(focusSnap);
}

erpStore.subscribe(renderApp);
subscribeRouter((route) => {
  renderApp();
  erpStore.ensureResources(resourcesForRoute(route));
});

erpStore.init(resourcesForRoute()).then(renderApp);
