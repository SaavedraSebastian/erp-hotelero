/**
 * Acciones de ESCRITURA del ERP: cada operación de la interfaz se envía a la API /api/v1
 * (PostgreSQL en Supabase) y, si el servidor la acepta, se vuelven a leer los datos afectados.
 *
 * Principios:
 *  - Nada se guarda "solo en memoria": si no hay endpoint, la acción se rechaza con un aviso claro.
 *  - Los errores del servidor (reglas de negocio, validaciones, permisos) se muestran tal cual.
 *  - No se inventan datos: lo que el servidor exige y la interfaz no captura se informa al usuario.
 *
 * Cada acción devuelve una promesa con { ok, message } (o un objeto { ok:false } inmediato).
 */
import { TODAY } from '../data/empty-state.js';
import { apiV1Request } from './api-client.js';
import { titleCase } from './erp-mappers.js';

// ---------------------------------------------------------------------------------------------
// Utilidades puras (exportadas para pruebas)
// ---------------------------------------------------------------------------------------------

export const isNumericId = (v) => /^[1-9]\d*$/.test(String(v ?? ''));
export const money = (n) => Number(n).toFixed(2);

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Divide "Nombre(s) Apellido(s)" en nombres y apellidos (convención peruana: 2 apellidos). */
export function splitFullName(fullName) {
  const tokens = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return { nombres: tokens[0] ?? '', apellidos: '' };
  if (tokens.length === 2) return { nombres: tokens[0], apellidos: tokens[1] };
  if (tokens.length === 3) return { nombres: tokens[0], apellidos: tokens.slice(1).join(' ') };
  return { nombres: tokens.slice(0, 2).join(' '), apellidos: tokens.slice(2).join(' ') };
}

export function normalizeDocType(value) {
  const t = String(value ?? '').trim().toUpperCase();
  if (t.startsWith('PAS')) return 'PAS';
  if (t === 'CE' || t.startsWith('CAR')) return 'CE';
  if (t === 'RUC') return 'RUC';
  return 'DNI';
}

const HK_CODE = {
  Sucia: 'SUC',
  'En limpieza': 'ELI',
  Limpia: 'LIM',
  Inspeccionada: 'DIS',
  Disponible: 'DIS',
  'Fuera de servicio': 'FSV',
  Ocupada: 'OCU',
};

export function cashShiftCode(hour = new Date().getHours()) {
  return hour < 14 ? 'MANANA' : hour < 22 ? 'TARDE' : 'NOCHE';
}
export function cleaningShiftCode(hour = new Date().getHours()) {
  return hour < 14 ? 'M' : hour < 22 ? 'T' : 'N';
}

export function paymentMethodCode(label) {
  const t = String(label ?? '').toLowerCase();
  if (t.includes('tarjeta')) return 'TARJETA';
  if (t.includes('efectivo')) return 'EFECTIVO';
  if (t.includes('transfer')) return 'TRANSFERENCIA';
  if (/yape|plin|billetera|digital/.test(t)) return 'BILLETERA_DIGITAL';
  return null;
}

export function describeError(e) {
  if (e?.status === 429) return 'Demasiadas solicitudes seguidas. Espera unos segundos e inténtalo de nuevo.';
  const base = e?.message || 'Error desconocido';
  const fe = e?.fieldErrors;
  if (fe && typeof fe === 'object') {
    const parts = Array.isArray(fe)
      ? fe.map((x) => (typeof x === 'string' ? x : x?.message ?? JSON.stringify(x)))
      : Object.entries(fe).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
    if (parts.length > 0) return `${base} (${parts.join(' · ')})`;
  }
  return base;
}

const sameName = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// ---------------------------------------------------------------------------------------------
// Fábrica de acciones
// ---------------------------------------------------------------------------------------------

/**
 * @param {{ getState: () => any, refresh: (keys: string[]) => Promise<any>, toast: (t: object) => void }} ctx
 */
export function createWriteActions(ctx) {
  const { getState, refresh, toast } = ctx;

  const post = (path, body = {}) => apiV1Request(path, { method: 'POST', body });
  const put = (path, body = {}) => apiV1Request(path, { method: 'PUT', body });
  const patch = (path, body = {}) => apiV1Request(path, { method: 'PATCH', body });

  const fail = (title, detail) => {
    toast({ title, detail, type: 'warning' });
    return { ok: false, message: detail };
  };
  const unsupported = (action, reason) =>
    fail('Aún no se guarda en la base de datos', `${action}: ${reason} No se realizó ningún cambio.`);

  /** Ejecuta la escritura y vuelve a leer solo los recursos afectados. */
  async function run(title, request, { refreshKeys = [], detail } = {}) {
    let data;
    try {
      data = await request();
    } catch (e) {
      const message = describeError(e);
      toast({ title: `No se pudo completar: ${title}`, detail: message, type: 'error' });
      return { ok: false, message, status: e?.status ?? null };
    }
    try {
      await refresh([...refreshKeys, 'resumen', 'bitacoras']);
    } catch {
      // la escritura ya se confirmó; si falla la relectura, el usuario puede recargar
    }
    toast({ title, detail, type: 'success' });
    return { ok: true, data: data?.data ?? data, message: title };
  }

  const s = () => getState() ?? {};
  const guestById = (id) => (s().guests ?? []).find((g) => g.id === id);
  const roomById = (id) => (s().rooms ?? []).find((r) => r.id === id);
  const reservationById = (id) => (s().reservations ?? []).find((r) => r.id === id);
  const openShift = () => (s().cashShifts ?? []).find((c) => c.status === 'Abierta');
  const activeStayOf = (guestId) =>
    (s().reservations ?? []).find((r) => r.guestId === guestId && r.status === 'Check-in' && r.stayId);

  /** Alta o edición de un ítem del catálogo (producto o servicio). El precio se cambia con su endpoint propio (deja historial). */
  async function saveCatalogItem(p, label) {
    const nombre = String(p.name ?? '').trim();
    const price = Number(p.price);
    if (nombre.length < 3) return fail('Nombre requerido', 'El nombre debe tener al menos 3 caracteres.');
    if (!(price >= 0)) return fail('Precio inválido', 'El precio debe ser mayor o igual a cero.');
    const duration = p.durationMinutes ? Number(p.durationMinutes) : null;
    const existing = p.id ? [...(s().products ?? []), ...(s().services ?? [])].find((x) => x.id === p.id) : null;

    if (existing) {
      return run(
        `${label} actualizado`,
        async () => {
          const res = await put(`/m3/catalogo/${encodeURIComponent(existing.id)}`, {
            nombre,
            id_categoria: p.categoryId || undefined,
            id_articulo_descuento: p.articleId || null,
            ...(label === 'Servicio' ? { duracion_estimada: duration } : {}),
          });
          if (Math.abs(price - existing.price) > 0.0001) {
            await post(`/m3/catalogo/${encodeURIComponent(existing.id)}/precio`, {
              precio_nuevo: money(price),
              motivo: `Cambio de precio desde el catálogo (de S/ ${money(existing.price)} a S/ ${money(price)})`,
            });
          }
          return res;
        },
        { refreshKeys: ['catalogo'], detail: nombre }
      );
    }

    if (!p.posId || !p.categoryId) return fail('Datos incompletos', 'Selecciona el punto de venta y la categoría.');
    if (!['plato', 'bebida', 'producto', 'servicio'].includes(p.itemType)) return fail('Tipo no válido', 'Selecciona plato, bebida o producto.');
    return run(
      `${label} creado`,
      () =>
        post('/m3/catalogo', {
          id_punto_venta: p.posId,
          id_categoria: p.categoryId,
          nombre,
          tipo_item: p.itemType,
          precio_vigente: money(price),
          id_articulo_descuento: p.articleId || null,
          duracion_estimada: duration,
        }),
      { refreshKeys: ['catalogo'], detail: `${nombre} · S/ ${money(price)}` }
    );
  }

  const actions = {
    // =========================================================================================
    // M1 · Reservas y Recepción
    // =========================================================================================
    async upsertGuest(g) {
      const isEdit = Boolean(g.id);
      if (isEdit && [g.documentNumber, g.email, g.phone].some((v) => /[*•]/.test(String(v ?? '')))) {
        return fail(
          'Edición bloqueada por privacidad',
          'Los datos de este huésped aparecen enmascarados; guardarlos sobrescribiría el original. Necesitas un rol con acceso a datos completos.'
        );
      }
      const keepSplit =
        g.firstNames && g.lastNames && `${g.firstNames} ${g.lastNames}`.trim() === String(g.fullName).trim();
      const { nombres, apellidos } = keepSplit
        ? { nombres: g.firstNames, apellidos: g.lastNames }
        : splitFullName(g.fullName);
      if (!nombres || !apellidos) return fail('Datos incompletos', 'Ingresa nombres y apellidos del huésped.');

      const consent = Boolean(g.privacyConsentISO27701);
      const body = {
        tipo_documento: normalizeDocType(g.documentType),
        numero_documento: String(g.documentNumber ?? '').trim(),
        nombres,
        apellidos,
        telefono: g.phone || null,
        correo: g.email || null,
        nacionalidad: g.nationality || null,
        empresa: g.company || null,
        consentimiento_iso27701: consent,
        fecha_consentimiento: consent ? g.consentDate || TODAY : null,
        marketing_opt_in: Boolean(g.marketingOptIn),
        notas: g.notes || null,
      };
      return run(
        isEdit ? 'Huésped actualizado' : 'Huésped registrado',
        () => (isEdit ? put(`/m1/huespedes/${g.id}`, body) : post('/m1/huespedes', body)),
        { refreshKeys: ['huespedes', 'perfiles'], detail: `${nombres} ${apellidos}` }
      );
    },

    async createReservation(input) {
      const room = roomById(input.roomId);
      const guest = guestById(input.guestId);
      if (!room || !guest) return fail('Datos incompletos', 'Selecciona un huésped y una habitación válidos.');
      if (!input.checkInDate || !input.checkOutDate || input.checkOutDate <= input.checkInDate) {
        return fail('Fechas inválidas', 'La salida debe ser posterior al ingreso.');
      }

      const plans = (s().ratePlans ?? []).filter(
        (p) => p.active && p.roomTypeId === room.typeId && sameName(p.channel, input.channel)
      );
      const plan =
        plans.find((p) => p.startDate <= input.checkInDate && p.endDate >= input.checkInDate) ?? plans[0];
      if (!plan) {
        return fail(
          'Sin tarifa vigente',
          `No existe una tarifa activa para ${room.type} en el canal "${input.channel}". Registra la tarifa en la base de datos.`
        );
      }

      const guests = Math.max(1, Number(input.adults || 0) + Number(input.children || 0));
      const body = {
        id_huesped: guest.id,
        id_tarifa: plan.id,
        id_canal_reserva: plan.channelId,
        fecha_ingreso: input.checkInDate,
        fecha_salida: input.checkOutDate,
        cantidad_huespedes: guests,
        habitaciones: [{ id_habitacion: room.id, cantidad_huespedes: Math.min(10, guests) }],
        observaciones: input.specialRequests || null,
      };

      const result = await run('Reserva creada', () => post('/m1/reservas', body), {
        refreshKeys: ['reservas', 'habitaciones', 'listaEspera', 'tarifaDinamica'],
        detail: `${guest.fullName} · Hab. ${room.number} · tarifa ${plan.name} (S/ ${plan.price.toFixed(2)} por noche)`,
      });

      // Conflicto de fechas: se deriva a lista de espera, como exige el flujo de sobreventa.
      if (!result.ok && result.status === 409) {
        const wl = await run(
          'Conflicto de fechas: derivado a lista de espera',
          () =>
            post('/m1/lista-espera', {
              id_huesped: guest.id,
              id_tipo_habitacion: room.typeId,
              fecha_ingreso: input.checkInDate,
              fecha_salida: input.checkOutDate,
              prioridad: 0,
            }),
          { refreshKeys: ['listaEspera'], detail: result.message }
        );
        return { ...wl, message: `Conflicto detectado: ${result.message}` };
      }
      return result;
    },

    async updateReservationStatus(resId, status, note) {
      const path = status === 'Cancelada' ? 'cancelar' : status === 'No-Show' ? 'no-show' : null;
      if (!path) return unsupported(`Cambiar la reserva a "${status}"`, 'solo se admite cancelar o marcar no-show.');
      const motivo = note && note.trim().length >= 5 ? note.trim() : `${status} desde Recepción`;
      return run(`Reserva ${status === 'Cancelada' ? 'cancelada' : 'marcada como No-Show'}`, () =>
        post(`/m1/reservas/${resId}/${path}`, { motivo }), { refreshKeys: ['reservas', 'habitaciones'] });
    },

    async performCheckIn(resId, overrideRoomId) {
      const res = reservationById(resId);
      if (!res) return fail('Reserva no encontrada', 'Actualiza la página e inténtalo de nuevo.');
      const detail = res.details?.find((d) => d.roomId === res.roomId) ?? res.details?.[0];
      if (!detail) return fail('Reserva sin habitación', 'La reserva no tiene una habitación asignada.');
      const body = { id_detalle_reserva: detail.id, acompanantes: [] };
      if (overrideRoomId && overrideRoomId !== detail.roomId) body.id_habitacion = overrideRoomId;
      return run('Check-in registrado', () => post(`/m1/reservas/${resId}/check-in`, body), {
        refreshKeys: ['reservas', 'habitaciones', 'cuentas'],
        detail: res.code,
      });
    },

    async performCheckOut(resId, authorizePendingBalance = false) {
      const res = reservationById(resId);
      if (!res) return fail('Reserva no encontrada', 'Actualiza la página e inténtalo de nuevo.');
      if (!res.stayId) return fail('Sin estadía activa', 'La reserva no tiene una estadía en curso para cerrar.');
      const body = { autorizar_saldo_pendiente: Boolean(authorizePendingBalance) };
      if (authorizePendingBalance) {
        body.motivo_autorizacion = 'Saldo pendiente trasladado a cuentas por cobrar con autorización de recepción';
      }
      return run('Check-out registrado', () => post(`/m1/estadias/${res.stayId}/check-out`, body), {
        refreshKeys: ['reservas', 'habitaciones', 'cuentas', 'cxc', 'ordenesLimpieza'],
        detail: res.code,
      });
    },

    async createWaitlistEntry(entry) {
      const guest = (s().guests ?? []).find((g) => sameName(g.fullName, entry.guestName));
      if (!guest) {
        return fail('Huésped no registrado', `No existe un huésped llamado "${entry.guestName}". Regístralo primero en la pestaña Huéspedes.`);
      }
      const room = (s().rooms ?? []).find((r) => sameName(r.type, entry.roomType));
      if (!room) return fail('Tipo de habitación inválido', `No existe el tipo "${entry.roomType}".`);
      return run(
        'Registrado en lista de espera',
        () =>
          post('/m1/lista-espera', {
            id_huesped: guest.id,
            id_tipo_habitacion: room.typeId,
            fecha_ingreso: entry.checkInDate,
            fecha_salida: entry.checkOutDate,
            prioridad: 0,
          }),
        { refreshKeys: ['listaEspera'], detail: `${guest.fullName} · ${entry.roomType}` }
      );
    },

    /** Solo número, piso y tipo son de la habitación; capacidad y características son del tipo y el precio, de la tarifa. */
    async upsertRoom(room) {
      const type = (s().catalogs?.roomTypes ?? []).find((t) => sameName(t.name, room.type));
      if (!type) return fail('Tipo de habitación no válido', `"${room.type}" no existe en la base de datos.`);
      const numero = String(room.number ?? '').trim();
      const piso = Number(room.floor);
      if (!numero) return fail('Número requerido', 'Ingresa el número de la habitación.');
      if (!Number.isInteger(piso)) return fail('Piso inválido', 'El piso debe ser un número entero.');
      const body = { numero, piso, id_tipo_habitacion: type.id };
      const isEdit = isNumericId(room.id);
      return run(
        isEdit ? 'Habitación actualizada' : 'Habitación registrada',
        () => (isEdit ? put(`/m1/habitaciones/${room.id}`, body) : post('/m1/habitaciones', body)),
        { refreshKeys: ['habitaciones'], detail: `Hab. ${numero} · ${type.name} · piso ${piso}` }
      );
    },

    /** Al editar solo cambian nombre, precio, vigencia y estado; tipo, temporada y canal definen la tarifa y no se modifican. */
    async upsertRatePlan(plan) {
      const price = Number(plan.price);
      if (!(price >= 0)) return fail('Precio inválido', 'El precio por noche debe ser un número mayor o igual a cero.');
      if (!plan.startDate || !plan.endDate || plan.endDate < plan.startDate) {
        return fail('Vigencia inválida', 'La fecha de fin no puede ser anterior a la de inicio.');
      }
      const isEdit = isNumericId(plan.id);
      if (isEdit) {
        return run(
          'Tarifa actualizada',
          () =>
            put(`/m1/tarifas/${plan.id}`, {
              nombre: plan.name,
              precio_base: money(price),
              fecha_inicio: plan.startDate,
              fecha_fin: plan.endDate,
              estado: plan.active === false ? 'INACTIVA' : 'ACTIVA',
            }),
          { refreshKeys: ['tarifas'], detail: `${plan.name} · S/ ${money(price)}` }
        );
      }
      const cat = s().catalogs ?? {};
      const type = (cat.roomTypes ?? []).find((t) => sameName(t.name, plan.roomType));
      const season = (cat.seasons ?? []).find((t) => sameName(t.name, plan.season));
      const channel = (cat.channels ?? []).find((t) => sameName(t.name, plan.channel));
      if (!type) return fail('Tipo de habitación no válido', `"${plan.roomType}" no existe en la base de datos.`);
      if (!season) return fail('Temporada no válida', `"${plan.season}" no existe. Disponibles: ${(cat.seasons ?? []).map((x) => x.name).join(', ') || 'ninguna'}.`);
      if (!channel) return fail('Canal requerido', `Selecciona un canal. Disponibles: ${(cat.channels ?? []).map((x) => x.name).join(', ') || 'ninguno'}.`);
      return run(
        'Tarifa creada',
        () =>
          post('/m1/tarifas', {
            id_tipo_habitacion: type.id,
            id_temporada: season.id,
            id_canal_reserva: channel.id,
            nombre: plan.name,
            precio_base: money(price),
            fecha_inicio: plan.startDate,
            fecha_fin: plan.endDate,
          }),
        { refreshKeys: ['tarifas'], detail: `${plan.name} · ${type.name} · ${channel.name} · S/ ${money(price)}` }
      );
    },
    /** Aplica el ajuste porcentual sugerido a todas las tarifas activas vigentes del tipo de habitación. */
    async applyDynamicRate(roomTypeId, percent, reason) {
      const pct = Number(percent);
      if (!isNumericId(roomTypeId)) return fail('Falta el tipo de habitación', 'No se pudo identificar el tipo de habitación a ajustar.');
      if (!Number.isFinite(pct) || pct === 0) return fail('Sin ajuste', 'La sugerencia no propone ningún cambio de precio.');
      const type = (s().dynamicPricing?.types ?? []).find((t) => t.id === String(roomTypeId));
      return run(
        'Tarifa dinámica aplicada',
        () => post('/m1/tarifas/dinamica/aplicar', { id_tipo_habitacion: String(roomTypeId), porcentaje: pct, motivo: reason }),
        {
          refreshKeys: ['tarifas', 'habitaciones', 'tarifaDinamica'],
          detail: `${type?.name ?? 'Tipo'} · ${pct > 0 ? '+' : ''}${pct}% sobre las tarifas vigentes`,
        }
      );
    },
    /** Resuelve una entrada pendiente de la lista de espera: 'Atendida' o 'Cancelada'. */
    async resolveWaitlistEntry(id, status) {
      const estado = status === 'Atendida' ? 'ATENDIDA' : status === 'Cancelada' ? 'CANCELADA' : null;
      if (!estado) return unsupported(`Marcar la espera como "${status}"`, 'solo se admite atendida o cancelada.');
      if (!isNumericId(id)) return fail('Entrada no válida', 'La entrada de lista de espera no tiene un identificador válido.');
      const entry = (s().waitlist ?? []).find((w) => w.id === String(id));
      return run(
        estado === 'ATENDIDA' ? 'Lista de espera: atendida' : 'Lista de espera: cancelada',
        () => post(`/m1/lista-espera/${encodeURIComponent(id)}/resolver`, { estado }),
        { refreshKeys: ['listaEspera', 'tarifaDinamica'], detail: entry ? `${entry.guestName} · ${entry.roomType}` : undefined }
      );
    },

    // =========================================================================================
    // M2 · Housekeeping y Mantenimiento
    // =========================================================================================
    async updateRoomHousekeepingStatus(roomId, statusName) {
      const code = HK_CODE[statusName];
      if (!code) return fail('Estado no válido', `"${statusName}" no es un estado de habitación.`);
      return run(
        'Estado de habitación actualizado',
        () =>
          post(`/m2/habitaciones/${roomId}/cambio-estado`, {
            id_estado_nuevo: code,
            origen: 'Manual',
            motivo: 'Cambio manual desde el tablero de housekeeping',
          }),
        { refreshKeys: ['habitaciones'], detail: statusName }
      );
    },

    async createCleaningOrder(input) {
      if (!isNumericId(input.roomId)) return fail('Habitación inválida', 'Selecciona una habitación.');
      const type = /salida|check-?out/i.test(input.type) ? 'Salida' : /profunda/i.test(input.type) ? 'Profunda' : 'Estadía';
      const prioridad = ['Alta', 'Media', 'Baja'].includes(input.priority) ? input.priority : 'Media';
      const created = await run(
        'Orden de limpieza creada',
        async () => {
          const res = await post('/m2/ordenes-limpieza', {
            id_habitacion: input.roomId,
            id_turno: cleaningShiftCode(),
            tipo_limpieza: type,
            origen: 'Manual',
            prioridad,
            observaciones: input.notes || null,
          });
          const numero = res?.data?.numero_orden;
          if (numero && isNumericId(input.assignedStaffId)) {
            await post(`/m2/ordenes-limpieza/${numero}/asignar`, { id_personal: input.assignedStaffId, origen_asignacion: 'Manual' });
          }
          return res;
        },
        { refreshKeys: ['ordenesLimpieza'], detail: `${type} · prioridad ${prioridad}` }
      );
      return created;
    },

    async advanceCleaningOrder(orderId, nextStatus, assignedStaffId) {
      const step = nextStatus === 'En proceso' ? 'iniciar' : nextStatus === 'Completada' ? 'finalizar' : null;
      if (!step) return unsupported(`Mover la orden a "${nextStatus}"`, 'solo se admite iniciar o finalizar.');
      return run(
        step === 'iniciar' ? 'Limpieza iniciada' : 'Limpieza finalizada',
        async () => {
          if (isNumericId(assignedStaffId)) {
            await post(`/m2/ordenes-limpieza/${orderId}/asignar`, { id_personal: assignedStaffId, origen_asignacion: 'Manual' });
          }
          return post(`/m2/ordenes-limpieza/${orderId}/${step}`);
        },
        { refreshKeys: ['ordenesLimpieza', 'habitaciones'] }
      );
    },

    async submitInspection(input) {
      if (!isNumericId(input.cleaningOrderId)) {
        return fail('Falta la orden de limpieza', 'La inspección se registra sobre una orden de limpieza terminada. Selecciona una habitación con orden pendiente de inspección.');
      }
      const approved = input.result === 'Aprobada';
      const checklist = Object.fromEntries(Object.entries(input.checklist ?? {}).map(([k, v]) => [k, Boolean(v)]));
      return run(
        approved ? 'Inspección aprobada' : 'Inspección rechazada',
        () =>
          post('/m2/inspecciones', {
            numero_orden: input.cleaningOrderId,
            resultado: approved ? 'Conforme' : 'No conforme',
            motivo_rechazo: approved ? undefined : input.observations || 'No conforme según lista de verificación',
            lista_verificacion: checklist,
          }),
        { refreshKeys: ['ordenesLimpieza', 'habitaciones', 'inspecciones'] }
      );
    },

    async createIncident(input) {
      if (!isNumericId(input.roomId)) {
        return fail('Falta la habitación', 'La incidencia debe asociarse a una habitación registrada.');
      }
      const criticidad = /alta|urgente|cr[ií]tica/i.test(input.priority) ? 'Alta' : /baja/i.test(input.priority) ? 'Baja' : 'Media';
      return run(
        'Incidencia registrada',
        () =>
          post('/m2/incidencias', {
            id_habitacion: input.roomId,
            descripcion: input.description,
            criticidad,
            origen: 'Personal',
          }),
        { refreshKeys: ['incidencias'], detail: `Criticidad ${criticidad}` }
      );
    },

    async createWorkOrderFromIncident(incidentId, staffId, _estimatedCost, description) {
      const cc = (s().costCenters ?? []).find((c) => /manten/i.test(c.name));
      if (!cc) {
        return fail('Falta el centro de costo', 'La orden de trabajo exige un centro de costo de Mantenimiento y la API aún no expone el catálogo. Registra primero un gasto de ese centro.');
      }
      if (!isNumericId(incidentId)) return fail('Incidencia inválida', 'No se pudo identificar la incidencia.');
      return run(
        'Orden de trabajo generada',
        () =>
          post('/m2/ordenes-trabajo', {
            tipo_ot: 'Correctiva',
            numero_incidencia: incidentId,
            id_tecnico: isNumericId(staffId) ? staffId : null,
            id_centro_costo: cc.id,
            descripcion_tarea: description,
            prioridad: 'Media',
          }),
        { refreshKeys: ['ordenesTrabajo', 'incidencias'], detail: `Centro de costo: ${cc.name}` }
      );
    },

    async consumeHKSupply(supplyId, qty) {
      return run(
        'Consumo de insumo registrado',
        () =>
          post('/m2/insumos/movimientos', {
            id_insumo: supplyId,
            tipo_movimiento: 'Salida',
            cantidad: Number(qty),
            signo: '-',
            motivo: 'Consumo registrado desde housekeeping',
          }),
        { refreshKeys: ['insumos'] }
      );
    },

    async completeWorkOrder(workOrderId, notes, parts, hours, cost) {
      const done = String(notes ?? '').trim();
      const trabajo = [done, String(parts ?? '').trim() ? `Repuestos: ${String(parts).trim()}` : ''].filter(Boolean).join('. ');
      if (trabajo.length < 5) return fail('Trabajo realizado requerido', 'Describe el trabajo realizado (mínimo 5 caracteres).');
      const h = Number(hours);
      const c = Number(cost);
      if (hours === '' || hours == null || !Number.isFinite(h) || h < 0) return fail('Horas inválidas', 'Ingresa las horas trabajadas (0 o más).');
      if (cost === '' || cost == null || !Number.isFinite(c) || c < 0) return fail('Costo inválido', 'Ingresa el costo total de la orden (0 o más).');
      return run(
        'Orden de trabajo cerrada',
        () =>
          post(`/m2/ordenes-trabajo/${workOrderId}/cerrar`, {
            trabajo_realizado: trabajo.slice(0, 500),
            horas_trabajadas: h,
            costo_total: money(c),
          }),
        { refreshKeys: ['ordenesTrabajo', 'incidencias'], detail: `${h} h · S/ ${money(c)} · la incidencia asociada se cierra` }
      );
    },
    /** Las notas de la solicitud no se almacenan: la requisición guarda artículo, cantidad y estado. */
    async requestSupplyFromWarehouse(supplyId, quantity) {
      const supply = (s().hkSupplies ?? []).find((x) => x.id === supplyId);
      if (!supply?.inventoryItemId) return fail('Insumo sin artículo de almacén', 'Este insumo no está vinculado a un artículo de almacén.');
      const cantidad = Number(quantity);
      if (!(cantidad > 0)) return fail('Cantidad inválida', 'La cantidad debe ser mayor a cero.');
      return run(
        'Solicitud enviada a almacén',
        () => post('/m2/requisiciones', { id_articulo: supply.inventoryItemId, cantidad }),
        { refreshKeys: ['requisiciones'], detail: `${cantidad} ${supply.unit} de ${supply.name}` }
      );
    },

    /** Frecuencias de la pantalla -> (periodicidad, valor) de la base. */
    async addPreventiveSchedule(item) {
      const FREQ = { Semanal: ['Semanas', 1], Mensual: ['Meses', 1], Trimestral: ['Meses', 3], Anual: ['Meses', 12] };
      const f = FREQ[item.frequency];
      if (!isNumericId(item.assetId)) return fail('Activo requerido', 'Selecciona el activo a mantener.');
      if (!f) return fail('Frecuencia no válida', `"${item.frequency}" no es una frecuencia reconocida.`);
      const tarea = String(item.task ?? '').trim();
      if (tarea.length < 5) return fail('Tarea requerida', 'Describe la tarea de mantenimiento (mínimo 5 caracteres).');
      return run(
        'Mantenimiento preventivo programado',
        () =>
          post('/m2/preventivo', {
            id_activo: item.assetId,
            tarea,
            tipo_periodicidad: f[0],
            valor_periodicidad: f[1],
            fecha_proxima: item.nextDate || null,
          }),
        { refreshKeys: ['preventivo'], detail: `${item.frequency} · ${tarea}` }
      );
    },

    async completePreventiveSchedule(scheduleId) {
      const sch = (s().preventiveSchedules ?? []).find((x) => x.id === scheduleId);
      if (!sch) return fail('Programación no encontrada', 'Actualiza la página e inténtalo de nuevo.');
      return run(
        'Ejecución preventiva registrada',
        () => post(`/m2/preventivo/${sch.planId}/${sch.assetId}/ejecutar`),
        { refreshKeys: ['preventivo'], detail: `${sch.assetName} · se reprograma según su periodicidad` }
      );
    },

    /** Alta: nombre, tipo y ubicación (habitación o área). Edición: solo nombre, marca, modelo, horas y estado. */
    async upsertAsset(asset) {
      const nombre = String(asset.name ?? '').trim();
      if (nombre.length < 3) return fail('Nombre requerido', 'El nombre del activo debe tener al menos 3 caracteres.');
      const hours = Number(asset.hoursUsed ?? 0);
      if (!Number.isInteger(hours) || hours < 0) return fail('Horas inválidas', 'Las horas de uso deben ser un entero mayor o igual a cero.');
      if (isNumericId(asset.id)) {
        return run(
          'Activo actualizado',
          () =>
            put(`/m2/activos/${asset.id}`, {
              nombre,
              marca: asset.brand || null,
              modelo: asset.model || null,
              horas_uso_acumuladas: hours,
              estado: asset.condition || undefined,
            }),
          { refreshKeys: ['activos'], detail: `${asset.code} · ${nombre}` }
        );
      }
      const [kind, id] = String(asset.location ?? '').split(':');
      if (!isNumericId(asset.typeId)) return fail('Tipo requerido', 'Selecciona el tipo de activo.');
      if (!['h', 'a'].includes(kind) || !isNumericId(id)) return fail('Ubicación requerida', 'Selecciona una habitación o un área.');
      if (!asset.installDate) return fail('Fecha requerida', 'Indica la fecha de instalación.');
      return run(
        'Activo registrado',
        () =>
          post('/m2/activos', {
            nombre,
            id_tipo_activo: asset.typeId,
            id_habitacion: kind === 'h' ? id : null,
            id_area: kind === 'a' ? id : null,
            marca: asset.brand || null,
            modelo: asset.model || null,
            fecha_instalacion: asset.installDate,
            horas_uso_acumuladas: hours,
          }),
        { refreshKeys: ['activos'], detail: nombre }
      );
    },

    // =========================================================================================
    // M3 · Servicios, POS y Almacén
    // =========================================================================================
    async adjustInventory(inventoryItemId, type, quantity, reference) {
      const qty = Number(quantity);
      if (!(qty > 0)) return fail('Cantidad inválida', 'La cantidad debe ser mayor a cero.');
      const tipo = String(type ?? '');
      const signo = tipo === 'Entrada' ? 'entrada' : tipo === 'Salida' ? 'salida' : null;
      if (!signo) {
        return unsupported('Ajuste de inventario', 'indica si es una Entrada o una Salida; el tipo "Ajuste" no define el sentido del movimiento.');
      }
      const motivo = String(reference ?? '').trim();
      if (motivo.length < 5) return fail('Motivo requerido', 'Ingresa una referencia de al menos 5 caracteres.');
      return run(
        `Movimiento de inventario (${tipo.toLowerCase()})`,
        () =>
          post('/m3/inventario/movimientos', {
            id_articulo: inventoryItemId,
            tipo_movimiento: tipo,
            cantidad: qty,
            signo,
            motivo,
            modulo_origen: 'Almacén',
          }),
        { refreshKeys: ['inventario'] }
      );
    },

    async createPurchaseOrder(input) {
      if (!input.supplierId) return fail('Proveedor requerido', 'Selecciona un proveedor.');
      const delivery = addDays(TODAY, 3);
      return run(
        'Orden de compra creada',
        () =>
          post('/m3/ordenes-compra', {
            id_proveedor: input.supplierId,
            fecha_entrega_esperada: delivery,
            items: input.items.map((i) => ({
              id_articulo: i.inventoryItemId,
              cantidad_solicitada: Number(i.quantity),
              precio_referencia_capturado: money(i.unitCost || 0),
            })),
          }),
        { refreshKeys: ['ordenesCompra'], detail: `Entrega esperada: ${delivery} (3 días)` }
      );
    },

    /**
     * Venta POS. Restaurante, Bar y Room Service generan una comanda (se prepara y se entrega);
     * Minibar y servicios complementarios generan un consumo (se confirma). Si los ítems pertenecen
     * a varios puntos de venta se crea un documento por cada uno, porque el servidor exige uno solo.
     */
    async createPOSOrder(input) {
      const st = s();
      const catalog = new Map([...(st.products ?? []), ...(st.services ?? [])].map((p) => [p.id, p]));
      const lines = (input.items ?? []).map((i) => ({ item: catalog.get(i.id), qty: Number(i.quantity) }));
      if (lines.length === 0 || lines.some((l) => !l.item?.posId || !(l.qty > 0))) {
        return fail('Ítems inválidos', 'Hay ítems que no existen en el catálogo o con cantidad inválida.');
      }

      // Estadía y cuenta de la habitación a la que se carga (si corresponde)
      let stayId = null;
      let accountId = null;
      if (input.roomId) {
        const res = (st.reservations ?? []).find(
          (r) => r.status === 'Check-in' && r.details.some((d) => d.roomId === input.roomId && d.stayId)
        );
        stayId = res?.details.find((d) => d.roomId === input.roomId && d.stayId)?.stayId ?? null;
        accountId = (st.folios ?? []).find((f) => f.reservationId === res?.id)?.id ?? null;
        if (!stayId) return fail('Habitación sin estadía activa', 'Solo se puede cargar a una habitación con check-in realizado.');
      }
      const forma = input.paymentMode === 'Pago Directo' ? 'pago directo' : 'cargo a la habitación';
      if (forma === 'cargo a la habitación' && (!stayId || !accountId)) {
        return fail('Sin cuenta para cargar', 'La habitación no tiene un folio abierto al cual cargar el consumo.');
      }

      const isComanda = ['Restaurante', 'Bar', 'Room Service'].includes(input.source);
      const isRoomService = input.source === 'Room Service';
      let table = null;
      if (isComanda && !isRoomService) {
        table = (st.tables ?? []).find((t) => t.number === input.tableNumber);
        if (!table) return fail('Mesa requerida', 'Selecciona una mesa válida para la comanda.');
      }
      if (isRoomService && !stayId) return fail('Habitación requerida', 'Room Service se entrega en una habitación con estadía activa.');

      // Un documento por punto de venta
      const byPos = new Map();
      for (const l of lines) {
        const list = byPos.get(l.item.posId) ?? [];
        list.push({ id_item_catalogo: l.item.id, cantidad: l.qty });
        byPos.set(l.item.posId, list);
      }

      const label = isComanda ? 'Comanda registrada' : 'Consumo registrado';
      return run(
        label,
        async () => {
          let created = 0;
          for (const [posId, items] of byPos) {
            try {
              if (isComanda) {
                await post('/m3/comandas', {
                  id_punto_venta: posId,
                  modalidad: isRoomService ? 'habitación' : 'mesa',
                  id_mesa: isRoomService ? undefined : table.id,
                  id_estadia_externa: stayId || undefined,
                  items,
                });
              } else {
                await post('/m3/consumos', {
                  id_punto_venta: posId,
                  forma_cobro: forma,
                  id_estadia_externa: stayId || undefined,
                  id_cuenta_cobro_externa: forma === 'cargo a la habitación' ? accountId : undefined,
                  items,
                });
              }
              created += 1;
            } catch (e) {
              if (created > 0) {
                try { await refresh(['comandas', 'consumos', 'resumen']); } catch { /* ignorar */ }
                throw Object.assign(new Error(`Se registraron ${created} de ${byPos.size} documentos; falló el siguiente: ${describeError(e)}`), { status: e?.status });
              }
              throw e;
            }
          }
        },
        {
          refreshKeys: ['comandas', 'consumos'],
          detail: forma === 'cargo a la habitación' ? 'Se cargará a la cuenta de la habitación al entregarse' : 'Pago directo',
        }
      );
    },

    /**
     * Comanda: pendiente → en preparación → lista → entregada (al entregar se crea el consumo).
     * Consumo: por confirmar → confirmado. Se ejecutan los pasos intermedios que falten.
     */
    async updatePOSOrderStatus(orderId, target) {
      const order = (s().posOrders ?? []).find((o) => o.id === orderId);
      if (!order) return fail('Pedido no encontrado', 'Actualiza la página e inténtalo de nuevo.');
      const enc = encodeURIComponent(order.id);

      if (order.kind === 'consumo') {
        if (!['Entregado', 'Cobrado'].includes(target)) return unsupported(`Mover el consumo a "${target}"`, 'solo se admite confirmarlo.');
        if (order.rawStatus !== 'por confirmar') return fail('Sin cambios', `El consumo ya está "${order.rawStatus}".`);
        return run('Consumo confirmado', () => post(`/m3/consumos/${enc}/confirmar`), { refreshKeys: ['consumos', 'inventario'] });
      }

      const ORDER = ['pendiente', 'en preparación', 'lista', 'entregada'];
      const goal = { Preparando: 1, 'En camino': 2, Lista: 2, Entregado: 3 }[target];
      if (goal === undefined) return unsupported(`Mover la comanda a "${target}"`, 'estado no reconocido.');
      const from = ORDER.indexOf(order.rawStatus);
      if (from < 0) return fail('Comanda no disponible', `La comanda está "${order.rawStatus}".`);
      if (from >= goal) return fail('Sin cambios', `La comanda ya está "${order.rawStatus}".`);

      // Datos de cobro, solo si se va a entregar
      let delivery = null;
      if (goal >= 3) {
        if (order.stayId) {
          const res = (s().reservations ?? []).find((r) => r.details.some((d) => d.stayId === order.stayId));
          const account = (s().folios ?? []).find((f) => f.reservationId === res?.id);
          if (!account) return fail('Sin cuenta para cargar', 'No se encontró el folio abierto de la estadía de esta comanda.');
          delivery = { forma_cobro: 'cargo a la habitación', id_cuenta_cobro_externa: account.id };
        } else {
          delivery = { forma_cobro: 'pago directo' };
        }
      }

      return run(
        goal >= 3 ? 'Comanda entregada' : goal === 2 ? 'Comanda lista' : 'Preparación iniciada',
        async () => {
          let cur = from;
          if (cur < 1 && goal >= 1) { await post(`/m3/comandas/${enc}/iniciar-preparacion`); cur = 1; }
          if (cur < 2 && goal >= 2) { await post(`/m3/comandas/${enc}/marcar-lista`); cur = 2; }
          if (cur < 3 && goal >= 3) await post(`/m3/comandas/${enc}/entregar`, delivery);
        },
        {
          refreshKeys: ['comandas', 'consumos'],
          detail: delivery ? (delivery.forma_cobro === 'pago directo' ? 'Pago directo' : 'Cargo a la habitación (consumo por confirmar)') : undefined,
        }
      );
    },
    /** Activa o desactiva una mesa. Desactivar exige un motivo y la mesa no puede tener comandas abiertas. */
    async updateTableStatus(tableId, status, reason) {
      const table = (s().tables ?? []).find((t) => t.id === tableId);
      if (!table) return fail('Mesa no encontrada', 'La mesa indicada no existe.');
      const estado = status === 'Inactiva' ? 'inactiva' : ['Libre', 'Disponible', 'Activa'].includes(status) ? 'activa' : null;
      if (!estado) return unsupported(`Mover la mesa a "${status}"`, 'solo se admite activa o inactiva; la ocupación depende de las comandas.');
      const motivo = String(reason ?? '').trim();
      if (estado === 'inactiva' && motivo.length < 3) return fail('Falta el motivo', 'Indica el motivo para desactivar la mesa (mínimo 3 caracteres).');
      return run(
        estado === 'inactiva' ? 'Mesa desactivada' : 'Mesa activada',
        () => put(`/m3/mesas/${encodeURIComponent(tableId)}`, { estado, motivo_desactivacion: estado === 'inactiva' ? motivo : undefined }),
        { refreshKeys: ['catalogo', 'comandas'], detail: table.name }
      );
    },
    /** Productos de carta (plato / bebida / producto). El costo no se guarda: se calcula con la receta o el artículo ligado. */
    async upsertProduct(p) {
      return saveCatalogItem(p, 'Producto');
    },
    async upsertService(p) {
      return saveCatalogItem({ ...p, itemType: 'servicio' }, 'Servicio');
    },

    /** Guarda una nueva versión vigente de la receta; la anterior queda en el historial. */
    async upsertRecipe(r) {
      const ingredientes = (r.ingredients ?? [])
        .map((i) => ({ id_articulo: i.inventoryItemId, cantidad_por_porcion: Number(i.quantity) }))
        .filter((i) => i.id_articulo && i.cantidad_por_porcion > 0);
      if (!r.productId || ingredientes.length === 0) return fail('Receta incompleta', 'Selecciona el producto y al menos un ingrediente con cantidad.');
      return run('Receta guardada', () => post('/m3/recetas', { id_item_catalogo: r.productId, ingredientes }), {
        refreshKeys: ['recetas'],
        detail: `${r.productName} · ${ingredientes.length} ingrediente(s)`,
      });
    },

    /** Alta de artículo de almacén; con stock inicial se crea su primer lote y su movimiento. */
    async upsertInventoryItem(i) {
      const nombre = String(i.name ?? '').trim();
      if (nombre.length < 3) return fail('Nombre requerido', 'El nombre debe tener al menos 3 caracteres.');
      if (!i.categoryId || !i.unitId) return fail('Datos incompletos', 'Selecciona la categoría y la unidad de medida.');
      const stock = Number(i.stock || 0);
      if (stock > 0 && i.expires && !i.expiryDate) return fail('Vencimiento requerido', 'Indica la fecha de vencimiento del stock inicial.');
      return run(
        'Artículo registrado en almacén',
        () =>
          post('/m3/articulos', {
            nombre,
            id_categoria: i.categoryId,
            id_unidad_medida: i.unitId,
            vence: Boolean(i.expires),
            dias_aviso_vencimiento: Boolean(i.expires) ? Number(i.warnDays || 0) : 0,
            stock_minimo: Number(i.minStock || 0),
            stock_inicial: stock,
            costo_unitario: money(i.unitCost || 0),
            fecha_vencimiento: i.expires ? i.expiryDate : null,
          }),
        { refreshKeys: ['inventario'], detail: `${nombre}${stock > 0 ? ` · stock inicial ${stock}` : ''}` }
      );
    },
    /** La tabla de proveedores guarda RUC, razón social, teléfono y correo (rubro, contacto y plazo se derivan de otras tablas). */
    async upsertSupplier(sup) {
      const ruc = String(sup.ruc ?? '').trim();
      if (!/^\d{11}$/.test(ruc)) return fail('RUC inválido', 'El RUC debe tener exactamente 11 dígitos.');
      const telefono = String(sup.phone ?? '').trim();
      const correo = String(sup.email ?? '').trim();
      if (!telefono && !correo) return fail('Contacto requerido', 'Indica al menos un teléfono o un correo.');
      return run(
        'Proveedor registrado',
        () => post('/m3/proveedores', { ruc, razon_social: String(sup.name ?? '').trim(), telefono: telefono || null, correo: correo || null }),
        { refreshKeys: ['proveedores'], detail: `${sup.name} · RUC ${ruc}` }
      );
    },
    /** Despacha lo solicitado o, si el almacén tiene menos, lo disponible (entrega parcial). Sin stock no se despacha. */
    async fulfillSupplyRequisition(reqId) {
      const req = (s().supplyRequisitions ?? []).find((r) => r.id === reqId);
      if (!req) return fail('Requisición no encontrada', 'Actualiza la página e inténtalo de nuevo.');
      const cantidad = Math.min(req.quantity, req.stock);
      if (!(cantidad > 0)) {
        return fail('Sin stock en almacén', `No hay ${req.itemName} disponible. Genera una orden de compra o rechaza la requisición.`);
      }
      return run(
        cantidad < req.quantity ? 'Requisición despachada parcialmente' : 'Requisición despachada',
        () => post(`/m3/requisiciones/${encodeURIComponent(req.id)}/atender`, { cantidad }),
        { refreshKeys: ['requisiciones', 'inventario', 'insumos'], detail: `${cantidad} de ${req.quantity} ${req.unit} de ${req.itemName}` }
      );
    },

    /** Recepción total: se acepta la cantidad pedida de cada línea al precio de referencia de la orden. */
    async receivePurchaseOrder(poId) {
      const po = (s().purchaseOrders ?? []).find((o) => o.id === poId);
      if (!po) return fail('Orden no encontrada', 'Actualiza la página e inténtalo de nuevo.');
      if (!po.items?.length) return fail('Orden sin líneas', 'La orden no tiene líneas para recepcionar.');
      return run(
        'Orden de compra recepcionada',
        () =>
          post(`/m3/ordenes-compra/${encodeURIComponent(po.id)}/recepciones`, {
            items: po.items.map((i) => ({
              id_detalle_orden: i.id,
              cantidad_aceptada: i.quantity,
              cantidad_rechazada: 0,
              costo_unitario: money(i.unitCost),
            })),
          }),
        { refreshKeys: ['ordenesCompra', 'inventario'], detail: `${po.code} · recepción total de ${po.items.length} línea(s)` }
      );
    },

    // =========================================================================================
    // M4 · Facturación y Finanzas
    // =========================================================================================
    async registerFolioPayment(folioId, amount, method, reference) {
      const shift = openShift();
      if (!shift) return fail('Sin turno de caja abierto', 'Abre un turno de caja antes de registrar cobros.');
      const medio = paymentMethodCode(method);
      if (!medio) return fail('Medio de pago no soportado', `"${method}" no es un medio de pago válido.`);
      return run(
        'Cobro registrado',
        () =>
          post('/m4/cobros', {
            id_cuenta: folioId,
            id_turno_caja: shift.id,
            monto: money(amount),
            medio_pago: medio,
          }),
        { refreshKeys: ['cuentas', 'turnos'], detail: `S/ ${money(amount)} · ${titleCase(medio)}${reference ? ` · ${reference}` : ''}` }
      );
    },

    async addManualFolioCharge(folioId, description, category, amount) {
      return run(
        'Cargo agregado al folio',
        () => post(`/m4/cuentas/${folioId}/consumos`, { concepto: description, importe: money(amount), area: category }),
        { refreshKeys: ['cuentas'], detail: `S/ ${money(amount)} · ${category}` }
      );
    },

    async issueInvoice(input) {
      if (!input.folioId) return fail('Folio requerido', 'Selecciona el folio que se facturará.');
      const total = (input.items ?? []).reduce((acc, i) => acc + Number(i.amount || 0), 0);
      if (!(total > 0)) return fail('Importe inválido', 'El importe a facturar debe ser mayor a cero.');
      const isFactura = /factura/i.test(input.type);
      const tipo = isFactura ? 'FACTURA' : 'BOLETA';
      const doc = String(input.customerDoc ?? '').trim();
      const tipoDoc = isFactura ? 'RUC' : /^\d{8}$/.test(doc) ? 'DNI' : 'CE';
      const lastSeries = (s().invoices ?? []).find((i) => i.type === titleCase(tipo))?.series;
      const serie = lastSeries || (isFactura ? 'F001' : 'B001');
      return run(
        `${titleCase(tipo)} emitida`,
        () =>
          post('/m4/comprobantes', {
            id_cuenta: input.folioId,
            tipo,
            serie,
            tipo_documento_cliente: tipoDoc,
            numero_documento_cliente: doc,
            razon_social_cliente: input.customerName,
            operacion_gravada: money(total / 1.18),
          }),
        { refreshKeys: ['comprobantes', 'cuentas'], detail: `Serie ${serie} · total S/ ${money(total)}` }
      );
    },

    async openCashShift(openingBalance) {
      const amount = Number(openingBalance);
      if (!(amount >= 0) || Number.isNaN(amount)) return fail('Saldo inicial inválido', 'Ingresa un monto válido.');
      return run('Turno de caja abierto', () => post('/m4/turnos-caja/abrir', { turno: cashShiftCode(), saldo_inicial: money(amount) }), {
        refreshKeys: ['turnos'],
        detail: `Saldo inicial S/ ${money(amount)}`,
      });
    },

    async closeCashShift(countedBalance) {
      const shift = openShift();
      if (!shift) return fail('Sin turno abierto', 'No hay un turno de caja abierto.');
      return run('Turno de caja cerrado', () => post(`/m4/turnos-caja/${shift.id}/cerrar`, { saldo_final: money(countedBalance) }), {
        refreshKeys: ['turnos'],
        detail: `Arqueo S/ ${money(countedBalance)}`,
      });
    },

    async addOperatingExpense(expense) {
      const cc = (s().costCenters ?? []).find((c) => sameName(c.name, expense.costCenter));
      if (!cc) {
        return fail('Centro de costo no registrado', `"${expense.costCenter}" no existe en la base de datos. Centros disponibles: ${(s().costCenters ?? []).map((c) => c.name).join(', ') || 'ninguno'}.`);
      }
      if (!String(expense.documentRef ?? '').trim()) return fail('Sustento requerido', 'Ingresa el comprobante de sustento del gasto.');
      return run(
        'Gasto registrado',
        () =>
          post('/m4/gastos', {
            id_centro_costo: Number(cc.id),
            categoria: expense.category,
            proveedor: expense.supplier,
            concepto: expense.description,
            monto: money(expense.amount),
            comprobante_sustento: expense.documentRef,
          }),
        { refreshKeys: ['gastos'], detail: `S/ ${money(expense.amount)} · queda pendiente de aprobación` }
      );
    },

    /** Anulación total: el servidor emite la nota de crédito y marca el comprobante como anulado en una sola transacción. */
    async voidInvoice(invoiceId, reason) {
      const motivo = String(reason ?? '').trim();
      if (motivo.length < 5) return fail('Motivo requerido', 'Indica el motivo de la anulación (mínimo 5 caracteres).');
      return run(
        'Comprobante anulado con nota de crédito',
        () => post(`/m4/comprobantes/${encodeURIComponent(invoiceId)}/anular`, { motivo_nota: motivo.slice(0, 250) }),
        { refreshKeys: ['comprobantes'], detail: motivo }
      );
    },

    async registerReceivablePayment(receivableId, amount, note) {
      if (!(Number(amount) > 0)) return fail('Monto inválido', 'El pago debe ser mayor a cero.');
      return run(
        'Pago registrado en cuenta por cobrar',
        () => post(`/m4/cuentas-por-cobrar/${encodeURIComponent(receivableId)}/pagos`, { monto: money(amount), nota: note || null }),
        { refreshKeys: ['cxc'], detail: `S/ ${money(amount)}` }
      );
    },

    /** El medio de pago no se almacena en el movimiento: se anota en el motivo. */
    async addCashMovement(type, method, concept, amount) {
      const shift = openShift();
      if (!shift) return fail('Sin turno de caja abierto', 'Abre un turno de caja antes de registrar movimientos.');
      const tipo = /egreso/i.test(String(type)) ? 'EGRESO' : /ingreso/i.test(String(type)) ? 'INGRESO' : null;
      if (!tipo) return fail('Tipo no válido', 'El movimiento debe ser un ingreso o un egreso.');
      if (!(Number(amount) > 0)) return fail('Monto inválido', 'El importe debe ser mayor a cero.');
      const concepto = String(concept ?? '').trim();
      if (concepto.length < 3) return fail('Concepto requerido', 'Describe el movimiento (mínimo 3 caracteres).');
      const motivo = [concepto, method ? `(${method})` : ''].filter(Boolean).join(' ').slice(0, 250);
      return run(
        `${titleCase(tipo)} de caja registrado`,
        () => post(`/m4/turnos-caja/${shift.id}/movimientos`, { tipo, importe: money(amount), motivo }),
        { refreshKeys: ['turnos'], detail: `S/ ${money(amount)} · ${motivo}` }
      );
    },

    // =========================================================================================
    // M5 · CRM y Huéspedes
    // =========================================================================================
    async createGuestRequest(input) {
      const guest = guestById(input.guestId);
      if (!guest?.profileId) return fail('Huésped sin perfil CRM', 'El huésped aún no tiene perfil en CRM.');
      // La base solo admite estas tres áreas y estos dos orígenes (g5_crm.solicitud_huesped).
      const areas = ['Recepción', 'Housekeeping', 'Mantenimiento'];
      const origins = ['Portal Autoatención', 'Recepción/CRM'];
      if (!areas.includes(input.targetArea)) {
        return fail('Área no admitida', `Las solicitudes solo se derivan a: ${areas.join(', ')}.`);
      }
      const stay = activeStayOf(guest.id);
      return run(
        'Solicitud registrada',
        () =>
          post('/m5/solicitudes', {
            idPerfil: Number(guest.profileId),
            idEstadia: stay?.stayId || null,
            numeroHabitacion: input.roomNumber || null,
            tipo: input.type,
            areaDestino: input.targetArea,
            origen: origins.includes(input.source) ? input.source : 'Recepción/CRM',
            descripcion: input.description,
          }),
        { refreshKeys: ['solicitudes'], detail: `${guest.fullName} · ${input.type}` }
      );
    },

    async updateGuestRequestStatus(reqId, status) {
      const estado = String(status ?? '').toUpperCase().replace(/\s+/g, '_');
      return run(`Solicitud marcada como ${titleCase(estado)}`, () => patch(`/m5/solicitudes/${reqId}/estado`, { estado }), {
        refreshKeys: ['solicitudes'],
      });
    },

    async createComplaint(input) {
      const guest = guestById(input.guestId);
      if (!guest?.profileId) return fail('Huésped sin perfil CRM', 'El huésped aún no tiene perfil en CRM.');
      const stay = activeStayOf(guest.id);
      if (!stay) return fail('Sin estadía activa', 'Los reclamos se registran sobre una estadía en curso del huésped.');
      return run(
        'Reclamo registrado',
        () =>
          post('/m5/reclamos', {
            idPerfil: Number(guest.profileId),
            idEstadia: stay.stayId,
            tipo: 'RECLAMO',
            canal: 'AGENTE',
            descripcion: input.description,
            motivo: String(input.category ?? '').slice(0, 40) || null,
            prioridad: /alta|cr[ií]tica|urgente/i.test(input.severity) ? 'CRITICA' : 'NORMAL',
          }),
        { refreshKeys: ['reclamos'], detail: guest.fullName }
      );
    },

    async updateComplaintStatus(complaintId, status, note) {
      const map = { Resuelto: 'CERRADO', 'En atención': 'EN_ATENCION', Derivado: 'DERIVADO' };
      const estado = map[status];
      if (!estado) return unsupported(`Cambiar el reclamo a "${status}"`, 'estado no reconocido por la API.');
      return run('Reclamo actualizado', () => post(`/m5/reclamos/${complaintId}/avanzar`, { estado, observacion: note || null }), {
        refreshKeys: ['reclamos'],
        detail: status,
      });
    },

    async createCampaign(c) {
      const seg = (s().segments ?? []).find((x) => sameName(x.name, c.segment) || sameName(x.code, c.segment));
      if (!seg) {
        return fail('Segmento no encontrado', `"${c.segment}" no existe en CRM. Segmentos disponibles: ${(s().segments ?? []).map((x) => x.name).join(', ') || 'ninguno'}.`);
      }
      const end = addDays(TODAY, 30);
      return run(
        'Campaña creada',
        async () => {
          const created = await post('/m5/campanas', {
            idSegmento: Number(seg.id),
            nombre: c.name,
            canal: /email|correo/i.test(c.channel) ? 'CORREO' : 'NOTIFICACION',
            mensaje: c.offerDescription || c.subject,
            fechaInicio: TODAY,
            fechaFin: end,
          });
          const id = created?.data?.id_campana;
          if (id && c.status === 'Activa') await post(`/m5/campanas/${id}/estado`, { estado: 'ACTIVA' });
          return created;
        },
        { refreshKeys: ['campanas'], detail: `Vigencia hasta ${end} (30 días)` }
      );
    },

    async toggleCampaignStatus(id, status) {
      const map = { Activa: 'ACTIVA', Finalizada: 'CERRADA', Cancelada: 'CANCELADA' };
      const estado = map[status];
      if (!estado) return unsupported(`Cambiar la campaña a "${status}"`, 'estado no reconocido por la API.');
      return run(`Campaña ${status.toLowerCase()}`, () => post(`/m5/campanas/${id}/estado`, { estado }), { refreshKeys: ['campanas'] });
    },

    async replyToReview(reviewId, reply) {
      return run('Respuesta publicada', () => post(`/m5/opiniones/${reviewId}/responder`, { respuestaHotel: reply }), {
        refreshKeys: ['opiniones'],
      });
    },

    async addSurveyResponse(survey) {
      const guest = guestById(survey.guestId);
      if (!guest?.profileId) return fail('Huésped sin perfil CRM', 'El huésped aún no tiene perfil en CRM.');
      const puntaje = Math.round(Number(survey.npsScore));
      if (!(puntaje >= 0 && puntaje <= 10)) return fail('Puntaje inválido', 'El puntaje NPS debe estar entre 0 y 10.');
      return run(
        'Encuesta registrada',
        () =>
          post('/m5/opiniones', {
            idPerfil: Number(guest.profileId),
            tipoOpinion: 'ENCUESTA',
            puntaje,
            textoSeudonimizado: survey.comment || null,
          }),
        { refreshKeys: ['opiniones'], detail: `NPS ${puntaje}/10 (limpieza, servicio y gastronomía no se almacenan)` }
      );
    },

    async redeemLoyaltyPoints(guestId, points, rewardLabel) {
      const guest = guestById(guestId);
      if (!guest?.profileId) return fail('Huésped sin perfil CRM', 'El huésped aún no tiene perfil en CRM.');
      let benefit;
      try {
        const info = await apiV1Request(`/m5/fidelizacion/perfiles/${guest.profileId}`);
        const list = info?.data?.beneficios ?? [];
        benefit = list.find((b) => Number(b.puntos_requeridos) === Number(points)) ?? list.find((b) => sameName(b.nombre, rewardLabel));
      } catch (e) {
        const message = describeError(e);
        toast({ title: 'No se pudo consultar los beneficios', detail: message, type: 'error' });
        return { ok: false, message };
      }
      if (!benefit) return fail('Beneficio no encontrado', `"${rewardLabel}" no existe entre los beneficios activos de la base de datos.`);
      return run(
        'Canje registrado',
        () =>
          post('/m5/fidelizacion/movimientos', {
            idPerfil: Number(guest.profileId),
            tipoMovimiento: 'CANJE',
            idBeneficio: Number(benefit.id_beneficio),
            puntos: -Math.abs(Number(benefit.puntos_requeridos)),
          }),
        { refreshKeys: ['perfiles'], detail: `${benefit.nombre} (${benefit.puntos_requeridos} puntos)` }
      );
    },
  };

  return actions;
}
