import { z } from 'zod';

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((val) => val === 'true' || val === '1');

const positiveIntFromEnv = (defaultValue: number, min = 1, max = 300_000) =>
  z
    .string()
    .optional()
    .transform((val) => {
      if (!val || !val.trim()) return defaultValue;
      const parsed = Number(val);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : NaN;
    })
    .pipe(z.number().int().min(min).max(max));

const optionalUrl = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined))
  .refine((v) => !v || /^https?:\/\/.+/.test(v), {
    message: 'Debe ser una URL http/https válida',
  });

const optionalPostgresUrl = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined))
  .refine((v) => !v || /^postgres(ql)?:\/\/.+/.test(v), {
    message: 'Debe ser una cadena de conexión PostgreSQL válida',
  });

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: positiveIntFromEnv(3000, 1, 65535),
  APP_URL: optionalUrl,
  STRICT_ENV_VALIDATION: booleanFromEnv,

  DATABASE_URL: optionalPostgresUrl,
  DATABASE_SSL: z
    .enum(['true', 'false', 'require', 'disable', ''])
    .optional()
    .transform((val) => (val === 'false' || val === 'disable' ? false : true)),
  DATABASE_SSL_REJECT_UNAUTHORIZED: booleanFromEnv,
  PG_POOL_MAX: positiveIntFromEnv(15, 1, 100),
  PG_CONNECTION_TIMEOUT_MS: positiveIntFromEnv(5000, 500, 60_000),
  PG_IDLE_TIMEOUT_MS: positiveIntFromEnv(30_000, 1000, 300_000),
  PG_QUERY_TIMEOUT_MS: positiveIntFromEnv(15_000, 1000, 120_000),
  PG_STATEMENT_TIMEOUT_MS: positiveIntFromEnv(15_000, 1000, 120_000),

  SUPABASE_URL: optionalUrl,
  VITE_SUPABASE_URL: optionalUrl,
  SUPABASE_JWKS_URL: optionalUrl,
  SUPABASE_JWT_ISSUER: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim().replace(/\/+$/, '') : undefined)),
  SUPABASE_JWT_AUDIENCE: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : 'authenticated')),

  CORS_ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : []
    ),

  GEMINI_API_KEY: z
    .string()
    .optional()
    .transform((v) => {
      if (!v || !v.trim() || v.trim() === 'MY_GEMINI_API_KEY') return undefined;
      return v.trim();
    }),
});

export interface AppEnv {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly appUrl?: string;
  readonly strictEnvValidation: boolean;
  readonly databaseUrl?: string;
  readonly databaseSsl: boolean;
  readonly databaseSslRejectUnauthorized: boolean;
  readonly pgPoolMax: number;
  readonly pgConnectionTimeoutMs: number;
  readonly pgIdleTimeoutMs: number;
  readonly pgQueryTimeoutMs: number;
  readonly pgStatementTimeoutMs: number;
  readonly supabaseUrl?: string;
  readonly supabaseJwksUrl?: string;
  readonly supabaseJwtIssuer?: string;
  readonly supabaseJwtAudience: string;
  readonly corsAllowedOrigins: readonly string[];
  readonly geminiApiKey?: string;
}

let cachedEnv: AppEnv | null = null;

function sanitizeInvalidKeys(issues: z.ZodIssue[]): string[] {
  return Array.from(new Set(issues.map((i) => i.path.join('.') || 'ENV')));
}

export function loadAndValidateEnv(): AppEnv {
  if (cachedEnv) return cachedEnv;

  // Bloqueo preventivo contra exposición accidental en variables públicas
  for (const forbiddenPublicKey of ['VITE_DATABASE_URL', 'NEXT_PUBLIC_DATABASE_URL', 'PUBLIC_DATABASE_URL']) {
    if (process.env[forbiddenPublicKey]) {
      console.error(`[SGH-ERP][ENV] Error crítico: la variable ${forbiddenPublicKey} no debe existir en prefijos públicos.`);
      process.exit(1);
    }
  }

  const parsed = rawEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const keys = sanitizeInvalidKeys(parsed.error.issues);
    console.error(`[SGH-ERP][ENV] Variables de entorno con formato inválido: ${keys.join(', ')}`);
    process.exit(1);
  }

  const data = parsed.data;
  const resolvedSupabaseUrl = (data.SUPABASE_URL || data.VITE_SUPABASE_URL)?.replace(/\/+$/, '');
  const resolvedJwksUrl =
    data.SUPABASE_JWKS_URL || (resolvedSupabaseUrl ? `${resolvedSupabaseUrl}/auth/v1/.well-known/jwks.json` : undefined);
  const resolvedIssuer =
    data.SUPABASE_JWT_ISSUER || (resolvedSupabaseUrl ? `${resolvedSupabaseUrl}/auth/v1` : undefined);

  const missingRequired: string[] = [];
  if (!data.DATABASE_URL) missingRequired.push('DATABASE_URL');
  if (!resolvedSupabaseUrl && !resolvedJwksUrl) missingRequired.push('SUPABASE_URL');

  const enforceStrict = data.STRICT_ENV_VALIDATION;
  if (missingRequired.length > 0 && enforceStrict) {
    console.error(
      `[SGH-ERP][ENV] Faltan variables de entorno obligatorias para iniciar el servidor: ${missingRequired.join(', ')}`
    );
    process.exit(1);
  }

  if (missingRequired.length > 0 && data.NODE_ENV !== 'test') {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        component: 'env',
        message: 'Variables obligatorias pendientes de configuración; /ready responderá 503 hasta configurarlas.',
        missingVariables: missingRequired,
      })
    );
  }

  const envObj: AppEnv = Object.freeze({
    nodeEnv: data.NODE_ENV,
    port: data.PORT,
    appUrl: data.APP_URL,
    strictEnvValidation: data.STRICT_ENV_VALIDATION,
    databaseUrl: data.DATABASE_URL,
    databaseSsl: data.DATABASE_SSL,
    databaseSslRejectUnauthorized: data.DATABASE_SSL_REJECT_UNAUTHORIZED,
    pgPoolMax: data.PG_POOL_MAX,
    pgConnectionTimeoutMs: data.PG_CONNECTION_TIMEOUT_MS,
    pgIdleTimeoutMs: data.PG_IDLE_TIMEOUT_MS,
    pgQueryTimeoutMs: data.PG_QUERY_TIMEOUT_MS,
    pgStatementTimeoutMs: data.PG_STATEMENT_TIMEOUT_MS,
    supabaseUrl: resolvedSupabaseUrl,
    supabaseJwksUrl: resolvedJwksUrl,
    supabaseJwtIssuer: resolvedIssuer,
    supabaseJwtAudience: data.SUPABASE_JWT_AUDIENCE,
    corsAllowedOrigins: Object.freeze([...data.CORS_ALLOWED_ORIGINS]),
    geminiApiKey: data.GEMINI_API_KEY,
  });

  cachedEnv = envObj;
  return envObj;
}

export function getEnv(): AppEnv {
  return cachedEnv ?? loadAndValidateEnv();
}

export function hasDatabaseConfig(): boolean {
  return Boolean(getEnv().databaseUrl);
}

export function hasSupabaseJwtConfig(): boolean {
  const e = getEnv();
  return Boolean(e.supabaseJwksUrl && e.supabaseJwtIssuer);
}
