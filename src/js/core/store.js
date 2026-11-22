import {
  canEditModuleWithPerms,
  canEditTabWithPerms,
  canViewModuleWithPerms,
  canViewTabWithPerms,
  getDefaultTabForModule,
} from '../data/rbac.js';
import {
  apiGetDirectory,
  apiGetMe,
  apiLogin,
  apiLogout,
  apiUpdateRolePermissions,
  subscribeSupabaseAuthChanges,
} from '../services/auth-client.js';
import {
  fetchEstablishmentConfig,
  getPersistenceStatus,
  loadERPState,
  clearFinanceSummaryCache,
} from '../services/data-adapter.js';
import { reloadActivePagedList, resetPagedLists } from '../services/paged-list.js';
import { createWriteActions } from '../services/erp-actions.js';
import { createEmptyERPState } from '../data/empty-state.js';
import { nowStamp, uid } from '../utils/formatters.js';

const listeners = new Set();
const toastListeners = new Set();

const storeData = {
  state: null,
  loadInfo: null,
  establishmentConfig: null,
  lastSyncedAt: null,
  toasts: [],
  currentUser: null,
  currentPermissions: null,
  allRolePermissions: {},
  directoryUsers: [],
  authLoading: true,
  initStarted: false,
};

function emit() {
  for (const fn of listeners) fn(erpStore);
}

function emitToasts() {
  for (const fn of toastListeners) fn(storeData.toasts);
}

async function hydrateAdminDirectory(role, authMode) {
  if (role !== 'admin' && role !== 'auditor') {
    storeData.directoryUsers = [];
    emit();
    return;
  }
  const dir = await apiGetDirectory(authMode);
  if (dir) {
    storeData.directoryUsers = dir.users ?? [];
    storeData.allRolePermissions = dir.permissions ?? {};
    emit();
  }
}

function commit(updater, audit, notification) {
  if (!storeData.state) return;
  let next = updater(storeData.state);
  const stamp = nowStamp();

  if (audit) {
    next = {
      ...next,
      auditLog: [
        {
          id: uid('aud'),
          timestamp: stamp,
          user: storeData.currentUser?.name ?? 'Sistema',
          role: storeData.currentUser?.role ?? 'admin',
          module: audit.module,
          action: audit.action,
          entityRef: audit.entityRef,
          privacyImpact: audit.privacyImpact,
        },
        ...next.auditLog,
      ].slice(0, 120),
    };
  }

  if (notification) {
    next = {
      ...next,
      notifications: [
        {
          ...notification,
          id: uid('ntf'),
          timestamp: stamp,
          read: false,
        },
        ...next.notifications,
      ].slice(0, 40),
    };
  }

  storeData.state = next;
  emit();
}

// Escrituras de negocio (reservas, check-in, cobros, reclamos…): van a la API y releen lo afectado.
const writeActions = createWriteActions({
  getState: () => storeData.state,
  refresh: (keys) => erpStore.refreshState(keys),
  toast: (t) => erpStore.pushToast(t),
});

export const erpStore = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  subscribeToasts(fn) {
    toastListeners.add(fn);
    return () => toastListeners.delete(fn);
  },

  get state() { return storeData.state; },
  get establishmentConfig() { return storeData.establishmentConfig; },
  get currentUser() { return storeData.currentUser; },
  get currentPermissions() { return storeData.currentPermissions; },
  get allRolePermissions() { return storeData.allRolePermissions; },
  get directoryUsers() { return storeData.directoryUsers; },
  get authLoading() { return storeData.authLoading; },
  get toasts() { return storeData.toasts; },
  get persistence() { return getPersistenceStatus(storeData.lastSyncedAt, storeData.loadInfo); },
  get loadInfo() { return storeData.loadInfo; },
  get canViewFullPII() { return Boolean(storeData.currentPermissions?.canViewFullPII); },

  async init() {
    if (storeData.initStarted) return;
    storeData.initStarted = true;
    try {
      localStorage.removeItem('sgh_erp_current_user_v1');
      localStorage.removeItem('sgh_erp_demo_state_v1');
    } catch {
      // ignore
    }

    subscribeSupabaseAuthChanges(async (sbSession) => {
      if (!sbSession) {
        if (storeData.currentUser?.authMode === 'supabase') {
          storeData.currentUser = null;
          storeData.currentPermissions = null;
          emit();
        }
      }
    });

    const configPromise = fetchEstablishmentConfig().then((cfg) => {
      if (cfg) storeData.establishmentConfig = cfg;
    });

    const authPromise = apiGetMe().then(async (session) => {
      if (session) {
        storeData.currentUser = { ...session.user, authMode: session.authMode };
        storeData.currentPermissions = session.permissions;
        if (session.allRolePermissions) {
          storeData.allRolePermissions = session.allRolePermissions;
        }
        await hydrateAdminDirectory(session.user.role, session.authMode);
      }
    });

    // El estado se carga DESPUÉS de resolver la sesión: la API v1 exige el Bearer token de Supabase,
    // que se registra dentro de apiGetMe(). Cargar en paralelo producía 401 y caía a datos locales.
    await Promise.all([configPromise, authPromise]);
    await erpStore.refreshState();
    storeData.authLoading = false;
    emit();
  },

  /**
   * Lee de PostgreSQL (vía /api/v1) todo lo que tiene API; el resto queda vacío.
   * Con `keys` solo se vuelven a pedir esos recursos (p. ej. tras una escritura).
   */
  /** Incorpora (o completa) un huésped elegido en un buscador para que las acciones lo reconozcan. */
  ensureGuest(guest) {
    const st = storeData.state;
    if (!st || !guest?.id) return;
    const cur = st.guests.find((g) => g.id === guest.id);
    if (!cur) st.guests.push({ segment: 'Sin segmentar', loyaltyTier: 'Sin nivel', loyaltyPoints: 0, totalStays: 0, totalSpent: 0, preferences: [], ...guest });
    else Object.assign(cur, Object.fromEntries(Object.entries(guest).filter(([, v]) => v !== undefined && v !== '')));
  },

  async refreshState(keys) {
    const { state, source, errors, truncated, forbidden } = await loadERPState(keys ? { keys } : undefined);
    storeData.state = state;
    storeData.loadInfo = { source, errors, truncated, forbidden };
    if (keys?.length) {
      clearFinanceSummaryCache();
      reloadActivePagedList();
    } // tras guardar: vuelve a leer la lista que está a la vista
    else resetPagedLists(); // carga completa: descarta lo paginado anterior
    if (source === 'postgresql_database' || source === 'partial') {
      storeData.lastSyncedAt = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    }
    emit();

    if (source === 'error' || source === 'partial') {
      erpStore.pushToast({
        title: source === 'error' ? 'No se pudo leer la base de datos' : 'Carga parcial desde la base de datos',
        detail: errors.map((e) => `${e.resource}: ${e.message}`).join(' · '),
        type: 'error',
      });
    }
    // Solo en la carga completa; las reservas se amplían con "Cargar más" en su pantalla.
    const notable = truncated.filter((t) => t !== 'reservas');
    if (!keys && notable.length > 0) {
      erpStore.pushToast({
        title: 'Datos limitados',
        detail: `Se cargaron solo los registros más recientes de: ${notable.join(', ')}.`,
        type: 'info',
      });
    }
    return { source, errors };
  },

  pushToast(toast) {
    const id = uid('tst');
    storeData.toasts = [{ ...toast, id }, ...storeData.toasts].slice(0, 4);
    emitToasts();
    setTimeout(() => {
      erpStore.dismissToast(id);
    }, 4500);
  },

  dismissToast(id) {
    const next = storeData.toasts.filter((t) => t.id !== id);
    if (next.length !== storeData.toasts.length) {
      storeData.toasts = next;
      emitToasts();
    }
  },

  canView(mod) {
    return canViewModuleWithPerms(storeData.currentPermissions, mod);
  },
  canEdit(mod) {
    return canEditModuleWithPerms(storeData.currentPermissions, mod);
  },
  canViewTab(mod, tabId) {
    return canViewTabWithPerms(storeData.currentPermissions, mod, tabId);
  },
  canEditTab(mod, tabId) {
    return canEditTabWithPerms(storeData.currentPermissions, mod, tabId);
  },
  getDefaultTab(mod) {
    return getDefaultTabForModule(storeData.currentPermissions, mod);
  },

  async login(email, password) {
    const res = await apiLogin(email, password);
    if (!res.ok) {
      return { ok: false, error: res.error };
    }
    const { user, permissions, allRolePermissions: matrix } = res.data;
    storeData.currentUser = user;
    storeData.currentPermissions = permissions;
    storeData.allRolePermissions = matrix ?? {};

    // Con el token ya registrado, cargar los datos reales de la base.
    await erpStore.refreshState();

    if (user.role === 'admin' || user.role === 'auditor') {
      hydrateAdminDirectory(user.role, res.data.authMode);
    } else {
      storeData.directoryUsers = [];
    }

    emit();
    erpStore.pushToast({ title: `Bienvenido, ${user.name}`, detail: user.roleLabel, type: 'success' });
    return { ok: true };
  },

  async logout() {
    await apiLogout();
    // Sin sesión no debe quedar información operativa en memoria.
    storeData.state = createEmptyERPState();
    storeData.loadInfo = { source: 'unauthenticated', errors: [], truncated: [], forbidden: [] };
    storeData.currentUser = null;
    storeData.currentPermissions = null;
    storeData.allRolePermissions = {};
    storeData.directoryUsers = [];
    emit();
  },

  async updateRolePermissions(role, next) {
    const result = await apiUpdateRolePermissions(role, next);
    if (!result.ok) {
      erpStore.pushToast({ title: 'No se pudo actualizar permisos', detail: result.error, type: 'error' });
      return { ok: false, error: result.error };
    }
    storeData.allRolePermissions = result.permissions;
    if (storeData.currentUser?.role === role && result.permissions[role]) {
      storeData.currentPermissions = result.permissions[role];
    }
    commit(
      (prev) => prev,
      { module: 'config', action: `Actualizó matriz RBAC en servidor para rol ${role}`, entityRef: role, privacyImpact: true }
    );
    erpStore.pushToast({ title: 'Permisos actualizados en servidor', detail: `Rol ${role} guardado`, type: 'success' });
    return { ok: true };
  },

  async reloadFromDatabase() {
    const { source } = await erpStore.refreshState();
    if (source === 'postgresql_database') {
      erpStore.pushToast({ title: 'Datos recargados', detail: 'Se volvió a leer la información desde la base de datos.', type: 'success' });
    }
  },

  markAllNotificationsRead() {
    commit((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) => ({ ...n, read: true })),
    }));
  },

  markNotificationRead(id) {
    commit((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    }));
  },

  // Escrituras: cada operación se envía a la API (PostgreSQL) y se relee lo afectado. Ver services/erp-actions.js
  ...writeActions,
};
