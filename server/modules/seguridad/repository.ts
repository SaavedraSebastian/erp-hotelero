import { getDatabasePool, isDatabaseConfigured } from '../../config/database.ts';
import { ForbiddenError, ServiceUnavailableError, UnauthorizedError } from '../../shared/errors/app-error.ts';
import type { AuthContext } from '../../shared/types/context.ts';

interface SecuritySchemaLayout {
  userTable: 'usuario_sistema' | 'usuario_interno';
  pkColumn: string;
  authIdColumn: string;
  codeColumn: string;
  nameColumn: string;
  activeExprSql: string;
  depColumn: string | null;
  hasTurno: boolean;
  hasIdPersonalG2: boolean;
  hasIdUsuarioG4: boolean;
}

let cachedLayout: SecuritySchemaLayout | null = null;

async function detectSecuritySchemaLayout(): Promise<SecuritySchemaLayout> {
  if (cachedLayout) return cachedLayout;

  const pool = getDatabasePool();
  const client = await pool.connect();
  try {
    const tablesRes = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'seguridad'
         AND table_name IN ('usuario_sistema', 'usuario_interno')`
    );

    const userTable = tablesRes.rows.find((r) => r.table_name === 'usuario_sistema')?.table_name
      ?? tablesRes.rows.find((r) => r.table_name === 'usuario_interno')?.table_name;

    if (!userTable) {
      throw new ServiceUnavailableError(
        'Las migraciones de seguridad (05_seguridad_rbac_base.sql / 06_catalogo_rbac_inicial.sql) aún no están instaladas en la base de datos.',
        'SECURITY_MIGRATIONS_PENDING'
      );
    }

    const colsRes = await client.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'seguridad' AND table_name = $1`,
      [userTable]
    );
    const colMap = new Map(colsRes.rows.map((c) => [c.column_name, c.data_type]));

    const pkColumn = colMap.has('id_usuario_sistema')
      ? 'id_usuario_sistema'
      : colMap.has('id_usuario_interno')
      ? 'id_usuario_interno'
      : colMap.has('id_usuario')
      ? 'id_usuario'
      : 'id';

    const authIdColumn = colMap.has('auth_user_id')
      ? 'auth_user_id'
      : colMap.has('supabase_user_id')
      ? 'supabase_user_id'
      : colMap.has('id_auth_user')
      ? 'id_auth_user'
      : 'auth_user_id';

    const codeColumn = colMap.has('codigo_usuario')
      ? 'codigo_usuario'
      : colMap.has('codigo')
      ? 'codigo'
      : colMap.has('username')
      ? 'username'
      : colMap.has('email')
      ? 'email'
      : pkColumn;

    const nameColumn = colMap.has('nombre_completo')
      ? 'nombre_completo'
      : colMap.has('nombre')
      ? 'nombre'
      : colMap.has('nombres')
      ? 'nombres'
      : codeColumn;

    const activeColumn = colMap.has('activo')
      ? 'activo'
      : colMap.has('estado')
      ? 'estado'
      : colMap.has('habilitado')
      ? 'habilitado'
      : null;

    let activeExprSql = 'TRUE';
    if (activeColumn) {
      const activeType = colMap.get(activeColumn) ?? 'boolean';
      activeExprSql =
        activeType === 'boolean'
          ? `COALESCE(u.${activeColumn}, TRUE)`
          : `(UPPER(u.${activeColumn}::text) IN ('ACTIVO', 'ACTIVE', 'TRUE', '1'))`;
    }

    const depColumn = colMap.has('departamento')
      ? 'departamento'
      : colMap.has('area')
      ? 'area'
      : colMap.has('cargo')
      ? 'cargo'
      : null;

    cachedLayout = {
      userTable: userTable as SecuritySchemaLayout['userTable'],
      pkColumn,
      authIdColumn,
      codeColumn,
      nameColumn,
      activeExprSql,
      depColumn,
      hasTurno: colMap.has('turno'),
      hasIdPersonalG2: colMap.has('id_personal_g2'),
      hasIdUsuarioG4: colMap.has('id_usuario_g4'),
    };
    return cachedLayout;
  } finally {
    client.release();
  }
}

export async function resolveErpAuthContext(authUserId: string): Promise<AuthContext> {
  if (!isDatabaseConfigured()) {
    throw new ServiceUnavailableError(
      'La conexión PostgreSQL/Supabase aún no está configurada en el servidor.',
      'DATABASE_NOT_CONFIGURED'
    );
  }

  const layout = await detectSecuritySchemaLayout();
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    const depExpr = layout.depColumn ? `COALESCE(u.${layout.depColumn}, '')::text` : "''::text";
    const turnoExpr = layout.hasTurno ? 'u.turno::text' : 'NULL::text';
    const p2Expr = layout.hasIdPersonalG2 ? 'u.id_personal_g2::text' : 'NULL::text';
    const u4Expr = layout.hasIdUsuarioG4 ? 'u.id_usuario_g4::integer' : 'NULL::integer';

    const userQuery = `
      SELECT
        u.${layout.pkColumn}::text AS usuario_id,
        u.${layout.codeColumn}::text AS codigo_usuario,
        u.${layout.nameColumn}::text AS nombre,
        ${depExpr} AS departamento,
        ${turnoExpr} AS turno,
        ${p2Expr} AS id_personal_g2,
        ${u4Expr} AS id_usuario_g4,
        ${layout.activeExprSql} AS esta_activo
      FROM seguridad.${layout.userTable} u
      WHERE u.${layout.authIdColumn}::text = $1
      LIMIT 1
    `;
    const userRes = await client.query<{
      usuario_id: string;
      codigo_usuario: string;
      nombre: string;
      departamento: string;
      turno: string | null;
      id_personal_g2: string | null;
      id_usuario_g4: number | null;
      esta_activo: boolean;
    }>(userQuery, [authUserId]);

    const user = userRes.rows[0];
    if (!user) {
      throw new UnauthorizedError(
        'La cuenta autenticada no está vinculada a un usuario operativo del ERP.',
        'ERP_USER_NOT_LINKED'
      );
    }

    if (!user.esta_activo) {
      throw new ForbiddenError('Tu usuario operativo está inactivo en el sistema.', 'ERP_USER_INACTIVE');
    }

    const rbacColsRes = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'seguridad'
         AND table_name IN ('rol', 'permiso', 'usuario_rol', 'rol_permiso')`
    );
    const colsByTable = new Map<string, Set<string>>();
    for (const row of rbacColsRes.rows) {
      const set = colsByTable.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      colsByTable.set(row.table_name, set);
    }

    const rolCols = colsByTable.get('rol') ?? new Set();
    const permisoCols = colsByTable.get('permiso') ?? new Set();
    const usuarioRolCols = colsByTable.get('usuario_rol') ?? new Set();
    const rolPermisoCols = colsByTable.get('rol_permiso') ?? new Set();

    const rolPk = rolCols.has('id_rol') ? 'id_rol' : 'id';
    const rolCode = rolCols.has('codigo')
      ? 'codigo'
      : rolCols.has('codigo_rol')
      ? 'codigo_rol'
      : rolCols.has('clave')
      ? 'clave'
      : 'nombre';
    const permisoPk = permisoCols.has('id_permiso') ? 'id_permiso' : 'id';
    const permisoCode = permisoCols.has('codigo')
      ? 'codigo'
      : permisoCols.has('codigo_permiso')
      ? 'codigo_permiso'
      : permisoCols.has('clave')
      ? 'clave'
      : 'nombre';
    const urUserFk = usuarioRolCols.has(layout.pkColumn)
      ? layout.pkColumn
      : usuarioRolCols.has('id_usuario_sistema')
      ? 'id_usuario_sistema'
      : usuarioRolCols.has('id_usuario_interno')
      ? 'id_usuario_interno'
      : usuarioRolCols.has('id_usuario')
      ? 'id_usuario'
      : 'usuario_id';
    const urRolFk = usuarioRolCols.has('id_rol') ? 'id_rol' : 'rol_id';
    const rpRolFk = rolPermisoCols.has('id_rol') ? 'id_rol' : 'rol_id';
    const rpPermFk = rolPermisoCols.has('id_permiso') ? 'id_permiso' : 'permiso_id';

    const rolesRes = await client.query<{ codigo_rol: string }>(
      `SELECT DISTINCT r.${rolCode}::text AS codigo_rol
       FROM seguridad.usuario_rol ur
       JOIN seguridad.rol r ON r.${rolPk} = ur.${urRolFk}
       WHERE ur.${urUserFk}::text = $1`,
      [user.usuario_id]
    );
    const roles = rolesRes.rows.map((r) => r.codigo_rol);

    const permsRes = await client.query<{ codigo_permiso: string }>(
      `SELECT DISTINCT p.${permisoCode}::text AS codigo_permiso
       FROM seguridad.usuario_rol ur
       JOIN seguridad.rol_permiso rp ON rp.${rpRolFk} = ur.${urRolFk}
       JOIN seguridad.permiso p ON p.${permisoPk} = rp.${rpPermFk}
       WHERE ur.${urUserFk}::text = $1`,
      [user.usuario_id]
    );
    const permisos = permsRes.rows.map((p) => p.codigo_permiso);

    const canViewFullPII =
      permisos.includes('m1.huesped.pii.ver') ||
      permisos.includes('m5.perfil.pii.ver') ||
      permisos.includes('seguridad.usuario.administrar') ||
      roles.some((r) =>
        ['ADMIN_SISTEMA', 'SUPER_ADMIN', 'ADMINISTRADOR', 'RECEPCIONISTA', 'CAJERO', 'JEFE_FINANZAS', 'GERENTE_FINANCIERO', 'ATENCION_HUESPED', 'ADMINISTRADOR_COMERCIAL'].includes(
          r.toUpperCase()
        )
      );

    return {
      authUserId,
      usuarioId: user.usuario_id,
      codigoUsuario: user.codigo_usuario,
      nombre: user.nombre,
      departamento: user.departamento,
      turno: user.turno,
      idPersonalG2: user.id_personal_g2,
      idUsuarioG4: user.id_usuario_g4,
      roles,
      permisos,
      canViewFullPII,
    };
  } finally {
    client.release();
  }
}

export async function listSecurityDirectory(): Promise<
  Array<{
    name: string;
    email: string;
    role: string;
    roleLabel: string;
    department: string;
    active: boolean;
  }>
> {
  if (!isDatabaseConfigured()) {
    return [];
  }

  const layout = await detectSecuritySchemaLayout();
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    const rbacColsRes = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'seguridad'
         AND table_name IN ('rol', 'usuario_rol', $1)`,
      [layout.userTable]
    );
    const colsByTable = new Map<string, Set<string>>();
    for (const row of rbacColsRes.rows) {
      const set = colsByTable.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      colsByTable.set(row.table_name, set);
    }

    const userCols = colsByTable.get(layout.userTable) ?? new Set();
    const rolCols = colsByTable.get('rol') ?? new Set();
    const usuarioRolCols = colsByTable.get('usuario_rol') ?? new Set();

    const rolPk = rolCols.has('id_rol') ? 'id_rol' : 'id';
    const rolCode = rolCols.has('codigo')
      ? 'codigo'
      : rolCols.has('codigo_rol')
      ? 'codigo_rol'
      : rolCols.has('clave')
      ? 'clave'
      : 'nombre';
    const urUserFk = usuarioRolCols.has(layout.pkColumn)
      ? layout.pkColumn
      : usuarioRolCols.has('id_usuario_sistema')
      ? 'id_usuario_sistema'
      : usuarioRolCols.has('id_usuario_interno')
      ? 'id_usuario_interno'
      : usuarioRolCols.has('id_usuario')
      ? 'id_usuario'
      : 'usuario_id';
    const urRolFk = usuarioRolCols.has('id_rol') ? 'id_rol' : 'rol_id';
    const emailExpr = userCols.has('email')
      ? 'u.email::text'
      : userCols.has('correo')
      ? 'u.correo::text'
      : `u.${layout.codeColumn}::text`;
    const depExpr = layout.depColumn ? `COALESCE(u.${layout.depColumn}, '')::text` : "''::text";

    const rowsRes = await client.query<{
      codigo_usuario: string;
      nombre: string;
      email: string | null;
      departamento: string;
      esta_activo: boolean;
      roles: string[] | null;
    }>(
      `SELECT
         u.${layout.codeColumn}::text AS codigo_usuario,
         u.${layout.nameColumn}::text AS nombre,
         ${emailExpr} AS email,
         ${depExpr} AS departamento,
         ${layout.activeExprSql} AS esta_activo,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.${rolCode}::text), NULL) AS roles
       FROM seguridad.${layout.userTable} u
       LEFT JOIN seguridad.usuario_rol ur ON ur.${urUserFk} = u.${layout.pkColumn}
       LEFT JOIN seguridad.rol r ON r.${rolPk} = ur.${urRolFk}
       GROUP BY u.${layout.pkColumn}, u.${layout.codeColumn}, u.${layout.nameColumn}${userCols.has('email') ? ', u.email' : userCols.has('correo') ? ', u.correo' : ''}${layout.depColumn ? `, u.${layout.depColumn}` : ''}
       ORDER BY u.${layout.nameColumn} ASC`
    );

    return rowsRes.rows.map((r) => {
      const rolesList = Array.isArray(r.roles) ? r.roles.filter(Boolean) : [];
      return {
        name: r.nombre,
        email: r.email && r.email.includes('@') ? r.email : `${r.codigo_usuario}@hotelboulevard.pe`,
        role: (rolesList[0] ?? 'usuario').toLowerCase(),
        roleLabel: rolesList.join(' · ') || 'Usuario ERP',
        department: r.departamento || 'Operaciones',
        active: Boolean(r.esta_activo),
      };
    });
  } finally {
    client.release();
  }
}
