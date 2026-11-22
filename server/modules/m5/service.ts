import { withReadOnlyClient, withTransaction } from '../../shared/database/transaction.ts';
import { buildPaginatedResponse } from '../../shared/pagination/index.ts';
import { maskDocument, maskEmail, maskPhone } from '../../shared/privacy/masking.ts';
import type { AuthContext, PaginationParams } from '../../shared/types/context.ts';
import * as repo from './repository.ts';

function sanitizePerfilPii(row: repo.PerfilHuespedRow, canViewFullPII: boolean): repo.PerfilHuespedRow {
  if (canViewFullPII) return row;
  return {
    ...row,
    numero_documento: maskDocument(row.numero_documento, false),
    correo: row.correo ? maskEmail(row.correo, false) : null,
    telefono: row.telefono ? maskPhone(row.telefono, false) : null,
  };
}

export async function getPerfilesService(ctx: AuthContext, pagination: PaginationParams) {
  const offset = (pagination.page - 1) * pagination.pageSize;
  const { rows, total } = await withReadOnlyClient(
    (client) => repo.listPerfiles(client, pagination.pageSize, offset, { search: pagination.search, status: pagination.status }),
    ctx
  );
  const masked = rows.map((row) => sanitizePerfilPii(row, ctx.canViewFullPII));
  return buildPaginatedResponse(masked, total, pagination.page, pagination.pageSize);
}

export async function getPerfilDetalleService(ctx: AuthContext, idPerfil: number) {
  // Escribe log_auditoria ('CONSULTA') via g5_crm.registrar_consulta_sensible -> requiere transacción RW
  const detail = await withTransaction(ctx, (client) => repo.getPerfilDetalleAndAuditConsulta(client, idPerfil));
  return {
    ...detail,
    perfil: sanitizePerfilPii(detail.perfil, ctx.canViewFullPII),
  };
}

export async function addPreferenciaService(
  ctx: AuthContext,
  idPerfil: number,
  input: { categoria: string; descripcion: string; origen: string; vigente: boolean }
) {
  return withTransaction(ctx, (client) => repo.addPreferencia(client, idPerfil, input));
}

export async function getSegmentosService(ctx: AuthContext) {
  const rows = await withReadOnlyClient((client) => repo.listSegmentosDistribucion(client), ctx);
  return { items: rows };
}

export async function getFidelizacionPerfilService(ctx: AuthContext, idPerfil: number) {
  return withReadOnlyClient((client) => repo.getFidelizacionPerfil(client, idPerfil), ctx);
}

export async function registrarMovimientoPuntosService(
  ctx: AuthContext,
  input: Parameters<typeof repo.registrarMovimientoPuntos>[1]
) {
  return withTransaction(ctx, (client) => repo.registrarMovimientoPuntos(client, input));
}

export async function getReclamosService(ctx: AuthContext, pagination: PaginationParams) {
  const offset = (pagination.page - 1) * pagination.pageSize;
  const { rows, total } = await withReadOnlyClient(
    (client) => repo.listReclamos(client, pagination.pageSize, offset, { search: pagination.search, status: pagination.status }),
    ctx
  );
  return buildPaginatedResponse(rows, total, pagination.page, pagination.pageSize);
}

export async function createReclamoService(
  ctx: AuthContext,
  input: Parameters<typeof repo.createReclamo>[1]
) {
  return withTransaction(ctx, (client) => repo.createReclamo(client, input));
}

export async function avanzarReclamoService(
  ctx: AuthContext,
  idReclamo: number,
  input: { estado: 'DERIVADO' | 'EN_ATENCION' | 'CERRADO'; idArea?: number | null; observacion?: string | null }
) {
  return withTransaction(ctx, (client) => repo.avanzarReclamo(client, idReclamo, input, ctx.codigoUsuario));
}

export async function solicitarCompensacionService(
  ctx: AuthContext,
  idReclamo: number,
  input: { tipoCompensacion: string; monto: string }
) {
  return withTransaction(ctx, (client) => repo.solicitarCompensacion(client, idReclamo, input));
}

export async function decidirCompensacionService(
  ctx: AuthContext,
  idCompensacion: number,
  input: { estado: 'APROBADA' | 'RECHAZADA' | 'NOTIFICADA' | 'APLICADA' | 'FUERA_DE_PLAZO'; motivoRechazo?: string | null }
) {
  return withTransaction(ctx, (client) => repo.decidirCompensacion(client, idCompensacion, input, ctx.codigoUsuario));
}

export async function getCampanasService(ctx: AuthContext, pagination: PaginationParams) {
  const offset = (pagination.page - 1) * pagination.pageSize;
  const { rows, total } = await withReadOnlyClient(
    (client) => repo.listCampanas(client, pagination.pageSize, offset, { search: pagination.search, status: pagination.status }),
    ctx
  );
  return buildPaginatedResponse(rows, total, pagination.page, pagination.pageSize);
}

export async function createCampanaService(
  ctx: AuthContext,
  input: Parameters<typeof repo.createCampana>[1]
) {
  return withTransaction(ctx, (client) => repo.createCampana(client, input));
}

export async function cambiarEstadoCampanaService(
  ctx: AuthContext,
  idCampana: number,
  estado: 'ACTIVA' | 'CERRADA' | 'CANCELADA'
) {
  return withTransaction(ctx, (client) => repo.cambiarEstadoCampana(client, idCampana, estado));
}

export async function getOpinionesService(ctx: AuthContext, pagination: PaginationParams) {
  const offset = (pagination.page - 1) * pagination.pageSize;
  const { rows, total } = await withReadOnlyClient(
    (client) => repo.listOpiniones(client, pagination.pageSize, offset, { search: pagination.search, status: pagination.status }),
    ctx
  );
  return buildPaginatedResponse(rows, total, pagination.page, pagination.pageSize);
}

export async function createOpinionService(
  ctx: AuthContext,
  input: Parameters<typeof repo.createOpinionConSubtipo>[1]
) {
  return withTransaction(ctx, (client) => repo.createOpinionConSubtipo(client, input));
}

export async function responderOpinionService(ctx: AuthContext, idOpinion: number, respuestaHotel: string) {
  return withTransaction(ctx, (client) => repo.responderResena(client, idOpinion, respuestaHotel, ctx.codigoUsuario));
}

export async function getSolicitudesService(ctx: AuthContext, pagination: PaginationParams) {
  const offset = (pagination.page - 1) * pagination.pageSize;
  const { rows, total } = await withReadOnlyClient(
    (client) => repo.listSolicitudesHuesped(client, pagination.pageSize, offset, { search: pagination.search, status: pagination.status }),
    ctx
  );
  return buildPaginatedResponse(rows, total, pagination.page, pagination.pageSize);
}

export async function createSolicitudService(
  ctx: AuthContext,
  input: Parameters<typeof repo.createSolicitudHuesped>[1]
) {
  return withTransaction(ctx, (client) => repo.createSolicitudHuesped(client, input));
}

export async function updateSolicitudEstadoService(
  ctx: AuthContext,
  idSolicitud: number,
  estado: 'REGISTRADA' | 'DERIVADA' | 'EN_ATENCION' | 'ATENDIDA' | 'CANCELADA',
  notasResolucion?: string | null
) {
  return withTransaction(ctx, (client) =>
    repo.updateSolicitudHuespedEstado(client, idSolicitud, estado, notasResolucion)
  );
}
