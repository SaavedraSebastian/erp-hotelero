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
import { ModuleHeader, StatusText } from '../components/ui-components.js';
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
