// Lector EPUB basado en epub.js (vendor/epub.min.js, variable global ePub).
import { COLORS, debounce } from './util.js';
import { updateBook } from './db.js';

const systemDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
export const resolveTheme = (t) => (!t || t === 'auto' ? (systemDark() ? 'dark' : 'light') : t);
export const THEMES = {
  light: { bg: '#ffffff', fg: '#1c1c1e', link: '#5856d6' },
  sepia: { bg: '#f8f1e3', fg: '#5b4636', link: '#8a5a2b' },
  dark: { bg: '#121212', fg: '#e5e5e7', link: '#a5a8ff' },
};
const FONTS = {
  serif: '"Iowan Old Style", "Palatino", Georgia, serif',
  sans: '-apple-system, "SF Pro Text", system-ui, sans-serif',
};

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

  for (const [name, t] of Object.entries(THEMES)) {
    rendition.themes.register(name, { body: { color: `${t.fg} !important`, background: `${t.bg} !important`, 'line-height': '1.6 !important' }, a: { color: `${t.link} !important` }, '::selection': { background: 'rgba(88, 86, 214, 0.3)' } });
  }
  let themeName = cb.prefs.theme || 'auto';
  let current = resolveTheme(themeName);
  const applyFont = (f) => rendition.themes.override('font-family', FONTS[f] || FONTS.serif, true);
  applyFont(cb.prefs.font || 'serif');
  rendition.themes.select(current);
  const isDark = () => current === 'dark';
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => { if (themeName === 'auto') setTheme('auto'); };
  mq.addEventListener?.('change', onScheme);
  function setTheme(name) {
    themeName = name;
    current = resolveTheme(name);
    rendition.themes.select(current);
    highlights.forEach((h) => { remove(h); add(h); });
    cb.onTheme?.(current);
  }

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
        else cb.onTapCenter?.();
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
    setTheme,
    setFont: applyFont,
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
