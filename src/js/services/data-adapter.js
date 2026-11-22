import { createClient } from '@supabase/supabase-js';
import { createEmptyERPState, TODAY } from '../data/empty-state.js';
import { apiV1Request } from './api-client.js';
import { getSessionToken } from './auth-client.js';
import {
  applyPerfiles,
  mapAuditLog,
  mapCatalogs,
  mapExtraCatalogs,
  mapFolios,
  mapM2,
  mapDynamicPricing,
  mapM3,
  mapM4,
  mapM5,
  mapNotifications,
  titleCase,
  toDate,
  toNumber,
  toStamp,
} from './erp-mappers.js';

const LEGACY_STORAGE_KEYS = ['sgh_erp_demo_state_v1', 'sgh_erp_current_user_v1'];

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const PAGE_SIZE = 100; // máximo permitido por el servidor (paginationQuerySchema)
const MAX_PAGES_M1 = 10; // 1000 filas por recurso de Reservas
const MAX_PAGES_OTHER = 5; // 500 filas (las más recientes) por recurso de M2 a M5
const MAX_FOLIO_DETAILS = 60; // folios abiertos cuyo detalle (cargos/pagos) se consulta
const FOLIO_DETAIL_CONCURRENCY = 6;

let supabaseInstance = null;

// Últimas filas leídas por recurso (clave de buildResourceList) y detalle de folios abiertos.
const rawCache = new Map();
let folioDetailsCache = new Map();
let movementsCache = new Map(); // id_turno_caja -> movimientos manuales del turno abierto

export function purgeLegacyLocalStorage() {
  try {
    for (const key of LEGACY_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore storage access issues
  }
}

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && String(SUPABASE_URL).startsWith('http'));
}

export function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (!supabaseInstance) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseInstance;
}

export async function fetchEstablishmentConfig() {
  try {
    const res = await fetch('/api/v1/configuracion/establecimiento', {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? json;
  } catch {
    return null;
  }
}

/**
 * Estado REAL de la conexión según el último intento de carga.
 * loadInfo = { source, errors, truncated, forbidden } devuelto por loadERPState().
 */
export function getPersistenceStatus(lastSyncedAt, loadInfo) {
  const base = { supabaseConfigured: isSupabaseConfigured(), lastSyncedAt };
  const source = loadInfo?.source ?? null;
  const errors = loadInfo?.errors ?? [];
  const forbidden = loadInfo?.forbidden ?? [];

  if (source === 'postgresql_database') {
    return {
      ...base,
      mode: 'api_express_postgresql',
      connected: true,
      label: 'PostgreSQL (Supabase) · conectado',
      description:
        'Los cinco módulos se leen de la base de datos.' +
        (forbidden.length ? ` Tu rol no tiene acceso a: ${forbidden.join(', ')}.` : '') +
        ' Sin lectura todavía: kardex de movimientos de inventario.',
    };
  }
  if (source === 'partial') {
    return {
      ...base,
      mode: 'api_express_postgresql',
      connected: true,
      label: 'PostgreSQL (Supabase) · conexión parcial',
      description: `No se pudieron cargar: ${errors.map((e) => e.resource).join(', ')}.`,
    };
  }
  if (source === 'error') {
    return {
      ...base,
      mode: 'sin_conexion',
      connected: false,
      label: 'Sin conexión a la base de datos',
      description: errors[0]?.message || 'No se pudo consultar la API del ERP.',
    };
  }
  if (source === 'unauthenticated') {
    return {
      ...base,
      mode: 'sin_sesion',
      connected: false,
      label: 'Sin sesión',
      description: 'Inicia sesión con tu cuenta de Supabase para cargar los datos de la base.',
    };
  }
  return {
    ...base,
    mode: 'cargando',
    connected: false,
    label: 'Cargando datos…',
    description: 'Consultando la base de datos.',
  };
}

// ---------------------------------------------------------------------------------------------
// Utilidades de lectura
// ---------------------------------------------------------------------------------------------

/** Lee las páginas de un endpoint paginado ({ data, pagination }) hasta maxPages. */
async function fetchAllPages(path, maxPages) {
  const sep = path.includes('?') ? '&' : '?';
  const pageUrl = (page) => `${path}${sep}page=${page}&pageSize=${PAGE_SIZE}`;

  const first = await apiV1Request(pageUrl(1));
  if (!Array.isArray(first?.data)) {
    throw new Error(`Respuesta inesperada de ${path}`);
  }
  const rows = [...first.data];
  const total = Number(first.pagination?.total ?? rows.length);
  const totalPages = Math.min(Number(first.pagination?.totalPages ?? 1), maxPages);

  if (totalPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) => apiV1Request(pageUrl(i + 2)))
    );
    for (const p of rest) {
      if (Array.isArray(p?.data)) rows.push(...p.data);
    }
  }
  return { rows, total, truncated: rows.length < total };
}

/** Endpoint sin paginación: { data: <lista u objeto> }. */
async function fetchData(path) {
  const res = await apiV1Request(path);
  if (res?.data === undefined || res?.data === null) {
    throw new Error(`Respuesta inesperada de ${path}`);
  }
  const rows = res.data;
  return { rows, total: Array.isArray(rows) ? rows.length : 1, truncated: false };
}

const daysBetween = (from, to) => {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
};

// ---------------------------------------------------------------------------------------------
// M1 · Mapeo base de datos (g1_reservas / g2_housekeeping) → modelo de la interfaz
// ---------------------------------------------------------------------------------------------

const HK_STATUS_UI = {
  OCU: 'Ocupada',
  SUC: 'Sucia',
  ELI: 'En limpieza',
  LIM: 'Limpia',
  DIS: 'Inspeccionada', // disponible para la venta = limpia e inspeccionada
  FSV: 'Fuera de servicio',
};

const RESERVATION_STATUS_UI = {
  PENDIENTE: 'Pendiente',
  CONFIRMADA: 'Confirmada',
  CHECK_IN: 'Check-in',
  EN_CURSO: 'Check-in',
  CHECK_OUT: 'Check-out',
  FINALIZADA: 'Check-out',
  CANCELADA: 'Cancelada',
  NO_SHOW: 'No-Show',
};

function mapFeatures(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw && typeof raw === 'object') {
    return Object.entries(raw)
      .filter(([, v]) => v)
      .map(([k, v]) => (v === true ? k : `${k}: ${v}`));
  }
  return [];
}

function mapRatePlans(rows) {
  return rows.map((t) => ({
    id: String(t.id_tarifa),
    name: t.nombre,
    roomType: t.tipo_habitacion,
    roomTypeId: String(t.id_tipo_habitacion),
    season: t.temporada,
    channel: t.canal,
    channelId: String(t.id_canal_reserva),
    startDate: toDate(t.fecha_inicio),
    endDate: toDate(t.fecha_fin),
    price: toNumber(t.precio_base),
    active: t.estado === 'ACTIVA',
    history: [],
  }));
}

function mapReservations(rows) {
  return rows.map((r) => {
    const detalles = Array.isArray(r.detalles) ? r.detalles : [];
    const checkInDate = toDate(r.fecha_ingreso);
    const checkOutDate = toDate(r.fecha_salida);
    const nights = daysBetween(checkInDate, checkOutDate);
    const nightlyRate = detalles.reduce((acc, d) => acc + toNumber(d.precio_noche), 0);
    const activeStay = detalles.find((d) => d.estado_estadia === 'EN_CURSO') ?? detalles.find((d) => d.id_estadia);
    return {
      id: String(r.id_reserva),
      code: `RES-${String(r.id_reserva).padStart(5, '0')}`,
      guestId: String(r.id_huesped),
      guestName: `${r.huesped_nombres ?? ''} ${r.huesped_apellidos ?? ''}`.trim(),
      roomId: detalles[0]?.id_habitacion ? String(detalles[0].id_habitacion) : '',
      roomIds: detalles.map((d) => String(d.id_habitacion)),
      details: detalles.map((d) => ({
        id: String(d.id_detalle_reserva),
        roomId: String(d.id_habitacion),
        stayId: d.id_estadia ? String(d.id_estadia) : '',
        stayStatus: d.estado_estadia || '',
      })),
      stayId: activeStay?.id_estadia ? String(activeStay.id_estadia) : '',
      checkInDate,
      checkOutDate,
      nights,
      adults: toNumber(r.cantidad_huespedes),
      children: 0,
      channel: r.canal || '',
      rateName: r.tarifa_nombre || '',
      nightlyRate,
      totalAmount: nightlyRate * nights,
      status: RESERVATION_STATUS_UI[r.estado] ?? titleCase(r.estado),
      specialRequests: r.observaciones || '',
      noShowRisk: null, // sin predicción disponible en la API (g1_reservas.prediccion_no_show)
      createdAt: toDate(r.fecha_reserva),
      history: [],
    };
  });
}

function mapGuests(rows) {
  return rows.map((g) => ({
    id: String(g.id_huesped),
    fullName: `${g.nombres ?? ''} ${g.apellidos ?? ''}`.trim(),
    firstNames: g.nombres || '',
    lastNames: g.apellidos || '',
    documentType: g.tipo_documento || '',
    documentNumber: g.numero_documento || '',
    nationality: g.nacionalidad || '',
    email: g.correo || '',
    phone: g.telefono || '',
    company: g.empresa || '',
    segment: 'Sin segmentar', // lo completa el perfil CRM (M5) si existe
    loyaltyTier: 'Sin nivel',
    loyaltyPoints: 0,
    totalStays: 0,
    totalSpent: 0,
    preferences: [],
    privacyConsentISO27701: Boolean(g.consentimiento_iso27701),
    consentDate: toDate(g.fecha_consentimiento),
    marketingOptIn: Boolean(g.marketing_opt_in),
    notes: g.notas || '',
  }));
}

function mapWaitlist(rows) {
  return rows.map((w) => ({
    id: String(w.id_lista_espera),
    guestId: String(w.id_huesped),
    guestName: w.huesped_nombre,
    contact: '',
    roomType: w.tipo_habitacion,
    checkInDate: toDate(w.fecha_ingreso),
    checkOutDate: toDate(w.fecha_salida),
    conflictType: 'Lista de espera',
    priority: toNumber(w.prioridad),
    status: titleCase(w.estado),
    createdAt: toStamp(w.fecha_registro),
  }));
}

function mapRooms(rows, reservations, ratePlans) {
  // Tarifa vigente más baja por tipo de habitación (referencia de precio base)
  const baseByType = new Map();
  for (const rp of ratePlans) {
    if (!rp.active) continue;
    const cur = baseByType.get(rp.roomTypeId);
    if (cur === undefined || rp.price < cur) baseByType.set(rp.roomTypeId, rp.price);
  }

  const stayByRoom = new Map();
  const reservedTodayByRoom = new Map();
  for (const res of reservations) {
    for (const roomId of res.roomIds) {
      if (res.status === 'Check-in') stayByRoom.set(roomId, res.id);
      if (res.status === 'Confirmada' && res.checkInDate <= TODAY && TODAY < res.checkOutDate) {
        reservedTodayByRoom.set(roomId, res.id);
      }
    }
  }

  return rows.map((r) => {
    const id = String(r.id_habitacion);
    const hk = r.estado_hk;
    const commercialStatus =
      hk === 'OCU'
        ? 'Ocupada'
        : hk === 'FSV'
        ? 'Bloqueada'
        : reservedTodayByRoom.has(id)
        ? 'Reservada'
        : 'Disponible';
    return {
      id,
      number: String(r.numero),
      floor: toNumber(r.piso),
      type: r.tipo_nombre,
      typeId: String(r.id_tipo_habitacion),
      capacity: toNumber(r.capacidad),
      baseRate: baseByType.get(String(r.id_tipo_habitacion)) ?? 0,
      features: mapFeatures(r.caracteristicas),
      commercialStatus,
      housekeepingStatus: HK_STATUS_UI[hk] ?? r.estado_hk_nombre ?? 'Sin estado',
      currentReservationId: stayByRoom.get(id) ?? reservedTodayByRoom.get(id),
      lastInspectedAt: toStamp(r.estado_hk_fecha),
    };
  });
}

/** Garantiza que toda reserva pueda resolver a su huésped aunque esté fuera de las filas cargadas. */
function ensureGuestsForReservations(guests, reservations) {
  const known = new Set(guests.map((g) => g.id));
  const extra = [];
  for (const res of reservations) {
    if (known.has(res.guestId)) continue;
    known.add(res.guestId);
    extra.push({
      id: res.guestId,
      fullName: res.guestName,
      documentType: '',
      documentNumber: '',
      nationality: '',
      email: '',
      phone: '',
      company: '',
      segment: 'Sin segmentar',
      loyaltyTier: 'Sin nivel',
      loyaltyPoints: 0,
      totalStays: 0,
      totalSpent: 0,
      preferences: [],
      privacyConsentISO27701: false,
      consentDate: '',
      marketingOptIn: false,
      notes: '',
    });
  }
  return [...guests, ...extra];
}

// ---------------------------------------------------------------------------------------------
// Carga del estado desde la base de datos (sin datos de ejemplo ni valores de relleno)
// ---------------------------------------------------------------------------------------------

/** Catálogo de recursos: [clave, etiqueta visible, cargador]. Todos se piden en paralelo. */
function buildResourceList() {
  const paged = (path, max = MAX_PAGES_OTHER) => () => fetchAllPages(path, max);
  const data = (path) => () => fetchData(path);
  return [
    // M1
    ['habitaciones', 'habitaciones', paged('/m1/habitaciones', MAX_PAGES_M1)],
    ['huespedes', 'huéspedes', paged('/m1/huespedes', MAX_PAGES_M1)],
    ['reservas', 'reservas', paged('/m1/reservas', MAX_PAGES_M1)],
    ['tarifas', 'tarifas', data('/m1/tarifas')],
    ['listaEspera', 'lista de espera', paged('/m1/lista-espera', MAX_PAGES_M1)],
    ['tarifaDinamica', 'tarifa dinámica', data('/m1/tarifas/dinamica')],
    ['catalogos', 'catálogos de reservas', data('/m1/catalogos')],
    // M2
    ['ordenesLimpieza', 'órdenes de limpieza', paged('/m2/ordenes-limpieza')],
    ['incidencias', 'incidencias', paged('/m2/incidencias')],
    ['ordenesTrabajo', 'órdenes de trabajo', paged('/m2/ordenes-trabajo')],
    ['insumos', 'insumos de housekeeping', data('/m2/insumos')],
    ['activos', 'activos', data('/m2/activos')],
    ['preventivo', 'mantenimiento preventivo', data('/m2/preventivo')],
    ['inspecciones', 'historial de inspecciones', data('/m2/inspecciones')],
    ['catalogosM2', 'catálogos de mantenimiento', data('/m2/catalogos')],
    // M3
    ['catalogo', 'catálogo de servicios', data('/m3/catalogo')],
    ['comandas', 'comandas', paged('/m3/comandas')],
    ['consumos', 'consumos', paged('/m3/consumos')],
    ['inventario', 'inventario', paged('/m3/inventario')],
    ['ordenesCompra', 'órdenes de compra', paged('/m3/ordenes-compra')],
    ['proveedores', 'proveedores', data('/m3/proveedores')],
    ['recetas', 'recetas', data('/m3/recetas')],
    ['requisiciones', 'requisiciones de almacén', data('/m3/requisiciones')],
    // M4
    ['cuentas', 'folios', paged('/m4/cuentas?status=ACTIVA')],
    ['comprobantes', 'comprobantes', paged('/m4/comprobantes')],
    ['turnos', 'turnos de caja', paged('/m4/turnos-caja')],
    ['gastos', 'gastos', paged('/m4/gastos')],
    ['cxc', 'cuentas por cobrar', paged('/m4/cuentas-por-cobrar')],
    // M5
    ['perfiles', 'perfiles de huésped', paged('/m5/perfiles')],
    ['campanas', 'campañas', paged('/m5/campanas')],
    ['reclamos', 'reclamos', paged('/m5/reclamos')],
    ['opiniones', 'encuestas y reseñas', paged('/m5/opiniones')],
    ['solicitudes', 'solicitudes de huésped', paged('/m5/solicitudes')],
    ['segmentos', 'segmentos CRM', async () => {
      const res = await apiV1Request('/m5/segmentos');
      const rows = res?.items ?? res?.data;
      if (!Array.isArray(rows)) throw new Error('Respuesta inesperada de /m5/segmentos');
      return { rows, total: rows.length, truncated: false };
    }],
    // Transversales
    ['resumen', 'notificaciones', data('/dashboard/resumen')],
    ['bitacoras', 'bitácora de auditoría', paged('/auditoria/bitacoras?modulo=ALL', 1)],
  ];
}

/** Detalle (cargos y pagos) de los folios abiertos, con tope y concurrencia limitada. */
async function fetchFolioDetails(cuentas) {
  const targets = cuentas.slice(0, MAX_FOLIO_DETAILS);
  const details = new Map();
  let failed = 0;
  for (let i = 0; i < targets.length; i += FOLIO_DETAIL_CONCURRENCY) {
    const chunk = targets.slice(i, i + FOLIO_DETAIL_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map((c) => apiV1Request(`/m4/cuentas/${encodeURIComponent(c.id_cuenta)}`))
    );
    settled.forEach((r, idx) => {
      if (r.status === 'fulfilled' && r.value?.data) {
        details.set(String(chunk[idx].id_cuenta), r.value.data);
      } else {
        failed += 1;
      }
    });
  }
  return { details, failed, skipped: Math.max(0, cuentas.length - targets.length) };
}

/** Movimientos manuales de caja de los turnos abiertos (normalmente uno). Sin permiso o con error: sin movimientos. */
async function fetchOpenShiftMovements(turnos) {
  const result = new Map();
  const abiertos = turnos.filter((t) => t.estado === 'ABIERTA').slice(0, 5);
  const settled = await Promise.allSettled(
    abiertos.map((t) => apiV1Request(`/m4/turnos-caja/${encodeURIComponent(t.id_turno_caja)}/movimientos`))
  );
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && Array.isArray(r.value?.data)) result.set(String(abiertos[i].id_turno_caja), r.value.data);
  });
  return result;
}

/**
 * Devuelve { state, source, errors, truncated, forbidden }.
 *  - source: 'postgresql_database' | 'partial' | 'error' | 'unauthenticated'
 *  - Nunca rellena con datos ficticios: lo que no se pudo leer queda vacío.
 *  - Un 403 (el rol no tiene permiso sobre ese recurso) NO es error: se informa en `forbidden`.
 */
export async function loadERPState(options = {}) {
  purgeLegacyLocalStorage();
  const state = createEmptyERPState();

  // Sin token de Supabase la API v1 responde 401; no se intenta.
  if (!getSessionToken()) {
    rawCache.clear();
    folioDetailsCache = new Map();
    movementsCache = new Map();
    return { state, source: 'unauthenticated', errors: [], truncated: [], forbidden: [] };
  }

  // Carga completa (sin `keys`) o parcial: solo se vuelven a pedir los recursos indicados y el resto
  // se toma de la caché de la última carga. El estado se recalcula siempre completo (mapeo puro).
  const all = buildResourceList();
  const only = options.keys ? new Set(options.keys) : null;
  if (!only) {
    rawCache.clear();
    folioDetailsCache = new Map();
    movementsCache = new Map();
  }
  const resources = only ? all.filter(([key]) => only.has(key)) : all;
  const settled = await Promise.allSettled(resources.map(([, , load]) => load()));

  const errors = [];
  const truncated = [];
  const forbidden = [];
  resources.forEach(([key, label], i) => {
    const r = settled[i];
    if (r.status === 'rejected') {
      if (r.reason?.status === 403) forbidden.push(label);
      else errors.push({ resource: label, status: r.reason?.status ?? null, message: r.reason?.message || 'Error desconocido' });
      return; // en una carga parcial se conserva lo que había en caché
    }
    if (r.value.truncated) truncated.push(label);
    rawCache.set(key, r.value.rows);
  });
  const list = (key) => (Array.isArray(rawCache.get(key)) ? rawCache.get(key) : []);
  const obj = (key) => {
    const v = rawCache.get(key);
    return v && !Array.isArray(v) ? v : null;
  };

  // ---- M1
  const ratePlans = mapRatePlans(list('tarifas'));
  const reservations = mapReservations(list('reservas'));
  const guestsBase = ensureGuestsForReservations(mapGuests(list('huespedes')), reservations);
  const { guests, perfilToHuesped } = applyPerfiles(guestsBase, list('perfiles'));
  state.ratePlans = ratePlans;
  state.reservations = reservations;
  state.guests = guests;
  state.rooms = mapRooms(list('habitaciones'), reservations, ratePlans);
  state.waitlist = mapWaitlist(list('listaEspera'));
  state.dynamicPricing = mapDynamicPricing(obj('tarifaDinamica'));

  // Movimientos manuales del turno de caja abierto (solo cuando se relee la lista de turnos)
  if (resources.some(([key]) => key === 'turnos') && rawCache.has('turnos')) {
    movementsCache = await fetchOpenShiftMovements(list('turnos'));
  }
  state.catalogs = {
    ...mapCatalogs(obj('catalogos')),
    ...mapExtraCatalogs({ catalogo: obj('catalogo'), catalogosM2: obj('catalogosM2') }),
  };

  // ---- M2, M3, M4, M5
  Object.assign(
    state,
    mapM2({
      ordenesLimpieza: list('ordenesLimpieza'),
      incidencias: list('incidencias'),
      ordenesTrabajo: list('ordenesTrabajo'),
      insumos: list('insumos'),
      activos: list('activos'),
      preventivo: list('preventivo'),
      inspecciones: list('inspecciones'),
    }),
    mapM3({
      catalogo: obj('catalogo'),
      comandas: list('comandas'),
      consumos: list('consumos'),
      inventario: list('inventario'),
      ordenesCompra: list('ordenesCompra'),
      proveedores: list('proveedores'),
      recetas: list('recetas'),
      requisiciones: list('requisiciones'),
    }),
    mapM4({
      comprobantes: list('comprobantes'),
      turnos: list('turnos'),
      gastos: list('gastos'),
      cxc: list('cxc'),
      movimientosPorTurno: movementsCache,
    }),
    mapM5(
      {
        campanas: list('campanas'),
        reclamos: list('reclamos'),
        opiniones: list('opiniones'),
        solicitudes: list('solicitudes'),
        segmentos: list('segmentos'),
      },
      perfilToHuesped
    )
  );

  // Costo del producto: receta vigente o, si se vende tal cual, el costo del artículo ligado. Sin ninguno: sin costo.
  const recipeCostByProduct = new Map(state.recipes.map((r) => [r.productId, r.recipeCost]));
  const unitCostByItem = new Map(state.inventory.map((i) => [i.id, i.unitCost]));
  state.products = state.products.map((p) => {
    const fromRecipe = recipeCostByProduct.get(p.id);
    const fromArticle = p.linkedInventoryItemId ? unitCostByItem.get(p.linkedInventoryItemId) : undefined;
    return {
      ...p,
      cost: fromRecipe ?? fromArticle ?? null,
      stockControl: fromRecipe !== undefined ? 'Receta' : p.linkedInventoryItemId ? 'Directo' : 'Sin control',
    };
  });

  // Habitación y huésped de cada pedido POS: la base solo guarda la estadía.
  state.posOrders = state.posOrders.map((o) => {
    if (!o.stayId) return o;
    const res = reservations.find((r) => r.details.some((d) => d.stayId === o.stayId));
    if (!res) return o;
    const detail = res.details.find((d) => d.stayId === o.stayId);
    const room = state.rooms.find((r) => r.id === detail.roomId);
    return { ...o, roomId: detail.roomId, roomNumber: room?.number || '', guestName: res.guestName };
  });

  // ---- Folios (cuentas abiertas + detalle de cargos y pagos)
  const cuentas = list('cuentas');
  const cuentasReloaded = resources.some(([key]) => key === 'cuentas') && rawCache.has('cuentas');
  if (cuentasReloaded && cuentas.length > 0) {
    const { details, failed, skipped } = await fetchFolioDetails(cuentas);
    folioDetailsCache = details;
    if (failed > 0) {
      errors.push({ resource: 'detalle de folios', status: null, message: `${failed} folio(s) sin detalle de cargos y pagos` });
    }
    if (skipped > 0) truncated.push('detalle de folios');
  }
  state.folios = mapFolios(cuentas, folioDetailsCache);

  // ---- Transversales
  state.notifications = mapNotifications(obj('resumen'));
  state.auditLog = mapAuditLog(list('bitacoras'));

  const attempted = resources.length - forbidden.length;
  const source =
    errors.length === 0 ? 'postgresql_database' : attempted > 0 && errors.length >= attempted ? 'error' : 'partial';
  return { state, source, errors, truncated, forbidden };
}
