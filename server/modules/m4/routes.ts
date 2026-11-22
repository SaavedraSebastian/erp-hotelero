import { Router } from 'express';
import { authenticateJwt } from '../../middleware/authenticate.ts';
import { requirePermission } from '../../middleware/authorize.ts';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';
import { paginationQuerySchema } from '../../shared/pagination/index.ts';
import { PERMISSIONS } from '../seguridad/permissions.ts';
import * as ctrl from './controller.ts';
import {
  abrirTurnoCajaBodySchema,
  cerrarTurnoCajaBodySchema,
  createCobroBodySchema,
  createCuentaConsumoBodySchema,
  createGastoBodySchema,
  createTransferenciaBodySchema,
  decidirAlertaBodySchema,
  emitirComprobanteBodySchema,
  m4IdParamSchema,
} from './schemas.ts';

export function createM4Router(): Router {
  const router = Router();
  router.use(authenticateJwt);

  router.get(
    '/cuentas',
    requirePermission(PERMISSIONS.M4_CUENTA_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listCuentas
  );
  router.get(
    '/cuentas/:id',
    requirePermission(PERMISSIONS.M4_CUENTA_CONSULTAR),
    validateParams(m4IdParamSchema),
    ctrl.getCuentaDetalle
  );
  router.post(
    '/cuentas/:id/consumos',
    requirePermission(PERMISSIONS.M4_CUENTA_OPERAR),
    validateParams(m4IdParamSchema),
    validateBody(createCuentaConsumoBodySchema),
    ctrl.agregarConsumoCuenta
  );
  router.post(
    '/transferencias',
    requirePermission(PERMISSIONS.M4_CUENTA_OPERAR),
    validateBody(createTransferenciaBodySchema),
    ctrl.transferirConsumos
  );

  router.get(
    '/comprobantes',
    requirePermission(PERMISSIONS.M4_COMPROBANTE_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listComprobantes
  );
  router.post(
    '/comprobantes',
    requirePermission(PERMISSIONS.M4_COMPROBANTE_EMITIR),
    validateBody(emitirComprobanteBodySchema),
    ctrl.emitirComprobante
  );

  router.get(
    '/turnos-caja',
    requirePermission(PERMISSIONS.M4_CAJA_OPERAR),
    validateQuery(paginationQuerySchema),
    ctrl.listTurnosCaja
  );
  router.post(
    '/turnos-caja/abrir',
    requirePermission(PERMISSIONS.M4_CAJA_OPERAR),
    validateBody(abrirTurnoCajaBodySchema),
    ctrl.abrirTurnoCaja
  );
  router.post(
    '/turnos-caja/:id/cerrar',
    requirePermission(PERMISSIONS.M4_CAJA_CERRAR),
    validateParams(m4IdParamSchema),
    validateBody(cerrarTurnoCajaBodySchema),
    ctrl.cerrarTurnoCaja
  );

  router.post(
    '/cobros',
    requirePermission(PERMISSIONS.M4_CAJA_OPERAR),
    validateBody(createCobroBodySchema),
    ctrl.registrarCobro
  );

  router.get(
    '/gastos',
    requirePermission(PERMISSIONS.M4_GASTO_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listGastos
  );
  router.post(
    '/gastos',
    requirePermission(PERMISSIONS.M4_GASTO_REGISTRAR),
    validateBody(createGastoBodySchema),
    ctrl.createGasto
  );
  router.post(
    '/gastos/:id/aprobar',
    requirePermission(PERMISSIONS.M4_GASTO_APROBAR),
    validateParams(m4IdParamSchema),
    ctrl.aprobarGasto
  );
  router.post(
    '/gastos/:id/rechazar',
    requirePermission(PERMISSIONS.M4_GASTO_APROBAR),
    validateParams(m4IdParamSchema),
    ctrl.rechazarGasto
  );

  router.get(
    '/cuentas-por-cobrar',
    requirePermission(PERMISSIONS.M4_CXC_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listCuentasPorCobrar
  );

  router.get(
    '/alertas',
    requirePermission(PERMISSIONS.M4_ALERTA_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listAlertasFinancieras
  );
  router.post(
    '/alertas/:id/decidir',
    requirePermission(PERMISSIONS.M4_ALERTA_REVISAR),
    validateParams(m4IdParamSchema),
    validateBody(decidirAlertaBodySchema),
    ctrl.decidirAlertaFinanciera
  );

  return router;
}
