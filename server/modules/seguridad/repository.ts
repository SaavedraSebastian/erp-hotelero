import { getDatabasePool, isDatabaseConfigured } from '../../config/database.ts';
import { ForbiddenError, ServiceUnavailableError, UnauthorizedError } from '../../shared/errors/app-error.ts';
import type { AuthContext } from '../../shared/types/context.ts';

interface SecuritySchemaLayout {
  userTable: 'usuario_sistema' | 'usuario_interno';
  pkColumn: string;
  codeColumn: string;
  nameColumn: string;
  activeColumn: string;
  activeValueSql: string;
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

    const codeColumn = colMap.has('codigo_usuario')
      ? 'codigo_usuario'
      : colMap.has('codigo')
      ? 'codigo'
      : pkColumn;

    const nameColumn = colMap.has('nombre_completo')
      ? 'nombre_completo'
      : colMap.has('nombre')
      ? 'nombre'
      : codeColumn;

    const activeColumn = colMap.has('activo') ? 'activo' : 'estado';
    const activeType = colMap.get(activeColumn) ?? 'boolean';
    const activeValueSql = activeType === 'boolean' ? 'TRUE' : "'ACTIVO'";

    cachedLayout = {
      userTable: userTable as SecuritySchemaLayout['userTable'],
      pkColumn,
      codeColumn,
      nameColumn,
      activeColumn,
      activeValueSql,
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
    const userQuery = `
      SELECT
        u.${layout.pkColumn}::text AS usuario_id,
        u.${layout.codeColumn}::text AS codigo_usuario,
        u.${layout.nameColumn}::text AS nombre,
        COALESCE(u.departamento, '')::text AS departamento,
        u.turno::text AS turno,
        u.id_personal_g2::text AS id_personal_g2,
        u.id_usuario_g4 AS id_usuario_g4,
        (u.${layout.activeColumn} = ${layout.activeValueSql}) AS esta_activo
      FROM seguridad.${layout.userTable} u
      WHERE u.auth_user_id = $1::uuid
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
    const rolCode = rolCols.has('codigo') ? 'codigo' : rolCols.has('codigo_rol') ? 'codigo_rol' : 'nombre';
    const permisoPk = permisoCols.has('id_permiso') ? 'id_permiso' : 'id';
    const permisoCode = permisoCols.has('codigo') ? 'codigo' : permisoCols.has('codigo_permiso') ? 'codigo_permiso' : 'clave';
    const urUserFk = usuarioRolCols.has(layout.pkColumn)
      ? layout.pkColumn
      : usuarioRolCols.has('id_usuario')
      ? 'id_usuario'
      : 'id_usuario_sistema';
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
