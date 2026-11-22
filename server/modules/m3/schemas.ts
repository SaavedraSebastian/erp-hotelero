import { z } from 'zod';
import {
  dateOnlySchema,
  moneyStringSchema,
  motivoSchema,
  varcharIdSchema,
} from '../../shared/validation/common.ts';

export const m3IdParamSchema = z.object({
  id: varcharIdSchema,
});

export const updatePrecioItemBodySchema = z.object({
  precio_nuevo: moneyStringSchema,
  motivo: motivoSchema,
});

export const createComandaBodySchema = z
  .object({
    id_punto_venta: varcharIdSchema,
    modalidad: z.enum(['mesa', 'habitación']),
    id_mesa: varcharIdSchema.optional().nullable(),
    id_estadia_externa: varcharIdSchema.optional().nullable(),
    items: z
      .array(
        z.object({
          id_item_catalogo: varcharIdSchema,
          cantidad: z.coerce.number().positive().max(1000),
          observacion_preparacion: z.string().trim().max(500).optional().nullable(),
        })
      )
      .min(1, 'La comanda debe incluir al menos un ítem.')
      .max(50),
  })
  .refine((d) => d.modalidad !== 'mesa' || Boolean(d.id_mesa), {
    message: 'Las comandas en mesa requieren id_mesa.',
    path: ['id_mesa'],
  })
  .refine((d) => d.modalidad !== 'habitación' || Boolean(d.id_estadia_externa), {
    message: 'Las comandas a habitación requieren id_estadia_externa.',
    path: ['id_estadia_externa'],
  });

export const entregarComandaBodySchema = z.object({
  forma_cobro: z.enum(['pago directo', 'cargo a la habitación', 'incluido en paquete']),
  id_cuenta_cobro_externa: varcharIdSchema.optional().nullable(),
  id_paquete_externo: varcharIdSchema.optional().nullable(),
});

export const motivoBodySchema = z.object({
  motivo: motivoSchema,
});

export const createConsumoBodySchema = z
  .object({
    id_punto_venta: varcharIdSchema,
    forma_cobro: z.enum(['pago directo', 'cargo a la habitación', 'incluido en paquete']),
    id_estadia_externa: varcharIdSchema.optional().nullable(),
    id_cuenta_cobro_externa: varcharIdSchema.optional().nullable(),
    id_paquete_externo: varcharIdSchema.optional().nullable(),
    items: z
      .array(
        z.object({
          id_item_catalogo: varcharIdSchema,
          cantidad: z.coerce.number().positive().max(1000),
          importe_cobrado: moneyStringSchema.optional(),
        })
      )
      .min(1)
      .max(50),
  })
  .refine(
    (d) => d.forma_cobro !== 'cargo a la habitación' || Boolean(d.id_estadia_externa && d.id_cuenta_cobro_externa),
    {
      message: 'El cargo a la habitación exige id_estadia_externa e id_cuenta_cobro_externa.',
      path: ['id_cuenta_cobro_externa'],
    }
  )
  .refine(
    (d) => d.forma_cobro !== 'incluido en paquete' || Boolean(d.id_estadia_externa && d.id_paquete_externo),
    {
      message: 'Incluido en paquete exige id_estadia_externa e id_paquete_externo.',
      path: ['id_paquete_externo'],
    }
  );

export const createMovimientoInventarioBodySchema = z.object({
  id_articulo: varcharIdSchema,
  id_lote: varcharIdSchema.optional().nullable(),
  tipo_movimiento: z.string().trim().min(2).max(40),
  cantidad: z.coerce.number().positive(),
  signo: z.enum(['entrada', 'salida']),
  motivo: motivoSchema,
  id_origen: varcharIdSchema.default('MANUAL'),
  modulo_origen: z.enum(['Almacén', 'Compras', 'Housekeeping y Mantenimiento']).default('Almacén'),
  costo_unitario: moneyStringSchema.optional().nullable(),
  fecha_vencimiento: dateOnlySchema.optional().nullable(), // entrada con lote nuevo
});

export const createOrdenCompraBodySchema = z.object({
  id_proveedor: varcharIdSchema,
  fecha_entrega_esperada: dateOnlySchema,
  items: z
    .array(
      z.object({
        id_articulo: varcharIdSchema,
        cantidad_solicitada: z.coerce.number().positive(),
        precio_referencia_capturado: moneyStringSchema,
      })
    )
    .min(1)
    .max(50),
});

export const decisionOrdenCompraBodySchema = z.object({
  motivo_decision: motivoSchema,
});

export const enviarOrdenCompraBodySchema = z.object({
  medio_envio: z.string().trim().min(2).max(40),
});

export const recibirOrdenCompraBodySchema = z.object({
  numero_guia_factura: z.string().trim().max(30).optional().nullable(),
  items: z
    .array(
      z
        .object({
          id_detalle_orden: varcharIdSchema,
          cantidad_aceptada: z.coerce.number().min(0),
          cantidad_rechazada: z.coerce.number().min(0).default(0),
          motivo_rechazo: z.string().trim().max(500).optional().nullable(),
          costo_unitario: moneyStringSchema,
          fecha_vencimiento: dateOnlySchema.optional().nullable(),
        })
        .refine((i) => i.cantidad_aceptada + i.cantidad_rechazada > 0, {
          message: 'Cada línea recibida debe tener cantidad mayor a 0.',
        })
        .refine((i) => i.cantidad_rechazada === 0 || Boolean(i.motivo_rechazo && i.motivo_rechazo.trim().length > 0), {
          message: 'Las cantidades rechazadas requieren motivo_rechazo.',
          path: ['motivo_rechazo'],
        })
    )
    .min(1),
});
