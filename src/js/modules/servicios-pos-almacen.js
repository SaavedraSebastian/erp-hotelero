import {
  createTemplateLibrary,
  getRef,
  h,
  icon,
  loadViewTemplate,
  mount,
  mountRef,
  parseHtmlTemplate,
  setText,
  setVisible,
} from '../utils/dom.js';
import moduleShellHtml from '../../html/modules/modulo-base.html?raw';
import modalesHtml from '../../html/modules/servicios/modales.html?raw';
import productosHtml from '../../html/modules/servicios/productos.html?raw';
import serviciosHtml from '../../html/modules/servicios/servicios.html?raw';
import posHtml from '../../html/modules/servicios/pos.html?raw';
import restauranteHtml from '../../html/modules/servicios/restaurante.html?raw';
import roomServiceHtml from '../../html/modules/servicios/room-service.html?raw';
import minibarHtml from '../../html/modules/servicios/minibar.html?raw';
import serviciosCompHtml from '../../html/modules/servicios/servicios-complementarios.html?raw';
import inventarioHtml from '../../html/modules/servicios/inventario.html?raw';
import proveedoresHtml from '../../html/modules/servicios/proveedores.html?raw';
import recetasHtml from '../../html/modules/servicios/recetas.html?raw';
import iaDemandaHtml from '../../html/modules/servicios/ia-demanda.html?raw';
import { formatCurrency } from '../utils/formatters.js';
import { getRoute, navigateToView } from '../core/router.js';
import { erpStore } from '../core/store.js';
import { bindPagedContainer } from '../components/paged-view.js';
import { localPager, resetLocalPager } from '../components/pagination.js';
import { getPagedList, setActivePagedList } from '../services/paged-list.js';
import { mapComandaRows, mapConsumoRows, mapDemandRecommendationRows, mapPurchaseOrderRows } from '../services/erp-mappers.js';
import { TODAY } from '../data/empty-state.js';
import {
  AccessDeniedCard,
  EmptyState,
  ModuleAIAdvisor,
  ModuleHeader,
  SearchInput,
  StatTile,
  StatusText,
  openModal,
} from '../components/ui-components.js';

const cloneModal = createTemplateLibrary(modalesHtml);

const VIEW_HTML = {
  productos: productosHtml,
  servicios: serviciosHtml,
  pos: posHtml,
  restaurante: restauranteHtml,
  room_service: roomServiceHtml,
  minibar: minibarHtml,
  servicios_comp: serviciosCompHtml,
  inventario: inventarioHtml,
  proveedores: proveedoresHtml,
  recetas: recetasHtml,
  ia_demanda: iaDemandaHtml,
};

const M3_TABS = [
  { id: 'productos', label: 'Productos', subtitle: 'Carta de productos con precios de venta, costos y márgenes.' },
  { id: 'servicios', label: 'Servicios', subtitle: 'Servicios complementarios: spa, lavandería, cochera, traslados y bar.' },
  { id: 'pos', label: 'POS Ventas', subtitle: 'Registro de ventas con cargo a la cuenta del huésped o pago directo.' },
  { id: 'restaurante', label: 'Restaurante', subtitle: 'Mesas y seguimiento de comandas.' },
  { id: 'room_service', label: 'Room Service', subtitle: 'Pedidos a habitación y seguimiento de entregas.' },
  { id: 'minibar', label: 'Minibar', subtitle: 'Consumos de minibar y su cargo a la cuenta.' },
  { id: 'servicios_comp', label: 'Serv. Complementarios', subtitle: 'Registro y tarifario de servicios complementarios.' },
  { id: 'inventario', label: 'Inventario', subtitle: 'Stock de almacén, solicitudes internas y vencimientos.' },
  { id: 'proveedores', label: 'Proveedores y Compras', subtitle: 'Proveedores, órdenes de compra y recepción de mercadería.' },
  { id: 'recetas', label: 'Recetario', subtitle: 'Ingredientes por plato que se descuentan del stock al vender.' },
  { id: 'ia_demanda', label: 'IA Demanda y Stock', subtitle: 'Recomendaciones de reposición según la ocupación.' },
];

const m3Ui = {
  prodSearch: '',
  prodCategory: 'Todas',
  search: '',
  posCategory: 'Todos',
  posOrigin: 'Restaurante',
  posTable: 'M-01',
  posPaymentMode: 'Cargo a Habitación',
  posFolioId: '',
  cart: [],
};

export function renderServiciosPOSModule() {
  const root = parseHtmlTemplate(moduleShellHtml);
  const headerSlot = getRef(root, 'header-slot');
  const bodySlot = getRef(root, 'body-slot');

  function getStatusVariant(status) {
    if (['Entregado', 'Cobrado', 'Libre', 'Disponible', 'Óptimo', 'Recibida', 'Despachada', 'Activo'].includes(status)) return 'success';
    if (['Preparando', 'En camino', 'En preparación', 'En cocina', 'Pendiente', 'Ocupada', 'Solicitada', 'Aprobada', 'Por vencer', 'En tránsito', 'Emitida'].includes(status)) return 'warning';
    if (['Stock Crítico', 'Reponer', 'Agotado', 'Reservada'].includes(status)) return 'danger';
    return 'info';
  }

  function addToCart(prod) {
    const existing = m3Ui.cart.find((c) => c.productId === prod.id);
    if (existing) {
      existing.quantity += 1;
    } else {
      m3Ui.cart.push({
        productId: prod.id,
        name: prod.name,
        quantity: 1,
        unitPrice: prod.price,
      });
    }
    renderContent();
  }

  function updateCartQty(productId, delta) {
    m3Ui.cart = m3Ui.cart
      .map((c) => (c.productId === productId ? { ...c, quantity: c.quantity + delta } : c))
      .filter((c) => c.quantity > 0);
    renderContent();
  }

  function openProductModal(editing) {
    const cat = erpStore.state?.catalogs ?? {};
    const articles = erpStore.state?.inventory ?? [];
    const initial = editing
      ? { ...editing }
      : { name: '', posId: cat.posPoints?.find((p) => p.active)?.id || '', categoryId: cat.menuCategories?.find((c) => c.active)?.id || '', itemType: 'plato', price: '', linkedInventoryItemId: '' };
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
        mount(posSel, (cat.posPoints ?? []).filter((p) => p.active || p.id === editing?.posId).map((p) => h('option', { value: p.id }, p.name)));
        mount(catSel, (cat.menuCategories ?? []).filter((c) => c.active || c.id === editing?.categoryId).map((c) => h('option', { value: c.id }, c.name)));
        mount(artSel, [h('option', { value: '' }, 'Ninguno (se descuenta por receta)'), ...articles.filter((a) => a.active || a.id === editing?.linkedInventoryItemId).map((a) => h('option', { value: a.id }, `${a.name} (${a.unit})`))]);

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

  function openServiceModal(editing) {
    const cat = erpStore.state?.catalogs ?? {};
    const initial = editing
      ? { ...editing }
      : { name: '', posId: cat.posPoints?.find((p) => p.active)?.id || '', categoryId: cat.menuCategories?.find((c) => c.active)?.id || '', price: '', durationMinutes: undefined };
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

        mount(posSel, (cat.posPoints ?? []).filter((p) => p.active || p.id === editing?.posId).map((p) => h('option', { value: p.id }, p.name)));
        mount(catSel, (cat.menuCategories ?? []).filter((c) => c.active || c.id === editing?.categoryId).map((c) => h('option', { value: c.id }, c.name)));

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

  function openInventoryMoveModal(item) {
    openModal({
      title: `Movimiento Kardex · ${item.name}`,
      subtitle: `Stock actual: ${item.stock} ${item.unit}`,
      renderBody: (close) => {
        const form = cloneModal('modal-kardex');
        const typeSel = getRef(form, 'type');
        const qtyIn = getRef(form, 'qty');
        const refIn = getRef(form, 'ref');

        setText(form, 'qty-label', `Cantidad (${item.unit})`);
        qtyIn.value = '10';
        refIn.value = 'Ajuste manual Almacén';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          erpStore.adjustInventory(item.id, typeSel.value, Number(qtyIn.value), refIn.value);
          close();
        });
        return form;
      },
    });
  }

  function openInventoryCreateModal(editingItem = null) {
    const cat = erpStore.state?.catalogs ?? {};
    openModal({
      title: editingItem ? `Editar artículo ${editingItem.sku}` : 'Registrar Nuevo Artículo en Almacén',
      subtitle: editingItem ? 'El stock y costo se modifican mediante movimientos de kardex.' : 'Con stock inicial se crea su primer lote y su movimiento en el kardex.',
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

        mount(catSel, (cat.stockCategories ?? []).filter((c) => c.active || c.id === editingItem?.categoryId).map((c) => h('option', { value: c.id }, c.name)));
        mount(unitSel, (cat.units ?? []).map((u) => h('option', { value: u.id }, `${u.name} (${u.symbol})`)));
        if (editingItem) {
          nameIn.value = editingItem.name;
          catSel.value = editingItem.categoryId;
          unitSel.value = editingItem.unitId;
          minIn.value = String(editingItem.minStock);
          expiresChk.checked = editingItem.expires;
          warnIn.value = String(editingItem.warnDays || 0);
          stockIn.value = '0';
          stockIn.disabled = true;
          costIn.value = String(editingItem.unitCost || 0);
          costIn.disabled = true;
          expiryIn.disabled = true;
        }
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
            id: editingItem?.id,
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

  function openSupplierModal(editingSupplier = null) {
    openModal({
      title: editingSupplier ? `Editar proveedor ${editingSupplier.name}` : 'Registrar Nuevo Proveedor',
      renderBody: (close) => {
        const form = cloneModal('modal-proveedor');
        const nameIn = getRef(form, 'name');
        const rucIn = getRef(form, 'ruc');
        const phoneIn = getRef(form, 'phone');
        const emailIn = getRef(form, 'email');

        if (editingSupplier) {
          nameIn.value = editingSupplier.name;
          rucIn.value = editingSupplier.ruc;
          phoneIn.value = editingSupplier.phone;
          emailIn.value = editingSupplier.email;
        }

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!nameIn.value.trim()) return;
          const res = await erpStore.upsertSupplier({
            id: editingSupplier?.id,
            name: nameIn.value.trim(),
            ruc: rucIn.value.trim(),
            phone: phoneIn.value.trim(),
            email: emailIn.value.trim(),
          });
          if (res?.ok) close(); // si el servidor rechaza (p. ej. RUC duplicado), el formulario queda abierto
        });
        return form;
      },
    });
  }

  function openSupplierStatusModal(supplier) {
    if (!supplier.active) {
      erpStore.setSupplierStatus(supplier.id, true, '');
      return;
    }
    openModal({
      title: `Desactivar proveedor ${supplier.name}`,
      subtitle: 'Las órdenes existentes se conservan, pero no debe seleccionarse en nuevas compras.',
      renderBody: (close) => {
        const reason = h('textarea', { className: 'input-control', rows: 3, required: true, minlength: 3, placeholder: 'Motivo de desactivación' });
        const back = h('button', { type: 'button', className: 'btn btn-outline-muted' }, 'Volver');
        const submit = h('button', { type: 'submit', className: 'btn btn-primary' }, 'Desactivar');
        const form = h('form', { className: 'stack-md' }, reason, h('div', { className: 'row-wrap justify-end' }, back, submit));
        back.addEventListener('click', close);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const result = await erpStore.setSupplierStatus(supplier.id, false, reason.value);
          if (result?.ok) close();
        });
        return form;
      },
    });
  }

  function openPurchaseOrderModal(prelinkedReq, editingOrder = null) {
    const state = erpStore.state;
    const defaultItem = editingOrder?.items?.[0]
      ? state.inventory.find((i) => i.id === editingOrder.items[0].inventoryItemId) || state.inventory[0]
      : prelinkedReq
      ? state.inventory.find((i) => i.id === prelinkedReq.inventoryItemId) || state.inventory[0]
      : state.inventory[0];

    openModal({
      title: editingOrder ? `Editar Orden ${editingOrder.code}` : 'Nueva Orden de Compra a Proveedor',
      subtitle: editingOrder
        ? 'Solo las órdenes pendientes de aprobación pueden modificarse.'
        : prelinkedReq
        ? `Vinculada a Requisición ${prelinkedReq.code}`
        : 'Al recepcionar incrementa stock y genera egreso en Finanzas.',
      renderBody: (close) => {
        const form = cloneModal('modal-orden-compra');
        const supSel = getRef(form, 'supplier');
        const itemSel = getRef(form, 'item');
        const qtyIn = getRef(form, 'qty');
        const costIn = getRef(form, 'unit-cost');

        mount(supSel, state.suppliers.filter((sup) => sup.active || sup.id === editingOrder?.supplierId).map((sup) => h('option', { value: sup.id }, `${sup.name} (${sup.category})`)));
        if (editingOrder?.supplierId) supSel.value = editingOrder.supplierId;
        mount(
          itemSel,
          state.inventory.filter((inv) => inv.active || inv.id === editingOrder?.items?.[0]?.inventoryItemId).map((inv) =>
            h('option', { value: inv.id, selected: defaultItem?.id === inv.id }, `${inv.name} (Stock: ${inv.stock} ${inv.unit})`)
          )
        );
        if (defaultItem) itemSel.value = defaultItem.id;
        qtyIn.value = String(editingOrder?.items?.[0]?.quantity ?? (prelinkedReq ? prelinkedReq.quantity : Math.max(10, (defaultItem?.minStock || 10) * 2)));
        costIn.value = String(editingOrder?.items?.[0]?.unitCost ?? defaultItem?.unitCost ?? 15);

        itemSel.addEventListener('change', () => {
          const inv = state.inventory.find((i) => i.id === itemSel.value);
          if (inv) costIn.value = String(inv.unitCost);
        });

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const item = state.inventory.find((i) => i.id === itemSel.value);
          if (!item) return;
          const payload = {
            supplierId: supSel.value,
            linkedRequisitionId: prelinkedReq?.id,
            deliveryExpected: editingOrder?.deliveryExpected,
            items: [{
              inventoryItemId: item.id,
              itemName: item.name,
              quantity: Number(qtyIn.value),
              unitCost: Number(costIn.value),
            }],
          };
          const result = editingOrder
            ? await erpStore.updatePurchaseOrder(editingOrder.id, payload)
            : await erpStore.createPurchaseOrder(payload);
          if (result?.ok) close();
        });
        return form;
      },
    });
  }

  function openPurchaseReasonModal(order, action) {
    const labels = {
      aprobar: ['Aprobar orden', 'Motivo o sustento de aprobación'],
      rechazar: ['Rechazar orden', 'Motivo del rechazo'],
      cancelar: ['Cancelar orden', 'Motivo de cancelación'],
      anularRecepcion: ['Anular recepción', 'Motivo de anulación y reversión de stock'],
    };
    const [title, placeholder] = labels[action];
    openModal({
      title: `${title} ${order.code}`,
      subtitle: action === 'aprobar' ? 'La aprobación respeta la segregación de funciones configurada.' : undefined,
      renderBody: (close) => {
        const reason = h('textarea', { className: 'input-control', rows: 3, required: true, minlength: 3, placeholder });
        const back = h('button', { type: 'button', className: 'btn btn-outline-muted' }, 'Volver');
        const submit = h('button', { type: 'submit', className: action === 'aprobar' ? 'btn btn-teal' : 'btn btn-primary' }, title);
        const form = h('form', { className: 'stack-md' }, reason, h('div', { className: 'row-wrap justify-end' }, back, submit));
        back.addEventListener('click', close);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const value = reason.value.trim();
          const receipt = order.receipts?.find((r) => r.rawStatus !== 'anulada');
          const result = action === 'cancelar'
            ? await erpStore.cancelPurchaseOrder(order.id, value)
            : action === 'anularRecepcion' && receipt
              ? await erpStore.annulPurchaseReceipt(order.id, receipt.id, value)
              : await erpStore.decidePurchaseOrder(order.id, action, value);
          if (result?.ok) close();
        });
        return form;
      },
    });
  }

  function openPurchaseReceiptModal(order) {
    const pendingItems = order.items.filter((item) => item.pendingQuantity > 0);
    openModal({
      title: `Recepcionar ${order.code}`,
      subtitle: 'Puedes aceptar una parte y registrar otra recepción posteriormente.',
      renderBody: (close) => {
        const documentNumber = h('input', { className: 'input-control font-mono', maxlength: 30, placeholder: 'Guía o factura (opcional)' });
        const controls = pendingItems.map((item) => {
          const accepted = h('input', { type: 'number', min: 0, max: item.pendingQuantity, step: '0.001', value: item.pendingQuantity, className: 'input-control font-mono' });
          const rejected = h('input', { type: 'number', min: 0, max: item.pendingQuantity, step: '0.001', value: 0, className: 'input-control font-mono' });
          const cost = h('input', { type: 'number', min: 0, step: '0.01', value: item.unitCost, className: 'input-control font-mono' });
          const reason = h('input', { className: 'input-control', maxlength: 500, placeholder: 'Motivo del rechazo, si aplica' });
          const expiry = h('input', { type: 'date', className: 'input-control font-mono' });
          const row = h('div', { className: 'card card-pad stack-sm' },
            h('div', { className: 'row-between' }, h('strong', null, item.itemName), h('span', { className: 'text-11 text-slate-500' }, `Pendiente: ${item.pendingQuantity}`)),
            h('div', { className: 'grid-2' },
              h('div', null, h('label', { className: 'field-label' }, 'Aceptada'), accepted),
              h('div', null, h('label', { className: 'field-label' }, 'Rechazada'), rejected),
              h('div', null, h('label', { className: 'field-label' }, 'Costo unitario'), cost),
              h('div', null, h('label', { className: 'field-label' }, 'Vencimiento (opcional)'), expiry)
            ), reason
          );
          return { item, accepted, rejected, cost, reason, expiry, row };
        });
        const back = h('button', { type: 'button', className: 'btn btn-outline-muted' }, 'Cancelar');
        const submit = h('button', { type: 'submit', className: 'btn btn-teal' }, 'Registrar recepción');
        const form = h('form', { className: 'stack-md' },
          h('div', null, h('label', { className: 'field-label' }, 'Documento'), documentNumber),
          ...controls.map((control) => control.row),
          h('div', { className: 'row-wrap justify-end' }, back, submit)
        );
        back.addEventListener('click', close);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const items = controls.map((control) => ({
            id: control.item.id,
            accepted: Number(control.accepted.value || 0),
            rejected: Number(control.rejected.value || 0),
            rejectionReason: control.reason.value.trim(),
            unitCost: Number(control.cost.value || 0),
            expiryDate: control.expiry.value || null,
          })).filter((item) => item.accepted + item.rejected > 0);
          const invalid = items.find((item) => item.rejected > 0 && item.rejectionReason.length < 3);
          if (invalid) {
            invalid.rejectionReason = '';
            return;
          }
          const result = await erpStore.receivePurchaseOrder(order.id, { documentNumber: documentNumber.value.trim(), items });
          if (result?.ok) close();
        });
        return form;
      },
    });
  }

  function openDemandRecommendationDecisionModal(recommendation, decision) {
    const accepting = decision === 'aceptada';
    openModal({
      title: `${accepting ? 'Aceptar' : 'Descartar'} recomendación`,
      subtitle: recommendation.type,
      renderBody: (close) => {
        const comment = h('textarea', {
          className: 'input-control', rows: 3, maxlength: 500,
          placeholder: accepting ? 'Comentario de aceptación (opcional)' : 'Explica por qué se descarta (opcional)',
        });
        const back = h('button', { type: 'button', className: 'btn btn-outline-muted' }, 'Volver');
        const submit = h('button', { type: 'submit', className: accepting ? 'btn btn-teal' : 'btn btn-primary' }, accepting ? 'Aceptar' : 'Descartar');
        const form = h('form', { className: 'stack-md' },
          h('p', { className: 'text-xs text-slate-600' }, recommendation.reason),
          comment,
          h('div', { className: 'row-wrap justify-end' }, back, submit)
        );
        back.addEventListener('click', close);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const result = await erpStore.decideDemandRecommendation(recommendation.id, decision, comment.value);
          if (result?.ok) {
            getPagedList('m3.ia-recomendaciones', { path: '/ai/demanda/recomendaciones', map: mapDemandRecommendationRows, pageSize: 10 }).reload();
            close();
          }
        });
        return form;
      },
    });
  }

  function openM3ManagerModal(kind, categoryUse = 'catálogo') {
    const state = erpStore.state;
    const definitions = {
      point: {
        title: 'Gestionar puntos de venta',
        entries: state.catalogs?.posPoints ?? [],
        label: 'Punto de venta',
      },
      category: {
        title: `Gestionar categorías de ${categoryUse}`,
        entries: categoryUse === 'almacén' ? state.catalogs?.stockCategories ?? [] : state.catalogs?.menuCategories ?? [],
        label: 'Categoría',
      },
      table: {
        title: 'Gestionar mesas',
        entries: state.tables ?? [],
        label: 'Mesa',
      },
    };
    const definition = definitions[kind];
    openModal({
      title: definition.title,
      subtitle: 'Selecciona un registro para editarlo o elige “Nuevo”.',
      renderBody: (close) => {
        const record = h('select', { className: 'select-control' },
          h('option', { value: '' }, `Nuevo ${definition.label.toLowerCase()}`),
          ...definition.entries.map((entry) => h('option', { value: entry.id }, entry.name || entry.rawName || entry.number))
        );
        const name = h('input', { className: 'input-control', required: true, minlength: kind === 'table' ? 1 : 2, placeholder: `Nombre del ${definition.label.toLowerCase()}` });
        const type = h('input', { className: 'input-control', minlength: 3, placeholder: 'Tipo: restaurante, bar, minibar…' });
        const pos = h('select', { className: 'select-control' },
          ...(state.catalogs?.posPoints ?? []).filter((point) => point.active).map((point) => h('option', { value: point.id }, point.name))
        );
        const reason = h('input', { className: 'input-control', minlength: 3, placeholder: 'Motivo para desactivar la mesa' });
        const statusButton = h('button', { type: 'button', className: 'btn btn-outline-muted hidden' }, 'Desactivar');
        const cancel = h('button', { type: 'button', className: 'btn btn-outline-muted' }, 'Cerrar');
        const save = h('button', { type: 'submit', className: 'btn btn-primary' }, 'Guardar');

        const selected = () => definition.entries.find((entry) => entry.id === record.value);
        const sync = () => {
          const entry = selected();
          name.value = entry?.name || entry?.rawName || '';
          if (kind === 'point') type.value = entry?.type || '';
          if (kind === 'table') {
            pos.value = entry?.posId || pos.options[0]?.value || '';
            pos.disabled = Boolean(entry);
          }
          const active = kind === 'table' ? entry?.status !== 'Inactiva' : entry?.active !== false;
          statusButton.textContent = active ? 'Desactivar' : 'Activar';
          statusButton.classList.toggle('hidden', !entry);
          reason.classList.toggle('hidden', kind !== 'table' || !entry || !active);
        };
        record.addEventListener('change', sync);
        sync();

        const fields = [
          h('div', null, h('label', { className: 'field-label' }, definition.label), record),
          h('div', null, h('label', { className: 'field-label' }, 'Nombre'), name),
        ];
        if (kind === 'point') fields.push(h('div', null, h('label', { className: 'field-label' }, 'Tipo'), type));
        if (kind === 'table') fields.push(h('div', null, h('label', { className: 'field-label' }, 'Punto de venta'), pos), reason);
        const form = h('form', { className: 'stack-md' }, ...fields,
          h('div', { className: 'row-between pt-2' }, statusButton, h('div', { className: 'row-wrap' }, cancel, save))
        );
        cancel.addEventListener('click', close);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const entry = selected();
          const result = kind === 'point'
            ? await erpStore.upsertPointOfSale({ id: entry?.id, name: name.value, type: type.value })
            : kind === 'category'
              ? await erpStore.upsertM3Category({ id: entry?.id, name: name.value, use: categoryUse })
              : await erpStore.upsertTable({ id: entry?.id, name: name.value, posId: pos.value });
          if (result?.ok) close();
        });
        statusButton.addEventListener('click', async () => {
          const entry = selected();
          if (!entry) return;
          const active = kind === 'table' ? entry.status !== 'Inactiva' : entry.active !== false;
          const result = kind === 'point'
            ? await erpStore.setPointOfSaleStatus(entry.id, !active)
            : kind === 'category'
              ? await erpStore.setM3CategoryStatus(entry.id, !active)
              : await erpStore.updateTableStatus(entry.id, active ? 'Inactiva' : 'Activa', reason.value);
          if (result?.ok) close();
        });
        return form;
      },
    });
  }

  function openRecipeModal() {
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

  function openServiceRequestCompleteModal(request) {
    openModal({
      title: `Completar solicitud ${request.id}`,
      subtitle: `${request.service} · Hab. ${request.roomNumber || '—'}`,
      renderBody: (close) => {
        const qty = h('input', {
          type: 'number', min: 1, max: request.requestedQuantity,
          value: request.requestedQuantity, className: 'input-control font-mono',
        });
        const payment = h('select', { className: 'select-control' },
          h('option', { value: 'Cargo a Habitación' }, 'Cargo a Habitación'),
          h('option', { value: 'Pago Directo' }, 'Pago Directo')
        );
        const cancel = h('button', { type: 'button', className: 'btn btn-outline-muted' }, 'Cancelar');
        const submit = h('button', { type: 'submit', className: 'btn btn-teal' }, 'Completar y generar consumo');
        const form = h('form', { className: 'stack-md' },
          h('div', null, h('label', { className: 'field-label' }, 'Cantidad prestada'), qty),
          h('div', null, h('label', { className: 'field-label' }, 'Forma de cobro'), payment),
          h('div', { className: 'row-wrap justify-end pt-2' }, cancel, submit)
        );
        cancel.addEventListener('click', close);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const result = await erpStore.completeServiceRequest(request, {
            quantity: Number(qty.value), paymentMode: payment.value,
          });
          if (result?.ok) close();
        });
        return form;
      },
    });
  }

  function openServiceRequestCancelModal(request) {
    openModal({
      title: `Cancelar solicitud ${request.id}`,
      subtitle: 'La solicitud no generará ningún consumo.',
      renderBody: (close) => {
        const motivo = h('textarea', { className: 'input-control', rows: 3, placeholder: 'Motivo de cancelación' });
        const cancel = h('button', { type: 'button', className: 'btn btn-outline-muted' }, 'Volver');
        const submit = h('button', { type: 'submit', className: 'btn btn-danger' }, 'Confirmar cancelación');
        const form = h('form', { className: 'stack-md' },
          h('div', null, h('label', { className: 'field-label' }, 'Motivo'), motivo),
          h('div', { className: 'row-wrap justify-end pt-2' }, cancel, submit)
        );
        cancel.addEventListener('click', close);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (motivo.value.trim().length < 3) return;
          const result = await erpStore.cancelServiceRequest(request.id, motivo.value.trim());
          if (result?.ok) close();
        });
        return form;
      },
    });
  }

  function openConsumptionReasonModal(consumption, action) {
    const isAnnul = action === 'anular';
    openModal({
      title: `${isAnnul ? 'Anular' : 'Descartar'} consumo ${consumption.code}`,
      subtitle: isAnnul
        ? 'Se conservará la trazabilidad y se revertirá el movimiento de inventario asociado.'
        : 'El consumo pendiente no se confirmará ni afectará el inventario.',
      renderBody: (close) => {
        const reason = h('textarea', { className: 'input-control', rows: 3, placeholder: 'Indica el motivo' });
        const back = h('button', { type: 'button', className: 'btn btn-outline-muted' }, 'Volver');
        const submit = h('button', { type: 'submit', className: 'btn btn-danger' }, isAnnul ? 'Confirmar anulación' : 'Confirmar descarte');
        const form = h('form', { className: 'stack-md' },
          h('div', null, h('label', { className: 'field-label' }, 'Motivo'), reason),
          h('div', { className: 'row-wrap justify-end pt-2' }, back, submit)
        );
        back.addEventListener('click', close);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const motivo = reason.value.trim();
          if (motivo.length < 3) return;
          const result = isAnnul
            ? await erpStore.annulConsumption(consumption.id, motivo)
            : await erpStore.discardConsumption(consumption.id, motivo);
          if (result?.ok) close();
        });
        return form;
      },
    });
  }

  function isExpiringSoon(dateStr) {
    if (!dateStr) return false;
    const base = new Date(`${TODAY}T00:00:00`).getTime();
    const target = new Date(`${dateStr}T00:00:00`).getTime();
    const diffDays = (target - base) / (1000 * 60 * 60 * 24);
    return diffDays <= 7;
  }

  function renderContent() {
    setActivePagedList(null); // cada pantalla paginada se vuelve a enlazar al dibujarse
    const state = erpStore.state;
    const currentUser = erpStore.currentUser;
    if (!state || !currentUser) return;

    const route = getRoute();
    const visibleTabs = M3_TABS.filter((t) => erpStore.canViewTab('m3', t.id));
    const defaultTab = erpStore.getDefaultTab('m3') || visibleTabs[0]?.id || 'productos';
    const requestedTab = route.tab || defaultTab;
    const activeTab = visibleTabs.some((t) => t.id === requestedTab) ? requestedTab : defaultTab;
    const activeMeta = M3_TABS.find((t) => t.id === activeTab);
    const isTabDenied = Boolean(route.tab && !erpStore.canViewTab('m3', route.tab));
    const canEditCurrentTab = erpStore.canEditTab('m3', activeTab);

    const openFolios = state.folios.filter((f) => f.status === 'Abierto');
    if (!m3Ui.posFolioId && openFolios.length > 0) m3Ui.posFolioId = openFolios[0].id;
    const occupiedRooms = state.rooms.filter((r) => r.commercialStatus === 'Ocupada');

    const lowStockItems = state.inventory.filter((i) => i.active && i.stock <= i.minStock);
    const expiringItems = state.inventory.filter((i) => i.active && isExpiringSoon(i.expiryDate));
    const pendingReqs = state.supplyRequisitions.filter((r) => r.status === 'Solicitada');

    let tabBody = null;

    if (isTabDenied) {
      tabBody = AccessDeniedCard({
        resourceName: `Servicios, POS y Almacén · ${M3_TABS.find((t) => t.id === route.tab)?.label || route.tab}`,
        roleLabel: currentUser.roleLabel,
        onBack: () => navigateToView('/servicios', defaultTab, true),
      });
    } else if (activeTab === 'productos') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.productos);
      tabBody = view;
      setVisible(tabBody, 'new-btn', canEditCurrentTab);
      setVisible(tabBody, 'manage-categories-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', () => openProductModal(null));
        getRef(tabBody, 'manage-categories-btn').addEventListener('click', () => openM3ManagerModal('category', 'catálogo'));
      }

      const catFilter = getRef(tabBody, 'cat-filter');
      catFilter.value = m3Ui.prodCategory;

      const renderRows = () => {
        const q = m3Ui.prodSearch.trim().toLowerCase();
        const filtered = state.products.filter(
          (p) =>
            (m3Ui.prodCategory === 'Todas' || p.category === m3Ui.prodCategory) &&
            (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
        );
        const pager = localPager('m3.productos', filtered, renderRows, 10);
        mountRef(
          tabBody,
          'tbody',
          pager.slice.map((p) => {
            // El costo sale de la receta vigente o del artículo ligado; sin ninguno de los dos no hay costo ni margen.
            const hasCost = p.cost != null;
            const margin = hasCost && p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : null;
            const row = clone('fila-producto');
            setText(row, 'code', p.sku);
            setText(row, 'name', p.name);
            setText(row, 'category', p.category);
            setText(row, 'stock', p.stockControl || 'Sin control');
            setText(row, 'cost', hasCost ? formatCurrency(p.cost) : '—');
            setText(row, 'price', formatCurrency(p.price));
            setText(row, 'margin', margin == null ? '—' : `${margin}%`);
            if (canEditCurrentTab) {
              row.style.cursor = 'pointer';
              row.addEventListener('click', () => openProductModal(p));
            }
            return row;
          })
        );
        mountRef(tabBody, 'footer-slot', pager.footer);
      };

      mountRef(
        tabBody,
        'search-slot',
        SearchInput({
          value: m3Ui.prodSearch,
          placeholder: 'Buscar producto o SKU...',
          focusId: 'm3-prod-search',
          onChange: (v) => {
            m3Ui.prodSearch = v;
            resetLocalPager('m3.productos');
            renderRows();
          },
        })
      );
      catFilter.addEventListener('change', (e) => {
        m3Ui.prodCategory = e.target.value;
        resetLocalPager('m3.productos');
        renderRows();
      });
      renderRows();
    } else if (activeTab === 'servicios') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.servicios);
      tabBody = view;
      setVisible(tabBody, 'new-btn', canEditCurrentTab);
      setVisible(tabBody, 'manage-categories-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', () => openServiceModal(null));
        getRef(tabBody, 'manage-categories-btn').addEventListener('click', () => openM3ManagerModal('category', 'catálogo'));
      }
      const servicesPager = localPager('m3.servicios', state.services, renderContent, 10);
      mountRef(
        tabBody,
        'grid',
        servicesPager.slice.map((srv) => {
          const card = clone('card-servicio');
          setText(card, 'code-area', `${srv.code} · ${srv.area}`);
          setText(card, 'price', formatCurrency(srv.price));
          setText(card, 'name', srv.name);
          setText(card, 'desc', srv.description || '');
          setText(
            card,
            'meta',
            `${srv.pointOfSale || srv.area || ''}${srv.durationMinutes ? ` · ${srv.durationMinutes} min` : ''}`
          );
          if (canEditCurrentTab) {
            card.style.cursor = 'pointer';
            card.addEventListener('click', () => openServiceModal(srv));
          }
          return card;
        })
      );
      mountRef(tabBody, 'footer-slot', servicesPager.footer);
    } else if (activeTab === 'pos') {
      const invById = new Map(state.inventory.map((i) => [i.id, i]));
      const cartTotal = m3Ui.cart.reduce((s, c) => s + c.quantity * c.unitPrice, 0);
      const selectedFolio = openFolios.find((f) => f.id === m3Ui.posFolioId);
      const filteredProducts = state.products.filter(
        (p) => p.available !== false && (m3Ui.posCategory === 'Todos' || p.category === m3Ui.posCategory)
      );
      const posPager = localPager('m3.pos.productos', filteredProducts, renderContent, 10);

      const { root: view, clone } = loadViewTemplate(VIEW_HTML.pos);
      tabBody = view;
      mountRef(tabBody, 'cart-icon', icon('shoppingCart', 'w-4 text-teal'));
      setVisible(tabBody, 'manage-pos-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        getRef(tabBody, 'manage-pos-btn').addEventListener('click', () => openM3ManagerModal('point'));
      }

      const catGroup = getRef(tabBody, 'categories');
      catGroup.querySelectorAll('button[data-cat]').forEach((btn) => {
        const cat = btn.dataset.cat;
        btn.classList.toggle('is-active', m3Ui.posCategory === cat);
        btn.addEventListener('click', () => {
          m3Ui.posCategory = cat;
          resetLocalPager('m3.pos.productos');
          renderContent();
        });
      });

      mountRef(
        tabBody,
        'products-grid',
        posPager.slice.map((p) => {
          const linkedInv = p.linkedInventoryItemId ? invById.get(p.linkedInventoryItemId) : null;
          const outOfStock = p.stockControl === 'Directo' && linkedInv && linkedInv.stock <= 0;
          const btn = clone('pos-producto-btn');
          btn.disabled = !canEditCurrentTab || outOfStock;
          setText(btn, 'meta', `${p.category} · ${p.sku}`);
          setText(btn, 'name', p.name);
          setText(btn, 'price', formatCurrency(p.price));
          btn.addEventListener('click', () => addToCart(p));
          return btn;
        })
      );
      mountRef(tabBody, 'products-footer', posPager.footer);

      const originSel = getRef(tabBody, 'origin');
      originSel.value = m3Ui.posOrigin;
      originSel.addEventListener('change', (e) => {
        m3Ui.posOrigin = e.target.value;
        renderContent();
      });

      const payToggle = getRef(tabBody, 'payment-toggle');
      payToggle.querySelectorAll('button[data-pay]').forEach((btn) => {
        const mode = btn.dataset.pay;
        btn.classList.toggle('is-active', m3Ui.posPaymentMode === mode);
        btn.addEventListener('click', () => {
          m3Ui.posPaymentMode = mode;
          renderContent();
        });
      });

      const showTable =
        m3Ui.posPaymentMode === 'Pago Directo' &&
        (m3Ui.posOrigin === 'Restaurante' || m3Ui.posOrigin === 'Bar');
      setVisible(tabBody, 'table-wrap', showTable);
      const tableSel = getRef(tabBody, 'table-select');
      const cartPosIds = new Set(
        m3Ui.cart
          .map((line) => state.products.find((p) => p.id === line.productId)?.posId)
          .filter(Boolean)
      );
      const availableTables = state.tables.filter(
        (t) => t.status === 'Libre' && (cartPosIds.size === 0 || cartPosIds.has(t.posId))
      );
      mount(
        tableSel,
        availableTables.length === 0
          ? h('option', { value: '' }, 'Sin mesas disponibles')
          : availableTables.map((t) => h('option', { value: t.number, selected: m3Ui.posTable === t.number }, `${t.number} · ${t.zone}`))
      );
      if (!availableTables.some((t) => t.number === m3Ui.posTable)) m3Ui.posTable = availableTables[0]?.number || '';
      tableSel.value = m3Ui.posTable;
      tableSel.addEventListener('change', (e) => {
        m3Ui.posTable = e.target.value;
      });

      setVisible(tabBody, 'folio-wrap', m3Ui.posPaymentMode === 'Cargo a Habitación');
      const folioSel = getRef(tabBody, 'folio-select');
      mount(
        folioSel,
        openFolios.length === 0
          ? h('option', { value: '' }, 'Sin folios abiertos (Check-in requerido)')
          : openFolios.map((f) => h('option', { value: f.id, selected: m3Ui.posFolioId === f.id }, `Hab. ${f.roomNumber} — ${f.guestName} (${f.code})`))
      );
      if (m3Ui.posFolioId) folioSel.value = m3Ui.posFolioId;
      folioSel.addEventListener('change', (e) => {
        m3Ui.posFolioId = e.target.value;
        renderContent();
      });

      mountRef(
        tabBody,
        'cart-list',
        m3Ui.cart.length === 0
          ? clone('pos-carrito-vacio')
          : m3Ui.cart.map((c) => {
              const itemEl = clone('pos-carrito-item');
              setText(itemEl, 'name', c.name);
              setText(itemEl, 'unit-price', `${formatCurrency(c.unitPrice)} c/u`);
              setText(itemEl, 'qty', String(c.quantity));
              setText(itemEl, 'subtotal', formatCurrency(c.quantity * c.unitPrice));
              mountRef(itemEl, 'dec-btn', icon('minus', 'w-3'));
              mountRef(itemEl, 'inc-btn', icon('plus', 'w-3'));
              getRef(itemEl, 'dec-btn').addEventListener('click', () => updateCartQty(c.productId, -1));
              getRef(itemEl, 'inc-btn').addEventListener('click', () => updateCartQty(c.productId, 1));
              return itemEl;
            })
      );

      setText(tabBody, 'cart-total', formatCurrency(cartTotal));
      setVisible(tabBody, 'submit-btn', canEditCurrentTab && m3Ui.cart.length > 0);
      const submitBtn = getRef(tabBody, 'submit-btn');
      if (submitBtn && canEditCurrentTab) {
        mountRef(tabBody, 'submit-icon', icon('check', 'w-4'));
        setText(tabBody, 'submit-label', m3Ui.posPaymentMode === 'Cargo a Habitación' ? 'Confirmar y Cargar a Habitación' : 'Registrar Venta Directa');
        submitBtn.addEventListener('click', async () => {
          const targetRoom = selectedFolio ? state.rooms.find((r) => r.number === selectedFolio.roomNumber) : null;
          const res = await erpStore.createPOSOrder({
            source: m3Ui.posOrigin,
            tableNumber: m3Ui.posOrigin === 'Restaurante' || m3Ui.posOrigin === 'Bar' ? m3Ui.posTable : undefined,
            roomId: m3Ui.posPaymentMode === 'Cargo a Habitación' ? targetRoom?.id : undefined,
            paymentMode: m3Ui.posPaymentMode === 'Pago Directo' ? 'Pago Directo' : 'Cargo a Habitación',
            items: m3Ui.cart.map((c) => ({ id: c.productId, name: c.name, quantity: c.quantity, unitPrice: c.unitPrice })),
          });
          if (res.ok) {
            m3Ui.cart = [];
            renderContent();
          }
        });
      }

      const renderConsumptionHistory = (rows) => rows.map((consumption) => {
        const row = clone('fila-historial-consumo');
        setText(row, 'title', `${consumption.code} · ${consumption.source || 'POS'}${consumption.roomNumber ? ` · Hab. ${consumption.roomNumber}` : ''}`);
        setText(row, 'items', consumption.items.map((item) => `${item.quantity}x ${item.name}`).join(', ') || 'Sin detalle');
        setText(row, 'meta', `${consumption.paymentMode || 'Forma de cobro no indicada'}${consumption.guestName ? ` · ${consumption.guestName}` : ''} · ${consumption.createdAt || ''}`);
        setText(row, 'total', formatCurrency(consumption.total));
        mountRef(row, 'status', StatusText({ label: consumption.status, variant: getStatusVariant(consumption.status) }));
        const pending = consumption.rawStatus === 'por confirmar';
        const confirmed = consumption.rawStatus === 'confirmado';
        setVisible(row, 'confirm-btn', canEditCurrentTab && pending);
        setVisible(row, 'discard-btn', canEditCurrentTab && pending);
        setVisible(row, 'annul-btn', canEditCurrentTab && confirmed);
        if (canEditCurrentTab && pending) {
          getRef(row, 'confirm-btn').addEventListener('click', () => erpStore.confirmConsumption(consumption.id));
          getRef(row, 'discard-btn').addEventListener('click', () => openConsumptionReasonModal(consumption, 'descartar'));
        }
        if (canEditCurrentTab && confirmed) {
          getRef(row, 'annul-btn').addEventListener('click', () => openConsumptionReasonModal(consumption, 'anular'));
        }
        return row;
      });
      bindPagedContainer({
        key: 'm3.historial-consumos',
        container: getRef(tabBody, 'consumption-history'),
        list: getPagedList('m3.historial-consumos', { path: '/m3/consumos', map: mapConsumoRows, pageSize: 10 }),
        filters: {
          searchPlaceholder: 'Buscar consumo, punto de venta, habitación o huésped…',
          statuses: ['por confirmar', 'confirmado', 'descartado', 'anulado'],
          dates: true,
        },
        renderBody: renderConsumptionHistory,
        empty: { iconName: 'receipt', title: 'Sin consumos', description: 'Todavía no hay consumos registrados.' },
        noMatch: { iconName: 'search', title: 'Sin consumos coincidentes', description: 'Prueba con otros filtros.' },
      });
    } else if (activeTab === 'restaurante') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.restaurante);
      tabBody = view;
      mountRef(tabBody, 'monitor-icon', icon('chefHat', 'w-4 text-teal'));
      setVisible(tabBody, 'manage-tables-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        getRef(tabBody, 'manage-tables-btn').addEventListener('click', () => openM3ManagerModal('table'));
      }

      const tablesPager = localPager('m3.restaurante.mesas', state.tables, renderContent, 10);
      mountRef(
        tabBody,
        'tables-grid',
        tablesPager.slice.map((tb) => {
          const card = clone('card-mesa');
          setText(card, 'title', `Mesa ${tb.number}`);
          setText(card, 'meta', tb.seats > 0 ? `${tb.zone} · ${tb.seats} personas` : tb.zone);
          mountRef(card, 'status', StatusText({ label: tb.status, variant: getStatusVariant(tb.status) }));
          if (tb.roomNumber) {
            setText(card, 'room-label', `Huésped Hab. ${tb.roomNumber}`);
            setVisible(card, 'room-label', true);
          }
          // La ocupación depende de las comandas abiertas; lo único editable es activar o desactivar la mesa.
          setVisible(card, 'toggle-btn', canEditCurrentTab);
          if (canEditCurrentTab) {
            const btn = getRef(card, 'toggle-btn');
            const inactive = tb.status === 'Inactiva';
            btn.textContent = inactive ? 'Activar mesa' : 'Desactivar mesa';
            if (tb.status === 'Ocupada') {
              btn.disabled = true;
              btn.title = 'Tiene una comanda abierta: ciérrala o cancélala primero.';
            }
            btn.addEventListener('click', () => {
              if (inactive) {
                erpStore.updateTableStatus(tb.id, 'Libre');
                return;
              }
              const reason = window.prompt(`Motivo para desactivar la mesa ${tb.number}:`, '');
              if (reason === null) return;
              erpStore.updateTableStatus(tb.id, 'Inactiva', reason);
            });
          }
          return card;
        })
      );
      mountRef(tabBody, 'tables-footer', tablesPager.footer);

      const renderOrderRows = (rows) =>
        h('div', null, ...rows.map((ord) => {
          const row = clone('fila-comanda-restaurante');
          const locLabel = [
            ord.source,
            ord.tableNumber ? `Mesa ${ord.tableNumber}` : null,
            ord.roomNumber ? `Hab. ${ord.roomNumber}` : null,
          ].filter(Boolean).join(' ');
          setText(row, 'title', `${ord.code} · ${locLabel}`);
          setText(row, 'items', ord.items.map((i) => `${i.quantity}x ${i.name}`).join(', '));
          setText(row, 'total', formatCurrency(ord.total));
          mountRef(row, 'status', StatusText({ label: ord.status, variant: getStatusVariant(ord.status) }));
          const showAction = canEditCurrentTab && !['Entregado', 'Cobrado', 'Cancelada', 'Anulado', 'Descartado'].includes(ord.status);
          setVisible(row, 'action-btn', showAction);
          if (showAction) {
            const btn = getRef(row, 'action-btn');
            btn.textContent = ord.status === 'Preparando' ? 'En camino' : 'Entregar';
            btn.addEventListener('click', () =>
              erpStore.updatePOSOrderStatus(ord.id, ord.status === 'Preparando' ? 'En camino' : 'Entregado')
            );
          }
          return row;
        }));
      bindPagedContainer({
        container: getRef(tabBody, 'orders-list'),
        key: 'm3.comandas',
        list: getPagedList('m3.comandas', { path: '/m3/comandas', map: mapComandaRows, pageSize: 10 }),
        filters: {
          searchPlaceholder: 'Buscar comanda, mesa, habitación o huésped…',
          dates: true,
          statusOptions: [
            { value: '', label: 'Todos los estados' },
            { value: 'pendiente,en preparación,lista', label: 'Abiertas' },
            { value: 'pendiente', label: 'Pendiente' },
            { value: 'en preparación', label: 'Preparando' },
            { value: 'lista', label: 'Lista' },
            { value: 'entregada', label: 'Entregada' },
            { value: 'cancelada', label: 'Cancelada' },
          ],
        },
        renderBody: renderOrderRows,
        empty: { iconName: 'utensils', title: 'Sin comandas', description: 'Aún no hay comandas registradas.' },
        noMatch: { iconName: 'utensils', title: 'Sin comandas coincidentes', description: 'Prueba con otro estado, fechas o búsqueda.' },
      });
    } else if (activeTab === 'room_service') {
      const rsProducts = state.products.filter((p) => p.available !== false && ['Restaurante', 'Cafetería', 'Bar'].includes(p.category));
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.room_service);
      tabBody = view;

      const form = getRef(tabBody, 'rs-form');
      const roomSel = getRef(tabBody, 'room-select');
      const prodSel = getRef(tabBody, 'product-select');
      const qtyIn = getRef(tabBody, 'qty');

      mount(
        roomSel,
        occupiedRooms.length === 0
          ? h('option', { value: '' }, 'Sin habitaciones ocupadas')
          : occupiedRooms.map((r) => h('option', { value: r.id }, `Hab. ${r.number} (${r.type})`))
      );
      mount(
        prodSel,
        rsProducts.map((p) => h('option', { value: p.id }, `${p.name} (${formatCurrency(p.price)})`))
      );
      setVisible(tabBody, 'submit-btn', canEditCurrentTab && occupiedRooms.length > 0);
      if (canEditCurrentTab) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const prod = state.products.find((p) => p.id === prodSel.value);
          const qty = Math.max(1, Number(qtyIn.value || 1));
          if (!prod || !roomSel.value) return;
          erpStore.createPOSOrder({
            source: 'Room Service',
            roomId: roomSel.value,
            paymentMode: 'Cargo a Habitación',
            items: [{ id: prod.id, name: prod.name, quantity: qty, unitPrice: prod.price }],
          });
        });
      }

      const renderRoomServiceRows = (rows) =>
        h('div', null, ...rows.map((ord) => {
              const row = clone('fila-pedido-rs');
              setText(row, 'title', `${ord.code} · Hab. ${ord.roomNumber || '—'} (${ord.guestName || '—'})`);
              setText(row, 'items', `${ord.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')} · ${formatCurrency(ord.total)}`);
              mountRef(row, 'status', StatusText({ label: ord.status, variant: getStatusVariant(ord.status) }));
              const showDeliver = canEditCurrentTab && !['Entregado', 'Cobrado', 'Cancelada', 'Anulado', 'Descartado'].includes(ord.status);
              setVisible(row, 'deliver-btn', showDeliver);
              if (showDeliver) {
                getRef(row, 'deliver-btn').addEventListener('click', () => erpStore.updatePOSOrderStatus(ord.id, 'Entregado'));
              }
              return row;
            }));
      bindPagedContainer({
        container: getRef(tabBody, 'orders-list'),
        key: 'm3.roomservice',
        list: getPagedList('m3.roomservice', { path: '/m3/comandas?modalidad=' + encodeURIComponent('habitación'), map: mapComandaRows, pageSize: 10 }),
        filters: {
          searchPlaceholder: 'Buscar pedido, habitación o huésped…',
          dates: true,
          statusOptions: [
            { value: '', label: 'Todos los estados' },
            { value: 'pendiente,en preparación,lista', label: 'En curso' },
            { value: 'entregada', label: 'Entregado' },
            { value: 'cancelada', label: 'Cancelado' },
          ],
        },
        renderBody: renderRoomServiceRows,
        empty: { iconName: 'utensils', title: 'Sin pedidos de Room Service', description: 'Registra un pedido desde el formulario para cargarlo a la habitación.' },
        noMatch: { iconName: 'utensils', title: 'Sin pedidos coincidentes', description: 'Prueba con otro estado, fechas o búsqueda.' },
      });
    } else if (activeTab === 'minibar') {
      const miniProducts = state.products.filter((p) => p.available !== false && (p.category === 'Minibar' || p.category === 'Bar'));
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.minibar);
      tabBody = view;

      const form = getRef(tabBody, 'min-form');
      const roomSel = getRef(tabBody, 'room-select');
      const prodSel = getRef(tabBody, 'product-select');
      const qtyIn = getRef(tabBody, 'qty');

      mount(
        roomSel,
        occupiedRooms.length === 0
          ? h('option', { value: '' }, 'Sin habitaciones ocupadas')
          : occupiedRooms.map((r) => h('option', { value: r.id }, `Hab. ${r.number}`))
      );
      mount(
        prodSel,
        miniProducts.map((p) => h('option', { value: p.id }, `${p.name} (${formatCurrency(p.price)})`))
      );
      setVisible(tabBody, 'submit-btn', canEditCurrentTab && occupiedRooms.length > 0);
      if (canEditCurrentTab) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const prod = state.products.find((p) => p.id === prodSel.value);
          const qty = Math.max(1, Number(qtyIn.value || 1));
          if (!prod || !roomSel.value) return;
          erpStore.createPOSOrder({
            source: 'Minibar',
            roomId: roomSel.value,
            paymentMode: 'Cargo a Habitación',
            items: [{ id: prod.id, name: prod.name, quantity: qty, unitPrice: prod.price }],
          });
        });
      }

      const renderMinibarRows = (rows) =>
        h('div', null, ...rows.map((ord) => {
              const row = clone('fila-pedido-minibar');
              setText(row, 'title', `${ord.code} · Hab. ${ord.roomNumber || '—'}`);
              setText(row, 'items', ord.items.map((i) => `${i.quantity}x ${i.name}`).join(', '));
              setText(row, 'total', formatCurrency(ord.total));
              return row;
            }));
      bindPagedContainer({
        container: getRef(tabBody, 'orders-list'),
        key: 'm3.minibar',
        list: getPagedList('m3.minibar', { path: '/m3/consumos?puntoVenta=PV-MINI', map: mapConsumoRows, pageSize: 10 }),
        filters: {
          searchPlaceholder: 'Buscar consumo, habitación o huésped…',
          dates: true,
        },
        renderBody: renderMinibarRows,
        empty: { iconName: 'utensils', title: 'Sin consumos de Minibar', description: 'Registra consumos desde el panel izquierdo.' },
        noMatch: { iconName: 'utensils', title: 'Sin consumos coincidentes', description: 'Prueba con otras fechas o búsqueda.' },
      });
    } else if (activeTab === 'servicios_comp') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.servicios_comp);
      tabBody = view;

      const form = getRef(tabBody, 'srv-form');
      const srvSel = getRef(tabBody, 'service-select');
      const roomSel = getRef(tabBody, 'room-select');
      const qtyIn = getRef(tabBody, 'quantity');
      const scheduledIn = getRef(tabBody, 'scheduled-at');
      const activeServices = state.services.filter((s) => s.active !== false);

      mount(
        srvSel,
        activeServices.map((s) => h('option', { value: s.id }, `${s.area}: ${s.name} (${formatCurrency(s.price)})`))
      );
      mount(
        roomSel,
        occupiedRooms.length === 0
          ? h('option', { value: '' }, 'Sin habitaciones ocupadas')
          : occupiedRooms.map((r) => h('option', { value: r.id }, `Hab. ${r.number}`))
      );
      setVisible(tabBody, 'submit-btn', canEditCurrentTab && activeServices.length > 0 && occupiedRooms.length > 0);
      if (canEditCurrentTab) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const srv = activeServices.find((s) => s.id === srvSel.value);
          const room = occupiedRooms.find((r) => r.id === roomSel.value);
          if (!srv || !room) return;
          const result = await erpStore.createServiceRequest({
            serviceId: srv.id,
            roomId: room.id,
            roomNumber: room.number,
            quantity: Math.max(1, Number(qtyIn.value || 1)),
            scheduledAt: scheduledIn.value || undefined,
          });
          if (result?.ok) form.reset();
        });
      }

      const servicesCompPager = localPager('m3.servicios-comp', activeServices, renderContent, 10);
      mountRef(
        tabBody,
        'services-list',
        servicesCompPager.slice.map((srv) => {
          const row = clone('fila-tarifa-servicio');
          setText(row, 'name', srv.name);
          setText(row, 'area', srv.area);
          setText(row, 'desc', srv.description || '');
          setText(row, 'price', formatCurrency(srv.price));
          return row;
        })
      );
      mountRef(tabBody, 'services-footer', servicesCompPager.footer);

      const requestStatus = {
        solicitada: 'Solicitada',
        'en atención': 'En atención',
        completada: 'Completada',
        cancelada: 'Cancelada',
      };
      bindPagedContainer({
        key: 'm3.solicitudes-servicio',
        container: getRef(tabBody, 'requests-list'),
        list: getPagedList('m3.solicitudes-servicio', {
          path: '/m3/solicitudes-servicio',
          pageSize: 10,
          map: (rows) => rows.map((row) => ({
            id: row.numero_solicitud,
            stayId: row.id_estadia_externa,
            service: row.servicio,
            roomNumber: row.numero_habitacion,
            guestName: row.huesped_nombre,
            requestedQuantity: Number(row.cantidad_solicitada || 0),
            scheduledAt: row.fecha_hora_prevista,
            rawStatus: row.estado,
            status: requestStatus[row.estado] || row.estado,
          })),
        }),
        filters: {
          searchPlaceholder: 'Buscar solicitud, servicio, habitación o huésped…',
          statuses: ['solicitada', 'en atención', 'completada', 'cancelada'],
          dates: true,
        },
        renderBody: (rows) => rows.map((request) => {
          const row = clone('fila-solicitud-servicio');
          setText(row, 'title', `${request.id} · ${request.service}`);
          setText(row, 'meta', `Hab. ${request.roomNumber || '—'} · ${request.guestName || 'Huésped'} · Cant. ${request.requestedQuantity}${request.scheduledAt ? ` · ${request.scheduledAt}` : ''}`);
          mountRef(row, 'status', StatusText({ label: request.status, variant: getStatusVariant(request.status) }));
          const canStart = canEditCurrentTab && request.rawStatus === 'solicitada';
          const canComplete = canEditCurrentTab && request.rawStatus === 'en atención';
          const canCancel = canEditCurrentTab && ['solicitada', 'en atención'].includes(request.rawStatus);
          setVisible(row, 'start-btn', canStart);
          setVisible(row, 'complete-btn', canComplete);
          setVisible(row, 'cancel-btn', canCancel);
          if (canStart) getRef(row, 'start-btn').addEventListener('click', () => erpStore.startServiceRequest(request.id));
          if (canComplete) getRef(row, 'complete-btn').addEventListener('click', () => openServiceRequestCompleteModal(request));
          if (canCancel) getRef(row, 'cancel-btn').addEventListener('click', () => openServiceRequestCancelModal(request));
          return row;
        }),
        empty: { iconName: 'clipboardList', title: 'Sin solicitudes', description: 'No hay solicitudes de servicios registradas.' },
        noMatch: { iconName: 'search', title: 'Sin solicitudes coincidentes', description: 'Prueba con otros filtros.' },
      });
    } else if (activeTab === 'inventario') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.inventario);
      tabBody = view;
      mountRef(tabBody, 'req-icon', icon('packageCheck', 'w-4 text-teal'));

      mountRef(
        tabBody,
        'kpis',
        StatTile({ label: 'Ítems en Almacén', value: state.inventory.length }),
        StatTile({ label: 'Bajo Stock Mínimo', value: lowStockItems.length, tone: lowStockItems.length > 0 ? 'warning' : 'success' }),
        StatTile({ label: 'Próximos a Vencer', value: expiringItems.length, tone: expiringItems.length > 0 ? 'danger' : 'success' }),
        StatTile({ label: 'Solicitudes Pendientes', value: pendingReqs.length, tone: 'teal' })
      );

      const reqPager = localPager('m3.inventario.requisiciones', state.supplyRequisitions, renderContent, 10);
      mountRef(
        tabBody,
        'req-list',
        reqPager.slice.map((req) => {
          const invItem = state.inventory.find((i) => i.id === req.inventoryItemId);
          const row = clone('fila-requisicion');
          setText(row, 'title', `${req.code} · ${req.itemName} (${req.quantity} ${req.unit})`);
          setText(
            row,
            'meta',
            `Solicitante: ${req.requestedByUser || 'Personal'} (${req.requestedByArea})${invItem ? ` · Stock almacén actual: ${invItem.stock} ${invItem.unit}` : ''}`
          );
          mountRef(row, 'status', StatusText({ label: req.status, variant: getStatusVariant(req.status) }));

          const canDispatch = canEditCurrentTab && req.status === 'Solicitada';
          const canPurchase = canEditCurrentTab && (req.status === 'Solicitada' || req.status === 'Compra requerida');
          setVisible(row, 'dispatch-btn', canDispatch);
          setVisible(row, 'purchase-btn', canPurchase);
          if (canDispatch) {
            mountRef(row, 'dispatch-icon', icon('packageCheck', 'w-3'));
            getRef(row, 'dispatch-btn').addEventListener('click', () => erpStore.fulfillSupplyRequisition(req.id, 'despachar'));
          }
          if (canPurchase) {
            getRef(row, 'purchase-btn').addEventListener('click', () => openPurchaseOrderModal(req));
          }
          return row;
        })
      );
      mountRef(tabBody, 'req-footer', reqPager.footer);

      setVisible(tabBody, 'actions-th', canEditCurrentTab);

      const renderInvRows = () => {
        const q = m3Ui.search.trim().toLowerCase();
        const filtered = state.inventory.filter((i) => !q || i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q));
        const invPager = localPager('m3.inventario.items', filtered, renderInvRows, 10);
        mountRef(
          tabBody,
          'inv-tbody',
          invPager.slice.map((item) => {
            const low = item.stock <= item.minStock;
            const soon = isExpiringSoon(item.expiryDate);
            const row = clone('fila-inventario');
            setText(row, 'sku', item.sku);
            setText(row, 'name', item.name);
            setText(row, 'category', item.category);
            const stockEl = setText(row, 'stock', String(item.stock));
            if (stockEl && low) stockEl.classList.add('text-danger');
            setText(row, 'min-stock', ` / ${item.minStock} ${item.unit}`);
            setText(row, 'unit-cost', formatCurrency(item.unitCost));
            const expEl = getRef(row, 'expiry');
            if (expEl) {
              if (!item.expiryDate) {
                expEl.textContent = 'No aplica';
                expEl.classList.add('text-slate-400');
              } else if (soon) {
                expEl.replaceChildren(
                  document.createTextNode(`${item.expiryDate} `),
                  h('span', { className: 'text-danger font-semibold' }, '· Próximo')
                );
              } else {
                expEl.textContent = item.expiryDate;
              }
            }
            mountRef(row, 'status', StatusText({
              label: !item.active ? 'Inactivo' : low ? 'Reponer' : 'Óptimo',
              variant: !item.active ? 'muted' : low ? 'danger' : 'success',
            }));
            setVisible(row, 'action-cell', canEditCurrentTab);
            if (canEditCurrentTab) {
              mountRef(row, 'adjust-icon', icon('arrowDownUp', 'w-3'));
              setVisible(row, 'adjust-btn', item.active);
              if (item.active) getRef(row, 'adjust-btn').addEventListener('click', () => openInventoryMoveModal(item));
              getRef(row, 'edit-btn').addEventListener('click', () => openInventoryCreateModal(item));
              setText(row, 'status-btn', item.active ? 'Desactivar' : 'Activar');
              getRef(row, 'status-btn').addEventListener('click', () => erpStore.setInventoryItemStatus(item.id, !item.active));
            }
            return row;
          })
        );
        mountRef(tabBody, 'inv-footer', invPager.footer);
      };

      mountRef(
        tabBody,
        'search-slot',
        SearchInput({
          value: m3Ui.search,
          placeholder: 'Buscar insumo o SKU...',
          focusId: 'm3-inv-search',
          onChange: (v) => {
            m3Ui.search = v;
            resetLocalPager('m3.inventario.items');
            renderInvRows();
          },
        })
      );
      setVisible(tabBody, 'new-item-btn', canEditCurrentTab);
      setVisible(tabBody, 'manage-categories-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-item-icon', icon('packagePlus', 'w-3.5'));
        getRef(tabBody, 'new-item-btn').addEventListener('click', openInventoryCreateModal);
        getRef(tabBody, 'manage-categories-btn').addEventListener('click', () => openM3ManagerModal('category', 'almacén'));
      }
      renderInvRows();

      const kardexList = getPagedList('m3.inventario.kardex', {
        path: '/m3/inventario/kardex',
        pageSize: 10,
        map: (rows) => rows.map((mv) => ({
          id: mv.id_movimiento,
          type: mv.tipo_movimiento,
          itemName: mv.articulo,
          reference: mv.id_origen || mv.id_lote || 'Sin referencia',
          quantity: (mv.signo === 'salida' ? -1 : 1) * Number(mv.cantidad || 0),
          date: mv.fecha_hora,
        })),
      });
      bindPagedContainer({
        key: 'm3.inventario.kardex',
        list: kardexList,
        container: getRef(tabBody, 'kardex-list'),
        filters: { searchPlaceholder: 'Buscar tipo, motivo o referencia…', showDates: true },
        renderBody: (rows) => rows.map((mv) => {
          const row = clone('fila-kardex');
          setText(row, 'title', `${mv.type} · ${mv.itemName}`);
          setText(row, 'ref', `(${mv.reference})`);
          const qtyEl = getRef(row, 'qty');
          const numQty = Number(mv.quantity || 0);
          qtyEl.textContent = numQty > 0 ? `+${numQty}` : String(numQty);
          qtyEl.classList.add(numQty < 0 ? 'text-danger' : 'text-teal');
          setText(row, 'date', mv.date);
          return row;
        }),
        empty: { iconName: 'clipboardList', title: 'Sin movimientos', description: 'No hay movimientos de inventario registrados.' },
        noMatch: { iconName: 'search', title: 'Sin movimientos coincidentes', description: 'Prueba con otra búsqueda o rango de fechas.' },
      });
      mountRef(tabBody, 'kardex-footer', null);
    } else if (activeTab === 'proveedores') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.proveedores);
      tabBody = view;

      setVisible(tabBody, 'header-actions', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-sup-icon', icon('plus', 'w-3.5'));
        mountRef(tabBody, 'new-po-icon', icon('truck', 'w-3.5'));
        getRef(tabBody, 'new-sup-btn').addEventListener('click', openSupplierModal);
        getRef(tabBody, 'new-po-btn').addEventListener('click', () => openPurchaseOrderModal(null));
      }

      const renderPurchaseRows = (rows) => {
        const frag = document.createDocumentFragment();
        for (const po of rows) {
          frag.appendChild((() => {
          const row = clone('fila-orden-compra');
          setText(row, 'code', po.code);
          setText(row, 'date', po.createdAt);
          setText(row, 'supplier', po.supplierName);
          setText(row, 'items', po.items.map((i) => `${i.quantity} ${i.itemName}`).join(', '));
          setText(row, 'total', formatCurrency(po.total));
          mountRef(row, 'status', StatusText({ label: po.status, variant: getStatusVariant(po.status) }));
          const isPending = po.rawStatus === 'pendiente de aprobación';
          const showReceive = canEditCurrentTab && ['enviada', 'parcialmente recibida'].includes(po.rawStatus);
          setVisible(row, 'edit-btn', canEditCurrentTab && isPending);
          setVisible(row, 'approve-btn', canEditCurrentTab && isPending);
          setVisible(row, 'reject-btn', canEditCurrentTab && isPending);
          setVisible(row, 'cancel-btn', canEditCurrentTab && isPending);
          setVisible(row, 'send-btn', canEditCurrentTab && po.rawStatus === 'aprobada');
          setVisible(row, 'receive-btn', showReceive);
          const activeReceipt = po.receipts?.find((receipt) => receipt.rawStatus !== 'anulada');
          setVisible(row, 'annul-receipt-btn', canEditCurrentTab && Boolean(activeReceipt));
          if (isPending && canEditCurrentTab) {
            getRef(row, 'edit-btn').addEventListener('click', () => openPurchaseOrderModal(null, po));
            getRef(row, 'approve-btn').addEventListener('click', () => openPurchaseReasonModal(po, 'aprobar'));
            getRef(row, 'reject-btn').addEventListener('click', () => openPurchaseReasonModal(po, 'rechazar'));
            getRef(row, 'cancel-btn').addEventListener('click', () => openPurchaseReasonModal(po, 'cancelar'));
          }
          if (po.rawStatus === 'aprobada' && canEditCurrentTab) {
            getRef(row, 'send-btn').addEventListener('click', () => erpStore.sendPurchaseOrder(po.id, 'correo'));
          }
          if (showReceive) {
            mountRef(row, 'receive-icon', icon('packageCheck', 'w-3'));
            getRef(row, 'receive-btn').addEventListener('click', () => openPurchaseReceiptModal(po));
          } else if (po.receivedAt || po.status === 'Recibida') {
            setText(row, 'received-at', po.receivedAt || po.createdAt);
            setVisible(row, 'received-at', true);
          }
          if (activeReceipt && canEditCurrentTab) {
            getRef(row, 'annul-receipt-btn').addEventListener('click', () => openPurchaseReasonModal(po, 'anularRecepcion'));
          }
          return row;
        })());
        }
        return frag;
      };
      bindPagedContainer({
        container: getRef(tabBody, 'po-tbody'),
        key: 'm3.oc',
        list: getPagedList('m3.oc', { path: '/m3/ordenes-compra', map: mapPurchaseOrderRows, pageSize: 10 }),
        filters: {
          searchPlaceholder: 'Buscar orden o proveedor…',
          dates: true,
          statusOptions: [
            { value: '', label: 'Todos los estados' },
            { value: 'pendiente de aprobación', label: 'Pendiente de aprobación' },
            { value: 'aprobada,enviada', label: 'Aprobada / enviada' },
            { value: 'parcialmente recibida', label: 'Parcialmente recibida' },
            { value: 'completada', label: 'Recibida' },
            { value: 'rechazada,cancelada', label: 'Rechazada / cancelada' },
          ],
        },
        renderBody: renderPurchaseRows,
        empty: { iconName: 'truck', title: 'Sin órdenes de compra', description: 'Aún no hay órdenes registradas.' },
        noMatch: { iconName: 'truck', title: 'Sin órdenes coincidentes', description: 'Prueba con otro estado, fechas o búsqueda.' },
      });

      const suppliersPager = localPager('m3.proveedores', state.suppliers, renderContent, 10);
      mountRef(
        tabBody,
        'sup-grid',
        suppliersPager.slice.map((sup) => {
          const card = clone('card-proveedor');
          setText(card, 'name', sup.name);
          setText(card, 'rating', sup.rating == null ? 'Sin calificación' : `★ ${sup.rating}`);
          setText(card, 'ruc-cat', `RUC ${sup.ruc || '—'} · ${sup.category || '—'}`);
          setText(card, 'contact', `Contacto: ${sup.contactName || '—'} · ${sup.phone || '—'} · Entrega: ${sup.leadTimeDays > 0 ? `${sup.leadTimeDays} día(s)` : '—'}`);
          setVisible(card, 'edit-btn', canEditCurrentTab);
          setVisible(card, 'status-btn', canEditCurrentTab);
          if (canEditCurrentTab) {
            setText(card, 'status-btn', sup.active ? 'Desactivar' : 'Activar');
            getRef(card, 'edit-btn').addEventListener('click', () => openSupplierModal(sup));
            getRef(card, 'status-btn').addEventListener('click', () => openSupplierStatusModal(sup));
          }
          return card;
        })
      );
      mountRef(tabBody, 'sup-footer', suppliersPager.footer);
    } else if (activeTab === 'recetas') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.recetas);
      tabBody = view;
      setVisible(tabBody, 'new-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('chefHat', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', openRecipeModal);
      }

      const recipesPager = localPager('m3.recetas', state.recipes, renderContent, 10);
      mountRef(
        tabBody,
        'recipes-grid',
        recipesPager.slice.map((rec) => {
          const card = clone('card-receta');
          setText(card, 'name', rec.productName);
          setText(card, 'version', `V${rec.version} · ${rec.status}`);
          mountRef(
            card,
            'ingredients',
            rec.ingredients.map((i) => {
              const row = clone('fila-ingrediente');
              setText(row, 'item', i.itemName);
              setText(row, 'qty', `${i.quantity} ${i.unit}`);
              return row;
            })
          );
          setVisible(card, 'disable-btn', canEditCurrentTab && rec.rawStatus === 'vigente');
          if (canEditCurrentTab && rec.rawStatus === 'vigente') {
            getRef(card, 'disable-btn').addEventListener('click', () => erpStore.setRecipeStatus(rec.id, 'inactiva'));
          }
          return card;
        })
      );
      mountRef(tabBody, 'footer-slot', recipesPager.footer);
    } else if (activeTab === 'ia_demanda') {
      const activeSuppliers = state.suppliers.filter((supplier) => supplier.active);
      const supById = new Map(activeSuppliers.map((s) => [s.id, s]));
      const occupiedCount = state.rooms.filter((r) => r.commercialStatus === 'Ocupada').length;
      const occupancyPct = Math.round((occupiedCount / Math.max(1, state.rooms.length)) * 100);
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.ia_demanda);
      tabBody = view;
      mountRef(tabBody, 'alert-icon', icon('alertTriangle', 'w-4 text-warning'));
      setText(tabBody, 'title', `Recomendaciones de Reposición basadas en Consumo y Ocupación (${occupancyPct}%)`);

      const suggestionsPager = localPager('m3.ia-demanda', lowStockItems, renderContent, 10);
      mountRef(
        tabBody,
        'suggestions-list',
        lowStockItems.length === 0
          ? h('div', { className: 'p-4 text-xs text-slate-500' }, 'Todos los insumos se encuentran sobre su stock mínimo.')
          : suggestionsPager.slice.map((item) => {
              const sugQty = Math.max(8, Math.ceil(item.minStock * 1.2));
              const sugCost = sugQty * item.unitCost;
              const sup = supById.get(item.supplierId) || activeSuppliers[0];
              const row = clone('fila-sugerencia-compra');
              setText(row, 'name', item.name);
              setText(row, 'qty', `${sugQty} ${item.unit}`);
              setText(row, 'cost', ` (${formatCurrency(sugCost)})`);
              setText(
                row,
                'detail',
                `Stock actual (${item.stock} ${item.unit}) por debajo del mínimo (${item.minStock}) con ocupación proyectada ${occupancyPct}%. Proveedor: ${sup?.name || 'Por asignar'}.`
              );
              setVisible(row, 'order-btn', canEditCurrentTab);
              if (canEditCurrentTab) {
                getRef(row, 'order-btn').addEventListener('click', () => {
                  erpStore.createPurchaseOrder({
                    supplierId: sup?.id || activeSuppliers[0]?.id,
                    items: [{
                      inventoryItemId: item.id,
                      itemName: item.name,
                      quantity: sugQty,
                      unitCost: item.unitCost,
                    }],
                  });
                });
              }
              return row;
            })
      );
      mountRef(tabBody, 'footer-slot', suggestionsPager.footer);

      bindPagedContainer({
        container: getRef(tabBody, 'recommendations-list'),
        key: 'm3.ia-recomendaciones',
        list: getPagedList('m3.ia-recomendaciones', {
          path: '/ai/demanda/recomendaciones', map: mapDemandRecommendationRows, pageSize: 10,
        }),
        filters: {
          searchPlaceholder: 'Buscar recomendación…',
          statusOptions: [
            { value: '', label: 'Todos los estados' },
            { value: 'pendiente', label: 'Pendientes' },
            { value: 'aceptada', label: 'Aceptadas' },
            { value: 'descartada', label: 'Descartadas' },
          ],
        },
        renderBody: (rows) => h('div', null, ...rows.map((recommendation) => {
          const row = clone('fila-recomendacion-ia');
          setText(row, 'type', `${recommendation.type} · ${recommendation.estimatedQuantity}`);
          setText(row, 'meta', `${recommendation.period} · ${recommendation.createdAt}`);
          setText(row, 'reason', recommendation.reason);
          mountRef(row, 'status', StatusText({ label: recommendation.status, variant: getStatusVariant(recommendation.status) }));
          const pending = recommendation.rawStatus === 'pendiente' && canEditCurrentTab;
          setVisible(row, 'decision-actions', pending);
          if (pending) {
            getRef(row, 'accept-btn').addEventListener('click', () => openDemandRecommendationDecisionModal(recommendation, 'aceptada'));
            getRef(row, 'discard-btn').addEventListener('click', () => openDemandRecommendationDecisionModal(recommendation, 'descartada'));
          }
          return row;
        })),
        empty: { iconName: 'sparkles', title: 'Sin recomendaciones guardadas', description: 'Los pronósticos generados por IA aparecerán aquí para revisión humana.' },
        noMatch: { iconName: 'search', title: 'Sin recomendaciones coincidentes', description: 'Prueba con otro estado o búsqueda.' },
      });

      mountRef(
        tabBody,
        'advisor-slot',
        ModuleAIAdvisor({
          moduleId: 'm3-pos-almacen',
          moduleName: 'Servicios, POS, Restaurante y Almacén',
          title: 'Asesor IA de Pronóstico de Demanda, Menú y Abastecimiento',
          description: 'Cruza la ocupación proyectada con ventas de restaurante/room service, mermas y vencimientos del inventario.',
          suggestedPrompts: [
            'Proyecta la demanda de alimentos y bebidas para los próximos 3 días según la ocupación actual.',
            'Sugiere promociones para rotar insumos próximos a vencer y reducir mermas.',
            'Evalúa los márgenes de productos POS y propone combos de alto rendimiento para Room Service.',
          ],
          contextData: {
            ocupacionPct: occupancyPct,
            inventarioBajoMinimo: lowStockItems,
            proximosAVencer: expiringItems,
            requisicionesPendientes: pendingReqs,
            recetas: state.recipes,
            ordenesPOS: state.posOrders.slice(0, 6),
          },
        })
      );
    }

    mount(
      headerSlot,
      ModuleHeader({
        moduleNumber: canEditCurrentTab ? 'Servicios, POS y Almacén' : 'Servicios, POS y Almacén · Solo lectura',
        title: activeMeta?.label ?? 'Servicios, POS y Almacén',
        subtitle: activeMeta?.subtitle ?? '',
      })
    );
    mount(bodySlot, tabBody);
  }

  renderContent();
  return root;
}
