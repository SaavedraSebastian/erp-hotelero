/**
 * Estado operativo inicial del ERP: SIN datos.
 *
 * Todo lo que muestra la aplicación debe venir de PostgreSQL (Supabase) a través de /api/v1.
 * Los módulos que todavía no tienen endpoint (M2, M3, M4 y M5) permanecen vacíos hasta que se
 * implemente su API; no se rellenan con datos de ejemplo.
 */

/** Fecha operativa actual en zona horaria de Lima (YYYY-MM-DD). */
export const TODAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

export function createEmptyERPState() {
  return {
    // M1 · Reservas y Recepción
    rooms: [],
    guests: [],
    reservations: [],
    ratePlans: [],
    waitlist: [],
    dashboardSummary: null,
    financeSummary: null,
    dynamicPricing: { horizonDays: 7, rule: [], types: [] },

    // M2 · Housekeeping y Mantenimiento
    staff: [],
    cleaningOrders: [],
    inspections: [],
    incidents: [],
    preventiveSchedules: [],
    workOrders: [],
    assets: [],
    hkSupplies: [],
    supplyRequisitions: [],

    // M3 · Servicios, POS y Almacén
    products: [],
    services: [],
    recipes: [],
    tables: [],
    posOrders: [],
    inventory: [],
    inventoryMovements: [],
    suppliers: [],
    purchaseOrders: [],

    // M4 · Facturación y Finanzas
    folios: [],
    invoices: [],
    receivables: [],
    cashShifts: [],
    expenses: [],

    // M5 · CRM y Huéspedes
    campaigns: [],
    complaints: [],
    guestRequests: [],
    surveys: [],
    reviews: [],

    // Catálogos de referencia que alimentan los formularios de escritura
    catalogs: { roomTypes: [], seasons: [], channels: [] }, // tipos de habitación, temporadas y canales (g1_reservas)
    segments: [], // segmentos CRM (g5_crm.segmento)
    costCenters: [], // centros de costo vistos en gastos (g4_finanzas.centro_costo)

    // Transversales
    notifications: [],
    auditLog: [],
  };
}
