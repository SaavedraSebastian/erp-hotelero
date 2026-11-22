import os

def rw(p, fn):
    s = open(p, encoding='utf-8').read()
    s = fn(s)
    open(p + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(p + '.tmp', p)

def rep(s, a, b):
    assert s.count(a) == 1, (a[:80], s.count(a))
    return s.replace(a, b)

def m2(s):
    a = s.index("  // ---- Historial de inspecciones (las 200 más recientes)")
    b = s.index("  // ---- Activos")
    new = '''  // ---- Historial de inspecciones (paginado; filtros: search = habitación o supervisor, status = resultado, fechas)
  router.get(
    '/inspecciones',
    requirePermission(PERMISSIONS.M2_LIMPIEZA_CONSULTAR),
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

'''
    s = s[:a] + new + s[b:]
    s = rep(s, "import { handle } from './helpers.ts';", "import { buildPaginatedResponse, parsePagination, pushDateRange, pushSearchFilter, pushStatusFilter } from '../../shared/pagination/index.ts';\nimport { handle } from './helpers.ts';")
    return s
rw('server/modules/gestion/m2.ts', m2)

# handle(...) envuelve { data } siempre; para devolver { data, pagination } se agrega la opción raw
def helpers(s):
    s = rep(s, "export function handle(fn: (req: Request) => Promise<unknown>, status = 200): RequestHandler {\n  return async (req: Request, res: Response, next: NextFunction) => {\n    try {\n      res.status(status).json({ data: await fn(req) });",
               "export function handle(fn: (req: Request) => Promise<unknown>, status = 200, raw = false): RequestHandler {\n  return async (req: Request, res: Response, next: NextFunction) => {\n    try {\n      const out = await fn(req);\n      res.status(status).json(raw ? out : { data: out });")
    return s
rw('server/modules/gestion/helpers.ts', helpers)
print('ok')
