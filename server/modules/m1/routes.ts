import { Router } from 'express';
import { authenticateJwt } from '../../middleware/authenticate.ts';
import { requirePermission } from '../../middleware/authorize.ts';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';
import { paginationQuerySchema } from '../../shared/pagination/index.ts';
import { PERMISSIONS } from '../seguridad/permissions.ts';
import * as ctrl from './controller.ts';
import {
  cancelReservationBodySchema,
  checkInBodySchema,
  checkOutBodySchema,
  createReservationBodySchema,
  createWaitlistBodySchema,
  m1IdParamSchema,
  upsertGuestBodySchema,
} from './schemas.ts';

export function createM1Router(): Router {
  const router = Router();
  router.use(authenticateJwt);

  router.get(
    '/habitaciones',
    requirePermission(PERMISSIONS.M1_HABITACION_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listHabitaciones
  );

  router.get(
    '/huespedes',
    requirePermission(PERMISSIONS.M1_HUESPED_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listHuespedes
  );
  router.post(
    '/huespedes',
    requirePermission(PERMISSIONS.M1_HUESPED_GESTIONAR),
    validateBody(upsertGuestBodySchema),
    ctrl.createHuesped
  );
  router.put(
    '/huespedes/:id',
    requirePermission(PERMISSIONS.M1_HUESPED_GESTIONAR),
    validateParams(m1IdParamSchema),
    validateBody(upsertGuestBodySchema),
    ctrl.updateHuesped
  );

  router.get('/tarifas', requirePermission(PERMISSIONS.M1_TARIFA_CONSULTAR), ctrl.listTarifas);

  router.get(
    '/reservas',
    requirePermission(PERMISSIONS.M1_RESERVA_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listReservas
  );
  router.post(
    '/reservas',
    requirePermission(PERMISSIONS.M1_RESERVA_CREAR),
    validateBody(createReservationBodySchema),
    ctrl.createReserva
  );
  router.post(
    '/reservas/:id/cancelar',
    requirePermission(PERMISSIONS.M1_RESERVA_ACTUALIZAR),
    validateParams(m1IdParamSchema),
    validateBody(cancelReservationBodySchema),
    ctrl.cancelarReserva
  );
  router.post(
    '/reservas/:id/no-show',
    requirePermission(PERMISSIONS.M1_RESERVA_ACTUALIZAR),
    validateParams(m1IdParamSchema),
    validateBody(cancelReservationBodySchema),
    ctrl.marcarNoShowReserva
  );
  router.post(
    '/reservas/:id/check-in',
    requirePermission(PERMISSIONS.M1_CHECKIN_REGISTRAR),
    validateParams(m1IdParamSchema),
    validateBody(checkInBodySchema),
    ctrl.registrarCheckIn
  );
  router.post(
    '/estadias/:id/check-out',
    requirePermission(PERMISSIONS.M1_CHECKOUT_REGISTRAR),
    validateParams(m1IdParamSchema),
    validateBody(checkOutBodySchema),
    ctrl.registrarCheckOut
  );

  router.get(
    '/lista-espera',
    requirePermission(PERMISSIONS.M1_RESERVA_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listListaEspera
  );
  router.post(
    '/lista-espera',
    requirePermission(PERMISSIONS.M1_RESERVA_CREAR),
    validateBody(createWaitlistBodySchema),
    ctrl.createListaEspera
  );

  return router;
}
