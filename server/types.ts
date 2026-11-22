export type RoleId =
  | 'admin'
  | 'recepcionista'
  | 'supervisor_hk'
  | 'limpieza'
  | 'tecnico'
  | 'admin_servicios'
  | 'pos'
  | 'almacen'
  | 'compras'
  | 'cajero'
  | 'costos'
  | 'jefe_finanzas'
  | 'gerente_finanzas'
  | 'atencion'
  | 'comercial'
  | 'auditor';

export type ModuleKey = 'dashboard' | 'm1' | 'm2' | 'm3' | 'm4' | 'm5' | 'config';
export type OperationalModuleKey = 'm1' | 'm2' | 'm3' | 'm4' | 'm5' | 'config';
export type SubmoduleMap = Partial<Record<OperationalModuleKey, string[]>>;

export interface RolePermissions {
  view: ModuleKey[];
  edit: ModuleKey[];
  allowedTabs: SubmoduleMap;
  editableTabs: SubmoduleMap;
  canViewFullPII: boolean;
  canApproveFinancials: boolean;
  canManageRoles: boolean;
  scopeSummary: string;
  onlyAssignedTasks?: boolean;
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  role: RoleId;
  roleLabel: string;
  department: string;
  shift: string;
  avatarUrl?: string;
  assignedStaffId?: string;
}
