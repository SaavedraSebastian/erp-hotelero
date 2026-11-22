import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError, ConflictError, DomainRuleError } from '../../shared/errors/app-error.ts';

/**
 * Traduce los errores de PostgreSQL más comunes a errores de dominio con un mensaje útil,
 * en lugar de devolver un 500 genérico.
 */
export function mapDatabaseError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const e = error as { code?: string; constraint?: string; detail?: string; message?: string };
  switch (e?.code) {
    case '23505': // unique_violation
      return new ConflictError(`Ya existe un registro con esos datos${e.constraint ? ` (${e.constraint})` : ''}.`);
    case '23503': // foreign_key_violation
      return new DomainRuleError('Hay una referencia inválida: el registro relacionado no existe o está en uso.');
    case '23514': // check_violation
      return new DomainRuleError(`Un dato no cumple la regla de negocio${e.constraint ? ` (${e.constraint})` : ''}.`);
    case 'P0001': // RAISE EXCEPTION de un trigger
      return new DomainRuleError(e.message ?? 'La operación fue rechazada por una regla de la base de datos.');
    default:
      return error;
  }
}

/** Envuelve un handler async: responde { data } y delega los errores (ya traducidos) al middleware. */
export function handle(fn: (req: Request) => Promise<unknown>, status = 200, raw = false): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req);
      res.status(status).json(raw ? out : { data: out });
    } catch (err) {
      next(mapDatabaseError(err));
    }
  };
}
