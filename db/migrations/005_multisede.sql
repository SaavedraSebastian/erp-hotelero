BEGIN;

CREATE SCHEMA IF NOT EXISTS configuracion;

-- La aplicación adopta este rol dentro de cada transacción. Esto impide que una
-- conexión técnica con privilegios elevados (por ejemplo, el usuario de despliegue)
-- omita accidentalmente las políticas RLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app_multisede') THEN
    CREATE ROLE erp_app_multisede
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT erp_app_multisede TO %I', CURRENT_USER);
END $$;

CREATE TABLE IF NOT EXISTS configuracion.sede (
  id_sede varchar(40) PRIMARY KEY,
  codigo varchar(20) NOT NULL UNIQUE,
  nombre varchar(120) NOT NULL,
  nombre_comercial varchar(120) NOT NULL,
  direccion varchar(250),
  zona_horaria varchar(60) NOT NULL DEFAULT 'America/Lima',
  moneda varchar(3) NOT NULL DEFAULT 'PEN',
  logo_url varchar(500),
  estado varchar(12) NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'inactiva')),
  fecha_creacion timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS configuracion.usuario_sede (
  id_usuario text NOT NULL,
  id_sede varchar(40) NOT NULL REFERENCES configuracion.sede(id_sede),
  es_predeterminada boolean NOT NULL DEFAULT false,
  estado varchar(12) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
  fecha_asignacion timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_usuario, id_sede)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_usuario_sede_predeterminada
  ON configuracion.usuario_sede (id_usuario)
  WHERE es_predeterminada AND estado = 'activo';

INSERT INTO configuracion.sede (
  id_sede, codigo, nombre, nombre_comercial, direccion, zona_horaria, moneda, estado
) VALUES (
  'SEDE-PRINCIPAL', 'PRINCIPAL', 'Hotel Boulevard - Sede Principal',
  'Hotel Boulevard', 'Av. Principal 450, Lima, Perú', 'America/Lima', 'PEN', 'activa'
) ON CONFLICT (id_sede) DO NOTHING;

-- Vincula a los usuarios existentes con la sede principal, independientemente de
-- cuál de los nombres de tabla soportados use el esquema de seguridad instalado.
DO $$
DECLARE
  user_table text;
  pk_column text;
BEGIN
  SELECT table_name INTO user_table
  FROM information_schema.tables
  WHERE table_schema = 'seguridad'
    AND table_name IN ('usuario_sistema', 'usuario_interno', 'usuario')
  ORDER BY CASE table_name WHEN 'usuario_sistema' THEN 1 WHEN 'usuario_interno' THEN 2 ELSE 3 END
  LIMIT 1;

  IF user_table IS NOT NULL THEN
    SELECT column_name INTO pk_column
    FROM information_schema.columns
    WHERE table_schema = 'seguridad' AND table_name = user_table
      AND column_name IN ('id_usuario_sistema', 'id_usuario_interno', 'id_usuario', 'id')
    ORDER BY CASE column_name WHEN 'id_usuario_sistema' THEN 1 WHEN 'id_usuario_interno' THEN 2 WHEN 'id_usuario' THEN 3 ELSE 4 END
    LIMIT 1;

    IF pk_column IS NOT NULL THEN
      EXECUTE format(
        'INSERT INTO configuracion.usuario_sede (id_usuario, id_sede, es_predeterminada)
         SELECT %I::text, ''SEDE-PRINCIPAL'', true FROM seguridad.%I
         ON CONFLICT (id_usuario, id_sede) DO NOTHING',
        pk_column, user_table
      );
    END IF;
  END IF;
END $$;

-- Fase 1: agrega y rellena id_sede. Esta fase termina su transacción antes de
-- alterar las mismas tablas, para vaciar los eventos pendientes de sus triggers.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema IN ('g1_reservas', 'g2_housekeeping', 'g3_servicios', 'g4_finanzas', 'g5_crm', 'auditoria')
      AND NOT (
        (table_schema = 'g1_reservas' AND table_name IN ('tipo_habitacion', 'canal_reserva', 'temporada')) OR
        (table_schema = 'g2_housekeeping' AND table_name IN (
          'estado_habitacion', 'tipo_activo', 'area', 'turno',
          'personal_operativo', 'personal_limpieza', 'supervisor'
        )) OR
        (table_schema = 'g3_servicios' AND table_name IN ('unidad_medida')) OR
        (table_schema = 'g4_finanzas' AND table_name IN ('usuario', 'centro_costo')) OR
        (table_schema = 'g5_crm' AND table_name IN ('segmento', 'beneficio', 'transicion_permitida', 'area_responsable'))
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS id_sede varchar(40)',
      target.table_schema, target.table_name
    );
    -- El backfill solo completa metadatos de tenencia. No debe disparar reglas de
    -- negocio antiguas (por ejemplo, validar nuevamente órdenes ya históricas).
    EXECUTE format(
      'ALTER TABLE %I.%I DISABLE TRIGGER USER',
      target.table_schema, target.table_name
    );
    EXECUTE format(
      'UPDATE %I.%I SET id_sede = ''SEDE-PRINCIPAL'' WHERE id_sede IS NULL',
      target.table_schema, target.table_name
    );
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE TRIGGER USER',
      target.table_schema, target.table_name
    );
  END LOOP;
END $$;

COMMIT;
BEGIN;

-- Fase 2: una vez procesados los triggers del backfill, configura restricciones,
-- claves de negocio y aislamiento RLS.
DO $$
DECLARE
  target record;
  unique_constraint record;
  columns_sql text;
  policy_name text;
BEGIN
  FOR target IN
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema IN ('g1_reservas', 'g2_housekeeping', 'g3_servicios', 'g4_finanzas', 'g5_crm', 'auditoria')
      AND NOT (
        (table_schema = 'g1_reservas' AND table_name IN ('tipo_habitacion', 'canal_reserva', 'temporada')) OR
        (table_schema = 'g2_housekeeping' AND table_name IN (
          'estado_habitacion', 'tipo_activo', 'area', 'turno',
          'personal_operativo', 'personal_limpieza', 'supervisor'
        )) OR
        (table_schema = 'g3_servicios' AND table_name IN ('unidad_medida')) OR
        (table_schema = 'g4_finanzas' AND table_name IN ('usuario', 'centro_costo')) OR
        (table_schema = 'g5_crm' AND table_name IN ('segmento', 'beneficio', 'transicion_permitida', 'area_responsable'))
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN id_sede SET DEFAULT COALESCE(NULLIF(current_setting(''app.sede_id'', true), ''''), ''SEDE-PRINCIPAL'')',
      target.table_schema, target.table_name
    );
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN id_sede SET NOT NULL',
      target.table_schema, target.table_name
    );

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('%I.%I', target.table_schema, target.table_name)::regclass
        AND conname = 'fk_multisede_sede'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT fk_multisede_sede FOREIGN KEY (id_sede) REFERENCES configuracion.sede(id_sede)',
        target.table_schema, target.table_name
      );
    END IF;

    -- Las claves de negocio (número de habitación, RUC de proveedor, serie y
    -- correlativo, etc.) pueden repetirse entre sedes. Se conserva el PK técnico
    -- global y se vuelve compuesta cada restricción UNIQUE que no sea referenciada.
    FOR unique_constraint IN
      SELECT c.oid, c.conname, c.conkey
      FROM pg_constraint c
      WHERE c.conrelid = format('%I.%I', target.table_schema, target.table_name)::regclass
        AND c.contype = 'u'
        AND NOT EXISTS (
          SELECT 1 FROM unnest(c.conkey) key(attnum)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key.attnum
          WHERE a.attname = 'id_sede'
        )
    LOOP
      SELECT string_agg(format('%I', a.attname), ', ' ORDER BY key.ordinality)
      INTO columns_sql
      FROM unnest(unique_constraint.conkey) WITH ORDINALITY key(attnum, ordinality)
      JOIN pg_attribute a
        ON a.attrelid = format('%I.%I', target.table_schema, target.table_name)::regclass
       AND a.attnum = key.attnum;
      BEGIN
        EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', target.table_schema, target.table_name, unique_constraint.conname);
        EXECUTE format(
          'ALTER TABLE %I.%I ADD CONSTRAINT %I UNIQUE (id_sede, %s)',
          target.table_schema, target.table_name, unique_constraint.conname, columns_sql
        );
      EXCEPTION WHEN dependent_objects_still_exist THEN
        RAISE NOTICE 'Se conserva la restricción % por tener dependencias', unique_constraint.conname;
      END;
    END LOOP;

    policy_name := 'aislamiento_sede';
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', target.table_schema, target.table_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', target.table_schema, target.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', policy_name, target.table_schema, target.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I USING (
         id_sede = NULLIF(current_setting(''app.sede_id'', true), '''')
       ) WITH CHECK (
         id_sede = NULLIF(current_setting(''app.sede_id'', true), '''')
       )',
      policy_name, target.table_schema, target.table_name
    );
  END LOOP;
END $$;

-- Algunos despliegues no instalan todos los esquemas opcionales (por ejemplo,
-- auditoria). Los permisos se aplican únicamente a los que realmente existen.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name IN (
      'configuracion', 'g1_reservas', 'g2_housekeeping', 'g3_servicios',
      'g4_finanzas', 'g5_crm', 'auditoria', 'seguridad'
    )
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO erp_app_multisede', target.schema_name);

    IF target.schema_name = 'seguridad' THEN
      EXECUTE format(
        'GRANT SELECT ON ALL TABLES IN SCHEMA %I TO erp_app_multisede',
        target.schema_name
      );
    ELSE
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO erp_app_multisede',
        target.schema_name
      );
      EXECUTE format(
        'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA %I TO erp_app_multisede',
        target.schema_name
      );
      EXECUTE format(
        'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO erp_app_multisede',
        target.schema_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app_multisede',
        target.schema_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO erp_app_multisede',
        target.schema_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO erp_app_multisede',
        target.schema_name
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
