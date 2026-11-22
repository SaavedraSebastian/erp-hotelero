/**
 * Mapa temporal de compatibilidad desde los identificadores legados del frontend
 * hacia el catálogo oficial normalizado de la migración 06_catalogo_rbac_inicial.sql.
 *
 * Para M3 se utilizan exactamente los 7 códigos oficiales aprobados:
 * - ADMIN_SERVICIOS
 * - ATENCION_SERVICIOS
 * - SUPERVISOR_SERVICIOS
 * - RESTAURANTE
 * - COCINA
 * - RESPONSABLE_ALMACEN
 * - RESPONSABLE_COMPRAS
 */
export const OFFICIAL_M3_ROLES = [
  'ADMIN_SERVICIOS',
  'ATENCION_SERVICIOS',
  'SUPERVISOR_SERVICIOS',
  'RESTAURANTE',
  'COCINA',
  'RESPONSABLE_ALMACEN',
  'RESPONSABLE_COMPRAS',
] as const;

export const LEGACY_TO_OFFICIAL_ROLE_MAP: Readonly<Record<string, string>> = Object.freeze({
  // M3 (mapa temporal obligatorio desde nombres antiguos del frontend)
  admin: 'ADMIN_SISTEMA',
  admin_servicios: 'ADMIN_SERVICIOS',
  atencion: 'ATENCION_SERVICIOS',
  supervisor: 'SUPERVISOR_SERVICIOS',
  restaurante: 'RESTAURANTE',
  pos: 'RESTAURANTE',
  cocina: 'COCINA',
  almacen: 'RESPONSABLE_ALMACEN',
  compras: 'RESPONSABLE_COMPRAS',

  // Resto de módulos (compatibilidad temporal hasta cargar 06_catalogo_rbac_inicial.sql)
  recepcionista: 'RECEPCIONISTA',
  supervisor_hk: 'SUPERVISOR_HOUSEKEEPING',
  limpieza: 'PERSONAL_LIMPIEZA',
  tecnico: 'TECNICO_MANTENIMIENTO',
  cajero: 'CAJERO',
  costos: 'RESPONSABLE_COSTOS',
  jefe_finanzas: 'JEFE_FINANZAS',
  gerente_finanzas: 'GERENTE_FINANCIERO',
  comercial: 'ADMINISTRADOR_COMERCIAL',
  auditor: 'AUDITOR',
});

export function mapLegacyRoleToOfficial(roleCode: string): string {
  const clean = roleCode.trim();
  const lower = clean.toLowerCase();
  return LEGACY_TO_OFFICIAL_ROLE_MAP[lower] ?? clean.toUpperCase();
}
