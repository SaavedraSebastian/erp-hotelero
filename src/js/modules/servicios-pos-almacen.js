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
import { TODAY } from '../data/seed-data.js';
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
  { id: 'productos', label: 'Catálogo Productos', subtitle: 'Gestión de carta POS, precios de venta, costos unitarios y márgenes.' },
  { id: 'servicios', label: 'Catálogo Servicios', subtitle: 'Servicios complementarios de Spa, Lavandería, Cochera, Traslados y Bar.' },
  { id: 'pos', label: 'Punto de Venta (POS)', subtitle: 'Terminal de ventas conectado al inventario y al Folio del huésped.' },
  { id: 'restaurante', label: 'Restaurante', subtitle: 'Plano de mesas y monitor en tiempo real de comandas y pedidos.' },
  { id: 'room_service', label: 'Room Service', subtitle: 'Registro de pedidos a habitación y seguimiento de entregas.' },
  { id: 'minibar', label: 'Minibar', subtitle: 'Reposición y cargos directos de consumos de minibar.' },
  { id: 'servicios_comp', label: 'Servicios Compl.', subtitle: 'Registro y tarifario de Spa, Lavandería, Cochera y Traslados.' },
  { id: 'inventario', label: 'Inventario', subtitle: 'Stock central de almacén, solicitudes internas, vencimientos y Kardex.' },
  { id: 'proveedores', label: 'Proveedores y Compras', subtitle: 'Órdenes de compra, recepción de mercadería y proveedores homologados.' },
  { id: 'recetas', label: 'Recetario e Insumos', subtitle: 'Estandarización de ingredientes descontados automáticamente al vender en POS.' },
  { id: 'ia_demanda', label: 'IA Demanda y Stock', subtitle: 'Recomendaciones de reposición por ocupación y pronóstico de abastecimiento.' },
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
    const initial = editing
      ? { ...editing }
      : { sku: 'PRD-NEW', name: '', category: 'Restaurante', price: 32, cost: 11, stockControl: 'Receta', available: true };
    openModal({
      title: editing ? `Editar Producto ${editing.sku}` : 'Nuevo Producto en Catálogo',
      renderBody: (close) => {
        const form = cloneModal('modal-producto');
        const skuIn = getRef(form, 'sku');
        const nameIn = getRef(form, 'name');
        const catSel = getRef(form, 'category');
        const priceIn = getRef(form, 'price');
        const costIn = getRef(form, 'cost');
        const ctrlSel = getRef(form, 'stockControl');

        skuIn.value = initial.sku || '';
        nameIn.value = initial.name || '';
        catSel.value = initial.category || 'Restaurante';
        priceIn.value = String(initial.price ?? 0);
        costIn.value = String(initial.cost ?? 0);
        ctrlSel.value = initial.stockControl || 'Receta';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!nameIn.value.trim()) return;
          erpStore.upsertProduct({
            ...initial,
            sku: skuIn.value.trim(),
            name: nameIn.value.trim(),
            category: catSel.value,
            price: Number(priceIn.value),
            cost: Number(costIn.value),
            stockControl: ctrlSel.value,
            available: initial.available !== false,
          });
          close();
        });
        return form;
      },
    });
  }

  function openServiceModal(editing) {
    const initial = editing
      ? { ...editing }
      : { code: `SRV-NEW-${Date.now().toString().slice(-2)}`, name: '', area: 'Spa', cost: 40, durationMinutes: 60, price: 180, active: true, description: '' };
    openModal({
      title: editing ? `Editar Servicio · ${editing.name}` : 'Nuevo Servicio Complementario',
      renderBody: (close) => {
        const form = cloneModal('modal-servicio');
        const nameIn = getRef(form, 'name');
        const areaSel = getRef(form, 'area');
        const durIn = getRef(form, 'duration');
        const priceIn = getRef(form, 'price');

        nameIn.value = initial.name || '';
        areaSel.value = initial.area || 'Spa';
        durIn.value = initial.durationMinutes ? String(initial.durationMinutes) : '';
        priceIn.value = String(initial.price ?? 0);

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!nameIn.value.trim()) return;
          erpStore.upsertService({
            ...initial,
            name: nameIn.value.trim(),
            area: areaSel.value,
            durationMinutes: durIn.value ? Number(durIn.value) : undefined,
            price: Number(priceIn.value),
          });
          close();
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

  function openInventoryCreateModal() {
    openModal({
      title: 'Registrar Nuevo Insumo en Almacén',
      renderBody: (close) => {
        const form = cloneModal('modal-insumo');
        const skuIn = getRef(form, 'sku');
        const nameIn = getRef(form, 'name');
        const catSel = getRef(form, 'category');
        const unitIn = getRef(form, 'unit');
        const stockIn = getRef(form, 'stock');
        const minIn = getRef(form, 'min-stock');
        const costIn = getRef(form, 'unit-cost');
        const locIn = getRef(form, 'location');

        skuIn.value = 'ALM-NEW';
        unitIn.value = 'Unidades';
        stockIn.value = '20';
        minIn.value = '10';
        costIn.value = '15';
        locIn.value = 'Almacén Central';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!nameIn.value.trim()) return;
          erpStore.upsertInventoryItem({
            sku: skuIn.value.trim(),
            name: nameIn.value.trim(),
            category: catSel.value,
            unit: unitIn.value.trim(),
            stock: Number(stockIn.value),
            minStock: Number(minIn.value),
            unitCost: Number(costIn.value),
            location: locIn.value.trim(),
            expiryDate: '2027-06-30',
            batch: 'L-2611',
          });
          close();
        });
        return form;
      },
    });
  }

  function openSupplierModal() {
    openModal({
      title: 'Registrar Nuevo Proveedor',
      renderBody: (close) => {
        const form = cloneModal('modal-proveedor');
        const nameIn = getRef(form, 'name');
        const rucIn = getRef(form, 'ruc');
        const catIn = getRef(form, 'category');
        const contactIn = getRef(form, 'contact');
        const phoneIn = getRef(form, 'phone');
        const leadIn = getRef(form, 'lead-time');

        catIn.value = 'Alimentos Perecibles';
        leadIn.value = '2';

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!nameIn.value.trim()) return;
          erpStore.upsertSupplier({
            name: nameIn.value.trim(),
            ruc: rucIn.value.trim(),
            category: catIn.value.trim(),
            contactName: contactIn.value.trim(),
            phone: phoneIn.value.trim(),
            leadTimeDays: Number(leadIn.value),
            rating: 4.7,
            active: true,
          });
          close();
        });
        return form;
      },
    });
  }

  function openPurchaseOrderModal(prelinkedReq) {
    const state = erpStore.state;
    const defaultItem = prelinkedReq
      ? state.inventory.find((i) => i.id === prelinkedReq.inventoryItemId) || state.inventory[0]
      : state.inventory[0];

    openModal({
      title: 'Nueva Orden de Compra a Proveedor',
      subtitle: prelinkedReq
        ? `Vinculada a Requisición ${prelinkedReq.code}`
        : 'Al recepcionar incrementa stock y genera egreso en Finanzas.',
      renderBody: (close) => {
        const form = cloneModal('modal-orden-compra');
        const supSel = getRef(form, 'supplier');
        const itemSel = getRef(form, 'item');
        const qtyIn = getRef(form, 'qty');
        const costIn = getRef(form, 'unit-cost');

        mount(supSel, state.suppliers.map((sup) => h('option', { value: sup.id }, `${sup.name} (${sup.category})`)));
        mount(
          itemSel,
          state.inventory.map((inv) =>
            h('option', { value: inv.id, selected: defaultItem?.id === inv.id }, `${inv.name} (Stock: ${inv.stock} ${inv.unit})`)
          )
        );
        if (defaultItem) itemSel.value = defaultItem.id;
        qtyIn.value = String(prelinkedReq ? prelinkedReq.quantity : Math.max(10, (defaultItem?.minStock || 10) * 2));
        costIn.value = String(defaultItem?.unitCost || 15);

        itemSel.addEventListener('change', () => {
          const inv = state.inventory.find((i) => i.id === itemSel.value);
          if (inv) costIn.value = String(inv.unitCost);
        });

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const item = state.inventory.find((i) => i.id === itemSel.value);
          if (!item) return;
          erpStore.createPurchaseOrder({
            supplierId: supSel.value,
            linkedRequisitionId: prelinkedReq?.id,
            items: [{
              inventoryItemId: item.id,
              itemName: item.name,
              quantity: Number(qtyIn.value),
              unitCost: Number(costIn.value),
            }],
          });
          close();
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
        mount(ing2Sel, state.inventory.map((i) => h('option', { value: i.id }, `${i.name} (${i.unit})`)));

        saleIn.value = String(state.products[0]?.price || 48);
        if (state.inventory[0]) ing1Sel.value = state.inventory[0].id;
        ing1Qty.value = '0.25';
        if (state.inventory[1]) ing2Sel.value = state.inventory[1].id;
        ing2Qty.value = '0.15';

        prodSel.addEventListener('change', () => {
          const p = state.products.find((x) => x.id === prodSel.value);
          if (p) saleIn.value = String(p.price);
        });

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const prod = state.products.find((p) => p.id === prodSel.value);
          const i1 = state.inventory.find((i) => i.id === ing1Sel.value);
          const i2 = state.inventory.find((i) => i.id === ing2Sel.value);
          if (!prod || !i1) return;
          const ingredients = [{ inventoryItemId: i1.id, itemName: i1.name, quantity: Number(ing1Qty.value), unit: i1.unit, unitCost: i1.unitCost }];
          if (i2 && i2.id !== i1.id && Number(ing2Qty.value) > 0) {
            ingredients.push({ inventoryItemId: i2.id, itemName: i2.name, quantity: Number(ing2Qty.value), unit: i2.unit, unitCost: i2.unitCost });
          }
          const recipeCost = Number(ingredients.reduce((s, x) => s + x.quantity * x.unitCost, 0).toFixed(2));
          const sp = Number(saleIn.value);
          const marginPct = sp > 0 ? Math.round(((sp - recipeCost) / sp) * 100) : 0;
          erpStore.upsertRecipe({ productId: prod.id, productName: prod.name, salePrice: sp, recipeCost, marginPct, ingredients });
          close();
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
    const state = erpStore.state;
    const currentUser = erpStore.currentUser;
    if (!state || !currentUser) return;

    const route = getRoute();
    const visibleTabs = M3_TABS.filter((t) => erpStore.canViewTab('m3', t.id));
    const defaultTab = erpStore.getDefaultTab('m3') || visibleTabs[0]?.id || 'productos';
    const requestedTab = route.tab || defaultTab;
    const activeTab = visibleTabs.some((t) => t.id === requestedTab) ? requestedTab : defaultTab;
    const isTabDenied = Boolean(route.tab && !erpStore.canViewTab('m3', route.tab));
    const canEditCurrentTab = erpStore.canEditTab('m3', activeTab);

    const openFolios = state.folios.filter((f) => f.status === 'Abierto');
    if (!m3Ui.posFolioId && openFolios.length > 0) m3Ui.posFolioId = openFolios[0].id;
    const occupiedRooms = state.rooms.filter((r) => r.commercialStatus === 'Ocupada');

    const lowStockItems = state.inventory.filter((i) => i.stock <= i.minStock);
    const expiringItems = state.inventory.filter((i) => isExpiringSoon(i.expiryDate));
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
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', () => openProductModal(null));
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
        mountRef(
          tabBody,
          'tbody',
          filtered.map((p) => {
            const margin = p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : 0;
            const row = clone('fila-producto');
            setText(row, 'code', p.sku);
            setText(row, 'name', p.name);
            setText(row, 'category', p.category);
            setText(row, 'stock', p.stockControl || 'Receta');
            setText(row, 'cost', formatCurrency(p.cost));
            setText(row, 'price', formatCurrency(p.price));
            setText(row, 'margin', `${margin}%`);
            if (canEditCurrentTab) {
              row.style.cursor = 'pointer';
              row.addEventListener('click', () => openProductModal(p));
            }
            return row;
          })
        );
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
            renderRows();
          },
        })
      );
      catFilter.addEventListener('change', (e) => {
        m3Ui.prodCategory = e.target.value;
        renderRows();
      });
      renderRows();
    } else if (activeTab === 'servicios') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.servicios);
      tabBody = view;
      setVisible(tabBody, 'new-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('plus', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', () => openServiceModal(null));
      }
      mountRef(
        tabBody,
        'grid',
        state.services.map((srv) => {
          const card = clone('card-servicio');
          setText(card, 'code-area', `${srv.code} · ${srv.area}`);
          setText(card, 'price', formatCurrency(srv.price));
          setText(card, 'name', srv.name);
          setText(card, 'desc', srv.description || '');
          setText(
            card,
            'meta',
            `Costo operativo: ${formatCurrency(srv.cost ?? 0)}${srv.durationMinutes ? ` · ${srv.durationMinutes} min` : ''}`
          );
          if (canEditCurrentTab) {
            card.style.cursor = 'pointer';
            card.addEventListener('click', () => openServiceModal(srv));
          }
          return card;
        })
      );
    } else if (activeTab === 'pos') {
      const invById = new Map(state.inventory.map((i) => [i.id, i]));
      const cartTotal = m3Ui.cart.reduce((s, c) => s + c.quantity * c.unitPrice, 0);
      const selectedFolio = openFolios.find((f) => f.id === m3Ui.posFolioId);
      const filteredProducts = state.products.filter(
        (p) => p.available !== false && (m3Ui.posCategory === 'Todos' || p.category === m3Ui.posCategory)
      );

      const { root: view, clone } = loadViewTemplate(VIEW_HTML.pos);
      tabBody = view;
      mountRef(tabBody, 'cart-icon', icon('shoppingCart', 'w-4 text-teal'));

      const catGroup = getRef(tabBody, 'categories');
      catGroup.querySelectorAll('button[data-cat]').forEach((btn) => {
        const cat = btn.dataset.cat;
        btn.classList.toggle('is-active', m3Ui.posCategory === cat);
        btn.addEventListener('click', () => {
          m3Ui.posCategory = cat;
          renderContent();
        });
      });

      mountRef(
        tabBody,
        'products-grid',
        filteredProducts.map((p) => {
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

      const showTable = m3Ui.posPaymentMode === 'Pago Directo' && (m3Ui.posOrigin === 'Restaurante' || m3Ui.posOrigin === 'Bar');
      setVisible(tabBody, 'table-wrap', showTable);
      const tableSel = getRef(tabBody, 'table-select');
      mount(
        tableSel,
        state.tables.map((t) => h('option', { value: t.number, selected: m3Ui.posTable === t.number }, `${t.number} · ${t.zone} (${t.status})`))
      );
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
        submitBtn.addEventListener('click', () => {
          const targetRoom = selectedFolio ? state.rooms.find((r) => r.number === selectedFolio.roomNumber) : null;
          const res = erpStore.createPOSOrder({
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
    } else if (activeTab === 'restaurante') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.restaurante);
      tabBody = view;
      mountRef(tabBody, 'monitor-icon', icon('chefHat', 'w-4 text-teal'));

      mountRef(
        tabBody,
        'tables-grid',
        state.tables.map((tb) => {
          const card = clone('card-mesa');
          setText(card, 'title', `Mesa ${tb.number}`);
          setText(card, 'meta', `${tb.zone} · ${tb.seats} personas`);
          mountRef(card, 'status', StatusText({ label: tb.status, variant: getStatusVariant(tb.status) }));
          if (tb.roomNumber) {
            setText(card, 'room-label', `Huésped Hab. ${tb.roomNumber}`);
            setVisible(card, 'room-label', true);
          }
          setVisible(card, 'status-select', canEditCurrentTab);
          if (canEditCurrentTab) {
            const sel = getRef(card, 'status-select');
            sel.value = tb.status;
            sel.addEventListener('change', (e) => erpStore.updateTableStatus(tb.id, e.target.value));
          }
          return card;
        })
      );

      mountRef(
        tabBody,
        'orders-list',
        state.posOrders.map((ord) => {
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
          const showAction = canEditCurrentTab && ord.status !== 'Entregado' && ord.status !== 'Cobrado';
          setVisible(row, 'action-btn', showAction);
          if (showAction) {
            const btn = getRef(row, 'action-btn');
            btn.textContent = ord.status === 'Preparando' ? 'En camino' : 'Entregar';
            btn.addEventListener('click', () =>
              erpStore.updatePOSOrderStatus(ord.id, ord.status === 'Preparando' ? 'En camino' : 'Entregado')
            );
          }
          return row;
        })
      );
    } else if (activeTab === 'room_service') {
      const orders = state.posOrders.filter((o) => o.source === 'Room Service');
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

      mountRef(
        tabBody,
        'orders-list',
        orders.length === 0
          ? h('div', { className: 'p-4' }, EmptyState({
              iconName: 'utensils',
              title: 'Sin pedidos recientes de Room Service',
              description: 'Registra un pedido desde el formulario izquierdo para cargarlo a la habitación.',
            }))
          : orders.map((ord) => {
              const row = clone('fila-pedido-rs');
              setText(row, 'title', `${ord.code} · Hab. ${ord.roomNumber || '—'} (${ord.guestName || '—'})`);
              setText(row, 'items', `${ord.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')} · ${formatCurrency(ord.total)}`);
              mountRef(row, 'status', StatusText({ label: ord.status, variant: getStatusVariant(ord.status) }));
              const showDeliver = canEditCurrentTab && ord.status !== 'Entregado' && ord.status !== 'Cobrado';
              setVisible(row, 'deliver-btn', showDeliver);
              if (showDeliver) {
                getRef(row, 'deliver-btn').addEventListener('click', () => erpStore.updatePOSOrderStatus(ord.id, 'Entregado'));
              }
              return row;
            })
      );
    } else if (activeTab === 'minibar') {
      const orders = state.posOrders.filter((o) => o.source === 'Minibar');
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

      mountRef(
        tabBody,
        'orders-list',
        orders.length === 0
          ? h('div', { className: 'p-4' }, EmptyState({
              iconName: 'utensils',
              title: 'Sin consumos de Minibar registrados',
              description: 'Registra consumos desde el panel izquierdo.',
            }))
          : orders.map((ord) => {
              const row = clone('fila-pedido-minibar');
              setText(row, 'title', `${ord.code} · Hab. ${ord.roomNumber || '—'}`);
              setText(row, 'items', ord.items.map((i) => `${i.quantity}x ${i.name}`).join(', '));
              setText(row, 'total', formatCurrency(ord.total));
              return row;
            })
      );
    } else if (activeTab === 'servicios_comp') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.servicios_comp);
      tabBody = view;

      const form = getRef(tabBody, 'srv-form');
      const srvSel = getRef(tabBody, 'service-select');
      const paySel = getRef(tabBody, 'payment-mode');
      const roomSel = getRef(tabBody, 'room-select');
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
      paySel.addEventListener('change', () => {
        setVisible(tabBody, 'room-wrap', paySel.value === 'Cargo a Habitación');
      });

      setVisible(tabBody, 'submit-btn', canEditCurrentTab && activeServices.length > 0);
      if (canEditCurrentTab) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const srv = activeServices.find((s) => s.id === srvSel.value);
          if (!srv) return;
          erpStore.createPOSOrder({
            source: 'Servicios Complementarios',
            roomId: paySel.value === 'Cargo a Habitación' ? roomSel.value : undefined,
            paymentMode: paySel.value === 'Pago Directo' ? 'Pago Directo' : 'Cargo a Habitación',
            items: [{ id: srv.id, name: srv.name, quantity: 1, unitPrice: srv.price }],
          });
        });
      }

      mountRef(
        tabBody,
        'services-list',
        activeServices.map((srv) => {
          const row = clone('fila-tarifa-servicio');
          setText(row, 'name', srv.name);
          setText(row, 'area', srv.area);
          setText(row, 'desc', srv.description || '');
          setText(row, 'price', formatCurrency(srv.price));
          return row;
        })
      );
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

      mountRef(
        tabBody,
        'req-list',
        state.supplyRequisitions.map((req) => {
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

      setVisible(tabBody, 'actions-th', canEditCurrentTab);

      const renderInvRows = () => {
        const q = m3Ui.search.trim().toLowerCase();
        const filtered = state.inventory.filter((i) => !q || i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q));
        mountRef(
          tabBody,
          'inv-tbody',
          filtered.map((item) => {
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
            mountRef(row, 'status', StatusText({ label: low ? 'Reponer' : 'Óptimo', variant: low ? 'danger' : 'success' }));
            setVisible(row, 'action-cell', canEditCurrentTab);
            if (canEditCurrentTab) {
              mountRef(row, 'adjust-icon', icon('arrowDownUp', 'w-3'));
              getRef(row, 'adjust-btn').addEventListener('click', () => openInventoryMoveModal(item));
            }
            return row;
          })
        );
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
            renderInvRows();
          },
        })
      );
      setVisible(tabBody, 'new-item-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-item-icon', icon('packagePlus', 'w-3.5'));
        getRef(tabBody, 'new-item-btn').addEventListener('click', openInventoryCreateModal);
      }
      renderInvRows();

      mountRef(
        tabBody,
        'kardex-list',
        state.inventoryMovements.slice(0, 6).map((mv) => {
          const row = clone('fila-kardex');
          setText(row, 'title', `${mv.type} · ${mv.itemName}`);
          setText(row, 'ref', `(${mv.reference})`);
          const qtyEl = getRef(row, 'qty');
          const numQty = Number(mv.quantity || 0);
          qtyEl.textContent = numQty > 0 ? `+${numQty}` : String(numQty);
          qtyEl.classList.add(numQty < 0 ? 'text-danger' : 'text-teal');
          setText(row, 'date', mv.date);
          return row;
        })
      );
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

      mountRef(
        tabBody,
        'po-tbody',
        state.purchaseOrders.map((po) => {
          const row = clone('fila-orden-compra');
          setText(row, 'code', po.code);
          setText(row, 'date', po.createdAt);
          setText(row, 'supplier', po.supplierName);
          setText(row, 'items', po.items.map((i) => `${i.quantity} ${i.itemName}`).join(', '));
          setText(row, 'total', formatCurrency(po.total));
          mountRef(row, 'status', StatusText({ label: po.status, variant: getStatusVariant(po.status) }));
          const showReceive = canEditCurrentTab && po.status !== 'Recibida';
          setVisible(row, 'receive-btn', showReceive);
          if (showReceive) {
            mountRef(row, 'receive-icon', icon('packageCheck', 'w-3'));
            getRef(row, 'receive-btn').addEventListener('click', () => erpStore.receivePurchaseOrder(po.id));
          } else if (po.receivedAt || po.status === 'Recibida') {
            setText(row, 'received-at', po.receivedAt || po.createdAt);
            setVisible(row, 'received-at', true);
          }
          return row;
        })
      );

      mountRef(
        tabBody,
        'sup-grid',
        state.suppliers.map((sup) => {
          const card = clone('card-proveedor');
          setText(card, 'name', sup.name);
          setText(card, 'rating', `★ ${sup.rating ?? 4.7}`);
          setText(card, 'ruc-cat', `RUC ${sup.ruc} · ${sup.category}`);
          setText(card, 'contact', `Contacto: ${sup.contactName} · ${sup.phone} · Entrega: ${sup.leadTimeDays} día(s)`);
          return card;
        })
      );
    } else if (activeTab === 'recetas') {
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.recetas);
      tabBody = view;
      setVisible(tabBody, 'new-btn', canEditCurrentTab);
      if (canEditCurrentTab) {
        mountRef(tabBody, 'new-icon', icon('chefHat', 'w-3.5'));
        getRef(tabBody, 'new-btn').addEventListener('click', openRecipeModal);
      }

      mountRef(
        tabBody,
        'recipes-grid',
        state.recipes.map((rec) => {
          const card = clone('card-receta');
          setText(card, 'name', rec.productName);
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
          return card;
        })
      );
    } else if (activeTab === 'ia_demanda') {
      const supById = new Map(state.suppliers.map((s) => [s.id, s]));
      const occupiedCount = state.rooms.filter((r) => r.commercialStatus === 'Ocupada').length;
      const occupancyPct = Math.round((occupiedCount / Math.max(1, state.rooms.length)) * 100);
      const { root: view, clone } = loadViewTemplate(VIEW_HTML.ia_demanda);
      tabBody = view;
      mountRef(tabBody, 'alert-icon', icon('alertTriangle', 'w-4 text-warning'));
      setText(tabBody, 'title', `Recomendaciones de Reposición basadas en Consumo y Ocupación (${occupancyPct}%)`);

      mountRef(
        tabBody,
        'suggestions-list',
        lowStockItems.length === 0
          ? h('div', { className: 'p-4 text-xs text-slate-500' }, 'Todos los insumos se encuentran sobre su stock mínimo.')
          : lowStockItems.map((item) => {
              const sugQty = Math.max(8, Math.ceil(item.minStock * 1.2));
              const sugCost = sugQty * item.unitCost;
              const sup = supById.get(item.supplierId) || state.suppliers[0];
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
                    supplierId: sup?.id || state.suppliers[0]?.id,
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

    const activeMeta = M3_TABS.find((t) => t.id === activeTab) || M3_TABS[0];
    mount(
      headerSlot,
      ModuleHeader({
        moduleNumber: 'INGRESOS COMPLEMENTARIOS Y ABASTECIMIENTO',
        title: `Servicios, POS, Restaurante y Almacén · ${activeMeta.label}`,
        subtitle: activeMeta.subtitle,
      })
    );
    mount(bodySlot, tabBody);
  }

  renderContent();
  return root;
}
