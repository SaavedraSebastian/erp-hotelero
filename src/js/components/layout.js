import {
  createTemplateLibrary,
  getRef,
  h,
  icon,
  mount,
  mountRef,
  parseHtmlTemplate,
  setText,
  setVisible,
} from '../utils/dom.js';
import { getRoute, navigate, navigateToView } from '../core/router.js';
import { erpStore } from '../core/store.js';
import layoutHtml from '../../html/components/layout.html?raw';

const cloneLayoutTpl = createTemplateLibrary(layoutHtml);

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard General', path: '/', iconName: 'dashboard', subItems: [] },
  {
    id: 'm1',
    label: 'Reservas y Recepción',
    path: '/reservas',
    iconName: 'calendar',
    subItems: [
      { label: 'Habitaciones', tab: 'habitaciones' },
      { label: 'Disponibilidad', tab: 'disponibilidad' },
      { label: 'Reservas', tab: 'reservas' },
      { label: 'Tarifas', tab: 'tarifas' },
      { label: 'Check-in', tab: 'checkin' },
      { label: 'Check-out', tab: 'checkout' },
      { label: 'Sobreventa / Espera', tab: 'lista_espera' },
      { label: 'Ocupación', tab: 'ocupacion' },
      { label: 'Huéspedes', tab: 'huespedes' },
      { label: 'Tarifa dinámica y No-Show', tab: 'ia_tarifas' },
    ],
  },
  {
    id: 'm2',
    label: 'Housekeeping y Mant.',
    path: '/housekeeping',
    iconName: 'sparkles',
    subItems: [
      { label: 'Estado Habitaciones', tab: 'estado_habitaciones' },
      { label: 'Órdenes Limpieza', tab: 'limpieza' },
      { label: 'Inspecciones', tab: 'inspeccion' },
      { label: 'Personal Operativo', tab: 'personal' },
      { label: 'Incidencias', tab: 'incidencias' },
      { label: 'Mant. Preventivo', tab: 'mant_preventivo' },
      { label: 'Mant. Correctivo', tab: 'mant_correctivo' },
      { label: 'Activos y Equipos', tab: 'activos' },
      { label: 'Insumos Limpieza', tab: 'insumos' },
      { label: 'IA Operativa', tab: 'ia_operativa' },
    ],
  },
  {
    id: 'm3',
    label: 'Servicios, POS y Almacén',
    path: '/servicios',
    iconName: 'utensils',
    subItems: [
      { label: 'Catálogo Productos', tab: 'productos' },
      { label: 'Catálogo Servicios', tab: 'servicios' },
      { label: 'Punto de Venta (POS)', tab: 'pos' },
      { label: 'Restaurante', tab: 'restaurante' },
      { label: 'Room Service', tab: 'room_service' },
      { label: 'Minibar', tab: 'minibar' },
      { label: 'Servicios Compl.', tab: 'servicios_comp' },
      { label: 'Inventario', tab: 'inventario' },
      { label: 'Proveedores y Compras', tab: 'proveedores' },
      { label: 'Recetario e Insumos', tab: 'recetas' },
      { label: 'IA Demanda y Stock', tab: 'ia_demanda' },
    ],
  },
  {
    id: 'm4',
    label: 'Facturación y Finanzas',
    path: '/finanzas',
    iconName: 'receipt',
    subItems: [
      { label: 'Cuenta del Huésped', tab: 'folios' },
      { label: 'Facturación', tab: 'facturacion' },
      { label: 'Pagos', tab: 'pagos' },
      { label: 'Cuentas por Cobrar', tab: 'cxc' },
      { label: 'Caja', tab: 'caja' },
      { label: 'Gastos', tab: 'gastos' },
      { label: 'Costos', tab: 'costos' },
      { label: 'Reportes Financieros', tab: 'reportes' },
      { label: 'Comp. Electrónicos', tab: 'sunat' },
      { label: 'IA Financiera', tab: 'ia_financiera' },
    ],
  },
  {
    id: 'm5',
    label: 'CRM y Atención',
    path: '/crm',
    iconName: 'heart',
    subItems: [
      { label: 'Perfil 360°', tab: 'perfil_360' },
      { label: 'Segmentación', tab: 'segmentacion' },
      { label: 'Fidelización', tab: 'fidelizacion' },
      { label: 'Campañas', tab: 'campanas' },
      { label: 'Reclamos', tab: 'reclamos' },
      { label: 'Solicitudes', tab: 'solicitudes' },
      { label: 'Encuestas', tab: 'encuestas' },
      { label: 'Reseñas', tab: 'resenas' },
      { label: 'Autoatención Huésped', tab: 'portal_ia' },
      { label: 'IA Conversacional', tab: 'ia_conversacional' },
    ],
  },
  {
    id: 'config',
    label: 'Configuración y RBAC',
    path: '/configuracion',
    iconName: 'settings',
    subItems: [
      { label: 'Permisos por Rol', tab: 'rbac' },
      { label: 'Directorio de Usuarios', tab: 'usuarios' },
      { label: 'Auditoría', tab: 'auditoria' },
    ],
  },
];

const uiState = {
  mobileOpen: false,
  sidebarCollapsed: (() => {
    try {
      return localStorage.getItem('sgh_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  })(),
  expandedModule: null,
  searchQuery: '',
  notifOpen: false,
  profileOpen: false,
  lastBasePath: null,
};

let toastsInitialized = false;
function ensureToastRoot() {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    root.className = 'toast-stack';
    document.body.appendChild(root);
  }
  if (!toastsInitialized) {
    toastsInitialized = true;
    const renderToasts = (toasts) => {
      mount(
        root,
        toasts.map((t) => {
          const item = cloneLayoutTpl('toast-item');
          setText(item, 'title', t.title);
          if (t.detail) {
            setText(item, 'detail', t.detail);
            setVisible(item, 'detail', true);
          }
          const closeBtn = getRef(item, 'close-btn');
          if (closeBtn) {
            mount(closeBtn, icon('x', 'w-3.5'));
            closeBtn.addEventListener('click', () => erpStore.dismissToast(t.id));
          }
          return item;
        })
      );
    };
    erpStore.subscribeToasts(renderToasts);
    renderToasts(erpStore.toasts);
  }
}

export function resetLayoutPopovers() {
  uiState.mobileOpen = false;
  uiState.notifOpen = false;
  uiState.profileOpen = false;
}

export function renderERPLayout(outletNode) {
  ensureToastRoot();

  const route = getRoute();
  const state = erpStore.state;
  const currentUser = erpStore.currentUser;
  const currentPermissions = erpStore.currentPermissions;

  if (!currentUser) return h('div');

  const activeNav =
    NAV_ITEMS.find((n) => (n.path === '/' ? route.basePath === '/' : route.basePath === n.path)) ??
    NAV_ITEMS[0];

  if (uiState.lastBasePath !== route.basePath) {
    uiState.lastBasePath = route.basePath;
    if (activeNav.subItems.length > 0) {
      uiState.expandedModule = activeNav.id;
    }
  }

  const unreadNotifications = (state?.notifications || []).filter((n) => !n.read).length;

  const wrapper = parseHtmlTemplate(layoutHtml);
  const desktopSidebar = getRef(wrapper, 'desktop-sidebar');
  const mobileDrawerMount = getRef(wrapper, 'mobile-drawer');
  const mobileMenuBtn = getRef(wrapper, 'mobile-menu-btn');
  const searchInput = getRef(wrapper, 'search-input');
  const searchDropdown = getRef(wrapper, 'search-dropdown');
  const notifAnchor = getRef(wrapper, 'notif-anchor');
  const profileAnchor = getRef(wrapper, 'profile-anchor');
  const viewport = getRef(wrapper, 'viewport');

  mountRef(wrapper, 'search-icon', icon('search', 'topbar-search-icon'));
  const shellEl = wrapper.querySelector?.('.erp-shell') ?? wrapper.firstElementChild;
  shellEl?.classList.toggle('sidebar-collapsed', uiState.sidebarCollapsed);
  if (mobileMenuBtn) {
    mount(mobileMenuBtn, icon('menu', 'w-5'));
    mobileMenuBtn.setAttribute('aria-label', 'Mostrar u ocultar el menú');
    mobileMenuBtn.title = 'Mostrar u ocultar el menú';
    mobileMenuBtn.addEventListener('click', () => {
      // En pantallas anchas oculta/muestra el menú lateral; en móvil abre el panel.
      if (window.matchMedia('(min-width: 1024px)').matches) {
        uiState.sidebarCollapsed = !uiState.sidebarCollapsed;
        shellEl?.classList.toggle('sidebar-collapsed', uiState.sidebarCollapsed);
        try {
          localStorage.setItem('sgh_sidebar_collapsed', uiState.sidebarCollapsed ? '1' : '0');
        } catch {
          // sin almacenamiento: el estado vale solo para esta sesión
        }
        return;
      }
      uiState.mobileOpen = true;
      syncMobileDrawer();
    });
  }

  function buildSidebar(isMobile = false) {
    const panel = cloneLayoutTpl('sidebar-panel');
    mountRef(panel, 'brand-icon', icon('building', 'w-4'));

    const brandBtn = getRef(panel, 'brand-btn');
    if (brandBtn) {
      brandBtn.addEventListener('click', () => {
        uiState.mobileOpen = false;
        navigate('/');
      });
    }

    if (isMobile) {
      const closeBtn = getRef(panel, 'close-btn');
      setVisible(panel, 'close-btn', true);
      if (closeBtn) {
        mount(closeBtn, icon('x', 'w-4'));
        closeBtn.addEventListener('click', () => {
          uiState.mobileOpen = false;
          syncMobileDrawer();
        });
      }
    }

    const visibleNav = NAV_ITEMS.filter((item) => erpStore.canView(item.id));
    mountRef(
      panel,
      'nav',
      visibleNav.map((item) => {
        const isCurrent = item.id === activeNav.id;
        const visibleSubs = item.subItems.filter((sub) => erpStore.canViewTab(item.id, sub.tab));
        const isExpanded = uiState.expandedModule === item.id && visibleSubs.length > 0;
        const defaultTab = erpStore.getDefaultTab(item.id) || visibleSubs[0]?.tab;

        const row = cloneLayoutTpl('nav-item');
        const linkBtn = getRef(row, 'link-btn');
        if (linkBtn) {
          if (isCurrent) linkBtn.classList.add('is-active');
          mountRef(row, 'icon', icon(item.iconName, 'nav-item-icon'));
          setText(row, 'label', item.label);
          linkBtn.addEventListener('click', () => {
            if (visibleSubs.length > 0) {
              uiState.expandedModule = item.id;
              uiState.mobileOpen = false;
              navigateToView(item.path, defaultTab);
            } else {
              uiState.mobileOpen = false;
              navigate(item.path);
            }
          });
        }

        if (visibleSubs.length > 0) {
          const expandBtn = getRef(row, 'expand-btn');
          setVisible(row, 'expand-btn', true);
          if (expandBtn) {
            expandBtn.setAttribute('aria-label', `Desplegar submodulos de ${item.label}`);
            mount(expandBtn, icon(isExpanded ? 'chevronDown' : 'chevronRight', 'w-3.5'));
            expandBtn.addEventListener('click', () => {
              uiState.expandedModule = isExpanded ? null : item.id;
              refreshSidebarPanels();
            });
          }
        }

        if (isExpanded) {
          const submenu = getRef(row, 'submenu');
          setVisible(row, 'submenu', true);
          if (submenu) {
            mount(
              submenu,
              visibleSubs.map((sub) => {
                const currentTab = route.tab || defaultTab;
                const isSubActive = isCurrent && currentTab === sub.tab;
                return h(
                  'button',
                  {
                    type: 'button',
                    className: `nav-submenu-link${isSubActive ? ' is-active' : ''}`,
                    style: { textAlign: 'left', width: '100%' },
                    onClick: () => {
                      uiState.mobileOpen = false;
                      navigateToView(item.path, sub.tab);
                    },
                  },
                  sub.label
                );
              })
            );
          }
        }

        return row;
      })
    );

    return panel;
  }

  mount(desktopSidebar, buildSidebar(false));

  function syncMobileDrawer() {
    if (!mobileDrawerMount) return;
    if (!uiState.mobileOpen) {
      mobileDrawerMount.replaceChildren();
      return;
    }
    const drawer = cloneLayoutTpl('mobile-drawer');
    mountRef(drawer, 'panel', buildSidebar(true));
    const backdrop = getRef(drawer, 'backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', () => {
        uiState.mobileOpen = false;
        syncMobileDrawer();
      });
    }
    mount(mobileDrawerMount, drawer);
  }

  function refreshSidebarPanels() {
    mount(desktopSidebar, buildSidebar(false));
    if (uiState.mobileOpen) syncMobileDrawer();
  }

  function updateSearchDropdown() {
    const q = uiState.searchQuery.trim().toLowerCase();
    if (!q || !state) {
      searchDropdown.classList.add('hidden');
      searchDropdown.replaceChildren();
      return;
    }

    const res = [];
    if (erpStore.canView('m1')) {
      for (const r of state.reservations) {
        if (r.code.toLowerCase().includes(q) || r.channel.toLowerCase().includes(q)) {
          res.push({ title: `Reserva ${r.code}`, subtitle: `${r.status} · ${r.checkInDate}`, to: '/reservas/reservas' });
        }
      }
      for (const rm of state.rooms) {
        if (rm.number.includes(q) || rm.type.toLowerCase().includes(q)) {
          res.push({
            title: `Habitación ${rm.number}`,
            subtitle: `${rm.type} · ${rm.commercialStatus} / ${rm.housekeepingStatus}`,
            to: '/reservas/habitaciones',
          });
        }
      }
    }
    if (erpStore.canView('m5') || erpStore.canView('m1')) {
      for (const g of state.guests) {
        if (g.fullName.toLowerCase().includes(q)) {
          res.push({
            title: g.fullName,
            subtitle: `${g.loyaltyTier} · ${g.segment}`,
            to: erpStore.canView('m5') ? '/crm/perfil-360' : '/reservas/huespedes',
          });
        }
      }
    }
    if (erpStore.canView('m2')) {
      for (const inc of state.incidents) {
        if (inc.code.toLowerCase().includes(q) || inc.location.toLowerCase().includes(q)) {
          res.push({ title: `Incidencia ${inc.code}`, subtitle: `${inc.location} · ${inc.status}`, to: '/housekeeping/incidencias' });
        }
      }
    }
    if (erpStore.canView('m4')) {
      for (const f of state.folios) {
        if (f.code.toLowerCase().includes(q) || f.guestName.toLowerCase().includes(q)) {
          res.push({ title: `Folio ${f.code}`, subtitle: `${f.guestName} · Saldo S/ ${f.balance.toFixed(2)}`, to: '/finanzas/folios' });
        }
      }
    }

    const limited = res.slice(0, 6);
    searchDropdown.classList.remove('hidden');
    if (limited.length === 0) {
      mount(
        searchDropdown,
        h('div', { className: 'px-3 py-2 text-xs text-slate-500' }, `Sin resultados autorizados para "${uiState.searchQuery}"`)
      );
      return;
    }
    mount(
      searchDropdown,
      limited.map((item) => {
        const btn = cloneLayoutTpl('search-result');
        setText(btn, 'title', item.title);
        setText(btn, 'subtitle', item.subtitle);
        btn.addEventListener('click', () => {
          uiState.searchQuery = '';
          searchInput.value = '';
          updateSearchDropdown();
          navigate(item.to);
        });
        return btn;
      })
    );
  }

  if (searchInput) {
    searchInput.value = uiState.searchQuery;
    searchInput.addEventListener('input', (e) => {
      uiState.searchQuery = e.target.value;
      updateSearchDropdown();
    });
  }

  function renderNotifAnchor() {
    const items = (state?.notifications || []).slice(0, 12);
    const trigger = cloneLayoutTpl('notif-trigger');
    mountRef(trigger, 'icon', icon('bell', 'w-5'));
    if (unreadNotifications > 0) {
      setText(trigger, 'badge', String(unreadNotifications));
      setVisible(trigger, 'badge', true);
    }
    trigger.addEventListener('click', () => {
      uiState.notifOpen = !uiState.notifOpen;
      uiState.profileOpen = false;
      renderNotifAnchor();
      renderProfileAnchor();
    });

    let popover = null;
    if (uiState.notifOpen) {
      popover = cloneLayoutTpl('notif-popover');
      const markAllBtn = getRef(popover, 'mark-all-btn');
      if (markAllBtn) markAllBtn.addEventListener('click', () => erpStore.markAllNotificationsRead());
      mountRef(
        popover,
        'list',
        items.length === 0
          ? h('div', { className: 'p-4 text-xs text-slate-500 text-center' }, 'Sin notificaciones.')
          : items.map((n) => {
              const row = cloneLayoutTpl('notif-item');
              if (!n.read) row.classList.add('is-unread');
              setText(row, 'title', n.title);
              setText(row, 'message', n.message);
              setText(row, 'timestamp', n.timestamp);
              row.addEventListener('click', () => erpStore.markNotificationRead(n.id));
              return row;
            })
      );
    }

    mount(notifAnchor, trigger, popover);
  }

  function renderProfileAnchor() {
    const canConfig = erpStore.canView('config');
    const trigger = cloneLayoutTpl('profile-trigger');
    const avatarNode = currentUser.avatarUrl
      ? h('img', { src: currentUser.avatarUrl, alt: currentUser.name, className: 'profile-avatar' })
      : h('div', { className: 'profile-avatar-fallback' }, currentUser.name.charAt(0));
    mountRef(trigger, 'avatar-slot', avatarNode);
    setText(trigger, 'name', currentUser.name);
    setText(trigger, 'role', currentUser.roleLabel);
    mountRef(trigger, 'chevron', icon('chevronDown', 'w-3.5 text-slate-400'));
    trigger.addEventListener('click', () => {
      uiState.profileOpen = !uiState.profileOpen;
      uiState.notifOpen = false;
      renderProfileAnchor();
      renderNotifAnchor();
    });

    let popover = null;
    if (uiState.profileOpen) {
      popover = cloneLayoutTpl('profile-popover');
      setText(popover, 'name', currentUser.name);
      setText(popover, 'role', currentUser.roleLabel);
      setText(popover, 'email', currentUser.email);
      if (canConfig) {
        const cfgBtn = getRef(popover, 'config-btn');
        setVisible(popover, 'config-btn', true);
        mountRef(popover, 'config-icon', icon('settings', 'w-3.5 text-slate-500'));
        if (cfgBtn) {
          cfgBtn.addEventListener('click', () => {
            uiState.profileOpen = false;
            navigate('/configuracion');
          });
        }
      }
      mountRef(popover, 'logout-icon', icon('logout', 'w-3.5'));
      const logoutBtn = getRef(popover, 'logout-btn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
          uiState.profileOpen = false;
          await erpStore.logout();
          navigate('/', { replace: true });
        });
      }
    }

    mount(profileAnchor, trigger, popover);
  }

  renderNotifAnchor();
  renderProfileAnchor();

  if (viewport && outletNode) {
    viewport.appendChild(outletNode);
  }
  syncMobileDrawer();
  updateSearchDropdown();

  return wrapper;
}
