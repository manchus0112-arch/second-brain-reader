// Hoja de un subrayado: nota, color, etiquetas y conceptos conectados.
// Los conceptos se sugieren solos; un toque basta para conectar o crear uno.
import { esc, sheet, toast, askText, confirmSheet, COLORS, QUICK_TAGS, snippet } from './util.js';
import { db, saveHighlight, getOrCreateNote } from './db.js';
import { Brain, conceptsOf, fold } from './brain.js';

function tagChips(selected) {
  const all = [...new Set([...QUICK_TAGS, ...selected])];
  return all.map((t) => `<button type="button" class="chip ${selected.includes(t) ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')
    + '<button type="button" class="chip add" data-addtag>+ etiqueta</button>';
}

export async function loadBrain() {
  const [notes, hls] = await Promise.all([db.all('notes'), db.all('highlights')]);
  return new Brain(notes, hls);
}

// Conecta un subrayado con un concepto (lo crea si no existe).
export async function linkConcept(h, title) {
  const note = await getOrCreateNote(title);
  h.links = [...new Set([...(h.links || []), note.title])];
  await saveHighlight(h);
  return note;
}

// Tras subrayar: avisa con qué conceptos quedó conectado solo.
export async function announceConnections(h) {
  const notes = await db.all('notes');
  const found = conceptsOf(h, notes);
  if (found.length) toast(`Conectado con ${found.slice(0, 2).map((n) => `«${n.title}»`).join(' y ')}${found.length > 2 ? ` y ${found.length - 2} más` : ''}`);
  return found;
}

// Abre la hoja de un subrayado. callbacks: onChange(h), onDelete(h), onGoto(h)
export function openHighlightSheet(h, book, { onChange, onDelete, onGoto, focusNote = false, focusConcepts = false } = {}) {
  const tags = [...(h.tags || [])];
  let color = h.color || 'yellow';
  let dirty = false;

  const s = sheet(`
    <blockquote class="quote" style="--hl:${COLORS[color]}">${esc(h.text)}</blockquote>
    <p class="muted small">${esc(book?.title || '')}${h.page ? ` · pág. ${h.page}` : ''}</p>
    <div class="sheet-label">Conceptos</div>
    <div class="chips concepts" data-concepts><span class="muted small">Buscando…</span></div>
    <div class="sheet-label">Tu nota</div>
    <textarea class="input note-input" rows="3" placeholder="¿Qué te hace pensar?">${esc(h.note || '')}</textarea>
    <div class="sheet-label">Color y etiquetas</div>
    <div class="row colors">${Object.entries(COLORS).map(([k, v]) => `<button type="button" class="swatch ${k === color ? 'on' : ''}" data-color="${k}" style="background:${v}" aria-label="${k}"></button>`).join('')}</div>
    <div class="chips" data-tags>${tagChips(tags)}</div>
    <div class="related" data-related></div>
    <div class="row wrap sheet-actions">
      ${onGoto ? '<button type="button" class="btn" data-goto>Ir al texto</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn plain danger-text" data-delete>Eliminar subrayado</button>
    </div>
  `, { onClose: () => save() });

  const el = s.el;
  const textarea = el.querySelector('textarea');
  if (focusNote) setTimeout(() => textarea.focus(), 300);
  textarea.oninput = () => { dirty = true; };

  async function save() {
    const note = textarea.value;
    if (!dirty && note === (h.note || '')) return;
    Object.assign(h, { note, tags: [...tags], color });
    await saveHighlight(h);
    onChange?.(h);
  }

  // Conceptos: conectados (rellenos) + sugeridos (con +)
  const conceptsEl = el.querySelector('[data-concepts]');
  async function drawConcepts() {
    const brain = await loadBrain();
    const linked = conceptsOf(h, brain.notes);
    const linkedKeys = new Set(linked.map((n) => fold(n.title)));
    const sugg = brain.suggest(`${h.text} ${textarea.value}`, 6).filter((x) => !linkedKeys.has(fold(x.title)));
    conceptsEl.innerHTML = linked.map((n) => `<a class="chip concept on" href="#/note/${n.id}">${esc(n.title)}</a>`).join('')
      + sugg.map((x) => `<button type="button" class="chip concept suggest" data-concept="${esc(x.title)}">+ ${esc(x.title)}</button>`).join('')
      + '<button type="button" class="chip add" data-newconcept>Otro…</button>';
    if (focusConcepts && !linked.length) conceptsEl.classList.add('pulse');

    const rel = brain.related({ ...h, note: textarea.value }, 3).filter((r) => r.text);
    const relEl = el.querySelector('[data-related]');
    relEl.innerHTML = rel.length ? `<div class="sheet-label">Se parece a</div>${rel.map((r) => `<a class="mini-quote" href="#/read/${r.bookId}/${r.id}">${esc(snippet(r.text, 120))}</a>`).join('')}` : '';
  }
  drawConcepts();

  conceptsEl.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    let title = b.dataset.concept;
    if (b.hasAttribute('data-newconcept')) {
      title = await askText('Nuevo concepto', '', { placeholder: 'Nombre del concepto', ok: 'Conectar' });
      if (!title) return;
    }
    await save();
    const note = await linkConcept(h, title);
    toast(`Conectado con «${note.title}»`);
    onChange?.(h);
    drawConcepts();
  };

  el.querySelectorAll('[data-color]').forEach((b) => {
    b.onclick = () => {
      color = b.dataset.color;
      dirty = true;
      el.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
      el.querySelector('.quote').style.setProperty('--hl', COLORS[color]);
    };
  });

  el.querySelector('[data-tags]').onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-addtag')) {
      const t = await askText('Nueva etiqueta', '', { placeholder: 'por ejemplo: filosofía' });
      if (!t) return;
      const tag = t.replace(/^#/, '').trim().toLowerCase().replace(/\s+/g, '-');
      if (!tags.includes(tag)) tags.push(tag);
    } else {
      const t = b.dataset.tag;
      const i = tags.indexOf(t);
      i >= 0 ? tags.splice(i, 1) : tags.push(t);
    }
    dirty = true;
    el.querySelector('[data-tags]').innerHTML = tagChips(tags);
  };

  el.querySelector('[data-goto]')?.addEventListener('click', async () => { await save(); s.close(); onGoto(h); });
  el.querySelector('[data-delete]').onclick = async () => {
    if (!(await confirmSheet('¿Eliminar subrayado?', 'Se borrará el subrayado y su nota.'))) return;
    dirty = false;
    textarea.value = h.note || '';
    await db.del('highlights', h.id);
    onDelete?.(h);
    s.close();
  };
  return s;
}

