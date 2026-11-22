import { h } from '../utils/dom.js';
import { apiV1Request } from '../services/api-client.js';
import { mapGuests } from '../services/data-adapter.js';

/**
 * Selector de huésped con búsqueda en el servidor (no precarga el directorio completo).
 *
 *  - source 'huespedes': busca en el directorio de huéspedes.
 *  - source 'perfiles': busca entre huéspedes con perfil CRM (devuelve también profileId).
 *
 * `onSelect(guest)` recibe { id, fullName, profileId?, documentNumber? }.
 * El nodo devuelto expone getValue() y getSelected().
 */
export function GuestPicker({ source = 'huespedes', placeholder = 'Buscar por nombre, documento o empresa…', onSelect }) {
  let selected = null;
  let timer = null;
  let seq = 0;

  const input = h('input', {
    type: 'search',
    className: 'input-control',
    placeholder,
    autocomplete: 'off',
    'aria-label': 'Buscar huésped',
  });
  const list = h('div', { className: 'picker-list hidden', role: 'listbox' });
  const wrap = h('div', { className: 'picker' }, input, list);

  const close = () => list.classList.add('hidden');

  const toItem = (row) =>
    source === 'perfiles'
      ? {
          id: String(row.id_huesped),
          profileId: String(row.id_perfil),
          fullName: `${row.nombres ?? ''} ${row.apellidos ?? ''}`.trim(),
          documentNumber: row.numero_documento || '',
          segment: row.segmento_nombre || 'Sin segmentar',
          loyaltyPoints: Number(row.saldo_puntos) || 0,
          totalStays: Number(row.total_estadias) || 0,
          totalSpent: Number(row.valor_acumulado) || 0,
        }
      : mapGuests([row])[0];

  async function search(term) {
    const mine = ++seq;
    list.classList.remove('hidden');
    list.replaceChildren(h('div', { className: 'picker-empty' }, 'Buscando…'));
    try {
      const path = source === 'perfiles' ? '/m5/perfiles' : '/m1/huespedes';
      const res = await apiV1Request(`${path}?pageSize=10&search=${encodeURIComponent(term)}`);
      if (mine !== seq) return;
      const items = (res?.data ?? []).map(toItem);
      if (items.length === 0) {
        list.replaceChildren(h('div', { className: 'picker-empty' }, 'Sin coincidencias'));
        return;
      }
      list.replaceChildren(
        ...items.map((it) =>
          h('button', {
            type: 'button',
            className: 'picker-item',
            role: 'option',
            onMousedown: (e) => {
              e.preventDefault(); // evita perder el foco antes de elegir
              selected = it;
              input.value = it.fullName;
              close();
              onSelect?.(it);
            },
          },
          h('span', { className: 'font-medium text-navy' }, it.fullName),
          it.documentNumber ? h('span', { className: 'text-11 text-slate-500' }, it.documentNumber) : null)
        )
      );
    } catch (e) {
      if (mine !== seq) return;
      list.replaceChildren(h('div', { className: 'picker-empty' }, e?.status === 403 ? 'Sin permiso para buscar huéspedes' : 'No se pudo buscar'));
    }
  }

  input.addEventListener('input', () => {
    selected = null; // al escribir de nuevo hay que volver a elegir
    clearTimeout(timer);
    timer = setTimeout(() => search(input.value.trim()), 300);
  });
  input.addEventListener('focus', () => {
    if (!selected) search(input.value.trim());
  });
  input.addEventListener('blur', () => setTimeout(close, 120));

  wrap.getValue = () => selected?.id ?? '';
  wrap.getSelected = () => selected;
  return wrap;
}
