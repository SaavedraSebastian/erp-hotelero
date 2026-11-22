import { Router } from 'express';
import { authenticateJwt } from '../../middleware/authenticate.ts';
import { requirePermission } from '../../middleware/authorize.ts';
import { aiRateLimiter } from '../../middleware/rate-limit.ts';
import { validateBody } from '../../middleware/validate.ts';
import { PERMISSIONS } from '../seguridad/permissions.ts';
import * as ctrl from './controller.ts';
import {
  asistenteConsultarBodySchema,
  demandaPronosticarBodySchema,
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
  router.post('/finanzas/evaluar', validateBody(finanzasEvaluarBodySchema), ctrl.evaluarFinanzas);
  router.post('/asistente/consultar', validateBody(asistenteConsultarBodySchema), ctrl.consultarAsistente);

  return router;
}
