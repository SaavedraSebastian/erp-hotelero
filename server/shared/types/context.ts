export interface AuthContext {
  authUserId: string;
  usuarioId: string;
  codigoUsuario: string;
  nombre: string;
  departamento: string;
  turno?: string | null;
  idPersonalG2?: string | null;
  idUsuarioG4?: number | null;
  roles: string[];
  permisos: string[];
  canViewFullPII: boolean;
}

export interface EstablishmentConfig {
  nombreHotel: string;
  nombreComercial: string;
  zonaHoraria: string;
  moneda: string;
  logoUrl: string;
  numeroHabitaciones: number;
  numeroPisos: number;
  direccion: string;
  fechaOperativa: string;
}

export interface PaginationParams {
  page: number;
  pageSize: number;
  search?: string;
  sortBy?: string;
  sortOrder: 'asc' | 'desc';
  fromDate?: string;
  toDate?: string;
  status?: string;
  /** Filtros específicos de Servicios: modalidad de la comanda y punto de venta. */
  modalidad?: string;
  puntoVenta?: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
  summary?: Record<string, unknown>;
}
