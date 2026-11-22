import os

def rw(p, fn):
    s = open(p, encoding='utf-8').read()
    s = fn(s)
    open(p + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(p + '.tmp', p)

def rep(s, a, b, count=1):
    assert s.count(a) == count, (a[:80], s.count(a))
    return s.replace(a, b)

def dash(s):
    s = rep(s, "    const summary = summaries.get(sumKey) ?? null;\n    if (!summary && !pendingSummaries.has(sumKey) && erpStore.canView('m4')) {",
               "    const cached = summaries.get(sumKey);\n    const summary = cached?.data ?? null;\n    const stale = !cached || Date.now() - cached.at > 60_000; // se refresca cada minuto\n    if (stale && !pendingSummaries.has(sumKey) && erpStore.canView('m4')) {")
    s = rep(s, "        .then((r) => summaries.set(sumKey, r ?? { areas: [] }))\n        .catch(() => summaries.set(sumKey, { areas: [] }))",
               "        .then((r) => summaries.set(sumKey, { at: Date.now(), data: r ?? { areas: [] } }))\n        .catch(() => summaries.set(sumKey, { at: Date.now(), data: { areas: [] } }))")
    return s
rw('src/js/pages/dashboard.js', dash)

def adapter(s):
    s = rep(s, "  const key = `${from}|${to}`;\n  if (summaryCache.has(key)) return summaryCache.get(key);\n  const res = await apiV1Request(`/m4/reportes/resumen?desde=${from}&hasta=${to}`);\n  const summary = mapFinanceSummary(res?.data);\n  if (summary) summaryCache.set(key, summary);\n  return summary;",
               "  const key = `${from}|${to}`;\n  const hit = summaryCache.get(key);\n  if (hit && Date.now() - hit.at < 30_000) return hit.data;\n  const res = await apiV1Request(`/m4/reportes/resumen?desde=${from}&hasta=${to}`);\n  const summary = mapFinanceSummary(res?.data);\n  if (summary) summaryCache.set(key, { at: Date.now(), data: summary });\n  return summary;")
    return s
rw('src/js/services/data-adapter.js', adapter)

def store(s):
    s = rep(s, "    if (keys?.length) reloadActivePagedList();", "    if (keys?.length) {\n      clearFinanceSummaryCache();\n      reloadActivePagedList();\n    }")
    s = rep(s, "  loadERPState,\n} from '../services/data-adapter.js';", "  loadERPState,\n  clearFinanceSummaryCache,\n} from '../services/data-adapter.js';")
    return s
rw('src/js/core/store.js', store)
print('ok')
