import type { PoolClient } from 'pg';
import type { PaginationParams } from '../../shared/types/context.ts';
import { pushDateRange, pushSearchFilter, pushStatusFilter } from '../../shared/pagination/index.ts';

export async function listCatalogo(client: PoolClient) {
  const puntosRes = await client.query(
    `SELECT id_punto_venta, nombre, tipo, estado FROM g3_servicios.punto_venta ORDER BY nombre ASC`
  );
  const mesasRes = await client.query(
    `SELECT id_mesa, id_punto_venta, nombre, estado FROM g3_servicios.mesa ORDER BY nombre ASC`
  );
  const itemsRes = await client.query(
    `SELECT
       ic.id_item_catalogo,
       ic.id_punto_venta,
       pv.nombre AS punto_venta_nombre,
       pv.estado AS punto_venta_estado,
       ic.id_categoria,
       c.nombre AS categoria_nombre,
       ic.nombre,
       ic.tipo_item,
       ic.precio_vigente::text AS precio_vigente,
       ic.condicion_cobro,
       ic.id_articulo_descuento,
       ic.duracion_estimada,
       ic.cupo_por_atencion,
       ic.estado
     FROM g3_servicios.item_catalogo ic
     JOIN g3_servicios.punto_venta pv ON pv.id_punto_venta = ic.id_punto_venta
     JOIN g3_servicios.categoria c ON c.id_categoria = ic.id_categoria
     ORDER BY pv.nombre ASC, ic.nombre ASC`
  );
  // Catálogos de apoyo a los formularios de artículos, ítems y recetas.
  const categoriasRes = await client.query(
    `SELECT id_categoria, nombre, uso, estado FROM g3_servicios.categoria ORDER BY uso, nombre`
  );
  const unidadesRes = await client.query(
    `SELECT id_unidad_medida, nombre, simbolo, estado FROM g3_servicios.unidad_medida ORDER BY nombre`
  );
  const almacenesRes = await client.query(
    `SELECT id_almacen, nombre, descripcion, es_principal, estado
     FROM g3_servicios.almacen ORDER BY es_principal DESC, nombre`
  );
  return {
    puntos_venta: puntosRes.rows,
    mesas: mesasRes.rows,
    items: itemsRes.rows,
    categorias: categoriasRes.rows,
    unidades: unidadesRes.rows,
    almacenes: almacenesRes.rows,
  };
}

export async function listHistorialPrecios(client: PoolClient, idItem: string, params: PaginationParams) {
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM g3_servicios.historial_precio_item
     WHERE id_item_catalogo = $1`,
    [idItem]
  );
  const rows = await client.query(
    `SELECT id_historial, id_item_catalogo,
            precio_anterior::text AS precio_anterior,
            precio_nuevo::text AS precio_nuevo,
            motivo, fecha_hora::text AS fecha_hora, usuario
     FROM g3_servicios.historial_precio_item
     WHERE id_item_catalogo = $1
     ORDER BY fecha_hora DESC, id_historial DESC
     LIMIT $2 OFFSET $3`,
    [idItem, params.pageSize, (params.page - 1) * params.pageSize]
  );
  return { rows: rows.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function listComandas(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  pushStatusFilter(values, where, 'c.estado', params.status);
  pushDateRange(values, where, 'c.fecha_hora_apertura', params.fromDate, params.toDate);
  if (params.modalidad) {
    values.push(params.modalidad);
    where.push(`c.modalidad = $${values.length}`);
  }
  pushSearchFilter(values, where, ['c.numero_comanda', 'c.nombre_mesa_capturado', 'pv.nombre', 'hb.numero', "(hu.nombres || ' ' || hu.apellidos)"], params.search);
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM g3_servicios.comanda c
     JOIN g3_servicios.punto_venta pv ON pv.id_punto_venta = c.id_punto_venta
     LEFT JOIN g3_servicios.estadia_externa ee ON ee.id_estadia_externa = c.id_estadia_externa
     LEFT JOIN g1_reservas.habitacion hb ON hb.id_habitacion::text = ee.id_habitacion_externa
     LEFT JOIN g1_reservas.huesped hu ON hu.id_huesped::text = ee.id_huesped_externo
     ${whereClause}`,
    values
  );
  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  const dataRes = await client.query(
    `SELECT
       c.numero_comanda,
       c.id_punto_venta,
       pv.nombre AS punto_venta_nombre,
       c.id_mesa,
       c.nombre_mesa_capturado,
       c.modalidad,
       c.estado,
       c.fecha_hora_apertura::text AS fecha_hora_apertura,
       c.fecha_hora_entrega::text AS fecha_hora_entrega,
       c.motivo_cancelacion,
       c.id_estadia_externa,
       c.usuario_responsable,
       hb.numero AS numero_habitacion,
       (hu.nombres || ' ' || hu.apellidos) AS huesped_nombre,
       COALESCE(
         (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id_detalle_comanda', dc.id_detalle_comanda,
               'id_item_catalogo', dc.id_item_catalogo,
               'nombre_item', ic.nombre,
               'cantidad', dc.cantidad::text,
               'precio_capturado', dc.precio_capturado::text,
               'observacion_preparacion', dc.observacion_preparacion
             )
           )
           FROM g3_servicios.detalle_comanda dc
           JOIN g3_servicios.item_catalogo ic ON ic.id_item_catalogo = dc.id_item_catalogo
           WHERE dc.numero_comanda = c.numero_comanda
         ),
         '[]'::jsonb
       ) AS detalles
     FROM g3_servicios.comanda c
     JOIN g3_servicios.punto_venta pv ON pv.id_punto_venta = c.id_punto_venta
     LEFT JOIN g3_servicios.estadia_externa ee ON ee.id_estadia_externa = c.id_estadia_externa
     LEFT JOIN g1_reservas.habitacion hb ON hb.id_habitacion::text = ee.id_habitacion_externa
     LEFT JOIN g1_reservas.huesped hu ON hu.id_huesped::text = ee.id_huesped_externo
     ${whereClause}
     ORDER BY c.fecha_hora_apertura DESC, c.numero_comanda DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { rows: dataRes.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function listConsumos(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  pushStatusFilter(values, where, 'con.estado', params.status);
  pushDateRange(values, where, 'con.fecha_hora_registro', params.fromDate, params.toDate);
  if (params.puntoVenta) {
    values.push(params.puntoVenta);
    where.push(`con.id_punto_venta = $${values.length}`);
  }
  pushSearchFilter(values, where, ['con.numero_consumo', 'pv.nombre', 'con.forma_cobro', 'hb.numero', "(hu.nombres || ' ' || hu.apellidos)"], params.search);
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM g3_servicios.consumo con
     JOIN g3_servicios.punto_venta pv ON pv.id_punto_venta = con.id_punto_venta
     LEFT JOIN g3_servicios.estadia_externa ee ON ee.id_estadia_externa = con.id_estadia_externa
     LEFT JOIN g1_reservas.habitacion hb ON hb.id_habitacion::text = ee.id_habitacion_externa
     LEFT JOIN g1_reservas.huesped hu ON hu.id_huesped::text = ee.id_huesped_externo
     ${whereClause}`,
    values
  );
  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  const dataRes = await client.query(
    `SELECT
       con.numero_consumo,
       con.id_punto_venta,
       pv.nombre AS punto_venta_nombre,
       con.forma_cobro,
       con.importe_total::text AS importe_total,
       con.estado,
       con.fecha_hora_registro::text AS fecha_hora_registro,
       con.fecha_hora_confirmacion::text AS fecha_hora_confirmacion,
       con.id_estadia_externa,
       con.id_cuenta_cobro_externa,
       con.id_paquete_externo,
       con.usuario_responsable,
       CASE WHEN con.id_estadia_externa IS NULL THEN NULL ELSE (
         SELECT COALESCE(SUM(c2.importe_total), 0)::text
         FROM g3_servicios.consumo c2
         WHERE c2.id_estadia_externa = con.id_estadia_externa
           AND c2.estado IN ('por confirmar', 'confirmado')
       ) END AS total_estadia,
       hb.numero AS numero_habitacion,
       (hu.nombres || ' ' || hu.apellidos) AS huesped_nombre,
       COALESCE(
         (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id_detalle_consumo', dc.id_detalle_consumo,
               'id_item_catalogo', dc.id_item_catalogo,
               'nombre_item', ic.nombre,
               'cantidad', dc.cantidad::text,
               'precio_capturado', dc.precio_capturado::text,
               'importe_lista', dc.importe_lista::text,
               'importe', dc.importe::text
             )
           )
           FROM g3_servicios.detalle_consumo dc
           JOIN g3_servicios.item_catalogo ic ON ic.id_item_catalogo = dc.id_item_catalogo
           WHERE dc.numero_consumo = con.numero_consumo
         ),
         '[]'::jsonb
       ) AS detalles
     FROM g3_servicios.consumo con
     JOIN g3_servicios.punto_venta pv ON pv.id_punto_venta = con.id_punto_venta
     LEFT JOIN g3_servicios.estadia_externa ee ON ee.id_estadia_externa = con.id_estadia_externa
     LEFT JOIN g1_reservas.habitacion hb ON hb.id_habitacion::text = ee.id_habitacion_externa
     LEFT JOIN g1_reservas.huesped hu ON hu.id_huesped::text = ee.id_huesped_externo
     ${whereClause}
     ORDER BY con.fecha_hora_registro DESC, con.numero_consumo DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { rows: dataRes.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function listSolicitudesServicio(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  pushStatusFilter(values, where, 's.estado', params.status);
  pushDateRange(values, where, 's.fecha_hora_prevista', params.fromDate, params.toDate);
  pushSearchFilter(values, where, ['s.numero_solicitud', 'ic.nombre', 'hb.numero', "(hu.nombres || ' ' || hu.apellidos)"], params.search);
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const count = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM g3_servicios.solicitud_servicio s
     JOIN g3_servicios.item_catalogo ic ON ic.id_item_catalogo = s.id_item_catalogo
     LEFT JOIN g3_servicios.estadia_externa ee ON ee.id_estadia_externa = s.id_estadia_externa
     LEFT JOIN g1_reservas.habitacion hb ON hb.id_habitacion::text = ee.id_habitacion_externa
     LEFT JOIN g1_reservas.huesped hu ON hu.id_huesped::text = ee.id_huesped_externo
     ${clause}`, values
  );
  values.push(params.pageSize, (params.page - 1) * params.pageSize);
  const rows = await client.query(
    `SELECT s.numero_solicitud, s.id_estadia_externa, s.id_item_catalogo,
            ic.nombre AS servicio, s.cantidad_solicitada::text AS cantidad_solicitada,
            s.cantidad_prestada::text AS cantidad_prestada,
            s.precio_capturado::text AS precio_capturado,
            s.fecha_hora_prevista::text AS fecha_hora_prevista,
            s.estado, s.motivo_cancelacion,
            hb.numero AS numero_habitacion, (hu.nombres || ' ' || hu.apellidos) AS huesped_nombre
     FROM g3_servicios.solicitud_servicio s
     JOIN g3_servicios.item_catalogo ic ON ic.id_item_catalogo = s.id_item_catalogo
     LEFT JOIN g3_servicios.estadia_externa ee ON ee.id_estadia_externa = s.id_estadia_externa
     LEFT JOIN g1_reservas.habitacion hb ON hb.id_habitacion::text = ee.id_habitacion_externa
     LEFT JOIN g1_reservas.huesped hu ON hu.id_huesped::text = ee.id_huesped_externo
     ${clause}
     ORDER BY (s.estado = 'solicitada') DESC, s.fecha_hora_prevista ASC NULLS LAST, s.numero_solicitud DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`, values
  );
  return { rows: rows.rows, total: Number(count.rows[0]?.total ?? 0) };
}

export async function listInventario(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  if (params.search) {
    values.push(`%${params.search}%`);
    where.push(`aa.nombre ILIKE $${values.length}`);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM g3_servicios.articulo_almacen aa ${whereClause}`,
    values
  );
  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  const res = await client.query(
    `SELECT
       aa.id_articulo,
       aa.nombre,
       c.nombre AS categoria,
       um.simbolo AS unidad,
       aa.vende_tal_cual,
       aa.es_insumo,
       aa.vence,
       aa.dias_aviso_vencimiento,
       aa.stock_minimo::text AS stock_minimo,
       aa.estado,
       aa.id_categoria,
       aa.id_unidad_medida,
       (SELECT l.costo_unitario FROM g3_servicios.lote_articulo l
         WHERE l.id_articulo = aa.id_articulo ORDER BY l.fecha_creacion DESC LIMIT 1)::text AS costo_unitario,
       (SELECT MIN(l.fecha_vencimiento) FROM g3_servicios.lote_articulo l
         WHERE l.id_articulo = aa.id_articulo AND l.cantidad_disponible > 0)::text AS proximo_vencimiento,
       COALESCE(
         (SELECT SUM(la.cantidad_disponible) FROM g3_servicios.lote_articulo la WHERE la.id_articulo = aa.id_articulo),
         0
       )::text AS stock_actual
     FROM g3_servicios.articulo_almacen aa
     JOIN g3_servicios.categoria c ON c.id_categoria = aa.id_categoria
     JOIN g3_servicios.unidad_medida um ON um.id_unidad_medida = aa.id_unidad_medida
     ${whereClause}
     ORDER BY aa.nombre ASC, aa.id_articulo ASC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { rows: res.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function listKardex(client: PoolClient, idArticulo: string | null, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  if (idArticulo) {
    values.push(idArticulo);
    where.push(`mi.id_articulo = $${values.length}`);
  }
  pushDateRange(values, where, 'mi.fecha_hora', params.fromDate, params.toDate);
  pushSearchFilter(values, where, ['mi.tipo_movimiento', 'mi.motivo', 'mi.id_origen', 'mi.modulo_origen'], params.search);
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM g3_servicios.movimiento_inventario mi ${whereClause}`,
    values
  );
  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);
  const dataRes = await client.query(
    `SELECT mi.id_movimiento, mi.id_articulo, aa.nombre AS articulo,
            mi.id_lote, mi.tipo_movimiento, mi.cantidad::text AS cantidad,
            mi.signo, mi.fecha_hora::text AS fecha_hora,
            mi.saldo_posterior::text AS saldo_posterior, mi.motivo,
            mi.id_origen, mi.modulo_origen, mi.costo_unitario::text AS costo_unitario,
            mi.estado_anulacion
     FROM g3_servicios.movimiento_inventario mi
     JOIN g3_servicios.articulo_almacen aa ON aa.id_articulo = mi.id_articulo
     ${whereClause}
     ORDER BY mi.fecha_hora DESC, mi.id_movimiento DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return { rows: dataRes.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function listLotes(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  pushDateRange(values, where, 'la.fecha_vencimiento', params.fromDate, params.toDate);
  pushSearchFilter(values, where, ['la.id_lote', 'aa.id_articulo', 'aa.nombre'], params.search);
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM g3_servicios.lote_articulo la
     JOIN g3_servicios.articulo_almacen aa ON aa.id_articulo = la.id_articulo
     ${whereClause}`,
    values
  );
  values.push(params.pageSize, (params.page - 1) * params.pageSize);
  const dataRes = await client.query(
    `SELECT la.id_lote, la.id_articulo, aa.nombre AS articulo,
            la.id_almacen, al.nombre AS almacen,
            um.simbolo AS unidad, la.fecha_vencimiento::text AS fecha_vencimiento,
            la.cantidad_disponible::text AS cantidad_disponible,
            la.costo_unitario::text AS costo_unitario,
            la.fecha_creacion::text AS fecha_creacion,
            CASE
              WHEN la.cantidad_disponible <= 0 THEN 'agotado'
              WHEN la.fecha_vencimiento IS NOT NULL AND la.fecha_vencimiento < CURRENT_DATE THEN 'vencido'
              WHEN la.fecha_vencimiento IS NOT NULL AND la.fecha_vencimiento <= CURRENT_DATE + aa.dias_aviso_vencimiento THEN 'próximo a vencer'
              ELSE 'vigente'
            END AS estado
     FROM g3_servicios.lote_articulo la
     JOIN g3_servicios.articulo_almacen aa ON aa.id_articulo = la.id_articulo
     JOIN g3_servicios.unidad_medida um ON um.id_unidad_medida = aa.id_unidad_medida
     JOIN g3_servicios.almacen al ON al.id_almacen = la.id_almacen
     ${whereClause}
     ORDER BY la.fecha_vencimiento ASC NULLS LAST, la.fecha_creacion DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return { rows: dataRes.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function listEnviosExternos(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  pushStatusFilter(values, where, 'ee.estado', params.status);
  pushDateRange(values, where, 'ee.fecha_hora_intento', params.fromDate, params.toDate);
  pushSearchFilter(values, where, ['ee.destino', 'ee.tipo_envio', 'ee.id_referencia', 'ee.motivo_rechazo'], params.search);
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM g3_servicios.envio_externo ee ${whereClause}`,
    values
  );
  values.push(params.pageSize, (params.page - 1) * params.pageSize);
  const rows = await client.query(
    `SELECT ee.id_envio, ee.destino, ee.tipo_envio, ee.id_referencia,
            ee.estado, ee.numero_intento, ee.fecha_hora_intento::text AS fecha_hora_intento,
            ee.motivo_rechazo
     FROM g3_servicios.envio_externo ee
     ${whereClause}
     ORDER BY ee.fecha_hora_intento DESC, ee.id_envio DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return { rows: rows.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function listOrdenesCompra(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  pushStatusFilter(values, where, 'oc.estado', params.status);
  pushDateRange(values, where, 'oc.fecha_hora_preparacion', params.fromDate, params.toDate);
  pushSearchFilter(values, where, ['oc.numero_orden', 'p.razon_social'], params.search);
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM g3_servicios.orden_compra oc
     JOIN g3_servicios.proveedor p ON p.id_proveedor = oc.id_proveedor
     ${whereClause}`,
    values
  );
  const offset = (params.page - 1) * params.pageSize;
  values.push(params.pageSize, offset);

  const res = await client.query(
    `SELECT
       oc.numero_orden,
       oc.id_proveedor,
       p.razon_social AS proveedor_nombre,
       oc.fecha_hora_preparacion::text AS fecha_hora_preparacion,
       oc.fecha_entrega_esperada::text AS fecha_entrega_esperada,
       oc.total_estimado::text AS total_estimado,
       oc.estado,
       oc.decision_aprobacion,
       oc.motivo_decision,
       oc.medio_envio,
       oc.usuario_creacion,
       COALESCE(
         (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id_detalle_orden', d.id_detalle_orden,
               'id_articulo', d.id_articulo,
               'articulo', aa.nombre,
               'cantidad_solicitada', d.cantidad_solicitada::text,
               'cantidad_aceptada', COALESCE((
                 SELECT SUM(dr.cantidad_aceptada)
                 FROM g3_servicios.detalle_recepcion dr
                 JOIN g3_servicios.recepcion_compra rc ON rc.id_recepcion = dr.id_recepcion
                 WHERE dr.id_detalle_orden = d.id_detalle_orden AND rc.estado <> 'anulada'
               ), 0)::text,
               'precio_referencia', d.precio_referencia_capturado::text
             ) ORDER BY aa.nombre
           )
           FROM g3_servicios.detalle_orden_compra d
           JOIN g3_servicios.articulo_almacen aa ON aa.id_articulo = d.id_articulo
           WHERE d.numero_orden = oc.numero_orden
         ),
         '[]'::jsonb
       ) AS detalles,
       COALESCE(
         (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id_recepcion', rc.id_recepcion,
               'fecha_hora', rc.fecha_hora::text,
               'numero_guia_factura', rc.numero_guia_factura,
               'estado', rc.estado
             ) ORDER BY rc.fecha_hora DESC
           )
           FROM g3_servicios.recepcion_compra rc
           WHERE rc.numero_orden = oc.numero_orden
         ),
         '[]'::jsonb
       ) AS recepciones
     FROM g3_servicios.orden_compra oc
     JOIN g3_servicios.proveedor p ON p.id_proveedor = oc.id_proveedor
     ${whereClause}
     ORDER BY oc.fecha_hora_preparacion DESC, oc.numero_orden DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { rows: res.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}
