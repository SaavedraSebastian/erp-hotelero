import { h } from '../utils/dom.js';
import { PAGE_SIZES } from '../services/paged-list.js';

const fmt = (n) => Number(n).toLocaleString('es-PE');

/** Páginas a mostrar: primera, última y una ventana alrededor de la actual (con "…"). */
export function pageWindow(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out = new Set([1, 2, pages - 1, pages, page - 1, page, page + 1]);
  const list = [...out].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const withGaps = [];
  list.forEach((n, i) => {
    if (i > 0 && n - list[i - 1] > 1) withGaps.push('…');
    withGaps.push(n);
  });
  return withGaps;
}

/**
 * Pie de tabla con el rango mostrado, selector de filas por página (10/20/50/100) y navegación.
 * No renderiza nada si no hay registros.
 */
export function Pagination({ page, pageSize, total, loading = false, onPage, onPageSize, sizes = PAGE_SIZES }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const pageBtn = (label, target, { disabled = false, active = false, title } = {}) =>
    h('button', {
      type: 'button',
      className: `btn btn-xs ${active ? 'btn-primary' : 'btn-outline'}`,
      disabled: disabled || loading,
      title,
      'aria-current': active ? 'page' : null,
      onClick: () => {
        if (!active && !disabled) onPage(target);
      },
    }, label);

  const sizeSelect = h('select', {
    className: 'select-control text-xs',
    style: { width: 'auto' },
    'aria-label': 'Filas por página',
    disabled: loading,
    onChange: (e) => onPageSize(Number(e.target.value)),
  }, ...sizes.map((n) => h('option', { value: n, selected: n === pageSize }, String(n))));

  return h('div', { className: 'pager' },
    h('div', { className: 'pager-info text-xs text-slate-500' },
      total === 0 ? 'Sin registros' : `Mostrando ${fmt(from)}–${fmt(to)} de ${fmt(total)}`,
      loading ? h('span', { className: 'pager-loading' }, ' · Cargando…') : null
    ),
    h('div', { className: 'pager-controls' },
      h('label', { className: 'pager-size text-xs text-slate-500' }, 'Filas', sizeSelect),
      pages > 1
        ? h('div', { className: 'pager-nav' },
            pageBtn('«', 1, { disabled: page === 1, title: 'Primera página' }),
            pageBtn('‹', page - 1, { disabled: page === 1, title: 'Anterior' }),
            ...pageWindow(page, pages).map((n) =>
              n === '…' ? h('span', { className: 'pager-gap' }, '…') : pageBtn(String(n), n, { active: n === page })
            ),
            pageBtn('›', page + 1, { disabled: page === pages, title: 'Siguiente' }),
            pageBtn('»', pages, { disabled: page === pages, title: 'Última página' })
          )
        : null
    )
  );
}

/**
 * Barra de filtros de un listado paginado: búsqueda (con retardo), estado y rango de fechas opcionales.
 * `list` es el objeto devuelto por createPagedList.
 */
export function ListFilters({ list, searchPlaceholder = 'Buscar…', statusOptions = null, statusKey = 'status', dates = false }) {
  const st = list.state;
  let timer = null;

  const search = h('input', {
    type: 'search',
    className: 'input-control text-xs',
    style: { minWidth: '16rem' },
    placeholder: searchPlaceholder,
    dataset: { focusId: 'list-search' },
    value: st.filters.search ?? '',
    'aria-label': 'Buscar',
    onInput: (e) => {
      const v = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(() => list.setFilter('search', v), 350);
    },
  });

  const status = statusOptions
    ? h('select', {
        className: 'select-control text-xs',
        style: { width: 'auto', minWidth: '11rem' },
        'aria-label': 'Estado',
        onChange: (e) => list.setFilter(statusKey, e.target.value),
      }, ...statusOptions.map((o) => h('option', { value: o.value, selected: (st.filters[statusKey] ?? '') === o.value }, o.label)))
    : null;

  const dateField = (key, label) =>
    h('label', { className: 'row-gap-sm text-xs text-slate-500' }, label,
      h('input', {
        type: 'date',
        className: 'input-control text-xs',
        value: st.filters[key] ?? '',
        onChange: (e) => list.setFilter(key, e.target.value),
      }));

  return h('div', { className: 'row-wrap gap-3 items-center' },
    search,
    status,
    dates ? dateField('fromDate', 'Desde') : null,
    dates ? dateField('toDate', 'Hasta') : null,
    st.filters.search || (statusKey && st.filters[statusKey]) || st.filters.fromDate || st.filters.toDate
      ? h('button', {
          type: 'button',
          className: 'btn btn-outline-muted btn-xs',
          onClick: () => list.setFilters({ search: '', [statusKey]: '', fromDate: '', toDate: '' }),
        }, 'Limpiar filtros')
      : null
  );
}

// -------------------------------------------------------------------------------------------
// Paginación en memoria para conjuntos acotados que ya están cargados (p. ej. ingresos del día).
// -------------------------------------------------------------------------------------------
const localState = new Map();

/** Devuelve { slice, footer }: la página visible de `rows` y su pie de paginación. */
export function localPager(key, rows, rerender, defaultSize = 10) {
  const st = localState.get(key) ?? { page: 1, pageSize: defaultSize };
  localState.set(key, st);
  const pages = Math.max(1, Math.ceil(rows.length / st.pageSize));
  if (st.page > pages) st.page = pages;
  const slice = rows.slice((st.page - 1) * st.pageSize, st.page * st.pageSize);
  const footer = rows.length
    ? Pagination({
        page: st.page,
        pageSize: st.pageSize,
        total: rows.length,
        onPage: (p) => {
          st.page = p;
          rerender();
        },
        onPageSize: (n) => {
          st.pageSize = n;
          st.page = 1;
          rerender();
        },
      })
    : null;
  return { slice, footer };
}

/** Vuelve a la primera página de una lista en memoria (al cambiar un filtro). */
export function resetLocalPager(key) {
  const st = localState.get(key);
  if (st) st.page = 1;
}
