import type { PoolClient } from 'pg';
import type { PaginationParams } from '../../shared/types/context.ts';

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
  return {
    puntos_venta: puntosRes.rows,
    mesas: mesasRes.rows,
    items: itemsRes.rows,
  };
}

export async function listComandas(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  if (params.status) {
    values.push(params.status);
    where.push(`c.estado = $${values.length}`);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM g3_servicios.comanda c ${whereClause}`,
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
     ${whereClause}
     ORDER BY c.fecha_hora_apertura DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { rows: dataRes.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function listConsumos(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  if (params.status) {
    values.push(params.status);
    where.push(`con.estado = $${values.length}`);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM g3_servicios.consumo con ${whereClause}`,
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
     ${whereClause}
     ORDER BY con.fecha_hora_registro DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { rows: dataRes.rows, total: Number(countRes.rows[0]?.total ?? 0) };
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
       COALESCE(
         (SELECT SUM(la.cantidad_disponible) FROM g3_servicios.lote_articulo la WHERE la.id_articulo = aa.id_articulo),
         0
       )::text AS stock_actual
     FROM g3_servicios.articulo_almacen aa
     JOIN g3_servicios.categoria c ON c.id_categoria = aa.id_categoria
     JOIN g3_servicios.unidad_medida um ON um.id_unidad_medida = aa.id_unidad_medida
     ${whereClause}
     ORDER BY aa.nombre ASC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { rows: res.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function listOrdenesCompra(client: PoolClient, params: PaginationParams) {
  const values: unknown[] = [];
  const where: string[] = [];
  if (params.status) {
    values.push(params.status);
    where.push(`oc.estado = $${values.length}`);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM g3_servicios.orden_compra oc ${whereClause}`,
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
       oc.usuario_creacion
     FROM g3_servicios.orden_compra oc
     JOIN g3_servicios.proveedor p ON p.id_proveedor = oc.id_proveedor
     ${whereClause}
     ORDER BY oc.fecha_hora_preparacion DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { rows: res.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}
