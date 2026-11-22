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
import { getPagedList, setActivePagedList } from '../services/paged-list.js';
import { mapComandaRows, mapConsumoRows, mapPurchaseOrderRows } from '../services/erp-mappers.js';
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

  function openServiceModal(editing) {
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

  function openSupplierModal() {
    openModal({
      title: 'Registrar Nuevo Proveedor',
      renderBody: (close) => {
        const form = cloneModal('modal-proveedor');
        const nameIn = getRef(form, 'name');
        const rucIn = getRef(form, 'ruc');
        const phoneIn = getRef(form, 'phone');
        const emailIn = getRef(form, 'email');

        getRef(form, 'cancel-btn')?.addEventListener('click', close);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!nameIn.value.trim()) return;
          const res = await erpStore.upsertSupplier({
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
            `${srv.pointOfSale || srv.area || ''}${srv.durationMinutes ? ` · ${srv.durationMinutes} min` : ''}`
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

      const showTable = m3Ui.posOrigin === 'Restaurante' || m3Ui.posOrigin === 'Bar';
      setVisible(tabBody, 'table-wrap', showTable);
      const tableSel = getRef(tabBody, 'table-select');
      mount(
        tableSel,
        state.tables.map((t) => h('option', { value: t.number, selected: m3Ui.posTable === t.number }, `${t.number} · ${t.zone} (${t.status})`))
      );
      if (!state.tables.some((t) => t.number === m3Ui.posTable)) m3Ui.posTable = state.tables[0]?.number || '';
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
        list: getPagedList('m3.comandas', { path: '/m3/comandas', map: mapComandaRows, pageSize: 20 }),
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
        list: getPagedList('m3.roomservice', { path: '/m3/comandas?modalidad=' + encodeURIComponent('habitación'), map: mapComandaRows, pageSize: 20 }),
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
        list: getPagedList('m3.minibar', { path: '/m3/consumos?puntoVenta=PV-MINI', map: mapConsumoRows, pageSize: 20 }),
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
          const showReceive = canEditCurrentTab && ['Aprobada', 'Enviada', 'Parcialmente recibida'].includes(po.status);
          setVisible(row, 'receive-btn', showReceive);
          if (showReceive) {
            mountRef(row, 'receive-icon', icon('packageCheck', 'w-3'));
            getRef(row, 'receive-btn').addEventListener('click', () => erpStore.receivePurchaseOrder(po.id));
          } else if (po.receivedAt || po.status === 'Recibida') {
            setText(row, 'received-at', po.receivedAt || po.createdAt);
            setVisible(row, 'received-at', true);
          }
          return row;
        })());
        }
        return frag;
      };
      bindPagedContainer({
        container: getRef(tabBody, 'po-tbody'),
        key: 'm3.oc',
        list: getPagedList('m3.oc', { path: '/m3/ordenes-compra', map: mapPurchaseOrderRows, pageSize: 20 }),
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

      mountRef(
        tabBody,
        'sup-grid',
        state.suppliers.map((sup) => {
          const card = clone('card-proveedor');
          setText(card, 'name', sup.name);
          setText(card, 'rating', sup.rating == null ? 'Sin calificación' : `★ ${sup.rating}`);
          setText(card, 'ruc-cat', `RUC ${sup.ruc || '—'} · ${sup.category || '—'}`);
          setText(card, 'contact', `Contacto: ${sup.contactName || '—'} · ${sup.phone || '—'} · Entrega: ${sup.leadTimeDays > 0 ? `${sup.leadTimeDays} día(s)` : '—'}`);
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
