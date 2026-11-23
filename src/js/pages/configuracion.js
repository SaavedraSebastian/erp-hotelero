import {
  getRef,
  h,
  loadViewTemplate,
  mount,
  mountRef,
  parseHtmlTemplate,
  setText,
  setVisible,
} from '../utils/dom.js';
import { getRoute, navigateToView } from '../core/router.js';
import { erpStore } from '../core/store.js';
import { ALL_ROLE_IDS, ROLE_LABELS } from '../data/rbac.js';
import { v1Api } from '../services/api-client.js';
import { ModuleHeader, StatusText, openModal } from '../components/ui-components.js';
import moduloBaseHtml from '../../html/modules/modulo-base.html?raw';
import rbacHtml from '../../html/pages/configuracion/rbac.html?raw';
import usuariosHtml from '../../html/pages/configuracion/usuarios.html?raw';
import auditoriaHtml from '../../html/pages/configuracion/auditoria.html?raw';

const VIEW_HTML = {
  rbac: rbacHtml,
  usuarios: usuariosHtml,
  auditoria: auditoriaHtml,
};

const VIEW_META = {
  rbac: { title: 'Permisos por Rol', subtitle: 'Control de acceso por módulo, sección y visibilidad de datos.' },
  usuarios: { title: 'Directorio de Usuarios', subtitle: 'Cuentas con acceso al sistema y su rol asignado.' },
  auditoria: { title: 'Auditoría', subtitle: 'Registro de actividad del sistema por módulo.' },
};

const cfgUi = {
  savingRole: null,
  v1Bitacoras: null,
  v1BitacorasLoadedFor: null,
};

const MODULE_META = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'm1', label: 'Reservas' },
  { id: 'm2', label: 'Housekeeping' },
  { id: 'm3', label: 'POS / Almacén' },
  { id: 'm4', label: 'Finanzas' },
  { id: 'm5', label: 'CRM' },
  { id: 'config', label: 'Configuración' },
];

const AUDIT_MODULE_LABELS = {
  dashboard: 'Dashboard',
  m1: 'Reservas',
  m2: 'Housekeeping',
  m3: 'POS y Almacén',
  m4: 'Finanzas',
  m5: 'CRM',
  config: 'Configuración',
};

export function renderConfigPage() {
  const root = parseHtmlTemplate(moduloBaseHtml);
  const headerSlot = getRef(root, 'header-slot');
  const bodySlot = getRef(root, 'body-slot');

  function renderContent() {
    const state = erpStore.state;
    const currentUser = erpStore.currentUser;
    const allRolePermissions = erpStore.allRolePermissions;
    const directoryUsers = erpStore.directoryUsers;
    if (!state || !currentUser) return;

    const route = getRoute();
    const visibleIds = ['rbac', 'usuarios', 'auditoria'].filter((id) =>
      erpStore.canViewTab('config', id)
    );
    const defaultTab = erpStore.getDefaultTab('config') || visibleIds[0] || 'rbac';
    const activeTab = visibleIds.includes(route.tab) ? route.tab : defaultTab;
    const canEditRbac = erpStore.canEdit('config') && erpStore.canEditTab('config', 'rbac');

    const toggleModulePerm = async (role, mod, type) => {
      if (!canEditRbac) return;
      const current = allRolePermissions[role];
      if (!current) return;
      const list = [...current[type]];
      const has = list.includes(mod);
      let nextView = [...current.view];
      let nextEdit = [...current.edit];

      if (type === 'view') {
        nextView = has ? nextView.filter((m) => m !== mod) : [...nextView, mod];
        if (has) nextEdit = nextEdit.filter((m) => m !== mod);
      } else {
        nextEdit = has ? nextEdit.filter((m) => m !== mod) : [...nextEdit, mod];
        if (!has && !nextView.includes(mod)) nextView.push(mod);
      }

      cfgUi.savingRole = role;
      renderContent();
      await erpStore.updateRolePermissions(role, { ...current, view: nextView, edit: nextEdit });
      cfgUi.savingRole = null;
      renderContent();
    };

    const togglePii = async (role) => {
      if (!canEditRbac) return;
      const current = allRolePermissions[role];
      if (!current) return;
      cfgUi.savingRole = role;
      renderContent();
      await erpStore.updateRolePermissions(role, { ...current, canViewFullPII: !current.canViewFullPII });
      cfgUi.savingRole = null;
      renderContent();
    };

    let tabNode = null;
    let clone = null;

    {
      const loaded = loadViewTemplate(VIEW_HTML[activeTab] || rbacHtml);
      tabNode = loaded.root;
      clone = loaded.clone;
    }

    if (activeTab === 'rbac') {
      const canManageSites = currentUser.role === 'admin' || canEditRbac;
      const refreshSites = async () => {
        const response = await v1Api.getSedes();
        erpStore.setSites(response?.data ?? [], response?.sedeActiva);
      };
      const openSiteModal = (editingSite = null) => openModal({
        title: editingSite ? `Editar ${editingSite.nombre}` : 'Registrar nueva sede',
        subtitle: editingSite ? 'Los cambios se reflejan al seleccionar esta sede.' : 'La nueva sede inicia sin datos operativos y con inventario independiente.',
        renderBody: (close) => {
          const code = h('input', { className: 'input-control font-mono', required: true, maxlength: 20, placeholder: 'CUSCO' });
          const name = h('input', { className: 'input-control', required: true, placeholder: 'Hotel Boulevard - Sede Cusco' });
          const commercial = h('input', { className: 'input-control', required: true, value: 'Hotel Boulevard' });
          const address = h('input', { className: 'input-control', placeholder: 'Dirección de la sede' });
          if (editingSite) {
            code.value = editingSite.codigo;
            code.disabled = true;
            name.value = editingSite.nombre;
            commercial.value = editingSite.nombreComercial || 'Hotel Boulevard';
          }
          const cancel = h('button', { type: 'button', className: 'btn btn-outline-muted' }, 'Cancelar');
          const submit = h('button', { type: 'submit', className: 'btn btn-primary' }, editingSite ? 'Guardar cambios' : 'Crear sede');
          const field = (label, input) => h('div', null, h('label', { className: 'field-label' }, label), input);
          const form = h('form', { className: 'stack-md' },
            h('div', { className: 'grid-2' }, field('Código', code), field('Nombre de sede', name), field('Nombre comercial', commercial), field('Dirección', address)),
            h('div', { className: 'row-wrap justify-end' }, cancel, submit)
          );
          cancel.addEventListener('click', close);
          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            submit.disabled = true;
            try {
              const payload = {
                codigo: code.value.trim(), nombre: name.value.trim(), nombreComercial: commercial.value.trim(),
                direccion: address.value.trim() || null, zonaHoraria: 'America/Lima', moneda: 'PEN',
              };
              if (editingSite) await v1Api.updateSede(editingSite.id, payload);
              else await v1Api.createSede(payload);
              await refreshSites();
              close();
            } catch (error) {
              submit.disabled = false;
              erpStore.pushToast({ title: 'No se pudo crear la sede', detail: error.message, type: 'error' });
            }
          });
          return form;
        },
      });
      const openSiteUsersModal = async (site) => {
        try {
          const response = await v1Api.getSedeUsers(site.id);
          const assigned = new Map((response?.data ?? []).map((row) => [String(row.id_usuario), row]));
          openModal({
            title: `Usuarios de ${site.nombre}`,
            subtitle: 'Define quién puede consultar y operar esta sede.',
            renderBody: (close) => {
              const controls = directoryUsers.map((user) => {
                const current = assigned.get(String(user.id));
                const access = h('input', { type: 'checkbox', checked: current?.estado === 'activo' });
                const preferred = h('input', { type: 'checkbox', checked: Boolean(current?.es_predeterminada) });
                const isCurrentOperator = String(user.id) === String(currentUser.erpId)
                  && site.id === currentUser.activeSiteId;
                access.disabled = isCurrentOperator;
                const row = h('div', { className: 'row-between card card-pad' },
                  h('div', null,
                    h('div', { className: 'text-xs font-semibold text-navy' }, user.name),
                    h('div', { className: 'text-11 text-slate-500' }, isCurrentOperator ? `${user.roleLabel} · sesión actual` : user.roleLabel)
                  ),
                  h('div', { className: 'row-wrap text-xs' }, h('label', { className: 'row-wrap' }, access, ' Acceso'), h('label', { className: 'row-wrap' }, preferred, ' Predeterminada'))
                );
                preferred.addEventListener('change', () => { if (preferred.checked) access.checked = true; });
                return { user, access, preferred, row };
              });
              const cancel = h('button', { type: 'button', className: 'btn btn-outline-muted' }, 'Cancelar');
              const save = h('button', { type: 'submit', className: 'btn btn-primary' }, 'Guardar asignaciones');
              const form = h('form', { className: 'stack-md' }, ...controls.map((c) => c.row), h('div', { className: 'row-wrap justify-end' }, cancel, save));
              cancel.addEventListener('click', close);
              form.addEventListener('submit', async (event) => {
                event.preventDefault();
                save.disabled = true;
                try {
                  const changed = controls.filter((control) => {
                    const previous = assigned.get(String(control.user.id));
                    const wasActive = previous?.estado === 'activo';
                    const wasPreferred = Boolean(previous?.es_predeterminada);
                    return wasActive !== control.access.checked
                      || wasPreferred !== (control.access.checked && control.preferred.checked);
                  });
                  for (const control of changed) {
                    await v1Api.assignUserToSede(site.id, control.user.id, {
                      activo: control.access.checked,
                      predeterminada: control.access.checked && control.preferred.checked,
                    });
                  }
                  await refreshSites();
                  close();
                } catch (error) {
                  save.disabled = false;
                  erpStore.pushToast({ title: 'No se guardaron las asignaciones', detail: error.message, type: 'error' });
                }
              });
              return form;
            },
          });
        } catch (error) {
          erpStore.pushToast({ title: 'No se pudieron leer las asignaciones', detail: error.message, type: 'error' });
        }
      };

      setVisible(tabNode, 'new-site-btn', canManageSites);
      if (canManageSites) getRef(tabNode, 'new-site-btn').addEventListener('click', openSiteModal);
      mountRef(tabNode, 'sites-grid', (currentUser.sites ?? []).map((site) => {
        const card = clone('card-sede');
        setText(card, 'name', site.nombre);
        setText(card, 'code', site.codigo);
        mountRef(card, 'status', StatusText({ label: site.id === currentUser.activeSiteId ? 'Sede activa' : 'Disponible', variant: site.id === currentUser.activeSiteId ? 'success' : 'info' }));
        setVisible(card, 'edit-btn', canManageSites);
        setVisible(card, 'users-btn', canManageSites);
        if (canManageSites) {
          getRef(card, 'edit-btn').addEventListener('click', () => openSiteModal(site));
          getRef(card, 'users-btn').addEventListener('click', () => openSiteUsersModal(site));
        }
        return card;
      }));

      if (!canEditRbac) {
        mountRef(tabNode, 'readonly-badge', StatusText({ label: 'Solo lectura (Auditor)', variant: 'info' }));
      }
      const headRow = getRef(tabNode, 'head-row');
      if (headRow) {
        for (const m of MODULE_META) headRow.appendChild(h('th', { className: 'text-center' }, m.label));
        headRow.appendChild(h('th', { className: 'text-center' }, 'PII Completo'));
      }
      mountRef(
        tabNode,
        'tbody',
        ALL_ROLE_IDS.map((roleId) => {
          const perms = allRolePermissions[roleId];
          const isSaving = cfgUi.savingRole === roleId;
          const tr = clone('fila-rbac');
          setText(tr, 'role-name', ROLE_LABELS[roleId]);

          for (const m of MODULE_META) {
            const v = perms?.view.includes(m.id);
            const e = perms?.edit.includes(m.id);
            const cell = clone('celda-rbac-permiso');
            const viewBtn = getRef(cell, 'view-btn');
            const editBtn = getRef(cell, 'edit-btn');
            if (viewBtn) {
              viewBtn.disabled = !canEditRbac || isSaving;
              if (v) viewBtn.classList.add('is-view-on');
              viewBtn.addEventListener('click', () => toggleModulePerm(roleId, m.id, 'view'));
            }
            if (editBtn) {
              editBtn.disabled = !canEditRbac || isSaving;
              if (e) editBtn.classList.add('is-edit-on');
              editBtn.addEventListener('click', () => toggleModulePerm(roleId, m.id, 'edit'));
            }
            tr.appendChild(cell);
          }

          tr.appendChild(
            h(
              'td',
              { className: 'text-center' },
              h(
                'button',
                {
                  type: 'button',
                  disabled: !canEditRbac || isSaving,
                  className: 'btn btn-outline btn-xs font-mono',
                  onClick: () => togglePii(roleId),
                },
                perms?.canViewFullPII ? 'Sí' : 'Enmasc.'
              )
            )
          );
          return tr;
        })
      );
    } else if (activeTab === 'usuarios') {
      mountRef(
        tabNode,
        'tbody',
        directoryUsers.map((u) => {
          const tr = clone('fila-usuario');
          setText(tr, 'name', u.name);
          setText(tr, 'email', u.email);
          setText(tr, 'role', u.roleLabel);
          setText(tr, 'staff-id', u.assignedStaffId || u.department || 'N/A');
          const isActive = u.active !== false;
          mountRef(tr, 'status', StatusText({ label: isActive ? 'Activo' : 'Inactivo', variant: isActive ? 'success' : 'danger' }));
          return tr;
        })
      );
    } else if (activeTab === 'auditoria') {
      if (currentUser.authMode === 'supabase' && cfgUi.v1BitacorasLoadedFor !== currentUser.id) {
        cfgUi.v1BitacorasLoadedFor = currentUser.id;
        v1Api.getBitacoras('ALL', 1, 60)
          .then((res) => {
            if (Array.isArray(res?.data)) {
              cfgUi.v1Bitacoras = res.data;
              renderContent();
            }
          })
          .catch(() => {
            cfgUi.v1Bitacoras = null;
          });
      }

      const entries =
        Array.isArray(cfgUi.v1Bitacoras) && cfgUi.v1Bitacoras.length > 0
          ? cfgUi.v1Bitacoras.map((item) => ({
              timestamp: item.fechaHora,
              user: item.usuario,
              role: item.fuente,
              module: item.modulo.toLowerCase(),
              action: item.accion,
              privacyImpact: item.impactoPrivacidad,
              entityRef: item.entidadRef,
            }))
          : state.auditLog.slice(0, 60);

      mountRef(
        tabNode,
        'tbody',
        entries.map((entry) => {
          const tr = clone('fila-auditoria');
          setText(tr, 'timestamp', entry.timestamp);
          setText(tr, 'user', entry.user);
          setText(tr, 'role', entry.role);
          setText(tr, 'module', AUDIT_MODULE_LABELS[entry.module] || entry.module);
          setText(tr, 'action', entry.action);
          if (entry.privacyImpact) setVisible(tr, 'pii-flag', true);
          setText(tr, 'ref', entry.entityRef || '—');
          return tr;
        })
      );
    }

    const meta = VIEW_META[activeTab] || VIEW_META.rbac;
    mount(
      headerSlot,
      ModuleHeader({
        moduleNumber: 'Configuración',
        title: meta.title,
        subtitle: meta.subtitle,
      })
    );
    mount(bodySlot, tabNode);
  }

  renderContent();
  return root;
}
