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
      habitaciones_disponibles_listas: number;
      habitaciones_reservadas_hoy: number;
      estadias_en_curso: number;
      ordenes_limpieza_pendientes: number;
      incidencias_abiertas: number;
      comandas_activas: number;
      cuentas_activas: number;
      alertas_financieras_pendientes: number;
      reclamos_abiertos: number;
      llegadas_hoy: number;
      salidas_hoy: number;
      ordenes_trabajo_abiertas: number;
      inventario_critico: number;
      requisiciones_pendientes: number;
      satisfaccion_promedio: string | null;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM g1_reservas.habitacion WHERE estado_registro = 'ACTIVA') AS total_habitaciones,
         (SELECT COUNT(*)::int FROM g2_housekeeping.v_estado_actual WHERE id_estado = 'OCU') AS habitaciones_ocupadas,
         (SELECT COUNT(*)::int FROM g2_housekeeping.v_estado_actual WHERE id_estado = 'SUC') AS habitaciones_sucias,
         (SELECT COUNT(*)::int FROM g2_housekeeping.v_estado_actual WHERE id_estado = 'FSV') AS habitaciones_fuera_servicio,
         (SELECT COUNT(*)::int FROM g2_housekeeping.v_estado_actual WHERE id_estado IN ('DIS', 'LIM')) AS habitaciones_disponibles_listas,
         (SELECT COUNT(DISTINCT dr.id_habitacion)::int
            FROM g1_reservas.reserva r
            JOIN g1_reservas.detalle_reserva dr ON dr.id_reserva = r.id_reserva
            WHERE r.fecha_ingreso = $1::date AND r.estado IN ('CONFIRMADA', 'PENDIENTE')) AS habitaciones_reservadas_hoy,
         (SELECT COUNT(*)::int FROM g1_reservas.estadia WHERE estado = 'EN_CURSO') AS estadias_en_curso,
         (SELECT COUNT(*)::int FROM g2_housekeeping.orden_limpieza WHERE estado IN ('Pendiente', 'Asignada', 'En limpieza')) AS ordenes_limpieza_pendientes,
         (SELECT COUNT(*)::int FROM g2_housekeeping.incidencia WHERE estado IN ('Abierta', 'En atención')) AS incidencias_abiertas,
         (SELECT COUNT(*)::int FROM g3_servicios.comanda WHERE estado IN ('pendiente', 'en preparación', 'lista')) AS comandas_activas,
         (SELECT COUNT(*)::int FROM g4_finanzas.cuenta WHERE estado = 'ACTIVA') AS cuentas_activas,
         (SELECT COUNT(*)::int FROM g4_finanzas.alerta_financiera WHERE clasificacion = 'PENDIENTE') AS alertas_financieras_pendientes,
         (SELECT COUNT(*)::int FROM g5_crm.reclamo WHERE estado <> 'CERRADO') AS reclamos_abiertos,
         (SELECT COUNT(*)::int FROM g1_reservas.reserva
            WHERE fecha_ingreso = $1::date AND estado IN ('CONFIRMADA', 'PENDIENTE')) AS llegadas_hoy,
         (SELECT COUNT(*)::int FROM g1_reservas.reserva
            WHERE fecha_salida = $1::date AND estado IN ('EN_CURSO', 'CHECK_IN')) AS salidas_hoy,
         (SELECT COUNT(*)::int FROM g2_housekeeping.orden_trabajo
            WHERE estado NOT IN ('Completada', 'Cancelada')) AS ordenes_trabajo_abiertas,
         (SELECT COUNT(*)::int FROM g3_servicios.articulo_almacen aa
            WHERE COALESCE((SELECT SUM(l.cantidad_disponible) FROM g3_servicios.lote_articulo l
                            WHERE l.id_articulo = aa.id_articulo), 0) <= aa.stock_minimo) AS inventario_critico,
         (SELECT COUNT(*)::int FROM g3_servicios.solicitud_reposicion
            WHERE estado = 'pendiente') AS requisiciones_pendientes,
         (SELECT ROUND(AVG(e.puntaje) / 2.0, 2)::text FROM g5_crm.encuesta e) AS satisfaccion_promedio`,
      [operationalDate]
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
