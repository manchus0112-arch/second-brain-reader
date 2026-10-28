// Pantalla de lectura: barra superior, libro, barra de selección y paneles.
import { esc, sheet, icons, toast, COLORS, snippet } from '../util.js';
import { db, getBookData, saveHighlight } from '../db.js';
import { openHighlightSheet, announceConnections } from '../highlights.js';
import { THEMES, resolveTheme } from '../epub-reader.js';

const PREFS_KEY = 'reader-prefs';
function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } }
function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* sin almacenamiento */ } }

export async function readerView(root, bookId, targetId) {
  const book = await db.get('books', bookId);
  if (!book) { location.hash = '#/'; return; }
  const data = await getBookData(bookId);
  const highlights = await db.byBook(bookId);
  const target = targetId ? highlights.find((h) => h.id === targetId) : null;
  const prefs = loadPrefs();

  document.body.classList.add('reading');
  root.innerHTML = `
    <div class="reader" data-theme="${book.type === 'epub' ? resolveTheme(prefs.theme) : ''}">
      <header class="reader-top">
        <a class="icon-btn" href="#/book/${book.id}" aria-label="Volver">${icons.back}</a>
        <div class="reader-title">${esc(book.title)}</div>
        ${book.type === 'epub' ? `<button class="icon-btn" data-toc aria-label="Índice">${icons.list}</button>` : ''}
        <button class="icon-btn" data-hls aria-label="Subrayados">${icons.marker}</button>
        <button class="icon-btn" data-size aria-label="Tamaño">${book.type === 'epub' ? icons.type : icons.zoomIn}</button>
      </header>
      <div class="reader-body ${book.type}"><div class="loading">Abriendo libro…</div></div>
      <footer class="reader-bottom">
        <button class="icon-btn" data-prev aria-label="Anterior">${icons.left}</button>
        <span class="reader-progress"></span>
        <button class="icon-btn" data-next aria-label="Siguiente">${icons.right}</button>
      </footer>
      <div class="selbar" hidden>
        <button data-act="highlight"><span class="dot" style="background:${COLORS.yellow}"></span>Subrayar</button>
        <button data-act="note">${icons.note}Nota</button>
        <button data-act="concept">${icons.bulb}Conectar</button>
      </div>
    </div>`;

  const readerEl = root.querySelector('.reader');
  const body = root.querySelector('.reader-body');
  const selbar = root.querySelector('.selbar');
  const progressEl = root.querySelector('.reader-progress');
  let selection = null;
  let lastSel = null;
  let lastAt = 0;
  let hideTimer;
  let engine;

  const openSheet = (h, opts = {}) => openHighlightSheet(h, book, {
    ...opts,
    onChange: (x) => engine.update(x),
    onDelete: (x) => {
      const i = highlights.findIndex((y) => y.id === x.id);
      if (i >= 0) highlights.splice(i, 1);
      engine.remove(x);
    },
  });

  const cb = {
    prefs,
    target,
    onSelect(sel) {
      // En iPhone, tocar la barra puede borrar la selección justo antes del clic,
      // así que se recuerda la última selección un momento.
      clearTimeout(hideTimer);
      selection = sel;
      if (sel) { lastSel = sel; lastAt = Date.now(); selbar.hidden = false; } else { lastAt = Date.now(); hideTimer = setTimeout(() => { selbar.hidden = true; }, 400); }
    },
    onHighlightTap(id) {
      const h = highlights.find((x) => x.id === id);
      if (h) openSheet(h);
    },
    onProgress(text) { progressEl.textContent = text; },
    onTapCenter() { readerEl.classList.toggle('immersive'); },
    onTheme(t) { readerEl.dataset.theme = t; },
  };

  try {
    const mod = book.type === 'pdf' ? await import('../pdf-reader.js') : await import('../epub-reader.js');
    body.innerHTML = '';
    engine = await (book.type === 'pdf' ? mod.createPdfReader : mod.createEpubReader)(body, book, data, highlights, cb);
  } catch (e) {
    console.error(e);
    body.innerHTML = `<div class="empty"><p>No se pudo abrir este libro.</p><p class="muted small">${esc(e.message || e)}</p></div>`;
    return () => document.body.classList.remove('reading');
  }

  selbar.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    const sel = selection || (Date.now() - lastAt < 1500 ? lastSel : null);
    if (!b || !sel) return;
    lastSel = null;
    const h = await saveHighlight({ bookId: book.id, kind: book.type, ...sel.anchor, text: sel.text });
    highlights.push(h);
    engine.add(h);
    engine.clearSelection();
    selection = null;
    selbar.hidden = true;
    if (b.dataset.act === 'note') openSheet(h, { focusNote: true });
    else if (b.dataset.act === 'concept') openSheet(h, { focusConcepts: true });
    else if (!(await announceConnections(h)).length) toast('Subrayado guardado');
  };

  root.querySelector('[data-prev]').onclick = () => engine.prev();
  root.querySelector('[data-next]').onclick = () => engine.next();

  root.querySelector('[data-hls]').onclick = () => {
    const sorted = [...highlights].sort((a, b) => (a.page || 0) - (b.page || 0) || (a.start || 0) - (b.start || 0) || a.createdAt - b.createdAt);
    const s = sheet(`
      <h3>Subrayados <span class="muted">(${highlights.length})</span></h3>
      ${sorted.length ? `<ul class="list">${sorted.map((h) => `
        <li class="hl-item" data-id="${h.id}">
          <div class="hl-text" style="--hl:${COLORS[h.color]}">${esc(snippet(h.text, 200))}</div>
          ${h.note ? `<div class="muted small">${esc(snippet(h.note, 120))}</div>` : ''}
          <div class="row small"><button class="link" data-go>Ir</button><button class="link" data-edit>Editar nota</button>${h.page ? `<span class="muted">pág. ${h.page}</span>` : ''}</div>
        </li>`).join('')}</ul>` : '<p class="muted">Selecciona texto mientras lees para subrayar.</p>'}`);
    s.el.onclick = (e) => {
      const li = e.target.closest('[data-id]');
      if (!li) return;
      const h = highlights.find((x) => x.id === li.dataset.id);
      if (e.target.closest('[data-edit]')) { s.close(); openSheet(h); } else if (e.target.closest('[data-go]')) { s.close(); engine.goTo(h); }
    };
  };

  root.querySelector('[data-toc]')?.addEventListener('click', () => {
    const items = [];
    const walk = (list, depth) => list.forEach((it) => { items.push({ ...it, depth }); if (it.subitems?.length) walk(it.subitems, depth + 1); });
    walk(engine.toc() || [], 0);
    const s = sheet(`<h3>Índice</h3><ul class="list toc">${items.map((it, i) => `<li><button class="link" data-i="${i}" style="padding-left:${it.depth * 16}px">${esc(it.label.trim())}</button></li>`).join('') || '<li class="muted">Este libro no tiene índice.</li>'}</ul>`);
    s.el.onclick = (e) => {
      const b = e.target.closest('[data-i]');
      if (b) { engine.goHref(items[Number(b.dataset.i)].href); s.close(); }
    };
  });

  root.querySelector('[data-size]').onclick = () => {
    const isPdf = book.type === 'pdf';
    const label = () => (isPdf ? `${Math.round((prefs.pdfZoom || 1) * 100)}%` : `${prefs.fontSize || 100}%`);
    const themeBtn = (k, name) => {
      const t = THEMES[k] || { bg: 'linear-gradient(135deg,#fff 50%,#121212 50%)', fg: '#888' };
      return `<button class="theme-dot ${(prefs.theme || 'auto') === k ? 'on' : ''}" data-theme="${k}" style="background:${t.bg};color:${t.fg}"><span>Aa</span><small>${name}</small></button>`;
    };
    const s = sheet(`
      <h3>${isPdf ? 'Zoom' : 'Apariencia'}</h3>
      <div class="stepper"><button data-d="-1" aria-label="Más pequeño">${isPdf ? '−' : '<span style="font-size:14px">A</span>'}</button><span class="size-label">${label()}</span><button data-d="1" aria-label="Más grande">${isPdf ? '+' : '<span style="font-size:22px">A</span>'}</button></div>
      ${isPdf ? '' : `
        <div class="sheet-label">Tema</div>
        <div class="theme-row">${themeBtn('auto', 'Auto')}${themeBtn('light', 'Claro')}${themeBtn('sepia', 'Sepia')}${themeBtn('dark', 'Oscuro')}</div>
        <div class="sheet-label">Letra</div>
        <div class="segmented"><a href="javascript:void 0" data-font="serif" class="${(prefs.font || 'serif') === 'serif' ? 'on' : ''}" style="font-family:Georgia,serif">Clásica</a><a href="javascript:void 0" data-font="sans" class="${prefs.font === 'sans' ? 'on' : ''}">Moderna</a></div>`}`);
    s.el.onclick = (e) => {
      const d = e.target.closest('[data-d]');
      const th = e.target.closest('[data-theme]');
      const f = e.target.closest('[data-font]');
      if (d) {
        const v = engine.zoom(Number(d.dataset.d));
        if (isPdf) prefs.pdfZoom = v / 100; else prefs.fontSize = v;
        s.el.querySelector('.size-label').textContent = label();
      } else if (th) {
        prefs.theme = th.dataset.theme;
        engine.setTheme(prefs.theme);
        s.el.querySelectorAll('[data-theme]').forEach((x) => x.classList.toggle('on', x === th));
      } else if (f) {
        e.preventDefault();
        prefs.font = f.dataset.font;
        engine.setFont(prefs.font);
        s.el.querySelectorAll('[data-font]').forEach((x) => x.classList.toggle('on', x === f));
      } else return;
      savePrefs(prefs);
    };
  };

  return () => {
    document.body.classList.remove('reading');
    engine?.destroy();
  };
}
