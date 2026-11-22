import { Router } from 'express';
import { authenticateJwt } from '../../middleware/authenticate.ts';
import { requirePermission } from '../../middleware/authorize.ts';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';
import { paginationQuerySchema } from '../../shared/pagination/index.ts';
import { PERMISSIONS } from '../seguridad/permissions.ts';
import * as ctrl from './controller.ts';
import {
  avanzarReclamoBodySchema,
  cambiarEstadoCampanaBodySchema,
  createCampanaBodySchema,
  createOpinionBodySchema,
  createPreferenciaBodySchema,
  createPuntosMovimientoBodySchema,
  createReclamoBodySchema,
  createSolicitudHuespedBodySchema,
  decidirCompensacionBodySchema,
  m5IdParamSchema,
  responderOpinionBodySchema,
  solicitarCompensacionBodySchema,
  updateSolicitudEstadoBodySchema,
} from './schemas.ts';

export function createM5Router(): Router {
  const router = Router();
  router.use(authenticateJwt);

  router.get(
    '/perfiles',
    requirePermission(PERMISSIONS.M5_PERFIL_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listPerfiles
  );
  router.get(
    '/perfiles/:id',
    requirePermission(PERMISSIONS.M5_PERFIL_CONSULTAR),
    validateParams(m5IdParamSchema),
    ctrl.getPerfilDetalle
  );
  router.post(
    '/perfiles/:id/preferencias',
    requirePermission(PERMISSIONS.M5_PREFERENCIA_GESTIONAR),
    validateParams(m5IdParamSchema),
    validateBody(createPreferenciaBodySchema),
    ctrl.addPreferencia
  );

  router.get('/segmentos', requirePermission(PERMISSIONS.M5_SEGMENTO_CONSULTAR), ctrl.listSegmentos);

  router.get(
    '/fidelizacion/perfiles/:id',
    requirePermission(PERMISSIONS.M5_FIDELIZACION_CONSULTAR),
    validateParams(m5IdParamSchema),
    ctrl.getFidelizacionPerfil
  );
  router.post(
    '/fidelizacion/movimientos',
    requirePermission(PERMISSIONS.M5_FIDELIZACION_OPERAR),
    validateBody(createPuntosMovimientoBodySchema),
    ctrl.registrarMovimientoPuntos
  );

  router.get(
    '/reclamos',
    requirePermission(PERMISSIONS.M5_RECLAMO_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listReclamos
  );
  router.post(
    '/reclamos',
    requirePermission(PERMISSIONS.M5_RECLAMO_CREAR),
    validateBody(createReclamoBodySchema),
    ctrl.createReclamo
  );
  router.post(
    '/reclamos/:id/avanzar',
    requirePermission(PERMISSIONS.M5_RECLAMO_ATENDER),
    validateParams(m5IdParamSchema),
    validateBody(avanzarReclamoBodySchema),
    ctrl.avanzarReclamo
  );
  router.post(
    '/reclamos/:id/compensaciones',
    requirePermission(PERMISSIONS.M5_COMPENSACION_SOLICITAR),
    validateParams(m5IdParamSchema),
    validateBody(solicitarCompensacionBodySchema),
    ctrl.solicitarCompensacion
  );
  router.post(
    '/compensaciones/:id/decidir',
    requirePermission(PERMISSIONS.M5_COMPENSACION_APROBAR),
    validateParams(m5IdParamSchema),
    validateBody(decidirCompensacionBodySchema),
    ctrl.decidirCompensacion
  );

  router.get(
    '/campanas',
    requirePermission(PERMISSIONS.M5_CAMPANA_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listCampanas
  );
  router.post(
    '/campanas',
    requirePermission(PERMISSIONS.M5_CAMPANA_GESTIONAR),
    validateBody(createCampanaBodySchema),
    ctrl.createCampana
  );
  router.post(
    '/campanas/:id/estado',
    requirePermission(PERMISSIONS.M5_CAMPANA_GESTIONAR),
    validateParams(m5IdParamSchema),
    validateBody(cambiarEstadoCampanaBodySchema),
    ctrl.cambiarEstadoCampana
  );

  router.get(
    '/opiniones',
    requirePermission(PERMISSIONS.M5_OPINION_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listOpiniones
  );
  router.post(
    '/opiniones',
    requirePermission(PERMISSIONS.M5_OPINION_CONSULTAR),
    validateBody(createOpinionBodySchema),
    ctrl.createOpinion
  );
  router.post(
    '/opiniones/:id/responder',
    requirePermission(PERMISSIONS.M5_OPINION_RESPONDER),
    validateParams(m5IdParamSchema),
    validateBody(responderOpinionBodySchema),
    ctrl.responderOpinion
  );

  router.get(
    '/solicitudes',
    requirePermission(PERMISSIONS.M5_SOLICITUD_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listSolicitudes
  );
  router.post(
    '/solicitudes',
    requirePermission(PERMISSIONS.M5_SOLICITUD_CREAR),
    validateBody(createSolicitudHuespedBodySchema),
    ctrl.createSolicitud
  );
  router.patch(
    '/solicitudes/:id/estado',
    requirePermission(PERMISSIONS.M5_SOLICITUD_ATENDER),
    validateParams(m5IdParamSchema),
    validateBody(updateSolicitudEstadoBodySchema),
    ctrl.updateSolicitudEstado
  );

  return router;
}
