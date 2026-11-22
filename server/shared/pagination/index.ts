import { z } from 'zod';
import type { PaginatedResponse, PaginationParams } from '../types/context.ts';
import { dateOnlySchema } from '../validation/common.ts';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
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
  fromDate: dateOnlySchema.optional(),
  toDate: dateOnlySchema.optional(),
  status: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

export function parsePagination(raw: Record<string, unknown>): PaginationParams {
  return paginationQuerySchema.parse(raw);
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
