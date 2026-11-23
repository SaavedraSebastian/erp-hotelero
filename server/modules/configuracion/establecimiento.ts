import { Router } from 'express';
import { z } from 'zod';
import { isDatabaseConfigured } from '../../config/database.ts';
import { authenticateJwt } from '../../middleware/authenticate.ts';
import { withReadOnlyClient, withTransaction } from '../../shared/database/transaction.ts';
import { getOperationalDateLima } from '../../shared/dates/lima.ts';
import { ForbiddenError, NotFoundError } from '../../shared/errors/app-error.ts';
import type { AuthContext, EstablishmentConfig } from '../../shared/types/context.ts';

const DEFAULT_ESTABLISHMENT: Omit<EstablishmentConfig, 'fechaOperativa'> = {
  idSede: 'SEDE-PRINCIPAL', codigoSede: 'PRINCIPAL', nombreHotel: 'Hotel Boulevard - Sede Principal',
  nombreComercial: 'Hotel Boulevard', zonaHoraria: 'America/Lima', moneda: 'PEN',
  logoUrl: '/src/assets/images/hotel-hero.jpg', numeroHabitaciones: 42, numeroPisos: 6,
  direccion: 'Av. Principal 450, Lima, Perú',
};

const sedeBodySchema = z.object({
  codigo: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9_-]+$/),
  nombre: z.string().trim().min(3).max(120),
  nombreComercial: z.string().trim().min(3).max(120),
  direccion: z.string().trim().max(250).optional().nullable(),
  zonaHoraria: z.string().trim().min(3).max(60).default('America/Lima'),
  moneda: z.string().trim().length(3).default('PEN'),
  logoUrl: z.string().trim().max(500).optional().nullable(),
});

function ensureSiteAdmin(ctx: AuthContext): void {
  const admin = ctx.roles.some((role) =>
    ['ADMIN_SISTEMA', 'SUPER_ADMIN', 'ADMINISTRADOR', 'ADMIN'].includes(role.toUpperCase())
  ) || ctx.permisos.includes('seguridad.usuario.administrar');
  if (!admin) throw new ForbiddenError('Solo un administrador puede gestionar sedes.', 'SITE_ADMIN_REQUIRED');
}

function ensureSiteAccess(ctx: AuthContext, idSede: string): void {
  if (!ctx.sedes.some((sede) => sede.id === idSede)) {
    throw new ForbiddenError('No puedes administrar una sede a la que no tienes acceso.', 'ERP_SITE_ACCESS_DENIED');
  }
}

export async function getEstablishmentConfig(ctx?: AuthContext): Promise<EstablishmentConfig> {
  const fechaOperativa = getOperationalDateLima();
  if (!isDatabaseConfigured() || !ctx) return { ...DEFAULT_ESTABLISHMENT, fechaOperativa };
  try {
    const stats = await withReadOnlyClient(async (client) => {
      const multisede = await client.query<{ exists: boolean }>(
        `SELECT to_regclass('configuracion.sede') IS NOT NULL AS exists`
      );
      let customRow: Partial<EstablishmentConfig> = {};
      if (multisede.rows[0]?.exists) {
        const cfgRes = await client.query<{
          id_sede: string; codigo: string; nombre: string; nombre_comercial: string;
          zona_horaria: string; moneda: string; logo_url: string | null; direccion: string | null;
        }>(
          `SELECT id_sede, codigo, nombre, nombre_comercial, zona_horaria, moneda, logo_url, direccion
           FROM configuracion.sede WHERE id_sede = $1 AND estado = 'activa'`, [ctx.sedeId]
        );
        const row = cfgRes.rows[0];
        if (row) customRow = {
          idSede: row.id_sede, codigoSede: row.codigo, nombreHotel: row.nombre,
          nombreComercial: row.nombre_comercial, zonaHoraria: row.zona_horaria,
          moneda: row.moneda, logoUrl: row.logo_url ?? undefined, direccion: row.direccion ?? undefined,
        };
      }
      const habStats = await client.query<{ total_habs: string; total_pisos: string }>(
        `SELECT COUNT(*)::text AS total_habs, COALESCE(MAX(piso), 0)::text AS total_pisos
         FROM g1_reservas.habitacion WHERE estado_registro = 'ACTIVA'`
      );
      return { ...customRow, numeroHabitaciones: Number(habStats.rows[0]?.total_habs ?? 0), numeroPisos: Number(habStats.rows[0]?.total_pisos ?? 0) };
    }, ctx);
    return { ...DEFAULT_ESTABLISHMENT, ...stats, fechaOperativa };
  } catch {
    return { ...DEFAULT_ESTABLISHMENT, idSede: ctx.sedeId, fechaOperativa };
  }
}

export function createConfiguracionRouter(): Router {
  const router = Router();
  router.use(authenticateJwt);

  router.get('/establecimiento', async (req, res, next) => {
    try { res.json(await getEstablishmentConfig(req.authContext!)); } catch (err) { next(err); }
  });
  router.get('/sedes', (req, res) => {
    res.json({ data: req.authContext!.sedes, sedeActiva: req.authContext!.sedeId });
  });
  router.post('/sedes', async (req, res, next) => {
    try {
      const ctx = req.authContext!;
      ensureSiteAdmin(ctx);
      const body = sedeBodySchema.parse(req.body);
      const idSede = `SEDE-${body.codigo.toUpperCase()}`;
      const created = await withTransaction(ctx, async (client) => {
        const result = await client.query(
          `INSERT INTO configuracion.sede (
             id_sede, codigo, nombre, nombre_comercial, direccion, zona_horaria, moneda, logo_url, estado
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'activa')
           RETURNING id_sede, codigo, nombre, nombre_comercial, direccion, zona_horaria, moneda, logo_url, estado`,
          [idSede, body.codigo.toUpperCase(), body.nombre, body.nombreComercial, body.direccion ?? null,
           body.zonaHoraria, body.moneda.toUpperCase(), body.logoUrl ?? null]
        );
        await client.query(
          `INSERT INTO configuracion.usuario_sede (id_usuario, id_sede, es_predeterminada)
           VALUES ($1, $2, false) ON CONFLICT (id_usuario, id_sede) DO UPDATE SET estado = 'activo'`,
          [ctx.usuarioId, idSede]
        );
        return result.rows[0];
      });
      res.status(201).json({ data: created });
    } catch (err) { next(err); }
  });
  router.put('/sedes/:id', async (req, res, next) => {
    try {
      const ctx = req.authContext!;
      ensureSiteAdmin(ctx);
      ensureSiteAccess(ctx, req.params.id);
      const body = sedeBodySchema.partial().extend({ estado: z.enum(['activa', 'inactiva']).optional() }).parse(req.body);
      const updated = await withTransaction(ctx, async (client) => {
        const result = await client.query(
          `UPDATE configuracion.sede SET codigo = COALESCE($2, codigo), nombre = COALESCE($3, nombre),
             nombre_comercial = COALESCE($4, nombre_comercial), direccion = COALESCE($5, direccion),
             zona_horaria = COALESCE($6, zona_horaria), moneda = COALESCE($7, moneda),
             logo_url = COALESCE($8, logo_url), estado = COALESCE($9, estado)
           WHERE id_sede = $1
           RETURNING id_sede, codigo, nombre, nombre_comercial, direccion, zona_horaria, moneda, logo_url, estado`,
          [req.params.id, body.codigo?.toUpperCase() ?? null, body.nombre ?? null, body.nombreComercial ?? null,
           body.direccion ?? null, body.zonaHoraria ?? null, body.moneda?.toUpperCase() ?? null,
           body.logoUrl ?? null, body.estado ?? null]
        );
        if (!result.rows[0]) throw new NotFoundError('Sede no encontrada.');
        return result.rows[0];
      });
      res.json({ data: updated });
    } catch (err) { next(err); }
  });
  router.put('/sedes/:id/usuarios/:usuarioId', async (req, res, next) => {
    try {
      const ctx = req.authContext!;
      ensureSiteAdmin(ctx);
      ensureSiteAccess(ctx, req.params.id);
      const body = z.object({ activo: z.boolean(), predeterminada: z.boolean().default(false) }).parse(req.body);
      if (req.params.usuarioId === ctx.usuarioId && req.params.id === ctx.sedeId && !body.activo) {
        throw new ForbiddenError('No puedes retirar tu propio acceso de la sede que estás usando.', 'ACTIVE_SITE_SELF_REMOVAL');
      }
      await withTransaction(ctx, async (client) => {
        if (body.predeterminada && body.activo) {
          await client.query(`UPDATE configuracion.usuario_sede SET es_predeterminada = false WHERE id_usuario = $1`, [req.params.usuarioId]);
        }
        await client.query(
          `INSERT INTO configuracion.usuario_sede (id_usuario, id_sede, es_predeterminada, estado)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id_usuario, id_sede) DO UPDATE
           SET es_predeterminada = EXCLUDED.es_predeterminada, estado = EXCLUDED.estado`,
          [req.params.usuarioId, req.params.id, body.predeterminada, body.activo ? 'activo' : 'inactivo']
        );
      });
      res.json({ data: { idUsuario: req.params.usuarioId, idSede: req.params.id, ...body } });
    } catch (err) { next(err); }
  });
  router.get('/sedes/:id/usuarios', async (req, res, next) => {
    try {
      const ctx = req.authContext!;
      ensureSiteAdmin(ctx);
      ensureSiteAccess(ctx, req.params.id);
      const rows = await withReadOnlyClient(async (client) => {
        const result = await client.query(
          `SELECT id_usuario, es_predeterminada, estado
           FROM configuracion.usuario_sede WHERE id_sede = $1 ORDER BY id_usuario`,
          [req.params.id]
        );
        return result.rows;
      }, ctx);
      res.json({ data: rows });
    } catch (err) { next(err); }
  });
  return router;
}
