// Grafo del second brain: notas y libros conectados por [[enlaces]].
import { parseLinks, norm, snippet, navBar, bindNav } from '../util.js';
import { conceptsOf } from '../brain.js';
import { db } from '../db.js';

async function buildGraph() {
  const [notes, hls, books] = await Promise.all([db.all('notes'), db.all('highlights'), db.all('books')]);
  const nodes = new Map();
  const edges = new Map();
  const byTitle = new Map(notes.map((n) => [norm(n.title), n]));
  const node = (id, props) => { if (!nodes.has(id)) nodes.set(id, { id, deg: 0, ...props }); return nodes.get(id); };
  const link = (a, b) => {
    if (a === b) return;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!edges.has(k)) { edges.set(k, { a, b }); nodes.get(a).deg++; nodes.get(b).deg++; }
  };
  const target = (title) => {
    const n = byTitle.get(norm(title));
    return n ? `n:${n.id}` : node(`g:${norm(title)}`, { kind: 'ghost', label: title, href: `#/go/${encodeURIComponent(title)}` }).id;
  };
  for (const n of notes) node(`n:${n.id}`, { kind: 'note', label: n.title, href: `#/note/${n.id}` });
  const bookIds = new Set(hls.map((h) => h.bookId));
  for (const b of books) if (bookIds.has(b.id)) node(`b:${b.id}`, { kind: 'book', label: b.title, href: `#/book/${b.id}` });
  for (const n of notes) {
    for (const c of conceptsOf(n, notes)) link(`n:${n.id}`, `n:${c.id}`);
    for (const t of parseLinks(n.body)) link(`n:${n.id}`, target(t));
    for (const ref of n.refs || []) {
      const h = hls.find((x) => x.id === ref);
      if (h && nodes.has(`b:${h.bookId}`)) link(`n:${n.id}`, `b:${h.bookId}`);
    }
  }
  for (const h of hls) {
    if (!nodes.has(`b:${h.bookId}`)) continue;
    for (const c of conceptsOf(h, notes)) link(`b:${h.bookId}`, `n:${c.id}`);
    for (const t of parseLinks(h.note)) link(`b:${h.bookId}`, target(t));
  }
  // los libros sin conexiones no aportan nada al grafo
  for (const [id, n] of nodes) if (n.kind === 'book' && !n.deg) nodes.delete(id);
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export async function graphView(root) {
  const { nodes, edges } = await buildGraph();
  root.innerHTML = `
    ${navBar({ title: 'Grafo' })}
    <p class="muted small subtitle">${nodes.length} conceptos y libros · ${edges.length} conexiones</p>
    ${nodes.length ? '<div class="graph-wrap"><canvas></canvas><div class="graph-legend small"><span class="lg note"></span>Nota <span class="lg book"></span>Libro <span class="lg ghost"></span>Por crear</div></div>'
      : '<div class="empty"><p class="muted">Aquí verás cómo se conectan tus ideas. Subraya mientras lees y convierte en concepto los temas que se repiten: las conexiones aparecen solas.</p></div>'}`;
  bindNav(root);
  if (!nodes.length) return;

  const wrap = root.querySelector('.graph-wrap');
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const color = (v) => css.getPropertyValue(v).trim();
  const theme = { note: color('--accent'), book: color('--book'), ghost: color('--muted'), edge: color('--line'), text: color('--text'), bg: color('--bg') };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = edges.map((e) => ({ a: byId.get(e.a), b: byId.get(e.b) }));
  nodes.forEach((n, i) => {
    const ang = i * 2.399963;
    const r = 30 * Math.sqrt(i + 1);
    Object.assign(n, { x: Math.cos(ang) * r, y: Math.sin(ang) * r, vx: 0, vy: 0, r: 5 + Math.sqrt(n.deg) * 2.5 });
  });

  let W = 0;
  let H = 0;
  const dpr = window.devicePixelRatio || 1;
  const view = { x: 0, y: 0, k: 1 };
  function resize() {
    W = wrap.clientWidth;
    H = wrap.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
  }
  resize();

  let alpha = 1;
  function tick() {
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        const f = (900 * alpha) / d2;
        const d = Math.sqrt(d2);
        a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
        b.vx += (dx / d) * f; b.vy += (dy / d) * f;
      }
    }
    for (const { a, b } of links) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 70) * 0.04 * alpha;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const p of nodes) {
      p.vx -= p.x * 0.01 * alpha;
      p.vy -= p.y * 0.01 * alpha;
      if (p === dragging) continue;
      p.vx *= 0.6; p.vy *= 0.6;
      p.x += p.vx; p.y += p.vy;
    }
    alpha = Math.max(0.02, alpha * 0.985);
  }

  const toScreen = (p) => [(p.x * view.k) + view.x + W / 2, (p.y * view.k) + view.y + H / 2];
  const toWorld = (sx, sy) => [(sx - W / 2 - view.x) / view.k, (sy - H / 2 - view.y) / view.k];

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = theme.edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const { a, b } of links) {
      const [x1, y1] = toScreen(a);
      const [x2, y2] = toScreen(b);
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    ctx.font = '12px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const p of nodes) {
      const [x, y] = toScreen(p);
      if (x < -50 || y < -50 || x > W + 50 || y > H + 50) continue;
      const r = p.r * Math.sqrt(view.k);
      ctx.fillStyle = theme[p.kind];
      ctx.globalAlpha = p.kind === 'ghost' ? 0.5 : 1;
      if (p.kind === 'book') ctx.fillRect(x - r, y - r, r * 2, r * 2);
      else { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      if (view.k > 0.7 || p.deg >= 3 || p === hover) {
        ctx.fillStyle = theme.text;
        ctx.fillText(snippet(p.label, 28), x, y + r + 13);
      }
    }
  }

  let raf;
  let ticks = 0;
  function loop() {
    if (ticks++ < 400 || dragging) tick();
    draw();
    raf = requestAnimationFrame(loop);
  }

  // Gestos: arrastrar fondo = mover, arrastrar nodo = mover nodo, pellizcar = zoom, tocar = abrir.
  const pointers = new Map();
  let dragging = null;
  let hover = null;
  let moved = 0;
  let pinch = null;
  const pick = (sx, sy) => {
    const [wx, wy] = toWorld(sx, sy);
    let best = null;
    let bestD = Infinity;
    for (const p of nodes) {
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < bestD && d < (p.r + 12) / view.k) { best = p; bestD = d; }
    }
    return best;
  };
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    moved = 0;
    if (pointers.size === 1) {
      dragging = pick(...local(e));
      hover = dragging;
    } else if (pointers.size === 2) {
      dragging = null;
      const [p1, p2] = [...pointers.values()];
      pinch = { d: Math.hypot(p1[0] - p2[0], p1[1] - p2[1]), k: view.k };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const cur = local(e);
    pointers.set(e.pointerId, cur);
    moved += Math.abs(cur[0] - prev[0]) + Math.abs(cur[1] - prev[1]);
    if (pointers.size === 2 && pinch) {
      const [p1, p2] = [...pointers.values()];
      view.k = Math.min(4, Math.max(0.2, pinch.k * (Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) / pinch.d)));
    } else if (dragging) {
      [dragging.x, dragging.y] = toWorld(...cur);
      alpha = Math.max(alpha, 0.3);
      ticks = 0;
    } else {
      view.x += cur[0] - prev[0];
      view.y += cur[1] - prev[1];
    }
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (dragging && moved < 6) location.hash = dragging.href;
    dragging = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.k = Math.min(4, Math.max(0.2, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
  }, { passive: false });

  window.addEventListener('resize', resize);
  loop();
  return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
}

