// Pequeñas utilidades compartidas por toda la app.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const norm = (s) => String(s ?? '').trim().toLowerCase();

// #etiquetas escritas dentro de un texto
export function parseTags(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)) out.add(m[2].toLowerCase());
  return [...out];
}

// [[enlaces]] escritos dentro de un texto
export function parseLinks(text) {
  const out = new Map();
  for (const m of String(text ?? '').matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const t = m[1].trim();
    if (t && !out.has(norm(t))) out.set(norm(t), t);
  }
  return [...out.values()];
}

// Etiquetas de una nota o subrayado: las elegidas + las escritas con #
export function allTags(item) {
  return [...new Set([...(item.tags || []), ...parseTags(item.body ?? item.note)])];
}

export function debounce(fn, ms = 400) {
  let t = null;
  let last = [];
  const d = (...a) => { last = a; clearTimeout(t); t = setTimeout(() => { t = null; fn(...last); }, ms); };
  d.flush = () => { if (t) { clearTimeout(t); t = null; fn(...last); } };
  return d;
}

export function fmtDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function snippet(text, n = 140) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function safeFileName(s) {
  return String(s || 'sin-titulo').replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100) || 'sin-titulo';
}

let toastTimer;
export function toast(msg, action) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.classList.remove('show'); action.run(); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2500);
}

// Hoja inferior (modal). Devuelve { el, close }.
export function sheet(html, { onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop"></div><div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${html}</div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 250);
    onClose?.();
  };
  wrap.querySelector('.sheet-backdrop').onclick = close;
  window.addEventListener('hashchange', close, { once: true });
  // Deslizar hacia abajo para cerrar, como en iOS.
  const sh = wrap.querySelector('.sheet');
  let y0 = null;
  let dy = 0;
  sh.addEventListener('touchstart', (e) => {
    if (sh.scrollTop > 0 || e.target.closest('textarea, .chips.scroll')) return;
    y0 = e.touches[0].clientY;
    dy = 0;
  }, { passive: true });
  sh.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 6) { sh.style.transition = 'none'; sh.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  sh.addEventListener('touchend', () => {
    if (y0 == null) return;
    y0 = null;
    sh.style.transition = '';
    sh.style.transform = '';
    if (dy > 90) close();
  });
  return { el: wrap.querySelector('.sheet'), close };
}

// Pide un texto con una hoja inferior. Resuelve con el texto o null.
export function askText(title, value = '', { placeholder = '', ok = 'Aceptar' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet(`
      <h3>${esc(title)}</h3>
      <form class="stack">
        <input class="input" name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">
        <div class="row end"><button type="button" class="btn ghost" data-cancel>Cancelar</button><button class="btn primary">${esc(ok)}</button></div>
      </form>`, { onClose: () => { if (!done) resolve(null); } });
    const input = s.el.querySelector('input');
    setTimeout(() => input.focus(), 50);
    s.el.querySelector('[data-cancel]').onclick = s.close;
    s.el.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      done = true;
      resolve(v);
      s.close();
    };
  });
}

export function confirmSheet(title, text, okLabel = 'Eliminar') {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet(`
      <h3>${esc(title)}</h3><p class="muted">${esc(text)}</p>
      <div class="row end"><button class="btn ghost" data-no>Cancelar</button><button class="btn danger" data-yes>${esc(okLabel)}</button></div>`,
    { onClose: () => { if (!done) resolve(false); } });
    s.el.querySelector('[data-no]').onclick = s.close;
    s.el.querySelector('[data-yes]').onclick = () => { done = true; resolve(true); s.close(); };
  });
}

// Comparte o descarga un archivo (en iPhone abre el menú de compartir).
export async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const COLORS = {
  yellow: '#ffd43b',
  green: '#69db7c',
  blue: '#74c0fc',
  pink: '#f783ac',
};

export const QUICK_TAGS = ['research', 'idea', 'pregunta', 'cita'];

export const icons = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  marker: '<svg viewBox="0 0 24 24"><path d="M15 4l5 5-9 9H6v-5z"/><path d="M4 21h16"/></svg>',
  type: '<svg viewBox="0 0 24 24"><path d="M4 7V5h11v2M9.5 5v14M7 19h5M14 12v-1.5h7V12M17.5 10.5V19M16 19h3"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  zoomIn: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6M11 8v6"/></svg>',
  zoomOut: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/></svg>',
  bulb: '<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h4"/></svg>',
};

// Barra de navegación estilo iOS: título grande que se convierte en título pequeño al hacer scroll.
export function navBar({ title = '', back = null, actions = '', large = true } = {}) {
  return `<header class="nav">
    <div class="nav-side">${back ? `<a class="nav-back" href="${back.href}">${icons.back}<span>${esc(back.label)}</span></a>` : ''}</div>
    <div class="nav-title">${esc(title)}</div>
    <div class="nav-side end">${actions}</div>
  </header>${large && title ? `<h1 class="large-title">${esc(title)}</h1>` : ''}`;
}

export function bindNav(root) {
  const nav = root.querySelector('.nav');
  const h1 = root.querySelector('.large-title');
  if (!nav) return;
  if (!h1) { nav.classList.add('compact'); return; }
  const io = new IntersectionObserver(([e]) => nav.classList.toggle('compact', !e.isIntersecting), { rootMargin: '-52px 0px 0px 0px' });
  io.observe(h1);
}

// Enlaza automáticamente, dentro de un HTML ya pintado, las menciones de otros conceptos.
export function autoLink(container, notes, selfId) {
  const list = notes.filter((n) => n.id !== selfId && n.title && n.title.trim().length >= 3)
    .sort((a, b) => b.title.length - a.title.length);
  if (!list.length) return;
  const done = new Set();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest('a, code') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    for (const n of list) {
      if (done.has(n.id)) continue;
      const t = n.title.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${t})(?![\\p{L}\\p{N}])`, 'iu');
      const m = node.data.match(re);
      if (!m) continue;
      const start = m.index + m[1].length;
      const after = node.splitText(start);
      after.splitText(m[2].length);
      const a = document.createElement('a');
      a.className = 'wikilink auto';
      a.href = `#/note/${n.id}`;
      a.textContent = after.data;
      after.replaceWith(a);
      done.add(n.id);
      break;
    }
  }
}
