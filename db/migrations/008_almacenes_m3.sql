BEGIN;

CREATE TABLE IF NOT EXISTS g3_servicios.almacen (
  id_almacen varchar(36) PRIMARY KEY,
  nombre varchar(120) NOT NULL,
  descripcion varchar(250),
  es_principal boolean NOT NULL DEFAULT false,
  estado varchar(40) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
  fecha_creacion timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_creacion varchar(36) NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.usuario_id', true), ''), current_user),
  fecha_modificacion timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_modificacion varchar(36) NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.usuario_id', true), ''), current_user),
  id_sede varchar(40) NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.sede_id', true), ''), 'SEDE-PRINCIPAL')
    REFERENCES configuracion.sede(id_sede),
  UNIQUE (id_sede, nombre)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_almacen_principal_sede
  ON g3_servicios.almacen (id_sede) WHERE es_principal AND estado = 'activo';

INSERT INTO g3_servicios.almacen (id_almacen, nombre, descripcion, es_principal, id_sede)
SELECT 'ALM-' || substr(md5(s.id_sede), 1, 12), 'Almacén principal',
       'Almacén principal migrado automáticamente', true, s.id_sede
FROM configuracion.sede s
ON CONFLICT (id_sede, nombre) DO NOTHING;

ALTER TABLE g3_servicios.lote_articulo ADD COLUMN IF NOT EXISTS id_almacen varchar(36);

UPDATE g3_servicios.lote_articulo lote
SET id_almacen = almacen.id_almacen
FROM g3_servicios.almacen almacen
WHERE lote.id_almacen IS NULL
  AND almacen.id_sede = lote.id_sede
  AND almacen.es_principal
  AND almacen.estado = 'activo';

ALTER TABLE g3_servicios.lote_articulo ALTER COLUMN id_almacen SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'g3_servicios.lote_articulo'::regclass
      AND conname = 'fk_lote_articulo_almacen'
  ) THEN
    ALTER TABLE g3_servicios.lote_articulo
      ADD CONSTRAINT fk_lote_articulo_almacen
      FOREIGN KEY (id_almacen) REFERENCES g3_servicios.almacen(id_almacen);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_lote_articulo_almacen
  ON g3_servicios.lote_articulo (id_sede, id_almacen, id_articulo);

ALTER TABLE g3_servicios.almacen ENABLE ROW LEVEL SECURITY;
ALTER TABLE g3_servicios.almacen FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_sede ON g3_servicios.almacen;
CREATE POLICY aislamiento_sede ON g3_servicios.almacen
  USING (id_sede = NULLIF(current_setting('app.sede_id', true), ''))
  WITH CHECK (id_sede = NULLIF(current_setting('app.sede_id', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON g3_servicios.almacen TO erp_app_multisede;

COMMIT;
