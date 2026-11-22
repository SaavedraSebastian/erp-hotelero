import type { NextFunction, Request, Response } from 'express';
import { AppError, mapPgError } from '../shared/errors/app-error.ts';

export function notFoundHandler(req: Request, res: Response): void {
  const requestId = req.ctx?.requestId ?? 'unknown';
  if (req.ctx) {
    req.ctx.errorCode = 'ROUTE_NOT_FOUND';
  }
  res.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: 'El endpoint solicitado no existe en esta versión de la API.',
    },
    requestId,
  });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.ctx?.requestId ?? 'unknown';

  const mappedPg = mapPgError(err);
  const resolved: AppError =
    err instanceof AppError
      ? err
      : mappedPg ?? new AppError(500, 'INTERNAL_SERVER_ERROR', 'Ocurrió un error interno al procesar la solicitud.');

  if (req.ctx) {
    req.ctx.errorCode = resolved.code;
  }

  if (resolved.statusCode >= 500) {
    const safeDetail = err instanceof Error ? err.message.replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgres://[REDACTED]@') : 'Unknown error';
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        requestId,
        code: resolved.code,
        detail: safeDetail,
      })
    );
  }

  res.status(resolved.statusCode).json({
    error: {
      code: resolved.code,
      message: resolved.message,
      ...(resolved.fieldErrors ? { fieldErrors: resolved.fieldErrors } : {}),
    },
    requestId,
  });
}
