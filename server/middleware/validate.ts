import type { NextFunction, Request, Response } from 'express';
import { type ZodTypeAny } from 'zod';
import { ValidationError, type FieldErrors } from '../shared/errors/app-error.ts';

function toFieldErrors(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '_root';
    if (!fieldErrors[key]) {
      fieldErrors[key] = [];
    }
    fieldErrors[key].push(issue.message);
  }
  return fieldErrors;
}

export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError('El cuerpo de la solicitud contiene errores de validación.', toFieldErrors(parsed.error.issues)));
      return;
    }
    req.body = parsed.data;
    next();
  };
}

export function validateQuery<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      next(new ValidationError('Los parámetros de consulta no son válidos.', toFieldErrors(parsed.error.issues)));
      return;
    }
    (req as Request & { validatedQuery?: unknown }).validatedQuery = parsed.data;
    next();
  };
}

export function validateParams<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) {
      next(new ValidationError('Los parámetros de ruta no son válidos.', toFieldErrors(parsed.error.issues)));
      return;
    }
    (req as Request & { validatedParams?: unknown }).validatedParams = parsed.data;
    next();
  };
}
