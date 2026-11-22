import os

def rw(p, fn):
    s = open(p, encoding='utf-8').read()
    s = fn(s)
    open(p + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(p + '.tmp', p)

def rep(s, a, b, count=1):
    assert s.count(a) == count, (a[:80], s.count(a))
    return s.replace(a, b)

# ---- servidor: ventas de servicios (todo lo que no es hospedaje) en el rango
def m4(s):
    s = rep(s, "       (SELECT COALESCE(SUM(monto), 0) FROM g4_finanzas.gasto WHERE estado = 'PENDIENTE')::text AS gastos_pendientes`,",
               "       (SELECT COALESCE(SUM(monto), 0) FROM g4_finanzas.gasto WHERE estado = 'PENDIENTE')::text AS gastos_pendientes,\n       (SELECT COALESCE(SUM(importe), 0) FROM g4_finanzas.consumo\n         WHERE area <> 'Recepción' AND fecha BETWEEN $1::date AND $2::date)::text AS ventas_servicios,\n       (SELECT COUNT(*) FROM g4_finanzas.consumo\n         WHERE area <> 'Recepción' AND fecha BETWEEN $1::date AND $2::date)::text AS cantidad_servicios`,")
    s = rep(s, "      gastos_pendientes: Number(t.gastos_pendientes),\n", "      gastos_pendientes: Number(t.gastos_pendientes),\n      ventas_servicios: Number(t.ventas_servicios),\n      cantidad_servicios: Number(t.cantidad_servicios),\n")
    return s
rw('server/modules/gestion/m4.ts', m4)

def mappers(s):
    return rep(s, "    pendingExpenses: Number(raw.totales.gastos_pendientes) || 0,\n", "    pendingExpenses: Number(raw.totales.gastos_pendientes) || 0,\n    servicesSales: Number(raw.totales.ventas_servicios) || 0,\n    servicesCount: Number(raw.totales.cantidad_servicios) || 0,\n")
rw('src/js/services/erp-mappers.js', mappers)

# ---- panel principal
def dash(s):
    s = rep(s, "import { addDays, buildAreaBreakdown } from '../utils/finance-series.js';\n", "import { addDays } from '../utils/dates.js';\nimport { fetchFinanceSummary } from '../services/data-adapter.js';\n")
    s = rep(s, "const dashUi = {\n  dateRange: 'hoy',\n};", "const dashUi = {\n  dateRange: 'hoy',\n};\n\n// Resúmenes financieros por rango (calculados en el servidor) y consultas en curso.\nconst summaries = new Map();\nconst pendingSummaries = new Set();")
    s = rep(s, "    const posTotal = state.posOrders.reduce((s, o) => s + o.total, 0);\n", "")
    a = s.index("    const totalRevenue = state.folios.reduce((sum, f) => sum + f.totalCharges, 0);")
    b = s.index("    const openComplaints =")
    s = s[:a] + """    // Cifras financieras del rango elegido, calculadas por el servidor.
    const sumKey = `${rangeFrom}|${TODAY}`;
    const summary = summaries.get(sumKey) ?? null;
    if (!summary && !pendingSummaries.has(sumKey) && erpStore.canView('m4')) {
      pendingSummaries.add(sumKey);
      fetchFinanceSummary(rangeFrom, TODAY)
        .then((r) => summaries.set(sumKey, r ?? { areas: [] }))
        .catch(() => summaries.set(sumKey, { areas: [] }))
        .finally(() => {
          pendingSummaries.delete(sumKey);
          renderContent();
        });
    }
    const dash = (n) => (summary && summary.billed !== undefined ? formatCurrency(n) : '—');
    const totalRevenue = summary?.billed ?? 0;
    const openReceivables = (summary?.receivable ?? 0) + state.folios.reduce((sum, f) => sum + f.balance, 0);
    const totalExpenses = summary?.expenses ?? 0;
    const posTotal = summary?.servicesSales ?? 0;
    const pendingPayablesCount =
      state.expenses.filter((e) => e.status === 'Pendiente').length +
      state.purchaseOrders.filter((p) => !['Recibida', 'Rechazada', 'Cancelada'].includes(p.status)).length;

""" + s[b:]
    s = rep(s, "    // Ingresos = cargos de folios por área; costos = gastos por centro de costo, ambos dentro del rango elegido.\n    const revenueExpenseData = buildAreaBreakdown(state.folios, state.expenses, rangeFrom, TODAY);\n",
               "    // Ingresos = consumos por área; costos = gastos aprobados por centro de costo, dentro del rango elegido.\n    const revenueExpenseData = (summary?.areas ?? []).slice(0, 6).map((a) => ({ name: a.name, ingresos: a.ingresos, costos: a.costos }));\n")
    s = rep(s, "          value: formatCurrency(posTotal),\n          meta: `${state.posOrders.length} órdenes registradas`,", "          value: dash(posTotal),\n          meta: summary ? `${summary.servicesCount} consumos en el período` : 'Calculando…',")
    s = rep(s, "          value: formatCurrency(totalRevenue),\n          meta: `Por cobrar: ${formatCurrency(openReceivables)}`,", "          value: dash(totalRevenue),\n          meta: `Por cobrar: ${dash(openReceivables)}`,")
    s = rep(s, "          value: formatCurrency(totalExpenses),\n          meta: `${pendingPayablesCount} comprobante(s) por pagar`,", "          value: dash(totalExpenses),\n          meta: `${pendingPayablesCount} pendiente(s) de pago o aprobación`,")
    s = rep(s, "        desc: `${formatCurrency(posTotal)} · ${criticalStock} alertas`,", "        desc: `${dash(posTotal)} · ${criticalStock} alertas`,")
    s = rep(s, "        desc: `${formatCurrency(totalRevenue)} · CxC ${formatCurrency(openReceivables)}`,", "        desc: `${dash(totalRevenue)} · CxC ${dash(openReceivables)}`,")
    s = rep(s, "revenueExpenseData.length === 0\n            ? h('p', { className: 'text-xs text-slate-500 p-4' }, 'Sin cargos ni gastos registrados en el período seleccionado.')", "revenueExpenseData.length === 0\n            ? h('p', { className: 'text-xs text-slate-500 p-4' }, summary ? 'Sin ingresos ni gastos registrados en el período seleccionado.' : 'Calculando…')")
    return s
rw('src/js/pages/dashboard.js', dash)

# ---- util de fechas (reemplaza finance-series.js)
open('src/js/utils/dates.js', 'w', encoding='utf-8').write('''/** Suma días a una fecha ISO (YYYY-MM-DD) sin depender de la zona horaria. */
export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
''')
print('ok')
