import os

p = 'server/modules/gestion/m4.ts'
s = open(p, encoding='utf-8').read()

NEW = r'''
export const reporteQuerySchema = z
  .object({
    desde: dateOnlySchema.optional(),
    hasta: dateOnlySchema.optional(),
  })
  .refine((d) => !d.desde || !d.hasta || d.hasta >= d.desde, { message: 'La fecha final no puede ser anterior a la inicial.', path: ['hasta'] });

const ESTADOS_INGRESO = ['ACEPTADO', 'ENVIADO', 'FIRMADO'];

/** Resumen financiero calculado en la base: totales, series por semana y por mes, y desglose por área. */
export async function resumenFinanciero(client: import('pg').PoolClient, desde?: string, hasta?: string) {
  const range = await client.query<{ d: string; h: string }>(
    `SELECT COALESCE($1::date, CURRENT_DATE - 29)::text AS d, COALESCE($2::date, CURRENT_DATE)::text AS h`,
    [desde ?? null, hasta ?? null]
  );
  const d = range.rows[0].d;
  const h = range.rows[0].h;

  const totales = await client.query(
    `SELECT
       (SELECT COALESCE(SUM(total), 0) FROM g4_finanzas.comprobante
         WHERE estado = ANY($3::text[]) AND fecha_emision::date BETWEEN $1::date AND $2::date)::text AS facturado,
       (SELECT COALESCE(SUM(monto), 0) FROM g4_finanzas.cobro
         WHERE estado = 'REGISTRADO' AND fecha_hora::date BETWEEN $1::date AND $2::date)::text AS cobrado,
       (SELECT COALESCE(SUM(saldo_pendiente), 0) FROM g4_finanzas.cuenta_por_cobrar WHERE estado IN ('VIGENTE', 'VENCIDA'))::text AS por_cobrar,
       (SELECT COALESCE(SUM(monto), 0) FROM g4_finanzas.gasto
         WHERE estado = 'APROBADO' AND fecha BETWEEN $1::date AND $2::date)::text AS gastos,
       (SELECT COALESCE(SUM(monto), 0) FROM g4_finanzas.gasto WHERE estado = 'PENDIENTE')::text AS gastos_pendientes`,
    [d, h, ESTADOS_INGRESO]
  );

  const semanal = await client.query(
    `WITH w AS (
       SELECT gs AS n, (CURRENT_DATE - (7 * gs + 6))::date AS desde, (CURRENT_DATE - 7 * gs)::date AS hasta
       FROM generate_series(4, 0, -1) gs
     )
     SELECT w.desde::text AS desde, w.hasta::text AS hasta,
            (SELECT COALESCE(SUM(c.total), 0) FROM g4_finanzas.comprobante c
              WHERE c.estado = ANY($1::text[]) AND c.fecha_emision::date BETWEEN w.desde AND w.hasta)::float AS ingresos,
            (SELECT COALESCE(SUM(g.monto), 0) FROM g4_finanzas.gasto g
              WHERE g.estado = 'APROBADO' AND g.fecha BETWEEN w.desde AND w.hasta)::float AS egresos
     FROM w ORDER BY w.desde`,
    [ESTADOS_INGRESO]
  );

  const mensual = await client.query(
    `WITH m AS (
       SELECT date_trunc('month', CURRENT_DATE - (gs || ' month')::interval)::date AS inicio
       FROM generate_series(5, 0, -1) gs
     )
     SELECT to_char(m.inicio, 'YYYY-MM') AS mes,
            (SELECT COALESCE(SUM(c.total), 0) FROM g4_finanzas.comprobante c
              WHERE c.estado = ANY($1::text[]) AND c.fecha_emision::date >= m.inicio AND c.fecha_emision::date < (m.inicio + interval '1 month'))::float AS ingresos,
            (SELECT COALESCE(SUM(g.monto), 0) FROM g4_finanzas.gasto g
              WHERE g.estado = 'APROBADO' AND g.fecha >= m.inicio AND g.fecha < (m.inicio + interval '1 month'))::float AS egresos
     FROM m ORDER BY m.inicio`,
    [ESTADOS_INGRESO]
  );

  const areas = await client.query(
    `WITH ing AS (
       SELECT area AS nombre, SUM(importe)::float AS ingresos
       FROM g4_finanzas.consumo WHERE fecha BETWEEN $1::date AND $2::date GROUP BY area
     ),
     cos AS (
       SELECT cc.nombre, SUM(g.monto)::float AS costos
       FROM g4_finanzas.gasto g JOIN g4_finanzas.centro_costo cc ON cc.id_centro_costo = g.id_centro_costo
       WHERE g.estado = 'APROBADO' AND g.fecha BETWEEN $1::date AND $2::date GROUP BY cc.nombre
     )
     SELECT COALESCE(ing.nombre, cos.nombre) AS nombre, COALESCE(ing.ingresos, 0) AS ingresos, COALESCE(cos.costos, 0) AS costos
     FROM ing FULL OUTER JOIN cos ON lower(cos.nombre) = lower(ing.nombre)
     ORDER BY COALESCE(ing.ingresos, 0) + COALESCE(cos.costos, 0) DESC`,
    [d, h]
  );

  const t = totales.rows[0];
  return {
    desde: d,
    hasta: h,
    totales: {
      facturado: Number(t.facturado),
      cobrado: Number(t.cobrado),
      por_cobrar: Number(t.por_cobrar),
      gastos: Number(t.gastos),
      gastos_pendientes: Number(t.gastos_pendientes),
    },
    semanal: semanal.rows,
    mensual: mensual.rows,
    areas: areas.rows,
  };
}
'''

assert s.count("export function registerM4Gestion(router: Router): void {") == 1
s = s.replace("export function registerM4Gestion(router: Router): void {", NEW + "\nexport function registerM4Gestion(router: Router): void {\n  // ---- Reportes: resumen agregado en la base (no requiere traer los historiales)\n  router.get(\n    '/reportes/resumen',\n    requirePermission(PERMISSIONS.M4_COMPROBANTE_CONSULTAR),\n    handle((req) => {\n      const q = reporteQuerySchema.parse(req.query);\n      return withReadOnlyClient((client) => resumenFinanciero(client, q.desde, q.hasta), req.authContext!);\n    })\n  );\n\n", 1)
s = s.replace("import { motivoSchema, positiveMoneyStringSchema, varcharIdSchema } from", "import { dateOnlySchema, motivoSchema, positiveMoneyStringSchema, varcharIdSchema } from", 1)
open(p + '.tmp', 'w', encoding='utf-8').write(s)
os.replace(p + '.tmp', p)
print('ok')
