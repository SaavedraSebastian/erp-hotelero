import { z } from 'zod';
import { bigintIdSchema, dateOnlySchema, motivoSchema } from '../../shared/validation/common.ts';

export const m1IdParamSchema = z.object({
  id: bigintIdSchema,
});

export const upsertGuestBodySchema = z
  .object({
    tipo_documento: z.enum(['DNI', 'PAS', 'CE', 'RUC']),
    numero_documento: z.string().trim().min(4).max(30),
    nombres: z.string().trim().min(2).max(100),
    apellidos: z.string().trim().min(2).max(100),
    telefono: z.string().trim().max(30).optional().nullable(),
    correo: z.string().trim().email('Correo inválido').max(150).optional().nullable(),
    nacionalidad: z.string().trim().max(80).optional().nullable(),
    empresa: z.string().trim().max(150).optional().nullable(),
    consentimiento_iso27701: z.boolean().default(false),
    fecha_consentimiento: dateOnlySchema.optional().nullable(),
    marketing_opt_in: z.boolean().default(false),
    notas: z.string().trim().max(1000).optional().nullable(),
  })
  .refine(
    (data) => !data.fecha_consentimiento || data.consentimiento_iso27701,
    {
      message: 'No puede registrarse fecha de consentimiento sin consentimiento_iso27701 activo.',
      path: ['fecha_consentimiento'],
    }
  );

export const createReservationBodySchema = z
  .object({
    id_huesped: bigintIdSchema,
    id_tarifa: bigintIdSchema,
    id_canal_reserva: bigintIdSchema,
    fecha_ingreso: dateOnlySchema,
    fecha_salida: dateOnlySchema,
    cantidad_huespedes: z.number().int().min(1).max(20),
    habitaciones: z
      .array(
        z.object({
          id_habitacion: bigintIdSchema,
          cantidad_huespedes: z.number().int().min(1).max(10),
        })
      )
      .min(1, 'Debe asignar al menos una habitación a la reserva.')
      .max(15),
    observaciones: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((data) => data.fecha_salida > data.fecha_ingreso, {
    message: 'La fecha de salida debe ser posterior a la fecha de ingreso.',
    path: ['fecha_salida'],
  });

export const cancelReservationBodySchema = z.object({
  motivo: motivoSchema,
});

export const checkInBodySchema = z.object({
  id_detalle_reserva: bigintIdSchema,
  id_habitacion: bigintIdSchema.optional(),
  observaciones: z.string().trim().max(1000).optional().nullable(),
  acompanantes: z
    .array(
      z.object({
        tipo_documento: z.enum(['DNI', 'PAS', 'CE']),
        numero_documento: z.string().trim().min(4).max(30),
        nombres: z.string().trim().min(2).max(100),
        apellidos: z.string().trim().min(2).max(100),
      })
    )
    .max(10)
    .default([]),
});

export const checkOutBodySchema = z.object({
  observaciones: z.string().trim().max(1000).optional().nullable(),
  autorizar_saldo_pendiente: z.boolean().default(false),
  motivo_autorizacion: z.string().trim().max(500).optional().nullable(),
});

export const createWaitlistBodySchema = z
  .object({
    id_huesped: bigintIdSchema,
    id_tipo_habitacion: bigintIdSchema,
    fecha_ingreso: dateOnlySchema,
    fecha_salida: dateOnlySchema,
    prioridad: z.number().int().min(0).max(100).default(0),
  })
  .refine((data) => data.fecha_salida > data.fecha_ingreso, {
    message: 'La fecha de salida debe ser posterior a la fecha de ingreso.',
    path: ['fecha_salida'],
  });
