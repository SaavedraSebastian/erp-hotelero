import {
  createTemplateLibrary,
  getRef,
  h,
  icon,
  mount,
  mountRef,
  parseHtmlTemplate,
  setText,
  setVisible,
} from '../utils/dom.js';
import { requestModuleAIAnalysis } from '../services/ai-client.js';
import uiComponentsHtml from '../../html/components/ui-components.html?raw';
import modalHtml from '../../html/components/modal.html?raw';
import aiAdvisorHtml from '../../html/components/asesor-ia.html?raw';

const cloneUi = createTemplateLibrary(uiComponentsHtml);

export function StatTile({ label, value, meta, tone = 'default', onClick }) {
  const el = cloneUi(onClick ? 'stat-tile-btn' : 'stat-tile');
  setText(el, 'label', label);
  const valueEl = setText(el, 'value', String(value ?? ''));
  if (valueEl && tone && tone !== 'default') {
    valueEl.classList.add(`tone-${tone}`);
  }
  if (meta) {
    setText(el, 'meta', meta);
    setVisible(el, 'meta', true);
  }
  if (onClick) {
    el.addEventListener('click', onClick);
  }
  return el;
}

export function StatusText({ label, variant = 'neutral', showIcon = true }) {
  const iconName =
    variant === 'success'
      ? 'checkCircle'
      : variant === 'warning'
      ? 'clock'
      : variant === 'danger'
      ? 'xCircle'
      : 'info';

  const el = cloneUi('status-text');
  el.classList.add(`status-${variant}`);
  if (showIcon) {
    mountRef(el, 'icon', icon(iconName, 'w-3.5 h-3.5'));
  } else {
    setVisible(el, 'icon', false);
  }
  setText(el, 'label', label);
  return el;
}

export function SubmoduleBar({ tabs, activeTab, onChange }) {
  const bar = cloneUi('submodule-bar');
  const list = getRef(bar, 'list');
  if (list) {
    mount(
      list,
      tabs.map((tab) => {
        const btn = cloneUi('submodule-tab');
        if (tab.id === activeTab) btn.classList.add('is-active');
        setText(btn, 'label', tab.label);
        if (tab.count !== undefined) {
          setText(btn, 'count', String(tab.count));
          setVisible(btn, 'count', true);
        }
        btn.addEventListener('click', () => onChange(tab.id));
        return btn;
      })
    );
  }
  return bar;
}

export function ModuleHeader({ title, subtitle, moduleNumber, actions }) {
  const header = cloneUi('module-header');
  if (moduleNumber) {
    setText(header, 'kicker', moduleNumber);
    setVisible(header, 'kicker', true);
  }
  setText(header, 'title', title);
  setText(header, 'subtitle', subtitle);
  if (actions) {
    mountRef(header, 'actions', actions);
    setVisible(header, 'actions', true);
  }
  return header;
}

export function SearchInput({ value = '', onChange, placeholder = 'Buscar...', className = '', focusId }) {
  const wrap = cloneUi('search-input');
  if (className) wrap.className = `search-wrap ${className}`;
  mountRef(wrap, 'icon', icon('search', 'search-wrap-icon'));
  const input = getRef(wrap, 'input');
  if (input) {
    input.value = value;
    input.placeholder = placeholder;
    if (focusId) input.dataset.focusId = focusId;
    input.addEventListener('input', (e) => onChange(e.target.value));
  }
  return wrap;
}

let activeEscHandler = null;

export function closeModal() {
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot) {
    modalRoot.replaceChildren();
  }
  if (activeEscHandler) {
    document.removeEventListener('keydown', activeEscHandler);
    activeEscHandler = null;
  }
}

export function openModal({ title, subtitle, size = 'md', renderBody }) {
  let modalRoot = document.getElementById('modal-root');
  if (!modalRoot) {
    modalRoot = document.createElement('div');
    modalRoot.id = 'modal-root';
    document.body.appendChild(modalRoot);
  }

  closeModal();

  const backdrop = parseHtmlTemplate(modalHtml);
  const box = getRef(backdrop, 'box');
  const closeBtn = getRef(backdrop, 'close-btn');
  const bodyEl = getRef(backdrop, 'body');

  if (box && (size === 'lg' || size === 'xl')) {
    box.classList.add(`modal-${size}`);
  }
  setText(backdrop, 'title', title || '');
  if (subtitle) {
    setText(backdrop, 'subtitle', subtitle);
    setVisible(backdrop, 'subtitle', true);
  }
  if (closeBtn) {
    mount(closeBtn, icon('x', 'w-5'));
    closeBtn.addEventListener('click', closeModal);
  }
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });

  const content = typeof renderBody === 'function' ? renderBody(closeModal) : renderBody;
  if (bodyEl && content) bodyEl.appendChild(content);

  mount(modalRoot, backdrop);

  activeEscHandler = (e) => {
    if (e.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', activeEscHandler);
}

export function EmptyState({ iconName = 'info', title, description, action }) {
  const el = cloneUi('empty-state');
  mountRef(el, 'icon', icon(iconName, 'w-5'));
  setText(el, 'title', title);
  setText(el, 'description', description);
  if (action) {
    mountRef(el, 'action', action);
    setVisible(el, 'action', true);
  }
  return el;
}

export function AccessDeniedCard({
  title = 'Acceso restringido por perfil',
  resourceName,
  roleLabel,
  onBack,
}) {
  const card = cloneUi('access-denied');
  mountRef(card, 'icon', icon('shieldAlert', 'w-5'));
  setText(card, 'title', title);
  setText(card, 'role-label', roleLabel);
  setText(card, 'resource-name', resourceName);
  if (onBack) {
    const btn = getRef(card, 'back-btn');
    setVisible(card, 'back-btn', true);
    if (btn) btn.addEventListener('click', onBack);
  }
  return card;
}

const aiAdvisorCache = new Map();

export function ModuleAIAdvisor({
  moduleId,
  moduleName,
  title,
  description,
  suggestedPrompts = [],
  contextData,
}) {
  if (!aiAdvisorCache.has(moduleId)) {
    aiAdvisorCache.set(moduleId, {
      prompt: suggestedPrompts[0] || '',
      loading: false,
      result: null,
      error: null,
    });
  }
  const cache = aiAdvisorCache.get(moduleId);

  const root = parseHtmlTemplate(aiAdvisorHtml);
  const chipsContainer = getRef(root, 'chips');
  const promptInput = getRef(root, 'prompt-input');
  const submitBtn = getRef(root, 'submit-btn');
  const resultArea = getRef(root, 'result-area');

  mountRef(root, 'cpu-icon', icon('cpu', 'w-4 text-teal'));
  setText(root, 'title', title || '');
  setText(root, 'description', description || '');

  if (promptInput) {
    promptInput.value = cache.prompt;
    promptInput.addEventListener('input', (e) => {
      cache.prompt = e.target.value;
      if (submitBtn) submitBtn.disabled = cache.loading || !cache.prompt.trim();
    });
  }

  function renderChips() {
    if (!chipsContainer) return;
    mount(
      chipsContainer,
      suggestedPrompts.map((p) =>
        h(
          'button',
          {
            type: 'button',
            className: `ai-prompt-chip${cache.prompt === p ? ' is-selected' : ''}`,
            onClick: () => {
              cache.prompt = p;
              if (promptInput) promptInput.value = p;
              renderChips();
              syncSubmitBtn();
            },
          },
          p
        )
      )
    );
  }

  function renderResult() {
    if (!resultArea) return;
    if (cache.error) {
      const errBox = cloneUi('ai-error');
      mountRef(errBox, 'icon', icon('alertCircle', 'w-4 shrink-0'));
      setText(errBox, 'message', cache.error);
      mount(resultArea, errBox);
      return;
    }
    if (cache.result) {
      const resBox = cloneUi('ai-result');
      mountRef(resBox, 'icon', icon('sparkles', 'w-3.5'));
      setText(resBox, 'model', cache.result.model || 'gemini-2.5-flash');
      setText(resBox, 'text', cache.result.text);
      mount(resultArea, resBox);
      return;
    }
    resultArea.replaceChildren();
  }

  function syncSubmitBtn() {
    if (!submitBtn) return;
    submitBtn.disabled = cache.loading || !cache.prompt.trim();
    mount(
      submitBtn,
      cache.loading ? icon('loader', 'w-3.5 spin') : icon('sparkles', 'w-3.5'),
      h('span', null, cache.loading ? 'Analizando con IA...' : 'Ejecutar análisis con IA')
    );
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      if (!cache.prompt.trim() || cache.loading) return;
      cache.loading = true;
      cache.error = null;
      syncSubmitBtn();
      renderResult();
      try {
        const res = await requestModuleAIAnalysis({
          moduleName,
          prompt: cache.prompt,
          contextData,
        });
        cache.result = res;
      } catch (err) {
        cache.error = err instanceof Error ? err.message : 'Error consultando IA.';
      } finally {
        cache.loading = false;
        syncSubmitBtn();
        renderResult();
      }
    });
  }

  renderChips();
  syncSubmitBtn();
  renderResult();
  return root;
}
