import { z } from 'zod';
import {
  bigintIdSchema,
  dateOnlySchema,
  varcharIdSchema,
} from '../../shared/validation/common.ts';

export const noShowGenerarBodySchema = z.object({
  idReserva: bigintIdSchema,
});

export const tarifaSugerirBodySchema = z.object({
  idReserva: bigintIdSchema,
});

export const housekeepingProponerBodySchema = z.object({
  idTurno: z.enum(['M', 'T', 'N']),
  fecha: dateOnlySchema,
});

export const mantenimientoEvaluarBodySchema = z.object({
  idActivos: z.array(bigintIdSchema).max(50).optional(),
});

export const demandaPronosticarBodySchema = z.object({
  idPuntoVenta: varcharIdSchema,
  idItemCatalogo: varcharIdSchema.optional().nullable(),
  idArticulo: varcharIdSchema.optional().nullable(),
  fechaDesde: dateOnlySchema,
  fechaHasta: dateOnlySchema,
}).refine((d) => d.fechaHasta >= d.fechaDesde, {
  path: ['fechaHasta'],
  message: 'fechaHasta debe ser mayor o igual a fechaDesde.',
});

export const finanzasEvaluarBodySchema = z.object({
  periodo: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
  tipo: z.enum(['BASE', 'ESCENARIO']).default('BASE'),
  idProyeccionBase: varcharIdSchema.optional().nullable(),
  escenarioSupuesto: z.string().trim().max(250).optional().nullable(),
  evaluarCobroId: varcharIdSchema.optional().nullable(),
}).refine((d) => d.tipo !== 'ESCENARIO' || Boolean(d.idProyeccionBase), {
  path: ['idProyeccionBase'],
  message: 'Un escenario financiero requiere idProyeccionBase.',
});

export const asistenteConsultarBodySchema = z.object({
  mensaje: z.string().trim().min(2).max(1000),
  idEstadia: bigintIdSchema.optional().nullable(),
  contextoAnonimizado: z.record(z.string(), z.unknown()).optional(),
});
