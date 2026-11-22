import { z } from 'zod';

export const bigintIdSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/, 'Debe ser un identificador numérico entero positivo en texto.');

export const uuidSchema = z.string().trim().uuid('Debe ser un UUID válido.');

export const varcharIdSchema = z
  .string()
  .trim()
  .min(1, 'Identificador requerido.')
  .max(36, 'El identificador excede la longitud máxima de 36 caracteres.');

export const dateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD.');

export const moneyStringSchema = z
  .union([z.number(), z.string()])
  .transform((val) => (typeof val === 'number' ? val.toFixed(2) : val.trim()))
  .refine((val) => /^\d+(\.\d{1,2})?$/.test(val), 'El importe debe ser un monto decimal válido con hasta 2 decimales.')
  .refine((val) => Number(val) >= 0, 'El importe no puede ser negativo.');

export const positiveMoneyStringSchema = moneyStringSchema.refine(
  (val) => Number(val) > 0,
  'El importe debe ser mayor a cero.'
);

export const motivoSchema = z
  .string()
  .trim()
  .min(5, 'El motivo debe tener al menos 5 caracteres.')
  .max(500, 'El motivo no puede exceder los 500 caracteres.');

export const rucSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{11}$/, 'El RUC debe contener exactamente 11 dígitos numéricos.');

export const dniSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{8}$/, 'El DNI debe contener exactamente 8 dígitos numéricos.');
