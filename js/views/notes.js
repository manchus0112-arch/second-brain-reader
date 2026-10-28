// Notas, subrayados y etiquetas: el "second brain".
import { esc, icons, fmtDate, snippet, debounce, confirmSheet, askText, toast, allTags, parseLinks, norm, COLORS, QUICK_TAGS } from '../util.js';
import { db, saveNote, saveHighlight, backlinks, tagIndex, getOrCreateNote, findNoteByTitle } from '../db.js';
import { renderMarkdown } from '../markdown.js';

const TABS = [['notes', 'Notas'], ['highlights', 'Subrayados'], ['tags', 'Etiquetas']];
let lastTab = 'notes';

export function noteCard(n) {
  const tags = allTags(n);
  return `<a class="card note-card" href="#/note/${n.id}">
    <div class="title">${esc(n.title || 'Sin título')}</div>
    ${n.body ? `<div class="muted small">${esc(snippet(n.body.replace(/^>\s?/gm, '').replace(/[*`]/g, ''), 120))}</div>` : ''}
    <div class="row small"><span class="muted">${fmtDate(n.updatedAt)}</span>${tags.slice(0, 4).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
  </a>`;
}

export function highlightCard(h, book) {
  const tags = allTags(h);
  return `<a class="card hl-card" href="#/read/${h.bookId}/${h.id}">
    <div class="hl-text" style="--hl:${COLORS[h.color] || COLORS.yellow}">${esc(snippet(h.text, 220))}</div>
    ${h.note ? `<div class="small">${esc(snippet(h.note, 140))}</div>` : ''}
    <div class="row small"><span class="muted">${esc(book?.title || '')}</span>${tags.slice(0, 4).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
  </a>`;
}

export async function notesView(root, tab = lastTab) {
  lastTab = tab;
  root.innerHTML = `
    <header class="page-head"><h1>Second brain</h1><button class="btn primary" data-new>${icons.plus}<span>Nota</span></button></header>
    <div class="segmented">${TABS.map(([k, l]) => `<a href="#/notes/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
    <input class="input filter" type="search" placeholder="Filtrar…">
    <div class="results"></div>`;

  root.querySelector('[data-new]').onclick = async () => {
    const title = await askText('Nueva nota', '', { placeholder: 'Título o concepto', ok: 'Crear' });
    if (!title) return;
    const existing = await findNoteByTitle(title);
    const n = existing || (await saveNote({ title, body: '' }));
    location.hash = `#/note/${n.id}${existing ? '' : '/edit'}`;
  };

  const results = root.querySelector('.results');
  const filter = root.querySelector('.filter');
  const [notes, hls, books] = await Promise.all([db.all('notes'), db.all('highlights'), db.all('books')]);
  const bookById = new Map(books.map((b) => [b.id, b]));
  const tags = tab === 'tags' ? await tagIndex() : [];

  function draw() {
    const q = norm(filter.value);
    const match = (...fields) => !q || fields.some((f) => norm(f).includes(q));
    if (tab === 'notes') {
      const list = notes.filter((n) => match(n.title, n.body, allTags(n).join(' '))).sort((a, b) => b.updatedAt - a.updatedAt);
      results.innerHTML = list.length ? list.map(noteCard).join('')
        : `<div class="empty"><p class="muted">${q ? 'Nada coincide.' : 'Todavía no hay notas. Crea una con el botón +, o al leer selecciona texto y toca «Concepto».'}</p></div>`;
    } else if (tab === 'highlights') {
      const list = hls.filter((h) => match(h.text, h.note, allTags(h).join(' '), bookById.get(h.bookId)?.title)).sort((a, b) => b.createdAt - a.createdAt);
      results.innerHTML = list.length ? list.map((h) => highlightCard(h, bookById.get(h.bookId))).join('')
        : `<div class="empty"><p class="muted">${q ? 'Nada coincide.' : 'Aún no has subrayado nada.'}</p></div>`;
    } else {
      const list = tags.filter(([t]) => match(t));
      results.innerHTML = list.length ? `<div class="chips big">${list.map(([t, c]) => `<a class="chip" href="#/tag/${encodeURIComponent(t)}">#${esc(t)} <span class="muted">${c}</span></a>`).join('')}</div>`
        : '<div class="empty"><p class="muted">Sin etiquetas. Escribe #algo en una nota o usa las etiquetas rápidas al subrayar.</p></div>';
    }
  }
  filter.oninput = draw;
  draw();
}

export async function tagView(root, tag) {
  const [notes, hls, books] = await Promise.all([db.all('notes'), db.all('highlights'), db.all('books')]);
  const bookById = new Map(books.map((b) => [b.id, b]));
  const ns = notes.filter((n) => allTags(n).includes(tag)).sort((a, b) => b.updatedAt - a.updatedAt);
  const hs = hls.filter((h) => allTags(h).includes(tag)).sort((a, b) => b.createdAt - a.createdAt);
  root.innerHTML = `
    <header class="page-head"><a class="icon-btn" href="#/notes/tags">${icons.back}</a><h1>#${esc(tag)}</h1></header>
    ${ns.length ? `<h2 class="section">Notas <span class="muted">${ns.length}</span></h2>${ns.map(noteCard).join('')}` : ''}
    ${hs.length ? `<h2 class="section">Subrayados <span class="muted">${hs.length}</span></h2>${hs.map((h) => highlightCard(h, bookById.get(h.bookId))).join('')}` : ''}
    ${!ns.length && !hs.length ? '<p class="muted">Nada con esta etiqueta.</p>' : ''}`;
}

// [[Título]] → abre la nota, o la crea si no existe.
export async function goView(root, title) {
  const n = await getOrCreateNote(title);
  location.replace(`#/note/${n.id}`);
}

export async function noteView(root, id, mode) {
  const note = await db.get('notes', id);
  if (!note) { location.hash = '#/notes'; return; }
  let editing = mode === 'edit' || !note.body;
  let originalTitle = note.title;
  const books = new Map((await db.all('books')).map((b) => [b.id, b]));

  root.innerHTML = `
    <header class="page-head">
      <a class="icon-btn" href="#/notes" aria-label="Volver">${icons.back}</a>
      <span class="spacer"></span>
      <button class="icon-btn" data-toggle aria-label="Editar o ver"></button>
      <button class="icon-btn" data-delete aria-label="Eliminar">${icons.trash}</button>
    </header>
    <article class="note">
      <input class="note-title" value="${esc(note.title)}" placeholder="Título">
      <div class="chips" data-tags></div>
      <textarea class="note-body input" placeholder="Escribe… Usa [[otro concepto]] para enlazar notas y #tag para etiquetar."></textarea>
      <div class="note-rendered md"></div>
      <p class="muted small">Creada ${fmtDate(note.createdAt)} · editada ${fmtDate(note.updatedAt)}</p>
    </article>
    <section class="backlinks"></section>`;

  const titleEl = root.querySelector('.note-title');
  const bodyEl = root.querySelector('.note-body');
  const rendered = root.querySelector('.note-rendered');
  const toggle = root.querySelector('[data-toggle]');
  const tagsEl = root.querySelector('[data-tags]');
  bodyEl.value = note.body || '';

  const save = debounce(() => saveNote(note), 500);

  function drawTags() {
    const all = [...new Set([...QUICK_TAGS, ...(note.tags || [])])];
    tagsEl.innerHTML = all.map((t) => `<button type="button" class="chip ${note.tags?.includes(t) ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')
      + '<button type="button" class="chip add" data-addtag>+ tag</button>';
  }
  tagsEl.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    note.tags ||= [];
    if (b.hasAttribute('data-addtag')) {
      const t = await askText('Nueva etiqueta', '', { placeholder: 'por ejemplo: filosofía' });
      if (!t) return;
      const tag = t.replace(/^#/, '').trim().toLowerCase().replace(/\s+/g, '-');
      if (!note.tags.includes(tag)) note.tags.push(tag);
    } else {
      const i = note.tags.indexOf(b.dataset.tag);
      i >= 0 ? note.tags.splice(i, 1) : note.tags.push(b.dataset.tag);
    }
    drawTags();
    save.flush(); saveNote(note);
  };

  function drawMode() {
    bodyEl.hidden = !editing;
    rendered.hidden = editing;
    titleEl.readOnly = !editing;
    toggle.innerHTML = editing ? icons.eye : icons.edit;
    if (!editing) rendered.innerHTML = note.body ? renderMarkdown(note.body) : '<p class="muted">Nota vacía. Toca el lápiz para escribir.</p>';
    if (editing) autoGrow();
  }
  function autoGrow() { bodyEl.style.height = 'auto'; bodyEl.style.height = `${Math.max(220, bodyEl.scrollHeight + 4)}px`; }

  bodyEl.oninput = () => { note.body = bodyEl.value; autoGrow(); save(); };
  titleEl.oninput = () => { note.title = titleEl.value.trim() || 'Sin título'; save(); };
  titleEl.onchange = () => renameLinks();
  toggle.onclick = () => { save.flush(); editing = !editing; drawMode(); drawBacklinks(); };

  // Si cambia el título, actualiza los [[enlaces]] que apuntaban al antiguo.
  async function renameLinks() {
    const from = originalTitle;
    const to = note.title;
    if (norm(from) === norm(to)) return;
    const clash = await findNoteByTitle(to);
    if (clash && clash.id !== note.id) { toast('Ya existe una nota con ese título'); return; }
    const re = new RegExp(`\\[\\[\\s*${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\]\\]`, 'gi');
    let changed = 0;
    for (const n of await db.all('notes')) {
      if (n.id !== note.id && re.test(n.body)) { n.body = n.body.replace(re, `[[${to}]]`); await saveNote(n); changed++; }
      re.lastIndex = 0;
    }
    for (const h of await db.all('highlights')) {
      if (re.test(h.note)) { h.note = h.note.replace(re, `[[${to}]]`); await saveHighlight(h); changed++; }
      re.lastIndex = 0;
    }
    originalTitle = to;
    if (changed) toast(`Enlaces actualizados en ${changed} sitio${changed > 1 ? 's' : ''}`);
  }

  async function drawBacklinks() {
    const bl = await backlinks(note.title);
    const outgoing = parseLinks(note.body);
    const sec = root.querySelector('.backlinks');
    sec.innerHTML = `
      ${outgoing.length ? `<h2 class="section">Enlaza a</h2><div class="chips">${outgoing.map((t) => `<a class="chip" href="#/go/${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>` : ''}
      <h2 class="section">Enlazado desde <span class="muted">${bl.notes.length + bl.highlights.length}</span></h2>
      ${bl.notes.map(noteCard).join('')}
      ${bl.highlights.map((h) => highlightCard(h, books.get(h.bookId))).join('')}
      ${!bl.notes.length && !bl.highlights.length ? '<p class="muted small">Nada enlaza aquí todavía. Escribe [[' + esc(note.title) + ']] en otra nota o subrayado.</p>' : ''}`;
  }

  root.querySelector('[data-delete]').onclick = async () => {
    if (!(await confirmSheet('¿Eliminar nota?', `«${note.title}» se borrará. Los enlaces que apuntan a ella quedarán sin nota.`))) return;
    save.flush();
    await db.del('notes', note.id);
    toast('Nota eliminada');
    location.hash = '#/notes';
  };

  drawTags();
  drawMode();
  drawBacklinks();
  if (editing && !note.body) setTimeout(() => bodyEl.focus(), 100);

  return () => { save.flush(); if (norm(originalTitle) !== norm(note.title)) renameLinks(); };
}
