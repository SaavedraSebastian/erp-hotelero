import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticateJwt } from '../../middleware/authenticate.ts';
import { requirePermission } from '../../middleware/authorize.ts';
import { getOperationalDateLima } from '../../shared/dates/lima.ts';
import { withReadOnlyClient } from '../../shared/database/transaction.ts';
import type { AuthContext } from '../../shared/types/context.ts';
import { PERMISSIONS } from '../seguridad/permissions.ts';

export async function getDashboardResumenService(ctx: AuthContext) {
  const operationalDate = getOperationalDateLima();

  return withReadOnlyClient(async (client) => {
    const kpiRes = await client.query<{
      total_habitaciones: number;
      habitaciones_ocupadas: number;
      habitaciones_sucias: number;
      habitaciones_fuera_servicio: number;
      estadias_en_curso: number;
      ordenes_limpieza_pendientes: number;
      incidencias_abiertas: number;
      comandas_activas: number;
      cuentas_activas: number;
      alertas_financieras_pendientes: number;
      reclamos_abiertos: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM g1_reservas.habitacion WHERE estado_registro = 'ACTIVA') AS total_habitaciones,
         (SELECT COUNT(*)::int FROM g2_housekeeping.v_estado_actual WHERE id_estado = 'OCU') AS habitaciones_ocupadas,
         (SELECT COUNT(*)::int FROM g2_housekeeping.v_estado_actual WHERE id_estado = 'SUC') AS habitaciones_sucias,
         (SELECT COUNT(*)::int FROM g2_housekeeping.v_estado_actual WHERE id_estado = 'FS') AS habitaciones_fuera_servicio,
         (SELECT COUNT(*)::int FROM g1_reservas.estadia WHERE estado = 'EN_CURSO') AS estadias_en_curso,
         (SELECT COUNT(*)::int FROM g2_housekeeping.orden_limpieza WHERE estado IN ('Pendiente', 'Asignada', 'En limpieza')) AS ordenes_limpieza_pendientes,
         (SELECT COUNT(*)::int FROM g2_housekeeping.incidencia WHERE estado IN ('Abierta', 'En atención')) AS incidencias_abiertas,
         (SELECT COUNT(*)::int FROM g3_servicios.comanda WHERE estado IN ('pendiente', 'en preparación', 'lista')) AS comandas_activas,
         (SELECT COUNT(*)::int FROM g4_finanzas.cuenta WHERE estado = 'ACTIVA') AS cuentas_activas,
         (SELECT COUNT(*)::int FROM g4_finanzas.alerta_financiera WHERE clasificacion = 'PENDIENTE') AS alertas_financieras_pendientes,
         (SELECT COUNT(*)::int FROM g5_crm.reclamo WHERE estado <> 'CERRADO') AS reclamos_abiertos`
    );

    const viewCheck = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.views
         WHERE table_schema = 'g5_crm' AND table_name = 'v_notificaciones_erp'
       ) AS exists`
    );

    let notificaciones: Array<Record<string, unknown>> = [];
    if (viewCheck.rows[0]?.exists) {
      const notifRes = await client.query(
        `SELECT id_evento, modulo_origen, modulos_destino, titulo, mensaje, severidad, entidad_ref, leida, fecha_hora::text AS fecha_hora
         FROM g5_crm.v_notificaciones_erp
         ORDER BY fecha_hora DESC
         LIMIT 20`
      );
      notificaciones = notifRes.rows;
    }

    const row = kpiRes.rows[0];
    const totalHab = row?.total_habitaciones ?? 0;
    const ocupadas = row?.habitaciones_ocupadas ?? 0;
    const porcentajeOcupacion = totalHab > 0 ? Number(((ocupadas / totalHab) * 100).toFixed(1)) : 0;

    return {
      fechaOperativa: operationalDate,
      zonaHoraria: 'America/Lima',
      kpis: {
        ...row,
        porcentaje_ocupacion: porcentajeOcupacion,
      },
      notificaciones,
    };
  }, ctx);
}

export function createDashboardRouter(): Router {
  const router = Router();
  router.use(authenticateJwt);

  router.get(
    '/resumen',
    requirePermission(PERMISSIONS.DASHBOARD_CONSULTAR),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.json({ data: await getDashboardResumenService(req.authContext!) });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
