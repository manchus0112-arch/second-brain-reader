// Lector PDF basado en pdf.js (vendor/pdf.min.mjs).
// Cada página tiene un lienzo, una capa de texto seleccionable y una capa de subrayados.
// Un subrayado de PDF se guarda como { page, start, end }: posiciones dentro del texto de la página.
import { COLORS, debounce } from './util.js';
import { updateBook } from './db.js';

let pdfjsPromise;
function loadPdfjs() {
  pdfjsPromise ||= import('../vendor/pdf.min.mjs').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
    return lib;
  });
  return pdfjsPromise;
}

function offsetWithin(root, node, offset) {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

function rangeFromOffsets(root, start, end) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let pos = 0;
  let n;
  let started = false;
  while ((n = walker.nextNode())) {
    const len = n.data.length;
    if (!started && start <= pos + len) { range.setStart(n, start - pos); started = true; }
    if (started && end <= pos + len) { range.setEnd(n, end - pos); return range; }
    pos += len;
  }
  return null;
}

export async function createPdfReader(container, rec, data, highlights, cb) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const total = doc.numPages;

  const scroller = document.createElement('div');
  scroller.className = 'pdf-scroller';
  container.appendChild(scroller);

  let zoom = cb.prefs.pdfZoom || 1;
  let baseScale = 1;
  let pages = [];
  let current = 1;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const firstVp = (await doc.getPage(1)).getViewport({ scale: 1 });

  function layout() {
    scroller.innerHTML = '';
    observer?.disconnect();
    const width = Math.max(200, scroller.clientWidth - 16);
    baseScale = (width / firstVp.width) * zoom;
    pages = [];
    for (let i = 1; i <= total; i++) {
      const el = document.createElement('div');
      el.className = 'pdf-page';
      el.dataset.page = i;
      el.style.width = `${firstVp.width * baseScale}px`;
      el.style.height = `${firstVp.height * baseScale}px`;
      el.innerHTML = '<canvas></canvas><div class="textLayer"></div><div class="hl-layer"></div>';
      scroller.appendChild(el);
      pages.push({ el, n: i, rendered: false, task: null, hlRects: [] });
    }
    observer = new IntersectionObserver(onIntersect, { root: scroller, rootMargin: '150% 0px' });
    pages.forEach((p) => observer.observe(p.el));
  }

  let observer;
  function onIntersect(entries) {
    for (const e of entries) {
      const p = pages[Number(e.target.dataset.page) - 1];
      if (e.isIntersecting) renderPage(p);
      else releasePage(p);
    }
  }

  async function renderPage(p) {
    if (p.rendered) return;
    p.rendered = true;
    try {
      const page = await doc.getPage(p.n);
      const vp = page.getViewport({ scale: baseScale });
      p.el.style.width = `${vp.width}px`;
      p.el.style.height = `${vp.height}px`;
      p.el.style.setProperty('--scale-factor', baseScale);
      const canvas = p.el.querySelector('canvas');
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      p.task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
      const tl = p.el.querySelector('.textLayer');
      tl.innerHTML = '';
      const textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp });
      await Promise.all([p.task.promise, textLayer.render()]);
      p.task = null;
      paint(p);
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException') console.warn('pdf page', e);
    }
  }

  function releasePage(p) {
    if (!p.rendered) return;
    p.task?.cancel();
    p.task = null;
    p.rendered = false;
    const canvas = p.el.querySelector('canvas');
    canvas.width = 0;
    canvas.height = 0;
    p.el.querySelector('.textLayer').innerHTML = '';
    p.el.querySelector('.hl-layer').innerHTML = '';
    p.hlRects = [];
  }

  function paint(p) {
    if (!p?.rendered) return;
    const layer = p.el.querySelector('.hl-layer');
    const tl = p.el.querySelector('.textLayer');
    layer.innerHTML = '';
    p.hlRects = [];
    const box = p.el.getBoundingClientRect();
    for (const h of highlights.filter((x) => x.page === p.n)) {
      const range = rangeFromOffsets(tl, h.start, h.end);
      if (!range) continue;
      for (const r of range.getClientRects()) {
        if (r.width < 1 || r.height < 1) continue;
        const d = document.createElement('div');
        d.className = 'hl-rect';
        d.style.cssText = `left:${r.left - box.left}px;top:${r.top - box.top}px;width:${r.width}px;height:${r.height}px;background:${COLORS[h.color] || COLORS.yellow}`;
        layer.appendChild(d);
        p.hlRects.push({ id: h.id, x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height });
      }
    }
  }
  const repaintPage = (n) => paint(pages[n - 1]);

  // Toque sobre un subrayado
  function onClick(e) {
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return;
    const pageEl = e.target.closest('.pdf-page');
    if (!pageEl) return;
    const p = pages[Number(pageEl.dataset.page) - 1];
    const box = pageEl.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const hit = p.hlRects.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    if (hit) cb.onHighlightTap(hit.id);
    else cb.onTapCenter?.();
  }
  scroller.addEventListener('click', onClick);

  // Selección
  function onSelectionChange() {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return cb.onSelect(null);
    const range = sel.getRangeAt(0);
    const startTl = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement)?.closest('.textLayer');
    const endTl = (range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement)?.closest('.textLayer');
    if (!startTl || !scroller.contains(startTl)) return cb.onSelect(null);
    const pageEl = startTl.closest('.pdf-page');
    let start = offsetWithin(startTl, range.startContainer, range.startOffset);
    let end;
    if (endTl === startTl) end = offsetWithin(startTl, range.endContainer, range.endOffset);
    else end = startTl.textContent.length; // si cruza de página, se queda en la primera
    const text = rangeFromOffsets(startTl, start, end)?.toString().trim();
    if (!text || end <= start) return cb.onSelect(null);
    cb.onSelect({ anchor: { page: Number(pageEl.dataset.page), start, end }, text });
  }
  document.addEventListener('selectionchange', onSelectionChange);

  // Página actual y progreso
  const persist = debounce((patch) => updateBook(rec.id, patch), 800);
  function onScroll() {
    const mid = scroller.scrollTop + scroller.clientHeight / 3;
    let n = 1;
    for (const p of pages) { if (p.el.offsetTop <= mid) n = p.n; else break; }
    if (n !== current) {
      current = n;
      persist({ location: { page: n }, progress: total > 1 ? (n - 1) / (total - 1) : 1, lastReadAt: Date.now() });
    }
    cb.onProgress(`${n} / ${total}`);
  }
  scroller.addEventListener('scroll', onScroll, { passive: true });

  function goPage(n) {
    const p = pages[Math.min(total, Math.max(1, n)) - 1];
    scroller.scrollTop = p.el.offsetTop - 8;
    onScroll();
  }

  const onResize = debounce(() => { const n = current; layout(); goPage(n); }, 300);
  window.addEventListener('resize', onResize);

  layout();
  goPage(cb.target?.page || rec.location?.page || 1);
  cb.onProgress(`${current} / ${total}`);
  updateBook(rec.id, { lastReadAt: Date.now() });

  return {
    next: () => goPage(current + 1),
    prev: () => goPage(current - 1),
    add: (h) => repaintPage(h.page),
    remove: (h) => repaintPage(h.page),
    update: (h) => repaintPage(h.page),
    goTo: (h) => goPage(h.page),
    toc: null,
    clearSelection: () => document.getSelection()?.removeAllRanges(),
    zoom(delta) {
      zoom = Math.min(3, Math.max(0.6, Math.round((zoom + delta * 0.2) * 10) / 10));
      const n = current;
      layout();
      goPage(n);
      return Math.round(zoom * 100);
    },
    get zoomValue() { return zoom; },
    destroy() {
      persist.flush();
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
      doc.destroy();
    },
  };
}
