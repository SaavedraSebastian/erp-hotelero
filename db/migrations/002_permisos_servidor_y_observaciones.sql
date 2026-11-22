-- ============================================================================
-- 002 · Alinea el catálogo RBAC con los permisos que exige el servidor
--       y permite guardar la observación al avanzar un reclamo.
--
-- Contexto
--   El servidor (server/modules/seguridad/permissions.ts) valida 67 códigos de permiso, pero el catálogo
--   sembrado en la base solo contiene 39 de ellos. Los 28 restantes tienen otro nombre en el catálogo
--   (p. ej. m1.huesped.administrar en vez de m1.huesped.gestionar). Con esa diferencia, solo el rol
--   ADMINISTRADOR (que se salta la verificación) podía operar; cualquier otro rol recibía 403.
--
-- Qué hace
--   1. Inserta los códigos que faltan.
--   2. Los concede a TODOS los roles que ya tienen el permiso equivalente del catálogo (tabla `equiv`),
--      de modo que ningún rol gana más poder del que ya tenía.
--   3. Agrega m1.habitacion.administrar (alta/edición de habitaciones), concedido a quien ya
--      administra tarifas.
--   4. Reemplaza el trigger de seguimiento de reclamos para que registre la observación enviada por el
--      servidor (variable de sesión app.observacion); la tabla es un historial inmutable.
--
-- Es idempotente: se puede ejecutar más de una vez.
-- ============================================================================
BEGIN;

WITH equiv(codigo_servidor, nombre, modulo, codigo_catalogo) AS (VALUES
  ('m1.checkin.registrar',        'Registrar check-in',                       'M1', 'm1.estadia.checkin'),
  ('m1.checkout.registrar',       'Registrar check-out',                      'M1', 'm1.estadia.checkout'),
  ('m1.habitacion.consultar',     'Consultar habitaciones',                   'M1', 'm1.reserva.consultar'),
  ('m1.huesped.gestionar',        'Gestionar huéspedes',                      'M1', 'm1.huesped.administrar'),
  ('m1.reserva.actualizar',       'Actualizar reservas (cancelar / no-show)', 'M1', 'm1.reserva.modificar'),
  ('m1.reserva.actualizar',       'Actualizar reservas (cancelar / no-show)', 'M1', 'm1.reserva.cancelar'),
  ('m2.estado.actualizar',        'Cambiar estado de habitación',             'M2', 'm2.habitacion.cambiar_estado'),
  ('m2.estado.consultar',         'Consultar estado de habitaciones',         'M2', 'm2.habitacion.consultar'),
  ('m2.inspeccion.registrar',     'Registrar inspección',                     'M2', 'm2.limpieza.inspeccionar'),
  ('m2.insumo.mover',             'Registrar movimientos de insumos',         'M2', 'm2.insumo.registrar_movimiento'),
  ('m2.limpieza.crear',           'Crear órdenes de limpieza',                'M2', 'm2.limpieza.asignar'),
  ('m2.mantenimiento.crear',      'Crear incidencias y órdenes de trabajo',   'M2', 'm2.mantenimiento.administrar'),
  ('m3.comanda.actualizar',       'Avanzar y entregar comandas',              'M3', 'm3.comanda.preparar'),
  ('m3.comanda.actualizar',       'Avanzar y entregar comandas',              'M3', 'm3.comanda.entregar'),
  ('m3.compra.enviar',            'Enviar órdenes de compra',                 'M3', 'm3.compra.preparar'),
  ('m3.inventario.mover',         'Registrar movimientos de inventario',      'M3', 'm3.inventario.registrar_movimiento'),
  ('m3.inventario.mover',         'Registrar movimientos de inventario',      'M3', 'm3.inventario.ajustar'),
  ('m4.alerta.revisar',           'Revisar alertas financieras',              'M4', 'm4.alerta.clasificar'),
  ('m4.caja.cerrar',              'Cerrar turno de caja',                     'M4', 'm4.caja.administrar'),
  ('m4.caja.operar',              'Operar caja y registrar cobros',           'M4', 'm4.caja.administrar'),
  ('m4.caja.operar',              'Operar caja y registrar cobros',           'M4', 'm4.cobro.registrar'),
  ('m4.cuenta.operar',            'Operar cuentas de huésped',                'M4', 'm4.cuenta.administrar'),
  ('m5.campana.gestionar',        'Gestionar campañas',                       'M5', 'm5.campana.administrar'),
  ('m5.compensacion.solicitar',   'Solicitar compensaciones',                 'M5', 'm5.reclamo.administrar'),
  ('m5.fidelizacion.consultar',   'Consultar fidelización',                   'M5', 'm5.puntos.consultar'),
  ('m5.fidelizacion.operar',      'Operar puntos de fidelización',            'M5', 'm5.puntos.administrar'),
  ('m5.preferencia.gestionar',    'Gestionar preferencias del huésped',       'M5', 'm5.perfil.administrar'),
  ('m5.reclamo.atender',          'Atender reclamos',                         'M5', 'm5.reclamo.administrar'),
  ('m5.reclamo.crear',            'Registrar reclamos',                       'M5', 'm5.reclamo.administrar'),
  ('m5.segmento.consultar',       'Consultar segmentos',                      'M5', 'm5.perfil.consultar'),
  ('m5.solicitud.atender',        'Atender solicitudes de huésped',           'M5', 'm5.solicitud.administrar'),
  ('m5.solicitud.crear',          'Registrar solicitudes de huésped',         'M5', 'm5.solicitud.administrar'),
  -- Nuevo: alta y edición de habitaciones (concedido a quien administra tarifas)
  ('m1.habitacion.administrar',   'Crear y editar habitaciones',              'M1', 'm1.tarifa.administrar')
),
nuevos AS (
  INSERT INTO seguridad.permiso (codigo, nombre, modulo, sensible)
  SELECT DISTINCT ON (codigo_servidor) codigo_servidor, nombre, modulo, FALSE
  FROM equiv
  ON CONFLICT (codigo) DO NOTHING
  RETURNING 1
)
INSERT INTO seguridad.rol_permiso (id_rol, id_permiso)
SELECT DISTINCT rp.id_rol, ps.id_permiso
FROM equiv e
JOIN seguridad.permiso pc ON pc.codigo = e.codigo_catalogo
JOIN seguridad.rol_permiso rp ON rp.id_permiso = pc.id_permiso
JOIN seguridad.permiso ps ON ps.codigo = e.codigo_servidor
ON CONFLICT (id_rol, id_permiso) DO NOTHING;

-- El administrador recibe todos los permisos activos (incluidos los nuevos).
INSERT INTO seguridad.rol_permiso (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso
FROM seguridad.rol r CROSS JOIN seguridad.permiso p
WHERE r.codigo = 'ADMINISTRADOR' AND p.activo
ON CONFLICT (id_rol, id_permiso) DO NOTHING;

-- Seguimiento de reclamos: la observación llega por la variable de sesión app.observacion.
CREATE OR REPLACE FUNCTION g5_crm.fn_reclamo_seguimiento()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'g5_crm', 'pg_temp'
AS $funcion$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO seguimiento_reclamo (id_reclamo, estado_anterior, estado_nuevo, usuario, observacion)
    VALUES (NEW.id_reclamo, NULL, NEW.estado, fn_usuario_app(), 'Registro inicial');
  ELSIF NEW.estado <> OLD.estado THEN
    INSERT INTO seguimiento_reclamo (id_reclamo, estado_anterior, estado_nuevo, usuario, observacion)
    VALUES (NEW.id_reclamo, OLD.estado, NEW.estado, fn_usuario_app(),
            NULLIF(left(btrim(current_setting('app.observacion', true)), 250), ''));
  END IF;
  RETURN NULL;
END
$funcion$;

COMMIT;
