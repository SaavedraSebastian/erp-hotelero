import type { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/authorize.ts';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';
import { withReadOnlyClient, withTransaction } from '../../shared/database/transaction.ts';
import { ConflictError, DomainRuleError, NotFoundError } from '../../shared/errors/app-error.ts';
import { bigintIdSchema, dateOnlySchema, varcharIdSchema } from '../../shared/validation/common.ts';
import { PERMISSIONS } from '../seguridad/permissions.ts';
import { buildPaginatedResponse, paginationQuerySchema, parsePagination, pushDateRange, pushSearchFilter, pushStatusFilter } from '../../shared/pagination/index.ts';
import { handle } from './helpers.ts';
import { crearRequisicion } from './m3.ts';

const idParam = z.object({ id: bigintIdSchema });
const planActivoParams = z.object({ plan: bigintIdSchema, activo: bigintIdSchema });

export const createActivoSchema = z
  .object({
    nombre: z.string().trim().min(3).max(60),
    id_tipo_activo: bigintIdSchema,
    id_habitacion: bigintIdSchema.optional().nullable(),
    id_area: bigintIdSchema.optional().nullable(),
    marca: z.string().trim().max(30).optional().nullable(),
    modelo: z.string().trim().max(30).optional().nullable(),
    fecha_instalacion: dateOnlySchema,
    horas_uso_acumuladas: z.number().int().min(0).default(0),
  })
  .refine((d) => Boolean(d.id_habitacion) !== Boolean(d.id_area), {
    message: 'El activo debe estar en una habitación o en un área (solo una de las dos).',
    path: ['id_habitacion'],
  });

export const updateActivoSchema = z
  .object({
    nombre: z.string().trim().min(3).max(60).optional(),
    marca: z.string().trim().max(30).optional().nullable(),
    modelo: z.string().trim().max(30).optional().nullable(),
    horas_uso_acumuladas: z.number().int().min(0).optional(),
    estado: z.enum(['Operativo', 'En reparación', 'Dado de baja']).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Indica al menos un campo a modificar.' });

export const createPreventivoSchema = z.object({
  id_activo: bigintIdSchema,
  tarea: z.string().trim().min(5).max(150),
  tipo_periodicidad: z.enum(['Días', 'Semanas', 'Meses', 'HorasUso']),
  valor_periodicidad: z.number().int().positive().max(100000),
  fecha_proxima: dateOnlySchema.optional().nullable(),
});

export const requisicionSchema = z.object({
  id_articulo: varcharIdSchema,
  cantidad: z.coerce.number().positive().max(1000000),
});

const UBICACION_SQL = `COALESCE('Hab. ' || h.numero, ar.nombre)`;

export function registerM2Gestion(router: Router): void {
  router.get(
    '/catalogos',
    requirePermission(PERMISSIONS.M2_MANTENIMIENTO_CONSULTAR),
    handle((req) =>
      withReadOnlyClient(async (client) => {
        const tipos = await client.query(`SELECT id_tipo_activo::text AS id, nombre, vida_util_horas FROM g2_housekeeping.tipo_activo ORDER BY nombre`);
        const areas = await client.query(`SELECT id_area::text AS id, nombre FROM g2_housekeeping.area ORDER BY nombre`);
        return { tipos_activo: tipos.rows, areas: areas.rows };
      }, req.authContext!)
    )
  );

  // ---- Historial de inspecciones (paginado; filtros: search = habitación o supervisor, status = resultado, fechas)
  router.get(
    '/inspecciones',
    requirePermission(PERMISSIONS.M2_LIMPIEZA_CONSULTAR),
    validateQuery(paginationQuerySchema),
    handle((req) =>
      withReadOnlyClient(async (client) => {
        const params = parsePagination(req.query as Record<string, unknown>);
        const values: unknown[] = [];
        const where: string[] = [];
        pushStatusFilter(values, where, 'i.resultado', params.status);
        pushDateRange(values, where, 'i.fecha_hora', params.fromDate, params.toDate);
        pushSearchFilter(values, where, ['h.numero', "(po.nombres || ' ' || po.apellidos)", 'i.motivo_rechazo'], params.search);
        const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
        const from = `FROM g2_housekeeping.inspeccion i
           JOIN g2_housekeeping.orden_limpieza ol ON ol.numero_orden = i.numero_orden
           JOIN g1_reservas.habitacion h ON h.id_habitacion = ol.id_habitacion
           LEFT JOIN g2_housekeeping.personal_operativo po ON po.id_personal = i.id_supervisor`;
        const count = await client.query<{ total: string }>(`SELECT COUNT(*)::text AS total ${from} ${whereClause}`, values);
        values.push(params.pageSize, (params.page - 1) * params.pageSize);
        const res = await client.query(
          `SELECT i.id_inspeccion::text AS id_inspeccion, i.numero_orden::text AS numero_orden,
                  i.resultado, i.motivo_rechazo, i.lista_verificacion, i.fecha_hora,
                  h.numero AS numero_habitacion,
                  NULLIF(btrim(COALESCE(po.nombres, '') || ' ' || COALESCE(po.apellidos, '')), '') AS supervisor
           ${from}
           ${whereClause}
           ORDER BY i.fecha_hora DESC, i.id_inspeccion DESC
           LIMIT $${values.length - 1} OFFSET $${values.length}`,
          values
        );
        return buildPaginatedResponse(res.rows, Number(count.rows[0]?.total ?? 0), params.page, params.pageSize);
      }, req.authContext!)
    , 200, true)
  );

  // ---- Activos
  router.get(
    '/activos',
    requirePermission(PERMISSIONS.M2_MANTENIMIENTO_CONSULTAR),
    handle((req) =>
      withReadOnlyClient(async (client) => {
        const res = await client.query(
          `SELECT
             a.id_activo::text AS id_activo, a.codigo_activo, a.nombre, a.id_tipo_activo::text AS id_tipo_activo,
             ta.nombre AS tipo_nombre, ta.vida_util_horas,
             a.id_habitacion::text AS id_habitacion, h.numero AS numero_habitacion,
             a.id_area::text AS id_area, ar.nombre AS area_nombre,
             a.marca, a.modelo, a.fecha_instalacion::text AS fecha_instalacion,
             a.horas_uso_acumuladas::text AS horas_uso_acumuladas, a.estado,
             (SELECT ap.probabilidad_falla::text FROM g2_housekeeping.alerta_predictiva ap
               WHERE ap.id_activo = a.id_activo ORDER BY ap.fecha_hora_generacion DESC LIMIT 1) AS probabilidad_falla
           FROM g2_housekeeping.activo a
           JOIN g2_housekeeping.tipo_activo ta ON ta.id_tipo_activo = a.id_tipo_activo
           LEFT JOIN g1_reservas.habitacion h ON h.id_habitacion = a.id_habitacion
           LEFT JOIN g2_housekeeping.area ar ON ar.id_area = a.id_area
           ORDER BY a.codigo_activo
           LIMIT 1000`
        );
        return res.rows;
      }, req.authContext!)
    )
  );

  router.post(
    '/activos',
    requirePermission(PERMISSIONS.M2_MANTENIMIENTO_CREAR),
    validateBody(createActivoSchema),
    handle(
      (req) =>
        withTransaction(req.authContext!, async (client) => {
          const b = req.body as z.infer<typeof createActivoSchema>;
          await client.query(`SELECT pg_advisory_xact_lock(hashtext('g2_housekeeping.activo.codigo'))`);
          const res = await client.query(
            `INSERT INTO g2_housekeeping.activo
               (codigo_activo, id_tipo_activo, id_habitacion, id_area, nombre, marca, modelo, fecha_instalacion, horas_uso_acumuladas)
             SELECT 'ACT-' || lpad((COALESCE(MAX(substring(codigo_activo from 5)::int), 0) + 1)::text, 5, '0'),
                    $1::bigint, $2::bigint, $3::bigint, $4, $5, $6, $7::date, $8
             FROM g2_housekeeping.activo
             RETURNING id_activo::text AS id_activo, codigo_activo, nombre, estado`,
            [b.id_tipo_activo, b.id_habitacion ?? null, b.id_area ?? null, b.nombre, b.marca ?? null, b.modelo ?? null, b.fecha_instalacion, b.horas_uso_acumuladas]
          );
          return res.rows[0];
        }),
      201
    )
  );

  router.put(
    '/activos/:id',
    requirePermission(PERMISSIONS.M2_MANTENIMIENTO_CREAR),
    validateParams(idParam),
    validateBody(updateActivoSchema),
    handle((req) =>
      withTransaction(req.authContext!, async (client) => {
        const b = req.body as z.infer<typeof updateActivoSchema>;
        const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
        const res = await client.query(
          `UPDATE g2_housekeeping.activo SET
             nombre = COALESCE($2, nombre),
             marca = CASE WHEN $3::boolean THEN $4 ELSE marca END,
             modelo = CASE WHEN $5::boolean THEN $6 ELSE modelo END,
             horas_uso_acumuladas = COALESCE($7, horas_uso_acumuladas),
             estado = COALESCE($8, estado)
           WHERE id_activo = $1::bigint
           RETURNING id_activo::text AS id_activo, codigo_activo, nombre, estado`,
          [req.params.id, b.nombre ?? null, has('marca'), b.marca ?? null, has('modelo'), b.modelo ?? null, b.horas_uso_acumuladas ?? null, b.estado ?? null]
        );
        if (!res.rows[0]) throw new NotFoundError('Activo no encontrado.');
        return res.rows[0];
      })
    )
  );

  // ---- Mantenimiento preventivo: un plan (tarea + periodicidad) por tipo de activo, programado por activo
  router.get(
    '/preventivo',
    requirePermission(PERMISSIONS.M2_MANTENIMIENTO_CONSULTAR),
    handle((req) =>
      withReadOnlyClient(async (client) => {
        const res = await client.query(
          `SELECT
             pp.id_plan::text AS id_plan, pp.id_activo::text AS id_activo, a.codigo_activo, a.nombre AS activo_nombre,
             ${UBICACION_SQL} AS ubicacion,
             pm.tarea, pm.tipo_periodicidad, pm.valor_periodicidad, pm.estado AS estado_plan,
             pp.fecha_ultima_ejecucion::text AS fecha_ultima_ejecucion,
             pp.fecha_proxima_ejecucion::text AS fecha_proxima_ejecucion,
             pp.horas_proxima_ejecucion::text AS horas_proxima_ejecucion
           FROM g2_housekeeping.programacion_preventiva pp
           JOIN g2_housekeeping.plan_mantenimiento pm ON pm.id_plan = pp.id_plan
           JOIN g2_housekeeping.activo a ON a.id_activo = pp.id_activo
           LEFT JOIN g1_reservas.habitacion h ON h.id_habitacion = a.id_habitacion
           LEFT JOIN g2_housekeeping.area ar ON ar.id_area = a.id_area
           ORDER BY pp.fecha_proxima_ejecucion ASC NULLS LAST, a.codigo_activo
           LIMIT 1000`
        );
        return res.rows;
      }, req.authContext!)
    )
  );

  router.post(
    '/preventivo',
    requirePermission(PERMISSIONS.M2_MANTENIMIENTO_CREAR),
    validateBody(createPreventivoSchema),
    handle(
      (req) =>
        withTransaction(req.authContext!, async (client) => {
          const b = req.body as z.infer<typeof createPreventivoSchema>;
          const act = await client.query<{ id_tipo_activo: string; horas: string }>(
            `SELECT id_tipo_activo::text AS id_tipo_activo, horas_uso_acumuladas::text AS horas
             FROM g2_housekeeping.activo WHERE id_activo = $1::bigint`,
            [b.id_activo]
          );
          if (!act.rows[0]) throw new NotFoundError('Activo no encontrado.');
          // Se reutiliza el plan existente del tipo de activo (misma tarea y periodicidad) o se crea uno.
          let plan = await client.query<{ id_plan: string }>(
            `SELECT id_plan::text AS id_plan FROM g2_housekeeping.plan_mantenimiento
             WHERE id_tipo_activo = $1::bigint AND tarea = $2 AND tipo_periodicidad = $3 AND valor_periodicidad = $4 AND estado = 'A'`,
            [act.rows[0].id_tipo_activo, b.tarea, b.tipo_periodicidad, b.valor_periodicidad]
          );
          if (!plan.rows[0]) {
            plan = await client.query(
              `INSERT INTO g2_housekeeping.plan_mantenimiento (id_tipo_activo, tarea, tipo_periodicidad, valor_periodicidad, fecha_inicio)
               VALUES ($1::bigint, $2, $3, $4, CURRENT_DATE) RETURNING id_plan::text AS id_plan`,
              [act.rows[0].id_tipo_activo, b.tarea, b.tipo_periodicidad, b.valor_periodicidad]
            );
          }
          const porHoras = b.tipo_periodicidad === 'HorasUso';
          const interval = { Días: '1 day', Semanas: '7 days', Meses: '1 month', HorasUso: '0 day' }[b.tipo_periodicidad];
          const res = await client.query(
            `INSERT INTO g2_housekeeping.programacion_preventiva (id_plan, id_activo, fecha_proxima_ejecucion, horas_proxima_ejecucion)
             VALUES ($1::bigint, $2::bigint,
                     CASE WHEN $3::boolean THEN NULL ELSE COALESCE($4::date, (CURRENT_DATE + ($5::int * $6::interval))::date) END,
                     CASE WHEN $3::boolean THEN ($7::bigint + $5::int) ELSE NULL END)
             RETURNING id_plan::text AS id_plan, id_activo::text AS id_activo, fecha_proxima_ejecucion::text AS fecha_proxima_ejecucion`,
            [plan.rows[0].id_plan, b.id_activo, porHoras, b.fecha_proxima ?? null, b.valor_periodicidad, interval, act.rows[0].horas]
          );
          return res.rows[0];
        }).catch((e: { code?: string }) => {
          if (e?.code === '23505') throw new ConflictError('Ese activo ya tiene programada esa tarea.');
          throw e;
        }),
      201
    )
  );

  router.post(
    '/preventivo/:plan/:activo/ejecutar',
    requirePermission(PERMISSIONS.M2_MANTENIMIENTO_CERRAR),
    validateParams(planActivoParams),
    handle((req) =>
      withTransaction(req.authContext!, async (client) => {
        const cur = await client.query<{ tipo_periodicidad: string; valor_periodicidad: number; horas: string; plan_activo: string }>(
          `SELECT pm.tipo_periodicidad, pm.valor_periodicidad, a.horas_uso_acumuladas::text AS horas, pm.estado AS plan_activo
           FROM g2_housekeeping.programacion_preventiva pp
           JOIN g2_housekeeping.plan_mantenimiento pm ON pm.id_plan = pp.id_plan
           JOIN g2_housekeeping.activo a ON a.id_activo = pp.id_activo
           WHERE pp.id_plan = $1::bigint AND pp.id_activo = $2::bigint FOR UPDATE OF pp`,
          [req.params.plan, req.params.activo]
        );
        const r = cur.rows[0];
        if (!r) throw new NotFoundError('Programación preventiva no encontrada.');
        if (r.plan_activo !== 'A') throw new DomainRuleError('El plan de mantenimiento está inactivo.');
        const porHoras = r.tipo_periodicidad === 'HorasUso';
        const interval = { Días: '1 day', Semanas: '7 days', Meses: '1 month', HorasUso: '0 day' }[r.tipo_periodicidad as 'Días'];
        const upd = await client.query(
          `UPDATE g2_housekeeping.programacion_preventiva SET
             fecha_ultima_ejecucion = CURRENT_DATE,
             horas_ultima_ejecucion = CASE WHEN $3::boolean THEN $4::bigint ELSE horas_ultima_ejecucion END,
             fecha_proxima_ejecucion = CASE WHEN $3::boolean THEN NULL ELSE (CURRENT_DATE + ($5::int * $6::interval))::date END,
             horas_proxima_ejecucion = CASE WHEN $3::boolean THEN ($4::bigint + $5::int) ELSE NULL END
           WHERE id_plan = $1::bigint AND id_activo = $2::bigint
           RETURNING id_plan::text AS id_plan, id_activo::text AS id_activo,
                     fecha_ultima_ejecucion::text AS fecha_ultima_ejecucion, fecha_proxima_ejecucion::text AS fecha_proxima_ejecucion`,
          [req.params.plan, req.params.activo, porHoras, r.horas, r.valor_periodicidad, interval]
        );
        return upd.rows[0];
      })
    )
  );

  // ---- Solicitud de insumos al almacén (la atiende Almacén en /m3/requisiciones)
  router.post(
    '/requisiciones',
    requirePermission(PERMISSIONS.M2_INSUMO_MOVER),
    validateBody(requisicionSchema),
    handle(
      (req) =>
        withTransaction(req.authContext!, async (client) => {
          const b = req.body as z.infer<typeof requisicionSchema>;
          return crearRequisicion(client, b.id_articulo, b.cantidad);
        }),
      201
    )
  );
}
