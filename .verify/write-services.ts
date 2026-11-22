process.env.DATABASE_URL = 'postgres://postgres@127.0.0.1:55432/sgh';
process.env.DATABASE_SSL = 'false';
const { getDatabasePool } = await import('../server/config/database.ts');
const pool = getDatabasePool();
const q = async (sql: string, p: any[] = []) => (await pool.query(sql, p)).rows;
const one = async (sql: string, p: any[] = []) => (await q(sql, p))[0];

const s1 = await import('../server/modules/m1/service.ts');
const s2 = await import('../server/modules/m2/service.ts');
const s3 = await import('../server/modules/m3/service.ts');
const s4 = await import('../server/modules/m4/service.ts');
const s5 = await import('../server/modules/m5/service.ts');

const u4 = await one(`select id_usuario from g4_finanzas.usuario order by 1 limit 1`);
const pers = await one(`select id_personal from g2_housekeeping.personal_limpieza order by 1 limit 1`);
const tec = await one(`select id_personal from g2_housekeeping.tecnico_mantenimiento order by 1 limit 1`);
const sup = await one(`select id_personal from g2_housekeeping.supervisor order by 1 limit 1`);
const ctx: any = {
  authUserId: '00000000-0000-0000-0000-000000000001',
  usuarioId: '00000000-0000-0000-0000-000000000001',
  codigoUsuario: 'verif',
  nombre: 'Verificador',
  departamento: 'TI',
  roles: ['ADMINISTRADOR'],
  permisos: ['*'],
  canViewFullPII: true,
  idUsuarioG4: u4?.id_usuario ?? 1,
  idPersonalG2: String(sup?.id_personal ?? pers?.id_personal),
};

let ok = 0;
let bad = 0;
const v: Record<string, any> = {};
async function step(name: string, fn: () => Promise<any>) {
  try {
    const r = await fn();
    console.log(`OK   ${name}`);
    ok++;
    return r;
  } catch (e: any) {
    console.log(`FAIL ${name}: ${String(e.message).split('\n')[0].slice(0, 220)}`);
    bad++;
    return undefined;
  }
}

// ---------- datos base
const room = await one(`select h.id_habitacion::text id, h.id_tipo_habitacion::text tipo from g1_reservas.habitacion h
  join g2_housekeeping.v_estado_actual e on e.id_habitacion=h.id_habitacion and e.id_estado='DIS'
  where not exists (select 1 from g1_reservas.detalle_reserva d join g1_reservas.reserva r using(id_reserva) where d.id_habitacion=h.id_habitacion and r.fecha_salida>'2031-01-01' and r.estado not in ('CANCELADA','NO_SHOW','FINALIZADA'))
  order by h.id_habitacion offset 0 limit 1`);
const tarifa = await one(`select id_tarifa::text id, id_canal_reserva::text canal from g1_reservas.tarifa where estado='ACTIVA' and id_tipo_habitacion=$1 limit 1`, [room.tipo]);
const guest = await one(`select id_huesped::text id from g1_reservas.huesped order by id_huesped offset 50 limit 1`);
console.log('base:', { room: room.id, tarifa: tarifa?.id, guest: guest.id, u4: ctx.idUsuarioG4, pers: pers?.id_personal, tec: tec?.id_personal });

// ---------- M1
const doc = String(Math.floor(10000000 + Math.random() * 89999999));
const guestBody = (apellidos: string, tel: string) => ({
  tipo_documento: 'DNI', numero_documento: doc, nombres: 'Prueba', apellidos, telefono: tel, correo: null,
  nacionalidad: 'Perú', empresa: null, consentimiento_iso27701: true, fecha_consentimiento: '2026-11-22', marketing_opt_in: false, notas: null,
});
const hu = await step('m1 createHuesped', () => s1.createHuespedService(ctx, guestBody('Verificacion', '999') as any));
if (hu) await step('m1 updateHuesped', () => s1.updateHuespedService(ctx, hu.id_huesped, guestBody('Editada', '111') as any));
const mkRes = (a: string, b: string) =>
  s1.createReservaService(ctx, {
    id_huesped: guest.id, id_tarifa: tarifa.id, id_canal_reserva: tarifa.canal, fecha_ingreso: a, fecha_salida: b,
    cantidad_huespedes: 2, habitaciones: [{ id_habitacion: room.id, cantidad_huespedes: 2 }], observaciones: null,
  } as any);
const r1 = await step('m1 createReserva', () => mkRes('2031-03-01', '2031-03-03'));
await step('m1 createReserva (cruce => 409)', async () => {
  try { await mkRes('2031-03-02', '2031-03-04'); } catch (e: any) { if (e.statusCode === 409) return; throw e; }
  throw new Error('no detecto el cruce');
});
if (r1) await step('m1 cancelar', () => s1.updateReservaEstadoService(ctx, r1.id_reserva, 'CANCELADA', 'Prueba de cancelacion'));
const r2 = await step('m1 createReserva #2', () => mkRes('2031-04-01', '2031-04-03'));
if (r2) await step('m1 no-show', () => s1.updateReservaEstadoService(ctx, r2.id_reserva, 'NO_SHOW', 'Prueba no show'));
const r3 = await step('m1 createReserva #3', () => mkRes('2031-05-01', '2031-05-03'));
let est: any;
if (r3) {
  const det = await one(`select id_detalle_reserva::text id from g1_reservas.detalle_reserva where id_reserva=$1::bigint`, [r3.id_reserva]);
  est = await step('m1 check-in', () => s1.performCheckInService(ctx, r3.id_reserva, { id_detalle_reserva: det.id, acompanantes: [] } as any));
  v.cuenta = (await one(`select id_cuenta from g4_finanzas.cuenta where id_reserva=$1::bigint`, [r3.id_reserva]))?.id_cuenta;
  if (est) await step('m1 check-out', () => s1.performCheckOutService(ctx, est.id_estadia, { autorizar_saldo_pendiente: true, motivo_autorizacion: 'Prueba' } as any));
}
await step('m1 createListaEspera', () =>
  s1.createListaEsperaService(ctx, { id_huesped: guest.id, id_tipo_habitacion: room.tipo, fecha_ingreso: '2031-06-01', fecha_salida: '2031-06-03', prioridad: 0 } as any));

// ---------- M2
const xroom = await one(`select h.id_habitacion::text id from g1_reservas.habitacion h join g2_housekeeping.v_estado_actual e using(id_habitacion) where e.id_estado='DIS' and h.id_habitacion<>$1::bigint and not exists (select 1 from g2_housekeeping.orden_limpieza o where o.id_habitacion=h.id_habitacion and o.estado not in ('Cerrada','Anulada')) limit 1`, [room.id]);
await step('m2 cambiarEstado DIS->FSV', () => s2.cambiarEstadoHabitacionService(ctx, xroom.id, { id_estado_nuevo: 'FSV', origen: 'Manual', motivo: 'Prueba' }));
await step('m2 cambiarEstado FSV->SUC', () => s2.cambiarEstadoHabitacionService(ctx, xroom.id, { id_estado_nuevo: 'SUC', origen: 'Manual', motivo: 'Prueba' }));
const roomClean = xroom;
const ol = await step('m2 createOrdenLimpieza', () =>
  s2.createOrdenLimpiezaService(ctx, { id_habitacion: roomClean.id, id_turno: 'M', tipo_limpieza: 'Salida', origen: 'Manual', prioridad: 'Alta', observaciones: 'prueba' } as any));
if (ol) {
  await step('m2 asignar', () => s2.asignarOrdenLimpiezaService(ctx, ol.numero_orden, { id_personal: String(pers.id_personal), origen_asignacion: 'Manual' } as any));
  await step('m2 iniciar', () => s2.avanzarOrdenLimpiezaService(ctx, ol.numero_orden, 'iniciar'));
  await step('m2 finalizar', () => s2.avanzarOrdenLimpiezaService(ctx, ol.numero_orden, 'finalizar'));
  await step('m2 inspeccion', () =>
    s2.registrarInspeccionService(ctx, { numero_orden: ol.numero_orden, id_supervisor: String(sup.id_personal), resultado: 'Conforme', lista_verificacion: { cama: true, bano: true } } as any));
}
const inc = await step('m2 createIncidencia', () =>
  s2.createIncidenciaService(ctx, { id_habitacion: room.id, descripcion: 'Fuga en bano (prueba)', criticidad: 'Alta', origen: 'Personal' } as any));
const cc = await one(`select id_centro_costo::text id from g4_finanzas.centro_costo order by 1 limit 1`);
let ot: any;
if (inc) {
  ot = await step('m2 createOrdenTrabajo', () =>
    s2.createOrdenTrabajoService(ctx, { tipo_ot: 'Correctiva', numero_incidencia: inc.numero_incidencia, id_tecnico: String(tec.id_personal), id_centro_costo: cc.id, descripcion_tarea: 'Reparar fuga (prueba)', prioridad: 'Media' } as any));
}
if (ot) {
  await step('m2 OT en espera', () => s2.ponerOtEnEsperaService(ctx, ot.numero_ot, 'Falta repuesto'));
  await step('m2 cerrarOT', () => s2.cerrarOrdenTrabajoService(ctx, ot.numero_ot, { trabajo_realizado: 'Cambio de tuberia', horas_trabajadas: 2.5, costo_total: '120.00' }));
}
const ins = await one(`select id_insumo::text id from g2_housekeeping.insumo order by 1 limit 1`);
await step('m2 movimientoInsumo', () =>
  s2.registrarMovimientoInsumoService(ctx, { id_insumo: ins.id, id_personal: String(pers.id_personal), tipo_movimiento: 'Salida', cantidad: 1, signo: '-', costo_unitario: '0.00', motivo: 'Prueba' } as any));

// ---------- M3
const mesa = await one(`select m.id_mesa id, m.id_punto_venta pv from g3_servicios.mesa m where m.estado='activa' and m.id_punto_venta='PV-REST' and not exists (select 1 from g3_servicios.comanda c where c.id_mesa=m.id_mesa and c.estado in ('pendiente','en preparación','lista')) limit 1`);
const item = await one(`select id_item_catalogo id from g3_servicios.item_catalogo where id_punto_venta='PV-REST' and estado='activo' and tipo_item<>'servicio' limit 1`);
const cmd = await step('m3 createComanda', () =>
  s3.createComandaService(ctx, { id_punto_venta: mesa.pv, modalidad: 'mesa', id_mesa: mesa.id, items: [{ id_item_catalogo: item.id, cantidad: 2 }] } as any));
if (cmd) {
  await step('m3 iniciar-preparacion', () => s3.cambiarEstadoComandaService(ctx, cmd.numero_comanda, 'en preparación'));
  await step('m3 marcar-lista', () => s3.cambiarEstadoComandaService(ctx, cmd.numero_comanda, 'lista'));
  const ent = await step('m3 entregar', () => s3.entregarComandaYCrearConsumoService(ctx, cmd.numero_comanda, { forma_cobro: 'pago directo' } as any));
  if (ent) await step('m3 confirmarConsumo', () => s3.confirmarConsumoService(ctx, ent.numero_consumo));
}
const con = await step('m3 createConsumo', () =>
  s3.createConsumoService(ctx, { id_punto_venta: mesa.pv, forma_cobro: 'pago directo', items: [{ id_item_catalogo: item.id, cantidad: 1 }] } as any));
if (con) await step('m3 descartarConsumo', () => s3.descartarOAnularConsumoService(ctx, con.numero_consumo, 'descartar', 'Prueba descartar'));
const art = await one(`select id_articulo id from g3_servicios.articulo_almacen order by 1 limit 1`);
await step('m3 movimientoInventario', () =>
  s3.registrarMovimientoInventarioService(ctx, { id_articulo: art.id, tipo_movimiento: 'Entrada', cantidad: 5, signo: 'entrada', motivo: 'Prueba entrada', id_origen: 'MANUAL', modulo_origen: 'Almacén', costo_unitario: '2.50' } as any));
const prv = await one(`select id_proveedor id from g3_servicios.proveedor where estado='activo' order by 1 limit 1`);
const oc = await step('m3 createOrdenCompra', () =>
  s3.createOrdenCompraService(ctx, { id_proveedor: prv.id, fecha_entrega_esperada: '2031-01-10', items: [{ id_articulo: art.id, cantidad_solicitada: 10, precio_referencia_capturado: '3.00' }] } as any));
if (oc) {
  await step('m3 aprobar OC', () => s3.decidirOrdenCompraService({ ...ctx, authUserId: '00000000-0000-0000-0000-000000000002', codigoUsuario: 'aprobador' }, oc.numero_orden, 'aprobada', 'Aprobada prueba'));
  await step('m3 enviar OC', () => s3.enviarOrdenCompraService(ctx, oc.numero_orden, 'correo'));
  const dets = await q(`select id_detalle_orden id from g3_servicios.detalle_orden_compra where numero_orden=$1`, [oc.numero_orden]);
  await step('m3 recibir OC', () =>
    s3.recibirOrdenCompraService(ctx, oc.numero_orden, { numero_guia_factura: 'G-1', items: dets.map((d: any) => ({ id_detalle_orden: d.id, cantidad_aceptada: 10, cantidad_rechazada: 0, costo_unitario: '3.00' })) } as any));
}
const itm = await one(`select id_item_catalogo id from g3_servicios.item_catalogo where estado='activo' limit 1`);
await step('m3 actualizarPrecio', () => s3.actualizarPrecioItemService(ctx, itm.id, '77.70', 'Prueba de precio'));

// ---------- M4
const turno = await step('m4 abrirTurno', () => s4.abrirTurnoCajaService(ctx, { turno: 'MANANA', saldo_inicial: '500.00' }));
if (v.cuenta) {
  await step('m4 consumoCuenta', () => s4.agregarConsumoCuentaService(ctx, v.cuenta, { concepto: 'Lavanderia', importe: '40.00', area: 'Servicios' } as any));
  if (turno) await step('m4 cobro', () => s4.registrarCobroService(ctx, { id_cuenta: v.cuenta, id_turno_caja: turno.id_turno_caja, monto: '10.00', medio_pago: 'EFECTIVO' } as any));
  await step('m4 emitirBoleta', () =>
    s4.emitirComprobanteService(ctx, { id_cuenta: v.cuenta, tipo: 'BOLETA', serie: 'B001', tipo_documento_cliente: 'DNI', numero_documento_cliente: '12345678', razon_social_cliente: 'Cliente Prueba', operacion_gravada: '25.42' } as any));
}
if (turno) await step('m4 cerrarTurno', () => s4.cerrarTurnoCajaService(ctx, turno.id_turno_caja, { saldo_final: '510.00', justificacion_diferencia: 'Prueba' } as any));
const g = await step('m4 createGasto', () =>
  s4.createGastoService(ctx, { id_centro_costo: Number(cc.id), categoria: 'Servicios', proveedor: 'Luz del Sur', concepto: 'Consumo (prueba)', monto: '100.00', comprobante_sustento: 'REC-1' } as any));
if (g) await step('m4 aprobarGasto', () => s4.decidirGastoService(ctx, g.id_gasto, 'APROBADO'));

// ---------- M5
const pf = await one(`select p.id_perfil, p.id_huesped::text hu from g5_crm.perfil_huesped p where exists (select 1 from g1_reservas.estadia e join g1_reservas.reserva r using(id_reserva) where r.id_huesped=p.id_huesped) order by 1 limit 1`);
const es = await one(`select e.id_estadia::text id from g1_reservas.estadia e join g1_reservas.reserva r using(id_reserva) where r.id_huesped=$1::bigint limit 1`, [pf.hu]);
const rec = await step('m5 createReclamo', () =>
  s5.createReclamoService(ctx, { idPerfil: pf.id_perfil, idEstadia: es.id, tipo: 'RECLAMO', canal: 'AGENTE', descripcion: 'Ruido excesivo (prueba)', prioridad: 'NORMAL' } as any));
if (rec) {
  await step('m5 avanzarReclamo DERIVADO', () => s5.avanzarReclamoService(ctx, rec.id_reclamo, { estado: 'DERIVADO', observacion: 'prueba' } as any));
  await step('m5 avanzarReclamo EN_ATENCION', () => s5.avanzarReclamoService(ctx, rec.id_reclamo, { estado: 'EN_ATENCION' } as any));
  const comp = await step('m5 solicitarCompensacion', () => s5.solicitarCompensacionService(ctx, rec.id_reclamo, { tipoCompensacion: 'DESCUENTO', monto: '20.00' }));
  if (comp) await step('m5 decidirCompensacion', () => s5.decidirCompensacionService(ctx, comp.id_compensacion, { estado: 'APROBADA' } as any));
  await step('m5 avanzarReclamo CERRADO', () => s5.avanzarReclamoService(ctx, rec.id_reclamo, { estado: 'CERRADO', observacion: 'ok' } as any));
}
const seg = await one(`select id_segmento from g5_crm.segmento order by 1 limit 1`);
const cp = await step('m5 createCampana', () =>
  s5.createCampanaService(ctx, { idSegmento: seg.id_segmento, nombre: 'Campana prueba', canal: 'CORREO', mensaje: 'Oferta prueba', fechaInicio: '2026-11-22', fechaFin: '2026-12-22' } as any));
if (cp) await step('m5 estadoCampana', () => s5.cambiarEstadoCampanaService(ctx, cp.id_campana, 'ACTIVA'));
await step('m5 createOpinion ENCUESTA', () =>
  s5.createOpinionService(ctx, { idPerfil: pf.id_perfil, tipoOpinion: 'ENCUESTA', puntaje: 9, textoSeudonimizado: 'Excelente' } as any));
const res = await step('m5 createOpinion RESENA', () =>
  s5.createOpinionService(ctx, { idPerfil: pf.id_perfil, tipoOpinion: 'RESENA', calificacion: 5, canal: 'Google', titulo: 'Muy bien' } as any));
if (res) await step('m5 responderOpinion', () => s5.responderOpinionService(ctx, res.id_opinion, 'Gracias por su visita'));
const sol = await step('m5 createSolicitud', () =>
  s5.createSolicitudService(ctx, { idPerfil: pf.id_perfil, idEstadia: es.id, tipo: 'Late Check-out', areaDestino: 'Recepción', origen: 'Recepción/CRM', descripcion: 'Hasta las 14:00' } as any));
if (sol) await step('m5 estadoSolicitud', () => s5.updateSolicitudEstadoService(ctx, sol.id_solicitud_huesped, 'ATENDIDA'));
const ben = await one(`select id_beneficio from g5_crm.beneficio where activo order by puntos_requeridos limit 1`);
const pf2 = await one(`select id_perfil from g5_crm.perfil_huesped where id_huesped=$1::bigint`, [guest.id]);
await step('m5 puntos ACUMULACION', async () => {
  const rg = await one(`select id_regla_acum as id_regla from g5_crm.regla_acumulacion where activa limit 1`);
  return s5.registrarMovimientoPuntosService(ctx, { idPerfil: pf2.id_perfil, tipoMovimiento: 'ACUMULACION', idEstadiaOrigen: est.id_estadia, idReglaAcum: rg.id_regla, puntos: 500 } as any);
});
await step('m5 puntos CANJE', () => s5.registrarMovimientoPuntosService(ctx, { idPerfil: pf2.id_perfil, tipoMovimiento: 'CANJE', idBeneficio: ben.id_beneficio, puntos: -1 } as any));
await step('m5 preferencia', () => s5.addPreferenciaService(ctx, pf.id_perfil, { categoria: 'HABITACION', descripcion: 'Piso alto', origen: 'DECLARADA', vigente: true }));

console.log(`\n${ok} OK · ${bad} FAIL`);
await pool.end();
