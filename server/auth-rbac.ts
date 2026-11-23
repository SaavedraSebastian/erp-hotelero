import crypto from 'crypto';
import type { ModuleKey, OperationalModuleKey, RoleId, RolePermissions, SubmoduleMap, UserAccount } from './types.ts';
import { getDb, hashPassword, initDatabase, type DbUserRow } from './db.ts';

const ALL_M1 = ['habitaciones', 'disponibilidad', 'reservas', 'tarifas', 'checkin', 'checkout', 'lista_espera', 'ocupacion', 'huespedes', 'ia_tarifas'];
const ALL_M2 = ['estado_habitaciones', 'limpieza', 'inspeccion', 'personal', 'incidencias', 'mant_preventivo', 'mant_correctivo', 'activos', 'insumos', 'ia_operativa'];
const ALL_M3 = ['productos', 'servicios', 'pos', 'restaurante', 'room_service', 'minibar', 'servicios_comp', 'inventario', 'proveedores', 'recetas', 'ia_demanda', 'reportes'];
const ALL_M4 = ['folios', 'facturacion', 'pagos', 'cxc', 'caja', 'gastos', 'costos', 'reportes', 'sunat', 'ia_financiera'];
const ALL_M5 = ['perfil_360', 'segmentacion', 'fidelizacion', 'campanas', 'reclamos', 'solicitudes', 'encuestas', 'resenas', 'portal_ia', 'ia_conversacional'];
const ALL_CONFIG = ['rbac', 'usuarios', 'iso', 'supabase', 'auditoria'];

const LEGACY_TAB_MAP: Record<ModuleKey, Record<string, string>> = {
  dashboard: {},
  m1: {
    ia: 'ia_tarifas',
    resumen: 'ia_tarifas',
    sobreventa: 'lista_espera',
  },
  m2: {
    ia: 'ia_operativa',
    resumen: 'estado_habitaciones',
    estado: 'estado_habitaciones',
    ordenes: 'limpieza',
    inspecciones: 'inspeccion',
    preventivo: 'mant_preventivo',
    correctivo: 'mant_correctivo',
    mant_predictivo: 'ia_operativa',
  },
  m3: {
    ia: 'ia_demanda',
    resumen: 'ia_demanda',
    consumo: 'ia_demanda',
    roomservice: 'room_service',
    complementarios: 'servicios_comp',
    recetario: 'recetas',
  },
  m4: {
    ia: 'ia_financiera',
    resumen: 'ia_financiera',
  },
  m5: {
    ia: 'ia_conversacional',
    resumen: 'ia_conversacional',
    perfil360: 'perfil_360',
    autoatencion: 'portal_ia',
  },
  config: {},
};

function makePerm(
  view: ModuleKey[],
  edit: ModuleKey[],
  allowedTabs: SubmoduleMap,
  editableTabs: SubmoduleMap,
  opts: {
    canViewFullPII: boolean;
    canApproveFinancials: boolean;
    canManageRoles: boolean;
    scopeSummary: string;
    onlyAssignedTasks?: boolean;
  }
): RolePermissions {
  return {
    view,
    edit,
    allowedTabs,
    editableTabs,
    ...opts,
  };
}

/**
 * Matriz RBAC autoritativa por defecto para los 16 roles (persistida en SQLite).
 */
const DEFAULT_ROLE_PERMISSIONS: Record<RoleId, RolePermissions> = {
  admin: makePerm(
    ['dashboard', 'm1', 'm2', 'm3', 'm4', 'm5', 'config'],
    ['config', 'm1', 'm2', 'm3', 'm4', 'm5'],
    { m1: ALL_M1, m2: ALL_M2, m3: ALL_M3, m4: ALL_M4, m5: ALL_M5, config: ALL_CONFIG },
    { m1: ALL_M1, m2: ALL_M2, m3: ALL_M3, m4: ALL_M4, m5: ALL_M5, config: ALL_CONFIG },
    {
      canViewFullPII: true,
      canApproveFinancials: true,
      canManageRoles: true,
      scopeSummary: 'Acceso total al sistema',
    }
  ),
  recepcionista: makePerm(
    ['dashboard', 'm1', 'm2', 'm4', 'm5'],
    ['m1', 'm4', 'm5'],
    {
      m1: ALL_M1,
      m2: ['estado_habitaciones'],
      m4: ['folios', 'pagos'],
      m5: ['perfil_360', 'solicitudes'],
    },
    {
      m1: ALL_M1,
      m2: [],
      m4: ['pagos'],
      m5: ['solicitudes'],
    },
    {
      canViewFullPII: true,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Recepción y reservas',
    }
  ),
  supervisor_hk: makePerm(
    ['dashboard', 'm2', 'm1', 'm3'],
    ['m2'],
    {
      m2: ['estado_habitaciones', 'limpieza', 'inspeccion', 'personal', 'ia_operativa', 'insumos'],
      m1: ['checkin', 'ocupacion'],
      m3: ['inventario'],
    },
    {
      m2: ['estado_habitaciones', 'limpieza', 'inspeccion', 'insumos'],
      m1: [],
      m3: [],
    },
    {
      canViewFullPII: false,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Supervisión de limpieza',
    }
  ),
  limpieza: makePerm(
    ['dashboard', 'm2'],
    ['m2'],
    {
      m2: ['limpieza', 'estado_habitaciones'],
    },
    {
      m2: ['limpieza'],
    },
    {
      canViewFullPII: false,
      canApproveFinancials: false,
      canManageRoles: false,
      onlyAssignedTasks: true,
      scopeSummary: 'Personal de limpieza',
    }
  ),
  tecnico: makePerm(
    ['dashboard', 'm2', 'm3'],
    ['m2'],
    {
      m2: ['estado_habitaciones', 'incidencias', 'mant_correctivo', 'mant_preventivo', 'activos', 'insumos', 'ia_operativa'],
      m3: ['inventario'],
    },
    {
      m2: ['incidencias', 'mant_correctivo', 'mant_preventivo', 'insumos'],
      m3: [],
    },
    {
      canViewFullPII: false,
      canApproveFinancials: false,
      canManageRoles: false,
      onlyAssignedTasks: true,
      scopeSummary: 'Mantenimiento técnico',
    }
  ),
  admin_servicios: makePerm(
    ['dashboard', 'm3', 'm1', 'm4'],
    ['m3'],
    {
      m3: ALL_M3,
      m1: ['ocupacion'],
      m4: ['reportes'],
    },
    {
      m3: ALL_M3,
      m1: [],
      m4: [],
    },
    {
      canViewFullPII: false,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Administración de servicios',
    }
  ),
  pos: makePerm(
    ['dashboard', 'm3', 'm1', 'm4'],
    ['m3'],
    {
      m3: ['pos', 'restaurante', 'room_service', 'minibar', 'servicios_comp', 'productos', 'servicios'],
      m1: ['ocupacion', 'checkout'],
      m4: ['folios'],
    },
    {
      m3: ['pos', 'restaurante', 'room_service', 'minibar', 'servicios_comp'],
      m1: [],
      m4: [],
    },
    {
      canViewFullPII: false,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Restaurante y POS',
    }
  ),
  almacen: makePerm(
    ['dashboard', 'm3', 'm2', 'm4'],
    ['m3'],
    {
      m3: ['inventario', 'proveedores', 'recetas', 'ia_demanda'],
      m2: ['insumos'],
      m4: ['gastos'],
    },
    {
      m3: ['inventario', 'recetas'],
      m2: [],
      m4: [],
    },
    {
      canViewFullPII: false,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Almacén e inventario',
    }
  ),
  compras: makePerm(
    ['dashboard', 'm3', 'm4'],
    ['m3'],
    {
      m3: ['proveedores', 'inventario', 'ia_demanda'],
      m4: ['gastos', 'costos'],
    },
    {
      m3: ['proveedores'],
      m4: [],
    },
    {
      canViewFullPII: false,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Compras y proveedores',
    }
  ),
  cajero: makePerm(
    ['dashboard', 'm4', 'm1'],
    ['m4'],
    {
      m4: ['folios', 'facturacion', 'pagos', 'caja', 'sunat'],
      m1: ['checkout', 'ocupacion'],
    },
    {
      m4: ['folios', 'facturacion', 'pagos', 'caja'],
      m1: [],
    },
    {
      canViewFullPII: true,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Caja y facturación',
    }
  ),
  costos: makePerm(
    ['dashboard', 'm4', 'm3'],
    ['m4'],
    {
      m4: ['gastos', 'costos', 'reportes'],
      m3: ['proveedores', 'inventario', 'recetas', 'ia_demanda'],
    },
    {
      m4: ['gastos', 'costos'],
      m3: [],
    },
    {
      canViewFullPII: false,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Control de costos',
    }
  ),
  jefe_finanzas: makePerm(
    ['dashboard', 'm4', 'm1', 'm3'],
    ['m4'],
    {
      m4: ALL_M4,
      m1: ['reservas', 'tarifas', 'ocupacion'],
      m3: ['proveedores', 'inventario', 'productos'],
    },
    {
      m4: ['folios', 'facturacion', 'pagos', 'cxc', 'gastos', 'costos'],
      m1: [],
      m3: [],
    },
    {
      canViewFullPII: true,
      canApproveFinancials: true,
      canManageRoles: false,
      scopeSummary: 'Jefatura financiera',
    }
  ),
  gerente_finanzas: makePerm(
    ['dashboard', 'm4', 'm1', 'm3'],
    ['m4'],
    {
      m4: ALL_M4,
      m1: ['ia_tarifas', 'ocupacion', 'tarifas'],
      m3: ['ia_demanda', 'inventario', 'proveedores'],
    },
    {
      m4: ALL_M4,
      m1: [],
      m3: [],
    },
    {
      canViewFullPII: true,
      canApproveFinancials: true,
      canManageRoles: false,
      scopeSummary: 'Gerencia financiera',
    }
  ),
  atencion: makePerm(
    ['dashboard', 'm5', 'm1', 'm2', 'm4'],
    ['m5', 'm2'],
    {
      m5: ['perfil_360', 'reclamos', 'solicitudes', 'encuestas', 'resenas', 'portal_ia', 'ia_conversacional'],
      m1: ['reservas', 'huespedes'],
      m2: ['incidencias'],
      m4: ['folios'],
    },
    {
      m5: ['reclamos', 'solicitudes', 'encuestas', 'resenas', 'portal_ia', 'ia_conversacional'],
      m2: ['incidencias'],
      m1: [],
      m4: [],
    },
    {
      canViewFullPII: true,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Atención al huésped',
    }
  ),
  comercial: makePerm(
    ['dashboard', 'm5', 'm1', 'm4'],
    ['m5'],
    {
      m5: ['perfil_360', 'segmentacion', 'fidelizacion', 'campanas', 'encuestas', 'resenas', 'ia_conversacional'],
      m1: ['ocupacion', 'tarifas', 'reservas'],
      m4: ['reportes'],
    },
    {
      m5: ['segmentacion', 'fidelizacion', 'campanas', 'resenas', 'ia_conversacional'],
      m1: [],
      m4: [],
    },
    {
      canViewFullPII: true,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Gestión comercial',
    }
  ),
  auditor: makePerm(
    ['dashboard', 'm1', 'm2', 'm3', 'm4', 'm5', 'config'],
    [],
    { m1: ALL_M1, m2: ALL_M2, m3: ALL_M3, m4: ALL_M4, m5: ALL_M5, config: ALL_CONFIG },
    {},
    {
      canViewFullPII: false,
      canApproveFinancials: false,
      canManageRoles: false,
      scopeSummary: 'Auditoría de solo lectura',
    }
  ),
};

function mapTabArray(mod: ModuleKey, tabs: string[] | undefined): string[] {
  if (!Array.isArray(tabs)) return [];
  const mapping = LEGACY_TAB_MAP[mod] || {};
  const result: string[] = [];
  for (const t of tabs) {
    const mapped = mapping[t] || t;
    if (!result.includes(mapped)) result.push(mapped);
  }
  return result;
}

function normalizePermissions(role: RoleId, perms: RolePermissions): { normalized: RolePermissions; changed: boolean } {
  if (role === 'admin') {
    const fresh = structuredClone(DEFAULT_ROLE_PERMISSIONS.admin);
    return {
      normalized: fresh,
      changed: JSON.stringify(fresh) !== JSON.stringify(perms),
    };
  }

  const next = structuredClone(perms);
  let changed = false;

  (['m1', 'm2', 'm3', 'm4', 'm5', 'config'] as OperationalModuleKey[]).forEach((mod) => {
    if (next.allowedTabs?.[mod]) {
      const mapped = mapTabArray(mod, next.allowedTabs[mod]);
      if (JSON.stringify(mapped) !== JSON.stringify(next.allowedTabs[mod])) {
        next.allowedTabs[mod] = mapped;
        changed = true;
      }
    }
    if (next.editableTabs?.[mod]) {
      const mapped = mapTabArray(mod, next.editableTabs[mod]);
      if (JSON.stringify(mapped) !== JSON.stringify(next.editableTabs[mod])) {
        next.editableTabs[mod] = mapped;
        changed = true;
      }
    }
  });

  if (role === 'supervisor_hk' && next.allowedTabs?.m2 && !next.allowedTabs.m2.includes('personal')) {
    next.allowedTabs.m2.push('personal');
    changed = true;
  }
  if (role === 'auditor' && next.allowedTabs?.m2 && !next.allowedTabs.m2.includes('personal')) {
    next.allowedTabs.m2.push('personal');
    changed = true;
  }
  if (role === 'tecnico' && next.allowedTabs?.m2 && !next.allowedTabs.m2.includes('ia_operativa')) {
    next.allowedTabs.m2.push('ia_operativa');
    changed = true;
  }
  if ((role === 'admin_servicios' || role === 'auditor' || role === 'pos') && next.allowedTabs?.m3 && !next.allowedTabs.m3.includes('servicios')) {
    next.allowedTabs.m3.push('servicios');
    changed = true;
  }
  if (role === 'admin_servicios' && next.editableTabs?.m3 && !next.editableTabs.m3.includes('servicios')) {
    next.editableTabs.m3.push('servicios');
    changed = true;
  }

  if ((role === 'jefe_finanzas' || role === 'gerente_finanzas' || role === 'auditor') && next.allowedTabs?.m4 && !next.allowedTabs.m4.includes('ia_financiera')) {
    next.allowedTabs.m4.push('ia_financiera');
    changed = true;
  }
  if (role === 'gerente_finanzas' && next.editableTabs?.m4 && !next.editableTabs.m4.includes('ia_financiera')) {
    next.editableTabs.m4.push('ia_financiera');
    changed = true;
  }
  if ((role === 'atencion' || role === 'comercial' || role === 'auditor') && next.allowedTabs?.m5 && !next.allowedTabs.m5.includes('ia_conversacional')) {
    next.allowedTabs.m5.push('ia_conversacional');
    changed = true;
  }
  if ((role === 'atencion' || role === 'comercial') && next.editableTabs?.m5 && !next.editableTabs.m5.includes('ia_conversacional')) {
    next.editableTabs.m5.push('ia_conversacional');
    changed = true;
  }

  if (next.allowedTabs?.config?.includes('supabase')) {
    next.allowedTabs.config = next.allowedTabs.config.filter((t) => t !== 'supabase');
    changed = true;
  }
  if (next.editableTabs?.config?.includes('supabase')) {
    next.editableTabs.config = next.editableTabs.config.filter((t) => t !== 'supabase');
    changed = true;
  }

  if (next.view.includes('config') && (!next.allowedTabs.config || next.allowedTabs.config.length === 0)) {
    next.allowedTabs.config = [...ALL_CONFIG];
    changed = true;
  }

  return { normalized: next, changed };
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 horas
const VALID_ROLES = new Set<RoleId>(Object.keys(DEFAULT_ROLE_PERMISSIONS) as RoleId[]);

let dbInitialized = false;
export function ensureAuthDatabase(): void {
  if (!dbInitialized) {
    initDatabase(DEFAULT_ROLE_PERMISSIONS);
    const db = getDb();
    const rows = db.prepare('SELECT role, permissions_json FROM role_permissions').all() as Array<{
      role: RoleId;
      permissions_json: string;
    }>;
    const nowIso = new Date().toISOString();
    const updateStmt = db.prepare('UPDATE role_permissions SET permissions_json = ?, updated_at = ? WHERE role = ?');
    for (const row of rows) {
      if (!VALID_ROLES.has(row.role)) continue;
      const parsed = JSON.parse(row.permissions_json) as RolePermissions;
      const { normalized, changed } = normalizePermissions(row.role, parsed);
      if (changed) {
        updateStmt.run(JSON.stringify(normalized), nowIso, row.role);
      }
    }
    dbInitialized = true;
  }
}

function rowToPublicUser(row: DbUserRow): UserAccount {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    roleLabel: row.role_label,
    department: row.department,
    shift: row.shift,
    ...(row.assigned_staff_id ? { assignedStaffId: row.assigned_staff_id } : {}),
    ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
  };
}

function getPermissionsForRoleFromDb(role: RoleId): RolePermissions {
  ensureAuthDatabase();
  const db = getDb();
  const row = db
    .prepare('SELECT permissions_json FROM role_permissions WHERE role = ?')
    .get(role) as { permissions_json: string } | undefined;
  if (!row) {
    return structuredClone(DEFAULT_ROLE_PERMISSIONS[role]);
  }
  return JSON.parse(row.permissions_json) as RolePermissions;
}

export function authenticateUser(
  email: string,
  password: string
): { ok: true; token: string; user: UserAccount; permissions: RolePermissions } | { ok: false; error: string } {
  ensureAuthDatabase();
  const db = getDb();
  const normalized = email.trim().toLowerCase().replace(/@hotel\.demo$/, '@hotelazure.pe');
  const found = db
    .prepare('SELECT * FROM users WHERE lower(email) = ? AND active = 1')
    .get(normalized) as DbUserRow | undefined;

  if (!found) {
    return { ok: false, error: 'Correo electrónico o contraseña incorrectos.' };
  }

  const candidateHex = hashPassword(password, found.salt);
  const candidateBuf = Buffer.from(candidateHex, 'hex');
  const storedBuf = Buffer.from(found.password_hash, 'hex');
  if (candidateBuf.length !== storedBuf.length || !crypto.timingSafeEqual(candidateBuf, storedBuf)) {
    return { ok: false, error: 'Correo electrónico o contraseña incorrectos.' };
  }

  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    found.id,
    now,
    now + SESSION_TTL_MS
  );

  return {
    ok: true,
    token,
    user: rowToPublicUser(found),
    permissions: getPermissionsForRoleFromDb(found.role),
  };
}

export function getSessionContext(token: string | null | undefined): {
  user: UserAccount;
  permissions: RolePermissions;
} | null {
  if (!token) return null;
  ensureAuthDatabase();
  const db = getDb();
  const session = db
    .prepare('SELECT token, user_id, expires_at FROM sessions WHERE token = ?')
    .get(token) as { token: string; user_id: string; expires_at: number } | undefined;

  if (!session) return null;
  if (Date.now() > session.expires_at) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }

  const found = db
    .prepare('SELECT * FROM users WHERE id = ? AND active = 1')
    .get(session.user_id) as DbUserRow | undefined;
  if (!found) return null;

  return {
    user: rowToPublicUser(found),
    permissions: getPermissionsForRoleFromDb(found.role),
  };
}

export function destroySession(token: string | null | undefined): void {
  if (!token) return;
  ensureAuthDatabase();
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function getAllRolePermissions(): Record<RoleId, RolePermissions> {
  ensureAuthDatabase();
  const db = getDb();
  const rows = db.prepare('SELECT role, permissions_json FROM role_permissions').all() as Array<{
    role: RoleId;
    permissions_json: string;
  }>;
  const result = structuredClone(DEFAULT_ROLE_PERMISSIONS);
  for (const row of rows) {
    if (VALID_ROLES.has(row.role)) {
      result[row.role] = JSON.parse(row.permissions_json) as RolePermissions;
    }
  }
  return result;
}

export function isValidRoleId(role: string): role is RoleId {
  return VALID_ROLES.has(role as RoleId);
}

export function updateServerRolePermissions(role: RoleId, next: RolePermissions): Record<RoleId, RolePermissions> {
  ensureAuthDatabase();
  if (!VALID_ROLES.has(role) || role === 'admin') {
    return getAllRolePermissions();
  }
  const db = getDb();
  db.prepare(
    'INSERT INTO role_permissions (role, permissions_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(role) DO UPDATE SET permissions_json = excluded.permissions_json, updated_at = excluded.updated_at'
  ).run(role, JSON.stringify(next), new Date().toISOString());
  return getAllRolePermissions();
}

export function listPublicDirectory(): Array<{ name: string; email: string; role: RoleId; roleLabel: string; department: string }> {
  ensureAuthDatabase();
  const db = getDb();
  const rows = db
    .prepare('SELECT name, email, role, role_label, department FROM users WHERE active = 1 ORDER BY id ASC')
    .all() as Array<{
      name: string;
      email: string;
      role: RoleId;
      role_label: string;
      department: string;
    }>;
  return rows.map((u) => ({
    name: u.name,
    email: u.email,
    role: u.role,
    roleLabel: u.role_label,
    department: u.department,
  }));
}

export function getDatabaseStats(): { usersCount: number; rolesCount: number } {
  ensureAuthDatabase();
  const db = getDb();
  const u = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE active = 1').get() as { cnt: number };
  const r = db.prepare('SELECT COUNT(*) as cnt FROM role_permissions').get() as { cnt: number };
  return { usersCount: u.cnt, rolesCount: r.cnt };
}

export function extractTokenFromRequest(headers: Record<string, string | string[] | undefined>): string | null {
  const auth = headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  const cookieHeader = headers['cookie'];
  if (typeof cookieHeader === 'string') {
    const parts = cookieHeader.split(';').map((p) => p.trim());
    for (const part of parts) {
      if (part.startsWith('sgh_erp_session=')) {
        return decodeURIComponent(part.slice('sgh_erp_session='.length));
      }
    }
  }
  return null;
}
