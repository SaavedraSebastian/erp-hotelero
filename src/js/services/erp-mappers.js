/**
 * Mapeo base de datos (g2_housekeeping, g3_servicios, g4_finanzas, g5_crm, auditoría)
 * → modelo de estado que consume la interfaz.
 *
 * Reglas:
 *  - Funciones puras: reciben las filas tal como las devuelve /api/v1 y retornan el estado de la UI.
 *  - Nunca se inventan valores. Lo que la API no entrega queda vacío (''), 0 o null, y la UI lo
 *    muestra como "—" o "Sin dato".
 *  - Los registros anulados se omiten de las listas operativas.
 */

// ---------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------

import { TODAY } from '../data/empty-state.js';

export const toDate = (v) => (v ? String(v).slice(0, 10) : '');
export const toStamp = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : '');
export const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const titleCase = (v) => {
  const s = String(v ?? '').replace(/_/g, ' ').trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
};
const idOf = (v) => (v == null ? '' : String(v));
const optId = (v) => (v == null || v === '' ? undefined : String(v));
const sum = (arr, pick) => arr.reduce((acc, x) => acc + toNumber(pick(x)), 0);
const isAnulado = (v) => /^anul/i.test(String(v ?? ''));

// ---------------------------------------------------------------------------------------------
// M2 · Housekeeping y Mantenimiento
// ---------------------------------------------------------------------------------------------

const CLEANING_STATUS_UI = {
  Pendiente: 'Pendiente',
  Asignada: 'Pendiente',
  'En limpieza': 'En proceso',
  'Pendiente inspección': 'Completada',
  Cerrada: 'Completada',
};
const INCIDENT_STATUS_UI = {
  Abierta: 'Abierta',
  'En atención': 'En reparación',
  Cerrada: 'Resuelta',
};
const WORK_ORDER_STATUS_UI = {
  Pendiente: 'Pendiente',
  Asignada: 'Pendiente',
  'En proceso': 'En ejecución',
  'En espera': 'En espera',
  Cerrada: 'Completada',
};

const FREQUENCY_LABEL = {
  Días: (n) => (n === 1 ? 'Diaria' : `Cada ${n} días`),
  Semanas: (n) => (n === 1 ? 'Semanal' : `Cada ${n} semanas`),
  Meses: (n) => (n === 1 ? 'Mensual' : n === 3 ? 'Trimestral' : n === 12 ? 'Anual' : `Cada ${n} meses`),
  HorasUso: (n) => `Cada ${n} h de uso`,
};

export function mapM2({ ordenesLimpieza = [], incidencias = [], ordenesTrabajo = [], insumos = [], activos = [], preventivo = [], inspecciones = [] }) {
  // No existe endpoint de personal: se deriva de quienes tienen órdenes asignadas.
  const staffMap = new Map();
  const touchStaff = (id, name, area, isActive) => {
    if (id == null || id === '') return;
    const key = String(id);
    const cur = staffMap.get(key) ?? {
      id: key,
      name: name || `Personal ${key}`,
      area,
      specialty: '',
      shift: '',
      activeTasks: 0,
      maxCapacity: 0,
      available: true,
    };
    if (isActive) cur.activeTasks += 1;
    staffMap.set(key, cur);
  };

  const cleaningOrders = [];
  for (const o of ordenesLimpieza) {
    if (isAnulado(o.estado)) continue;
    const status = CLEANING_STATUS_UI[o.estado] ?? o.estado;
    touchStaff(o.id_personal_asignado, o.personal_asignado, 'Housekeeping', status !== 'Completada');
    cleaningOrders.push({
      id: idOf(o.numero_orden),
      roomId: idOf(o.id_habitacion),
      roomNumber: o.numero_habitacion || '',
      type: o.tipo_limpieza || '',
      priority: o.prioridad || '',
      assignedStaffId: optId(o.id_personal_asignado),
      assignedStaffName: o.personal_asignado || '',
      status,
      sourceFlow: o.origen || undefined,
      createdAt: toStamp(o.fecha_hora_creacion),
      startedAt: o.fecha_hora_inicio ? toStamp(o.fecha_hora_inicio) : undefined,
      completedAt: o.fecha_hora_fin ? toStamp(o.fecha_hora_fin) : undefined,
      notes: o.observaciones || '',
    });
  }

  const incidents = [];
  for (const i of incidencias) {
    if (isAnulado(i.estado)) continue;
    incidents.push({
      id: idOf(i.numero_incidencia),
      code: `INC-${i.numero_incidencia}`,
      roomId: idOf(i.id_habitacion),
      location: i.numero_habitacion ? `Habitación ${i.numero_habitacion}` : i.activo_nombre || 'Sin ubicación',
      category: i.activo_nombre ? 'Equipo' : i.origen || '',
      description: i.descripcion || '',
      priority: i.criticidad || '',
      status: INCIDENT_STATUS_UI[i.estado] ?? i.estado,
      assignedStaffId: undefined,
      reportedBy: i.origen || '',
      linkedComplaintId: optId(i.id_reclamo),
      createdAt: toStamp(i.fecha_hora_registro),
    });
  }

  const workOrders = [];
  for (const w of ordenesTrabajo) {
    if (isAnulado(w.estado)) continue;
    const status = WORK_ORDER_STATUS_UI[w.estado] ?? w.estado;
    touchStaff(w.id_tecnico, w.tecnico_nombre, 'Mantenimiento', status !== 'Completada');
    workOrders.push({
      id: idOf(w.numero_ot),
      code: `OT-${w.numero_ot}`,
      incidentId: '',
      roomNumber: '',
      location: w.activo_nombre || '',
      description: w.descripcion_tarea || '',
      assignedStaffId: optId(w.id_tecnico),
      assignedStaffName: w.tecnico_nombre || '',
      priority: w.prioridad || '',
      status,
      estimatedCost: toNumber(w.costo_total),
      partsUsed: '',
      createdAt: toStamp(w.fecha_hora_creacion),
      resolutionNotes: w.trabajo_realizado || undefined,
      completedAt: w.fecha_hora_cierre ? toStamp(w.fecha_hora_cierre) : undefined,
    });
  }

  const hkSupplies = insumos.map((i) => ({
    id: idOf(i.id_insumo),
    inventoryItemId: idOf(i.id_articulo),
    name: i.nombre || '',
    unit: i.unidad_medida || '',
    localStock: toNumber(i.stock_actual),
    minStock: toNumber(i.punto_reposicion),
    dailyConsumption: 0, // sin dato en la API
  }));

  const assets = activos.map((a) => ({
    id: idOf(a.id_activo),
    code: a.codigo_activo || '',
    name: a.nombre || '',
    category: a.tipo_nombre || '',
    typeId: idOf(a.id_tipo_activo),
    roomId: idOf(a.id_habitacion),
    areaId: idOf(a.id_area),
    roomNumber: a.numero_habitacion || a.area_nombre || '',
    brand: a.marca || '',
    model: a.modelo || '',
    purchaseDate: toDate(a.fecha_instalacion),
    condition: a.estado || '',
    hoursUsed: toNumber(a.horas_uso_acumuladas),
    // Probabilidad de falla de la última evaluación predictiva; null si el activo nunca fue evaluado.
    predictedFailureRisk: a.probabilidad_falla == null ? null : Math.round(toNumber(a.probabilidad_falla) * 100),
  }));

  const preventiveSchedules = preventivo.map((p) => {
    const next = toDate(p.fecha_proxima_ejecucion);
    const label = (FREQUENCY_LABEL[p.tipo_periodicidad] ?? ((n) => `${p.tipo_periodicidad} ${n}`))(toNumber(p.valor_periodicidad));
    return {
      id: `${p.id_plan}-${p.id_activo}`,
      planId: idOf(p.id_plan),
      assetId: idOf(p.id_activo),
      assetName: p.activo_nombre || '',
      location: p.ubicacion || '',
      frequency: label,
      nextDate: next || (p.horas_proxima_ejecucion ? `a las ${p.horas_proxima_ejecucion} h de uso` : ''),
      lastCompletedDate: toDate(p.fecha_ultima_ejecucion) || undefined,
      assignedStaffId: undefined,
      status: p.estado_plan !== 'A' ? 'Inactivo' : next && next < TODAY ? 'Vencido' : 'Programado',
      notes: p.tarea || '',
    };
  });

  const inspections = inspecciones.map((i) => ({
    id: String(i.id_inspeccion),
    cleaningOrderId: String(i.numero_orden),
    roomNumber: i.numero_habitacion ?? '',
    inspector: i.supervisor || 'Sin supervisor registrado',
    date: toStamp(i.fecha_hora),
    result: i.resultado === 'Conforme' ? 'Aprobada' : 'Rechazada',
    observations: i.motivo_rechazo || '',
    checklist: i.lista_verificacion && typeof i.lista_verificacion === 'object' ? i.lista_verificacion : {},
  }));

  return { cleaningOrders, incidents, workOrders, hkSupplies, assets, preventiveSchedules, inspections, staff: [...staffMap.values()] };
}

/** Mapeos de filas sueltas (listados paginados). */
export const mapInvoiceRows = (rows) => mapM4({ comprobantes: rows }).invoices;
export const mapReceivableRows = (rows) => mapM4({ cxc: rows }).receivables;
export const mapExpenseRows = (rows) => mapM4({ gastos: rows }).expenses;
export const mapComandaRows = (rows) => mapM3({ comandas: rows }).posOrders;
export const mapConsumoRows = (rows) => mapM3({ consumos: rows }).posOrders;
export const mapPurchaseOrderRows = (rows) => mapM3({ ordenesCompra: rows }).purchaseOrders;
export const mapCleaningRows = (rows) => mapM2({ ordenesLimpieza: rows }).cleaningOrders;
export const mapIncidentRows = (rows) => mapM2({ incidencias: rows }).incidents;
export const mapWorkOrderRows = (rows) => mapM2({ ordenesTrabajo: rows }).workOrders;
export const mapInspectionRows = (rows) => mapM2({ inspecciones: rows }).inspections;

/** Tarifa dinámica: ocupación proyectada, demanda en espera y ajuste sugerido por tipo de habitación (calculado en el servidor). */
export function mapDynamicPricing(raw) {
  if (!raw || !Array.isArray(raw.tipos)) return { horizonDays: 7, rule: [], types: [] };
  return {
    horizonDays: Number(raw.horizonte_dias) || 7,
    rule: (raw.regla ?? []).map((t) => ({ from: Number(t.desde), adjustPct: Number(t.ajuste_pct) })),
    types: raw.tipos.map((t) => ({
      id: String(t.id_tipo_habitacion),
      name: t.tipo,
      rooms: Number(t.habitaciones) || 0,
      occupiedNights: Number(t.noches_ocupadas) || 0,
      availableNights: Number(t.noches_disponibles) || 0,
      occupancyPct: Math.round((Number(t.ocupacion_proyectada) || 0) * 100),
      waiting: Number(t.en_espera) || 0,
      currentRate: t.precio_vigente == null ? null : Number(t.precio_vigente),
      activeRates: Number(t.tarifas_vigentes) || 0,
      suggestedPct: Number(t.ajuste_sugerido_pct) || 0,
      suggestedRate: t.precio_sugerido == null ? null : Number(t.precio_sugerido),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// M3 · Servicios, POS y Almacén
// ---------------------------------------------------------------------------------------------

const COMANDA_STATUS_UI = {
  pendiente: 'Pendiente',
  'en preparación': 'Preparando',
  lista: 'Lista',
  entregada: 'Entregado',
  cancelada: 'Cancelada',
};
const CONSUMO_STATUS_UI = {
  'por confirmar': 'Pendiente',
  confirmado: 'Cobrado',
  descartado: 'Descartado',
  anulado: 'Anulado',
};
const ACTIVE_COMANDA = new Set(['pendiente', 'en preparación', 'lista']);

/** Nombre real del punto de venta → categoría que usan las pantallas (Restaurante, Bar, Minibar, Cafetería). */
export function posCategory(name) {
  const n = String(name ?? '');
  if (/mini/i.test(n)) return 'Minibar';
  if (/bar/i.test(n)) return 'Bar';
  if (/rest|terraza|comedor/i.test(n)) return 'Restaurante';
  if (/caf/i.test(n)) return 'Cafetería';
  return n;
}

/** Catálogos de Reservas que alimentan los formularios de habitación y tarifa. */
export function mapCatalogs(cat) {
  return {
    roomTypes: (cat?.tipos ?? []).map((t) => ({
      id: idOf(t.id),
      name: t.nombre || '',
      capacity: toNumber(t.capacidad),
      features: Array.isArray(t.caracteristicas) ? t.caracteristicas.map(String) : [],
    })),
    seasons: (cat?.temporadas ?? []).map((t) => ({
      id: idOf(t.id),
      name: t.nombre || '',
      startDate: toDate(t.fecha_inicio),
      endDate: toDate(t.fecha_fin),
    })),
    channels: (cat?.canales ?? []).map((c) => ({ id: idOf(c.id), name: c.nombre || '' })),
  };
}

/** Catálogos de apoyo a los formularios de M2 y M3 (puntos de venta, categorías, unidades, tipos de activo y áreas). */
export function mapExtraCatalogs({ catalogo, catalogosM2 } = {}) {
  const byUse = (uso) =>
    (catalogo?.categorias ?? []).filter((c) => c.uso === uso).map((c) => ({ id: idOf(c.id_categoria), name: c.nombre || '' }));
  return {
    posPoints: (catalogo?.puntos_venta ?? []).map((p) => ({ id: idOf(p.id_punto_venta), name: p.nombre || '' })),
    menuCategories: byUse('catálogo'),
    stockCategories: byUse('almacén'),
    units: (catalogo?.unidades ?? []).map((u) => ({ id: idOf(u.id_unidad_medida), name: u.nombre || '', symbol: u.simbolo || '' })),
    assetTypes: (catalogosM2?.tipos_activo ?? []).map((t) => ({ id: idOf(t.id), name: t.nombre || '' })),
    areas: (catalogosM2?.areas ?? []).map((a) => ({ id: idOf(a.id), name: a.nombre || '' })),
  };
}

const REQUISITION_STATUS_UI = {
  pendiente: 'Solicitada',
  atendida: 'Entregada',
  'parcialmente atendida': 'Entregada parcial',
  'no atendida': 'No atendida',
};

export function mapM3({
  catalogo,
  comandas = [],
  consumos = [],
  inventario = [],
  ordenesCompra = [],
  proveedores = [],
  recetas = [],
  requisiciones = [],
}) {
  const puntos = new Map((catalogo?.puntos_venta ?? []).map((p) => [String(p.id_punto_venta), p.nombre]));
  const items = catalogo?.items ?? [];

  const products = items
    .filter((it) => it.tipo_item !== 'servicio')
    .map((it) => ({
      id: idOf(it.id_item_catalogo),
      sku: idOf(it.id_item_catalogo),
      name: it.nombre || '',
      category: posCategory(it.punto_venta_nombre),
      posId: idOf(it.id_punto_venta),
      pointOfSale: it.punto_venta_nombre || '',
      categoryId: idOf(it.id_categoria),
      itemType: it.tipo_item || '',
      price: toNumber(it.precio_vigente),
      cost: 0, // sin dato en la API
      available: it.estado === 'activo',
      stockControl: it.id_articulo_descuento ? 'Directo' : 'Sin control',
      linkedInventoryItemId: optId(it.id_articulo_descuento),
    }));

  const services = items
    .filter((it) => it.tipo_item === 'servicio')
    .map((it) => ({
      id: idOf(it.id_item_catalogo),
      code: idOf(it.id_item_catalogo),
      name: it.nombre || '',
      area: it.punto_venta_nombre || '',
      posId: idOf(it.id_punto_venta),
      categoryId: idOf(it.id_categoria),
      price: toNumber(it.precio_vigente),
      cost: 0,
      durationMinutes: it.duracion_estimada != null ? toNumber(it.duracion_estimada) : undefined,
      active: it.estado === 'activo',
      description: '',
    }));

  const activeByTable = new Map();
  for (const c of comandas) {
    if (c.id_mesa != null && ACTIVE_COMANDA.has(c.estado)) activeByTable.set(String(c.id_mesa), c.numero_comanda);
  }
  // Los nombres de mesa se repiten entre puntos de venta ("Mesa 1"): se desambiguan para poder elegirlas.
  const mesaNameCount = new Map();
  for (const m of catalogo?.mesas ?? []) mesaNameCount.set(m.nombre, (mesaNameCount.get(m.nombre) ?? 0) + 1);
  const tables = (catalogo?.mesas ?? []).map((m) => {
    const id = idOf(m.id_mesa);
    const activeOrderId = activeByTable.get(id);
    const zone = puntos.get(String(m.id_punto_venta)) || '';
    return {
      id,
      number: mesaNameCount.get(m.nombre) > 1 ? `${m.nombre} · ${posCategory(zone)}` : m.nombre || id,
      posId: idOf(m.id_punto_venta),
      zone,
      seats: 0, // sin dato en la API
      status: activeOrderId ? 'Ocupada' : m.estado === 'activa' ? 'Libre' : 'Inactiva',
      activeOrderId,
    };
  });

  const detailItems = (detalles, priceKey) =>
    (Array.isArray(detalles) ? detalles : []).map((d) => {
      const quantity = toNumber(d.cantidad);
      const unitPrice = toNumber(d[priceKey]);
      return {
        id: idOf(d.id_item_catalogo),
        name: d.nombre_item || '',
        quantity,
        unitPrice,
        subtotal: d.importe != null ? toNumber(d.importe) : quantity * unitPrice,
      };
    });

  const posOrders = [];
  for (const c of comandas) {
    const orderItems = detailItems(c.detalles, 'precio_capturado');
    posOrders.push({
      id: idOf(c.numero_comanda),
      code: idOf(c.numero_comanda),
      kind: 'comanda',
      rawStatus: c.estado,
      posId: idOf(c.id_punto_venta),
      tableId: idOf(c.id_mesa),
      stayId: idOf(c.id_estadia_externa),
      source: c.modalidad === 'habitación' ? 'Room Service' : 'Restaurante',
      tableNumber: c.nombre_mesa_capturado || undefined,
      roomId: '',
      roomNumber: c.numero_habitacion || '',
      guestName: c.huesped_nombre || '',
      items: orderItems,
      total: sum(orderItems, (i) => i.subtotal),
      paymentMode: '',
      status: COMANDA_STATUS_UI[c.estado] ?? titleCase(c.estado),
      createdAt: toStamp(c.fecha_hora_apertura),
      createdBy: c.usuario_responsable || '',
    });
  }
  for (const c of consumos) {
    posOrders.push({
      id: idOf(c.numero_consumo),
      code: idOf(c.numero_consumo),
      kind: 'consumo',
      rawStatus: c.estado,
      posId: idOf(c.id_punto_venta),
      stayId: idOf(c.id_estadia_externa),
      accountId: idOf(c.id_cuenta_cobro_externa),
      source: /minibar/i.test(c.punto_venta_nombre || '') ? 'Minibar' : 'Servicios Complementarios',
      roomId: '',
      roomNumber: c.numero_habitacion || '',
      guestName: c.huesped_nombre || '',
      items: detailItems(c.detalles, 'precio_capturado'),
      total: toNumber(c.importe_total),
      paymentMode: c.forma_cobro || '',
      status: CONSUMO_STATUS_UI[c.estado] ?? titleCase(c.estado),
      createdAt: toStamp(c.fecha_hora_registro),
      createdBy: c.usuario_responsable || '',
    });
  }

  const inventory = inventario.map((a) => ({
    id: idOf(a.id_articulo),
    sku: idOf(a.id_articulo),
    name: a.nombre || '',
    category: a.categoria || '',
    unit: a.unidad || '',
    stock: toNumber(a.stock_actual),
    minStock: toNumber(a.stock_minimo),
    unitCost: toNumber(a.costo_unitario), // costo del último lote recibido
    expiryDate: a.proximo_vencimiento ? toDate(a.proximo_vencimiento) : undefined, // lote con stock que vence primero
    categoryId: idOf(a.id_categoria),
    supplierId: '',
  }));

  const recipes = recetas.map((r) => {
    const ingredients = (r.ingredientes ?? []).map((i) => ({
      inventoryItemId: idOf(i.id_articulo),
      itemName: i.articulo || '',
      quantity: toNumber(i.cantidad_por_porcion),
      unit: i.unidad || '',
      unitCost: toNumber(i.costo_unitario),
    }));
    const recipeCost = Number(ingredients.reduce((acc, x) => acc + x.quantity * x.unitCost, 0).toFixed(2));
    const salePrice = toNumber(r.precio_vigente);
    return {
      id: idOf(r.id_receta),
      productId: idOf(r.id_item_catalogo),
      productName: r.item_nombre || '',
      version: toNumber(r.numero_version),
      salePrice,
      recipeCost,
      marginPct: salePrice > 0 ? Math.round(((salePrice - recipeCost) / salePrice) * 100) : 0,
      ingredients,
    };
  });

  const supplyRequisitions = requisiciones.map((r) => ({
    id: idOf(r.id),
    code: idOf(r.id),
    requestedByArea: 'Housekeeping',
    requestedByUser: '',
    inventoryItemId: idOf(r.id_articulo),
    itemName: r.articulo || '',
    quantity: toNumber(r.cantidad_solicitada),
    deliveredQuantity: r.cantidad_atendida != null ? toNumber(r.cantidad_atendida) : undefined,
    unit: r.unidad || '',
    stock: toNumber(r.stock_actual),
    status: REQUISITION_STATUS_UI[r.estado] ?? titleCase(r.estado),
    createdAt: toStamp(r.fecha_hora_recepcion),
    notes: r.motivo_no_atencion || '',
  }));

  // No existe endpoint de proveedores: se derivan de las órdenes de compra.
  const supplierMap = new Map();
  for (const o of ordenesCompra) {
    const id = idOf(o.id_proveedor);
    if (!supplierMap.has(id)) {
      supplierMap.set(id, {
        id,
        ruc: '',
        name: o.proveedor_nombre || id,
        category: '',
        contactName: '',
        phone: '',
        email: '',
        leadTimeDays: 0,
        rating: null,
      });
    }
  }

  // Con el endpoint de proveedores se usan los reales; si no hay acceso, quedan los derivados de las OC.
  const suppliers =
    proveedores.length > 0
      ? proveedores.map((p) => ({
          id: idOf(p.id_proveedor),
          ruc: p.ruc || '',
          name: p.razon_social || '',
          category: '',
          contactName: '',
          phone: p.telefono || '',
          email: p.correo || '',
          leadTimeDays: toNumber(p.plazo_entrega_dias),
          rating: null,
          active: p.estado === 'activo',
        }))
      : [...supplierMap.values()];

  const purchaseOrders = ordenesCompra.map((o) => ({
    id: idOf(o.numero_orden),
    code: idOf(o.numero_orden),
    supplierId: idOf(o.id_proveedor),
    supplierName: o.proveedor_nombre || '',
    items: (Array.isArray(o.detalles) ? o.detalles : []).map((d) => ({
      id: idOf(d.id_detalle_orden),
      inventoryItemId: idOf(d.id_articulo),
      itemName: d.articulo || '',
      quantity: toNumber(d.cantidad_solicitada),
      unitCost: toNumber(d.precio_referencia),
    })),
    total: toNumber(o.total_estimado),
    status: o.estado === 'completada' ? 'Recibida' : titleCase(o.estado),
    createdAt: toStamp(o.fecha_hora_preparacion),
  }));

  return { products, services, tables, posOrders, inventory, suppliers, purchaseOrders, recipes, supplyRequisitions };
}

// ---------------------------------------------------------------------------------------------
// M4 · Facturación y Finanzas
// ---------------------------------------------------------------------------------------------

/** cuentas = filas de /m4/cuentas; detalles = Map(id_cuenta → detalle de /m4/cuentas/:id). */
export function mapFolios(cuentas = [], detalles = new Map()) {
  return cuentas.map((c) => {
    const id = idOf(c.id_cuenta);
    const det = detalles.get(id);
    const charges = (det?.consumos ?? [])
      .filter((x) => !isAnulado(x.estado))
      .map((x) => ({
        id: idOf(x.id_consumo),
        date: toDate(x.fecha),
        category: x.area || 'Consumo',
        description: x.concepto || '',
        amount: toNumber(x.importe),
        sourceModule: '',
        referenceCode: x.numero_consumo_origen || '',
      }));
    const payments = (det?.cobros ?? [])
      .filter((x) => !isAnulado(x.estado))
      .map((x) => ({
        id: idOf(x.id_cobro),
        date: toDate(x.fecha_hora),
        amount: toNumber(x.monto),
        method: x.medio_pago || '',
        reference: idOf(x.id_comprobante),
        receivedBy: idOf(x.id_usuario),
      }));
    return {
      id,
      code: id,
      reservationId: idOf(c.id_reserva),
      guestId: idOf(c.id_huesped),
      guestName: c.huesped_nombre || '',
      roomNumber: c.numero_habitacion || '',
      status: c.estado === 'ACTIVA' ? 'Abierto' : 'Cerrado',
      charges,
      payments,
      totalCharges: sum(charges, (x) => x.amount),
      totalPayments: sum(payments, (x) => x.amount),
      balance: toNumber(c.saldo_pendiente),
      openedAt: toStamp(c.fecha_apertura),
    };
  });
}

export function mapM4({ comprobantes = [], turnos = [], gastos = [], cxc = [], movimientosPorTurno = new Map() }) {
  const invoices = comprobantes.map((c) => ({
    id: idOf(c.id_comprobante),
    type: titleCase(c.tipo),
    series: c.serie || '',
    number: idOf(c.correlativo),
    customerName: c.razon_social_cliente || '',
    customerDoc: c.numero_documento_cliente || '',
    subtotal: toNumber(c.operacion_gravada),
    igv: toNumber(c.igv),
    total: toNumber(c.total),
    status: titleCase(c.estado),
    sunatStatus: c.cdr_estado || titleCase(c.estado),
    issuedAt: toStamp(c.fecha_emision),
    issuedBy: idOf(c.id_usuario),
    items: [],
  }));

  const receivables = cxc.map((r) => ({
    id: idOf(r.id_cxc),
    clientName: r.razon_social_cliente || '',
    documentRef: r.referencia_documento || '',
    issueDate: toDate(r.fecha_emision),
    dueDate: toDate(r.fecha_vencimiento),
    originalAmount: toNumber(r.monto_original),
    paidAmount: toNumber(r.monto_pagado),
    pendingAmount: toNumber(r.saldo_pendiente),
    status: titleCase(r.estado),
    followUpNote: r.nota_seguimiento || '',
  }));

  const cashShifts = turnos.map((t) => ({
    id: idOf(t.id_turno_caja),
    cashier: idOf(t.id_usuario),
    openedAt: toStamp(t.fecha_apertura),
    openingBalance: toNumber(t.saldo_inicial),
    totalInflows: toNumber(t.cobros_efectivo) + toNumber(t.ingresos_manuales),
    totalOutflows: toNumber(t.egresos_manuales),
    // Turno abierto: saldo vigente calculado por el servidor; cerrado: el esperado que quedó registrado.
    expectedBalance:
      t.estado === 'ABIERTA'
        ? toNumber(t.saldo_calculado ?? t.saldo_inicial)
        : toNumber(t.saldo_esperado ?? t.saldo_inicial),
    status: titleCase(t.estado),
    movements: (movimientosPorTurno.get(idOf(t.id_turno_caja)) ?? []).map((m) => ({
      id: idOf(m.id_movimiento_caja),
      time: toStamp(m.fecha_hora).slice(11, 16),
      type: m.tipo === 'INGRESO' ? 'Ingreso' : 'Egreso',
      method: '',
      concept: m.motivo || '',
      amount: toNumber(m.importe),
    })),
  }));

  // No existe endpoint de centros de costo: se derivan de los gastos registrados.
  const costCenterMap = new Map();
  for (const g of gastos) {
    if (g.id_centro_costo == null) continue;
    const id = String(g.id_centro_costo);
    if (!costCenterMap.has(id)) costCenterMap.set(id, { id, name: g.centro_costo || id });
  }

  const expenses = gastos.map((g) => ({
    id: idOf(g.id_gasto),
    costCenterId: idOf(g.id_centro_costo),
    date: toDate(g.fecha),
    category: g.categoria || '',
    costCenter: g.centro_costo || '',
    supplier: g.proveedor || '',
    description: g.concepto || '',
    amount: toNumber(g.monto),
    status: titleCase(g.estado),
    documentRef: g.comprobante_sustento || '',
  }));

  return { invoices, receivables, cashShifts, expenses, costCenters: [...costCenterMap.values()] };
}

// ---------------------------------------------------------------------------------------------
// M5 · CRM y Huéspedes
// ---------------------------------------------------------------------------------------------

const SENTIMENT_UI = { POSITIVO: 'Positivo', NEUTRO: 'Neutral', NEGATIVO: 'Negativo' };
const COMPLAINT_STATUS_UI = {
  REGISTRADO: 'Registrado',
  DERIVADO: 'Derivado',
  EN_ATENCION: 'En atención',
  CERRADO: 'Resuelto',
};
const CAMPAIGN_STATUS_UI = {
  PROGRAMADA: 'Programada',
  ACTIVA: 'Activa',
  CERRADA: 'Finalizada',
  CANCELADA: 'Cancelada',
};

/**
 * Enriquece la lista de huéspedes (M1) con el perfil CRM (segmento, puntos, estadías, valor).
 * Si el huésped no está en M1, se agrega desde el perfil.
 * Devuelve { guests, perfilToHuesped }.
 */
export function applyPerfiles(guests, perfiles = []) {
  const byId = new Map(guests.map((g) => [g.id, g]));
  const perfilToHuesped = new Map();
  const extra = [];

  for (const p of perfiles) {
    const guestId = idOf(p.id_huesped);
    perfilToHuesped.set(Number(p.id_perfil), guestId);
    const crm = {
      profileId: idOf(p.id_perfil),
      segment: p.segmento_nombre || 'Sin segmentar',
      loyaltyPoints: toNumber(p.saldo_puntos),
      totalStays: toNumber(p.total_estadias),
      totalSpent: toNumber(p.valor_acumulado),
    };
    const existing = byId.get(guestId);
    if (existing) {
      Object.assign(existing, crm);
    } else {
      const g = {
        id: guestId,
        fullName: `${p.nombres ?? ''} ${p.apellidos ?? ''}`.trim(),
        firstNames: p.nombres || '',
        lastNames: p.apellidos || '',
        documentType: p.tipo_documento || '',
        documentNumber: p.numero_documento || '',
        nationality: p.nacionalidad || '',
        email: p.correo || '',
        phone: p.telefono || '',
        company: p.empresa || '',
        loyaltyTier: 'Sin nivel',
        preferences: [],
        privacyConsentISO27701: Boolean(p.consentimiento_iso27701),
        consentDate: toDate(p.fecha_consentimiento),
        marketingOptIn: Boolean(p.marketing_opt_in),
        notes: p.notas || '',
        ...crm,
      };
      byId.set(guestId, g);
      extra.push(g);
    }
  }
  return { guests: [...guests, ...extra], perfilToHuesped };
}

/** Mapeos reutilizables por los listados paginados de CRM. */
export const mapCRMProfiles = (rows = []) => applyPerfiles([], rows).guests;

export function mapM5(
  { campanas = [], reclamos = [], opiniones = [], solicitudes = [], segmentos = [] },
  perfilToHuesped = new Map()
) {
  const guestOf = (idPerfil) => perfilToHuesped.get(Number(idPerfil)) ?? '';

  const segments = segmentos.map((s) => ({
    id: idOf(s.id_segmento),
    code: s.codigo_segmento || '',
    name: s.nombre || '',
  }));

  const campaigns = campanas.map((c) => ({
    id: idOf(c.id_campana),
    name: c.nombre || '',
    segment: c.segmento_nombre || '',
    channel: titleCase(c.canal),
    status: CAMPAIGN_STATUS_UI[c.estado] ?? titleCase(c.estado),
    sentCount: toNumber(c.envios_exitosos),
    openRate: null, // la API no registra aperturas
    conversionCount: null,
    offerDescription: c.mensaje || '',
    createdAt: toDate(c.fecha_inicio),
  }));

  const complaints = reclamos.map((r) => ({
    id: idOf(r.id_reclamo),
    code: r.codigo_seguimiento || idOf(r.id_reclamo),
    guestId: guestOf(r.id_perfil),
    guestName: r.huesped_nombre || '',
    roomNumber: '',
    category: r.area_nombre || titleCase(r.tipo),
    severity: r.prioridad === 'CRITICA' ? 'Alta' : 'Media',
    sentiment: SENTIMENT_UI[r.sentimiento_ia] ?? 'Sin clasificar',
    description: r.descripcion || '',
    assignedTo: r.area_nombre || '',
    status: COMPLAINT_STATUS_UI[r.estado] ?? titleCase(r.estado),
    linkedIncidentId: optId(r.id_incidencia_g2),
    createdAt: toStamp(r.fecha_registro),
    history: (r.seguimiento ?? []).map((s) => ({
      timestamp: toStamp(s.fecha_hora),
      note: s.observacion || `${titleCase(s.estado_anterior || 'Sin estado')} → ${titleCase(s.estado_nuevo)}`,
      user: s.usuario || '',
    })),
  }));

  const guestRequests = solicitudes.map((s) => ({
    id: idOf(s.id_solicitud_huesped),
    code: s.codigo || idOf(s.id_solicitud_huesped),
    guestId: guestOf(s.id_perfil),
    guestName: s.huesped_nombre || '',
    roomNumber: s.numero_habitacion || '',
    type: s.tipo || '',
    targetArea: s.area_destino || '',
    description: s.descripcion || '',
    status: s.estado || '',
    source: s.origen || '',
    createdAt: toStamp(s.fecha_creacion),
  }));

  const surveys = [];
  const reviews = [];
  for (const o of opiniones) {
    const base = {
      id: idOf(o.id_opinion),
      guestId: guestOf(o.id_perfil),
      guestName: o.huesped_nombre || '',
      date: toDate(o.fecha_recepcion),
    };
    if (o.tipo_opinion === 'ENCUESTA') {
      const nps = o.puntaje != null ? toNumber(o.puntaje) : null;
      surveys.push({
        ...base,
        overallScore: nps != null ? Number((nps / 2).toFixed(1)) : 0, // NPS 0-10 expresado en escala 0-5
        npsScore: nps,
        cleanliness: null,
        service: null,
        food: null,
        comment: o.texto_seudonimizado || '',
      });
    } else {
      reviews.push({
        ...base,
        channel: o.canal || 'Directo',
        rating: toNumber(o.calificacion),
        sentiment: SENTIMENT_UI[o.sentimiento_ia] ?? 'Sin clasificar',
        topic: o.titulo || o.motivo || '',
        text: o.texto_seudonimizado || '',
        hotelReply: o.respuesta_hotel || undefined,
      });
    }
  }

  return { campaigns, complaints, guestRequests, surveys, reviews, segments };
}

export const mapCampaignRows = (rows = []) => mapM5({ campanas: rows }).campaigns;
export const mapComplaintRows = (rows = []) => mapM5({ reclamos: rows }).complaints;
export const mapGuestRequestRows = (rows = []) => mapM5({ solicitudes: rows }).guestRequests;
export const mapSurveyRows = (rows = []) => mapM5({ opiniones: rows }).surveys;
export const mapReviewRows = (rows = []) => mapM5({ opiniones: rows }).reviews;

// ---------------------------------------------------------------------------------------------
// Transversales: notificaciones y auditoría
// ---------------------------------------------------------------------------------------------

const asArray = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.replace(/[{}]/g, '').split(',').filter(Boolean) : []);

export function mapNotifications(resumen) {
  const rows = Array.isArray(resumen?.notificaciones) ? resumen.notificaciones : [];
  return rows.map((n) => ({
    id: idOf(n.id_evento),
    timestamp: toStamp(n.fecha_hora),
    sourceModule: String(n.modulo_origen || '').toLowerCase(),
    targetModules: asArray(n.modulos_destino).map((m) => String(m).trim().toLowerCase()),
    title: n.titulo || '',
    message: n.mensaje || '',
    severity: ['info', 'success', 'warning', 'error'].includes(n.severidad) ? n.severidad : 'info',
    read: Boolean(n.leida),
  }));
}

export function mapAuditLog(rows = []) {
  return rows.map((a) => ({
    id: idOf(a.id),
    timestamp: toStamp(a.fechaHora),
    user: a.usuario || '',
    role: '',
    module: String(a.modulo || '').toLowerCase(),
    action: a.detalle ? `${a.accion} — ${a.detalle}` : a.accion || '',
    entityRef: a.entidadRef || '',
    privacyImpact: Boolean(a.impactoPrivacidad),
  }));
}

const SHORT_MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];

/** Resumen financiero calculado en el servidor (totales, series semanal y mensual, desglose por área). */
export function mapFinanceSummary(raw) {
  if (!raw || !raw.totales) return null;
  const weekly = (raw.semanal ?? []).map((w, i, arr) => ({
    month: i === arr.length - 1 ? 'Últ. 7 días' : `${String(w.desde).slice(8, 10)}/${String(w.desde).slice(5, 7)}`,
    ingresos: Number(w.ingresos) || 0,
    egresos: Number(w.egresos) || 0,
  }));
  const monthly = (raw.mensual ?? []).map((m, i, arr) => ({
    month: `${SHORT_MONTHS[Number(String(m.mes).slice(5, 7)) - 1] ?? m.mes}${i === arr.length - 1 ? ' (a hoy)' : ''}`,
    ingresos: Number(m.ingresos) || 0,
    egresos: Number(m.egresos) || 0,
  }));
  return {
    from: raw.desde,
    to: raw.hasta,
    billed: Number(raw.totales.facturado) || 0,
    collected: Number(raw.totales.cobrado) || 0,
    receivable: Number(raw.totales.por_cobrar) || 0,
    expenses: Number(raw.totales.gastos) || 0,
    pendingExpenses: Number(raw.totales.gastos_pendientes) || 0,
    servicesSales: Number(raw.totales.ventas_servicios) || 0,
    servicesCount: Number(raw.totales.cantidad_servicios) || 0,
    weekly,
    monthly,
    areas: (raw.areas ?? []).map((a) => ({ name: a.nombre || 'Sin clasificar', ingresos: Math.round(Number(a.ingresos) || 0), costos: Math.round(Number(a.costos) || 0) })),
  };
}
