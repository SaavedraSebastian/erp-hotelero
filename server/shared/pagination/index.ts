import { z } from 'zod';
import type { PaginatedResponse, PaginationParams } from '../types/context.ts';
import { dateOnlySchema } from '../validation/common.ts';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  sortBy: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  modalidad: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  puntoVenta: z
    .string()
    .trim()
    .max(36)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  fromDate: dateOnlySchema.optional(),
  toDate: dateOnlySchema.optional(),
  // Uno o varios estados separados por coma (p. ej. "EN_CURSO,CONFIRMADA").
  status: z
    .string()
    .trim()
    .max(160)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

export function parsePagination(raw: Record<string, unknown>): PaginationParams {
  return paginationQuerySchema.parse(raw);
}

/**
 * Agrega al WHERE un filtro de estado con uno o varios valores separados por coma.
 * `column` es una expresión SQL propia (nunca un dato del usuario).
 */
export function pushStatusFilter(values: unknown[], where: string[], column: string, status?: string): void {
  if (!status) return;
  const list = status.split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return;
  values.push(list);
  where.push(`${column}::text = ANY($${values.length}::text[])`);
}

/** Agrega una búsqueda ILIKE sobre varias expresiones SQL propias. */
export function pushSearchFilter(values: unknown[], where: string[], columns: string[], search?: string): void {
  if (!search || columns.length === 0) return;
  values.push(`%${search}%`);
  const ph = `$${values.length}`;
  where.push(`(${columns.map((c) => `${c}::text ILIKE ${ph}`).join(' OR ')})`);
}

/** Rango de fechas inclusivo sobre una columna de fecha/hora. */
export function pushDateRange(values: unknown[], where: string[], column: string, from?: string, to?: string): void {
  if (from) {
    values.push(from);
    where.push(`${column}::date >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    where.push(`${column}::date <= $${values.length}::date`);
  }
}

export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number,
  summary?: Record<string, unknown>
): PaginatedResponse<T> {
  const safeTotal = Math.max(0, total);
  const totalPages = safeTotal === 0 ? 0 : Math.ceil(safeTotal / pageSize);
  return {
    data,
    pagination: {
      page,
      pageSize,
      total: safeTotal,
      totalPages,
    },
    ...(summary ? { summary } : {}),
  };
}
