import { Router } from 'express';
import { authenticateJwt } from '../../middleware/authenticate.ts';
import { requirePermission } from '../../middleware/authorize.ts';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';
import { paginationQuerySchema } from '../../shared/pagination/index.ts';
import { PERMISSIONS } from '../seguridad/permissions.ts';
import * as ctrl from './controller.ts';
import {
  assignCleaningOrderBodySchema,
  changeRoomStateBodySchema,
  closeWorkOrderBodySchema,
  createCleaningOrderBodySchema,
  createIncidentBodySchema,
  createInspectionBodySchema,
  createWorkOrderBodySchema,
  m2IdParamSchema,
  supplyMovementBodySchema,
  waitWorkOrderBodySchema,
} from './schemas.ts';

export function createM2Router(): Router {
  const router = Router();
  router.use(authenticateJwt);

  router.get('/estados-habitacion', requirePermission(PERMISSIONS.M2_ESTADO_CONSULTAR), ctrl.listEstadosHabitacion);
  router.post(
    '/habitaciones/:id/cambio-estado',
    requirePermission(PERMISSIONS.M2_ESTADO_ACTUALIZAR),
    validateParams(m2IdParamSchema),
    validateBody(changeRoomStateBodySchema),
    ctrl.cambiarEstadoHabitacion
  );

  router.get(
    '/ordenes-limpieza',
    requirePermission(PERMISSIONS.M2_LIMPIEZA_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listOrdenesLimpieza
  );
  router.post(
    '/ordenes-limpieza',
    requirePermission(PERMISSIONS.M2_LIMPIEZA_CREAR),
    validateBody(createCleaningOrderBodySchema),
    ctrl.createOrdenLimpieza
  );
  router.post(
    '/ordenes-limpieza/:id/asignar',
    requirePermission(PERMISSIONS.M2_LIMPIEZA_ASIGNAR),
    validateParams(m2IdParamSchema),
    validateBody(assignCleaningOrderBodySchema),
    ctrl.asignarOrdenLimpieza
  );
  router.post(
    '/ordenes-limpieza/:id/iniciar',
    requirePermission(PERMISSIONS.M2_LIMPIEZA_EJECUTAR),
    validateParams(m2IdParamSchema),
    ctrl.iniciarOrdenLimpieza
  );
  router.post(
    '/ordenes-limpieza/:id/finalizar',
    requirePermission(PERMISSIONS.M2_LIMPIEZA_EJECUTAR),
    validateParams(m2IdParamSchema),
    ctrl.finalizarOrdenLimpieza
  );

  router.post(
    '/inspecciones',
    requirePermission(PERMISSIONS.M2_INSPECCION_REGISTRAR),
    validateBody(createInspectionBodySchema),
    ctrl.registrarInspeccion
  );

  router.get(
    '/incidencias',
    requirePermission(PERMISSIONS.M2_MANTENIMIENTO_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listIncidencias
  );
  router.post(
    '/incidencias',
    requirePermission(PERMISSIONS.M2_MANTENIMIENTO_CREAR),
    validateBody(createIncidentBodySchema),
    ctrl.createIncidencia
  );

  router.get(
    '/ordenes-trabajo',
    requirePermission(PERMISSIONS.M2_MANTENIMIENTO_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listOrdenesTrabajo
  );
  router.post(
    '/ordenes-trabajo',
    requirePermission(PERMISSIONS.M2_MANTENIMIENTO_CREAR),
    validateBody(createWorkOrderBodySchema),
    ctrl.createOrdenTrabajo
  );
  router.post(
    '/ordenes-trabajo/:id/espera',
    requirePermission(PERMISSIONS.M2_MANTENIMIENTO_CREAR),
    validateParams(m2IdParamSchema),
    validateBody(waitWorkOrderBodySchema),
    ctrl.ponerOtEnEspera
  );
  router.post(
    '/ordenes-trabajo/:id/cerrar',
    requirePermission(PERMISSIONS.M2_MANTENIMIENTO_CERRAR),
    validateParams(m2IdParamSchema),
    validateBody(closeWorkOrderBodySchema),
    ctrl.cerrarOrdenTrabajo
  );

  router.get('/insumos', requirePermission(PERMISSIONS.M2_INSUMO_CONSULTAR), ctrl.listInsumos);
  router.post(
    '/insumos/movimientos',
    requirePermission(PERMISSIONS.M2_INSUMO_MOVER),
    validateBody(supplyMovementBodySchema),
    ctrl.registrarMovimientoInsumo
  );

  return router;
}
