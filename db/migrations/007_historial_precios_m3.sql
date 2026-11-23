BEGIN;

CREATE TABLE IF NOT EXISTS g3_servicios.historial_precio_item (
  id_historial varchar(36) PRIMARY KEY,
  id_item_catalogo varchar(36) NOT NULL REFERENCES g3_servicios.item_catalogo(id_item_catalogo),
  precio_anterior numeric(12,2) NOT NULL CHECK (precio_anterior >= 0),
  precio_nuevo numeric(12,2) NOT NULL CHECK (precio_nuevo >= 0),
  motivo varchar(500) NOT NULL,
  fecha_hora timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario varchar(36) NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.usuario_id', true), ''), current_user),
  id_sede varchar(40) NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.sede_id', true), ''), 'SEDE-PRINCIPAL')
    REFERENCES configuracion.sede(id_sede)
);

-- Compatibilidad con instalaciones donde esta tabla ya había sido creada con
-- otros nombres. CREATE TABLE IF NOT EXISTS no agrega columnas a una tabla
-- preexistente, por eso se normalizan explícitamente antes de usarlas.
ALTER TABLE g3_servicios.historial_precio_item
  ADD COLUMN IF NOT EXISTS id_historial varchar(36);

DO $$
DECLARE
  columna_id_previa text;
BEGIN
  SELECT c.column_name
  INTO columna_id_previa
  FROM information_schema.columns c
  WHERE c.table_schema = 'g3_servicios'
    AND c.table_name = 'historial_precio_item'
    AND c.column_name IN ('id_historial_precio', 'id_cambio_precio', 'id_historial_item')
  ORDER BY CASE c.column_name
    WHEN 'id_historial_precio' THEN 1
    WHEN 'id_cambio_precio' THEN 2
    ELSE 3
  END
  LIMIT 1;

  IF columna_id_previa IS NOT NULL THEN
    EXECUTE format(
      'UPDATE g3_servicios.historial_precio_item SET id_historial = LEFT(%I::text, 36) WHERE id_historial IS NULL',
      columna_id_previa
    );
  END IF;
END $$;

UPDATE g3_servicios.historial_precio_item
SET id_historial = md5(
  tableoid::text || ':' || ctid::text || ':' || clock_timestamp()::text || ':' || random()::text
)
WHERE id_historial IS NULL;

ALTER TABLE g3_servicios.historial_precio_item
  ALTER COLUMN id_historial SET DEFAULT md5(clock_timestamp()::text || ':' || random()::text),
  ALTER COLUMN id_historial SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_historial_precio_item_id_historial
  ON g3_servicios.historial_precio_item (id_historial);

-- La versión original de algunas bases conserva `id_historial_precio` como
-- identificador obligatorio. Se mantiene y se le asigna un valor automático
-- para que las inserciones nuevas también sean compatibles con ese esquema.
DO $$
DECLARE
  tipo_id_legado text;
BEGIN
  SELECT c.data_type
  INTO tipo_id_legado
  FROM information_schema.columns c
  WHERE c.table_schema = 'g3_servicios'
    AND c.table_name = 'historial_precio_item'
    AND c.column_name = 'id_historial_precio';

  IF tipo_id_legado IN ('character varying', 'character', 'text') THEN
    EXECUTE $sql$
      ALTER TABLE g3_servicios.historial_precio_item
      ALTER COLUMN id_historial_precio
      SET DEFAULT md5(clock_timestamp()::text || ':' || random()::text)
    $sql$;
  ELSIF tipo_id_legado = 'uuid' THEN
    EXECUTE $sql$
      ALTER TABLE g3_servicios.historial_precio_item
      ALTER COLUMN id_historial_precio
      SET DEFAULT md5(clock_timestamp()::text || ':' || random()::text)::uuid
    $sql$;
  END IF;
END $$;

-- En el modelo legado la vigencia inicial es obligatoria. Las inserciones del
-- historial actual no necesitan conocer esa diferencia de versión.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'g3_servicios'
      AND c.table_name = 'historial_precio_item'
      AND c.column_name = 'vigente_desde'
  ) THEN
    ALTER TABLE g3_servicios.historial_precio_item
      ALTER COLUMN vigente_desde SET DEFAULT CURRENT_TIMESTAMP;
  END IF;
END $$;

ALTER TABLE g3_servicios.historial_precio_item
  ADD COLUMN IF NOT EXISTS fecha_hora timestamp(0);

DO $$
DECLARE
  columna_fecha_previa text;
BEGIN
  SELECT c.column_name
  INTO columna_fecha_previa
  FROM information_schema.columns c
  WHERE c.table_schema = 'g3_servicios'
    AND c.table_name = 'historial_precio_item'
    AND c.column_name IN ('fecha_hora_cambio', 'fecha_cambio', 'fecha_hora_registro', 'fecha_modificacion')
  ORDER BY CASE c.column_name
    WHEN 'fecha_hora_cambio' THEN 1
    WHEN 'fecha_cambio' THEN 2
    WHEN 'fecha_hora_registro' THEN 3
    ELSE 4
  END
  LIMIT 1;

  IF columna_fecha_previa IS NOT NULL THEN
    EXECUTE format(
      'UPDATE g3_servicios.historial_precio_item SET fecha_hora = %I WHERE fecha_hora IS NULL',
      columna_fecha_previa
    );
  END IF;
END $$;

UPDATE g3_servicios.historial_precio_item
SET fecha_hora = CURRENT_TIMESTAMP
WHERE fecha_hora IS NULL;

ALTER TABLE g3_servicios.historial_precio_item
  ALTER COLUMN fecha_hora SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN fecha_hora SET NOT NULL;

CREATE INDEX IF NOT EXISTS ix_historial_precio_item_consulta
  ON g3_servicios.historial_precio_item (id_sede, id_item_catalogo, fecha_hora DESC);

-- No se crea una fila inicial precio→mismo precio: el modelo exige que cada
-- entrada represente un cambio real. El trigger existente de item_catalogo
-- registrará las modificaciones posteriores junto con su motivo.

ALTER TABLE g3_servicios.historial_precio_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE g3_servicios.historial_precio_item FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_sede ON g3_servicios.historial_precio_item;
CREATE POLICY aislamiento_sede ON g3_servicios.historial_precio_item
  USING (id_sede = NULLIF(current_setting('app.sede_id', true), ''))
  WITH CHECK (id_sede = NULLIF(current_setting('app.sede_id', true), ''));

GRANT SELECT, INSERT ON g3_servicios.historial_precio_item TO erp_app_multisede;

COMMIT;
