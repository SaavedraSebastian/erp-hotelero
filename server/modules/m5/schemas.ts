import { z } from 'zod';
import {
  bigintIdSchema,
  dateOnlySchema,
  positiveMoneyStringSchema,
} from '../../shared/validation/common.ts';

export const m5IdParamSchema = z.object({
  id: bigintIdSchema,
});

export const createPreferenciaBodySchema = z.object({
  categoria: z.enum(['HABITACION', 'ALIMENTACION', 'SERVICIOS', 'COMUNICACION']),
  descripcion: z.string().trim().min(2).max(150),
  origen: z.enum(['DECLARADA', 'DETECTADA']).default('DECLARADA'),
  vigente: z.boolean().default(true),
});

export const createPuntosMovimientoBodySchema = z
  .object({
    idPerfil: z.coerce.number().int().positive(),
    tipoMovimiento: z.enum(['ACUMULACION', 'CANJE', 'REVERSION', 'AJUSTE']),
    idEstadiaOrigen: bigintIdSchema.optional().nullable(),
    idBeneficio: z.coerce.number().int().positive().optional().nullable(),
    idReglaAcum: z.coerce.number().int().positive().optional().nullable(),
    puntos: z.coerce.number().int().refine((n) => n !== 0 && n >= -9999999 && n <= 9999999, 'Los puntos no pueden ser 0.'),
  })
  .superRefine((data, ctx) => {
    if (data.tipoMovimiento === 'ACUMULACION') {
      if (!data.idEstadiaOrigen || !data.idReglaAcum || data.puntos <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ACUMULACION requiere idEstadiaOrigen, idReglaAcum y puntos positivos.',
        });
      }
    } else if (data.tipoMovimiento === 'CANJE') {
      if (!data.idBeneficio) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['idBeneficio'],
          message: 'CANJE requiere un idBeneficio válido.',
        });
      }
    } else if (data.tipoMovimiento === 'REVERSION') {
      if (!data.idEstadiaOrigen || data.puntos >= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'REVERSION requiere idEstadiaOrigen y puntos negativos.',
        });
      }
    }
  });

export const createReclamoBodySchema = z.object({
  idPerfil: z.coerce.number().int().positive(),
  idEstadia: bigintIdSchema,
  idArea: z.coerce.number().int().positive().optional().nullable(),
  idIncidenciaG2: bigintIdSchema.optional().nullable(),
  tipo: z.enum(['RECLAMO', 'SUGERENCIA']).default('RECLAMO'),
  canal: z.enum(['AGENTE', 'ASISTENTE']).default('AGENTE'),
  descripcion: z.string().trim().min(5).max(500),
  motivo: z.string().trim().max(40).optional().nullable(),
  prioridad: z.enum(['NORMAL', 'CRITICA']).default('NORMAL'),
  sentimientoIa: z.enum(['POSITIVO', 'NEUTRO', 'NEGATIVO']).optional().nullable(),
  confianza: z.number().min(0).max(1).optional().nullable(),
  esCritico: z.boolean().optional(),
});

export const avanzarReclamoBodySchema = z.object({
  estado: z.enum(['DERIVADO', 'EN_ATENCION', 'CERRADO']),
  idArea: z.coerce.number().int().positive().optional().nullable(),
  observacion: z.string().trim().max(250).optional().nullable(),
});

export const solicitarCompensacionBodySchema = z.object({
  tipoCompensacion: z.enum(['DESCUENTO', 'NOCHE_SIN_COSTO', 'SERVICIO_CORTESIA']),
  monto: positiveMoneyStringSchema,
});

export const decidirCompensacionBodySchema = z
  .object({
    estado: z.enum(['APROBADA', 'RECHAZADA', 'NOTIFICADA', 'APLICADA', 'FUERA_DE_PLAZO']),
    motivoRechazo: z.string().trim().max(250).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.estado === 'RECHAZADA' && (!data.motivoRechazo || data.motivoRechazo.trim().length < 5)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['motivoRechazo'],
        message: 'El rechazo de compensación requiere motivo de al menos 5 caracteres.',
      });
    }
  });

export const createCampanaBodySchema = z
  .object({
    codigoCampana: z
      .string()
      .trim()
      .regex(/^CMP-[0-9]{4}-[0-9]{3}$/)
      .optional(),
    idSegmento: z.coerce.number().int().positive(),
    nombre: z.string().trim().min(3).max(80),
    canal: z.enum(['CORREO', 'NOTIFICACION']),
    mensaje: z.string().trim().min(5).max(500),
    fechaInicio: dateOnlySchema,
    fechaFin: dateOnlySchema,
  })
  .refine((d) => d.fechaFin >= d.fechaInicio, {
    path: ['fechaFin'],
    message: 'fechaFin debe ser mayor o igual a fechaInicio.',
  });

export const cambiarEstadoCampanaBodySchema = z.object({
  estado: z.enum(['ACTIVA', 'CERRADA', 'CANCELADA']),
});

export const createOpinionBodySchema = z
  .object({
    idPerfil: z.coerce.number().int().positive(),
    idEstadia: bigintIdSchema.optional().nullable(),
    idArea: z.coerce.number().int().positive().optional().nullable(),
    tipoOpinion: z.enum(['RESENA', 'ENCUESTA']),
    textoSeudonimizado: z.string().trim().max(1000).optional().nullable(),
    sentimientoIa: z.enum(['POSITIVO', 'NEUTRO', 'NEGATIVO']).optional().nullable(),
    confianza: z.number().min(0).max(1).optional().nullable(),
    motivo: z.string().trim().max(40).optional().nullable(),
    esCritica: z.boolean().optional(),
    // Subtipo RESENA
    calificacion: z.coerce.number().int().min(1).max(5).optional(),
    titulo: z.string().trim().max(80).optional().nullable(),
    canal: z.enum(['Directo', 'Google', 'Booking.com', 'TripAdvisor']).optional(), // g5_crm.resena restringe el canal
    // Subtipo ENCUESTA
    puntaje: z.coerce.number().int().min(0).max(10).optional(),
    recomendaria: z.boolean().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.tipoOpinion === 'RESENA' && data.calificacion === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['calificacion'],
        message: 'Una reseña requiere calificación entre 1 y 5.',
      });
    }
    if (data.tipoOpinion === 'ENCUESTA' && data.puntaje === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['puntaje'],
        message: 'Una encuesta requiere puntaje entre 0 y 10.',
      });
    }
    if ((data.sentimientoIa === null || data.sentimientoIa === undefined) !== (data.confianza === null || data.confianza === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sentimientoIa'],
        message: 'sentimientoIa y confianza deben enviarse juntos o ambos omitirse.',
      });
    }
  });

export const responderOpinionBodySchema = z.object({
  respuestaHotel: z.string().trim().min(3).max(2000),
});

export const SOLICITUD_HUESPED_ESTADOS = [
  'REGISTRADA',
  'DERIVADA',
  'EN_ATENCION',
  'ATENDIDA',
  'CANCELADA',
] as const;

export const createSolicitudHuespedBodySchema = z.object({
  idPerfil: z.coerce.number().int().positive(),
  idEstadia: bigintIdSchema.optional().nullable(),
  idHabitacion: bigintIdSchema.optional().nullable(),
  numeroHabitacion: z.string().trim().max(20).optional().nullable(),
  tipo: z.string().trim().min(2).max(60),
  // La base solo admite estas tres áreas y estos dos orígenes (g5_crm.solicitud_huesped).
  areaDestino: z.enum(['Recepción', 'Housekeeping', 'Mantenimiento']),
  origen: z.enum(['Portal Autoatención', 'Recepción/CRM']).default('Recepción/CRM'),
  descripcion: z.string().trim().min(3).max(500),
});

export const updateSolicitudEstadoBodySchema = z.object({
  estado: z.enum(SOLICITUD_HUESPED_ESTADOS),
  notasResolucion: z.string().trim().max(500).optional().nullable(),
});
