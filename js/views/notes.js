// El "cerebro": conceptos que se arman solos a partir de lo que subrayas.
import { esc, icons, fmtDate, snippet, debounce, confirmSheet, askText, toast, allTags, norm, COLORS, QUICK_TAGS, navBar, bindNav, autoLink } from '../util.js';
import { db, saveNote, saveHighlight, backlinks, tagIndex, getOrCreateNote, findNoteByTitle } from '../db.js';
import { renderMarkdown } from '../markdown.js';
import { Brain, conceptsOf, fold } from '../brain.js';

const TABS = [['notes', 'Conceptos'], ['highlights', 'Subrayados'], ['tags', 'Etiquetas']];
let lastTab = 'notes';

const plain = (md) => String(md ?? '').replace(/^>\s?/gm, '').replace(/[*`#[\]]/g, '');

export function noteCard(n, count) {
  const tags = allTags(n);
  return `<a class="card note-card" href="#/note/${n.id}">
    <div class="row between"><div class="title">${esc(n.title || 'Sin título')}</div>${count ? `<span class="badge">${count}</span>` : ''}</div>
    ${n.body ? `<div class="muted small">${esc(snippet(plain(n.body), 120))}</div>` : ''}
    ${tags.length ? `<div class="row small">${tags.slice(0, 4).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>` : ''}
  </a>`;
}

export function highlightCard(h, book) {
  const tags = allTags(h);
  return `<a class="card hl-card" href="#/read/${h.bookId}/${h.id}">
    <div class="hl-text" style="--hl:${COLORS[h.color] || COLORS.yellow}">${esc(snippet(h.text, 220))}</div>
    ${h.note ? `<div class="small">${esc(snippet(plain(h.note), 140))}</div>` : ''}
    <div class="row small"><span class="muted">${esc(book?.title || '')}${h.page ? ` · pág. ${h.page}` : ''}</span>${tags.slice(0, 3).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
  </a>`;
}

async function newConcept(prefill = '') {
  const title = await askText('Nuevo concepto', prefill, { placeholder: 'Por ejemplo: memoria de trabajo', ok: 'Crear' });
  if (!title) return null;
  const existing = await findNoteByTitle(title);
  return existing || saveNote({ title: title.charAt(0).toUpperCase() + title.slice(1), body: '' });
}

export async function notesView(root, tab = lastTab) {
  lastTab = tab;
  root.innerHTML = `
    ${navBar({ title: 'Cerebro', actions: `<button class="nav-btn" data-new aria-label="Nuevo concepto">${icons.plus}</button>` })}
    <div class="searchfield">${icons.search}<input type="search" placeholder="Buscar" aria-label="Buscar en el cerebro" autocomplete="off"></div>
    <div class="segmented">${TABS.map(([k, l]) => `<a href="#/notes/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div class="results"></div>`;
  bindNav(root);

  root.querySelector('[data-new]').onclick = async () => {
    const n = await newConcept();
    if (n) location.hash = `#/note/${n.id}`;
  };

  const results = root.querySelector('.results');
  const filter = root.querySelector('input');
  const [notes, hls, books] = await Promise.all([db.all('notes'), db.all('highlights'), db.all('books')]);
  const bookById = new Map(books.map((b) => [b.id, b]));
  const brain = new Brain(notes, hls);
  const counts = new Map(notes.map((n) => [n.id, [...hls, ...notes].filter((x) => x.id !== n.id && conceptsOf(x, [n]).length).length]));
  const tags = tab === 'tags' ? await tagIndex() : [];
  const research = hls.filter((h) => allTags(h).includes('research')).length + notes.filter((n) => allTags(n).includes('research')).length;
  const topics = brain.topics(10);

  function draw() {
    const q = fold(filter.value);
    const match = (...fields) => !q || fields.some((f) => fold(f).includes(q));
    if (tab === 'notes') {
      const list = notes.filter((n) => match(n.title, n.body, allTags(n).join(' ')))
        .sort((a, b) => (counts.get(b.id) - counts.get(a.id)) || b.updatedAt - a.updatedAt);
      results.innerHTML = `
        ${!q && research ? `<a class="card row-card" href="#/tag/research"><span class="row-icon">${icons.search}</span><div><div class="title">Por investigar</div><div class="muted small">${research} marcado${research > 1 ? 's' : ''} con #research</div></div>${icons.right}</a>` : ''}
        ${!q && topics.length ? `<h2 class="section">Temas que se repiten</h2>
          <p class="muted small hint">Aparecen en varios de tus subrayados. Toca uno para convertirlo en concepto: reunirá solo todo lo que hayas subrayado sobre él.</p>
          <div class="chips scroll" data-topics>${topics.map((t) => `<button class="chip suggest" data-topic="${esc(t.title)}">+ ${esc(t.title)} <span class="muted">${t.count}</span></button>`).join('')}</div>` : ''}
        ${list.length ? `<h2 class="section">Tus conceptos <span class="muted">${list.length}</span></h2>${list.map((n) => noteCard(n, counts.get(n.id))).join('')}`
          : `<div class="empty"><div class="empty-art">${icons.bulb}</div><h2>${q ? 'Nada coincide' : 'Tu cerebro se arma solo'}</h2>${q ? '' : '<p class="muted">Mientras lees, subraya. Los temas que se repiten aparecerán aquí y con un toque se convierten en conceptos que reúnen todo lo que has leído sobre ellos.</p>'}</div>`}`;
      results.querySelector('[data-topics]')?.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-topic]');
        if (!b) return;
        const n = await getOrCreateNote(b.dataset.topic);
        toast(`Concepto «${n.title}» creado`, { label: 'Abrir', run: () => { location.hash = `#/note/${n.id}`; } });
        notesView(root, tab);
      });
    } else if (tab === 'highlights') {
      const list = hls.filter((h) => match(h.text, h.note, allTags(h).join(' '), bookById.get(h.bookId)?.title)).sort((a, b) => b.createdAt - a.createdAt);
      results.innerHTML = list.length ? list.map((h) => highlightCard(h, bookById.get(h.bookId))).join('')
        : `<div class="empty"><p class="muted">${q ? 'Nada coincide.' : 'Aún no has subrayado nada.'}</p></div>`;
    } else {
      const list = tags.filter(([t]) => match(t));
      results.innerHTML = list.length ? `<div class="group">${list.map(([t, c]) => `<a class="group-row" href="#/tag/${encodeURIComponent(t)}"><span>#${esc(t)}</span><span class="muted">${c}</span>${icons.right}</a>`).join('')}</div>`
        : '<div class="empty"><p class="muted">Sin etiquetas todavía. Al subrayar puedes marcar #idea, #pregunta o #research con un toque.</p></div>';
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
    ${navBar({ title: `#${tag}`, back: { href: '#/notes/tags', label: 'Cerebro' } })}
    ${ns.length ? `<h2 class="section">Conceptos <span class="muted">${ns.length}</span></h2>${ns.map((n) => noteCard(n)).join('')}` : ''}
    ${hs.length ? `<h2 class="section">Subrayados <span class="muted">${hs.length}</span></h2>${hs.map((h) => highlightCard(h, bookById.get(h.bookId))).join('')}` : ''}
    ${!ns.length && !hs.length ? '<p class="muted">Nada con esta etiqueta.</p>' : ''}`;
  bindNav(root);
}

// [[Título]] → abre la nota, o la crea si no existe.
export async function goView(root, title) {
  const n = await getOrCreateNote(title);
  location.replace(`#/note/${n.id}`);
}

export async function noteView(root, id, mode) {
  const note = await db.get('notes', id);
  if (!note) { location.hash = '#/notes'; return; }
  let editing = mode === 'edit';
  let originalTitle = note.title;
  const [books, allNotes, allHls] = await Promise.all([db.all('books'), db.all('notes'), db.all('highlights')]);
  const bookById = new Map(books.map((b) => [b.id, b]));

  root.innerHTML = `
    ${navBar({ title: note.title, back: { href: '#/notes', label: 'Cerebro' }, large: false, actions: `<button class="nav-btn text" data-toggle></button><button class="nav-btn" data-delete aria-label="Eliminar">${icons.trash}</button>` })}
    <article class="note">
      <input class="note-title large-title" value="${esc(note.title)}" placeholder="Título" aria-label="Nombre del concepto">
      <div class="note-meta muted small"></div>
      <textarea class="note-body input" aria-label="Tus ideas sobre este concepto" placeholder="Tus ideas sobre este concepto… (opcional: lo que subrayes sobre él aparece abajo solo)"></textarea>
      <div class="note-rendered md"></div>
      <div class="chips" data-tags></div>
    </article>
    <section class="backlinks"></section>`;
  bindNav(root);

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
      + '<button type="button" class="chip add" data-addtag>+ etiqueta</button>';
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
    save.flush();
    saveNote(note);
  };

  function drawMode() {
    bodyEl.hidden = !editing;
    rendered.hidden = editing;
    titleEl.readOnly = !editing;
    tagsEl.hidden = !editing && !(note.tags || []).length;
    toggle.textContent = editing ? 'Listo' : 'Editar';
    if (!editing) {
      rendered.innerHTML = note.body ? renderMarkdown(note.body) : '';
      autoLink(rendered, allNotes, note.id);
    } else {
      autoGrow();
    }
  }
  function autoGrow() { bodyEl.style.height = 'auto'; bodyEl.style.height = `${Math.max(160, bodyEl.scrollHeight + 4)}px`; }

  bodyEl.oninput = () => { note.body = bodyEl.value; autoGrow(); save(); };
  titleEl.oninput = () => { note.title = titleEl.value.trim() || 'Sin título'; save(); };
  titleEl.onchange = () => renameLinks();
  toggle.onclick = () => { save.flush(); editing = !editing; drawMode(); if (!editing) drawBacklinks(); };

  // Si cambia el título, actualiza las conexiones que apuntaban al antiguo.
  async function renameLinks() {
    const from = originalTitle;
    const to = note.title;
    if (norm(from) === norm(to)) return;
    const clash = await findNoteByTitle(to);
    if (clash && clash.id !== note.id) { toast('Ya existe un concepto con ese nombre'); return; }
    const re = new RegExp(`\\[\\[\\s*${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\]\\]`, 'gi');
    for (const n of await db.all('notes')) {
      if (n.id !== note.id && re.test(n.body)) { n.body = n.body.replace(re, `[[${to}]]`); await saveNote(n); }
      re.lastIndex = 0;
    }
    for (const h of await db.all('highlights')) {
      const inLinks = (h.links || []).some((l) => norm(l) === norm(from));
      if (re.test(h.note) || inLinks) {
        h.note = h.note.replace(re, `[[${to}]]`);
        h.links = (h.links || []).map((l) => (norm(l) === norm(from) ? to : l));
        await saveHighlight(h);
      }
      re.lastIndex = 0;
    }
    originalTitle = to;
  }

  async function drawBacklinks() {
    const bl = await backlinks(note);
    const brain = new Brain(allNotes, allHls);
    const sec = root.querySelector('.backlinks');
    const meta = root.querySelector('.note-meta');
    const nBooks = new Set(bl.highlights.map((h) => h.bookId)).size;
    meta.textContent = bl.highlights.length
      ? `${bl.highlights.length} subrayado${bl.highlights.length > 1 ? 's' : ''} en ${nBooks} libro${nBooks > 1 ? 's' : ''}`
      : `Creado ${fmtDate(note.createdAt)}`;

    // Subrayados agrupados por libro
    const byBook = new Map();
    for (const h of bl.highlights.sort((a, b) => (a.page || 0) - (b.page || 0) || a.createdAt - b.createdAt)) {
      if (!byBook.has(h.bookId)) byBook.set(h.bookId, []);
      byBook.get(h.bookId).push(h);
    }
    // Conceptos que aparecen junto a este en los mismos subrayados
    const co = new Map();
    const bump = (c) => { if (c.id !== note.id) co.set(c.id, { n: c, k: (co.get(c.id)?.k || 0) + 1 }); };
    for (const h of bl.highlights) conceptsOf(h, allNotes).forEach(bump);
    conceptsOf({ id: note.id, body: note.body }, allNotes).forEach(bump);
    const coList = [...co.values()].sort((a, b) => b.k - a.k).map((x) => x.n);
    const shown = new Set([...bl.highlights.map((h) => h.id), ...bl.notes.map((n) => n.id), ...coList.map((n) => n.id)]);
    const related = brain.related({ ...note, text: bl.highlights.map((h) => h.text).join(' ') }, 8).filter((r) => !shown.has(r.id)).slice(0, 4);

    sec.innerHTML = `
      ${coList.length ? `<h2 class="section">Conectado con</h2><div class="chips">${coList.map((c) => `<a class="chip concept on" href="#/note/${c.id}">${esc(c.title)}</a>`).join('')}</div>` : ''}
      ${byBook.size ? [...byBook.entries()].map(([bookId, list]) => `
        <h2 class="section book-head"><a href="#/book/${bookId}">${esc(bookById.get(bookId)?.title || 'Libro')}</a> <span class="muted">${list.length}</span></h2>
        ${list.map((h) => `<a class="card quote-card" href="#/read/${h.bookId}/${h.id}" style="--hl:${COLORS[h.color] || COLORS.yellow}">
          <div class="q">${esc(h.text)}</div>${h.note ? `<div class="small">${esc(snippet(plain(h.note), 160))}</div>` : ''}</a>`).join('')}`).join('')
        : `<div class="card callout small">Todavía no hay subrayados sobre «${esc(note.title)}». Cuando subrayes un texto que lo mencione, aparecerá aquí solo.</div>`}
      ${bl.notes.length ? `<h2 class="section">Lo mencionan</h2>${bl.notes.map((n) => noteCard(n)).join('')}` : ''}
      ${related.length ? `<h2 class="section">Quizás tenga que ver</h2>${related.map((r) => `<div class="card suggest-card">
          ${r.text ? `<a class="q" href="#/read/${r.bookId}/${r.id}" style="--hl:${COLORS[r.color] || COLORS.yellow}">${esc(snippet(r.text, 200))}</a><div class="row small"><span class="muted">${esc(bookById.get(r.bookId)?.title || '')}</span><span class="spacer"></span><button class="link" data-attach="${r.id}">+ Conectar</button></div>`
            : `<a class="title" href="#/note/${r.id}">${esc(r.title)}</a>`}
        </div>`).join('')}` : ''}`;

    sec.querySelectorAll('[data-attach]').forEach((b) => {
      b.onclick = async () => {
        const h = allHls.find((x) => x.id === b.dataset.attach);
        h.links = [...new Set([...(h.links || []), note.title])];
        await saveHighlight(h);
        toast('Conectado');
        drawBacklinks();
      };
    });
  }

  root.querySelector('[data-delete]').onclick = async () => {
    if (!(await confirmSheet('¿Eliminar concepto?', `«${note.title}» se borrará. Tus subrayados se conservan.`))) return;
    save.flush();
    await db.del('notes', note.id);
    toast('Concepto eliminado');
    location.hash = '#/notes';
  };

  drawTags();
  drawMode();
  drawBacklinks();
  if (editing && !note.body) setTimeout(() => bodyEl.focus(), 100);

  return () => { save.flush(); if (norm(originalTitle) !== norm(note.title)) renameLinks(); };
}
