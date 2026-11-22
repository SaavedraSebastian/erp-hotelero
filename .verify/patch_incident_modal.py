import os

def rw(p, fn):
    s = open(p, encoding='utf-8').read()
    s = fn(s)
    open(p + '.tmp', 'w', encoding='utf-8').write(s)
    os.replace(p + '.tmp', p)

def rep(s, a, b):
    assert s.count(a) == 1, (a[:80], s.count(a))
    return s.replace(a, b)

def tpl(s):
    a = s.index('  <template data-tpl="modal-incidencia">')
    b = s.index('  </template>', a) + len('  </template>')
    new = '''  <template data-tpl="modal-incidencia">
    <form class="stack-md">
      <div class="grid-2">
        <div>
          <label class="field-label">Habitación</label>
          <select class="select-control" data-ref="roomId"></select>
        </div>
        <div>
          <label class="field-label">Equipo / activo</label>
          <select class="select-control" data-ref="assetId"></select>
        </div>
        <div>
          <label class="field-label">Ubicación</label>
          <input class="input-control" readonly placeholder="Se completa al elegir habitación o equipo" data-ref="location" />
        </div>
        <div>
          <label class="field-label">Prioridad</label>
          <select class="select-control" data-ref="priority">
            <option value="Alta">Alta</option>
            <option value="Media" selected>Media</option>
            <option value="Baja">Baja</option>
          </select>
        </div>
        <div>
          <label class="field-label">Reportado por</label>
          <select class="select-control" data-ref="origin">
            <option value="Personal">Personal</option>
            <option value="Supervisor">Supervisor</option>
            <option value="Huésped">Huésped</option>
          </select>
        </div>
      </div>
      <div>
        <label class="field-label">Descripción detallada</label>
        <textarea rows="3" required maxlength="300" class="textarea-control" data-ref="description"></textarea>
        <div class="text-11 text-slate-400 mt-1 text-right" data-ref="counter">0 / 300</div>
      </div>
      <p class="text-11 text-slate-500">Indica una habitación, un equipo o ambos.</p>
      <div class="row-wrap justify-end pt-2">
        <button type="button" class="btn btn-outline-muted" data-ref="cancel-btn">Cancelar</button>
        <button type="submit" class="btn btn-primary">Registrar incidencia</button>
      </div>
    </form>
  </template>'''
    return s[:a] + new + s[b:]
rw('src/html/modules/housekeeping/modales.html', tpl)

def mod(s):
    a = s.index("  function openIncidentModal() {")
    b = s.index("  function openResolveWOModal(wo) {")
    new = '''  function openIncidentModal() {
    const state = erpStore.state;
    openModal({
      title: 'Reportar incidencia',
      subtitle: 'Registra una avería o problema en una habitación o equipo para que Mantenimiento lo atienda.',
      renderBody: (close) => {
        const form = cloneModal('modal-incidencia');
        const roomSel = getRef(form, 'roomId');
        const assetSel = getRef(form, 'assetId');
        const location = getRef(form, 'location');
        const priority = getRef(form, 'priority');
        const origin = getRef(form, 'origin');
        const desc = getRef(form, 'description');
        const counter = getRef(form, 'counter');

        mount(roomSel, h('option', { value: '' }, '— Ninguna —'), state.rooms.map((rm) => h('option', { value: rm.id }, `Hab. ${rm.number} · ${rm.type}`)));
        mount(assetSel, h('option', { value: '' }, '— Ninguno —'), state.assets.map((a) => h('option', { value: a.id }, `${a.name}${a.roomNumber ? ` · ${/^\\d/.test(a.roomNumber) ? `Hab. ${a.roomNumber}` : a.roomNumber}` : ''}`)));

        const syncLocation = () => {
          const rm = state.rooms.find((r) => r.id === roomSel.value);
          const asset = state.assets.find((a) => a.id === assetSel.value);
          location.value = rm ? `Habitación ${rm.number}` : asset ? (/^\\d/.test(asset.roomNumber || '') ? `Habitación ${asset.roomNumber}` : asset.roomNumber || '') : '';
        };
        roomSel.addEventListener('change', syncLocation);
        assetSel.addEventListener('change', () => {
          // Si el equipo está en una habitación, la selecciona para mantener la incidencia ubicada.
          const asset = state.assets.find((a) => a.id === assetSel.value);
          if (asset?.roomId && !roomSel.value) roomSel.value = asset.roomId;
          syncLocation();
        });
        desc.addEventListener('input', () => {
          counter.textContent = `${desc.value.length} / 300`;
        });

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!desc.value.trim()) return;
          if (!roomSel.value && !assetSel.value) {
            erpStore.pushToast({ title: 'Falta la ubicación', detail: 'Elige una habitación, un equipo o ambos.', type: 'warning' });
            return;
          }
          const res = await erpStore.createIncident({
            roomId: roomSel.value || undefined,
            assetId: assetSel.value || undefined,
            priority: priority.value,
            origin: origin.value,
            description: desc.value,
          });
          if (res?.ok) close();
        });
        return form;
      },
    });
  }

'''
    return s[:a] + new + s[b:]
rw('src/js/modules/housekeeping-mantenimiento.js', mod)

def act(s):
    a = s.index("    async createIncident(input) {")
    b = s.index("    async consumeHKSupply(")
    new = '''    async createIncident(input) {
      if (!isNumericId(input.roomId) && !isNumericId(input.assetId)) {
        return fail('Falta la ubicación', 'La incidencia debe asociarse a una habitación o a un equipo registrado.');
      }
      const criticidad = /alta|urgente|cr[ií]tica/i.test(input.priority) ? 'Alta' : /baja/i.test(input.priority) ? 'Baja' : 'Media';
      const origen = ['Personal', 'Supervisor', 'Huésped'].includes(input.origin) ? input.origin : 'Personal';
      return run(
        'Incidencia registrada',
        () =>
          post('/m2/incidencias', {
            id_habitacion: isNumericId(input.roomId) ? input.roomId : undefined,
            id_activo: isNumericId(input.assetId) ? input.assetId : undefined,
            descripcion: String(input.description ?? '').trim().slice(0, 300),
            criticidad,
            origen,
          }),
        { refreshKeys: ['incidencias'], detail: `Prioridad ${criticidad}` }
      );
    },

'''
    return s[:a] + new + s[b:]
rw('src/js/services/erp-actions.js', act)
print('ok')
