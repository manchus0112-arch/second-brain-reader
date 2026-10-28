// Lector EPUB basado en epub.js (vendor/epub.min.js, variable global ePub).
import { COLORS, debounce } from './util.js';
import { updateBook } from './db.js';

const isDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

export async function createEpubReader(container, rec, data, highlights, cb) {
  const book = window.ePub(data);
  await book.ready;

  const rendition = book.renderTo(container, {
    width: '100%',
    height: '100%',
    flow: 'paginated',
    spread: 'none',
    allowScriptedContent: false,
  });

  const base = { 'line-height': '1.55 !important', 'font-family': 'Georgia, "Iowan Old Style", serif' };
  rendition.themes.register('light', { body: { ...base, color: '#1f1d1a', background: '#fbf9f4' }, a: { color: '#4b4fc4' } });
  rendition.themes.register('dark', { body: { ...base, color: '#e7e4dd', background: '#1a1a1c' }, a: { color: '#a5a8ff' } });
  rendition.themes.select(isDark() ? 'dark' : 'light');
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => rendition.themes.select(isDark() ? 'dark' : 'light');
  mq.addEventListener?.('change', onScheme);

  let fontSize = cb.prefs.fontSize || 100;
  rendition.themes.fontSize(`${fontSize}%`);

  // Subrayados
  const hlStyle = (h) => ({ stroke: 'none', fill: COLORS[h.color] || COLORS.yellow, 'fill-opacity': isDark() ? '0.4' : '0.45', 'mix-blend-mode': isDark() ? 'normal' : 'multiply' });
  const add = (h) => rendition.annotations.highlight(h.cfi, { id: h.id }, () => cb.onHighlightTap(h.id), 'sb-hl', hlStyle(h));
  const remove = (h) => rendition.annotations.remove(h.cfi, 'highlight');
  highlights.forEach(add);

  // Selección de texto
  rendition.on('selected', (cfiRange, contents) => {
    const text = contents.window.getSelection()?.toString().trim();
    if (text) cb.onSelect({ anchor: { cfi: cfiRange }, text });
  });

  const next = () => rendition.next();
  const prev = () => rendition.prev();

  rendition.hooks.content.register((contents) => {
    const doc = contents.document;
    const win = contents.window;
    doc.addEventListener('selectionchange', () => {
      const sel = win.getSelection();
      if (!sel || sel.isCollapsed) cb.onSelect(null);
    });
    // Deslizar para pasar página, o tocar los bordes.
    let start = null;
    doc.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, time: Date.now() };
    }, { passive: true });
    doc.addEventListener('touchend', (e) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const dt = Date.now() - start.time;
      start = null;
      const sel = win.getSelection();
      if (sel && !sel.isCollapsed) return;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 700) {
        dx < 0 ? next() : prev();
      } else if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && dt < 300 && !e.target.closest?.('a')) {
        const frame = win.frameElement?.getBoundingClientRect();
        const box = container.getBoundingClientRect();
        if (!frame) return;
        const x = frame.left + t.clientX - box.left;
        if (x < box.width * 0.22) prev();
        else if (x > box.width * 0.78) next();
      }
    }, { passive: true });
    doc.addEventListener('keyup', onKey);
  });

  function onKey(e) {
    if (e.key === 'ArrowRight') next();
    if (e.key === 'ArrowLeft') prev();
  }
  document.addEventListener('keyup', onKey);

  // Progreso y posición
  const persist = debounce((patch) => updateBook(rec.id, patch), 800);
  function report(loc) {
    if (!loc?.start) return;
    const pct = book.locations.length() ? book.locations.percentageFromCfi(loc.start.cfi) : null;
    const chapter = book.navigation?.get(loc.start.href)?.label?.trim();
    cb.onProgress(pct != null ? `${Math.round(pct * 100)}%` : (chapter || ''));
    persist({ location: loc.start.cfi, lastReadAt: Date.now(), ...(pct != null ? { progress: pct } : {}) });
  }
  rendition.on('relocated', report);

  await rendition.display(cb.target?.cfi || rec.location || undefined);

  if (rec.locations) {
    book.locations.load(rec.locations);
    report(rendition.currentLocation());
  } else {
    setTimeout(async () => {
      try {
        await book.locations.generate(1200);
        await updateBook(rec.id, { locations: book.locations.save() });
        report(rendition.currentLocation());
      } catch (e) { console.warn('locations', e); }
    }, 1500);
  }

  await book.loaded.navigation;

  return {
    next,
    prev,
    add,
    remove,
    update: (h) => { remove(h); add(h); },
    goTo: (h) => rendition.display(h.cfi),
    toc: () => book.navigation.toc,
    goHref: (href) => rendition.display(href),
    clearSelection: () => rendition.getContents().forEach((c) => c.window.getSelection()?.removeAllRanges()),
    zoom(delta) {
      fontSize = Math.min(220, Math.max(70, fontSize + delta * 10));
      rendition.themes.fontSize(`${fontSize}%`);
      return fontSize;
    },
    destroy() {
      persist.flush();
      document.removeEventListener('keyup', onKey);
      mq.removeEventListener?.('change', onScheme);
      rendition.destroy();
      book.destroy();
    },
  };
}
