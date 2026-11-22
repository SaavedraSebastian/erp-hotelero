import os

p = 'server/modules/m5/repository.ts'
s = open(p, encoding='utf-8').read()


def sub1(a, b):
    global s
    assert s.count(a) == 1, (a[:80], s.count(a))
    s = s.replace(a, b)


sub1("import { ConflictError, DomainRuleError, NotFoundError } from '../../shared/errors/app-error.ts';\n",
     "import { ConflictError, DomainRuleError, NotFoundError } from '../../shared/errors/app-error.ts';\nimport { pushSearchFilter, pushStatusFilter } from '../../shared/pagination/index.ts';\n\n/** Filtros opcionales de los listados de CRM (texto de búsqueda y uno o varios estados separados por coma). */\nexport interface ListFilter {\n  search?: string;\n  status?: string;\n}\n")

# --- perfiles
sub1("""  limit: number,
  offset: number
): Promise<{ rows: PerfilHuespedRow[]; total: number }> {
  const countRes = await client.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM g5_crm.perfil_huesped');
  const total = Number(countRes.rows[0]?.total ?? 0);
""", """  limit: number,
  offset: number,
  filter: ListFilter = {}
): Promise<{ rows: PerfilHuespedRow[]; total: number }> {
  const values: unknown[] = [];
  const where: string[] = [];
  pushSearchFilter(values, where, ["(h.nombres || ' ' || h.apellidos)", 'h.numero_documento', 'h.correo', 'h.empresa'], filter.search);
  pushStatusFilter(values, where, 's.nombre', filter.status);
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM g5_crm.perfil_huesped p
     JOIN g1_reservas.huesped h ON h.id_huesped = p.id_huesped
     LEFT JOIN g5_crm.segmento s ON s.id_segmento = p.id_segmento
     ${whereClause}`,
    values
  );
  const total = Number(countRes.rows[0]?.total ?? 0);
  values.push(limit, offset);
""")
sub1("""     LEFT JOIN g5_crm.v_saldo_puntos vs ON vs.id_perfil = p.id_perfil
     ORDER BY p.valor_acumulado DESC, p.id_perfil ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );""", """     LEFT JOIN g5_crm.v_saldo_puntos vs ON vs.id_perfil = p.id_perfil
     ${whereClause}
     ORDER BY p.valor_acumulado DESC, p.id_perfil ASC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );""")

# --- reclamos
sub1("""  limit: number,
  offset: number
) {
  const countRes = await client.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM g5_crm.reclamo');
  const total = Number(countRes.rows[0]?.total ?? 0);
""", """  limit: number,
  offset: number,
  filter: ListFilter = {}
) {
  const values: unknown[] = [];
  const where: string[] = [];
  pushStatusFilter(values, where, 'r.estado', filter.status);
  pushSearchFilter(values, where, ['r.codigo_seguimiento', "(h.nombres || ' ' || h.apellidos)", 'r.descripcion', 'r.tipo'], filter.search);
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM g5_crm.reclamo r
     JOIN g5_crm.perfil_huesped p ON p.id_perfil = r.id_perfil
     JOIN g1_reservas.huesped h ON h.id_huesped = p.id_huesped
     ${whereClause}`,
    values
  );
  const total = Number(countRes.rows[0]?.total ?? 0);
  values.push(limit, offset);
""")
sub1("""     LEFT JOIN g5_crm.compensacion c ON c.id_reclamo = r.id_reclamo
     ORDER BY r.fecha_registro DESC, r.id_reclamo DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );""", """     LEFT JOIN g5_crm.compensacion c ON c.id_reclamo = r.id_reclamo
     ${whereClause}
     ORDER BY r.fecha_registro DESC, r.id_reclamo DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );""")

# --- campanas
sub1("""export async function listCampanas(client: PoolClient, limit: number, offset: number) {
  const countRes = await client.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM g5_crm.campana');
  const total = Number(countRes.rows[0]?.total ?? 0);
""", """export async function listCampanas(client: PoolClient, limit: number, offset: number, filter: ListFilter = {}) {
  const values: unknown[] = [];
  const where: string[] = [];
  pushStatusFilter(values, where, 'c.estado', filter.status);
  pushSearchFilter(values, where, ['c.nombre', 'c.codigo_campana', 's.nombre', 'c.canal'], filter.search);
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM g5_crm.campana c
     JOIN g5_crm.segmento s ON s.id_segmento = c.id_segmento
     ${whereClause}`,
    values
  );
  const total = Number(countRes.rows[0]?.total ?? 0);
  values.push(limit, offset);
""")
sub1("""     LEFT JOIN g5_crm.envio_campana e ON e.id_campana = c.id_campana
     GROUP BY c.id_campana, s.nombre
     ORDER BY c.fecha_inicio DESC, c.id_campana DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );""", """     LEFT JOIN g5_crm.envio_campana e ON e.id_campana = c.id_campana
     ${whereClause}
     GROUP BY c.id_campana, s.nombre
     ORDER BY c.fecha_inicio DESC, c.id_campana DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );""")

# --- opiniones
sub1("""export async function listOpiniones(client: PoolClient, limit: number, offset: number) {
  const countRes = await client.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM g5_crm.opinion');
  const total = Number(countRes.rows[0]?.total ?? 0);
""", """export async function listOpiniones(client: PoolClient, limit: number, offset: number, filter: ListFilter = {}) {
  const values: unknown[] = [];
  const where: string[] = [];
  pushStatusFilter(values, where, 'o.tipo_opinion', filter.status);
  pushSearchFilter(values, where, ["(h.nombres || ' ' || h.apellidos)", 'o.texto_seudonimizado', 'r.titulo'], filter.search);
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM g5_crm.opinion o
     JOIN g5_crm.perfil_huesped p ON p.id_perfil = o.id_perfil
     JOIN g1_reservas.huesped h ON h.id_huesped = p.id_huesped
     LEFT JOIN g5_crm.resena r ON r.id_opinion = o.id_opinion
     ${whereClause}`,
    values
  );
  const total = Number(countRes.rows[0]?.total ?? 0);
  values.push(limit, offset);
""")
sub1("""     LEFT JOIN g5_crm.encuesta e ON e.id_opinion = o.id_opinion
     ORDER BY o.fecha_recepcion DESC, o.id_opinion DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );""", """     LEFT JOIN g5_crm.encuesta e ON e.id_opinion = o.id_opinion
     ${whereClause}
     ORDER BY o.fecha_recepcion DESC, o.id_opinion DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );""")

# --- solicitudes
sub1("""export async function listSolicitudesHuesped(client: PoolClient, limit: number, offset: number) {
  const countRes = await client.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM g5_crm.solicitud_huesped');
  const total = Number(countRes.rows[0]?.total ?? 0);
""", """export async function listSolicitudesHuesped(client: PoolClient, limit: number, offset: number, filter: ListFilter = {}) {
  const values: unknown[] = [];
  const where: string[] = [];
  pushStatusFilter(values, where, 's.estado', filter.status);
  pushSearchFilter(values, where, ['s.codigo', "(h.nombres || ' ' || h.apellidos)", 's.descripcion', 'hab.numero', 's.tipo'], filter.search);
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM g5_crm.solicitud_huesped s
     JOIN g5_crm.perfil_huesped p ON p.id_perfil = s.id_perfil
     JOIN g1_reservas.huesped h ON h.id_huesped = p.id_huesped
     LEFT JOIN g1_reservas.estadia est ON est.id_estadia = s.id_estadia
     LEFT JOIN g1_reservas.habitacion hab ON hab.id_habitacion = est.id_habitacion
     ${whereClause}`,
    values
  );
  const total = Number(countRes.rows[0]?.total ?? 0);
  values.push(limit, offset);
""")
sub1("""     LEFT JOIN g1_reservas.habitacion hab ON hab.id_habitacion = est.id_habitacion
     ORDER BY s.fecha_solicitud DESC, s.id_solicitud DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );""", """     LEFT JOIN g1_reservas.habitacion hab ON hab.id_habitacion = est.id_habitacion
     ${whereClause}
     ORDER BY s.fecha_solicitud DESC, s.id_solicitud DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );""")
open(p + '.tmp', 'w', encoding='utf-8').write(s)
os.replace(p + '.tmp', p)

# --- servicio: pasar filtros
p = 'server/modules/m5/service.ts'
s = open(p, encoding='utf-8').read()
for fn in ['listPerfiles', 'listReclamos', 'listCampanas', 'listOpiniones', 'listSolicitudesHuesped']:
    a = f"repo.{fn}(client, pagination.pageSize, offset)"
    assert s.count(a) == 1, fn
    s = s.replace(a, f"repo.{fn}(client, pagination.pageSize, offset, {{ search: pagination.search, status: pagination.status }})")
open(p + '.tmp', 'w', encoding='utf-8').write(s)
os.replace(p + '.tmp', p)
print('ok')
