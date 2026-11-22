import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  requestId: string;
  startedAt: bigint;
  userCode?: string;
  errorCode?: string;
}

declare global {
  namespace Express {
    interface Request {
      ctx?: RequestContext;
    }
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveRequestId(rawHeader: unknown): string {
  if (typeof rawHeader === 'string' && UUID_REGEX.test(rawHeader.trim())) {
    return rawHeader.trim();
  }
  return crypto.randomUUID();
}

function inferModuleFromPath(pathname: string): string {
  if (pathname.startsWith('/api/v1/m1')) return 'm1';
  if (pathname.startsWith('/api/v1/m2')) return 'm2';
  if (pathname.startsWith('/api/v1/m3')) return 'm3';
  if (pathname.startsWith('/api/v1/m4')) return 'm4';
  if (pathname.startsWith('/api/v1/m5')) return 'm5';
  if (pathname.startsWith('/api/v1/session') || pathname.startsWith('/api/auth')) return 'seguridad';
  if (pathname.startsWith('/api/v1/ai') || pathname.startsWith('/api/ai')) return 'ia';
  if (pathname.startsWith('/api/v1/configuracion')) return 'configuracion';
  if (pathname.startsWith('/api/v1/dashboard')) return 'dashboard';
  return 'sistema';
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req.headers['x-request-id']);
  const startedAt = process.hrtime.bigint();

  req.ctx = {
    requestId,
    startedAt,
  };
  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    const pathname = req.path || '/';
    // Omitir ruido de assets estáticos de Vite en desarrollo
    if (!pathname.startsWith('/api') && pathname !== '/health' && pathname !== '/ready') {
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const status = res.statusCode;

    console.info(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
        requestId,
        usuarioInterno: req.ctx?.userCode ?? null,
        modulo: inferModuleFromPath(pathname),
        endpoint: pathname,
        metodo: req.method,
        resultado: status >= 400 ? 'error' : 'ok',
        statusCode: status,
        duracionMs: Number(durationMs.toFixed(2)),
        ...(req.ctx?.errorCode ? { codigoError: req.ctx.errorCode } : {}),
      })
    );
  });

  next();
}
