import { apiV1Request } from './api-client.js';

/** Tamaños de página disponibles en los listados. */
export const PAGE_SIZES = [10, 20, 50, 100];

/**
 * Lista paginada desde el servidor: pide solo la página visible (con filtros) a la API.
 *
 *  - `path`: endpoint de listado (acepta page, pageSize, search, status, fromDate, toDate).
 *  - `map(rows, response)`: convierte las filas crudas de la API al modelo de la interfaz.
 *  - `filters`: filtros iniciales; los valores vacíos no se envían.
 */
export function createPagedList({ path, map = (rows) => rows, pageSize = 20, filters = {} }) {
  const st = {
    rows: [],
    total: 0,
    page: 1,
    pageSize,
    loading: false,
    loaded: false,
    error: null,
    forbidden: false,
    filters: { ...filters },
  };
  let seq = 0;
  let onChange = null;

  const emit = () => onChange?.(st);

  function buildUrl() {
    const q = new URLSearchParams({ page: String(st.page), pageSize: String(st.pageSize) });
    for (const [k, v] of Object.entries(st.filters)) {
      if (v !== undefined && v !== null && String(v).trim() !== '') q.set(k, String(v).trim());
    }
    return `${path}${path.includes('?') ? '&' : '?'}${q.toString()}`;
  }

  async function load() {
    const mine = ++seq;
    st.loading = true;
    st.error = null;
    emit();
    try {
      const res = await apiV1Request(buildUrl());
      if (mine !== seq) return; // llegó una respuesta más nueva
      const raw = Array.isArray(res?.data) ? res.data : [];
      st.total = Number(res?.pagination?.total ?? raw.length);
      st.forbidden = false;
      st.loaded = true;
      const pages = Math.max(1, Math.ceil(st.total / st.pageSize));
      if (st.page > pages && st.total > 0) {
        // la página quedó fuera de rango (p. ej. tras filtrar): vuelve a la última
        st.page = pages;
        await load();
        return;
      }
      st.rows = map(raw, res);
    } catch (e) {
      if (mine !== seq) return;
      st.rows = [];
      st.total = 0;
      st.loaded = true;
      st.forbidden = e?.status === 403;
      st.error = st.forbidden ? null : e;
    } finally {
      if (mine === seq) {
        st.loading = false;
        emit();
      }
    }
  }

  return {
    state: st,
    load,
    /** Registra quién se redibuja cuando cambia la lista (solo la pantalla visible). */
    bind(fn) {
      onChange = fn;
    },
    ensureLoaded() {
      if (!st.loaded && !st.loading) load();
    },
    setPage(p) {
      const pages = Math.max(1, Math.ceil(st.total / st.pageSize));
      st.page = Math.min(Math.max(1, p), pages);
      return load();
    },
    setPageSize(n) {
      st.pageSize = n;
      st.page = 1;
      return load();
    },
    setFilter(key, value) {
      if ((st.filters[key] ?? '') === (value ?? '')) return Promise.resolve();
      st.filters[key] = value;
      st.page = 1;
      return load();
    },
    setFilters(next) {
      st.filters = { ...st.filters, ...next };
      st.page = 1;
      return load();
    },
  };
}

// -------------------------------------------------------------------------------------------
// Registro: una lista por pantalla; solo se vuelve a leer la que está a la vista.
// -------------------------------------------------------------------------------------------
const registry = new Map();
let activeKey = null;

export function getPagedList(key, config) {
  if (!registry.has(key)) registry.set(key, createPagedList(config));
  return registry.get(key);
}

/** Marca cuál lista está visible (null = ninguna). Las demás dejan de redibujarse. */
export function setActivePagedList(key) {
  if (activeKey && activeKey !== key) registry.get(activeKey)?.bind(null);
  activeKey = key;
}

/** Vuelve a leer la lista visible (p. ej. después de guardar un cambio). */
export function reloadActivePagedList() {
  if (activeKey) return registry.get(activeKey)?.load();
  return undefined;
}

/** Descarta todas las listas (al cerrar sesión o cambiar de usuario). */
export function resetPagedLists() {
  registry.clear();
  activeKey = null;
}
