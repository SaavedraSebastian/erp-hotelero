import { Router } from 'express';
import { authenticateJwt } from '../../middleware/authenticate.ts';
import { requirePermission } from '../../middleware/authorize.ts';
import { aiRateLimiter } from '../../middleware/rate-limit.ts';
import { validateBody } from '../../middleware/validate.ts';
import { validateParams, validateQuery } from '../../middleware/validate.ts';
import { paginationQuerySchema } from '../../shared/pagination/index.ts';
import { z } from 'zod';
import { PERMISSIONS } from '../seguridad/permissions.ts';
import * as ctrl from './controller.ts';
import {
  asistenteConsultarBodySchema,
  demandaPronosticarBodySchema,
  demandaDecisionBodySchema,
  finanzasEvaluarBodySchema,
  housekeepingProponerBodySchema,
  mantenimientoEvaluarBodySchema,
  noShowGenerarBodySchema,
  tarifaSugerirBodySchema,
} from './schemas.ts';

export function createIaRouter(): Router {
  const router = Router();
  router.use(aiRateLimiter);
  router.use(authenticateJwt);
  router.use(requirePermission(PERMISSIONS.IA_USAR));

  router.post('/no-show/generar', validateBody(noShowGenerarBodySchema), ctrl.generarNoShow);
  router.post('/tarifas/sugerir', validateBody(tarifaSugerirBodySchema), ctrl.sugerirTarifa);
  router.post('/housekeeping/proponer', validateBody(housekeepingProponerBodySchema), ctrl.proponerHousekeeping);
  router.post('/mantenimiento/evaluar', validateBody(mantenimientoEvaluarBodySchema), ctrl.evaluarMantenimiento);
  router.post('/demanda/pronosticar', validateBody(demandaPronosticarBodySchema), ctrl.pronosticarDemanda);
  router.get('/demanda/recomendaciones', validateQuery(paginationQuerySchema), ctrl.listarRecomendacionesDemanda);
  router.post(
    '/demanda/recomendaciones/:id/decision',
    validateParams(z.object({ id: z.string().uuid() })),
    validateBody(demandaDecisionBodySchema),
    ctrl.decidirRecomendacionDemanda
  );
  router.post('/finanzas/evaluar', validateBody(finanzasEvaluarBodySchema), ctrl.evaluarFinanzas);
  router.post('/asistente/consultar', validateBody(asistenteConsultarBodySchema), ctrl.consultarAsistente);

  return router;
}
