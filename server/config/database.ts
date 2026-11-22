import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { getEnv } from './env.ts';

let sharedPool: Pool | null = null;
let closingPromise: Promise<void> | null = null;

function sanitizePgErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? 'Error de base de datos');
  // Nunca permitir que credenciales de una URL aparezcan en logs
  return raw.replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgres://[REDACTED]@');
}

function buildPoolConfig(): PoolConfig {
  const env = getEnv();
  if (!env.databaseUrl) {
    throw new Error('DATABASE_URL no está configurada en el entorno del servidor.');
  }

  const sslConfig = env.databaseSsl
    ? { rejectUnauthorized: env.databaseSslRejectUnauthorized }
    : false;

  return {
    connectionString: env.databaseUrl,
    max: env.pgPoolMax,
    connectionTimeoutMillis: env.pgConnectionTimeoutMs,
    idleTimeoutMillis: env.pgIdleTimeoutMs,
    query_timeout: env.pgQueryTimeoutMs,
    statement_timeout: env.pgStatementTimeoutMs,
    application_name: 'sgh_erp_api',
    allowExitOnIdle: false,
    ssl: sslConfig,
  };
}

export function isDatabaseConfigured(): boolean {
  return Boolean(getEnv().databaseUrl);
}

export function initDatabasePool(): Pool | null {
  if (!isDatabaseConfigured()) {
    return null;
  }
  if (sharedPool) {
    return sharedPool;
  }

  const pool = new Pool(buildPoolConfig());

  pool.on('error', (err) => {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        component: 'database',
        message: 'Error inesperado en cliente inactivo del pool PostgreSQL',
        detail: sanitizePgErrorMessage(err),
      })
    );
  });

  sharedPool = pool;
  return sharedPool;
}

export function getDatabasePool(): Pool {
  const pool = sharedPool ?? initDatabasePool();
  if (!pool) {
    throw new Error('Conexión PostgreSQL no disponible: DATABASE_URL no configurada.');
  }
  return pool;
}

export async function getPoolClient(): Promise<PoolClient> {
  return getDatabasePool().connect();
}

export interface ReadinessCheckResult {
  ready: boolean;
  reason?: 'unconfigured' | 'unreachable';
}

export async function checkDatabaseReady(): Promise<ReadinessCheckResult> {
  if (!isDatabaseConfigured()) {
    return { ready: false, reason: 'unconfigured' };
  }

  const pool = sharedPool ?? initDatabasePool();
  if (!pool) {
    return { ready: false, reason: 'unconfigured' };
  }

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query({ text: 'SELECT 1' });
    return { ready: true };
  } catch (err) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        component: 'readiness',
        message: 'Verificación de disponibilidad PostgreSQL fallida',
        detail: sanitizePgErrorMessage(err),
      })
    );
    return { ready: false, reason: 'unreachable' };
  } finally {
    client?.release();
  }
}

export async function closeDatabasePool(): Promise<void> {
  if (!sharedPool) return;
  if (closingPromise) return closingPromise;

  const poolToClose = sharedPool;
  sharedPool = null;

  closingPromise = poolToClose
    .end()
    .catch((err) => {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'error',
          component: 'database',
          message: 'Error al cerrar pool PostgreSQL',
          detail: sanitizePgErrorMessage(err),
        })
      );
    })
    .finally(() => {
      closingPromise = null;
    });

  return closingPromise;
}
