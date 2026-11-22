PRODUCT = r"""  function openProductModal(editing) {
    const cat = erpStore.state?.catalogs ?? {};
    const articles = erpStore.state?.inventory ?? [];
    const initial = editing
      ? { ...editing }
      : { name: '', posId: cat.posPoints?.[0]?.id || '', categoryId: cat.menuCategories?.[0]?.id || '', itemType: 'plato', price: '', linkedInventoryItemId: '' };
    openModal({
      title: editing ? `Editar Producto · ${editing.name}` : 'Nuevo Producto en Catálogo',
      subtitle: editing ? 'El punto de venta y el tipo no se modifican. Un precio nuevo queda registrado en el historial de precios.' : undefined,
      renderBody: (close) => {
        const form = cloneModal('modal-producto');
        const nameIn = getRef(form, 'name');
        const posSel = getRef(form, 'pos');
        const catSel = getRef(form, 'category');
        const typeSel = getRef(form, 'itemType');
        const priceIn = getRef(form, 'price');
        const artSel = getRef(form, 'article');

        // Las opciones válidas son las de la base de datos.
        mount(posSel, (cat.posPoints ?? []).map((p) => h('option', { value: p.id }, p.name)));
        mount(catSel, (cat.menuCategories ?? []).map((c) => h('option', { value: c.id }, c.name)));
        mount(artSel, [h('option', { value: '' }, 'Ninguno (se descuenta por receta)'), ...articles.map((a) => h('option', { value: a.id }, `${a.name} (${a.unit})`))]);

        nameIn.value = initial.name || '';
        posSel.value = initial.posId || '';
        catSel.value = initial.categoryId || '';
        typeSel.value = initial.itemType || 'plato';
        priceIn.value = initial.price === '' || initial.price == null ? '' : String(initial.price);
        artSel.value = initial.linkedInventoryItemId || '';
        if (editing) for (const el of [posSel, typeSel]) el.disabled = true;

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!nameIn.value.trim()) return;
          const res = await erpStore.upsertProduct({
            id: editing?.id,
            name: nameIn.value.trim(),
            posId: posSel.value,
            categoryId: catSel.value,
            itemType: typeSel.value,
            price: Number(priceIn.value),
            articleId: artSel.value || null,
          });
          if (res?.ok) close(); // si el servidor rechaza, el formulario queda abierto para corregir
        });
        return form;
      },
    });
  }

"""

SERVICE = r"""  function openServiceModal(editing) {
    const cat = erpStore.state?.catalogs ?? {};
    const initial = editing
      ? { ...editing }
      : { name: '', posId: cat.posPoints?.[0]?.id || '', categoryId: cat.menuCategories?.[0]?.id || '', price: '', durationMinutes: undefined };
    openModal({
      title: editing ? `Editar Servicio · ${editing.name}` : 'Nuevo Servicio Complementario',
      subtitle: editing ? 'El punto de venta no se modifica. Un precio nuevo queda registrado en el historial de precios.' : undefined,
      renderBody: (close) => {
        const form = cloneModal('modal-servicio');
        const nameIn = getRef(form, 'name');
        const posSel = getRef(form, 'pos');
        const catSel = getRef(form, 'category');
        const durIn = getRef(form, 'duration');
        const priceIn = getRef(form, 'price');

        mount(posSel, (cat.posPoints ?? []).map((p) => h('option', { value: p.id }, p.name)));
        mount(catSel, (cat.menuCategories ?? []).map((c) => h('option', { value: c.id }, c.name)));

        nameIn.value = initial.name || '';
        posSel.value = initial.posId || '';
        catSel.value = initial.categoryId || '';
        durIn.value = initial.durationMinutes ? String(initial.durationMinutes) : '';
        priceIn.value = initial.price === '' || initial.price == null ? '' : String(initial.price);
        if (editing) posSel.disabled = true;

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!nameIn.value.trim()) return;
          const res = await erpStore.upsertService({
            id: editing?.id,
            name: nameIn.value.trim(),
            posId: posSel.value,
            categoryId: catSel.value,
            durationMinutes: durIn.value ? Number(durIn.value) : undefined,
            price: Number(priceIn.value),
          });
          if (res?.ok) close();
        });
        return form;
      },
    });
  }

"""

INVENTORY = r"""  function openInventoryCreateModal() {
    const cat = erpStore.state?.catalogs ?? {};
    openModal({
      title: 'Registrar Nuevo Artículo en Almacén',
      subtitle: 'Con stock inicial se crea su primer lote y su movimiento en el kardex.',
      renderBody: (close) => {
        const form = cloneModal('modal-insumo');
        const nameIn = getRef(form, 'name');
        const catSel = getRef(form, 'category');
        const unitSel = getRef(form, 'unit');
        const stockIn = getRef(form, 'stock');
        const minIn = getRef(form, 'min-stock');
        const costIn = getRef(form, 'unit-cost');
        const expiresChk = getRef(form, 'expires');
        const expiryIn = getRef(form, 'expiry');
        const warnIn = getRef(form, 'warn-days');

        mount(catSel, (cat.stockCategories ?? []).map((c) => h('option', { value: c.id }, c.name)));
        mount(unitSel, (cat.units ?? []).map((u) => h('option', { value: u.id }, `${u.name} (${u.symbol})`)));
        const syncExpiry = () => {
          expiryIn.disabled = !expiresChk.checked;
          warnIn.disabled = !expiresChk.checked;
        };
        expiresChk.addEventListener('change', syncExpiry);
        syncExpiry();

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!nameIn.value.trim()) return;
          const res = await erpStore.upsertInventoryItem({
            name: nameIn.value.trim(),
            categoryId: catSel.value,
            unitId: unitSel.value,
            stock: Number(stockIn.value || 0),
            minStock: Number(minIn.value || 0),
            unitCost: Number(costIn.value || 0),
            expires: expiresChk.checked,
            expiryDate: expiryIn.value,
            warnDays: Number(warnIn.value || 0),
          });
          if (res?.ok) close();
        });
        return form;
      },
    });
  }

"""

RECIPE = r"""  function openRecipeModal() {
    const state = erpStore.state;
    openModal({
      title: 'Configurar Receta y Costeo Estándar',
      renderBody: (close) => {
        const form = cloneModal('modal-receta');
        const prodSel = getRef(form, 'product');
        const saleIn = getRef(form, 'sale-price');
        const ing1Sel = getRef(form, 'ing1');
        const ing1Qty = getRef(form, 'ing1-qty');
        const ing2Sel = getRef(form, 'ing2');
        const ing2Qty = getRef(form, 'ing2-qty');

        mount(prodSel, state.products.map((p) => h('option', { value: p.id }, `${p.name} (${formatCurrency(p.price)})`)));
        mount(ing1Sel, state.inventory.map((i) => h('option', { value: i.id }, `${i.name} (${i.unit})`)));
        mount(ing2Sel, [h('option', { value: '' }, 'Ninguno'), ...state.inventory.map((i) => h('option', { value: i.id }, `${i.name} (${i.unit})`))]);

        const syncPrice = () => {
          const p = state.products.find((x) => x.id === prodSel.value);
          saleIn.value = p ? String(p.price) : '';
        };
        prodSel.addEventListener('change', syncPrice);
        syncPrice();

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const prod = state.products.find((p) => p.id === prodSel.value);
          const i1 = state.inventory.find((i) => i.id === ing1Sel.value);
          const i2 = state.inventory.find((i) => i.id === ing2Sel.value);
          if (!prod || !i1) return;
          const ingredients = [{ inventoryItemId: i1.id, quantity: Number(ing1Qty.value) }];
          if (i2 && i2.id !== i1.id && Number(ing2Qty.value) > 0) {
            ingredients.push({ inventoryItemId: i2.id, quantity: Number(ing2Qty.value) });
          }
          const res = await erpStore.upsertRecipe({ productId: prod.id, productName: prod.name, ingredients });
          if (res?.ok) close();
        });
        return form;
      },
    });
  }

"""

PREVENTIVE = r"""  function openPreventiveModal(prefillAsset) {
    const state = erpStore.state;
    openModal({
      title: 'Programar Mantenimiento Preventivo',
      renderBody: (close) => {
        const form = cloneModal('modal-preventivo');
        const assetSel = getRef(form, 'asset');
        const freqSel = getRef(form, 'frequency');
        const nextDate = getRef(form, 'nextDate');
        const notes = getRef(form, 'notes');

        mount(assetSel, state.assets.map((a) => h('option', { value: a.id }, `${a.name} (${a.code}) · ${a.roomNumber || 'Áreas comunes'}`)));
        if (prefillAsset) {
          assetSel.value = prefillAsset.id;
          const risk = prefillAsset.predictedFailureRisk;
          notes.value = `Revisión preventiva recomendada (${prefillAsset.hoursUsed} h acumuladas${risk != null ? `, riesgo ${risk}%` : ''})`;
        }

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const res = await erpStore.addPreventiveSchedule({
            assetId: assetSel.value,
            frequency: freqSel.value,
            nextDate: nextDate.value,
            task: notes.value.trim(),
          });
          if (res?.ok) close();
        });
        return form;
      },
    });
  }

"""

ASSET = r"""  function openAssetModal(editingAsset) {
    const cat = erpStore.state?.catalogs ?? {};
    const rooms = erpStore.state?.rooms ?? [];
    const initial = editingAsset
      ? { ...editingAsset }
      : { name: '', typeId: cat.assetTypes?.[0]?.id || '', brand: '', model: '', purchaseDate: '', hoursUsed: 0, condition: 'Operativo' };
    openModal({
      title: editingAsset ? `Editar Activo ${editingAsset.code}` : 'Registrar Nuevo Activo Hotelero',
      subtitle: editingAsset ? 'Tipo, ubicación y fecha de instalación no se modifican.' : undefined,
      renderBody: (close) => {
        const form = cloneModal('modal-activo');
        const name = getRef(form, 'name');
        const typeSel = getRef(form, 'type');
        const locSel = getRef(form, 'location');
        const brand = getRef(form, 'brand');
        const model = getRef(form, 'model');
        const installDate = getRef(form, 'installDate');
        const hoursUsed = getRef(form, 'hoursUsed');
        const condition = getRef(form, 'condition');

        mount(typeSel, (cat.assetTypes ?? []).map((t) => h('option', { value: t.id }, t.name)));
        mount(locSel, [
          ...rooms.map((r) => h('option', { value: `h:${r.id}` }, `Habitación ${r.number}`)),
          ...(cat.areas ?? []).map((a) => h('option', { value: `a:${a.id}` }, a.name)),
        ]);

        name.value = initial.name || '';
        typeSel.value = initial.typeId || '';
        locSel.value = initial.roomId ? `h:${initial.roomId}` : initial.areaId ? `a:${initial.areaId}` : '';
        brand.value = initial.brand || '';
        model.value = initial.model || '';
        installDate.value = initial.purchaseDate || '';
        hoursUsed.value = String(initial.hoursUsed ?? 0);
        condition.value = initial.condition || 'Operativo';
        if (editingAsset) for (const el of [typeSel, locSel, installDate]) el.disabled = true;
        else condition.disabled = true; // un activo nuevo siempre entra como Operativo

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!name.value.trim()) return;
          const res = await erpStore.upsertAsset({
            id: editingAsset?.id,
            code: editingAsset?.code,
            name: name.value.trim(),
            typeId: typeSel.value,
            location: locSel.value,
            brand: brand.value.trim(),
            model: model.value.trim(),
            installDate: installDate.value,
            hoursUsed: Number(hoursUsed.value || 0),
            condition: editingAsset ? condition.value : undefined,
          });
          if (res?.ok) close();
        });
        return form;
      },
    });
  }

"""


def replace_between(src, start_marker, end_marker, new):
    a = src.index(start_marker)
    b = src.index(end_marker)
    assert a < b, (start_marker, end_marker)
    return src[:a] + new + src[b:]


p = "src/js/modules/servicios-pos-almacen.js"
s = open(p, encoding="utf-8").read()
s = replace_between(s, "  function openProductModal(editing) {", "  function openServiceModal(editing) {", PRODUCT)
s = replace_between(s, "  function openServiceModal(editing) {", "  function openInventoryMoveModal(item) {", SERVICE)
s = replace_between(s, "  function openInventoryCreateModal() {", "  function openSupplierModal() {", INVENTORY)
s = replace_between(s, "  function openRecipeModal() {", "  function isExpiringSoon(dateStr) {", RECIPE)
import os
tmp = p + ".tmp"
open(tmp, "w", encoding="utf-8").write(s)
os.replace(tmp, p)
print("ok", p)

p = "src/js/modules/housekeeping-mantenimiento.js"
s = open(p, encoding="utf-8").read()
s = replace_between(s, "  function openPreventiveModal(prefillAsset) {", "  function openAssetModal(editingAsset) {", PREVENTIVE)
s = replace_between(s, "  function openAssetModal(editingAsset) {", "  function openReqModal(supply) {", ASSET)
old = """            const risk = Number(a.predictedFailureRisk || 0);
            const riskEl = setText(tr, 'risk', `${risk}%`);
            if (riskEl) riskEl.classList.add(risk >= 50 ? 'text-danger' : 'text-teal');"""
new = """            const hasRisk = a.predictedFailureRisk != null;
            const risk = hasRisk ? Number(a.predictedFailureRisk) : 0;
            const riskEl = setText(tr, 'risk', hasRisk ? `${risk}%` : 'Sin evaluar');
            if (riskEl) riskEl.classList.add(risk >= 50 ? 'text-danger' : 'text-teal');"""
assert s.count(old) == 1
s = s.replace(old, new)
s = s.replace("StatusText({ label: a.condition || 'Óptimo', variant: getStatusVariant(a.condition) })", "StatusText({ label: a.condition || '—', variant: getStatusVariant(a.condition) })")
import os
tmp = p + ".tmp"
open(tmp, "w", encoding="utf-8").write(s)
os.replace(tmp, p)
print("ok", p)
