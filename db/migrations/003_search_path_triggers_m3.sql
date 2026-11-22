-- ============================================================================
-- 003 · Corrige la resolución de tablas dentro de triggers de M3
--
-- En la base desplegada, al entregar una comanda un trigger intenta acceder a
-- `consumo` sin calificar el esquema y PostgreSQL responde:
--   relation "consumo" does not exist
--
-- La tabla real es g3_servicios.consumo. Esta migración conserva el cuerpo de
-- cada función y establece un search_path seguro que incluye g3_servicios.
-- Es idempotente y cubre los triggers asociados al ciclo comanda -> consumo.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT DISTINCT
      function_ns.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments
    FROM pg_trigger t
    JOIN pg_class table_class ON table_class.oid = t.tgrelid
    JOIN pg_namespace table_ns ON table_ns.oid = table_class.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace function_ns ON function_ns.oid = p.pronamespace
    WHERE NOT t.tgisinternal
      AND table_ns.nspname = 'g3_servicios'
      AND table_class.relname IN ('comanda', 'detalle_comanda', 'consumo', 'detalle_consumo')
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = pg_catalog, g3_servicios, seguridad, public, pg_temp',
      fn.schema_name,
      fn.function_name,
      fn.identity_arguments
    );
  END LOOP;
END
$$;

COMMIT;
