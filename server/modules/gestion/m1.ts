import type { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/authorize.ts';
import { validateBody, validateParams } from '../../middleware/validate.ts';
import { withReadOnlyClient, withTransaction } from '../../shared/database/transaction.ts';
import { DomainRuleError, NotFoundError } from '../../shared/errors/app-error.ts';
import { bigintIdSchema, dateOnlySchema, moneyStringSchema } from '../../shared/validation/common.ts';
import { PERMISSIONS } from '../seguridad/permissions.ts';
import { handle } from './helpers.ts';

const idParam = z.object({ id: bigintIdSchema });

export const createHabitacionSchema = z.object({
  numero: z.string().trim().min(1).max(20),
  piso: z.number().int().min(-5).max(100),
  id_tipo_habitacion: bigintIdSchema,
});

export const updateHabitacionSchema = z
  .object({
    numero: z.string().trim().min(1).max(20).optional(),
    piso: z.number().int().min(-5).max(100).optional(),
    id_tipo_habitacion: bigintIdSchema.optional(),
    estado_registro: z.enum(['ACTIVA', 'INACTIVA']).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Indica al menos un campo a modificar.' });

export const createTarifaSchema = z
  .object({
    id_tipo_habitacion: bigintIdSchema,
    id_temporada: bigintIdSchema,
    id_canal_reserva: bigintIdSchema,
    nombre: z.string().trim().min(3).max(100),
    precio_base: moneyStringSchema,
    fecha_inicio: dateOnlySchema,
    fecha_fin: dateOnlySchema,
  })
  .refine((d) => d.fecha_fin >= d.fecha_inicio, { message: 'La fecha de fin no puede ser anterior al inicio.', path: ['fecha_fin'] });

export const updateTarifaSchema = z
  .object({
    nombre: z.string().trim().min(3).max(100).optional(),
    precio_base: moneyStringSchema.optional(),
    fecha_inicio: dateOnlySchema.optional(),
    fecha_fin: dateOnlySchema.optional(),
    estado: z.enum(['ACTIVA', 'INACTIVA']).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Indica al menos un campo a modificar.' });

export const resolverEsperaSchema = z.object({
  estado: z.enum(['ATENDIDA', 'CANCELADA']),
});

export const aplicarTarifaDinamicaSchema = z.object({
  id_tipo_habitacion: bigintIdSchema,
  // Variación porcentual sobre las tarifas vigentes (p. ej. 5 = +5 %, -10 = -10 %).
  porcentaje: z.number().min(-30).max(30).refine((v) => v !== 0, { message: 'El ajuste no puede ser 0 %.' }),
  motivo: z.string().trim().min(5, 'Indica el motivo (mínimo 5 caracteres).').max(300),
});

/**
 * Regla de sugerencia de tarifa dinámica. Es una regla simple y explícita basada en la ocupación
 * proyectada de los próximos 7 días por tipo de habitación; los umbrales son configurables aquí.
 */
export const REGLA_TARIFA_DINAMICA = {
  horizonte_dias: 7,
  tramos: [
    { desde: 0.85, ajuste_pct: 10 },
    { desde: 0.7, ajuste_pct: 5 },
    { desde: 0.55, ajuste_pct: 0 },
    { desde: 0.4, ajuste_pct: -5 },
    { desde: 0, ajuste_pct: -10 },
  ],
} as const;

export function sugerirAjuste(ocupacion: number): number {
  for (const t of REGLA_TARIFA_DINAMICA.tramos) if (ocupacion >= t.desde) return t.ajuste_pct;
  return 0;
}

export function registerM1Gestion(router: Router): void {
  // Resolver una entrada de la lista de espera (solo desde PENDIENTE).
  router.post(
    '/lista-espera/:id/resolver',
    requirePermission(PERMISSIONS.M1_RESERVA_ACTUALIZAR),
    validateParams(idParam),
    validateBody(resolverEsperaSchema),
    handle((req) =>
      withTransaction(req.authContext!, async (client) => {
        const b = req.body as z.infer<typeof resolverEsperaSchema>;
        const cur = await client.query<{ estado: string }>(
          `SELECT estado FROM g1_reservas.lista_espera WHERE id_lista_espera = $1::bigint FOR UPDATE`,
          [req.params.id]
        );
        if (!cur.rows[0]) throw new NotFoundError('Entrada de lista de espera no encontrada.');
        if (cur.rows[0].estado !== 'PENDIENTE') {
          throw new DomainRuleError(`La entrada ya está ${cur.rows[0].estado.toLowerCase()}; solo se pueden resolver las pendientes.`);
        }
        const res = await client.query(
          `UPDATE g1_reservas.lista_espera SET estado = $2 WHERE id_lista_espera = $1::bigint
           RETURNING id_lista_espera::text AS id_lista_espera, estado`,
          [req.params.id, b.estado]
        );
        return res.rows[0];
      })
    )
  );

  // Tarifa dinámica: ocupación proyectada, demanda en espera, precio vigente y ajuste sugerido por tipo.
  router.get(
    '/tarifas/dinamica',
    requirePermission(PERMISSIONS.M1_TARIFA_CONSULTAR),
    handle((req) =>
      withReadOnlyClient(async (client) => {
        const dias = REGLA_TARIFA_DINAMICA.horizonte_dias;
        const res = await client.query<{
          id_tipo_habitacion: string; tipo: string; habitaciones: number; noches_ocupadas: number;
          en_espera: number; precio_vigente: string | null; tarifas_vigentes: number;
        }>(
          `WITH dias AS (
             SELECT d::date AS dia FROM generate_series(CURRENT_DATE, CURRENT_DATE + ($1::int - 1), interval '1 day') d
           ),
           hab AS (
             SELECT th.id_tipo_habitacion, th.nombre, COUNT(h.id_habitacion)::int AS habitaciones
             FROM g1_reservas.tipo_habitacion th
             LEFT JOIN g1_reservas.habitacion h ON h.id_tipo_habitacion = th.id_tipo_habitacion AND h.estado_registro = 'ACTIVA'
             WHERE th.estado = 'ACTIVO' GROUP BY th.id_tipo_habitacion, th.nombre
           ),
           ocu AS (
             SELECT h.id_tipo_habitacion, COUNT(*)::int AS noches
             FROM g1_reservas.reserva r
             JOIN g1_reservas.detalle_reserva dr ON dr.id_reserva = r.id_reserva
             JOIN g1_reservas.habitacion h ON h.id_habitacion = dr.id_habitacion
             JOIN dias ON dias.dia >= r.fecha_ingreso AND dias.dia < r.fecha_salida
             WHERE r.estado IN ('CONFIRMADA', 'EN_CURSO', 'PENDIENTE')
             GROUP BY h.id_tipo_habitacion
           ),
           esp AS (
             SELECT id_tipo_habitacion, COUNT(*)::int AS n
             FROM g1_reservas.lista_espera WHERE estado = 'PENDIENTE' GROUP BY id_tipo_habitacion
           ),
           tar AS (
             SELECT id_tipo_habitacion, MAX(precio_base) AS precio, COUNT(*)::int AS n
             FROM g1_reservas.tarifa
             WHERE estado = 'ACTIVA' AND CURRENT_DATE BETWEEN fecha_inicio AND fecha_fin
             GROUP BY id_tipo_habitacion
           )
           SELECT hab.id_tipo_habitacion::text AS id_tipo_habitacion, hab.nombre AS tipo, hab.habitaciones,
                  COALESCE(ocu.noches, 0) AS noches_ocupadas, COALESCE(esp.n, 0) AS en_espera,
                  tar.precio::text AS precio_vigente, COALESCE(tar.n, 0) AS tarifas_vigentes
           FROM hab
           LEFT JOIN ocu ON ocu.id_tipo_habitacion = hab.id_tipo_habitacion
           LEFT JOIN esp ON esp.id_tipo_habitacion = hab.id_tipo_habitacion
           LEFT JOIN tar ON tar.id_tipo_habitacion = hab.id_tipo_habitacion
           ORDER BY hab.nombre`,
          [dias]
        );
        const tipos = res.rows.map((r) => {
          const capacidad = r.habitaciones * dias;
          const ocupacion = capacidad > 0 ? Math.min(1, r.noches_ocupadas / capacidad) : 0;
          const precio = r.precio_vigente === null ? null : Number(r.precio_vigente);
          const ajuste = r.tarifas_vigentes > 0 && capacidad > 0 ? sugerirAjuste(ocupacion) : 0;
          return {
            id_tipo_habitacion: r.id_tipo_habitacion,
            tipo: r.tipo,
            habitaciones: r.habitaciones,
            noches_ocupadas: r.noches_ocupadas,
            noches_disponibles: capacidad,
            ocupacion_proyectada: Number(ocupacion.toFixed(4)),
            en_espera: r.en_espera,
            precio_vigente: precio,
            tarifas_vigentes: r.tarifas_vigentes,
            ajuste_sugerido_pct: ajuste,
            precio_sugerido: precio === null ? null : Number((precio * (1 + ajuste / 100)).toFixed(2)),
          };
        });
        return { horizonte_dias: dias, regla: REGLA_TARIFA_DINAMICA.tramos, tipos };
      }, req.authContext!)
    )
  );

  // Aplica el ajuste porcentual a todas las tarifas ACTIVAS vigentes hoy del tipo indicado.
  router.post(
    '/tarifas/dinamica/aplicar',
    requirePermission(PERMISSIONS.M1_TARIFA_ADMINISTRAR),
    validateBody(aplicarTarifaDinamicaSchema),
    handle((req) =>
      withTransaction(req.authContext!, async (client) => {
        const b = req.body as z.infer<typeof aplicarTarifaDinamicaSchema>;
        const res = await client.query<{ id_tarifa: string; anterior: string; nuevo: string }>(
          `WITH prev AS (
             SELECT id_tarifa, precio_base FROM g1_reservas.tarifa
             WHERE id_tipo_habitacion = $1::bigint AND estado = 'ACTIVA' AND CURRENT_DATE BETWEEN fecha_inicio AND fecha_fin
             FOR UPDATE
           )
           UPDATE g1_reservas.tarifa t
              SET precio_base = ROUND(prev.precio_base * (1 + $2::numeric / 100), 2)
             FROM prev WHERE t.id_tarifa = prev.id_tarifa
           RETURNING t.id_tarifa::text AS id_tarifa, prev.precio_base::text AS anterior, t.precio_base::text AS nuevo`,
          [b.id_tipo_habitacion, b.porcentaje]
        );
        if (res.rows.length === 0) throw new DomainRuleError('Ese tipo de habitación no tiene tarifas activas vigentes hoy.');
        return { id_tipo_habitacion: b.id_tipo_habitacion, porcentaje: b.porcentaje, motivo: b.motivo, tarifas_actualizadas: res.rows.length, detalle: res.rows };
      })
    )
  );

  // Catálogos para los formularios: tipos de habitación, temporadas y canales.
  router.get(
    '/catalogos',
    requirePermission(PERMISSIONS.M1_TARIFA_CONSULTAR),
    handle(async (req) =>
      withReadOnlyClient(async (client) => {
        const tipos = await client.query(
          `SELECT id_tipo_habitacion::text AS id, nombre, capacidad, COALESCE(to_jsonb(caracteristicas), '[]'::jsonb) AS caracteristicas
           FROM g1_reservas.tipo_habitacion WHERE estado = 'ACTIVO' ORDER BY nombre`
        );
        const temporadas = await client.query(
          `SELECT id_temporada::text AS id, nombre, fecha_inicio::text AS fecha_inicio, fecha_fin::text AS fecha_fin,
                  factor_ajuste::text AS factor_ajuste
           FROM g1_reservas.temporada WHERE estado = 'ACTIVA' ORDER BY fecha_inicio`
        );
        const canales = await client.query(
          `SELECT id_canal_reserva::text AS id, nombre FROM g1_reservas.canal_reserva WHERE estado = 'ACTIVO' ORDER BY nombre`
        );
        return { tipos: tipos.rows, temporadas: temporadas.rows, canales: canales.rows };
      }, req.authContext!)
    )
  );

  router.post(
    '/habitaciones',
    requirePermission(PERMISSIONS.M1_HABITACION_ADMINISTRAR),
    validateBody(createHabitacionSchema),
    handle(
      (req) =>
        withTransaction(req.authContext!, async (client) => {
          const b = req.body as z.infer<typeof createHabitacionSchema>;
          const res = await client.query(
            `INSERT INTO g1_reservas.habitacion (id_tipo_habitacion, numero, piso)
             VALUES ($1::bigint, $2, $3)
             RETURNING id_habitacion::text AS id_habitacion, numero, piso, id_tipo_habitacion::text AS id_tipo_habitacion, estado_registro`,
            [b.id_tipo_habitacion, b.numero, b.piso]
          );
          // Estado inicial de housekeeping: disponible para la venta.
          await client.query(
            `INSERT INTO g2_housekeeping.cambio_estado_habitacion (id_habitacion, id_estado_anterior, id_estado_nuevo, origen, motivo)
             VALUES ($1::bigint, NULL, 'DIS', 'Manual', 'Alta de la habitación en el sistema')`,
            [res.rows[0].id_habitacion]
          );
          return res.rows[0];
        }),
      201
    )
  );

  router.put(
    '/habitaciones/:id',
    requirePermission(PERMISSIONS.M1_HABITACION_ADMINISTRAR),
    validateParams(idParam),
    validateBody(updateHabitacionSchema),
    handle((req) =>
      withTransaction(req.authContext!, async (client) => {
        const b = req.body as z.infer<typeof updateHabitacionSchema>;
        const res = await client.query(
          `UPDATE g1_reservas.habitacion SET
             numero = COALESCE($2, numero),
             piso = COALESCE($3, piso),
             id_tipo_habitacion = COALESCE($4::bigint, id_tipo_habitacion),
             estado_registro = COALESCE($5, estado_registro)
           WHERE id_habitacion = $1::bigint
           RETURNING id_habitacion::text AS id_habitacion, numero, piso, id_tipo_habitacion::text AS id_tipo_habitacion, estado_registro`,
          [req.params.id, b.numero ?? null, b.piso ?? null, b.id_tipo_habitacion ?? null, b.estado_registro ?? null]
        );
        if (!res.rows[0]) throw new NotFoundError('Habitación no encontrada.');
        return res.rows[0];
      })
    )
  );

  router.post(
    '/tarifas',
    requirePermission(PERMISSIONS.M1_TARIFA_ADMINISTRAR),
    validateBody(createTarifaSchema),
    handle(
      (req) =>
        withTransaction(req.authContext!, async (client) => {
          const b = req.body as z.infer<typeof createTarifaSchema>;
          const res = await client.query(
            `INSERT INTO g1_reservas.tarifa (id_tipo_habitacion, id_temporada, id_canal_reserva, nombre, precio_base, fecha_inicio, fecha_fin)
             VALUES ($1::bigint, $2::bigint, $3::bigint, $4, $5::numeric(12,2), $6::date, $7::date)
             RETURNING id_tarifa::text AS id_tarifa, nombre, precio_base::text AS precio_base, estado`,
            [b.id_tipo_habitacion, b.id_temporada, b.id_canal_reserva, b.nombre, b.precio_base, b.fecha_inicio, b.fecha_fin]
          );
          return res.rows[0];
        }),
      201
    )
  );

  router.put(
    '/tarifas/:id',
    requirePermission(PERMISSIONS.M1_TARIFA_ADMINISTRAR),
    validateParams(idParam),
    validateBody(updateTarifaSchema),
    handle((req) =>
      withTransaction(req.authContext!, async (client) => {
        const b = req.body as z.infer<typeof updateTarifaSchema>;
        const res = await client.query(
          `UPDATE g1_reservas.tarifa SET
             nombre = COALESCE($2, nombre),
             precio_base = COALESCE($3::numeric(12,2), precio_base),
             fecha_inicio = COALESCE($4::date, fecha_inicio),
             fecha_fin = COALESCE($5::date, fecha_fin),
             estado = COALESCE($6, estado)
           WHERE id_tarifa = $1::bigint
           RETURNING id_tarifa::text AS id_tarifa, nombre, precio_base::text AS precio_base, estado`,
          [req.params.id, b.nombre ?? null, b.precio_base ?? null, b.fecha_inicio ?? null, b.fecha_fin ?? null, b.estado ?? null]
        );
        if (!res.rows[0]) throw new NotFoundError('Tarifa no encontrada.');
        return res.rows[0];
      })
    )
  );
}
