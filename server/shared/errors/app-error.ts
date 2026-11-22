export type FieldErrors = Record<string, string[]>;

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly fieldErrors?: FieldErrors;

  constructor(statusCode: number, code: string, message: string, fieldErrors?: FieldErrors) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Los datos enviados no son válidos.', fieldErrors?: FieldErrors) {
    super(400, 'VALIDATION_ERROR', message, fieldErrors);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Autenticación requerida o sesión expirada.', code = 'UNAUTHORIZED') {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'No cuentas con permisos suficientes para esta operación.', code = 'FORBIDDEN') {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'El recurso solicitado no existe.', code = 'NOT_FOUND') {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflicto con el estado actual o valor duplicado.', code = 'CONFLICT') {
    super(409, code, message);
  }
}

export class DomainRuleError extends AppError {
  constructor(message: string, code = 'DOMAIN_RULE_VIOLATION', fieldErrors?: FieldErrors) {
    super(422, code, message, fieldErrors);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'El servicio no está disponible temporalmente.', code = 'SERVICE_UNAVAILABLE') {
    super(503, code, message);
  }
}

interface PgLikeError {
  code?: string;
  message?: string;
  errors?: Array<{ code?: string; message?: string }>;
}

export function mapPgError(error: unknown): AppError | null {
  if (!error || typeof error !== 'object') return null;
  const pgErr = error as PgLikeError;
  const pgCode = pgErr.code || pgErr.errors?.[0]?.code;

  if (pgCode) {
    switch (pgCode) {
      case '23505':
        return new ConflictError('Ya existe un registro con el mismo identificador o valor único.', 'PG_UNIQUE_VIOLATION');
      case '23503':
        return new DomainRuleError('La referencia indicada no existe o está siendo utilizada por otro registro.', 'PG_FOREIGN_KEY_VIOLATION');
      case '23514':
        return new DomainRuleError('La operación incumple una regla o transición permitida del negocio.', 'PG_CHECK_VIOLATION');
      case '42501':
        return new ForbiddenError('La base de datos rechazó la operación por privilegios insuficientes.', 'PG_INSUFFICIENT_PRIVILEGE');
      case '40001':
        return new ConflictError('Conflicto de concurrencia al procesar la transacción. Intenta nuevamente.', 'PG_SERIALIZATION_FAILURE');
      case '40P01':
        return new ConflictError('Bloqueo temporal entre operaciones concurrentes. Intenta nuevamente.', 'PG_DEADLOCK');
      case '22P02':
        return new ValidationError('El formato de uno de los identificadores o valores enviados no es válido.');
      case 'ENETUNREACH':
      case 'EHOSTUNREACH':
      case 'ECONNREFUSED':
      case 'ETIMEDOUT':
      case 'EAI_AGAIN':
      case 'ENOTFOUND':
      case '08001':
      case '08003':
      case '08006':
      case '57P01':
      case '57P02':
      case '57P03':
        return new ServiceUnavailableError(
          'No se pudo establecer conexión con PostgreSQL. Si usas Supabase desde Render, verifica usar la URL del Pooler IPv4 (pooler.supabase.com).',
          'DATABASE_UNREACHABLE'
        );
      case '28P01':
      case '28000':
        return new ServiceUnavailableError(
          'La autenticación de PostgreSQL en DATABASE_URL fue rechazada por la base de datos.',
          'DATABASE_AUTH_FAILED'
        );
      case 'SELF_SIGNED_CERT_IN_CHAIN':
      case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
        return new ServiceUnavailableError(
          'Error de certificado SSL al conectar con PostgreSQL.',
          'DATABASE_SSL_ERROR'
        );
      default:
        break;
    }
  }

  const msg = typeof pgErr.message === 'string' ? pgErr.message : '';
  if (
    /Connection terminated unexpectedly|timeout exceeded when trying to connect|ENETUNREACH|ECONNREFUSED/i.test(msg)
  ) {
    return new ServiceUnavailableError(
      'No se pudo establecer conexión con PostgreSQL.',
      'DATABASE_UNREACHABLE'
    );
  }

  return null;
}
