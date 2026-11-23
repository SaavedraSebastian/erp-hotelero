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

async function configureDatabaseContext(
  client: PoolClient,
  ctx: Pick<AuthContext, 'authUserId' | 'codigoUsuario' | 'sedeId'>
): Promise<void> {
  const roleState = await client.query<{ exists: boolean; can_assume: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app_multisede') AS exists,
       CASE
         WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app_multisede')
         THEN pg_has_role(current_user, 'erp_app_multisede', 'MEMBER')
         ELSE false
       END AS can_assume`
  );
  if (roleState.rows[0]?.exists) {
    if (!roleState.rows[0].can_assume) {
      throw new ServiceUnavailableError(
        'El usuario de conexión no puede adoptar el rol restringido multisede.',
        'DATABASE_ROLE_NOT_GRANTED'
      );
    }
    await client.query('SET LOCAL ROLE erp_app_multisede');
  }
  await client.query(
    `SELECT
       set_config('app.usuario_id', $1, true),
       set_config('app.usuario', $2, true),
       set_config('app.sede_id', $3, true)`,
    [ctx.authUserId, ctx.codigoUsuario.slice(0, 30), ctx.sedeId]
  );
}

export async function withTransaction<T>(
  ctx: Pick<AuthContext, 'authUserId' | 'codigoUsuario' | 'sedeId'>,
  fn: (client: PoolClient) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  ensureDbAvailable();
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query(options.serializable ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN');
    await configureDatabaseContext(client, ctx);

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
  ctx: Pick<AuthContext, 'authUserId' | 'codigoUsuario' | 'sedeId'>
): Promise<T> {
  ensureDbAvailable();
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN READ ONLY');
    await configureDatabaseContext(client, ctx);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback error
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
