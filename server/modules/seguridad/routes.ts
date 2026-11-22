import { Router } from 'express';
import { authenticateJwt } from '../../middleware/authenticate.ts';
import { getOperationalTimestampLima } from '../../shared/dates/lima.ts';

export function createSeguridadRouter(): Router {
  const router = Router();

  router.get('/me', authenticateJwt, (req, res) => {
    const ctx = req.authContext!;
    res.json({
      usuario: {
        id: ctx.authUserId,
        codigo: ctx.codigoUsuario,
        nombre: ctx.nombre,
        departamento: ctx.departamento,
        turno: ctx.turno ?? null,
        canViewFullPII: ctx.canViewFullPII,
      },
      roles: ctx.roles,
      permisos: ctx.permisos,
      fechaOperativa: getOperationalTimestampLima(),
    });
  });

  return router;
}
