/**
 * Etiquetas y helpers RBAC en el cliente (Vanilla JS).
 * La autenticación y la matriz autoritativa residen en el servidor (/api/auth/*).
 */
export const ROLE_LABELS = {
  admin: 'Administrador del sistema',
  recepcionista: 'Recepcionista',
  supervisor_hk: 'Supervisor de Housekeeping',
  limpieza: 'Personal de limpieza',
  tecnico: 'Técnico de mantenimiento',
  admin_servicios: 'Administrador de Servicios',
  pos: 'Personal de Restaurante / POS',
  almacen: 'Responsable de Almacén',
  compras: 'Responsable de Compras',
  cajero: 'Cajero',
  costos: 'Responsable de Costos',
  jefe_finanzas: 'Jefe de Finanzas',
  gerente_finanzas: 'Gerente Financiero',
  atencion: 'Agente de Atención',
  comercial: 'Administrador Comercial',
  auditor: 'Auditor',
};

export const ALL_ROLE_IDS = Object.keys(ROLE_LABELS);

export function canViewModuleWithPerms(perms, mod) {
  if (!perms) return false;
  return perms.view.includes(mod);
}

export function canEditModuleWithPerms(perms, mod) {
  if (!perms) return false;
  return perms.edit.includes(mod);
}

export function canViewTabWithPerms(perms, mod, tabId) {
  if (!perms || !perms.view.includes(mod)) return false;
  const allowed = perms.allowedTabs?.[mod];
  if (!allowed) return false;
  return allowed.includes(tabId);
}

export function canEditTabWithPerms(perms, mod, tabId) {
  if (!perms || !perms.edit.includes(mod)) return false;
  const editable = perms.editableTabs?.[mod];
  if (!editable) return false;
  return editable.includes(tabId);
}

export function getDefaultTabForModule(perms, mod) {
  const allowed = perms?.allowedTabs?.[mod];
  return allowed && allowed.length > 0 ? allowed[0] : null;
}

/**
 * Minimización y enmascaramiento de PII según rol autorizado
 */
export function maskDocument(doc, canViewFullPII) {
  if (canViewFullPII || !doc || doc.length <= 4) return doc || '';
  return `${'•'.repeat(Math.max(2, doc.length - 3))}${doc.slice(-3)}`;
}

export function maskEmail(email, canViewFullPII) {
  if (canViewFullPII) return email || '';
  const [user, domain] = String(email || '').split('@');
  if (!domain) return '•••';
  return `${user.slice(0, 2)}•••@${domain}`;
}

export function maskPhone(phone, canViewFullPII) {
  if (canViewFullPII || !phone || phone.length <= 4) return phone || '';
  return `${'•'.repeat(Math.max(4, phone.length - 3))}${phone.slice(-3)}`;
}
