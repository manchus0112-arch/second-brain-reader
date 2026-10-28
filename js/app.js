// Arranque y navegación de la app.
import { libraryView, bookView } from './views/library.js';
import { readerView } from './views/reader.js';
import { notesView, noteView, tagView, goView } from './views/notes.js';
import { searchView } from './views/search.js';
import { graphView } from './views/graph.js';
import { moreView } from './views/more.js';
import { requestPersistence } from './db.js';
import { esc } from './util.js';

const routes = [
  [/^#\/?$/, libraryView, 'library'],
  [/^#\/book\/([^/]+)$/, bookView, 'library'],
  [/^#\/read\/([^/]+)(?:\/([^/]+))?$/, readerView, 'library'],
  [/^#\/notes(?:\/(notes|highlights|tags))?$/, notesView, 'notes'],
  [/^#\/note\/([^/]+)(?:\/(edit))?$/, noteView, 'notes'],
  [/^#\/tag\/(.+)$/, tagView, 'notes'],
  [/^#\/go\/(.+)$/, goView, 'notes'],
  [/^#\/graph$/, graphView, 'graph'],
  [/^#\/search$/, searchView, 'search'],
  [/^#\/more$/, moreView, 'more'],
];

const view = document.getElementById('view');
let cleanup = null;
let seq = 0;

async function render() {
  const mine = ++seq;
  try { await cleanup?.(); } catch (e) { console.warn(e); }
  cleanup = null;
  const hash = location.hash || '#/';
  const match = routes.find(([re]) => re.test(hash));
  if (!match) { location.replace('#/'); return; }
  const [re, fn, tab] = match;
  const args = hash.match(re).slice(1).map((a) => (a == null ? undefined : decodeURIComponent(a)));
  document.querySelectorAll('#tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  view.innerHTML = '';
  view.scrollTop = 0;
  window.scrollTo(0, 0);
  try {
    const c = await fn(view, ...args);
    if (mine === seq) cleanup = c || null;
    else c?.();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty"><p>Algo falló al abrir esta pantalla.</p><p class="muted small">${esc(e.message || e)}</p></div>`;
  }
}

window.addEventListener('hashchange', render);

// Deslizar desde el borde izquierdo para volver, como en iOS.
let edge = null;
document.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  edge = !document.body.classList.contains('reading') && t.clientX < 24 && location.hash.split('/').length > 2 ? { x: t.clientX, y: t.clientY } : null;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!edge) return;
  const t = e.changedTouches[0];
  if (t.clientX - edge.x > 70 && Math.abs(t.clientY - edge.y) < 60) history.back();
  edge = null;
}, { passive: true });
render();
requestPersistence();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('sw', e));
}
