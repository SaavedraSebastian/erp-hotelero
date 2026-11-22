import type { NextFunction, Request, Response } from 'express';
import { verifySupabaseJwt } from '../shared/auth/jwt-verifier.ts';
import { UnauthorizedError } from '../shared/errors/app-error.ts';
import type { AuthContext } from '../shared/types/context.ts';
import { resolveErpAuthContext } from '../modules/seguridad/repository.ts';

declare global {
  namespace Express {
    interface Request {
      authContext?: AuthContext;
    }
  }
}

function extractBearerToken(req: Request): string {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new UnauthorizedError('Se requiere un Bearer Token de Supabase Auth en el encabezado Authorization.');
  }
  const token = header.slice(7).trim();
  if (!token) {
    throw new UnauthorizedError('El token de autenticación está vacío.');
  }
  return token;
}

export async function authenticateJwt(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractBearerToken(req);
    const claims = await verifySupabaseJwt(token);
    const authContext = await resolveErpAuthContext(claims.authUserId);

    req.authContext = authContext;
    if (req.ctx) {
      req.ctx.userCode = authContext.codigoUsuario;
    }
    next();
  } catch (err) {
    next(err);
  }
}
