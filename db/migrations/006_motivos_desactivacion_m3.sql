BEGIN;

ALTER TABLE g3_servicios.punto_venta
  ADD COLUMN IF NOT EXISTS motivo_desactivacion VARCHAR(500);

ALTER TABLE g3_servicios.categoria
  ADD COLUMN IF NOT EXISTS motivo_desactivacion VARCHAR(500);

ALTER TABLE g3_servicios.articulo_almacen
  ADD COLUMN IF NOT EXISTS motivo_desactivacion VARCHAR(500);

COMMIT;
