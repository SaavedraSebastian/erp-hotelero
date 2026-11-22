import { Router } from 'express';
import { authenticateJwt } from '../../middleware/authenticate.ts';
import { requirePermission } from '../../middleware/authorize.ts';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';
import { paginationQuerySchema } from '../../shared/pagination/index.ts';
import { PERMISSIONS } from '../seguridad/permissions.ts';
import * as ctrl from './controller.ts';
import {
  createComandaBodySchema,
  createConsumoBodySchema,
  createMovimientoInventarioBodySchema,
  createOrdenCompraBodySchema,
  decisionOrdenCompraBodySchema,
  entregarComandaBodySchema,
  enviarOrdenCompraBodySchema,
  m3IdParamSchema,
  motivoBodySchema,
  recibirOrdenCompraBodySchema,
  updatePrecioItemBodySchema,
} from './schemas.ts';

export function createM3Router(): Router {
  const router = Router();
  router.use(authenticateJwt);

  router.get('/catalogo', requirePermission(PERMISSIONS.M3_CATALOGO_CONSULTAR), ctrl.listCatalogo);
  router.post(
    '/catalogo/:id/precio',
    requirePermission(PERMISSIONS.M3_PRECIO_MODIFICAR),
    validateParams(m3IdParamSchema),
    validateBody(updatePrecioItemBodySchema),
    ctrl.actualizarPrecioItem
  );

  router.get(
    '/comandas',
    requirePermission(PERMISSIONS.M3_COMANDA_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listComandas
  );
  router.post(
    '/comandas',
    requirePermission(PERMISSIONS.M3_COMANDA_CREAR),
    validateBody(createComandaBodySchema),
    ctrl.createComanda
  );
  router.post(
    '/comandas/:id/iniciar-preparacion',
    requirePermission(PERMISSIONS.M3_COMANDA_ACTUALIZAR),
    validateParams(m3IdParamSchema),
    ctrl.iniciarPreparacionComanda
  );
  router.post(
    '/comandas/:id/marcar-lista',
    requirePermission(PERMISSIONS.M3_COMANDA_ACTUALIZAR),
    validateParams(m3IdParamSchema),
    ctrl.marcarListaComanda
  );
  router.post(
    '/comandas/:id/entregar',
    requirePermission(PERMISSIONS.M3_COMANDA_ACTUALIZAR),
    validateParams(m3IdParamSchema),
    validateBody(entregarComandaBodySchema),
    ctrl.entregarComanda
  );
  router.post(
    '/comandas/:id/cancelar',
    requirePermission(PERMISSIONS.M3_COMANDA_CANCELAR),
    validateParams(m3IdParamSchema),
    validateBody(motivoBodySchema),
    ctrl.cancelarComanda
  );

  router.get(
    '/consumos',
    requirePermission(PERMISSIONS.M3_CONSUMO_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listConsumos
  );
  router.post(
    '/consumos',
    requirePermission(PERMISSIONS.M3_CONSUMO_CREAR),
    validateBody(createConsumoBodySchema),
    ctrl.createConsumo
  );
  router.post(
    '/consumos/:id/confirmar',
    requirePermission(PERMISSIONS.M3_CONSUMO_CONFIRMAR),
    validateParams(m3IdParamSchema),
    ctrl.confirmarConsumo
  );
  router.post(
    '/consumos/:id/descartar',
    requirePermission(PERMISSIONS.M3_CONSUMO_ANULAR),
    validateParams(m3IdParamSchema),
    validateBody(motivoBodySchema),
    ctrl.descartarConsumo
  );
  router.post(
    '/consumos/:id/anular',
    requirePermission(PERMISSIONS.M3_CONSUMO_ANULAR),
    validateParams(m3IdParamSchema),
    validateBody(motivoBodySchema),
    ctrl.anularConsumo
  );

  router.get(
    '/inventario',
    requirePermission(PERMISSIONS.M3_INVENTARIO_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listInventario
  );
  router.post(
    '/inventario/movimientos',
    requirePermission(PERMISSIONS.M3_INVENTARIO_MOVER),
    validateBody(createMovimientoInventarioBodySchema),
    ctrl.registrarMovimientoInventario
  );

  router.get(
    '/ordenes-compra',
    requirePermission(PERMISSIONS.M3_COMPRA_CONSULTAR),
    validateQuery(paginationQuerySchema),
    ctrl.listOrdenesCompra
  );
  router.post(
    '/ordenes-compra',
    requirePermission(PERMISSIONS.M3_COMPRA_PREPARAR),
    validateBody(createOrdenCompraBodySchema),
    ctrl.createOrdenCompra
  );
  router.post(
    '/ordenes-compra/:id/aprobar',
    requirePermission(PERMISSIONS.M3_COMPRA_APROBAR),
    validateParams(m3IdParamSchema),
    validateBody(decisionOrdenCompraBodySchema),
    ctrl.aprobarOrdenCompra
  );
  router.post(
    '/ordenes-compra/:id/rechazar',
    requirePermission(PERMISSIONS.M3_COMPRA_APROBAR),
    validateParams(m3IdParamSchema),
    validateBody(decisionOrdenCompraBodySchema),
    ctrl.rechazarOrdenCompra
  );
  router.post(
    '/ordenes-compra/:id/enviar',
    requirePermission(PERMISSIONS.M3_COMPRA_ENVIAR),
    validateParams(m3IdParamSchema),
    validateBody(enviarOrdenCompraBodySchema),
    ctrl.enviarOrdenCompra
  );
  router.post(
    '/ordenes-compra/:id/recepciones',
    requirePermission(PERMISSIONS.M3_COMPRA_RECIBIR),
    validateParams(m3IdParamSchema),
    validateBody(recibirOrdenCompraBodySchema),
    ctrl.recibirOrdenCompra
  );

  return router;
}
