import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';

function rateLimitHandler(code: string, message: string) {
  return (req: Request, res: Response) => {
    const requestId = req.ctx?.requestId ?? 'unknown';
    if (req.ctx) {
      req.ctx.errorCode = code;
    }
    res.status(429).json({
      error: {
        code,
        message,
      },
      requestId,
    });
  };
}

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 180,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler(
    'RATE_LIMIT_EXCEEDED',
    'Demasiadas solicitudes en poco tiempo. Espera unos segundos e intenta nuevamente.'
  ),
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler(
    'AUTH_RATE_LIMIT_EXCEEDED',
    'Demasiados intentos de autenticación. Intenta nuevamente en unos minutos.'
  ),
});

export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler(
    'AI_RATE_LIMIT_EXCEEDED',
    'Límite de consultas de Inteligencia Artificial alcanzado. Intenta nuevamente en un minuto.'
  ),
});
