import { getSupabaseClient, isSupabaseConfigured } from './data-adapter.js';

let inMemorySessionToken = null;
let authSubscription = null;

export function getSessionToken() {
  return inMemorySessionToken;
}

export function setSessionToken(token) {
  inMemorySessionToken = token || null;
}

export function clearSessionToken() {
  inMemorySessionToken = null;
}

export function authHeaders() {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const ALL_APP_TABS = {
  m1: ['habitaciones', 'disponibilidad', 'reservas', 'tarifas', 'checkin', 'checkout', 'lista_espera', 'ocupacion', 'huespedes', 'ia_tarifas'],
  m2: ['estado_habitaciones', 'limpieza', 'inspeccion', 'personal', 'incidencias', 'mant_preventivo', 'mant_correctivo', 'activos', 'insumos', 'ia_operativa'],
  m3: ['productos', 'servicios', 'pos', 'restaurante', 'room_service', 'minibar', 'servicios_comp', 'inventario', 'proveedores', 'recetas', 'ia_demanda'],
  m4: ['folios', 'facturacion', 'pagos', 'cxc', 'caja', 'gastos', 'costos', 'reportes', 'sunat', 'ia_financiera'],
  m5: ['perfil_360', 'segmentacion', 'fidelizacion', 'campanas', 'reclamos', 'solicitudes', 'encuestas', 'resenas', 'portal_ia', 'ia_conversacional'],
  config: ['rbac', 'usuarios', 'auditoria'],
};

const OFFICIAL_ROLE_FALLBACK_MODULES = {
  RECEPCIONISTA: { view: ['m1', 'm2', 'm4', 'm5'], edit: ['m1', 'm4', 'm5'] },
  SUPERVISOR_HOUSEKEEPING: { view: ['m2', 'm1', 'm3'], edit: ['m2'] },
  PERSONAL_LIMPIEZA: { view: ['m2'], edit: ['m2'] },
  TECNICO_MANTENIMIENTO: { view: ['m2', 'm3'], edit: ['m2'] },
  ADMIN_SERVICIOS: { view: ['m3', 'm1', 'm4'], edit: ['m3'] },
  ATENCION_SERVICIOS: { view: ['m3', 'm5'], edit: ['m3'] },
  SUPERVISOR_SERVICIOS: { view: ['m3', 'm1', 'm4'], edit: ['m3'] },
  RESTAURANTE: { view: ['m3', 'm1', 'm4'], edit: ['m3'] },
  COCINA: { view: ['m3'], edit: ['m3'] },
  RESPONSABLE_ALMACEN: { view: ['m3', 'm2', 'm4'], edit: ['m3'] },
  RESPONSABLE_COMPRAS: { view: ['m3', 'm4'], edit: ['m3'] },
  CAJERO: { view: ['m4', 'm1'], edit: ['m4'] },
  RESPONSABLE_COSTOS: { view: ['m4', 'm3'], edit: ['m4'] },
  JEFE_FINANZAS: { view: ['m4', 'm1', 'm3'], edit: ['m4'] },
  GERENTE_FINANCIERO: { view: ['m4', 'm1', 'm3'], edit: ['m4'] },
  ATENCION_HUESPED: { view: ['m5', 'm1', 'm2', 'm4'], edit: ['m5', 'm2'] },
  ADMINISTRADOR_COMERCIAL: { view: ['m5', 'm1', 'm4'], edit: ['m5'] },
};

function isAdminRoleList(upperRoles) {
  return upperRoles.some((r) => ['ADMIN_SISTEMA', 'SUPER_ADMIN', 'ADMINISTRADOR', 'ADMIN'].includes(r));
}

function isAuditorRoleList(upperRoles) {
  return upperRoles.some((r) => ['AUDITOR', 'AUDITOR_GENERAL'].includes(r));
}

function deriveUiPermissionsFromV1(v1Session) {
  const permisosArr = Array.isArray(v1Session.permisos) ? v1Session.permisos.map((p) => String(p).toLowerCase()) : [];
  const permisosSet = new Set(permisosArr);
  const roles = Array.isArray(v1Session.roles) ? v1Session.roles : [];
  const upperRoles = roles.map((r) => String(r).trim().toUpperCase());
  const isAdmin = isAdminRoleList(upperRoles);
  const isAuditor = isAuditorRoleList(upperRoles);

  const hasPrefixView = (prefix) =>
    isAdmin || isAuditor || permisosArr.some((p) => p.startsWith(prefix));
  const hasPrefixEdit = (prefix) =>
    isAdmin ||
    (!isAuditor && permisosArr.some((p) => p.startsWith(prefix) && !p.endsWith('.consultar')));

  const view = ['dashboard'];
  const edit = [];

  for (const mod of ['m1', 'm2', 'm3', 'm4', 'm5']) {
    const roleFallbackView = upperRoles.some((r) => OFFICIAL_ROLE_FALLBACK_MODULES[r]?.view.includes(mod));
    const roleFallbackEdit = upperRoles.some((r) => OFFICIAL_ROLE_FALLBACK_MODULES[r]?.edit.includes(mod));
    if (hasPrefixView(`${mod}.`) || (permisosArr.length === 0 && roleFallbackView)) {
      view.push(mod);
    }
    if (hasPrefixEdit(`${mod}.`) || (permisosArr.length === 0 && roleFallbackEdit)) {
      edit.push(mod);
      if (!view.includes(mod)) view.push(mod);
    }
  }

  if (
    isAdmin ||
    isAuditor ||
    permisosSet.has('auditoria.consultar') ||
    permisosSet.has('seguridad.usuario.administrar')
  ) {
    view.push('config');
  }
  if (isAdmin || permisosSet.has('seguridad.usuario.administrar')) {
    edit.push('config');
  }

  const allowedTabs = {};
  const editableTabs = {};
  for (const mod of ['m1', 'm2', 'm3', 'm4', 'm5', 'config']) {
    if (view.includes(mod)) {
      allowedTabs[mod] = [...ALL_APP_TABS[mod]];
    }
    if (edit.includes(mod)) {
      editableTabs[mod] = [...ALL_APP_TABS[mod]];
    }
  }

  return {
    view,
    edit,
    allowedTabs,
    editableTabs,
    canViewFullPII: isAdmin || Boolean(v1Session.usuario?.canViewFullPII),
    canApproveFinancials: isAdmin || permisosSet.has('m4.gasto.aprobar') || permisosSet.has('m4.alerta.revisar'),
    canManageRoles: isAdmin || permisosSet.has('seguridad.usuario.administrar'),
    scopeSummary: `Roles activos: ${roles.join(', ') || 'Sin rol'}`,
  };
}

function mapV1SessionToErpSession(v1Session, emailFallback = '') {
  const roles = Array.isArray(v1Session.roles) ? v1Session.roles : [];
  const upperRoles = roles.map((r) => String(r).trim().toUpperCase());
  const primaryRole = isAdminRoleList(upperRoles)
    ? 'admin'
    : isAuditorRoleList(upperRoles)
    ? 'auditor'
    : (roles[0] || 'operador').toLowerCase();

  return {
    user: {
      id: v1Session.usuario.id,
      codigoUsuario: v1Session.usuario.codigo,
      name: v1Session.usuario.nombre,
      email: emailFallback || `${v1Session.usuario.codigo}@hotelboulevard.pe`,
      role: primaryRole,
      officialRoles: roles,
      roleLabel: roles.join(' · ') || 'Usuario ERP',
      department: v1Session.usuario.departamento,
      turno: v1Session.usuario.turno,
    },
    permissions: deriveUiPermissionsFromV1(v1Session),
    erpPermisos: v1Session.permisos || [],
    authMode: 'supabase',
  };
}

async function fetchV1Session(accessToken, emailFallback = '') {
  setSessionToken(accessToken);
  const res = await fetch('/api/v1/session/me', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Requested-With': 'SGH-ERP',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return {
      ok: false,
      error:
        body?.error?.message ||
        'Tu cuenta fue autenticada en Supabase, pero aún no tiene perfil/permisos activos en el ERP.',
    };
  }
  const body = await res.json();
  return { ok: true, data: mapV1SessionToErpSession(body, emailFallback) };
}

export function subscribeSupabaseAuthChanges(onSessionLostOrUpdated) {
  const supabase = getSupabaseClient();
  if (!supabase || authSubscription) return;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.access_token) {
      setSessionToken(session.access_token);
    } else {
      clearSessionToken();
    }
    if (typeof onSessionLostOrUpdated === 'function') {
      onSessionLostOrUpdated(session);
    }
  });
  authSubscription = data?.subscription ?? null;
}

export async function apiLogin(email, password) {
  const supabase = getSupabaseClient();
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error || !data?.session?.access_token) {
        return { ok: false, error: error?.message || 'Credenciales inválidas en Supabase Auth.' };
      }
      return await fetchV1Session(data.session.access_token, data.user?.email || email.trim());
    } catch {
      return { ok: false, error: 'Error de conexión con Supabase Auth.' };
    }
  }

  // Respaldo transitorio cuando VITE_SUPABASE_URL aún no está configurada en el entorno
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'SGH-ERP',
      },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok || !body.user || !body.permissions) {
      return { ok: false, error: body.error || 'No se pudo iniciar sesión. Verifica tus credenciales.' };
    }
    if (body.token) {
      setSessionToken(body.token);
    }
    return {
      ok: true,
      data: {
        user: body.user,
        permissions: body.permissions,
        allRolePermissions: body.allRolePermissions,
        authMode: 'legacy_fallback',
      },
    };
  } catch {
    return { ok: false, error: 'Error de conexión con el servidor de autenticación.' };
  }
}

export async function apiGetMe() {
  const supabase = getSupabaseClient();
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) {
        clearSessionToken();
        return null;
      }
      const v1Res = await fetchV1Session(token, data.session.user?.email || '');
      if (!v1Res.ok) {
        clearSessionToken();
        return null;
      }
      return v1Res.data;
    } catch {
      clearSessionToken();
      return null;
    }
  }

  try {
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      headers: { ...authHeaders() },
      credentials: 'include',
    });
    if (!res.ok) {
      clearSessionToken();
      return null;
    }
    const body = await res.json();
    if (!body.user || !body.permissions) {
      clearSessionToken();
      return null;
    }
    return { ...body, authMode: 'legacy_fallback' };
  } catch {
    return null;
  }
}

export async function apiLogout() {
  const supabase = getSupabaseClient();
  if (supabase && isSupabaseConfigured()) {
    try {
      await supabase.auth.signOut();
    } catch {
      // best-effort Supabase signOut
    }
  }
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'X-Requested-With': 'SGH-ERP',
        ...authHeaders(),
      },
      credentials: 'include',
    });
  } catch {
    // best-effort logout
  } finally {
    clearSessionToken();
  }
}

export async function apiGetDirectory(authMode = 'legacy_fallback') {
  const endpoint = authMode === 'supabase' ? '/api/v1/session/directory' : '/api/auth/users';
  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'X-Requested-With': 'SGH-ERP',
        ...authHeaders(),
      },
      credentials: 'include',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function apiUpdateRolePermissions(role, next) {
  try {
    const res = await fetch(`/api/auth/permissions/${encodeURIComponent(role)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'SGH-ERP',
        ...authHeaders(),
      },
      credentials: 'include',
      body: JSON.stringify(next),
    });
    const body = await res.json();
    if (!res.ok || !body.permissions) {
      return { ok: false, error: body.error || 'No se pudieron guardar los permisos.' };
    }
    return { ok: true, permissions: body.permissions };
  } catch {
    return { ok: false, error: 'Error de red al actualizar permisos RBAC.' };
  }
}
