import { Router } from 'express';
import { getAllRolePermissions } from '../../auth-rbac.ts';
import { authenticateJwt } from '../../middleware/authenticate.ts';
import { getOperationalTimestampLima } from '../../shared/dates/lima.ts';
import { ForbiddenError } from '../../shared/errors/app-error.ts';
import { listSecurityDirectory } from './repository.ts';

export function createSeguridadRouter(): Router {
  const router = Router();

  router.get('/me', authenticateJwt, (req, res) => {
    const ctx = req.authContext!;
    res.json({
      usuario: {
        id: ctx.authUserId,
        idErp: ctx.usuarioId,
        codigo: ctx.codigoUsuario,
        nombre: ctx.nombre,
        departamento: ctx.departamento,
        turno: ctx.turno ?? null,
        canViewFullPII: ctx.canViewFullPII,
      },
      roles: ctx.roles,
      permisos: ctx.permisos,
      sedeActiva: ctx.sedeId,
      sedes: ctx.sedes,
      fechaOperativa: getOperationalTimestampLima(),
    });
  });

  router.get('/directory', authenticateJwt, async (req, res, next) => {
    try {
      const ctx = req.authContext!;
      const upperRoles = ctx.roles.map((r) => r.trim().toUpperCase());
      const allowed =
        upperRoles.some((r) => ['ADMIN_SISTEMA', 'SUPER_ADMIN', 'ADMINISTRADOR', 'ADMIN', 'AUDITOR', 'AUDITOR_GENERAL'].includes(r)) ||
        ctx.permisos.includes('auditoria.consultar') ||
        ctx.permisos.includes('seguridad.usuario.administrar');

      if (!allowed) {
        throw new ForbiddenError('Solo Administrador o Auditor pueden consultar el directorio de usuarios.');
      }

      const users = await listSecurityDirectory();
      res.json({
        users,
        permissions: getAllRolePermissions(),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
