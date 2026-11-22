import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../shared/errors/app-error.ts';
import type { AuthContext } from '../shared/types/context.ts';

function ensureAuthenticated(req: Request): AuthContext {
  if (!req.authContext) {
    throw new UnauthorizedError('No existe un contexto autenticado para la solicitud.');
  }
  return req.authContext;
}

function isSystemAdmin(ctx: AuthContext): boolean {
  return (
    ctx.permisos.includes('*') ||
    ctx.roles.some((r) => ['ADMIN_SISTEMA', 'SUPER_ADMIN', 'ADMINISTRADOR'].includes(r.toUpperCase()))
  );
}

export function requirePermission(...requiredPermissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ctx = ensureAuthenticated(req);
    if (isSystemAdmin(ctx)) {
      next();
      return;
    }

    const missing = requiredPermissions.filter((perm) => !ctx.permisos.includes(perm));
    if (missing.length > 0) {
      next(new ForbiddenError(`Permiso requerido insuficiente: ${missing.join(', ')}.`));
      return;
    }
    next();
  };
}

export function requireAnyPermission(...candidatePermissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ctx = ensureAuthenticated(req);
    if (isSystemAdmin(ctx)) {
      next();
      return;
    }

    const hasAny = candidatePermissions.some((perm) => ctx.permisos.includes(perm));
    if (!hasAny) {
      next(new ForbiddenError(`Se requiere al menos uno de los permisos: ${candidatePermissions.join(', ')}.`));
      return;
    }
    next();
  };
}

export function requireRole(...allowedRoles: string[]) {
  const normalizedAllowed = new Set(allowedRoles.map((r) => r.toUpperCase()));
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ctx = ensureAuthenticated(req);
    const matched = ctx.roles.some((r) => normalizedAllowed.has(r.toUpperCase()));
    if (!matched) {
      next(new ForbiddenError('Tu rol actual no tiene autorización para esta operación.'));
      return;
    }
    next();
  };
}
