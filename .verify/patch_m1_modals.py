import os, re

def rw(p, fn):
    s = open(p, encoding='utf-8').read()
    s = fn(s)
    open(p + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(p + '.tmp', p)

def rep(s, a, b):
    assert s.count(a) == 1, (a[:80], s.count(a))
    return s.replace(a, b)

# ---------- plantillas
def tpl(s):
    s = rep(s, '<select class="select-control" data-ref="guestId"></select>', '<div data-ref="guestId"></div>')
    # canales: los carga el JS desde las tarifas activas
    s = re.sub(r'<select class="select-control" data-ref="channel">.*?</select>', '<select class="select-control" data-ref="channel"></select>', s, count=1, flags=re.S)
    # lista de espera: huésped con buscador, tipos reales y sin campos que la base no guarda
    a = s.index('  <template data-tpl="modal-espera">')
    b = s.index('  </template>', a) + len('  </template>')
    new = '''  <template data-tpl="modal-espera">
    <form class="stack-md">
      <div class="grid-2">
        <div>
          <label class="field-label">Huésped</label>
          <div data-ref="guestPicker"></div>
        </div>
        <div>
          <label class="field-label">Tipo de habitación</label>
          <select class="select-control" data-ref="roomType"></select>
        </div>
        <div>
          <label class="field-label">Ingreso</label>
          <input type="date" class="input-control" required data-ref="checkInDate" />
        </div>
        <div>
          <label class="field-label">Salida</label>
          <input type="date" class="input-control" required data-ref="checkOutDate" />
        </div>
      </div>
      <div class="row-wrap justify-end pt-2">
        <button type="button" class="btn btn-outline-muted" data-ref="cancel-btn">Cancelar</button>
        <button type="submit" class="btn btn-primary">Registrar en espera</button>
      </div>
    </form>
  </template>'''
    return s[:a] + new + s[b:]
rw('src/html/modules/reservas/modales.html', tpl)

# ---------- módulo
def mod(s):
    s = rep(s, "      guestId: state.guests[0]?.id || '',\n      roomId: defaultRoom?.id || '',", "      guestId: '',\n      roomId: defaultRoom?.id || '',")
    s = rep(s, "      channel: 'Directo Web',\n      nightlyRate: defaultRoom?.baseRate || 340,", "      channel: '',\n      nightlyRate: defaultRoom?.baseRate || '',")
    s = rep(s, "      subtitle: 'Valida automáticamente cruces de fechas. Si hay conflicto, deriva a Sobreventa / Lista de Espera.',", "      subtitle: 'Registra la reserva de una habitación para el rango de fechas indicado.',")
    s = rep(s, "        mount(guestSel, state.guests.map((g) => h('option', { value: g.id, selected: formState.guestId === g.id }, `${g.fullName} (${g.loyaltyTier})`)));\n",
               "        const guestPicker = GuestPicker({ source: 'huespedes', onSelect: (g) => erpStore.ensureGuest(g) });\n        mount(guestSel, guestPicker);\n")
    s = rep(s, "          e.preventDefault();\n          erpStore.createReservation({\n            guestId: guestSel.value,",
               "          e.preventDefault();\n          if (!guestPicker.getValue()) {\n            erpStore.pushToast({ title: 'Falta el huésped', detail: 'Busca y selecciona al huésped titular de la reserva.', type: 'warning' });\n            return;\n          }\n          erpStore.createReservation({\n            guestId: guestPicker.getValue(),")
    # modal de lista de espera
    a = s.index("  function openWaitlistModal() {")
    b = s.index("  function renderContent() {")
    wait = '''  function openWaitlistModal() {
    openModal({
      title: 'Nueva solicitud en lista de espera',
      subtitle: 'Registra a un huésped que espera disponibilidad de un tipo de habitación.',
      renderBody: (close) => {
        const form = cloneModal('modal-espera');
        const roomType = getRef(form, 'roomType');
        const checkInDate = getRef(form, 'checkInDate');
        const checkOutDate = getRef(form, 'checkOutDate');
        const picker = GuestPicker({ source: 'huespedes', onSelect: (g) => erpStore.ensureGuest(g) });
        mount(getRef(form, 'guestPicker'), picker);

        const types = erpStore.state?.catalogs?.roomTypes ?? [];
        mount(roomType, types.map((t) => h('option', { value: t.name }, t.name)));
        checkInDate.value = TODAY;
        checkOutDate.value = new Date(Date.parse(TODAY) + 86_400_000).toISOString().slice(0, 10);

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const guest = picker.getSelected();
          if (!guest) {
            erpStore.pushToast({ title: 'Falta el huésped', detail: 'Busca y selecciona al huésped.', type: 'warning' });
            return;
          }
          const res = await erpStore.createWaitlistEntry({
            guestId: guest.id,
            guestName: guest.fullName,
            roomType: roomType.value,
            checkInDate: checkInDate.value,
            checkOutDate: checkOutDate.value,
          });
          if (res?.ok) close();
        });
        return form;
      },
    });
  }

'''
    s = s[:a] + wait + s[b:]
    s = rep(s, "import { bindPagedView } from '../components/paged-view.js';\n", "import { bindPagedView } from '../components/paged-view.js';\nimport { GuestPicker } from '../components/guest-picker.js';\n")
    return s
rw('src/js/modules/reservas-recepcion.js', mod)

# ---------- acción
def act(s):
    a = s.index("    async createWaitlistEntry(entry) {")
    b = s.index("      const room = (s().rooms ?? []).find((r) => sameName(r.type, entry.roomType));")
    s = s[:a] + '''    async createWaitlistEntry(entry) {
      const guest = (entry.guestId && guestById(entry.guestId)) || (s().guests ?? []).find((g) => sameName(g.fullName, entry.guestName));
      if (!guest) {
        return fail('Huésped no registrado', 'Selecciona un huésped existente o regístralo primero en la pestaña Huéspedes.');
      }
''' + s[b:]
    return s
rw('src/js/services/erp-actions.js', act)

# ---------- store
def store(s):
    return rep(s, "  async refreshState(keys) {", '''  /** Incorpora (o completa) un huésped elegido en un buscador para que las acciones lo reconozcan. */
  ensureGuest(guest) {
    const st = storeData.state;
    if (!st || !guest?.id) return;
    const cur = st.guests.find((g) => g.id === guest.id);
    if (!cur) st.guests.push({ segment: 'Sin segmentar', loyaltyTier: 'Sin nivel', loyaltyPoints: 0, totalStays: 0, totalSpent: 0, preferences: [], ...guest });
    else Object.assign(cur, Object.fromEntries(Object.entries(guest).filter(([, v]) => v !== undefined && v !== '')));
  },

  async refreshState(keys) {''')
rw('src/js/core/store.js', store)
print('ok')
