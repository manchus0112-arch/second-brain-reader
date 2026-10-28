// Búsqueda en libros, notas y subrayados.
import { esc, icons, navBar, bindNav } from '../util.js';
import { fold } from '../brain.js';
import { db } from '../db.js';
import { noteCard, highlightCard } from './notes.js';
import { coverHtml } from './library.js';

let lastQuery = '';

export async function searchView(root) {
  root.innerHTML = `
    ${navBar({ title: 'Buscar' })}
    <div class="searchfield">${icons.search}<input type="search" placeholder="Libros, conceptos y subrayados" value="${esc(lastQuery)}" autocomplete="off"></div>
    <div class="results"></div>`;
  bindNav(root);
  const input = root.querySelector('input');
  const results = root.querySelector('.results');
  const [notes, hls, books] = await Promise.all([db.all('notes'), db.all('highlights'), db.all('books')]);
  const bookById = new Map(books.map((b) => [b.id, b]));

  function draw() {
    lastQuery = input.value;
    const words = fold(input.value).split(/\s+/).filter(Boolean);
    if (!words.length) { results.innerHTML = '<p class="muted">Escribe para buscar.</p>'; return; }
    const hit = (...fields) => { const s = fold(fields.join(' ')); return words.every((w) => s.includes(w)); };
    const bs = books.filter((b) => hit(b.title, b.author));
    const ns = notes.filter((n) => hit(n.title, n.body, (n.tags || []).join(' '))).sort((a, b) => b.updatedAt - a.updatedAt);
    const hs = hls.filter((h) => hit(h.text, h.note, (h.tags || []).join(' '))).sort((a, b) => b.createdAt - a.createdAt);
    results.innerHTML = `
      ${bs.length ? `<h2 class="section">Libros</h2>${bs.map((b) => `<a class="card book-row" href="#/book/${b.id}">${coverHtml(b)}<div><div class="title">${esc(b.title)}</div><div class="muted small">${esc(b.author || '')}</div></div></a>`).join('')}` : ''}
      ${ns.length ? `<h2 class="section">Conceptos <span class="muted">${ns.length}</span></h2>${ns.slice(0, 50).map((n) => noteCard(n)).join('')}` : ''}
      ${hs.length ? `<h2 class="section">Subrayados <span class="muted">${hs.length}</span></h2>${hs.slice(0, 50).map((h) => highlightCard(h, bookById.get(h.bookId))).join('')}` : ''}
      ${!bs.length && !ns.length && !hs.length ? '<p class="muted">Sin resultados.</p>' : ''}`;
  }
  input.oninput = draw;
  draw();
  if (!lastQuery) setTimeout(() => input.focus(), 50);
}
