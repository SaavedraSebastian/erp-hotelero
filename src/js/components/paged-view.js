import { h, mount } from '../utils/dom.js';
import { EmptyState } from './ui-components.js';
import { ListFilters, Pagination } from './pagination.js';
import { setActivePagedList } from '../services/paged-list.js';

/**
 * Conecta un listado paginado desde el servidor con su pantalla:
 *  - filtros (se montan una sola vez para no perder el foco al escribir),
 *  - cuerpo (tabla, tarjetas o filas) que se redibuja al llegar cada página,
 *  - pie con el selector de filas por página y la navegación.
 *
 * `renderBody(rows)` devuelve el nodo a mostrar. Devuelve la función de redibujo.
 */
export function bindPagedView({
  key,
  list,
  filtersSlot,
  bodySlot,
  footerSlot,
  filters = {},
  renderBody,
  empty = { iconName: 'info', title: 'Sin registros', description: 'No hay datos para mostrar.' },
  noMatch = { iconName: 'search', title: 'Sin resultados', description: 'Prueba con otra búsqueda o limpia los filtros.' },
  wrapEmpty = (node) => node,
}) {
  setActivePagedList(key);
  const st = list.state;

  if (filtersSlot) mount(filtersSlot, ListFilters({ list, ...filters }));

  const hasFilters = () => Object.values(st.filters).some((v) => v !== undefined && v !== null && String(v).trim() !== '');

  function draw() {
    if (!st.loaded && st.loading) {
      mount(bodySlot, wrapEmpty(h('p', { className: 'text-xs text-slate-500 p-4' }, 'Cargando…')));
      if (footerSlot) mount(footerSlot, null);
      return;
    }
    if (st.forbidden) {
      mount(bodySlot, wrapEmpty(EmptyState({ iconName: 'lock', title: 'Sin acceso', description: 'Tu rol no tiene permiso para ver estos datos.' })));
      if (footerSlot) mount(footerSlot, null);
      return;
    }
    if (st.error) {
      mount(
        bodySlot,
        wrapEmpty(
          EmptyState({
            iconName: 'alertTriangle',
            title: 'No se pudo cargar',
            description: st.error.message || 'Error al leer la base de datos.',
            action: h('button', { type: 'button', className: 'btn btn-outline btn-sm', onClick: () => list.load() }, 'Reintentar'),
          })
        )
      );
      if (footerSlot) mount(footerSlot, null);
      return;
    }
    if (st.rows.length === 0) {
      mount(bodySlot, wrapEmpty(EmptyState(hasFilters() ? noMatch : empty)));
    } else {
      mount(bodySlot, renderBody(st.rows));
    }
    if (footerSlot) {
      mount(
        footerSlot,
        st.total > 0 || st.loading
          ? Pagination({
              page: st.page,
              pageSize: st.pageSize,
              total: st.total,
              loading: st.loading,
              onPage: (p) => list.setPage(p),
              onPageSize: (n) => list.setPageSize(n),
            })
          : null
      );
    }
  }

  list.bind(draw);
  list.ensureLoaded();
  draw();
  return draw;
}

/**
 * Igual que bindPagedView, pero crea los espacios de filtros y pie alrededor de un contenedor que ya existe
 * en la plantilla (lista de filas, o un <tbody> dentro de una tabla).
 */
export function bindPagedContainer({ container, ...config }) {
  const isBody = container.tagName === 'TBODY';
  const anchor = isBody ? container.closest('.table-scroll') ?? container.closest('table') : container;
  const filtersSlot = h('div', { className: 'p-3' });
  const footerSlot = h('div');
  anchor.before(filtersSlot);
  anchor.after(footerSlot);
  const asRows = (node) => (isBody && node ? h('tr', null, h('td', { colSpan: 20 }, node)) : node);
  return bindPagedView({
    ...config,
    filtersSlot,
    footerSlot,
    bodySlot: container,
    renderBody: (rows) => config.renderBody(rows),
    wrapEmpty: asRows,
  });
}
