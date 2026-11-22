import type { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/authorize.ts';
import { validateBody, validateParams } from '../../middleware/validate.ts';
import { withReadOnlyClient, withTransaction } from '../../shared/database/transaction.ts';
import { DomainRuleError, NotFoundError } from '../../shared/errors/app-error.ts';
import { motivoSchema, positiveMoneyStringSchema, varcharIdSchema } from '../../shared/validation/common.ts';
import { emitirComprobanteService } from '../m4/service.ts';
import { PERMISSIONS } from '../seguridad/permissions.ts';
import { handle } from './helpers.ts';

const idParam = z.object({ id: varcharIdSchema });

export const pagoCxcSchema = z.object({
  monto: positiveMoneyStringSchema,
  nota: z.string().trim().max(200).optional().nullable(),
});

export const movimientoCajaSchema = z.object({
  tipo: z.enum(['INGRESO', 'EGRESO']),
  importe: positiveMoneyStringSchema,
  motivo: z.string().trim().min(3).max(250),
});

export const anularComprobanteSchema = z.object({ motivo_nota: motivoSchema.max(250) });

function requireG4User(ctx: { idUsuarioG4?: number | null }): number {
  if (!ctx.idUsuarioG4) {
    throw new DomainRuleError('Tu usuario no está vinculado a un usuario de Finanzas (g4_finanzas.usuario).');
  }
  return ctx.idUsuarioG4;
}

export function registerM4Gestion(router: Router): void {
  // ---- Cuentas por cobrar: registrar un pago (total o parcial)
  router.post(
    '/cuentas-por-cobrar/:id/pagos',
    requirePermission(PERMISSIONS.M4_CXC_ADMINISTRAR),
    validateParams(idParam),
    validateBody(pagoCxcSchema),
    handle((req) =>
      withTransaction(req.authContext!, async (client) => {
        const b = req.body as z.infer<typeof pagoCxcSchema>;
        const cur = await client.query<{ estado: string; saldo_pendiente: string }>(
          `SELECT estado, saldo_pendiente::text AS saldo_pendiente
           FROM g4_finanzas.cuenta_por_cobrar WHERE id_cuenta_por_cobrar = $1 FOR UPDATE`,
          [req.params.id]
        );
        const row = cur.rows[0];
        if (!row) throw new NotFoundError('Cuenta por cobrar no encontrada.');
        if (row.estado === 'PAGADA') throw new DomainRuleError('La cuenta por cobrar ya está pagada.');
        if (Number(b.monto) > Number(row.saldo_pendiente) + 0.001) {
          throw new DomainRuleError(`El pago (S/ ${b.monto}) supera el saldo pendiente (S/ ${row.saldo_pendiente}).`);
        }
        // El trigger de la tabla recalcula el estado (VIGENTE / VENCIDA / PAGADA) y el saldo.
        const upd = await client.query(
          `UPDATE g4_finanzas.cuenta_por_cobrar
           SET monto_pagado = monto_pagado + $2::numeric(12,2),
               nota_seguimiento = CASE WHEN $3::text IS NULL THEN nota_seguimiento
                                       ELSE concat_ws(' | ', nota_seguimiento, $3::text) END
           WHERE id_cuenta_por_cobrar = $1
           RETURNING id_cuenta_por_cobrar AS id_cxc, monto_pagado::text AS monto_pagado,
                     saldo_pendiente::text AS saldo_pendiente, estado`,
          [req.params.id, b.monto, b.nota ?? null]
        );
        return upd.rows[0];
      })
    )
  );

  // ---- Caja: movimientos manuales del turno
  router.get(
    '/turnos-caja/:id/movimientos',
    requirePermission(PERMISSIONS.M4_CUENTA_CONSULTAR),
    validateParams(idParam),
    handle((req) =>
      withReadOnlyClient(async (client) => {
        const res = await client.query(
          `SELECT id_movimiento_caja, id_turno_caja, tipo, importe::text AS importe, motivo, fecha_hora::text AS fecha_hora
           FROM g4_finanzas.movimiento_caja WHERE id_turno_caja = $1 ORDER BY fecha_hora ASC`,
          [req.params.id]
        );
        return res.rows;
      }, req.authContext!)
    )
  );

  router.post(
    '/turnos-caja/:id/movimientos',
    requirePermission(PERMISSIONS.M4_CAJA_OPERAR),
    validateParams(idParam),
    validateBody(movimientoCajaSchema),
    handle(
      (req) =>
        withTransaction(req.authContext!, async (client) => {
          const idUsuario = requireG4User(req.authContext!);
          const b = req.body as z.infer<typeof movimientoCajaSchema>;
          const turno = await client.query<{ estado: string }>(
            `SELECT estado FROM g4_finanzas.turno_caja WHERE id_turno_caja = $1 FOR UPDATE`,
            [req.params.id]
          );
          if (!turno.rows[0]) throw new NotFoundError('Turno de caja no encontrado.');
          if (turno.rows[0].estado !== 'ABIERTA') throw new DomainRuleError('El turno de caja está cerrado.');
          const res = await client.query(
            `INSERT INTO g4_finanzas.movimiento_caja (id_turno_caja, id_usuario, tipo, importe, motivo)
             VALUES ($1, $2, $3, $4::numeric(12,2), $5)
             RETURNING id_movimiento_caja, id_turno_caja, tipo, importe::text AS importe, motivo, fecha_hora::text AS fecha_hora`,
            [req.params.id, idUsuario, b.tipo, b.importe, b.motivo]
          );
          return res.rows[0];
        }),
      201
    )
  );

  // ---- Anular un comprobante emitiendo su nota de crédito (anulación total) en una sola transacción
  router.post(
    '/comprobantes/:id/anular',
    requirePermission(PERMISSIONS.M4_COMPROBANTE_EMITIR),
    validateParams(idParam),
    validateBody(anularComprobanteSchema),
    handle(
      (req) =>
        withTransaction(req.authContext!, async (client) => {
          const b = req.body as z.infer<typeof anularComprobanteSchema>;
          const ref = await client.query(
            `SELECT id_comprobante, id_cuenta, tipo, serie, estado, tipo_documento_cliente, numero_documento_cliente,
                    razon_social_cliente, direccion_cliente, operacion_gravada::text AS operacion_gravada
             FROM g4_finanzas.comprobante WHERE id_comprobante = $1 FOR UPDATE`,
            [req.params.id]
          );
          const c = ref.rows[0];
          if (!c) throw new NotFoundError('Comprobante no encontrado.');
          if (c.tipo === 'NOTA_CREDITO') throw new DomainRuleError('Una nota de crédito no se anula.');
          if (c.estado === 'ANULADO') throw new DomainRuleError('El comprobante ya está anulado.');

          // Serie de la nota: misma letra que el comprobante (F/B) + C01, según la convención SUNAT.
          const nota = await emitirComprobanteService(
            req.authContext!,
            {
              id_cuenta: c.id_cuenta,
              tipo: 'NOTA_CREDITO',
              serie: `${String(c.serie).charAt(0)}C01`,
              tipo_documento_cliente: c.tipo_documento_cliente,
              numero_documento_cliente: c.numero_documento_cliente,
              razon_social_cliente: c.razon_social_cliente,
              direccion_cliente: c.direccion_cliente,
              operacion_gravada: c.operacion_gravada,
              id_comprobante_ref: c.id_comprobante,
              motivo_nota: b.motivo_nota,
            },
            client
          );
          await client.query(`UPDATE g4_finanzas.comprobante SET estado = 'ANULADO' WHERE id_comprobante = $1`, [c.id_comprobante]);
          return { comprobante_anulado: c.id_comprobante, nota_credito: nota };
        }),
      201
    )
  );
}
