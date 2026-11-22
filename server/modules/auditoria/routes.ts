import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateJwt } from '../../middleware/authenticate.ts';
import { requirePermission } from '../../middleware/authorize.ts';
import { validateQuery } from '../../middleware/validate.ts';
import { withReadOnlyClient } from '../../shared/database/transaction.ts';
import { buildPaginatedResponse, paginationQuerySchema, parsePagination } from '../../shared/pagination/index.ts';
import type { AuthContext } from '../../shared/types/context.ts';
import { PERMISSIONS } from '../seguridad/permissions.ts';

const bitacoraQuerySchema = paginationQuerySchema.extend({
  modulo: z.enum(['ALL', 'M1', 'M2', 'M3', 'M4', 'M5']).default('ALL'),
});

export interface BitacoraEntry {
  id: string;
  modulo: 'M1' | 'M2' | 'M3' | 'M4' | 'M5';
  fuente: string;
  fechaHora: string;
  usuario: string;
  accion: string;
  entidadRef: string;
  detalle: string | null;
  impactoPrivacidad: boolean;
}

const UNIFIED_BITACORA_CTE = `
WITH bitacoras AS (
  SELECT
    'G1-HRES-' || h.id_historial_reserva::text AS id,
    'M1'::text AS modulo,
    'g1_reservas.historial_reserva'::text AS fuente,
    h.fecha_hora AS sort_ts,
    h.fecha_hora::text AS fecha_hora,
    h.usuario::text AS usuario,
    h.accion::text AS accion,
    'reserva:' || h.id_reserva::text AS entidad_ref,
    h.modulo_origen::text AS detalle,
    FALSE AS impacto_privacidad
  FROM g1_reservas.historial_reserva h

  UNION ALL

  SELECT
    'G2-HAB-' || c.id_cambio::text AS id,
    'M2'::text AS modulo,
    'g2_housekeeping.cambio_estado_habitacion'::text AS fuente,
    c.fecha_hora AS sort_ts,
    c.fecha_hora::text AS fecha_hora,
    COALESCE(c.id_personal::text, c.origen)::text AS usuario,
    ('Cambio estado ' || COALESCE(c.id_estado_anterior, '-') || ' -> ' || c.id_estado_nuevo)::text AS accion,
    'habitacion:' || c.id_habitacion::text AS entidad_ref,
    c.motivo::text AS detalle,
    FALSE AS impacto_privacidad
  FROM g2_housekeeping.cambio_estado_habitacion c

  UNION ALL

  SELECT
    'G2-INT-' || ri.id_registro::text AS id,
    'M2'::text AS modulo,
    'g2_housekeeping.registro_integracion'::text AS fuente,
    ri.fecha_hora AS sort_ts,
    ri.fecha_hora::text AS fecha_hora,
    ri.modulo_contraparte::text AS usuario,
    (ri.servicio || ' (' || ri.resultado || ')')::text AS accion,
    ri.id_correlacion::text AS entidad_ref,
    ri.detalle_error::text AS detalle,
    FALSE AS impacto_privacidad
  FROM g2_housekeeping.registro_integracion ri

  UNION ALL

  SELECT
    'G3-ACC-' || ria.id_intento::text AS id,
    'M3'::text AS modulo,
    'g3_servicios.registro_intento_acceso'::text AS fuente,
    ria.fecha_hora::timestamptz AS sort_ts,
    ria.fecha_hora::text AS fecha_hora,
    ria.usuario_aplicacion::text AS usuario,
    ('Acceso denegado: ' || ria.operacion)::text AS accion,
    (ria.recurso || COALESCE(':' || ria.id_recurso, ''))::text AS entidad_ref,
    ria.motivo_denegacion::text AS detalle,
    TRUE AS impacto_privacidad
  FROM g3_servicios.registro_intento_acceso ria

  UNION ALL

  SELECT
    'G3-ENV-' || ee.id_envio::text AS id,
    'M3'::text AS modulo,
    'g3_servicios.envio_externo'::text AS fuente,
    ee.fecha_hora_intento::timestamptz AS sort_ts,
    ee.fecha_hora_intento::text AS fecha_hora,
    ee.usuario_creacion::text AS usuario,
    (ee.tipo_envio || ' -> ' || ee.destino || ' [' || ee.estado || ']')::text AS accion,
    ee.id_referencia::text AS entidad_ref,
    ee.motivo_rechazo::text AS detalle,
    FALSE AS impacto_privacidad
  FROM g3_servicios.envio_externo ee

  UNION ALL

  SELECT
    'G4-HC-' || hc.id_historial::text AS id,
    'M4'::text AS modulo,
    'g4_finanzas.historial_cuenta'::text AS fuente,
    hc.fecha_hora::timestamptz AS sort_ts,
    hc.fecha_hora::text AS fecha_hora,
    ('usuario:' || hc.id_usuario::text)::text AS usuario,
    hc.tipo_movimiento::text AS accion,
    'cuenta:' || hc.id_cuenta::text AS entidad_ref,
    hc.motivo::text AS detalle,
    FALSE AS impacto_privacidad
  FROM g4_finanzas.historial_cuenta hc

  UNION ALL

  SELECT
    'G5-AUD-' || la.id_log::text AS id,
    'M5'::text AS modulo,
    'g5_crm.log_auditoria'::text AS fuente,
    la.fecha_hora::timestamptz AS sort_ts,
    la.fecha_hora::text AS fecha_hora,
    COALESCE(la.usuario_app, la.usuario_bd)::text AS usuario,
    (la.operacion || ' en ' || la.tabla)::text AS accion,
    (la.tabla || COALESCE(':' || la.id_registro, ''))::text AS entidad_ref,
    NULL::text AS detalle,
    (la.operacion = 'CONSULTA' OR la.tabla = 'perfil_huesped') AS impacto_privacidad
  FROM g5_crm.log_auditoria la
)
`;

export async function listBitacorasPorModulo(
  ctx: AuthContext,
  modulo: 'ALL' | 'M1' | 'M2' | 'M3' | 'M4' | 'M5',
  page: number,
  pageSize: number
) {
  const offset = (page - 1) * pageSize;
  const { rows, total } = await withReadOnlyClient(async (client) => {
    const countRes = await client.query<{ total: string }>(
      `${UNIFIED_BITACORA_CTE}
       SELECT COUNT(*)::text AS total
       FROM bitacoras
       WHERE ($1 = 'ALL' OR modulo = $1)`,
      [modulo]
    );
    const dataRes = await client.query<{
      id: string;
      modulo: 'M1' | 'M2' | 'M3' | 'M4' | 'M5';
      fuente: string;
      fecha_hora: string;
      usuario: string;
      accion: string;
      entidad_ref: string;
      detalle: string | null;
      impacto_privacidad: boolean;
    }>(
      `${UNIFIED_BITACORA_CTE}
       SELECT id, modulo, fuente, fecha_hora, usuario, accion, entidad_ref, detalle, impacto_privacidad
       FROM bitacoras
       WHERE ($1 = 'ALL' OR modulo = $1)
       ORDER BY sort_ts DESC
       LIMIT $2 OFFSET $3`,
      [modulo, pageSize, offset]
    );
    return {
      total: Number(countRes.rows[0]?.total ?? 0),
      rows: dataRes.rows.map((r): BitacoraEntry => ({
        id: r.id,
        modulo: r.modulo,
        fuente: r.fuente,
        fechaHora: r.fecha_hora,
        usuario: r.usuario,
        accion: r.accion,
        entidadRef: r.entidad_ref,
        detalle: r.detalle,
        impactoPrivacidad: r.impacto_privacidad,
      })),
    };
  }, ctx);

  return {
    ...buildPaginatedResponse(rows, total, page, pageSize),
    tituloModulo: 'Bitácoras por módulo',
    notaArquitectura:
      'Consolidado en lectura desde las bitácoras nativas de g1_reservas, g2_housekeeping, g3_servicios, g4_finanzas y g5_crm.',
  };
}

export function createAuditoriaRouter(): Router {
  const router = Router();
  router.use(authenticateJwt);

  router.get(
    '/bitacoras',
    requirePermission(PERMISSIONS.AUDITORIA_CONSULTAR),
    validateQuery(bitacoraQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const pagination = parsePagination(req.query as Record<string, unknown>);
        const modulo = ((req.query.modulo as string | undefined)?.toUpperCase() || 'ALL') as
          | 'ALL'
          | 'M1'
          | 'M2'
          | 'M3'
          | 'M4'
          | 'M5';
        res.json(await listBitacorasPorModulo(req.authContext!, modulo, pagination.page, pagination.pageSize));
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
