BEGIN;

-- Cada operación externa se registra una sola vez. Los reintentos actualizan la
-- misma fila en lugar de duplicar consumos, costos o avisos de anulación.
CREATE UNIQUE INDEX IF NOT EXISTS ux_g3_envio_externo_operacion
  ON g3_servicios.envio_externo (destino, tipo_envio, id_referencia);

-- Evita que una misma confirmación descuente dos veces el mismo artículo por
-- una repetición de la solicitud HTTP.
CREATE UNIQUE INDEX IF NOT EXISTS ux_g3_movimiento_origen_tipo_articulo_lote
  ON g3_servicios.movimiento_inventario (
    id_origen,
    tipo_movimiento,
    id_articulo,
    COALESCE(id_lote, '')
  )
  WHERE id_origen IS NOT NULL
    AND tipo_movimiento IN ('Consumo POS', 'Anulación consumo', 'Anulación recepción');

COMMIT;
