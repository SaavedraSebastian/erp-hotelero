import os

def rw(p, fn):
    s = open(p, encoding='utf-8').read()
    s = fn(s)
    open(p + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(p + '.tmp', p)

def rep(s, a, b):
    assert s.count(a) == 1, (a[:80], s.count(a))
    return s.replace(a, b)

def repo(s):
    a = s.index("export async function listTarifas(client: PoolClient) {")
    b = s.index("export async function listReservas(")
    new = '''const TARIFA_SELECT = `SELECT
       t.id_tarifa::text AS id_tarifa,
       t.nombre,
       t.precio_base::text AS precio_base,
       t.fecha_inicio::text AS fecha_inicio,
       t.fecha_fin::text AS fecha_fin,
       t.estado,
       th.id_tipo_habitacion::text AS id_tipo_habitacion,
       th.nombre AS tipo_habitacion,
       tmp.id_temporada::text AS id_temporada,
       tmp.nombre AS temporada,
       tmp.factor_ajuste::text AS factor_ajuste,
       c.id_canal_reserva::text AS id_canal_reserva,
       c.nombre AS canal
     FROM g1_reservas.tarifa t
     JOIN g1_reservas.tipo_habitacion th ON th.id_tipo_habitacion = t.id_tipo_habitacion
     JOIN g1_reservas.temporada tmp ON tmp.id_temporada = t.id_temporada
     JOIN g1_reservas.canal_reserva c ON c.id_canal_reserva = t.id_canal_reserva`;

/** Tarifas activas y vigentes hoy (las que se usan para reservar); sin paginar porque es un conjunto pequeño. */
export async function listTarifas(client: PoolClient, opts: { soloVigentes?: boolean } = {}) {
  const where = opts.soloVigentes ? "WHERE t.estado = 'ACTIVA' AND CURRENT_DATE BETWEEN t.fecha_inicio AND t.fecha_fin" : '';
  const res = await client.query(`${TARIFA_SELECT} ${where} ORDER BY t.id_tarifa DESC`);
  return res.rows;
}

/** Listado paginado para el mantenedor de tarifas (búsqueda, estado y vigencia). */
export async function listTarifasPaginado(client: PoolClient, params: PaginationParams, soloVigentes = false) {
  const values: unknown[] = [];
  const where: string[] = [];
  pushStatusFilter(values, where, 't.estado', params.status);
  pushSearchFilter(values, where, ['t.nombre', 'th.nombre', 'c.nombre', 'tmp.nombre'], params.search);
  if (soloVigentes) where.push('CURRENT_DATE BETWEEN t.fecha_inicio AND t.fecha_fin');
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM g1_reservas.tarifa t
     JOIN g1_reservas.tipo_habitacion th ON th.id_tipo_habitacion = t.id_tipo_habitacion
     JOIN g1_reservas.temporada tmp ON tmp.id_temporada = t.id_temporada
     JOIN g1_reservas.canal_reserva c ON c.id_canal_reserva = t.id_canal_reserva
     ${whereClause}`,
    values
  );
  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);
  const res = await client.query(
    `${TARIFA_SELECT}
     ${whereClause}
     ORDER BY th.nombre ASC, t.fecha_inicio DESC, t.id_tarifa DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return { rows: res.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

'''
    return s[:a] + new + s[b:]
rw('server/modules/m1/repository.ts', repo)

def svc(s):
    return rep(s, '''export async function getTarifasService(ctx: AuthContext) {
  const rows = await withReadOnlyClient((client) => repo.listTarifas(client), ctx);
  return { data: rows };
}''', '''export async function getTarifasService(ctx: AuthContext, opts: { soloVigentes?: boolean } = {}) {
  const rows = await withReadOnlyClient((client) => repo.listTarifas(client, opts), ctx);
  return { data: rows };
}

export async function getTarifasPaginadoService(ctx: AuthContext, params: PaginationParams, soloVigentes = false) {
  const { rows, total } = await withReadOnlyClient((client) => repo.listTarifasPaginado(client, params, soloVigentes), ctx);
  return buildPaginatedResponse(rows, total, params.page, params.pageSize);
}''')
rw('server/modules/m1/service.ts', svc)

def ctrl(s):
    return rep(s, '''    res.json(await service.getTarifasService(req.authContext!));''', '''    const q = req.query as Record<string, unknown>;
    const soloVigentes = q.vigentes === 'true' || q.vigentes === '1';
    // Con `page` se devuelve paginado (mantenedor); sin él, el conjunto de tarifas usadas para reservar.
    if (q.page !== undefined) {
      res.json(await service.getTarifasPaginadoService(req.authContext!, parsePagination(q), soloVigentes));
      return;
    }
    res.json(await service.getTarifasService(req.authContext!, { soloVigentes }));''')
rw('server/modules/m1/controller.ts', ctrl)
print('ok')
