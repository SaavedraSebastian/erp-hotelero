import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel, Type, type Schema } from '@google/genai';
import { z } from 'zod';
import { ConflictError, ForbiddenError } from '../../shared/errors/app-error.ts';
import { buildPaginatedResponse } from '../../shared/pagination/index.ts';
import type { PaginationParams } from '../../shared/types/context.ts';
import { getEnv } from '../../config/env.ts';
import { getOperationalTimestampLima } from '../../shared/dates/lima.ts';
import { withReadOnlyClient, withTransaction } from '../../shared/database/transaction.ts';
import {
  DomainRuleError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../shared/errors/app-error.ts';
import type { AuthContext } from '../../shared/types/context.ts';

const AI_MODEL_ID = 'gemini-4-hydrogen';

function requireGeminiClient(): GoogleGenAI {
  const apiKey = getEnv().geminiApiKey;
  if (!apiKey) {
    throw new ServiceUnavailableError(
      'La clave de Gemini API no está configurada en el servidor. Configúrala en Settings > Secrets.',
      'GEMINI_API_KEY_NOT_CONFIGURED'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function generateStructuredJson<T>(
  systemInstruction: string,
  prompt: string,
  responseSchema: Schema,
  zodValidator: z.ZodType<T>
): Promise<T> {
  const ai = requireGeminiClient();
  let rawText: string | undefined;
  try {
    const response = await ai.models.generateContent({
      model: AI_MODEL_ID,
      contents: prompt,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema,
      },
    });
    rawText = response.text;
  } catch (err) {
    throw new ServiceUnavailableError(
      err instanceof Error ? `Error al consultar Gemini API: ${err.message}` : 'Error al consultar Gemini API.',
      'GEMINI_UPSTREAM_ERROR'
    );
  }

  if (!rawText) {
    throw new ServiceUnavailableError('El modelo de IA no devolvió respuesta.', 'GEMINI_EMPTY_RESPONSE');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new DomainRuleError('La respuesta generada por IA no tiene estructura JSON válida.', 'AI_INVALID_JSON');
  }

  const checked = zodValidator.safeParse(parsedJson);
  if (!checked.success) {
    throw new DomainRuleError('La respuesta estructurada de IA no cumplió el contrato de esquema.', 'AI_SCHEMA_MISMATCH');
  }
  return checked.data;
}

// 1) M1: Predicción No-Show
const noShowOutputSchema = z.object({
  probabilidad: z.number().min(0).max(1),
  nivelRiesgo: z.enum(['BAJO', 'MEDIO', 'ALTO', 'CRITICO']),
  explicacion: z.string().min(5).max(300),
});

export async function generarPrediccionNoShowService(ctx: AuthContext, idReserva: string) {
  const contextoReserva = await withReadOnlyClient(async (client) => {
    const res = await client.query<{
      id_reserva: string;
      codigo_reserva: string;
      canal_origen: string;
      estado_reserva: string;
      fecha_ingreso: string;
      fecha_salida: string;
      total_reserva: string;
      dias_anticipacion: number;
      tiene_prepago: boolean;
    }>(
      `SELECT r.id_reserva::text AS id_reserva,
              ('RES-' || r.id_reserva::text) AS codigo_reserva,
              cr.nombre AS canal_origen,
              r.estado AS estado_reserva,
              r.fecha_ingreso::text AS fecha_ingreso,
              r.fecha_salida::text AS fecha_salida,
              ROUND(
                GREATEST(1, (r.fecha_salida - r.fecha_ingreso)) *
                COALESCE((SELECT SUM(dr.precio_noche) FROM g1_reservas.detalle_reserva dr WHERE dr.id_reserva = r.id_reserva), t.precio_base),
                2
              )::text AS total_reserva,
              GREATEST(0, (r.fecha_ingreso - CURRENT_DATE))::int AS dias_anticipacion,
              EXISTS (
                SELECT 1 FROM g4_finanzas.cuenta c
                JOIN g4_finanzas.cobro cb ON cb.id_cuenta = c.id_cuenta AND cb.estado = 'REGISTRADO'
                WHERE c.id_reserva = r.id_reserva
              ) AS tiene_prepago
       FROM g1_reservas.reserva r
       JOIN g1_reservas.canal_reserva cr ON cr.id_canal_reserva = r.id_canal_reserva
       JOIN g1_reservas.tarifa t ON t.id_tarifa = r.id_tarifa
       WHERE r.id_reserva = $1::bigint`,
      [idReserva]
    );
    if (!res.rows[0]) throw new NotFoundError('Reserva no encontrada para análisis No-Show.');
    return res.rows[0];
  }, ctx);

  const aiResult = await generateStructuredJson(
    'Eres un modelo analítico hotelero de riesgo de No-Show (sin PII). Evalúa la probabilidad [0,1] y nivel de riesgo.',
    `Analiza esta reserva (sin datos personales): ${JSON.stringify(contextoReserva)}`,
    {
      type: Type.OBJECT,
      properties: {
        probabilidad: { type: Type.NUMBER },
        nivelRiesgo: { type: Type.STRING, enum: ['BAJO', 'MEDIO', 'ALTO', 'CRITICO'] },
        explicacion: { type: Type.STRING },
      },
      required: ['probabilidad', 'nivelRiesgo', 'explicacion'],
    },
    noShowOutputSchema
  );

  const saved = await withTransaction(ctx, async (client) => {
    const ins = await client.query(
      `INSERT INTO g1_reservas.prediccion_no_show (id_reserva, probabilidad, nivel_riesgo, version_modelo)
       VALUES ($1::bigint, $2::numeric(5,4), $3, $4)
       RETURNING id_prediccion::text AS id_prediccion, id_reserva::text AS id_reserva,
                 probabilidad::text AS probabilidad, nivel_riesgo, fecha_prediccion::text AS fecha_prediccion, version_modelo`,
      [idReserva, aiResult.probabilidad.toFixed(4), aiResult.nivelRiesgo, AI_MODEL_ID]
    );
    return ins.rows[0];
  });

  return {
    ...saved,
    explicacion: aiResult.explicacion,
    requiereConfirmacionHumana: true,
  };
}

// 2) M1: Sugerencia de Tarifa Dinámica (aceptada = NULL hasta confirmación humana)
const tarifaOutputSchema = z.object({
  factorAjuste: z.number().min(0.6).max(2.0),
  justificacion: z.string().min(5).max(300),
});

export async function sugerirTarifaService(ctx: AuthContext, idReserva: string) {
  const data = await withReadOnlyClient(async (client) => {
    const res = await client.query<{
      id_reserva: string;
      fecha_ingreso: string;
      fecha_salida: string;
      tarifa_actual: string;
      anticipacion_dias: number;
      ocupacion_actual: string;
    }>(
      `SELECT r.id_reserva::text AS id_reserva,
              r.fecha_ingreso::text AS fecha_ingreso,
              r.fecha_salida::text AS fecha_salida,
              COALESCE((SELECT AVG(dr.precio_noche) FROM g1_reservas.detalle_reserva dr WHERE dr.id_reserva = r.id_reserva), t.precio_base)::text AS tarifa_actual,
              GREATEST(0, (r.fecha_ingreso - CURRENT_DATE))::int AS anticipacion_dias,
              ROUND(COALESCE((
                SELECT COUNT(*)::numeric / NULLIF((SELECT COUNT(*) FROM g1_reservas.habitacion WHERE estado_registro = 'ACTIVA'), 0)
                FROM g1_reservas.habitacion h
                JOIN g2_housekeeping.v_estado_actual v ON v.id_habitacion = h.id_habitacion
                WHERE v.id_estado = 'OCU'
              ), 0.50), 4)::text AS ocupacion_actual
       FROM g1_reservas.reserva r
       JOIN g1_reservas.tarifa t ON t.id_tarifa = r.id_tarifa
       WHERE r.id_reserva = $1::bigint`,
      [idReserva]
    );
    if (!res.rows[0]) throw new NotFoundError('Reserva no encontrada para sugerencia de tarifa.');
    return res.rows[0];
  }, ctx);

  const aiResult = await generateStructuredJson(
    'Eres un motor de Revenue Management hotelero. Propón un factor de ajuste tarifario entre 0.60 y 2.00 según ocupación y anticipación.',
    `Contexto operativo: ${JSON.stringify(data)}`,
    {
      type: Type.OBJECT,
      properties: {
        factorAjuste: { type: Type.NUMBER },
        justificacion: { type: Type.STRING },
      },
      required: ['factorAjuste', 'justificacion'],
    },
    tarifaOutputSchema
  );

  const base = Number(data.tarifa_actual);
  const sugerida = Number((base * aiResult.factorAjuste).toFixed(2));

  const saved = await withTransaction(ctx, async (client) => {
    const ins = await client.query(
      `INSERT INTO g1_reservas.sugerencia_tarifa (
         id_reserva, tarifa_base, factor_ajuste, tarifa_sugerida, ocupacion_proyectada, anticipacion_dias, aceptada
       )
       VALUES ($1::bigint, $2::numeric(12,2), $3::numeric(8,4), $4::numeric(12,2), $5::numeric(5,4), $6, NULL)
       RETURNING id_sugerencia::text AS id_sugerencia, id_reserva::text AS id_reserva,
                 tarifa_base::text AS tarifa_base, factor_ajuste::text AS factor_ajuste,
                 tarifa_sugerida::text AS tarifa_sugerida, aceptada, fecha_generacion::text AS fecha_generacion`,
      [
        idReserva,
        base.toFixed(2),
        aiResult.factorAjuste.toFixed(4),
        sugerida.toFixed(2),
        Number(data.ocupacion_actual).toFixed(4),
        data.anticipacion_dias,
      ]
    );
    return ins.rows[0];
  });

  return {
    ...saved,
    justificacion: aiResult.justificacion,
    requiereConfirmacionHumana: true,
  };
}

// 3) M2: Propuesta de asignación Housekeeping (supervisor decide aceptar/modificar/rechazar)
const hkPropuestaOutputSchema = z.object({
  asignaciones: z.array(
    z.object({
      numeroOrden: z.string().regex(/^[1-9]\d*$/),
      idPersonal: z.string().regex(/^[1-9]\d*$/),
      minutosEstimados: z.number().int().min(5).max(240),
      justificacion: z.string().min(5).max(300),
    })
  ),
});

export async function proponerHousekeepingService(
  ctx: AuthContext,
  input: { idTurno: 'M' | 'T' | 'N'; fecha: string }
) {
  const snapshot = await withReadOnlyClient(async (client) => {
    const supRes = await client.query<{ id_personal: string }>(
      `SELECT id_personal::text AS id_personal FROM g2_housekeeping.supervisor ORDER BY id_personal LIMIT 1`
    );
    const idSupervisor = supRes.rows[0]?.id_personal;
    if (!idSupervisor) {
      throw new DomainRuleError('No existe un supervisor registrado en g2_housekeeping para asociar la propuesta.');
    }

    const ordenes = await client.query(
      `SELECT numero_orden::text AS numero_orden, id_habitacion::text AS id_habitacion,
              tipo_limpieza, prioridad, estado
       FROM g2_housekeeping.orden_limpieza
       WHERE estado IN ('Pendiente', 'Asignada') AND fecha_programada = $1::date AND id_turno = $2
       ORDER BY numero_orden ASC
       LIMIT 30`,
      [input.fecha, input.idTurno]
    );

    const personal = await client.query(
      `SELECT pl.id_personal::text AS id_personal, po.nombres, po.apellidos, pt.disponible
       FROM g2_housekeeping.personal_limpieza pl
       JOIN g2_housekeeping.personal_operativo po ON po.id_personal = pl.id_personal
       JOIN g2_housekeeping.programacion_turno pt ON pt.id_personal = pl.id_personal
       WHERE pt.fecha = $1::date AND pt.id_turno = $2 AND pt.disponible = TRUE AND po.estado = 'A'`,
      [input.fecha, input.idTurno]
    );

    return { idSupervisor, ordenes: ordenes.rows, personal: personal.rows };
  }, ctx);

  if (snapshot.ordenes.length === 0 || snapshot.personal.length === 0) {
    throw new DomainRuleError('No hay órdenes pendientes ni personal disponible en el turno/fecha indicado.');
  }

  const aiResult = await generateStructuredJson(
    'Eres un planificador de Housekeeping hotelero. Asigna cada numeroOrden de limpieza pendiente a un idPersonal disponible balanceando carga.',
    `Órdenes: ${JSON.stringify(snapshot.ordenes)}\nPersonal disponible: ${JSON.stringify(snapshot.personal)}`,
    {
      type: Type.OBJECT,
      properties: {
        asignaciones: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              numeroOrden: { type: Type.STRING },
              idPersonal: { type: Type.STRING },
              minutosEstimados: { type: Type.INTEGER },
              justificacion: { type: Type.STRING },
            },
            required: ['numeroOrden', 'idPersonal', 'minutosEstimados', 'justificacion'],
          },
        },
      },
      required: ['asignaciones'],
    },
    hkPropuestaOutputSchema
  );

  const validOrders = new Set(snapshot.ordenes.map((o) => String(o.numero_orden)));
  const validStaff = new Set(snapshot.personal.map((p) => String(p.id_personal)));
  const carga = new Map<string, number>();

  const persisted = await withTransaction(ctx, async (client) => {
    const propRes = await client.query<{ id_propuesta: string }>(
      `INSERT INTO g2_housekeeping.propuesta_asignacion (id_supervisor, id_turno, fecha, version_modelo, estado)
       VALUES ($1::bigint, $2, $3::date, $4, 'Generada')
       RETURNING id_propuesta::text AS id_propuesta`,
      [snapshot.idSupervisor, input.idTurno, input.fecha, AI_MODEL_ID.slice(0, 30)]
    );
    const idPropuesta = propRes.rows[0].id_propuesta;

    const details = [];
    for (const item of aiResult.asignaciones) {
      if (!validOrders.has(item.numeroOrden) || !validStaff.has(item.idPersonal)) continue;
      const prevLoad = carga.get(item.idPersonal) ?? 0;
      const nextLoad = prevLoad + item.minutosEstimados;
      carga.set(item.idPersonal, nextLoad);

      const dRes = await client.query(
        `INSERT INTO g2_housekeeping.detalle_propuesta (
           id_propuesta, numero_orden, id_personal, minutos_estimados, carga_resultante, justificacion
         )
         VALUES ($1::bigint, $2::bigint, $3::bigint, $4, $5, $6)
         ON CONFLICT (id_propuesta, numero_orden) DO NOTHING
         RETURNING numero_orden::text AS numero_orden, id_personal::text AS id_personal, minutos_estimados, carga_resultante, justificacion`,
        [idPropuesta, item.numeroOrden, item.idPersonal, item.minutosEstimados, nextLoad, item.justificacion.slice(0, 300)]
      );
      if (dRes.rows[0]) details.push(dRes.rows[0]);
    }

    return { idPropuesta, estado: 'Generada', detalle: details };
  });

  return { ...persisted, requiereConfirmacionHumana: true };
}

// 4) M2: Evaluación predictiva de mantenimiento
const mantOutputSchema = z.object({
  evaluaciones: z.array(
    z.object({
      idActivo: z.string().regex(/^[1-9]\d*$/),
      probabilidadFalla: z.number().min(0).max(1),
      factoresExplicativos: z.string().min(5).max(300),
    })
  ),
});

export async function evaluarMantenimientoService(ctx: AuthContext, idActivos?: string[]) {
  const activos = await withReadOnlyClient(async (client) => {
    const res = await client.query<{
      id_activo: string;
      codigo_activo: string;
      nombre: string;
      horas_uso_acumuladas: string;
      vida_util_horas: number | null;
      umbral_alerta: string;
      estado: string;
    }>(
      `SELECT a.id_activo::text AS id_activo, a.codigo_activo, a.nombre,
              a.horas_uso_acumuladas::text AS horas_uso_acumuladas,
              ta.vida_util_horas, ta.umbral_alerta::text AS umbral_alerta, a.estado
       FROM g2_housekeeping.activo a
       JOIN g2_housekeeping.tipo_activo ta ON ta.id_tipo_activo = a.id_tipo_activo
       WHERE a.estado <> 'Dado de baja'
         AND ($1::bigint[] IS NULL OR a.id_activo = ANY($1::bigint[]))
       ORDER BY a.horas_uso_acumuladas DESC
       LIMIT 30`,
      [idActivos && idActivos.length > 0 ? idActivos : null]
    );
    return res.rows;
  }, ctx);

  if (activos.length === 0) {
    throw new DomainRuleError('No se encontraron activos operativos para evaluar.');
  }

  const aiResult = await generateStructuredJson(
    'Eres un ingeniero de confiabilidad hotelera. Estima probabilidadFalla [0,1] para cada idActivo según horas de uso y vida útil.',
    `Activos: ${JSON.stringify(activos)}`,
    {
      type: Type.OBJECT,
      properties: {
        evaluaciones: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              idActivo: { type: Type.STRING },
              probabilidadFalla: { type: Type.NUMBER },
              factoresExplicativos: { type: Type.STRING },
            },
            required: ['idActivo', 'probabilidadFalla', 'factoresExplicativos'],
          },
        },
      },
      required: ['evaluaciones'],
    },
    mantOutputSchema
  );

  const byId = new Map(activos.map((a) => [a.id_activo, a]));

  const persisted = await withTransaction(ctx, async (client) => {
    const evalRes = await client.query<{ id_evaluacion: string }>(
      `INSERT INTO g2_housekeeping.evaluacion_predictiva (version_modelo, activos_evaluados, activos_sin_datos, resultado)
       VALUES ($1, $2, 0, 'Completada')
       RETURNING id_evaluacion::text AS id_evaluacion`,
      [AI_MODEL_ID.slice(0, 30), activos.length]
    );
    const idEvaluacion = evalRes.rows[0].id_evaluacion;
    const alertas = [];

    for (const ev of aiResult.evaluaciones) {
      const activo = byId.get(ev.idActivo);
      if (!activo) continue;
      const umbral = Number(activo.umbral_alerta);
      if (ev.probabilidadFalla > umbral) {
        const insAlert = await client.query(
          `INSERT INTO g2_housekeeping.alerta_predictiva (
             id_evaluacion, id_activo, probabilidad_falla, umbral_aplicado, factores_explicativos, estado
           )
           VALUES ($1::bigint, $2::bigint, $3::numeric(5,4), $4::numeric(5,4), $5, 'Abierta')
           ON CONFLICT (id_activo) WHERE estado = 'Abierta' DO NOTHING
           RETURNING id_alerta::text AS id_alerta, id_activo::text AS id_activo,
                     probabilidad_falla::text AS probabilidad_falla, umbral_aplicado::text AS umbral_aplicado,
                     factores_explicativos, estado`,
          [idEvaluacion, ev.idActivo, ev.probabilidadFalla.toFixed(4), umbral.toFixed(4), ev.factoresExplicativos.slice(0, 300)]
        );
        if (insAlert.rows[0]) alertas.push(insAlert.rows[0]);
      }
    }

    return { idEvaluacion, activosEvaluados: activos.length, alertasGeneradas: alertas };
  });

  return { ...persisted, requiereConfirmacionHumana: true };
}

// 5) M3: Pronóstico de demanda y recomendación de gestión
const demandaOutputSchema = z.object({
  tipoResultado: z.string().min(3).max(40),
  cantidadEstimada: z.number().min(0),
  recomendacionTipo: z.string().min(3).max(40),
  motivo: z.string().min(5).max(500),
});

export async function pronosticarDemandaService(
  ctx: AuthContext,
  input: {
    idPuntoVenta: string;
    idItemCatalogo?: string | null;
    idArticulo?: string | null;
    fechaDesde: string;
    fechaHasta: string;
  }
) {
  const hist = await withReadOnlyClient(async (client) => {
    const pv = await client.query(`SELECT nombre FROM g3_servicios.punto_venta WHERE id_punto_venta = $1`, [
      input.idPuntoVenta,
    ]);
    if (!pv.rows[0]) throw new NotFoundError('Punto de venta no encontrado.');

    const consumos = await client.query(
      `SELECT COUNT(*)::int AS total_consumos, COALESCE(SUM(importe_total), 0)::text AS monto_reciente
       FROM g3_servicios.consumo
       WHERE id_punto_venta = $1 AND estado = 'confirmado'`,
      [input.idPuntoVenta]
    );
    return { puntoVenta: pv.rows[0].nombre, historico: consumos.rows[0] };
  }, ctx);

  const aiResult = await generateStructuredJson(
    'Eres un analista de demanda de A&B y Almacén hotelero. Estima demanda y propón una recomendación de reposición o stock.',
    `Periodo ${input.fechaDesde} a ${input.fechaHasta}. Datos agregados: ${JSON.stringify(hist)}`,
    {
      type: Type.OBJECT,
      properties: {
        tipoResultado: { type: Type.STRING },
        cantidadEstimada: { type: Type.NUMBER },
        recomendacionTipo: { type: Type.STRING },
        motivo: { type: Type.STRING },
      },
      required: ['tipoResultado', 'cantidadEstimada', 'recomendacionTipo', 'motivo'],
    },
    demandaOutputSchema
  );

  const nowLima = getOperationalTimestampLima();
  const idPronostico = crypto.randomUUID();
  const idRecomendacion = crypto.randomUUID();
  const datosUtilizados = JSON.stringify(hist.historico).slice(0, 500);

  const persisted = await withTransaction(ctx, async (client) => {
    await client.query(
      `INSERT INTO g3_servicios.pronostico_demanda (
         id_pronostico, id_punto_venta, id_item_catalogo, id_articulo,
         fecha_desde, fecha_hasta, fecha_hora_generacion, tipo_resultado, cantidad_estimada, datos_utilizados
       )
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7::timestamp(0), $8, $9::numeric(14,3), $10)`,
      [
        idPronostico,
        input.idPuntoVenta,
        input.idItemCatalogo ?? null,
        input.idArticulo ?? null,
        input.fechaDesde,
        input.fechaHasta,
        nowLima,
        aiResult.tipoResultado.slice(0, 40),
        aiResult.cantidadEstimada.toFixed(3),
        datosUtilizados,
      ]
    );

    const recRes = await client.query(
      `INSERT INTO g3_servicios.recomendacion_gestion (
         id_recomendacion, id_pronostico, tipo, motivo, datos_utilizados, fecha_hora_generacion, estado
       )
       VALUES ($1, $2, $3, $4, $5, $6::timestamp(0), 'pendiente')
       RETURNING id_recomendacion, id_pronostico, tipo, motivo, estado, fecha_hora_generacion::text AS fecha_hora_generacion`,
      [
        idRecomendacion,
        idPronostico,
        aiResult.recomendacionTipo.slice(0, 40),
        aiResult.motivo.slice(0, 500),
        datosUtilizados,
        nowLima,
      ]
    );
    return recRes.rows[0];
  });

  return {
    idPronostico,
    cantidadEstimada: aiResult.cantidadEstimada,
    recomendacion: persisted,
    requiereConfirmacionHumana: true,
  };
}

export async function listarRecomendacionesDemandaService(ctx: AuthContext, params: PaginationParams) {
  return withReadOnlyClient(async (client) => {
    const values: unknown[] = [];
    const where: string[] = [];
    if (params.status) {
      values.push(params.status.split(',').map((v) => v.trim()).filter(Boolean));
      where.push(`r.estado::text = ANY($${values.length}::text[])`);
    }
    if (params.search) {
      values.push(`%${params.search}%`);
      where.push(`(r.tipo ILIKE $${values.length} OR r.motivo ILIKE $${values.length})`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const count = await client.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM g3_servicios.recomendacion_gestion r ${clause}`, values
    );
    values.push(params.pageSize, (params.page - 1) * params.pageSize);
    const rows = await client.query(
      `SELECT r.id_recomendacion, r.id_pronostico, r.tipo, r.motivo, r.datos_utilizados,
              r.fecha_hora_generacion::text AS fecha_hora_generacion, r.estado, r.decision,
              r.comentario_decision, r.fecha_hora_decision::text AS fecha_hora_decision,
              p.fecha_desde::text AS fecha_desde, p.fecha_hasta::text AS fecha_hasta,
              p.tipo_resultado, p.cantidad_estimada::text AS cantidad_estimada,
              p.id_punto_venta, p.id_item_catalogo, p.id_articulo
       FROM g3_servicios.recomendacion_gestion r
       JOIN g3_servicios.pronostico_demanda p ON p.id_pronostico = r.id_pronostico
       ${clause}
       ORDER BY r.fecha_hora_generacion DESC, r.id_recomendacion DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return buildPaginatedResponse(rows.rows, Number(count.rows[0]?.total ?? 0), params.page, params.pageSize);
  }, ctx);
}

export async function decidirRecomendacionDemandaService(
  ctx: AuthContext,
  idRecomendacion: string,
  decision: 'aceptada' | 'descartada',
  comentario: string | null
) {
  const allowed = ctx.roles.some((role) =>
    ['ADMIN_SISTEMA', 'SUPER_ADMIN', 'ADMINISTRADOR', 'ADMIN_SERVICIOS'].includes(role.toUpperCase())
  );
  if (!allowed) throw new ForbiddenError('Solo un administrador puede decidir una recomendación.', 'M3_AI_ADMIN_REQUIRED');
  return withTransaction(ctx, async (client) => {
    const result = await client.query(
      `UPDATE g3_servicios.recomendacion_gestion
       SET estado = $2, decision = $2, comentario_decision = $3, fecha_hora_decision = CURRENT_TIMESTAMP
       WHERE id_recomendacion = $1 AND estado = 'pendiente'
       RETURNING id_recomendacion, id_pronostico, estado, decision,
                 comentario_decision, fecha_hora_decision::text AS fecha_hora_decision`,
      [idRecomendacion, decision, comentario]
    );
    if (result.rows[0]) return result.rows[0];
    const current = await client.query<{ estado: string }>(
      `SELECT estado FROM g3_servicios.recomendacion_gestion WHERE id_recomendacion = $1`, [idRecomendacion]
    );
    if (!current.rows[0]) throw new NotFoundError('Recomendación no encontrada.');
    throw new ConflictError('La recomendación ya fue decidida y no puede modificarse.', 'M3_AI_DECISION_IMMUTABLE');
  });
}

// 6) M4: Evaluación financiera y proyección (sin auto-ejecución contable)
const finanzasOutputSchema = z.object({
  montoEstimado: z.number(),
  flujoCajaEstimado: z.number(),
  limiteInferior: z.number(),
  limiteSuperior: z.number(),
  analisis: z.string().min(5).max(500),
});

export async function evaluarFinanzasService(
  ctx: AuthContext,
  input: {
    periodo: 7 | 30 | 90;
    tipo: 'BASE' | 'ESCENARIO';
    idProyeccionBase?: string | null;
    escenarioSupuesto?: string | null;
  }
) {
  const agg = await withReadOnlyClient(async (client) => {
    const res = await client.query(
      `SELECT
         COALESCE((SELECT SUM(monto) FROM g4_finanzas.cobro WHERE estado = 'REGISTRADO'), 0)::text AS ingresos_totales,
         COALESCE((SELECT SUM(monto) FROM g4_finanzas.gasto WHERE estado = 'APROBADO'), 0)::text AS gastos_aprobados,
         COALESCE((SELECT COUNT(*) FROM g4_finanzas.alerta_financiera WHERE clasificacion = 'PENDIENTE'), 0)::int AS alertas_pendientes`
    );
    return res.rows[0];
  }, ctx);

  const aiResult = await generateStructuredJson(
    'Eres un controlador financiero hotelero. Calcula montos proyectados y límites estadísticos sin inventar datos históricos.',
    `Horizonte ${input.periodo} días (${input.tipo}). Supuesto: ${input.escenarioSupuesto ?? 'Operación estándar'}. Agregados: ${JSON.stringify(agg)}`,
    {
      type: Type.OBJECT,
      properties: {
        montoEstimado: { type: Type.NUMBER },
        flujoCajaEstimado: { type: Type.NUMBER },
        limiteInferior: { type: Type.NUMBER },
        limiteSuperior: { type: Type.NUMBER },
        analisis: { type: Type.STRING },
      },
      required: ['montoEstimado', 'flujoCajaEstimado', 'limiteInferior', 'limiteSuperior', 'analisis'],
    },
    finanzasOutputSchema
  );

  const idProyeccion = crypto.randomUUID();

  const saved = await withTransaction(ctx, async (client) => {
    const userRes = await client.query<{ id_usuario: number }>(
      `SELECT id_usuario FROM g4_finanzas.usuario WHERE activo = TRUE ORDER BY id_usuario LIMIT 1`
    );
    const idUsuario = userRes.rows[0]?.id_usuario;
    if (!idUsuario) {
      throw new DomainRuleError('No existe un usuario operativo registrado en g4_finanzas.usuario.');
    }

    const ins = await client.query(
      `INSERT INTO g4_finanzas.proyeccion_financiera (
         id_proyeccion, id_usuario, id_proyeccion_base, periodo, tipo,
         monto_estimado, flujo_caja_estimado, limite_inferior, limite_superior, supuestos
       )
       VALUES ($1, $2, $3, $4, $5, $6::numeric(14,2), $7::numeric(14,2), $8::numeric(14,2), $9::numeric(14,2), $10::jsonb)
       RETURNING id_proyeccion, periodo, tipo, monto_estimado::text AS monto_estimado,
                 flujo_caja_estimado::text AS flujo_caja_estimado,
                 limite_inferior::text AS limite_inferior, limite_superior::text AS limite_superior,
                 fecha_creacion::text AS fecha_creacion`,
      [
        idProyeccion,
        idUsuario,
        input.idProyeccionBase ?? null,
        input.periodo,
        input.tipo,
        aiResult.montoEstimado.toFixed(2),
        aiResult.flujoCajaEstimado.toFixed(2),
        aiResult.limiteInferior.toFixed(2),
        aiResult.limiteSuperior.toFixed(2),
        JSON.stringify({ supuesto: input.escenarioSupuesto ?? 'Operación estándar', resumen: aiResult.analisis }),
      ]
    );
    return ins.rows[0];
  });

  return { ...saved, analisis: aiResult.analisis, requiereConfirmacionHumana: true };
}

// 7) M5: Asistente conversacional CRM (sin enviar PII cruda a Gemini)
const asistenteOutputSchema = z.object({
  intencion: z.string().min(2).max(40),
  confianza: z.number().min(0).max(1),
  resultado: z.enum(['RESPONDIDA', 'LIMITACION_INFORMADA', 'DERIVADA']),
  respuesta: z.string().min(3).max(1500),
});

export async function consultarAsistenteService(
  ctx: AuthContext,
  input: { mensaje: string; idEstadia?: string | null; contextoAnonimizado?: Record<string, unknown> }
) {
  const startedAt = Date.now();

  // Eliminar explícitamente cualquier campo potencial de PII antes de consultar a Gemini
  const safeContext = { ...(input.contextoAnonimizado ?? {}) };
  for (const piiKey of ['dni', 'ruc', 'correo', 'email', 'telefono', 'phone', 'numeroDocumento', 'documentNumber', 'nombres', 'apellidos', 'fullName']) {
    delete safeContext[piiKey];
  }

  const aiResult = await generateStructuredJson(
    [
      'Eres el Asistente Conversacional de Hotel Boulevard (SGH-ERP).',
      'Responde en español cordial y breve. Si la solicitud excede información general o requiere intervención operativa, responde resultado="DERIVADA" o "LIMITACION_INFORMADA".',
      'Nunca inventes montos ni prometas compensaciones monetarias sin aprobación humana.',
    ].join(' '),
    `Contexto operativo anonimizado: ${JSON.stringify(safeContext)}\nConsulta: ${input.mensaje}`,
    {
      type: Type.OBJECT,
      properties: {
        intencion: { type: Type.STRING },
        confianza: { type: Type.NUMBER },
        resultado: { type: Type.STRING, enum: ['RESPONDIDA', 'LIMITACION_INFORMADA', 'DERIVADA'] },
        respuesta: { type: Type.STRING },
      },
      required: ['intencion', 'confianza', 'resultado', 'respuesta'],
    },
    asistenteOutputSchema
  );

  const elapsedMs = Math.min(999999, Math.max(0, Date.now() - startedAt));
  const derivadaAgente = aiResult.resultado === 'DERIVADA';

  const saved = await withTransaction(ctx, async (client) => {
    const ins = await client.query(
      `INSERT INTO g5_crm.consulta_asistente (
         id_estadia, id_reclamo, intencion, confianza, resultado, derivada_agente, tiempo_respuesta_ms
       )
       VALUES ($1::bigint, NULL, $2, $3::numeric(5,4), $4, $5, $6)
       RETURNING id_consulta, intencion, confianza::text AS confianza, resultado, derivada_agente, tiempo_respuesta_ms, fecha_hora::text AS fecha_hora`,
      [
        input.idEstadia ?? null,
        aiResult.intencion.slice(0, 40),
        aiResult.confianza.toFixed(4),
        aiResult.resultado,
        derivadaAgente,
        elapsedMs,
      ]
    );
    return ins.rows[0];
  });

  return {
    ...saved,
    respuesta: aiResult.respuesta,
    modelo: AI_MODEL_ID,
  };
}
