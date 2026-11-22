import os, re

def rw(p, fn):
    s = open(p, encoding='utf-8').read()
    s = fn(s)
    open(p + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(p + '.tmp', p)

def rep(s, a, b, count=1):
    assert s.count(a) == count, (a[:80], s.count(a))
    return s.replace(a, b)

# ---------- mapeos
def mappers(s):
    s = rep(s, "/** Mapeos de filas sueltas (listados paginados). */", """/** Mapeos de filas sueltas (listados paginados). */
export const mapInvoiceRows = (rows) => mapM4({ comprobantes: rows }).invoices;
export const mapReceivableRows = (rows) => mapM4({ cxc: rows }).receivables;
export const mapExpenseRows = (rows) => mapM4({ gastos: rows }).expenses;""")
    s += '''
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
    weekly,
    monthly,
    areas: (raw.areas ?? []).map((a) => ({ name: a.nombre || 'Sin clasificar', ingresos: Math.round(Number(a.ingresos) || 0), costos: Math.round(Number(a.costos) || 0) })),
  };
}
'''
    return s
rw('src/js/services/erp-mappers.js', mappers)

# ---------- adaptador
def adapter(s):
    s = rep(s, "    ['comprobantes', 'comprobantes', paged('/m4/comprobantes')],", "    ['comprobantes', 'comprobantes recientes', paged('/m4/comprobantes', 1)],\n    ['reportes', 'resumen financiero', data('/m4/reportes/resumen')],")
    s = rep(s, "    ['turnos', 'turnos de caja', paged('/m4/turnos-caja')],", "    ['turnos', 'turno de caja abierto', paged('/m4/turnos-caja?status=ABIERTA', 1)],")
    s = rep(s, "    ['gastos', 'gastos', paged('/m4/gastos')],", "    ['gastos', 'gastos pendientes', paged('/m4/gastos?status=PENDIENTE', 1)],")
    s = rep(s, "    ['cxc', 'cuentas por cobrar', paged('/m4/cuentas-por-cobrar')],", "    ['cxc', 'cuentas por cobrar abiertas', paged('/m4/cuentas-por-cobrar?status=VIGENTE,VENCIDA')],")
    s = rep(s, "  state.notifications = mapNotifications(obj('resumen'));", "  state.financeSummary = mapFinanceSummary(obj('reportes'));\n  state.notifications = mapNotifications(obj('resumen'));")
    s = rep(s, "  mapDynamicPricing,\n", "  mapDynamicPricing,\n  mapFinanceSummary,\n")
    s += '''
const summaryCache = new Map();

/** Resumen financiero de un rango (para el panel principal); se guarda por rango para no repetir la consulta. */
export async function fetchFinanceSummary(from, to) {
  const key = `${from}|${to}`;
  if (summaryCache.has(key)) return summaryCache.get(key);
  const res = await apiV1Request(`/m4/reportes/resumen?desde=${from}&hasta=${to}`);
  const summary = mapFinanceSummary(res?.data);
  if (summary) summaryCache.set(key, summary);
  return summary;
}

/** Descarta los resúmenes guardados (tras una escritura o al cambiar de sesión). */
export function clearFinanceSummaryCache() {
  summaryCache.clear();
}
'''
    return s
rw('src/js/services/data-adapter.js', adapter)

def empty(s):
    return rep(s, "    waitlist: [],\n", "    waitlist: [],\n    financeSummary: null,\n")
rw('src/js/data/empty-state.js', empty)

# ---------- módulo de finanzas
def mod(s):
    # facturación
    a = s.index("      mountRef(\n        tabBody,\n        'tbody',\n        state.invoices.map((inv) => {")
    b = s.index("    } else if (activeTab === 'pagos') {")
    block = s[a:b]
    m = re.search(r"state\.invoices\.map\(\(inv\) => \{(.*)\}\)\n      \);\n$", block, flags=re.S)
    assert m, 'facturacion'
    body = m.group(1).replace("const showVoid = canEditCurrentTab && inv.status !== 'Anulada';", "const showVoid = canEditCurrentTab && !['Anulado', 'Rechazado'].includes(inv.status);")
    new = '''      const renderInvoiceRows = (rows) => {
        const frag = document.createDocumentFragment();
        for (const inv of rows) {
          frag.appendChild((() => {''' + body + '''})());
        }
        return frag;
      };
      bindPagedContainer({
        container: getRef(tabBody, 'tbody'),
        key: 'm4.comprobantes',
        list: getPagedList('m4.comprobantes', { path: '/m4/comprobantes', map: mapInvoiceRows, pageSize: 20 }),
        filters: {
          searchPlaceholder: 'Buscar serie-número, cliente o documento…',
          dates: true,
          statusOptions: [
            { value: '', label: 'Todos los estados' },
            { value: 'ACEPTADO', label: 'Aceptado' },
            { value: 'ENVIADO,FIRMADO', label: 'Enviado / firmado' },
            { value: 'RECHAZADO', label: 'Rechazado' },
            { value: 'ANULADO', label: 'Anulado' },
          ],
        },
        renderBody: renderInvoiceRows,
        empty: { iconName: 'fileText', title: 'Sin comprobantes', description: 'Aún no se han emitido comprobantes.' },
        noMatch: { iconName: 'fileText', title: 'Sin comprobantes coincidentes', description: 'Prueba con otro estado, fechas o búsqueda.' },
      });
'''
    s = s[:a] + new + s[b:]

    # cuentas por cobrar
    a = s.index("      mountRef(\n        tabBody,\n        'tbody',\n        state.receivables.map((ar) => {")
    b = s.index("    } else if (activeTab === 'caja') {")
    block = s[a:b]
    m = re.search(r"state\.receivables\.map\(\(ar\) => \{(.*)\}\)\n      \);\n$", block, flags=re.S)
    assert m, 'cxc'
    body = m.group(1)
    new = '''      const renderReceivableRows = (rows) => {
        const frag = document.createDocumentFragment();
        for (const ar of rows) {
          frag.appendChild((() => {''' + body + '''})());
        }
        return frag;
      };
      bindPagedContainer({
        container: getRef(tabBody, 'tbody'),
        key: 'm4.cxc',
        list: getPagedList('m4.cxc', { path: '/m4/cuentas-por-cobrar', map: mapReceivableRows, pageSize: 20 }),
        filters: {
          searchPlaceholder: 'Buscar cliente o documento…',
          statusOptions: [
            { value: '', label: 'Todas' },
            { value: 'VIGENTE,VENCIDA', label: 'Pendientes' },
            { value: 'VENCIDA', label: 'Vencidas' },
            { value: 'PAGADA', label: 'Pagadas' },
          ],
        },
        renderBody: renderReceivableRows,
        empty: { iconName: 'wallet', title: 'Sin cuentas por cobrar', description: 'No hay cuentas por cobrar registradas.' },
        noMatch: { iconName: 'wallet', title: 'Sin cuentas coincidentes', description: 'Prueba con otro estado o búsqueda.' },
      });
'''
    s = s[:a] + new + s[b:]

    # gastos
    a = s.index("      mountRef(\n        tabBody,\n        'tbody',\n        state.expenses.map((ex) => {")
    b = s.index("    } else if (activeTab === 'costos') {")
    block = s[a:b]
    m = re.search(r"state\.expenses\.map\(\(ex\) => \{(.*)\}\)\n      \);\n$", block, flags=re.S)
    assert m, 'gastos'
    body = m.group(1)
    new = '''      const renderExpenseRows = (rows) => {
        const frag = document.createDocumentFragment();
        for (const ex of rows) {
          frag.appendChild((() => {''' + body + '''})());
        }
        return frag;
      };
      bindPagedContainer({
        container: getRef(tabBody, 'tbody'),
        key: 'm4.gastos',
        list: getPagedList('m4.gastos', { path: '/m4/gastos', map: mapExpenseRows, pageSize: 20 }),
        filters: {
          searchPlaceholder: 'Buscar concepto, proveedor o centro de costo…',
          dates: true,
          statusOptions: [
            { value: '', label: 'Todos los estados' },
            { value: 'PENDIENTE', label: 'Pendiente' },
            { value: 'APROBADO', label: 'Aprobado' },
            { value: 'RECHAZADO', label: 'Rechazado' },
          ],
        },
        renderBody: renderExpenseRows,
        empty: { iconName: 'receipt', title: 'Sin gastos', description: 'Aún no hay gastos registrados.' },
        noMatch: { iconName: 'receipt', title: 'Sin gastos coincidentes', description: 'Prueba con otro estado, fechas o búsqueda.' },
      });
'''
    s = s[:a] + new + s[b:]

    # costos: desde el resumen del servidor
    a = s.index("      const roomIncome = state.folios.reduce(")
    b = s.index("      const { root: view } = loadViewTemplate(VIEW_HTML.costos);")
    s = s[:a] + '''      // Ingresos por área (consumos) y costos por centro de costo (gastos aprobados), de los últimos 30 días.
      const costCenters = (state.financeSummary?.areas ?? []).slice(0, 8).map((a) => ({ area: a.name, ingresos: a.ingresos, costos: a.costos }));
      const maxCostChartVal = Math.max(0, ...costCenters.flatMap((c) => [c.ingresos, c.costos]));

''' + s[b:]
    s = rep(s, "          yMax: maxCostChartVal <= 10000 ? 10000 : null,\n", "          yMax: null,\n")
    # reportes
    s = rep(s, "      const monthlySeries = buildWeeklySeries(state.invoices, state.expenses, TODAY, 5);\n      const quarterlySeries = buildMonthlySeries(state.invoices, state.expenses, TODAY, 6);\n",
               "      const monthlySeries = state.financeSummary?.weekly ?? [];\n      const quarterlySeries = state.financeSummary?.monthly ?? [];\n")
    s = rep(s, "import { buildMonthlySeries, buildWeeklySeries } from '../utils/finance-series.js';\n", "")
    # totales de la cabecera de reportes
    s = rep(s, "    const totalBilled = state.folios.reduce((s, f) => s + f.totalCharges, 0);\n    const totalCollected = state.folios.reduce((s, f) => s + f.totalPayments, 0);\n    const totalPending = state.folios.reduce((s, f) => s + f.balance, 0) + state.receivables.reduce((s, r) => s + r.pendingAmount, 0);\n    const totalExpenses = state.expenses.reduce((s, e) => s + e.amount, 0);\n",
               "    // Totales de los últimos 30 días, calculados en la base de datos.\n    const fin = state.financeSummary;\n    const totalBilled = fin?.billed ?? 0;\n    const totalCollected = fin?.collected ?? 0;\n    const totalPending = fin?.receivable ?? 0;\n    const totalExpenses = fin?.expenses ?? 0;\n")
    s = rep(s, "StatTile({ label: 'Ingresos Consolidados', value: formatCurrency(totalBilled), tone: 'teal' }),", "StatTile({ label: 'Facturado (30 días)', value: formatCurrency(totalBilled), tone: 'teal' }),")
    s = rep(s, "StatTile({ label: 'Cobranza Efectiva', value: formatCurrency(totalCollected), tone: 'success' }),", "StatTile({ label: 'Cobrado (30 días)', value: formatCurrency(totalCollected), tone: 'success' }),")
    s = rep(s, "StatTile({ label: 'Gastos del Periodo', value: formatCurrency(totalExpenses) })", "StatTile({ label: 'Gastos aprobados (30 días)', value: formatCurrency(totalExpenses) })")
    s = rep(s, "  function renderContent() {\n", "  function renderContent() {\n    setActivePagedList(null); // cada pantalla paginada se vuelve a enlazar al dibujarse\n")
    return s
rw('src/js/modules/facturacion-finanzas.js', mod)

def imp(s):
    a = "import { erpStore } from '../core/store.js';\n"
    assert s.count(a) == 1
    return s.replace(a, a + "import { bindPagedContainer } from '../components/paged-view.js';\nimport { getPagedList, setActivePagedList } from '../services/paged-list.js';\nimport { mapExpenseRows, mapInvoiceRows, mapReceivableRows } from '../services/erp-mappers.js';\n")
rw('src/js/modules/facturacion-finanzas.js', imp)
print('ok')
