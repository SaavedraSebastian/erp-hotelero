import { Router } from 'express';
import { isDatabaseConfigured } from '../../config/database.ts';
import { withReadOnlyClient } from '../../shared/database/transaction.ts';
import { getOperationalDateLima } from '../../shared/dates/lima.ts';
import type { EstablishmentConfig } from '../../shared/types/context.ts';

const DEFAULT_ESTABLISHMENT: Omit<EstablishmentConfig, 'fechaOperativa'> = {
  nombreHotel: 'Hotel Boulevard',
  nombreComercial: 'Hotel Boulevard',
  zonaHoraria: 'America/Lima',
  moneda: 'PEN',
  logoUrl: '/src/assets/images/hotel-hero.jpg',
  numeroHabitaciones: 42,
  numeroPisos: 6,
  direccion: 'Av. Principal 450, Lima, Perú',
};

export async function getEstablishmentConfig(): Promise<EstablishmentConfig> {
  const fechaOperativa = getOperationalDateLima();

  if (!isDatabaseConfigured()) {
    return {
      ...DEFAULT_ESTABLISHMENT,
      fechaOperativa,
    };
  }

  try {
    const stats = await withReadOnlyClient(async (client) => {
      const configTableExists = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'configuracion' AND table_name = 'establecimiento'
         ) AS exists`
      );

      let customRow: Partial<EstablishmentConfig> = {};
      if (configTableExists.rows[0]?.exists) {
        const cfgRes = await client.query<Record<string, unknown>>(
          `SELECT * FROM configuracion.establecimiento LIMIT 1`
        );
        const r = cfgRes.rows[0];
        if (r) {
          customRow = {
            nombreHotel: typeof r.nombre_hotel === 'string' ? r.nombre_hotel : undefined,
            nombreComercial: typeof r.nombre_comercial === 'string' ? r.nombre_comercial : undefined,
            zonaHoraria: typeof r.zona_horaria === 'string' ? r.zona_horaria : undefined,
            moneda: typeof r.moneda === 'string' ? r.moneda : undefined,
            logoUrl: typeof r.logo_url === 'string' ? r.logo_url : undefined,
            direccion: typeof r.direccion === 'string' ? r.direccion : undefined,
          };
        }
      }

      const habStats = await client.query<{ total_habs: string; total_pisos: string }>(
        `SELECT
           COUNT(*)::text AS total_habs,
           COALESCE(MAX(piso), 0)::text AS total_pisos
         FROM g1_reservas.habitacion
         WHERE estado_registro = 'ACTIVA'`
      );
      const totalHabs = Number(habStats.rows[0]?.total_habs ?? 0);
      const totalPisos = Number(habStats.rows[0]?.total_pisos ?? 0);

      return {
        ...customRow,
        numeroHabitaciones: totalHabs > 0 ? totalHabs : DEFAULT_ESTABLISHMENT.numeroHabitaciones,
        numeroPisos: totalPisos > 0 ? totalPisos : DEFAULT_ESTABLISHMENT.numeroPisos,
      };
    });

    return {
      ...DEFAULT_ESTABLISHMENT,
      ...stats,
      fechaOperativa,
    };
  } catch {
    return {
      ...DEFAULT_ESTABLISHMENT,
      fechaOperativa,
    };
  }
}

export function createConfiguracionRouter(): Router {
  const router = Router();

  router.get('/establecimiento', async (_req, res, next) => {
    try {
      const config = await getEstablishmentConfig();
      res.json(config);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
