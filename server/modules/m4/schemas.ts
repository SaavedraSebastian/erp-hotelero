import { z } from 'zod';
import {
  moneyStringSchema,
  motivoSchema,
  positiveMoneyStringSchema,
  rucSchema,
  varcharIdSchema,
} from '../../shared/validation/common.ts';

export const m4IdParamSchema = z.object({
  id: varcharIdSchema,
});

export const createCuentaConsumoBodySchema = z.object({
  id_centro_costo: z.coerce.number().int().positive().optional().nullable(),
  numero_consumo_origen: z.string().trim().max(30).optional().nullable(),
  concepto: z.string().trim().min(3).max(150),
  importe: positiveMoneyStringSchema,
  area: z.string().trim().min(2).max(50),
});

export const createTransferenciaBodySchema = z
  .object({
    id_cuenta_origen: varcharIdSchema,
    id_cuenta_destino: varcharIdSchema,
    motivo: motivoSchema.max(250),
    ids_consumo: z.array(varcharIdSchema).min(1).max(50),
  })
  .refine((d) => d.id_cuenta_origen !== d.id_cuenta_destino, {
    message: 'La cuenta de origen y destino no pueden ser la misma.',
    path: ['id_cuenta_destino'],
  });

export const emitirComprobanteBodySchema = z
  .object({
    id_cuenta: varcharIdSchema,
    tipo: z.enum(['BOLETA', 'FACTURA', 'NOTA_CREDITO']),
    serie: z.string().trim().min(3).max(4).regex(/^[FB][A-Z0-9]{2,3}$/, 'Serie SUNAT inválida (ej. F001 o B001).'),
    tipo_documento_cliente: z.enum(['DNI', 'RUC', 'CE', 'PAS']),
    numero_documento_cliente: z.string().trim().min(4).max(20),
    razon_social_cliente: z.string().trim().min(2).max(200),
    direccion_cliente: z.string().trim().max(250).optional().nullable(),
    operacion_gravada: moneyStringSchema,
    id_comprobante_ref: varcharIdSchema.optional().nullable(),
    motivo_nota: z.string().trim().max(250).optional().nullable(),
  })
  .refine((d) => d.tipo !== 'FACTURA' || d.tipo_documento_cliente === 'RUC', {
    message: 'Para emitir FACTURA el tipo_documento_cliente debe ser RUC.',
    path: ['tipo_documento_cliente'],
  })
  .refine((d) => d.tipo_documento_cliente !== 'RUC' || rucSchema.safeParse(d.numero_documento_cliente).success, {
    message: 'El número de RUC debe tener exactamente 11 dígitos numéricos.',
    path: ['numero_documento_cliente'],
  })
  .refine((d) => d.tipo !== 'NOTA_CREDITO' || Boolean(d.id_comprobante_ref && d.motivo_nota && d.motivo_nota.trim()), {
    message: 'La NOTA_CREDITO requiere id_comprobante_ref y motivo_nota.',
    path: ['id_comprobante_ref'],
  });

export const abrirTurnoCajaBodySchema = z.object({
  turno: z.enum(['MANANA', 'TARDE', 'NOCHE']),
  saldo_inicial: moneyStringSchema,
});

export const cerrarTurnoCajaBodySchema = z.object({
  saldo_final: moneyStringSchema,
  justificacion_diferencia: z.string().trim().max(250).optional().nullable(),
  motivo_excepcion: z.string().trim().max(250).optional().nullable(),
  id_usuario_autoriza: z.coerce.number().int().positive().optional().nullable(),
});

export const createCobroBodySchema = z.object({
  id_cuenta: varcharIdSchema,
  id_turno_caja: varcharIdSchema,
  id_comprobante: varcharIdSchema.optional().nullable(),
  monto: positiveMoneyStringSchema,
  medio_pago: z.enum(['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'BILLETERA_DIGITAL']),
});

export const createGastoBodySchema = z.object({
  id_centro_costo: z.coerce.number().int().positive(),
  categoria: z.string().trim().min(2).max(60),
  proveedor: z.string().trim().min(2).max(120),
  concepto: z.string().trim().min(3).max(250),
  monto: positiveMoneyStringSchema,
  comprobante_sustento: z.string().trim().min(3).max(250),
});

export const decidirAlertaBodySchema = z.object({
  clasificacion: z.enum(['CONFIRMADA', 'JUSTIFICADA', 'FALSO_POSITIVO']),
  justificacion: motivoSchema.max(250),
});
