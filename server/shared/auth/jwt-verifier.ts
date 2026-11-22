import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { getEnv } from '../../config/env.ts';
import { ServiceUnavailableError, UnauthorizedError } from '../errors/app-error.ts';

let jwksCacheUrl: string | null = null;
let jwksResolver: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwksResolver(jwksUrl: string): ReturnType<typeof createRemoteJWKSet> {
  if (!jwksResolver || jwksCacheUrl !== jwksUrl) {
    jwksCacheUrl = jwksUrl;
    jwksResolver = createRemoteJWKSet(new URL(jwksUrl), {
      cacheMaxAge: 600_000,
      cooldownDuration: 30_000,
    });
  }
  return jwksResolver;
}

export interface VerifiedSupabaseClaims {
  authUserId: string;
  email?: string;
  roleClaim?: string;
  expiresAt: number;
  rawPayload: JWTPayload;
}

export async function verifySupabaseJwt(token: string): Promise<VerifiedSupabaseClaims> {
  const env = getEnv();
  if (!env.supabaseJwksUrl || !env.supabaseJwtIssuer) {
    throw new ServiceUnavailableError(
      'La verificación de tokens de Supabase Auth no está configurada en el servidor.',
      'SUPABASE_AUTH_NOT_CONFIGURED'
    );
  }

  try {
    const jwks = getJwksResolver(env.supabaseJwksUrl);
    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.supabaseJwtIssuer,
      audience: env.supabaseJwtAudience,
    });

    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new UnauthorizedError('El token de sesión no contiene un identificador de usuario válido.');
    }

    return {
      authUserId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      roleClaim: typeof payload.role === 'string' ? payload.role : undefined,
      expiresAt: typeof payload.exp === 'number' ? payload.exp : 0,
      rawPayload: payload,
    };
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ServiceUnavailableError) {
      throw err;
    }
    throw new UnauthorizedError('Token de acceso inválido, manipulado o expirado.', 'INVALID_JWT');
  }
}
