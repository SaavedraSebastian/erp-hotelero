-- ============================================================================
-- SGH-ERP · MIGRACIÓN 001: CIERRE DE BRECHAS DE TABLAS Y COLUMNAS
-- Motor objetivo: PostgreSQL 16 (Supabase)
-- Prerrequisito: Haber ejecutado el SQL consolidado de G1..G5.
-- Seguro para re-ejecutar (idempotente mediante IF NOT EXISTS / DO blocks).
-- ============================================================================

BEGIN;
SET LOCAL client_encoding TO 'UTF8';
SET LOCAL TIME ZONE 'America/Lima';

-- ============================================================================
-- 1. MÓDULO 01 (g1_reservas): Privacidad ISO 27701 en huesped y características
--    en tipo_habitacion / habitacion
-- ============================================================================

ALTER TABLE g1_reservas.huesped
  ADD COLUMN IF NOT EXISTS nacionalidad           VARCHAR(80),
  ADD COLUMN IF NOT EXISTS empresa                VARCHAR(150),
  ADD COLUMN IF NOT EXISTS consentimiento_iso27701 BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fecha_consentimiento   DATE,
  ADD COLUMN IF NOT EXISTS marketing_opt_in       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notas                  TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_huesped_consentimiento_fecha'
      AND conrelid = 'g1_reservas.huesped'::regclass
  ) THEN
    ALTER TABLE g1_reservas.huesped
      ADD CONSTRAINT ck_huesped_consentimiento_fecha
      CHECK (fecha_consentimiento IS NULL OR consentimiento_iso27701 = TRUE);
  END IF;
END $$;

ALTER TABLE g1_reservas.tipo_habitacion
  ADD COLUMN IF NOT EXISTS caracteristicas JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE g1_reservas.habitacion
  ADD COLUMN IF NOT EXISTS caracteristicas JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_tipo_hab_caracteristicas_array'
      AND conrelid = 'g1_reservas.tipo_habitacion'::regclass
  ) THEN
    ALTER TABLE g1_reservas.tipo_habitacion
      ADD CONSTRAINT ck_tipo_hab_caracteristicas_array
      CHECK (jsonb_typeof(caracteristicas) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_hab_caracteristicas_array'
      AND conrelid = 'g1_reservas.habitacion'::regclass
  ) THEN
    ALTER TABLE g1_reservas.habitacion
      ADD CONSTRAINT ck_hab_caracteristicas_array
      CHECK (jsonb_typeof(caracteristicas) = 'array');
  END IF;
END $$;


-- ============================================================================
-- 2. MÓDULO 04 (g4_finanzas): Cuentas por Cobrar (CxC) y XML/SUNAT en comprobante
-- ============================================================================

CREATE TABLE IF NOT EXISTS g4_finanzas.cuenta_por_cobrar (
  id_cxc                   VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,
  id_cuenta                VARCHAR(36)   REFERENCES g4_finanzas.cuenta (id_cuenta),
  id_comprobante           VARCHAR(36)   REFERENCES g4_finanzas.comprobante (id_comprobante),
  id_huesped               BIGINT        REFERENCES g1_reservas.huesped (id_huesped),
  id_usuario               INTEGER       NOT NULL REFERENCES g4_finanzas.usuario (id_usuario),
  referencia_documento     VARCHAR(30)   NOT NULL,
  razon_social_cliente     VARCHAR(200)  NOT NULL,
  numero_documento_cliente VARCHAR(20),
  fecha_emision            DATE          NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento        DATE          NOT NULL,
  monto_original           NUMERIC(12,2) NOT NULL CHECK (monto_original > 0),
  monto_pagado             NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monto_pagado >= 0 AND monto_pagado <= monto_original),
  saldo_pendiente          NUMERIC(12,2) GENERATED ALWAYS AS (monto_original - monto_pagado) STORED,
  estado                   VARCHAR(12)   NOT NULL DEFAULT 'VIGENTE'
                           CHECK (estado IN ('VIGENTE', 'VENCIDA', 'PAGADA', 'ANULADA')),
  nota_seguimiento         VARCHAR(500),
  fecha_creacion           TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_actualizacion      TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_cxc_fechas CHECK (fecha_vencimiento >= fecha_emision),
  CONSTRAINT ck_cxc_pagada_sin_saldo CHECK (estado <> 'PAGADA' OR monto_pagado = monto_original)
);

CREATE INDEX IF NOT EXISTS ix_cxc_estado_vencimiento
  ON g4_finanzas.cuenta_por_cobrar (estado, fecha_vencimiento);
CREATE INDEX IF NOT EXISTS ix_cxc_cuenta
  ON g4_finanzas.cuenta_por_cobrar (id_cuenta);
CREATE INDEX IF NOT EXISTS ix_cxc_comprobante
  ON g4_finanzas.cuenta_por_cobrar (id_comprobante);

ALTER TABLE g4_finanzas.comprobante
  ADD COLUMN IF NOT EXISTS xml_ubl           TEXT,
  ADD COLUMN IF NOT EXISTS hash_cpe          VARCHAR(128),
  ADD COLUMN IF NOT EXISTS cdr_estado        VARCHAR(30),
  ADD COLUMN IF NOT EXISTS fecha_envio_sunat TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_comprobante_cdr_estado'
      AND conrelid = 'g4_finanzas.comprobante'::regclass
  ) THEN
    ALTER TABLE g4_finanzas.comprobante
      ADD CONSTRAINT ck_comprobante_cdr_estado
      CHECK (cdr_estado IS NULL OR cdr_estado IN ('PENDIENTE', 'ACEPTADO_SUNAT', 'OBSERVADO', 'RECHAZADO_SUNAT'));
  END IF;
END $$;

-- Mantener aislamiento de g4_finanzas frente a PUBLIC / roles Supabase Data API
REVOKE ALL ON TABLE g4_finanzas.cuenta_por_cobrar FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE g4_finanzas.cuenta_por_cobrar FROM %I', r);
    END IF;
  END LOOP;
END $$;


-- ============================================================================
-- 3. MÓDULO 05 (g5_crm): Solicitudes de huésped y ampliación de opinión/reseña
-- ============================================================================

-- Permitir que g5_crm_owner referencie g1_reservas.habitacion (para solicitud_huesped)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'g5_crm_owner') THEN
    GRANT REFERENCES ON g1_reservas.habitacion TO g5_crm_owner;
  END IF;
END $$;

CREATE SEQUENCE IF NOT EXISTS g5_crm.seq_codigo_solicitud_huesped START 1;

CREATE TABLE IF NOT EXISTS g5_crm.solicitud_huesped (
  id_solicitud_huesped INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo               VARCHAR(20)  NOT NULL UNIQUE,
  id_perfil            INTEGER      NOT NULL REFERENCES g5_crm.perfil_huesped (id_perfil),
  id_estadia           BIGINT       REFERENCES g1_reservas.estadia (id_estadia),
  id_habitacion        BIGINT       REFERENCES g1_reservas.habitacion (id_habitacion),
  numero_habitacion    VARCHAR(20),
  tipo                 VARCHAR(60)  NOT NULL,
  area_destino         VARCHAR(30)  NOT NULL
                       CHECK (area_destino IN ('Recepción', 'Housekeeping', 'Mantenimiento', 'Restaurante', 'Atención al huésped')),
  origen               VARCHAR(30)  NOT NULL DEFAULT 'Recepción/CRM'
                       CHECK (origen IN ('Portal Autoatención', 'Recepción/CRM', 'Asistente IA', 'Teléfono')),
  descripcion          VARCHAR(500) NOT NULL,
  estado               VARCHAR(20)  NOT NULL DEFAULT 'Pendiente'
                       CHECK (estado IN ('Pendiente', 'Derivada', 'En proceso', 'Completada', 'Cancelada')),
  notas_resolucion     VARCHAR(500),
  fecha_creacion       TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_atencion       TIMESTAMPTZ,
  CONSTRAINT ck_solicitud_huesped_fechas CHECK (fecha_atencion IS NULL OR fecha_atencion >= fecha_creacion)
);

CREATE INDEX IF NOT EXISTS ix_solicitud_huesped_perfil
  ON g5_crm.solicitud_huesped (id_perfil);
CREATE INDEX IF NOT EXISTS ix_solicitud_huesped_estado
  ON g5_crm.solicitud_huesped (estado, area_destino);

CREATE OR REPLACE FUNCTION g5_crm.fn_solicitud_huesped_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, g5_crm, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NULLIF(btrim(NEW.codigo), '') IS NULL THEN
    NEW.codigo := 'REQ-' || lpad(nextval('g5_crm.seq_codigo_solicitud_huesped')::text, 4, '0');
  END IF;
  IF NEW.estado IN ('Completada', 'Cancelada') AND NEW.fecha_atencion IS NULL THEN
    NEW.fecha_atencion := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_solicitud_huesped_defaults ON g5_crm.solicitud_huesped;
CREATE TRIGGER trg_solicitud_huesped_defaults
  BEFORE INSERT OR UPDATE ON g5_crm.solicitud_huesped
  FOR EACH ROW EXECUTE FUNCTION g5_crm.fn_solicitud_huesped_defaults();

-- Enlazar auditoría automática de G5 si fn_auditar ya existe
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'g5_crm' AND p.proname = 'fn_auditar'
  ) THEN
    DROP TRIGGER IF EXISTS trg_aud_solicitud_huesped ON g5_crm.solicitud_huesped;
    CREATE TRIGGER trg_aud_solicitud_huesped
      AFTER INSERT OR UPDATE OR DELETE ON g5_crm.solicitud_huesped
      FOR EACH ROW EXECUTE FUNCTION g5_crm.fn_auditar('id_solicitud_huesped');
  END IF;
END $$;

-- Permitir opiniones/reseñas externas sin estadía interna obligatoria
ALTER TABLE g5_crm.opinion
  ALTER COLUMN id_estadia DROP NOT NULL;

-- Canal y respuesta del hotel en reseñas
ALTER TABLE g5_crm.resena
  ADD COLUMN IF NOT EXISTS canal             VARCHAR(30) NOT NULL DEFAULT 'Directo',
  ADD COLUMN IF NOT EXISTS respuesta_hotel   TEXT,
  ADD COLUMN IF NOT EXISTS fecha_respuesta   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS usuario_respuesta VARCHAR(60);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_resena_canal_valido'
      AND conrelid = 'g5_crm.resena'::regclass
  ) THEN
    ALTER TABLE g5_crm.resena
      ADD CONSTRAINT ck_resena_canal_valido
      CHECK (canal IN ('Directo', 'Google', 'Booking.com', 'TripAdvisor', 'Expedia'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION g5_crm.fn_resena_fecha_respuesta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, g5_crm, pg_temp
AS $$
BEGIN
  IF NEW.respuesta_hotel IS NOT NULL AND NULLIF(btrim(NEW.respuesta_hotel), '') IS NOT NULL THEN
    IF NEW.fecha_respuesta IS NULL THEN
      NEW.fecha_respuesta := CURRENT_TIMESTAMP;
    END IF;
    IF NULLIF(btrim(NEW.usuario_respuesta), '') IS NULL THEN
      NEW.usuario_respuesta := g5_crm.fn_usuario_app();
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_resena_respuesta ON g5_crm.resena;
CREATE TRIGGER trg_resena_respuesta
  BEFORE INSERT OR UPDATE ON g5_crm.resena
  FOR EACH ROW EXECUTE FUNCTION g5_crm.fn_resena_fecha_respuesta();

-- Permisos y propiedad en g5_crm
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'g5_crm_owner') THEN
    ALTER TABLE g5_crm.solicitud_huesped OWNER TO g5_crm_owner;
    ALTER SEQUENCE g5_crm.seq_codigo_solicitud_huesped OWNER TO g5_crm_owner;
    ALTER FUNCTION g5_crm.fn_solicitud_huesped_defaults() OWNER TO g5_crm_owner;
    ALTER FUNCTION g5_crm.fn_resena_fecha_respuesta() OWNER TO g5_crm_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'g5_crm_app') THEN
    GRANT SELECT, INSERT, UPDATE ON g5_crm.solicitud_huesped TO g5_crm_app;
    GRANT USAGE ON SEQUENCE g5_crm.seq_codigo_solicitud_huesped TO g5_crm_app;
  END IF;
END $$;
REVOKE ALL ON TABLE g5_crm.solicitud_huesped FROM PUBLIC;
REVOKE ALL ON SEQUENCE g5_crm.seq_codigo_solicitud_huesped FROM PUBLIC;


-- ============================================================================
-- 4. TRANSVERSAL: Tabla y vista unificada de notificaciones operativas
--    Combina eventos propios + G2 (notificacion, alerta_predictiva) +
--    G3 (envio_externo) + G4 (alerta_financiera) + G5 (reclamo SLA)
-- ============================================================================

CREATE TABLE IF NOT EXISTS g5_crm.notificacion_sistema (
  id_notificacion VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
  modulo_origen   VARCHAR(10)  NOT NULL CHECK (modulo_origen IN ('M1', 'M2', 'M3', 'M4', 'M5', 'SISTEMA')),
  modulos_destino TEXT[]       NOT NULL DEFAULT ARRAY['M1', 'M2', 'M3', 'M4', 'M5']::text[],
  titulo          VARCHAR(150) NOT NULL,
  mensaje         VARCHAR(400) NOT NULL,
  severidad       VARCHAR(10)  NOT NULL DEFAULT 'info' CHECK (severidad IN ('info', 'success', 'warning', 'error')),
  entidad_ref     VARCHAR(60),
  leida           BOOLEAN      NOT NULL DEFAULT FALSE,
  fecha_hora      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_notificacion_sistema_fecha
  ON g5_crm.notificacion_sistema (leida, fecha_hora DESC);

CREATE OR REPLACE VIEW g5_crm.v_notificaciones_erp AS
SELECT
  'SYS-' || ns.id_notificacion AS id_evento,
  ns.modulo_origen,
  ns.modulos_destino,
  ns.titulo,
  ns.mensaje,
  ns.severidad,
  ns.entidad_ref,
  ns.leida,
  ns.fecha_hora
FROM g5_crm.notificacion_sistema ns

UNION ALL

SELECT
  'G2-NTF-' || n.id_notificacion::text AS id_evento,
  'M2' AS modulo_origen,
  ARRAY['M2']::text[] AS modulos_destino,
  n.tipo_evento AS titulo,
  n.mensaje,
  CASE
    WHEN n.tipo_evento IN ('IncidenciaCritica', 'InspeccionRechazada') THEN 'error'
    WHEN n.tipo_evento IN ('StockBajo', 'AlertaPredictiva') THEN 'warning'
    ELSE 'info'
  END AS severidad,
  n.tipo_referencia || ':' || n.id_referencia::text AS entidad_ref,
  n.leida,
  n.fecha_hora_generacion AS fecha_hora
FROM g2_housekeeping.notificacion n

UNION ALL

SELECT
  'G2-ALT-' || a.id_alerta::text AS id_evento,
  'M2' AS modulo_origen,
  ARRAY['M2', 'M1']::text[] AS modulos_destino,
  'Alerta predictiva en activo #' || a.id_activo::text AS titulo,
  a.factores_explicativos AS mensaje,
  'warning' AS severidad,
  'activo:' || a.id_activo::text AS entidad_ref,
  (a.estado <> 'Abierta') AS leida,
  a.fecha_hora_generacion AS fecha_hora
FROM g2_housekeeping.alerta_predictiva a

UNION ALL

SELECT
  'G3-ENV-' || e.id_envio AS id_evento,
  'M3' AS modulo_origen,
  CASE e.destino
    WHEN 'Facturación y Finanzas' THEN ARRAY['M4']::text[]
    WHEN 'CRM y Atención al Huésped' THEN ARRAY['M5']::text[]
    ELSE ARRAY['M2']::text[]
  END AS modulos_destino,
  'Integración G3: ' || e.tipo_envio AS titulo,
  COALESCE(e.motivo_rechazo, 'Envío ' || e.estado || ' (' || e.id_referencia || ')') AS mensaje,
  CASE
    WHEN e.estado IN ('rechazado', 'sin respuesta') THEN 'error'
    WHEN e.estado = 'pendiente' THEN 'warning'
    ELSE 'success'
  END AS severidad,
  e.id_referencia AS entidad_ref,
  (e.estado = 'aceptado') AS leida,
  e.fecha_hora_intento::timestamptz AS fecha_hora
FROM g3_servicios.envio_externo e

UNION ALL

SELECT
  'G4-ALT-' || af.id_alerta AS id_evento,
  'M4' AS modulo_origen,
  ARRAY['M4']::text[] AS modulos_destino,
  'Alerta financiera (' || af.tipo_operacion || ')' AS titulo,
  COALESCE(af.justificacion, 'Anomalía detectada por S/ ' || af.monto::text || ' · Severidad ' || af.severidad) AS mensaje,
  CASE af.severidad
    WHEN 'ALTA' THEN 'error'
    WHEN 'MEDIA' THEN 'warning'
    ELSE 'info'
  END AS severidad,
  COALESCE(af.id_cuenta, af.id_turno_caja, af.id_alerta) AS entidad_ref,
  (af.clasificacion <> 'PENDIENTE') AS leida,
  af.fecha_hora::timestamptz AS fecha_hora
FROM g4_finanzas.alerta_financiera af;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'g5_crm_owner') THEN
    -- Privilegios mínimos para que la vista unificada pueda leer alertas de G2/G3/G4
    GRANT USAGE ON SCHEMA g2_housekeeping, g3_servicios, g4_finanzas TO g5_crm_owner;
    GRANT SELECT ON g2_housekeeping.notificacion TO g5_crm_owner;
    GRANT SELECT ON g2_housekeeping.alerta_predictiva TO g5_crm_owner;
    GRANT SELECT ON g3_servicios.envio_externo TO g5_crm_owner;
    GRANT SELECT ON g4_finanzas.alerta_financiera TO g5_crm_owner;

    ALTER TABLE g5_crm.notificacion_sistema OWNER TO g5_crm_owner;
    ALTER VIEW g5_crm.v_notificaciones_erp OWNER TO g5_crm_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'g5_crm_app') THEN
    GRANT SELECT, INSERT, UPDATE ON g5_crm.notificacion_sistema TO g5_crm_app;
    GRANT SELECT ON g5_crm.v_notificaciones_erp TO g5_crm_app;
  END IF;
END $$;

REVOKE ALL ON TABLE g5_crm.notificacion_sistema FROM PUBLIC;
REVOKE ALL ON TABLE g5_crm.v_notificaciones_erp FROM PUBLIC;

-- Asegurar bloqueo para anon / authenticated si existen en Supabase
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE g5_crm.solicitud_huesped FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE g5_crm.seq_codigo_solicitud_huesped FROM %I', r);
      EXECUTE format('REVOKE ALL ON TABLE g5_crm.notificacion_sistema FROM %I', r);
      EXECUTE format('REVOKE ALL ON TABLE g5_crm.v_notificaciones_erp FROM %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
