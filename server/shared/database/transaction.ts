import type { PoolClient } from 'pg';
import { getDatabasePool, isDatabaseConfigured } from '../../config/database.ts';
import { ServiceUnavailableError } from '../errors/app-error.ts';
import type { AuthContext } from '../types/context.ts';

export interface TransactionOptions {
  serializable?: boolean;
}

function ensureDbAvailable(): void {
  if (!isDatabaseConfigured()) {
    throw new ServiceUnavailableError(
      'La conexión PostgreSQL/Supabase aún no está configurada en el servidor.',
      'DATABASE_NOT_CONFIGURED'
    );
  }
}

export async function withTransaction<T>(
  ctx: Pick<AuthContext, 'authUserId' | 'codigoUsuario'>,
  fn: (client: PoolClient) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  ensureDbAvailable();
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query(options.serializable ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN');
    await client.query(
      `SELECT
         set_config('app.usuario_id', $1, true),
         set_config('app.usuario', $2, true)`,
      [ctx.authUserId, ctx.codigoUsuario.slice(0, 30)]
    );

    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback error on broken connection
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function withReadOnlyClient<T>(
  fn: (client: PoolClient) => Promise<T>,
  ctx?: Pick<AuthContext, 'authUserId' | 'codigoUsuario'>
): Promise<T> {
  ensureDbAvailable();
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    if (ctx) {
      await client.query('BEGIN READ ONLY');
      await client.query(
        `SELECT
           set_config('app.usuario_id', $1, true),
           set_config('app.usuario', $2, true)`,
        [ctx.authUserId, ctx.codigoUsuario.slice(0, 30)]
      );
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    }
    return await fn(client);
  } catch (error) {
    if (ctx) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback error
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function setMotivoCambioPrecio(client: PoolClient, motivo: string): Promise<void> {
  const cleanMotivo = motivo.trim();
  await client.query("SELECT set_config('app.motivo_cambio_precio', $1, true)", [cleanMotivo]);
}
