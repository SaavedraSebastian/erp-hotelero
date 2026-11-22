import { z } from 'zod';
import {
  bigintIdSchema,
  dateOnlySchema,
  moneyStringSchema,
  motivoSchema,
} from '../../shared/validation/common.ts';

export const m2IdParamSchema = z.object({
  id: bigintIdSchema,
});

export const estadoHabitacionCodeSchema = z.enum(['OCU', 'SUC', 'ELI', 'LIM', 'DIS', 'FSV']);

export const changeRoomStateBodySchema = z.object({
  id_estado_nuevo: estadoHabitacionCodeSchema,
  origen: z.enum(['Manual', 'Check-out', 'Limpieza', 'Inspección', 'Incidencia', 'OrdenTrabajo']).default('Manual'),
  motivo: z.string().trim().max(200).optional().nullable(),
});

export const createCleaningOrderBodySchema = z.object({
  id_habitacion: bigintIdSchema,
  id_turno: z.enum(['M', 'T', 'N']).default('M'),
  fecha_programada: dateOnlySchema.optional(),
  tipo_limpieza: z.enum(['Salida', 'Estadía', 'Profunda']),
  origen: z.enum(['Check-out', 'Manual', 'OrdenTrabajo']).default('Manual'),
  prioridad: z.enum(['Alta', 'Media', 'Baja']).default('Media'),
  observaciones: z.string().trim().max(500).optional().nullable(),
});

export const assignCleaningOrderBodySchema = z.object({
  id_personal: bigintIdSchema,
  origen_asignacion: z.enum(['Manual', 'PropuestaIA']).default('Manual'),
  motivo_reasignacion: z.string().trim().max(200).optional().nullable(),
});

export const createInspectionBodySchema = z
  .object({
    numero_orden: bigintIdSchema,
    id_supervisor: bigintIdSchema.optional(),
    resultado: z.enum(['Conforme', 'No conforme']),
    motivo_rechazo: z.string().trim().max(300).optional().nullable(),
    lista_verificacion: z.record(z.string(), z.boolean()),
  })
  .refine(
    (d) => d.resultado !== 'No conforme' || Boolean(d.motivo_rechazo && d.motivo_rechazo.trim().length > 0),
    {
      message: 'El motivo de rechazo es obligatorio cuando el resultado es No conforme.',
      path: ['motivo_rechazo'],
    }
  );

export const createIncidentBodySchema = z
  .object({
    id_habitacion: bigintIdSchema.optional().nullable(),
    id_activo: bigintIdSchema.optional().nullable(),
    id_reclamo: bigintIdSchema.optional().nullable(),
    numero_orden: bigintIdSchema.optional().nullable(),
    descripcion: z.string().trim().min(5).max(300),
    criticidad: z.enum(['Baja', 'Media', 'Alta']),
    origen: z.enum(['Personal', 'Huésped', 'Supervisor']).default('Personal'),
  })
  .refine((d) => Boolean(d.id_habitacion || d.id_activo), {
    message: 'Debe asociar la incidencia a una habitación o a un activo.',
    path: ['id_habitacion'],
  });

export const createWorkOrderBodySchema = z
  .object({
    tipo_ot: z.enum(['Correctiva', 'Preventiva']),
    id_activo: bigintIdSchema.optional().nullable(),
    id_tecnico: bigintIdSchema.optional().nullable(),
    id_centro_costo: bigintIdSchema,
    descripcion_tarea: z.string().trim().min(5).max(300),
    prioridad: z.enum(['Alta', 'Media', 'Baja']).default('Media'),
    numero_incidencia: bigintIdSchema.optional().nullable(),
    diagnostico: z.string().trim().max(300).optional().nullable(),
    id_plan: bigintIdSchema.optional().nullable(),
    id_alerta: bigintIdSchema.optional().nullable(),
    fecha_programada: dateOnlySchema.optional(),
  })
  .refine((d) => d.tipo_ot !== 'Correctiva' || Boolean(d.numero_incidencia), {
    message: 'Una OT Correctiva requiere numero_incidencia.',
    path: ['numero_incidencia'],
  })
  .refine(
    (d) => d.tipo_ot !== 'Preventiva' || (Boolean(d.id_activo) && (Boolean(d.id_plan) !== Boolean(d.id_alerta))),
    {
      message: 'Una OT Preventiva requiere id_activo y exactamente id_plan o id_alerta.',
      path: ['id_activo'],
    }
  );

export const closeWorkOrderBodySchema = z.object({
  trabajo_realizado: z.string().trim().min(5).max(500),
  horas_trabajadas: z.coerce.number().min(0).max(999),
  costo_total: moneyStringSchema,
});

export const waitWorkOrderBodySchema = z.object({
  motivo_espera: motivoSchema.max(200),
});

export const supplyMovementBodySchema = z
  .object({
    id_insumo: bigintIdSchema,
    id_personal: bigintIdSchema.optional(),
    numero_ot: bigintIdSchema.optional().nullable(),
    tipo_movimiento: z.enum(['Entrada', 'Salida', 'Ajuste']),
    cantidad: z.coerce.number().positive(),
    signo: z.enum(['+', '-']),
    costo_unitario: moneyStringSchema.default('0.00'),
    motivo: z.string().trim().max(200).optional().nullable(),
  })
  .refine((d) => d.tipo_movimiento !== 'Ajuste' || Boolean(d.motivo && d.motivo.trim().length > 0), {
    message: 'El movimiento de tipo Ajuste exige un motivo.',
    path: ['motivo'],
  })
  .refine(
    (d) =>
      (d.tipo_movimiento === 'Entrada' && d.signo === '+') ||
      (d.tipo_movimiento === 'Salida' && d.signo === '-') ||
      d.tipo_movimiento === 'Ajuste',
    {
      message: 'El signo del movimiento debe corresponder a Entrada (+) o Salida (-).',
      path: ['signo'],
    }
  );
