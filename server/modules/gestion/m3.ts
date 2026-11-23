import crypto from 'crypto';
import type { PoolClient } from 'pg';
import type { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/authorize.ts';
import { validateBody, validateParams } from '../../middleware/validate.ts';
import { withReadOnlyClient, withTransaction } from '../../shared/database/transaction.ts';
import { DomainRuleError, NotFoundError } from '../../shared/errors/app-error.ts';
import { dateOnlySchema, moneyStringSchema, motivoSchema, varcharIdSchema } from '../../shared/validation/common.ts';
import { PERMISSIONS } from '../seguridad/permissions.ts';
import { handle } from './helpers.ts';
import { aplicarMovimientoStock } from './stock.ts';

const idParam = z.object({ id: varcharIdSchema });

const createPuntoVentaSchema = z.object({
  nombre: z.string().trim().min(3).max(120),
  tipo: z.string().trim().min(3).max(40),
});
const updatePuntoVentaSchema = z.object({
  nombre: z.string().trim().min(3).max(120).optional(),
  tipo: z.string().trim().min(3).max(40).optional(),
  estado: z.enum(['activo', 'inactivo']).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Indica al menos un campo a modificar.' });

const createMesaSchema = z.object({
  id_punto_venta: varcharIdSchema,
  nombre: z.string().trim().min(1).max(120),
});

const createCategoriaSchema = z.object({
  nombre: z.string().trim().min(2).max(120),
  uso: z.string().trim().min(2).max(40),
});
const updateCategoriaSchema = z.object({
  nombre: z.string().trim().min(2).max(120).optional(),
  uso: z.string().trim().min(2).max(40).optional(),
  estado: z.enum(['activo', 'inactivo']).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Indica al menos un campo a modificar.' });

// ------------------------------------------------------------------------------------------
// Esquemas
// ------------------------------------------------------------------------------------------
export const createProveedorSchema = z
  .object({
    ruc: z.string().trim().regex(/^[0-9]{11}$/, 'El RUC debe tener exactamente 11 dígitos.'),
    razon_social: z.string().trim().min(3).max(120),
    telefono: z.string().trim().max(20).optional().nullable(),
    correo: z.string().trim().email('Correo inválido').max(120).optional().nullable(),
  })
  .refine((d) => Boolean(d.telefono) || Boolean(d.correo), {
    message: 'Indica al menos un medio de contacto (teléfono o correo).',
    path: ['telefono'],
  });

export const updateProveedorSchema = z.object({
  ruc: z.string().trim().regex(/^[0-9]{11}$/, 'El RUC debe tener exactamente 11 dígitos.').optional(),
  razon_social: z.string().trim().min(3).max(120).optional(),
  telefono: z.string().trim().max(20).optional().nullable(),
  correo: z.string().trim().email('Correo inválido').max(120).optional().nullable(),
  estado: z.enum(['activo', 'inactivo']).optional(),
  motivo_desactivacion: z.string().trim().min(3).max(500).optional().nullable(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Indica al menos un campo a modificar.' })
  .refine((v) => v.estado !== 'inactivo' || Boolean(v.motivo_desactivacion), {
    message: 'Desactivar un proveedor requiere motivo.', path: ['motivo_desactivacion'],
  });

export const createArticuloSchema = z
  .object({
    nombre: z.string().trim().min(3).max(120),
    id_categoria: varcharIdSchema,
    id_unidad_medida: varcharIdSchema,
    vende_tal_cual: z.boolean().default(false),
    es_insumo: z.boolean().default(true),
    vence: z.boolean().default(false),
    dias_aviso_vencimiento: z.number().int().min(0).max(365).default(0),
    stock_minimo: z.coerce.number().min(0),
    stock_inicial: z.coerce.number().min(0).default(0),
    costo_unitario: moneyStringSchema.optional().nullable(),
    fecha_vencimiento: dateOnlySchema.optional().nullable(),
  })
  .refine((d) => !(d.stock_inicial > 0 && d.vence) || Boolean(d.fecha_vencimiento), {
    message: 'Un artículo que vence necesita la fecha de vencimiento del stock inicial.',
    path: ['fecha_vencimiento'],
  });

export const updateArticuloSchema = z.object({
  nombre: z.string().trim().min(3).max(120).optional(),
  id_categoria: varcharIdSchema.optional(),
  id_unidad_medida: varcharIdSchema.optional(),
  vende_tal_cual: z.boolean().optional(),
  es_insumo: z.boolean().optional(),
  vence: z.boolean().optional(),
  dias_aviso_vencimiento: z.number().int().min(0).max(365).optional(),
  stock_minimo: z.coerce.number().min(0).optional(),
  estado: z.enum(['activo', 'inactivo']).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Indica al menos un campo a modificar.' });

export const createItemCatalogoSchema = z
  .object({
    id_punto_venta: varcharIdSchema,
    id_categoria: varcharIdSchema,
    nombre: z.string().trim().min(3).max(120),
    tipo_item: z.enum(['plato', 'bebida', 'producto', 'servicio']),
    precio_vigente: moneyStringSchema,
    id_articulo_descuento: varcharIdSchema.optional().nullable(),
    duracion_estimada: z.number().int().positive().max(1440).optional().nullable(),
    cupo_por_atencion: z.number().int().positive().max(1000).optional().nullable(),
  });

export const updateItemCatalogoSchema = z
  .object({
    nombre: z.string().trim().min(3).max(120).optional(),
    id_categoria: varcharIdSchema.optional(),
    id_articulo_descuento: varcharIdSchema.optional().nullable(),
    duracion_estimada: z.number().int().positive().max(1440).optional().nullable(),
    estado: z.enum(['activo', 'inactivo']).optional(),
    motivo_desactivacion: z.string().trim().min(5).max(500).optional().nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Indica al menos un campo a modificar.' })
  .refine((d) => d.estado !== 'inactivo' || Boolean(d.motivo_desactivacion), {
    message: 'Desactivar un ítem requiere un motivo.',
    path: ['motivo_desactivacion'],
  });

export const createRecetaSchema = z
  .object({
    id_item_catalogo: varcharIdSchema,
    ingredientes: z
      .array(z.object({ id_articulo: varcharIdSchema, cantidad_por_porcion: z.coerce.number().positive().max(100000) }))
      .min(1, 'La receta necesita al menos un ingrediente.')
      .max(40),
  })
  .refine((d) => new Set(d.ingredientes.map((i) => i.id_articulo)).size === d.ingredientes.length, {
    message: 'Un artículo no puede repetirse en la receta.',
    path: ['ingredientes'],
  });

const updateRecetaEstadoSchema = z.object({ estado: z.enum(['vigente', 'inactiva']) });

export const atenderRequisicionSchema = z.object({ cantidad: z.coerce.number().positive().optional() });
export const rechazarRequisicionSchema = z.object({ motivo: motivoSchema });

// ------------------------------------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------------------------------------
/** Mnemotécnico de 3 letras (sin tildes) a partir del nombre: "Filete de lenguado" -> "FIL". */
function mnemonic(nombre: string): string {
  const letters = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
  return (letters + 'XXX').slice(0, 3);
}

/** Genera un id libre con el patrón existente (ART-LOM, IT-ARP…): prefijo + mnemotécnico, con sufijo numérico si ya existe. */
async function nextCode(client: PoolClient, table: string, column: string, prefix: string, nombre: string): Promise<string> {
  const siteResult = await client.query<{ id: string }>(
    `SELECT COALESCE(NULLIF(current_setting('app.sede_id', true), ''), 'SEDE-PRINCIPAL') AS id`
  );
  const siteId = siteResult.rows[0]?.id ?? 'SEDE-PRINCIPAL';
  const siteToken = siteId === 'SEDE-PRINCIPAL'
    ? ''
    : siteId.replace(/^SEDE-/, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
  const base = `${prefix}-${siteToken ? `${siteToken}-` : ''}${mnemonic(nombre)}`;
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? base : `${base}${i}`;
    const exists = await client.query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [candidate]);
    if (!exists.rows[0]) return candidate;
  }
  throw new DomainRuleError('No se pudo generar un código libre para el registro.');
}

/**
 * Crea una requisición de reposición (g3_servicios.solicitud_reposicion). El código sigue el patrón existente
 * SRP-AAAA-MM-DD-<artículo>, con sufijo si ya hay otra del mismo artículo ese día. Lo usa también Housekeeping.
 */
export async function crearRequisicion(client: PoolClient, idArticulo: string, cantidad: number): Promise<Record<string, unknown>> {
  const art = await client.query(`SELECT 1 FROM g3_servicios.articulo_almacen WHERE id_articulo = $1`, [idArticulo]);
  if (!art.rows[0]) throw new DomainRuleError('El artículo solicitado no existe en almacén.');
  const base = (await client.query<{ d: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)).rows[0].d;
  let id = `SRP-${base}-${idArticulo}`;
  for (let i = 2; i < 50; i++) {
    const exists = await client.query(`SELECT 1 FROM g3_servicios.solicitud_reposicion WHERE id_solicitud_externa = $1`, [id]);
    if (!exists.rows[0]) break;
    id = `SRP-${base}-${idArticulo}-${i}`;
  }
  if (id.length > 36) throw new DomainRuleError('El código del artículo es demasiado largo para generar la requisición.');
  const res = await client.query(
    `INSERT INTO g3_servicios.solicitud_reposicion (id_solicitud_externa, id_articulo, cantidad_solicitada, estado, fecha_hora_recepcion)
     VALUES ($1, $2, $3::numeric(14,3), 'pendiente', CURRENT_TIMESTAMP)
     RETURNING id_solicitud_externa AS id, id_articulo, cantidad_solicitada::text, estado, fecha_hora_recepcion::text`,
    [id, idArticulo, cantidad]
  );
  return res.rows[0];
}

// ------------------------------------------------------------------------------------------
// Rutas
// ------------------------------------------------------------------------------------------
export const updateMesaSchema = z
  .object({
    nombre: z.string().trim().min(1).max(120).optional(),
    estado: z.enum(['activa', 'inactiva']).optional(),
    motivo_desactivacion: z.string().trim().min(3).max(500).optional().nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Indica al menos un campo a modificar.' })
  .refine((d) => d.estado === 'activa' || Boolean(d.motivo_desactivacion), {
    message: 'Indica el motivo para desactivar la mesa.',
    path: ['motivo_desactivacion'],
  });

export function registerM3Gestion(router: Router): void {
  // ---- Puntos de venta y categorías configurables
  router.post(
    '/puntos-venta',
    requirePermission(PERMISSIONS.M3_CATALOGO_ADMINISTRAR),
    validateBody(createPuntoVentaSchema),
    handle((req) => withTransaction(req.authContext!, async (client) => {
      const b = req.body as z.infer<typeof createPuntoVentaSchema>;
      const id = await nextCode(client, 'g3_servicios.punto_venta', 'id_punto_venta', 'PV', b.nombre);
      const result = await client.query(
        `INSERT INTO g3_servicios.punto_venta (id_punto_venta, nombre, tipo, estado)
         VALUES ($1, $2, $3, 'activo')
         RETURNING id_punto_venta, nombre, tipo, estado`, [id, b.nombre, b.tipo]
      );
      return result.rows[0];
    }), 201)
  );
  router.put(
    '/puntos-venta/:id',
    requirePermission(PERMISSIONS.M3_CATALOGO_ADMINISTRAR),
    validateParams(idParam),
    validateBody(updatePuntoVentaSchema),
    handle((req) => withTransaction(req.authContext!, async (client) => {
      const b = req.body as z.infer<typeof updatePuntoVentaSchema>;
      const result = await client.query(
        `UPDATE g3_servicios.punto_venta
         SET nombre = COALESCE($2, nombre), tipo = COALESCE($3, tipo), estado = COALESCE($4, estado)
         WHERE id_punto_venta = $1
         RETURNING id_punto_venta, nombre, tipo, estado`,
        [req.params.id, b.nombre ?? null, b.tipo ?? null, b.estado ?? null]
      );
      if (!result.rows[0]) throw new NotFoundError('Punto de venta no encontrado.');
      return result.rows[0];
    }))
  );
  router.post(
    '/categorias',
    requirePermission(PERMISSIONS.M3_CATALOGO_ADMINISTRAR),
    validateBody(createCategoriaSchema),
    handle((req) => withTransaction(req.authContext!, async (client) => {
      const b = req.body as z.infer<typeof createCategoriaSchema>;
      const id = await nextCode(client, 'g3_servicios.categoria', 'id_categoria', 'CAT', b.nombre);
      const result = await client.query(
        `INSERT INTO g3_servicios.categoria (id_categoria, nombre, uso, estado)
         VALUES ($1, $2, $3, 'activo') RETURNING id_categoria, nombre, uso, estado`,
        [id, b.nombre, b.uso]
      );
      return result.rows[0];
    }), 201)
  );
  router.put(
    '/categorias/:id',
    requirePermission(PERMISSIONS.M3_CATALOGO_ADMINISTRAR),
    validateParams(idParam),
    validateBody(updateCategoriaSchema),
    handle((req) => withTransaction(req.authContext!, async (client) => {
      const b = req.body as z.infer<typeof updateCategoriaSchema>;
      const result = await client.query(
        `UPDATE g3_servicios.categoria
         SET nombre = COALESCE($2, nombre), uso = COALESCE($3, uso), estado = COALESCE($4, estado)
         WHERE id_categoria = $1 RETURNING id_categoria, nombre, uso, estado`,
        [req.params.id, b.nombre ?? null, b.uso ?? null, b.estado ?? null]
      );
      if (!result.rows[0]) throw new NotFoundError('Categoría no encontrada.');
      return result.rows[0];
    }))
  );

  // ---- Mesas: activar / desactivar
  router.post(
    '/mesas',
    requirePermission(PERMISSIONS.M3_CATALOGO_ADMINISTRAR),
    validateBody(createMesaSchema),
    handle((req) => withTransaction(req.authContext!, async (client) => {
      const b = req.body as z.infer<typeof createMesaSchema>;
      const pv = await client.query<{ tipo: string; estado: string }>(
        `SELECT tipo, estado FROM g3_servicios.punto_venta WHERE id_punto_venta = $1`, [b.id_punto_venta]
      );
      if (!pv.rows[0] || pv.rows[0].estado !== 'activo') throw new DomainRuleError('Punto de venta inexistente o inactivo.');
      const id = await nextCode(client, 'g3_servicios.mesa', 'id_mesa', 'M', b.nombre);
      const result = await client.query(
        `INSERT INTO g3_servicios.mesa (id_mesa, id_punto_venta, nombre, estado)
         VALUES ($1, $2, $3, 'activa') RETURNING id_mesa, id_punto_venta, nombre, estado`,
        [id, b.id_punto_venta, b.nombre]
      );
      return result.rows[0];
    }), 201)
  );
  router.put(
    '/mesas/:id',
    requirePermission(PERMISSIONS.M3_CATALOGO_ADMINISTRAR),
    validateParams(idParam),
    validateBody(updateMesaSchema),
    handle((req) =>
      withTransaction(req.authContext!, async (client) => {
        const b = req.body as z.infer<typeof updateMesaSchema>;
        const mesa = await client.query(`SELECT id_mesa FROM g3_servicios.mesa WHERE id_mesa = $1 FOR UPDATE`, [req.params.id]);
        if (!mesa.rows[0]) throw new NotFoundError('Mesa no encontrada.');
        if (b.estado === 'inactiva') {
          const abierta = await client.query(
            `SELECT 1 FROM g3_servicios.comanda
             WHERE id_mesa = $1 AND estado NOT IN ('entregada', 'cancelada') LIMIT 1`,
            [req.params.id]
          );
          if (abierta.rows[0]) throw new DomainRuleError('La mesa tiene una comanda abierta; ciérrala o cancélala antes de desactivar la mesa.');
        }
        const res = await client.query(
          `UPDATE g3_servicios.mesa SET nombre = COALESCE($2, nombre), estado = COALESCE($3::varchar, estado),
                  motivo_desactivacion = CASE WHEN COALESCE($3::varchar, estado) = 'activa' THEN NULL ELSE COALESCE($4::varchar, motivo_desactivacion) END
           WHERE id_mesa = $1
           RETURNING id_mesa, nombre, estado, motivo_desactivacion`,
          [req.params.id, b.nombre ?? null, b.estado ?? null, b.motivo_desactivacion ?? null]
        );
        return res.rows[0];
      })
    )
  );

  // ---- Proveedores
  router.get(
    '/proveedores',
    requirePermission(PERMISSIONS.M3_PROVEEDOR_CONSULTAR),
    handle((req) =>
      withReadOnlyClient(async (client) => {
        const res = await client.query(
          `SELECT
             p.id_proveedor, p.ruc, p.razon_social, p.telefono, p.correo, p.estado,
             (SELECT ROUND(AVG(pa.plazo_entrega_dias))::int
                FROM g3_servicios.proveedor_articulo pa WHERE pa.id_proveedor = p.id_proveedor) AS plazo_entrega_dias
           FROM g3_servicios.proveedor p
           ORDER BY p.razon_social ASC`
        );
        return res.rows;
      }, req.authContext!)
    )
  );

  router.post(
    '/proveedores',
    requirePermission(PERMISSIONS.M3_PROVEEDOR_ADMINISTRAR),
    validateBody(createProveedorSchema),
    handle(
      (req) =>
        withTransaction(req.authContext!, async (client) => {
          const b = req.body as z.infer<typeof createProveedorSchema>;
          await client.query(`SELECT pg_advisory_xact_lock(hashtext('g3_servicios.proveedor.codigo'))`);
          const id = await nextCode(client, 'g3_servicios.proveedor', 'id_proveedor', 'PRV', b.razon_social);
          const res = await client.query(
            `INSERT INTO g3_servicios.proveedor (id_proveedor, ruc, razon_social, telefono, correo, estado)
             VALUES ($1, $2, $3, $4, $5, 'activo')
             RETURNING id_proveedor, ruc, razon_social, telefono, correo, estado`,
            [id, b.ruc, b.razon_social, b.telefono ?? null, b.correo ?? null]
          );
          return res.rows[0];
        }),
      201
    )
  );

  router.put(
    '/proveedores/:id',
    requirePermission(PERMISSIONS.M3_PROVEEDOR_ADMINISTRAR),
    validateParams(idParam),
    validateBody(updateProveedorSchema),
    handle((req) => withTransaction(req.authContext!, async (client) => {
      const b = req.body as z.infer<typeof updateProveedorSchema>;
      const result = await client.query(
        `UPDATE g3_servicios.proveedor SET
           ruc = COALESCE($2, ruc), razon_social = COALESCE($3, razon_social),
           telefono = CASE WHEN $4::boolean THEN $5 ELSE telefono END,
           correo = CASE WHEN $6::boolean THEN $7 ELSE correo END,
           estado = COALESCE($8, estado),
           motivo_desactivacion = CASE WHEN COALESCE($8, estado) = 'activo' THEN NULL ELSE COALESCE($9, motivo_desactivacion) END
         WHERE id_proveedor = $1
         RETURNING id_proveedor, ruc, razon_social, telefono, correo, estado, motivo_desactivacion`,
        [req.params.id, b.ruc ?? null, b.razon_social ?? null,
         Object.hasOwn(b, 'telefono'), b.telefono ?? null,
         Object.hasOwn(b, 'correo'), b.correo ?? null,
         b.estado ?? null, b.motivo_desactivacion ?? null]
      );
      if (!result.rows[0]) throw new NotFoundError('Proveedor no encontrado.');
      return result.rows[0];
    }))
  );

  // ---- Artículos de almacén (con stock inicial opcional, que genera su lote y su movimiento)
  router.post(
    '/articulos',
    requirePermission(PERMISSIONS.M3_INVENTARIO_AJUSTAR),
    validateBody(createArticuloSchema),
    handle(
      (req) =>
        withTransaction(req.authContext!, async (client) => {
          const b = req.body as z.infer<typeof createArticuloSchema>;
          await client.query(`SELECT pg_advisory_xact_lock(hashtext('g3_servicios.articulo.codigo'))`);
          const id = await nextCode(client, 'g3_servicios.articulo_almacen', 'id_articulo', 'ART', b.nombre);
          await client.query(
            `INSERT INTO g3_servicios.articulo_almacen
               (id_articulo, id_categoria, id_unidad_medida, nombre, vende_tal_cual, es_insumo, vence, dias_aviso_vencimiento, stock_minimo, estado)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric(14,3), 'activo')`,
            [id, b.id_categoria, b.id_unidad_medida, b.nombre, b.vende_tal_cual, b.es_insumo, b.vence, b.dias_aviso_vencimiento, b.stock_minimo]
          );
          let stock = { saldo_posterior: '0.000' };
          if (b.stock_inicial > 0) {
            stock = await aplicarMovimientoStock(client, {
              id_articulo: id,
              tipo_movimiento: 'Stock inicial',
              signo: 'entrada',
              cantidad: b.stock_inicial,
              motivo: 'Stock inicial al registrar el artículo',
              id_origen: 'ALTA',
              modulo_origen: 'Almacén',
              costo_unitario: b.costo_unitario ?? '0',
              fecha_vencimiento: b.vence ? b.fecha_vencimiento : null,
            });
          }
          return { id_articulo: id, nombre: b.nombre, stock_actual: stock.saldo_posterior };
        }),
      201
    )
  );

  router.put(
    '/articulos/:id',
    requirePermission(PERMISSIONS.M3_INVENTARIO_AJUSTAR),
    validateParams(idParam),
    validateBody(updateArticuloSchema),
    handle((req) => withTransaction(req.authContext!, async (client) => {
      const b = req.body as z.infer<typeof updateArticuloSchema>;
      const result = await client.query(
        `UPDATE g3_servicios.articulo_almacen SET
           nombre = COALESCE($2, nombre), id_categoria = COALESCE($3, id_categoria),
           id_unidad_medida = COALESCE($4, id_unidad_medida),
           vende_tal_cual = COALESCE($5, vende_tal_cual), es_insumo = COALESCE($6, es_insumo),
           vence = COALESCE($7, vence), dias_aviso_vencimiento = COALESCE($8, dias_aviso_vencimiento),
           stock_minimo = COALESCE($9::numeric, stock_minimo), estado = COALESCE($10, estado)
         WHERE id_articulo = $1
         RETURNING id_articulo, nombre, estado, stock_minimo::text AS stock_minimo`,
        [req.params.id, b.nombre ?? null, b.id_categoria ?? null, b.id_unidad_medida ?? null,
         b.vende_tal_cual ?? null, b.es_insumo ?? null, b.vence ?? null,
         b.dias_aviso_vencimiento ?? null, b.stock_minimo ?? null, b.estado ?? null]
      );
      if (!result.rows[0]) throw new NotFoundError('Artículo no encontrado.');
      return result.rows[0];
    }))
  );

  // ---- Ítems de la carta / servicios (el precio se cambia con POST /catalogo/:id/precio, que deja historial)
  router.post(
    '/catalogo',
    requirePermission(PERMISSIONS.M3_CATALOGO_ADMINISTRAR),
    validateBody(createItemCatalogoSchema),
    handle(
      (req) =>
        withTransaction(req.authContext!, async (client) => {
          const b = req.body as z.infer<typeof createItemCatalogoSchema>;
          await client.query(`SELECT pg_advisory_xact_lock(hashtext('g3_servicios.item_catalogo.codigo'))`);
          const id = await nextCode(client, 'g3_servicios.item_catalogo', 'id_item_catalogo', 'IT', b.nombre);
          const res = await client.query(
            `INSERT INTO g3_servicios.item_catalogo
               (id_item_catalogo, id_punto_venta, id_categoria, nombre, tipo_item, precio_vigente, condicion_cobro,
                id_articulo_descuento, duracion_estimada, cupo_por_atencion, estado)
             VALUES ($1, $2, $3, $4, $5, $6::numeric(12,2), $7, $8, $9, $10, 'activo')
             RETURNING id_item_catalogo, nombre, tipo_item, precio_vigente::text AS precio_vigente, estado`,
            [
              id, b.id_punto_venta, b.id_categoria, b.nombre, b.tipo_item, b.precio_vigente,
              b.tipo_item === 'servicio' ? 'por servicio' : 'por pedido',
              b.id_articulo_descuento ?? null, b.duracion_estimada ?? null, b.cupo_por_atencion ?? null,
            ]
          );
          return res.rows[0];
        }),
      201
    )
  );

  router.put(
    '/catalogo/:id',
    requirePermission(PERMISSIONS.M3_CATALOGO_ADMINISTRAR),
    validateParams(idParam),
    validateBody(updateItemCatalogoSchema),
    handle((req) =>
      withTransaction(req.authContext!, async (client) => {
        const b = req.body as z.infer<typeof updateItemCatalogoSchema>;
        const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
        const res = await client.query(
          `UPDATE g3_servicios.item_catalogo SET
             nombre = COALESCE($2, nombre),
             id_categoria = COALESCE($3, id_categoria),
             id_articulo_descuento = CASE WHEN $4::boolean THEN $5 ELSE id_articulo_descuento END,
             duracion_estimada = CASE WHEN $6::boolean THEN $7::int ELSE duracion_estimada END,
             estado = COALESCE($8, estado),
             motivo_desactivacion = CASE WHEN COALESCE($8, estado) = 'activo' THEN NULL
                                         ELSE COALESCE($9, motivo_desactivacion) END
           WHERE id_item_catalogo = $1
           RETURNING id_item_catalogo, nombre, tipo_item, precio_vigente::text AS precio_vigente, estado`,
          [
            req.params.id, b.nombre ?? null, b.id_categoria ?? null,
            has('id_articulo_descuento'), b.id_articulo_descuento ?? null,
            has('duracion_estimada'), b.duracion_estimada ?? null,
            b.estado ?? null, b.motivo_desactivacion ?? null,
          ]
        );
        if (!res.rows[0]) throw new NotFoundError('Ítem de catálogo no encontrado.');
        return res.rows[0];
      })
    )
  );

  // ---- Recetas (una vigente por ítem; guardar una nueva reemplaza a la anterior y conserva el historial)
  router.get(
    '/recetas',
    requirePermission(PERMISSIONS.M3_RECETA_CONSULTAR),
    handle((req) =>
      withReadOnlyClient(async (client) => {
        const res = await client.query(
          `SELECT
             r.id_receta, r.id_item_catalogo, ic.nombre AS item_nombre, ic.precio_vigente::text AS precio_vigente,
             r.numero_version, r.vigente_desde::text AS vigente_desde, r.estado,
             COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                        'id_articulo', d.id_articulo,
                        'articulo', aa.nombre,
                        'unidad', um.simbolo,
                        'cantidad_por_porcion', d.cantidad_por_porcion::text,
                        'costo_unitario', COALESCE((
                          SELECT l.costo_unitario FROM g3_servicios.lote_articulo l
                          WHERE l.id_articulo = d.id_articulo ORDER BY l.fecha_creacion DESC LIMIT 1), 0)::text
                      ) ORDER BY aa.nombre)
               FROM g3_servicios.detalle_receta d
               JOIN g3_servicios.articulo_almacen aa ON aa.id_articulo = d.id_articulo
               JOIN g3_servicios.unidad_medida um ON um.id_unidad_medida = aa.id_unidad_medida
               WHERE d.id_receta = r.id_receta), '[]'::jsonb) AS ingredientes
           FROM g3_servicios.receta r
           JOIN g3_servicios.item_catalogo ic ON ic.id_item_catalogo = r.id_item_catalogo
           WHERE r.estado = 'vigente'
           ORDER BY ic.nombre`
        );
        return res.rows;
      }, req.authContext!)
    )
  );

  router.post(
    '/recetas',
    requirePermission(PERMISSIONS.M3_RECETA_ADMINISTRAR),
    validateBody(createRecetaSchema),
    handle(
      (req) =>
        withTransaction(req.authContext!, async (client) => {
          const b = req.body as z.infer<typeof createRecetaSchema>;
          const item = await client.query(`SELECT 1 FROM g3_servicios.item_catalogo WHERE id_item_catalogo = $1 FOR UPDATE`, [b.id_item_catalogo]);
          if (!item.rows[0]) throw new NotFoundError('El ítem de catálogo no existe.');
          const ver = await client.query<{ n: number }>(
            `SELECT COALESCE(MAX(numero_version), 0) AS n FROM g3_servicios.receta WHERE id_item_catalogo = $1`,
            [b.id_item_catalogo]
          );
          const version = ver.rows[0].n + 1;
          // Primero se retira la vigente (índice único: solo una vigente por ítem).
          await client.query(
            `UPDATE g3_servicios.receta SET estado = 'reemplazada', vigente_hasta = CURRENT_DATE
             WHERE id_item_catalogo = $1 AND estado = 'vigente'`,
            [b.id_item_catalogo]
          );
          const id = `RC-${b.id_item_catalogo}-V${version}`;
          await client.query(
            `INSERT INTO g3_servicios.receta (id_receta, id_item_catalogo, numero_version, vigente_desde, estado)
             VALUES ($1, $2, $3, CURRENT_DATE, 'vigente')`,
            [id, b.id_item_catalogo, version]
          );
          for (const ing of b.ingredientes) {
            await client.query(
              `INSERT INTO g3_servicios.detalle_receta (id_detalle_receta, id_receta, id_articulo, cantidad_por_porcion)
               VALUES ($1, $2, $3, $4::numeric(14,3))`,
              [crypto.randomUUID(), id, ing.id_articulo, ing.cantidad_por_porcion]
            );
          }
          return { id_receta: id, id_item_catalogo: b.id_item_catalogo, numero_version: version, ingredientes: b.ingredientes.length };
        }),
      201
    )
  );

  router.put(
    '/recetas/:id/estado',
    requirePermission(PERMISSIONS.M3_RECETA_ADMINISTRAR),
    validateParams(idParam),
    validateBody(updateRecetaEstadoSchema),
    handle((req) => withTransaction(req.authContext!, async (client) => {
      const b = req.body as z.infer<typeof updateRecetaEstadoSchema>;
      if (b.estado === 'vigente') {
        const target = await client.query<{ id_item_catalogo: string }>(
          `SELECT id_item_catalogo FROM g3_servicios.receta WHERE id_receta = $1`, [req.params.id]
        );
        if (!target.rows[0]) throw new NotFoundError('Receta no encontrada.');
        await client.query(
          `UPDATE g3_servicios.receta SET estado = 'reemplazada', vigente_hasta = COALESCE(vigente_hasta, CURRENT_DATE)
           WHERE id_item_catalogo = $1 AND estado = 'vigente' AND id_receta <> $2`,
          [target.rows[0].id_item_catalogo, req.params.id]
        );
      }
      const result = await client.query(
        `UPDATE g3_servicios.receta
         SET estado = $2, vigente_hasta = CASE WHEN $2 = 'vigente' THEN NULL ELSE COALESCE(vigente_hasta, CURRENT_DATE) END
         WHERE id_receta = $1
         RETURNING id_receta, id_item_catalogo, numero_version, estado`,
        [req.params.id, b.estado]
      );
      if (!result.rows[0]) throw new NotFoundError('Receta no encontrada.');
      return result.rows[0];
    }))
  );

  // ---- Requisiciones de reposición (las crea Housekeeping desde /m2/requisiciones; Almacén las atiende)
  router.get(
    '/requisiciones',
    requirePermission(PERMISSIONS.M3_INVENTARIO_CONSULTAR),
    handle((req) =>
      withReadOnlyClient(async (client) => {
        const res = await client.query(
          `SELECT
             sr.id_solicitud_externa AS id, sr.id_articulo, aa.nombre AS articulo, um.simbolo AS unidad,
             sr.cantidad_solicitada::text AS cantidad_solicitada, sr.cantidad_atendida::text AS cantidad_atendida,
             sr.estado, sr.motivo_no_atencion,
             sr.fecha_hora_recepcion::text AS fecha_hora_recepcion, sr.fecha_hora_atencion::text AS fecha_hora_atencion,
             COALESCE((SELECT SUM(l.cantidad_disponible) FROM g3_servicios.lote_articulo l WHERE l.id_articulo = sr.id_articulo), 0)::text AS stock_actual
           FROM g3_servicios.solicitud_reposicion sr
           JOIN g3_servicios.articulo_almacen aa ON aa.id_articulo = sr.id_articulo
           JOIN g3_servicios.unidad_medida um ON um.id_unidad_medida = aa.id_unidad_medida
           ORDER BY (sr.estado = 'pendiente') DESC, sr.fecha_hora_recepcion DESC
           LIMIT 300`
        );
        return res.rows;
      }, req.authContext!)
    )
  );

  router.post(
    '/requisiciones/:id/atender',
    requirePermission(PERMISSIONS.M3_INVENTARIO_MOVER),
    validateParams(idParam),
    validateBody(atenderRequisicionSchema),
    handle((req) =>
      withTransaction(req.authContext!, async (client) => {
        const b = req.body as z.infer<typeof atenderRequisicionSchema>;
        const cur = await client.query<{ id_articulo: string; cantidad_solicitada: string; estado: string }>(
          `SELECT id_articulo, cantidad_solicitada::text AS cantidad_solicitada, estado
           FROM g3_servicios.solicitud_reposicion WHERE id_solicitud_externa = $1 FOR UPDATE`,
          [req.params.id]
        );
        const r = cur.rows[0];
        if (!r) throw new NotFoundError('Requisición no encontrada.');
        if (r.estado !== 'pendiente') throw new DomainRuleError(`La requisición ya está "${r.estado}".`);
        const pedida = Number(r.cantidad_solicitada);
        const cantidad = b.cantidad ?? pedida;
        if (cantidad > pedida + 1e-9) throw new DomainRuleError(`No se puede despachar más de lo solicitado (${pedida}).`);

        // Sale del almacén por lotes (FIFO por vencimiento); falla si no hay stock suficiente.
        const mov = await aplicarMovimientoStock(client, {
          id_articulo: r.id_articulo,
          tipo_movimiento: 'Entrega interna',
          signo: 'salida',
          cantidad,
          motivo: `Despacho de requisición ${req.params.id}`,
          id_origen: String(req.params.id),
          modulo_origen: 'Almacén',
        });

        // Entra al stock local de Housekeeping, si el artículo es uno de sus insumos y hay personal identificado.
        const idPersonal = req.authContext!.idPersonalG2;
        if (idPersonal) {
          const insumo = await client.query<{ id_insumo: string }>(
            `SELECT id_insumo::text AS id_insumo FROM g2_housekeeping.insumo WHERE id_articulo = $1`,
            [r.id_articulo]
          );
          if (insumo.rows[0]) {
            await client.query(
              `INSERT INTO g2_housekeeping.movimiento_insumo (id_insumo, id_personal, tipo_movimiento, cantidad, signo, costo_unitario, motivo)
               VALUES ($1::bigint, $2::bigint, 'Entrada', $3, '+', 0, $4)`,
              [insumo.rows[0].id_insumo, idPersonal, cantidad, `Recibido de almacén: ${req.params.id}`]
            );
          }
        }

        const upd = await client.query(
          `UPDATE g3_servicios.solicitud_reposicion
           SET estado = $2::varchar, cantidad_atendida = $3::numeric(14,3), fecha_hora_atencion = CURRENT_TIMESTAMP
           WHERE id_solicitud_externa = $1
           RETURNING id_solicitud_externa AS id, estado, cantidad_atendida::text AS cantidad_atendida`,
          [req.params.id, cantidad + 1e-9 >= pedida ? 'atendida' : 'parcialmente atendida', cantidad]
        );
        return { ...upd.rows[0], saldo_almacen: mov.saldo_posterior };
      })
    )
  );

  router.post(
    '/requisiciones/:id/rechazar',
    requirePermission(PERMISSIONS.M3_INVENTARIO_MOVER),
    validateParams(idParam),
    validateBody(rechazarRequisicionSchema),
    handle((req) =>
      withTransaction(req.authContext!, async (client) => {
        const b = req.body as z.infer<typeof rechazarRequisicionSchema>;
        const res = await client.query(
          `UPDATE g3_servicios.solicitud_reposicion
           SET estado = 'no atendida', motivo_no_atencion = $2, fecha_hora_atencion = CURRENT_TIMESTAMP
           WHERE id_solicitud_externa = $1 AND estado = 'pendiente'
           RETURNING id_solicitud_externa AS id, estado, motivo_no_atencion`,
          [req.params.id, b.motivo]
        );
        if (!res.rows[0]) throw new DomainRuleError('La requisición no existe o ya fue atendida.');
        return res.rows[0];
      })
    )
  );
}
