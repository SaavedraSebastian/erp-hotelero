/**
 * XSS-safe DOM helper and static Lucide-style SVG icon factory for Vanilla JS.
 * Strings are always mounted via TextNode (.textContent), never innerHTML.
 */

export function safeUrl(url) {
  if (typeof url !== 'string') return '#';
  const trimmed = url.trim();
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://')
  ) {
    return trimmed;
  }
  return '#';
}

function appendChildSafe(parent, child) {
  if (child === null || child === undefined || child === false || child === true) return;
  if (Array.isArray(child)) {
    for (const nested of child) {
      appendChildSafe(parent, nested);
    }
    return;
  }
  if (child instanceof Node) {
    parent.appendChild(child);
    return;
  }
  parent.appendChild(document.createTextNode(String(child)));
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props && typeof props === 'object') {
    for (const [key, val] of Object.entries(props)) {
      if (val === null || val === undefined || val === false) continue;
      if (key === 'className' || key === 'class') {
        el.className = String(val);
      } else if (key === 'style' && typeof val === 'object') {
        Object.assign(el.style, val);
      } else if (key === 'dataset' && typeof val === 'object') {
        for (const [dk, dv] of Object.entries(val)) {
          if (dv !== undefined && dv !== null) el.dataset[dk] = String(dv);
        }
      } else if (key.startsWith('on') && typeof val === 'function') {
        const evtName = key.slice(2).toLowerCase();
        el.addEventListener(evtName, val);
      } else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'required' || key === 'readOnly' || key === 'multiple') {
        el[key] = Boolean(val);
      } else if (key === 'value') {
        el.value = String(val);
      } else if (key === 'href' || key === 'src') {
        el.setAttribute(key, safeUrl(String(val)));
      } else if (key === 'htmlFor') {
        el.setAttribute('for', String(val));
      } else if (val === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(val));
      }
    }
  }
  for (const child of children) {
    appendChildSafe(el, child);
  }
  return el;
}

export function mount(target, ...nodes) {
  if (!target) return;
  const frag = document.createDocumentFragment();
  for (const node of nodes) {
    appendChildSafe(frag, node);
  }
  target.replaceChildren(frag);
}

/**
 * Parses static .html template files (bundled via Vite ?raw) into live DOM nodes
 * using DOMParser (only for static markup templates, never for untrusted user data).
 */
export function parseHtmlTemplate(rawHtml) {
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  const firstEl = doc.body.firstElementChild;
  return firstEl ? document.importNode(firstEl, true) : document.createElement('div');
}

export function getRef(root, name) {
  return root ? root.querySelector(`[data-ref="${name}"]`) : null;
}

export function setText(root, name, value) {
  const el = getRef(root, name);
  if (el) el.textContent = value ?? '';
  return el;
}

export function mountRef(root, name, ...nodes) {
  const el = getRef(root, name);
  if (el) mount(el, ...nodes);
  return el;
}

export function setVisible(root, name, visible) {
  const el = getRef(root, name);
  if (el) el.classList.toggle('hidden', !visible);
  return el;
}

export function onRef(root, name, eventName, handler) {
  const el = getRef(root, name);
  if (el) el.addEventListener(eventName, handler);
  return el;
}

export function createTemplateLibrary(rawHtml) {
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  const cache = new Map();
  doc.querySelectorAll('template[data-tpl]').forEach((tpl) => {
    cache.set(tpl.getAttribute('data-tpl'), tpl);
  });

  return function cloneTemplate(tplName) {
    const tpl = cache.get(tplName);
    if (!tpl || !tpl.content.firstElementChild) {
      return document.createElement('div');
    }
    return document.importNode(tpl.content.firstElementChild, true);
  };
}

export function loadViewTemplate(rawHtml) {
  return {
    root: parseHtmlTemplate(rawHtml),
    clone: createTemplateLibrary(rawHtml),
  };
}

export function captureFocusState() {
  const active = document.activeElement;
  if (!active || !(active instanceof HTMLElement)) return null;
  const focusId = active.dataset.focusId || active.id;
  if (!focusId) return null;
  const isInput =
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement;
  return {
    focusId,
    isById: !active.dataset.focusId && Boolean(active.id),
    selectionStart: isInput ? active.selectionStart : null,
    selectionEnd: isInput ? active.selectionEnd : null,
  };
}

export function restoreFocusState(snapshot) {
  if (!snapshot) return;
  const target = snapshot.isById
    ? document.getElementById(snapshot.focusId)
    : document.querySelector(`[data-focus-id="${CSS.escape(snapshot.focusId)}"]`);
  if (!target || !(target instanceof HTMLElement)) return;
  target.focus({ preventScroll: true });
  if (
    snapshot.selectionStart !== null &&
    snapshot.selectionEnd !== null &&
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
  ) {
    try {
      target.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    } catch {
      // ignore input types that don't support setSelectionRange
    }
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c instanceof Node) el.appendChild(c);
    else if (c !== null && c !== undefined) el.appendChild(document.createTextNode(String(c)));
  }
  return el;
}

const ICON_SHAPES = {
  building: [
    ['rect', { x: 4, y: 2, width: 16, height: 20, rx: 2 }],
    ['path', { d: 'M9 22v-4h6v4' }],
    ['path', { d: 'M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01' }],
  ],
  dashboard: [
    ['rect', { width: 7, height: 9, x: 3, y: 3, rx: 1 }],
    ['rect', { width: 7, height: 5, x: 14, y: 3, rx: 1 }],
    ['rect', { width: 7, height: 9, x: 14, y: 12, rx: 1 }],
    ['rect', { width: 7, height: 5, x: 3, y: 16, rx: 1 }],
  ],
  calendar: [
    ['path', { d: 'M8 2v4M16 2v4' }],
    ['rect', { width: 18, height: 18, x: 3, y: 4, rx: 2 }],
    ['path', { d: 'M3 10h18M9 16l2 2 4-4' }],
  ],
  sparkles: [
    ['path', { d: 'm12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z' }],
  ],
  utensils: [
    ['path', { d: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7' }],
  ],
  receipt: [
    ['path', { d: 'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z' }],
    ['path', { d: 'M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11' }],
  ],
  heart: [
    ['path', { d: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z' }],
  ],
  settings: [
    ['circle', { cx: 12, cy: 12, r: 3 }],
    ['path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.02 1.51 1H21a2 2 0 0 1 0 4h-.09c-.74-.02-1.25.4-1.51 1Z' }],
  ],
  bell: [
    ['path', { d: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0' }],
  ],
  search: [
    ['circle', { cx: 11, cy: 11, r: 8 }],
    ['path', { d: 'm21 21-4.3-4.3' }],
  ],
  menu: [
    ['line', { x1: 4, x2: 20, y1: 12, y2: 12 }],
    ['line', { x1: 4, x2: 20, y1: 6, y2: 6 }],
    ['line', { x1: 4, x2: 20, y1: 18, y2: 18 }],
  ],
  x: [
    ['path', { d: 'M18 6 6 18M6 6l12 12' }],
  ],
  chevronDown: [
    ['path', { d: 'm6 9 6 6 6-6' }],
  ],
  chevronRight: [
    ['path', { d: 'm9 18 6-6-6-6' }],
  ],
  arrowRight: [
    ['path', { d: 'M5 12h14M12 5l7 7-7 7' }],
  ],
  logout: [
    ['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9' }],
  ],
  shieldCheck: [
    ['path', { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' }],
    ['path', { d: 'm9 12 2 2 4-4' }],
  ],
  shieldAlert: [
    ['path', { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' }],
    ['path', { d: 'M12 8v4M12 16h.01' }],
  ],
  checkCircle: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', { d: 'm9 12 2 2 4-4' }],
  ],
  clock: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['polyline', { points: '12 6 12 12 16 14' }],
  ],
  xCircle: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', { d: 'm15 9-6 6M9 9l6 6' }],
  ],
  info: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', { d: 'M12 16v-4M12 8h.01' }],
  ],
  alertCircle: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['line', { x1: 12, x2: 12, y1: 8, y2: 12 }],
    ['line', { x1: 12, x2: 12.01, y1: 16, y2: 16 }],
  ],
  cpu: [
    ['rect', { width: 16, height: 16, x: 4, y: 4, rx: 2 }],
    ['rect', { width: 6, height: 6, x: 9, y: 9, rx: 1 }],
    ['path', { d: 'M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2' }],
  ],
  loader: [
    ['path', { d: 'M21 12a9 9 0 1 1-6.219-8.56' }],
  ],
  mail: [
    ['rect', { width: 20, height: 16, x: 2, y: 4, rx: 2 }],
    ['path', { d: 'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7' }],
  ],
  lock: [
    ['rect', { width: 18, height: 11, x: 3, y: 11, rx: 2, ry: 2 }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }],
  ],
  eye: [
    ['path', { d: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z' }],
    ['circle', { cx: 12, cy: 12, r: 3 }],
  ],
  eyeOff: [
    ['path', { d: 'M9.88 9.88a3 3 0 1 0 4.24 4.24' }],
    ['path', { d: 'M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68' }],
    ['path', { d: 'M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61' }],
    ['line', { x1: 2, x2: 22, y1: 2, y2: 22 }],
  ],
  wrench: [
    ['path', { d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z' }],
  ],
  users: [
    ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: 9, cy: 7, r: 4 }],
    ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' }],
  ],
  database: [
    ['ellipse', { cx: 12, cy: 5, rx: 9, ry: 3 }],
    ['path', { d: 'M3 5v14a9 3 0 0 0 18 0V5' }],
    ['path', { d: 'M3 12a9 3 0 0 0 18 0' }],
  ],
  copy: [
    ['rect', { width: 14, height: 14, x: 8, y: 8, rx: 2, ry: 2 }],
    ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }],
  ],
  rotateCcw: [
    ['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }],
    ['path', { d: 'M3 3v5h5' }],
  ],
  plus: [
    ['path', { d: 'M5 12h14M12 5v14' }],
  ],
  send: [
    ['path', { d: 'm22 2-7 20-4-9-9-4Z' }],
    ['path', { d: 'M22 2 11 13' }],
  ],
  shoppingCart: [
    ['circle', { cx: 8, cy: 21, r: 1 }],
    ['circle', { cx: 19, cy: 21, r: 1 }],
    ['path', { d: 'M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12' }],
  ],
  fileCode: [
    ['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }],
    ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4M10 13l-2 2 2 2M14 17l2-2-2-2' }],
  ],
  printer: [
    ['path', { d: 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2' }],
    ['path', { d: 'M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6' }],
    ['rect', { width: 12, height: 8, x: 6, y: 14, rx: 1 }],
  ],
  trash: [
    ['path', { d: 'M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' }],
  ],
  edit: [
    ['path', { d: 'M12 20h9M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z' }],
  ],
  history: [
    ['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }],
    ['path', { d: 'M3 3v5h5M12 7v5l4 2' }],
  ],
  logIn: [
    ['path', { d: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3' }],
  ],
  logOut: [
    ['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9' }],
  ],
  check: [
    ['path', { d: 'M20 6 9 17l-5-5' }],
  ],
  alertTriangle: [
    ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z' }],
    ['path', { d: 'M12 9v4M12 17h.01' }],
  ],
  userPlus: [
    ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: 9, cy: 7, r: 4 }],
    ['line', { x1: 19, x2: 19, y1: 8, y2: 14 }],
    ['line', { x1: 22, x2: 16, y1: 11, y2: 11 }],
  ],
  clipboardCheck: [
    ['rect', { width: 8, height: 4, x: 8, y: 2, rx: 1, ry: 1 }],
    ['path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }],
    ['path', { d: 'm9 14 2 2 4-4' }],
  ],
  packagePlus: [
    ['path', { d: 'M16 16h6M19 13v6M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14' }],
    ['path', { d: 'm7.5 4.27 9 5.15M3.29 7 12 12l8.71-5M12 22V12' }],
  ],
  minus: [
    ['path', { d: 'M5 12h14' }],
  ],
  arrowDownUp: [
    ['path', { d: 'm3 16 4 4 4-4M7 20V4M21 8l-4-4-4 4M17 4v16' }],
  ],
  packageCheck: [
    ['path', { d: 'm16 16 2 2 4-4' }],
    ['path', { d: 'M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14' }],
    ['path', { d: 'm7.5 4.27 9 5.15M3.29 7 12 12l8.71-5M12 22V12' }],
  ],
  truck: [
    ['path', { d: 'M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2' }],
    ['path', { d: 'M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14' }],
    ['circle', { cx: 17, cy: 18, r: 2 }],
    ['circle', { cx: 7, cy: 18, r: 2 }],
  ],
  chefHat: [
    ['path', { d: 'M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1ZM6 17h12' }],
  ],
  creditCard: [
    ['rect', { width: 20, height: 14, x: 2, y: 5, rx: 2 }],
    ['line', { x1: 2, x2: 22, y1: 10, y2: 10 }],
  ],
  wallet: [
    ['path', { d: 'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1' }],
    ['path', { d: 'M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4' }],
  ],
  fileText: [
    ['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }],
    ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8' }],
  ],
  award: [
    ['path', { d: 'm15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526' }],
    ['circle', { cx: 12, cy: 8, r: 6 }],
  ],
  star: [
    ['polygon', { points: '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2' }],
  ],
  messageSquare: [
    ['path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }],
  ],
  shield: [
    ['path', { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' }],
  ],
  userCheck: [
    ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: 9, cy: 7, r: 4 }],
    ['polyline', { points: '16 11 18 13 22 9' }],
  ],
};

export function icon(name, className = 'w-4 h-4') {
  const shapes = ICON_SHAPES[name] || ICON_SHAPES.chevronRight;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  for (const [shapeTag, attrs] of shapes) {
    const child = document.createElementNS(SVG_NS, shapeTag);
    for (const [k, v] of Object.entries(attrs)) {
      child.setAttribute(k, String(v));
    }
    svg.appendChild(child);
  }
  return svg;
}
