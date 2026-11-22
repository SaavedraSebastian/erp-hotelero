import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  authenticateUser,
  destroySession,
  ensureAuthDatabase,
  extractTokenFromRequest,
  getAllRolePermissions,
  getSessionContext,
  isValidRoleId,
  listPublicDirectory,
  updateServerRolePermissions,
} from './auth-rbac.ts';
import { checkDatabaseReady } from './config/database.ts';
import { getEnv, hasDatabaseConfig } from './config/env.ts';
import { errorHandler, notFoundHandler } from './middleware/error-handler.ts';
import { aiRateLimiter, apiRateLimiter, authRateLimiter } from './middleware/rate-limit.ts';
import { requestContextMiddleware } from './middleware/request-context.ts';
import { createAuditoriaRouter } from './modules/auditoria/routes.ts';
import { createConfiguracionRouter } from './modules/configuracion/establecimiento.ts';
import { createDashboardRouter } from './modules/dashboard/routes.ts';
import { createIaRouter } from './modules/ia/routes.ts';
import { createM1Router } from './modules/m1/routes.ts';
import { createM2Router } from './modules/m2/routes.ts';
import { createM3Router } from './modules/m3/routes.ts';
import { createM4Router } from './modules/m4/routes.ts';
import { createM5Router } from './modules/m5/routes.ts';
import { createSeguridadRouter } from './modules/seguridad/routes.ts';
import type { RolePermissions, UserAccount } from './types.ts';

const MODEL_ID = 'gemini-4-hydrogen';

interface LegacyAuthedRequest extends Request {
  auth?: {
    token: string;
    user: UserAccount;
    permissions: RolePermissions;
  };
}

function legacyRequireAuth(req: LegacyAuthedRequest, res: Response, next: NextFunction) {
  const token = extractTokenFromRequest(req.headers as Record<string, string | string[] | undefined>);
  const ctx = getSessionContext(token);
  if (!ctx || !token) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Sesión no válida o expirada. Inicia sesión nuevamente.',
      },
      requestId: req.ctx?.requestId ?? 'unknown',
    });
  }
  req.auth = { token, ...ctx };
  if (req.ctx) {
    req.ctx.userCode = ctx.user.id;
  }
  return next();
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = getEnv().geminiApiKey;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isSecureRequest(req: Request): boolean {
  const proto = req.headers['x-forwarded-proto'];
  return req.secure || proto === 'https';
}

function buildSessionCookie(req: Request, token: string, maxAgeSeconds: number): string {
  const secure = isSecureRequest(req);
  const parts = [
    `sgh_erp_session=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  return parts.join('; ');
}

function verifyMutationCsrf(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return next();
  }
  const requestedWith = req.headers['x-requested-with'];
  if (requestedWith === 'SGH-ERP') {
    return next();
  }
  const origin = req.headers['origin'];
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers['host'];
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) {
        return next();
      }
    } catch {
      // origen inválido
    }
  }
  return res.status(403).json({
    error: {
      code: 'CSRF_ORIGIN_REJECTED',
      message: 'Solicitud rechazada por verificación de origen.',
    },
    requestId: req.ctx?.requestId ?? 'unknown',
  });
}

function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const env = getEnv();
  const origin = req.headers.origin;
  if (!origin) {
    return next();
  }

  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
  let sameHost = false;
  try {
    sameHost = Boolean(host && new URL(origin).host === host);
  } catch {
    sameHost = false;
  }

  const explicitlyAllowed = env.corsAllowedOrigins.includes(origin);
  if (sameHost || explicitlyAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Request-Id, Idempotency-Key');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    return next();
  }

  if (req.path.startsWith('/api')) {
    return res.status(403).json({
      error: {
        code: 'CORS_ORIGIN_FORBIDDEN',
        message: 'Origen no autorizado para consumir la API.',
      },
      requestId: req.ctx?.requestId ?? 'unknown',
    });
  }

  return next();
}

export function createApp(): express.Express {
  const env = getEnv();
  ensureAuthDatabase();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const connectSrc = ["'self'"];
  if (env.supabaseUrl) {
    connectSrc.push(env.supabaseUrl);
  }

  app.use(
    helmet({
      // El visor de AI Studio ejecuta el ERP dentro de un iframe controlado
      frameguard: false,
      contentSecurityPolicy:
        env.nodeEnv === 'production'
          ? {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
                fontSrc: ["'self'", 'https://fonts.gstatic.com'],
                imgSrc: ["'self'", 'data:', 'blob:'],
                connectSrc,
              },
            }
          : false,
    })
  );

  app.use(requestContextMiddleware);
  app.use(corsMiddleware);
  app.use(express.json({ limit: '1mb' }));

  // ============================================================================
  // HEALTH & READINESS ENDPOINTS (Etapa 3)
  // Sin exponer detalles internos de esquema, versión o credenciales
  // ============================================================================
  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'sgh-erp-api',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ready', async (_req, res) => {
    const dbCheck = await checkDatabaseReady();
    if (!dbCheck.ready) {
      return res.status(503).json({
        status: 'not_ready',
        checks: {
          database: dbCheck.reason ?? 'unreachable',
        },
        timestamp: new Date().toISOString(),
      });
    }

    return res.status(200).json({
      status: 'ready',
      checks: {
        database: 'up',
      },
      timestamp: new Date().toISOString(),
    });
  });

  // Compatibilidad controlada en /api/health
  app.get('/api/health', async (_req, res) => {
    const dbCheck = await checkDatabaseReady();
    res.json({
      status: 'ok',
      databaseConfigured: hasDatabaseConfig(),
      databaseReady: dbCheck.ready,
      aiConfigured: Boolean(env.geminiApiKey),
      timestamp: new Date().toISOString(),
    });
  });

  // Espacio versionado /api/v1 (Etapas 4..13)
  const v1Router = express.Router();
  v1Router.use(apiRateLimiter);
  v1Router.use('/session', createSeguridadRouter());
  v1Router.use('/configuracion', createConfiguracionRouter());
  v1Router.use('/m1', createM1Router());
  v1Router.use('/m2', createM2Router());
  v1Router.use('/m3', createM3Router());
  v1Router.use('/m4', createM4Router());
  v1Router.use('/m5', createM5Router());
  v1Router.use('/ai', createIaRouter());
  v1Router.use('/auditoria', createAuditoriaRouter());
  v1Router.use('/dashboard', createDashboardRouter());
  app.use('/api/v1', v1Router);

  // ============================================================================
  // ENDPOINTS TRANSITORIOS DE AUTENTICACIÓN E IA (hasta completar Etapas 4 y 12)
  // ============================================================================
  app.post('/api/auth/login', authRateLimiter, (req, res) => {
    const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ error: 'Ingresa correo electrónico y contraseña.' });
    }
    const result = authenticateUser(email, password);
    if (!result.ok) {
      return res.status(401).json({ error: result.error });
    }

    res.setHeader('Set-Cookie', buildSessionCookie(req, result.token, 60 * 60 * 12));

    return res.json({
      token: result.token,
      user: result.user,
      permissions: result.permissions,
      allRolePermissions: result.user.role === 'admin' || result.user.role === 'auditor' ? getAllRolePermissions() : undefined,
    });
  });

  app.get('/api/auth/me', apiRateLimiter, legacyRequireAuth, (req: LegacyAuthedRequest, res) => {
    const { user, permissions } = req.auth!;
    return res.json({
      user,
      permissions,
      allRolePermissions: user.role === 'admin' || user.role === 'auditor' ? getAllRolePermissions() : undefined,
    });
  });

  app.post('/api/auth/logout', verifyMutationCsrf, (req, res) => {
    const token = extractTokenFromRequest(req.headers as Record<string, string | string[] | undefined>);
    destroySession(token);
    res.setHeader('Set-Cookie', buildSessionCookie(req, '', 0));
    return res.json({ ok: true });
  });

  app.get('/api/auth/users', apiRateLimiter, legacyRequireAuth, (req: LegacyAuthedRequest, res) => {
    const role = req.auth!.user.role;
    if (role !== 'admin' && role !== 'auditor') {
      return res.status(403).json({ error: 'Acceso denegado. Solo Administrador o Auditor pueden consultar el directorio de usuarios.' });
    }
    return res.json({
      users: listPublicDirectory(),
      permissions: getAllRolePermissions(),
    });
  });

  app.put('/api/auth/permissions/:role', apiRateLimiter, verifyMutationCsrf, legacyRequireAuth, (req: LegacyAuthedRequest, res) => {
    if (!req.auth!.permissions.canManageRoles) {
      return res.status(403).json({ error: 'Acceso denegado. Solo el Administrador del sistema puede modificar permisos RBAC.' });
    }
    const rawRole = String(req.params.role ?? '');
    if (!isValidRoleId(rawRole)) {
      return res.status(400).json({ error: 'Rol no válido.' });
    }
    const body = req.body as Partial<RolePermissions> | null;
    if (
      !body ||
      !Array.isArray(body.view) ||
      !Array.isArray(body.edit) ||
      typeof body.canViewFullPII !== 'boolean' ||
      typeof body.canApproveFinancials !== 'boolean' ||
      typeof body.canManageRoles !== 'boolean' ||
      typeof body.scopeSummary !== 'string'
    ) {
      return res.status(400).json({ error: 'Estructura de permisos RBAC no válida.' });
    }
    const updated = updateServerRolePermissions(rawRole, body as RolePermissions);
    return res.json({ permissions: updated });
  });

  app.post('/api/ai/analyze', aiRateLimiter, legacyRequireAuth, async (req: LegacyAuthedRequest, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: 'La clave de Gemini API no está configurada en el servidor. Configúrala en Settings > Secrets.',
      });
    }

    const { moduleId, task, contextData, userPrompt } = req.body as {
      moduleId?: string;
      task?: string;
      contextData?: unknown;
      userPrompt?: string;
    };

    try {
      const systemInstruction = [
        'Eres el motor analítico de Inteligencia Artificial de SGH-ERP (Sistema de Gestión Hotelera Integral, Hotel Boulevard).',
        `Usuario autenticado: ${req.auth!.user.name} (${req.auth!.user.roleLabel}). Respeta estrictamente su alcance RBAC.`,
        'Responde siempre en español profesional, conciso, accionable y fundamentado exclusivamente en los datos operativos entregados.',
        'Recuerda el principio de supervisión humana: tus sugerencias son recomendaciones explicables que requieren confirmación del usuario.',
        'Estructura tu respuesta en puntos claros con cifras exactas y pasos recomendados.',
      ].join(' ');

      const prompt = [
        `Módulo: ${moduleId ?? 'General'}`,
        `Tarea analítica: ${task ?? 'Resumen ejecutivo'}`,
        userPrompt ? `Consulta específica: ${userPrompt}` : '',
        `Datos operativos resumidos (JSON): ${JSON.stringify(contextData ?? {})}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const response = await ai.models.generateContent({
        model: MODEL_ID,
        contents: prompt,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      return res.json({
        analysis: response.text ?? 'No se generó respuesta.',
        model: MODEL_ID,
        generatedAt: new Date().toISOString(),
      });
    } catch {
      return res.status(502).json({ error: 'No se pudo completar el análisis con Inteligencia Artificial.' });
    }
  });

  app.post('/api/ai/chat', aiRateLimiter, legacyRequireAuth, async (req: LegacyAuthedRequest, res) => {
    const perms = req.auth!.permissions;
    if (!perms.view.includes('m5') || (!perms.allowedTabs.m5?.includes('portal_ia') && !perms.allowedTabs.m5?.includes('resumen'))) {
      return res.status(403).json({ error: 'Tu perfil no tiene autorización para utilizar el asistente conversacional CRM.' });
    }

    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: 'La clave de Gemini API no está configurada en el servidor. Configúrala en Settings > Secrets.',
      });
    }

    const { messages, hotelContext } = req.body as {
      messages?: Array<{ role: 'user' | 'assistant'; text: string }>;
      hotelContext?: unknown;
    };

    try {
      const historyText = (messages ?? [])
        .map((m) => `${m.role === 'user' ? 'Operador/Huésped' : 'Asistente SGH-ERP'}: ${m.text}`)
        .join('\n');

      const response = await ai.models.generateContent({
        model: MODEL_ID,
        contents: `Contexto actual del hotel:\n${JSON.stringify(hotelContext ?? {})}\n\nConversación:\n${historyText}\n\nResponde de forma amable, precisa y breve en español:`,
        config: {
          systemInstruction:
            'Eres el Asistente Conversacional de Atención al Huésped y CRM de Hotel Boulevard (SGH-ERP). Ayudas a redactar respuestas a huéspedes, clasificar reclamos, sugerir compensaciones y consultar políticas del hotel respetando la privacidad de datos.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      return res.json({
        reply: response.text ?? 'Sin respuesta.',
        generatedAt: new Date().toISOString(),
      });
    } catch {
      return res.status(502).json({ error: 'Error en asistente conversacional.' });
    }
  });

  // 404 controlado para cualquier ruta /api/* no registrada
  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
