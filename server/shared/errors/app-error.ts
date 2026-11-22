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
}

export function mapPgError(error: unknown): AppError | null {
  if (!error || typeof error !== 'object') return null;
  const pgCode = (error as PgLikeError).code;
  if (!pgCode) return null;

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
    default:
      return null;
  }
}
