import type { PoolClient } from 'pg';
import { ConflictError, DomainRuleError, NotFoundError } from '../../shared/errors/app-error.ts';

export interface PerfilHuespedRow {
  id_perfil: number;
  id_huesped: string;
  nombres: string;
  apellidos: string;
  tipo_documento: string;
  numero_documento: string;
  correo: string | null;
  telefono: string | null;
  nacionalidad: string | null;
  empresa: string | null;
  consentimiento_iso27701: boolean;
  fecha_consentimiento: string | null;
  marketing_opt_in: boolean;
  notas: string | null;
  id_segmento: number | null;
  segmento_nombre: string | null;
  fecha_alta: string;
  total_estadias: number;
  valor_acumulado: string;
  fecha_ultima_estadia: string | null;
  porcentaje_completitud: string;
  estado_perfil: string;
  saldo_puntos: number;
}

export async function listPerfiles(
  client: PoolClient,
  limit: number,
  offset: number
): Promise<{ rows: PerfilHuespedRow[]; total: number }> {
  const countRes = await client.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM g5_crm.perfil_huesped');
  const total = Number(countRes.rows[0]?.total ?? 0);

  const res = await client.query<PerfilHuespedRow>(
    `SELECT
       p.id_perfil,
       p.id_huesped::text AS id_huesped,
       h.nombres,
       h.apellidos,
       h.tipo_documento,
       h.numero_documento,
       h.correo,
       h.telefono,
       h.nacionalidad,
       h.empresa,
       h.consentimiento_iso27701,
       h.fecha_consentimiento::text AS fecha_consentimiento,
       h.marketing_opt_in,
       h.notas,
       p.id_segmento,
       s.nombre AS segmento_nombre,
       p.fecha_alta::text AS fecha_alta,
       p.total_estadias,
       p.valor_acumulado::text AS valor_acumulado,
       p.fecha_ultima_estadia::text AS fecha_ultima_estadia,
       p.porcentaje_completitud::text AS porcentaje_completitud,
       p.estado_perfil,
       COALESCE(vs.saldo_puntos, 0)::int AS saldo_puntos
     FROM g5_crm.perfil_huesped p
     JOIN g1_reservas.huesped h ON h.id_huesped = p.id_huesped
     LEFT JOIN g5_crm.segmento s ON s.id_segmento = p.id_segmento
     LEFT JOIN g5_crm.v_saldo_puntos vs ON vs.id_perfil = p.id_perfil
     ORDER BY p.valor_acumulado DESC, p.id_perfil ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return { rows: res.rows, total };
}

export async function getPerfilDetalleAndAuditConsulta(client: PoolClient, idPerfil: number) {
  const perfilRes = await client.query<PerfilHuespedRow>(
    `SELECT
       p.id_perfil,
       p.id_huesped::text AS id_huesped,
       h.nombres,
       h.apellidos,
       h.tipo_documento,
       h.numero_documento,
       h.correo,
       h.telefono,
       h.nacionalidad,
       h.empresa,
       h.consentimiento_iso27701,
       h.fecha_consentimiento::text AS fecha_consentimiento,
       h.marketing_opt_in,
       h.notas,
       p.id_segmento,
       s.nombre AS segmento_nombre,
       p.fecha_alta::text AS fecha_alta,
       p.total_estadias,
       p.valor_acumulado::text AS valor_acumulado,
       p.fecha_ultima_estadia::text AS fecha_ultima_estadia,
       p.porcentaje_completitud::text AS porcentaje_completitud,
       p.estado_perfil,
       COALESCE(vs.saldo_puntos, 0)::int AS saldo_puntos
     FROM g5_crm.perfil_huesped p
     JOIN g1_reservas.huesped h ON h.id_huesped = p.id_huesped
     LEFT JOIN g5_crm.segmento s ON s.id_segmento = p.id_segmento
     LEFT JOIN g5_crm.v_saldo_puntos vs ON vs.id_perfil = p.id_perfil
     WHERE p.id_perfil = $1`,
    [idPerfil]
  );

  const perfil = perfilRes.rows[0];
  if (!perfil) {
    throw new NotFoundError('Perfil de huésped no encontrado en CRM.');
  }

  // Registro obligatorio de consulta sensible en g5_crm.log_auditoria (CU-CA-05)
  await client.query(`SELECT g5_crm.registrar_consulta_sensible($1, $2)`, [
    'perfil_huesped',
    String(idPerfil),
  ]);

  const prefRes = await client.query(
    `SELECT id_preferencia, categoria, descripcion, origen, fecha_registro::text AS fecha_registro, vigente
     FROM g5_crm.preferencia
     WHERE id_perfil = $1
     ORDER BY vigente DESC, fecha_registro DESC`,
    [idPerfil]
  );

  const resRes = await client.query(
    `SELECT r.id_reserva::text AS id_reserva,
            ('RES-' || r.id_reserva::text) AS codigo_reserva,
            r.fecha_ingreso::text AS fecha_ingreso,
            r.fecha_salida::text AS fecha_salida,
            r.estado AS estado_reserva,
            ROUND(
              GREATEST(1, (r.fecha_salida - r.fecha_ingreso)) *
              COALESCE((SELECT SUM(dr.precio_noche) FROM g1_reservas.detalle_reserva dr WHERE dr.id_reserva = r.id_reserva), 0),
              2
            )::text AS total_reserva
     FROM g1_reservas.reserva r
     WHERE r.id_huesped = $1
     ORDER BY r.fecha_ingreso DESC
     LIMIT 20`,
    [perfil.id_huesped]
  );

  const reclamosRes = await client.query(
    `SELECT id_reclamo, codigo_seguimiento, tipo, prioridad, estado, descripcion, fecha_registro::text AS fecha_registro
     FROM g5_crm.reclamo
     WHERE id_perfil = $1
     ORDER BY fecha_registro DESC
     LIMIT 20`,
    [idPerfil]
  );

  return {
    perfil,
    preferencias: prefRes.rows,
    reservas: resRes.rows,
    reclamos: reclamosRes.rows,
  };
}

export async function addPreferencia(
  client: PoolClient,
  idPerfil: number,
  input: { categoria: string; descripcion: string; origen: string; vigente: boolean }
) {
  const exists = await client.query(`SELECT 1 FROM g5_crm.perfil_huesped WHERE id_perfil = $1`, [idPerfil]);
  if (!exists.rows[0]) {
    throw new NotFoundError('Perfil de huésped no encontrado.');
  }
  const res = await client.query(
    `INSERT INTO g5_crm.preferencia (id_perfil, categoria, descripcion, origen, vigente)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id_preferencia, id_perfil, categoria, descripcion, origen, fecha_registro::text AS fecha_registro, vigente`,
    [idPerfil, input.categoria, input.descripcion, input.origen, input.vigente]
  );
  return res.rows[0];
}

export async function listSegmentosDistribucion(client: PoolClient) {
  const res = await client.query(
    `SELECT s.id_segmento, v.codigo_segmento, v.nombre, s.descripcion, s.prioridad, v.activo,
            v.total_perfiles::int AS total_perfiles
     FROM g5_crm.v_distribucion_segmento v
     JOIN g5_crm.segmento s ON s.codigo_segmento = v.codigo_segmento
     ORDER BY s.prioridad ASC`
  );
  return res.rows;
}

export async function getFidelizacionPerfil(client: PoolClient, idPerfil: number) {
  const saldoRes = await client.query(
    `SELECT v.id_perfil, v.id_huesped::text AS id_huesped, v.saldo_puntos::int AS saldo_puntos,
            h.nombres, h.apellidos
     FROM g5_crm.v_saldo_puntos v
     JOIN g1_reservas.huesped h ON h.id_huesped = v.id_huesped
     WHERE v.id_perfil = $1`,
    [idPerfil]
  );
  if (!saldoRes.rows[0]) {
    throw new NotFoundError('Perfil de fidelización no encontrado.');
  }

  const movRes = await client.query(
    `SELECT m.id_movimiento, m.id_estadia_origen::text AS id_estadia_origen, m.id_beneficio,
            b.nombre AS beneficio_nombre, m.id_regla_acum, m.tipo_movimiento, m.puntos,
            m.fecha::text AS fecha, m.estado
     FROM g5_crm.puntos_fidelizacion m
     LEFT JOIN g5_crm.beneficio b ON b.id_beneficio = m.id_beneficio
     WHERE m.id_perfil = $1
     ORDER BY m.fecha DESC, m.id_movimiento DESC
     LIMIT 50`,
    [idPerfil]
  );

  const benRes = await client.query(
    `SELECT id_beneficio, codigo_beneficio, nombre, descripcion, puntos_requeridos, activo
     FROM g5_crm.beneficio
     WHERE activo = TRUE
     ORDER BY puntos_requeridos ASC`
  );

  return {
    resumen: saldoRes.rows[0],
    movimientos: movRes.rows,
    beneficios: benRes.rows,
  };
}

export async function registrarMovimientoPuntos(
  client: PoolClient,
  input: {
    idPerfil: number;
    tipoMovimiento: 'ACUMULACION' | 'CANJE' | 'REVERSION' | 'AJUSTE';
    idEstadiaOrigen?: string | null;
    idBeneficio?: number | null;
    idReglaAcum?: number | null;
    puntos: number;
  }
) {
  let puntosFinal = input.puntos;

  if (input.tipoMovimiento === 'CANJE' && input.idBeneficio) {
    const benRes = await client.query<{ puntos_requeridos: number; activo: boolean }>(
      `SELECT puntos_requeridos, activo FROM g5_crm.beneficio WHERE id_beneficio = $1`,
      [input.idBeneficio]
    );
    const ben = benRes.rows[0];
    if (!ben) throw new NotFoundError('Beneficio no encontrado.');
    if (!ben.activo) throw new DomainRuleError('El beneficio seleccionado se encuentra deshabilitado.');
    puntosFinal = -Math.abs(ben.puntos_requeridos);
  }

  const res = await client.query(
    `INSERT INTO g5_crm.puntos_fidelizacion (
       id_perfil, id_estadia_origen, id_beneficio, id_regla_acum, tipo_movimiento, puntos, estado
     )
     VALUES ($1, $2::bigint, $3, $4, $5, $6, 'ACREDITADO')
     RETURNING id_movimiento, id_perfil, id_estadia_origen::text AS id_estadia_origen,
               id_beneficio, id_regla_acum, tipo_movimiento, puntos, fecha::text AS fecha, estado`,
    [
      input.idPerfil,
      input.idEstadiaOrigen ?? null,
      input.idBeneficio ?? null,
      input.idReglaAcum ?? null,
      input.tipoMovimiento,
      puntosFinal,
    ]
  );

  const saldoRes = await client.query<{ saldo_puntos: number }>(
    `SELECT saldo_puntos::int AS saldo_puntos FROM g5_crm.v_saldo_puntos WHERE id_perfil = $1`,
    [input.idPerfil]
  );

  return {
    movimiento: res.rows[0],
    saldoActual: saldoRes.rows[0]?.saldo_puntos ?? 0,
  };
}

export async function listReclamos(
  client: PoolClient,
  limit: number,
  offset: number
) {
  const countRes = await client.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM g5_crm.reclamo');
  const total = Number(countRes.rows[0]?.total ?? 0);

  const res = await client.query(
    `SELECT
       r.id_reclamo,
       r.codigo_seguimiento,
       r.id_perfil,
       (h.nombres || ' ' || h.apellidos) AS huesped_nombre,
       r.id_estadia::text AS id_estadia,
       r.id_area,
       ar.nombre AS area_nombre,
       r.id_incidencia_g2::text AS id_incidencia_g2,
       r.tipo,
       r.canal,
       r.descripcion,
       r.motivo,
       r.prioridad,
       r.sentimiento_ia,
       r.confianza::text AS confianza,
       r.es_critico,
       r.estado,
       r.fecha_registro::text AS fecha_registro,
       r.fecha_limite_sla::text AS fecha_limite_sla,
       r.fecha_cierre::text AS fecha_cierre,
       vt.horas_restantes::text AS horas_restantes,
       vt.situacion_sla,
       c.id_compensacion,
       c.estado AS compensacion_estado,
       c.monto::text AS compensacion_monto
     FROM g5_crm.reclamo r
     JOIN g5_crm.perfil_huesped p ON p.id_perfil = r.id_perfil
     JOIN g1_reservas.huesped h ON h.id_huesped = p.id_huesped
     LEFT JOIN g5_crm.area_responsable ar ON ar.id_area = r.id_area
     LEFT JOIN g5_crm.v_tablero_reclamos vt ON vt.codigo_seguimiento = r.codigo_seguimiento
     LEFT JOIN g5_crm.compensacion c ON c.id_reclamo = r.id_reclamo
     ORDER BY r.fecha_registro DESC, r.id_reclamo DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  const ids = res.rows.map((r) => r.id_reclamo);
  const segById = new Map<number, Array<Record<string, unknown>>>();

  if (ids.length > 0) {
    const segRes = await client.query<{
      id_seguimiento: number;
      id_reclamo: number;
      estado_anterior: string | null;
      estado_nuevo: string;
      fecha_hora: string;
      usuario: string;
      observacion: string | null;
    }>(
      `SELECT id_seguimiento, id_reclamo, estado_anterior, estado_nuevo,
              fecha_hora::text AS fecha_hora, usuario, observacion
       FROM g5_crm.seguimiento_reclamo
       WHERE id_reclamo = ANY($1::int[])
       ORDER BY fecha_hora ASC, id_seguimiento ASC`,
      [ids]
    );
    for (const s of segRes.rows) {
      const list = segById.get(s.id_reclamo) ?? [];
      list.push(s);
      segById.set(s.id_reclamo, list);
    }
  }

  return {
    rows: res.rows.map((r) => ({
      ...r,
      seguimiento: segById.get(r.id_reclamo as number) ?? [],
    })),
    total,
  };
}

export async function createReclamo(
  client: PoolClient,
  input: {
    idPerfil: number;
    idEstadia: string;
    idArea?: number | null;
    idIncidenciaG2?: string | null;
    tipo: 'RECLAMO' | 'SUGERENCIA';
    canal: 'AGENTE' | 'ASISTENTE';
    descripcion: string;
    motivo?: string | null;
    prioridad: 'NORMAL' | 'CRITICA';
    sentimientoIa?: 'POSITIVO' | 'NEUTRO' | 'NEGATIVO' | null;
    confianza?: number | null;
    esCritico?: boolean;
  }
) {
  const esCritico = input.esCritico ?? input.prioridad === 'CRITICA';
  const res = await client.query(
    `INSERT INTO g5_crm.reclamo (
       codigo_seguimiento, id_perfil, id_estadia, id_area, id_incidencia_g2,
       tipo, canal, descripcion, motivo, prioridad, sentimiento_ia, confianza, es_critico
     )
     VALUES (NULL, $1, $2::bigint, $3, $4::bigint, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id_reclamo, codigo_seguimiento, id_perfil, id_estadia::text AS id_estadia,
               id_area, id_incidencia_g2::text AS id_incidencia_g2, tipo, canal,
               descripcion, motivo, prioridad, sentimiento_ia, confianza::text AS confianza,
               es_critico, estado, fecha_registro::text AS fecha_registro,
               fecha_limite_sla::text AS fecha_limite_sla`,
    [
      input.idPerfil,
      input.idEstadia,
      input.idArea ?? null,
      input.idIncidenciaG2 ?? null,
      input.tipo,
      input.canal,
      input.descripcion,
      input.motivo ?? null,
      input.prioridad,
      input.sentimientoIa ?? null,
      input.confianza ?? null,
      esCritico,
    ]
  );
  return res.rows[0];
}

export async function avanzarReclamo(
  client: PoolClient,
  idReclamo: number,
  input: { estado: 'DERIVADO' | 'EN_ATENCION' | 'CERRADO'; idArea?: number | null; observacion?: string | null },
  usuarioApp: string
) {
  const currRes = await client.query<{ estado: string; id_area: number | null }>(
    `SELECT estado, id_area FROM g5_crm.reclamo WHERE id_reclamo = $1 FOR UPDATE`,
    [idReclamo]
  );
  const curr = currRes.rows[0];
  if (!curr) {
    throw new NotFoundError('Reclamo no encontrado.');
  }

  const order = ['REGISTRADO', 'DERIVADO', 'EN_ATENCION', 'CERRADO'];
  if (order.indexOf(input.estado) <= order.indexOf(curr.estado)) {
    throw new ConflictError(`Transición no permitida de ${curr.estado} a ${input.estado}.`);
  }

  const nextArea = input.idArea !== undefined ? input.idArea : curr.id_area;
  const updRes = await client.query(
    `UPDATE g5_crm.reclamo
     SET estado = $2,
         id_area = $3,
         fecha_cierre = CASE WHEN $2 = 'CERRADO' THEN CURRENT_TIMESTAMP ELSE fecha_cierre END
     WHERE id_reclamo = $1
     RETURNING id_reclamo, codigo_seguimiento, estado, id_area, fecha_cierre::text AS fecha_cierre`,
    [idReclamo, input.estado, nextArea]
  );

  // Actualizar observación en el registro creado por el trigger o anotar contexto si no cambió estado
  if (input.observacion) {
    await client.query(
      `UPDATE g5_crm.seguimiento_reclamo
       SET observacion = COALESCE(observacion, $2)
       WHERE id_seguimiento = (
         SELECT id_seguimiento FROM g5_crm.seguimiento_reclamo
         WHERE id_reclamo = $1 AND usuario = $3
         ORDER BY id_seguimiento DESC LIMIT 1
       )`,
      [idReclamo, input.observacion, usuarioApp.slice(0, 30)]
    );
  }

  return updRes.rows[0];
}

export async function solicitarCompensacion(
  client: PoolClient,
  idReclamo: number,
  input: { tipoCompensacion: string; monto: string }
) {
  const recRes = await client.query<{ tipo: string }>(
    `SELECT tipo FROM g5_crm.reclamo WHERE id_reclamo = $1 FOR UPDATE`,
    [idReclamo]
  );
  const rec = recRes.rows[0];
  if (!rec) throw new NotFoundError('Reclamo no encontrado.');
  if (rec.tipo !== 'RECLAMO') {
    throw new DomainRuleError('Solo los registros de tipo RECLAMO (no SUGERENCIA) admiten compensación.');
  }

  const res = await client.query(
    `INSERT INTO g5_crm.compensacion (id_reclamo, tipo_compensacion, monto, estado)
     VALUES ($1, $2, $3::numeric, 'SOLICITADA')
     RETURNING id_compensacion, id_reclamo, tipo_compensacion, monto::text AS monto,
               estado, fecha_solicitud::text AS fecha_solicitud`,
    [idReclamo, input.tipoCompensacion, input.monto]
  );
  return res.rows[0];
}

export async function decidirCompensacion(
  client: PoolClient,
  idCompensacion: number,
  input: { estado: 'APROBADA' | 'RECHAZADA' | 'NOTIFICADA' | 'APLICADA' | 'FUERA_DE_PLAZO'; motivoRechazo?: string | null },
  usuarioAprobador: string
) {
  const currRes = await client.query<{ estado: string; usuario_aprobador: string | null }>(
    `SELECT estado, usuario_aprobador FROM g5_crm.compensacion WHERE id_compensacion = $1 FOR UPDATE`,
    [idCompensacion]
  );
  const curr = currRes.rows[0];
  if (!curr) throw new NotFoundError('Compensación no encontrada.');

  const isDecision = input.estado === 'APROBADA' || input.estado === 'RECHAZADA';
  const isNotification = input.estado === 'NOTIFICADA' || input.estado === 'APLICADA' || input.estado === 'FUERA_DE_PLAZO';

  const res = await client.query(
    `UPDATE g5_crm.compensacion
     SET estado = $2,
         motivo_rechazo = CASE WHEN $2 = 'RECHAZADA' THEN $3 ELSE motivo_rechazo END,
         usuario_aprobador = COALESCE(usuario_aprobador, $4),
         fecha_resolucion = CASE WHEN $5::boolean THEN COALESCE(fecha_resolucion, CURRENT_TIMESTAMP) ELSE fecha_resolucion END,
         fecha_notificacion = CASE WHEN $6::boolean THEN COALESCE(fecha_notificacion, CURRENT_TIMESTAMP) ELSE fecha_notificacion END
     WHERE id_compensacion = $1
     RETURNING id_compensacion, id_reclamo, tipo_compensacion, monto::text AS monto,
               estado, motivo_rechazo, usuario_aprobador,
               fecha_resolucion::text AS fecha_resolucion,
               fecha_notificacion::text AS fecha_notificacion`,
    [
      idCompensacion,
      input.estado,
      input.motivoRechazo ?? null,
      usuarioAprobador.slice(0, 30),
      isDecision,
      isNotification,
    ]
  );
  return res.rows[0];
}

export async function listCampanas(client: PoolClient, limit: number, offset: number) {
  const countRes = await client.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM g5_crm.campana');
  const total = Number(countRes.rows[0]?.total ?? 0);

  const res = await client.query(
    `SELECT
       c.id_campana, c.codigo_campana, c.id_segmento, s.nombre AS segmento_nombre,
       c.nombre, c.canal, c.mensaje, c.fecha_inicio::text AS fecha_inicio,
       c.fecha_fin::text AS fecha_fin, c.estado,
       COUNT(e.id_perfil)::int AS total_envios,
       COUNT(e.id_perfil) FILTER (WHERE e.estado_envio = 'ENVIADO')::int AS envios_exitosos
     FROM g5_crm.campana c
     JOIN g5_crm.segmento s ON s.id_segmento = c.id_segmento
     LEFT JOIN g5_crm.envio_campana e ON e.id_campana = c.id_campana
     GROUP BY c.id_campana, s.nombre
     ORDER BY c.fecha_inicio DESC, c.id_campana DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return { rows: res.rows, total };
}

export async function createCampana(
  client: PoolClient,
  input: {
    codigoCampana?: string;
    idSegmento: number;
    nombre: string;
    canal: 'CORREO' | 'NOTIFICACION';
    mensaje: string;
    fechaInicio: string;
    fechaFin: string;
  }
) {
  let codigo = input.codigoCampana;
  if (!codigo) {
    const seqRes = await client.query<{ next_num: string }>(
      `SELECT COALESCE(MAX(id_campana), 0) + 1 AS next_num FROM g5_crm.campana`
    );
    const num = String(Number(seqRes.rows[0]?.next_num ?? 1)).padStart(3, '0');
    const year = input.fechaInicio.slice(0, 4);
    codigo = `CMP-${year}-${num}`;
  }

  const res = await client.query(
    `INSERT INTO g5_crm.campana (codigo_campana, id_segmento, nombre, canal, mensaje, fecha_inicio, fecha_fin, estado)
     VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, 'PROGRAMADA')
     RETURNING id_campana, codigo_campana, id_segmento, nombre, canal, mensaje,
               fecha_inicio::text AS fecha_inicio, fecha_fin::text AS fecha_fin, estado`,
    [codigo, input.idSegmento, input.nombre, input.canal, input.mensaje, input.fechaInicio, input.fechaFin]
  );
  return res.rows[0];
}

export async function cambiarEstadoCampana(
  client: PoolClient,
  idCampana: number,
  estado: 'ACTIVA' | 'CERRADA' | 'CANCELADA'
) {
  const res = await client.query(
    `UPDATE g5_crm.campana
     SET estado = $2
     WHERE id_campana = $1
     RETURNING id_campana, codigo_campana, nombre, estado`,
    [idCampana, estado]
  );
  if (!res.rows[0]) {
    throw new NotFoundError('Campaña no encontrada.');
  }
  return res.rows[0];
}

export async function listOpiniones(client: PoolClient, limit: number, offset: number) {
  const countRes = await client.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM g5_crm.opinion');
  const total = Number(countRes.rows[0]?.total ?? 0);

  const res = await client.query(
    `SELECT
       o.id_opinion, o.id_perfil, (h.nombres || ' ' || h.apellidos) AS huesped_nombre,
       o.id_estadia::text AS id_estadia, o.id_area, ar.nombre AS area_nombre,
       o.tipo_opinion, o.texto_seudonimizado, o.sentimiento_ia, o.confianza::text AS confianza,
       o.motivo, o.es_critica, o.estado_clasificacion, o.fecha_recepcion::text AS fecha_recepcion,
       r.calificacion, r.titulo, r.canal, r.respuesta_hotel, r.fecha_respuesta::text AS fecha_respuesta,
       r.usuario_respuesta,
       e.puntaje, e.recomendaria
     FROM g5_crm.opinion o
     JOIN g5_crm.perfil_huesped p ON p.id_perfil = o.id_perfil
     JOIN g1_reservas.huesped h ON h.id_huesped = p.id_huesped
     LEFT JOIN g5_crm.area_responsable ar ON ar.id_area = o.id_area
     LEFT JOIN g5_crm.resena r ON r.id_opinion = o.id_opinion
     LEFT JOIN g5_crm.encuesta e ON e.id_opinion = o.id_opinion
     ORDER BY o.fecha_recepcion DESC, o.id_opinion DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return { rows: res.rows, total };
}

export async function createOpinionConSubtipo(
  client: PoolClient,
  input: {
    idPerfil: number;
    idEstadia?: string | null;
    idArea?: number | null;
    tipoOpinion: 'RESENA' | 'ENCUESTA';
    textoSeudonimizado?: string | null;
    sentimientoIa?: 'POSITIVO' | 'NEUTRO' | 'NEGATIVO' | null;
    confianza?: number | null;
    motivo?: string | null;
    esCritica?: boolean;
    calificacion?: number;
    titulo?: string | null;
    canal?: string;
    puntaje?: number;
    recomendaria?: boolean | null;
  }
) {
  const opRes = await client.query<{ id_opinion: number }>(
    `INSERT INTO g5_crm.opinion (
       id_perfil, id_estadia, id_area, tipo_opinion, texto_seudonimizado,
       sentimiento_ia, confianza, motivo, es_critica, estado_clasificacion
     )
     VALUES ($1, $2::bigint, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $6 IS NOT NULL THEN 'CLASIFICADA' ELSE 'PENDIENTE' END)
     RETURNING id_opinion`,
    [
      input.idPerfil,
      input.idEstadia ?? null,
      input.idArea ?? null,
      input.tipoOpinion,
      input.textoSeudonimizado ?? null,
      input.sentimientoIa ?? null,
      input.confianza ?? null,
      input.motivo ?? null,
      input.esCritica ?? false,
    ]
  );

  const idOpinion = opRes.rows[0].id_opinion;

  if (input.tipoOpinion === 'RESENA') {
    await client.query(
      `INSERT INTO g5_crm.resena (id_opinion, tipo_opinion, calificacion, titulo, canal)
       VALUES ($1, 'RESENA', $2, $3, $4)`,
      [idOpinion, input.calificacion ?? 5, input.titulo ?? null, input.canal ?? 'Directo']
    );
  } else {
    await client.query(
      `INSERT INTO g5_crm.encuesta (id_opinion, tipo_opinion, puntaje, recomendaria)
       VALUES ($1, 'ENCUESTA', $2, $3)`,
      [idOpinion, input.puntaje ?? 8, input.recomendaria ?? null]
    );
  }

  return { id_opinion: idOpinion, tipo_opinion: input.tipoOpinion };
}

export async function responderResena(
  client: PoolClient,
  idOpinion: number,
  respuestaHotel: string,
  usuarioRespuesta: string
) {
  const res = await client.query(
    `UPDATE g5_crm.resena
     SET respuesta_hotel = $2,
         fecha_respuesta = CURRENT_TIMESTAMP,
         usuario_respuesta = $3
     WHERE id_opinion = $1
     RETURNING id_opinion, canal, respuesta_hotel, fecha_respuesta::text AS fecha_respuesta, usuario_respuesta`,
    [idOpinion, respuestaHotel, usuarioRespuesta.slice(0, 60)]
  );
  if (!res.rows[0]) {
    throw new NotFoundError('Reseña no encontrada para registrar respuesta.');
  }
  return res.rows[0];
}

export async function listSolicitudesHuesped(client: PoolClient, limit: number, offset: number) {
  const countRes = await client.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM g5_crm.solicitud_huesped');
  const total = Number(countRes.rows[0]?.total ?? 0);

  const res = await client.query(
    `SELECT
       s.id_solicitud_huesped, s.codigo, s.id_perfil,
       (h.nombres || ' ' || h.apellidos) AS huesped_nombre,
       s.id_estadia::text AS id_estadia, s.id_habitacion::text AS id_habitacion,
       s.numero_habitacion, s.tipo, s.area_destino, s.origen, s.descripcion,
       s.estado, s.notas_resolucion, s.fecha_creacion::text AS fecha_creacion,
       s.fecha_atencion::text AS fecha_atencion
     FROM g5_crm.solicitud_huesped s
     JOIN g5_crm.perfil_huesped p ON p.id_perfil = s.id_perfil
     JOIN g1_reservas.huesped h ON h.id_huesped = p.id_huesped
     ORDER BY s.fecha_creacion DESC, s.id_solicitud_huesped DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return { rows: res.rows, total };
}

export async function createSolicitudHuesped(
  client: PoolClient,
  input: {
    idPerfil: number;
    idEstadia?: string | null;
    idHabitacion?: string | null;
    numeroHabitacion?: string | null;
    tipo: string;
    areaDestino: string;
    origen: string;
    descripcion: string;
  }
) {
  const res = await client.query(
    `INSERT INTO g5_crm.solicitud_huesped (
       codigo, id_perfil, id_estadia, id_habitacion, numero_habitacion,
       tipo, area_destino, origen, descripcion, estado
     )
     VALUES ('', $1, $2::bigint, $3::bigint, $4, $5, $6, $7, $8, 'REGISTRADA')
     RETURNING id_solicitud_huesped, codigo, id_perfil, id_estadia::text AS id_estadia,
               id_habitacion::text AS id_habitacion, numero_habitacion,
               tipo, area_destino, origen, descripcion, estado, fecha_creacion::text AS fecha_creacion`,
    [
      input.idPerfil,
      input.idEstadia ?? null,
      input.idHabitacion ?? null,
      input.numeroHabitacion ?? null,
      input.tipo,
      input.areaDestino,
      input.origen,
      input.descripcion,
    ]
  );
  return res.rows[0];
}

export async function updateSolicitudHuespedEstado(
  client: PoolClient,
  idSolicitud: number,
  estado: 'REGISTRADA' | 'DERIVADA' | 'EN_ATENCION' | 'ATENDIDA' | 'CANCELADA',
  notasResolucion?: string | null
) {
  const res = await client.query(
    `UPDATE g5_crm.solicitud_huesped
     SET estado = $2,
         notas_resolucion = COALESCE($3, notas_resolucion),
         fecha_atencion = CASE WHEN $2 IN ('ATENDIDA', 'CANCELADA') THEN COALESCE(fecha_atencion, CURRENT_TIMESTAMP) ELSE fecha_atencion END
     WHERE id_solicitud_huesped = $1
     RETURNING id_solicitud_huesped, codigo, estado, notas_resolucion, fecha_atencion::text AS fecha_atencion`,
    [idSolicitud, estado, notasResolucion ?? null]
  );
  if (!res.rows[0]) {
    throw new NotFoundError('Solicitud de huésped no encontrada.');
  }
  return res.rows[0];
}
