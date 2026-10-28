// Hoja para editar un subrayado y crear notas de concepto a partir de él.
import { esc, sheet, toast, askText, confirmSheet, COLORS, QUICK_TAGS, parseLinks, norm } from './util.js';
import { db, saveHighlight, saveNote, getOrCreateNote } from './db.js';

function tagChips(selected) {
  const all = [...new Set([...QUICK_TAGS, ...selected])];
  return all.map((t) => `<button type="button" class="chip ${selected.includes(t) ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')
    + '<button type="button" class="chip add" data-addtag>+ tag</button>';
}

// Abre la hoja de un subrayado. callbacks: onChange(h), onDelete(h), onGoto(h)
export function openHighlightSheet(h, book, { onChange, onDelete, onGoto, focusNote = false } = {}) {
  const tags = [...(h.tags || [])];
  let color = h.color || 'yellow';
  let dirty = false;

  const s = sheet(`
    <blockquote class="quote" style="--hl:${COLORS[color]}">${esc(h.text)}</blockquote>
    <p class="muted small">${esc(book?.title || '')}${h.page ? ` · pág. ${h.page}` : ''}</p>
    <div class="row colors">${Object.entries(COLORS).map(([k, v]) => `<button type="button" class="swatch ${k === color ? 'on' : ''}" data-color="${k}" style="background:${v}" aria-label="${k}"></button>`).join('')}</div>
    <textarea class="input note-input" rows="4" placeholder="Tu nota… usa [[concepto]] para enlazar y #tag para etiquetar">${esc(h.note || '')}</textarea>
    <div class="chips" data-tags>${tagChips(tags)}</div>
    <div class="row wrap">
      <button type="button" class="btn" data-concept>💡 Nota de concepto</button>
      ${onGoto ? '<button type="button" class="btn" data-goto>Ir al texto</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn ghost danger-text" data-delete>Eliminar</button>
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

  el.querySelector('[data-concept]').onclick = async () => {
    await save();
    const note = await conceptFromHighlight(h, book);
    if (note) { textarea.value = h.note; onChange?.(h); }
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

// Crea (o reutiliza) una nota con el nombre del concepto, le añade la cita
// y enlaza el subrayado con [[concepto]].
export async function conceptFromHighlight(h, book) {
  const suggested = h.text.replace(/\s+/g, ' ').trim().slice(0, 60);
  const title = await askText('Nota de concepto', suggested, { placeholder: 'Nombre del concepto', ok: 'Crear' });
  if (!title) return null;
  const note = await getOrCreateNote(title);
  const quote = `> ${h.text.replace(/\s+/g, ' ').trim()}\n> — *${book?.title || 'Libro'}*${h.page ? `, pág. ${h.page}` : ''}`;
  note.body = note.body ? `${note.body.trimEnd()}\n\n${quote}\n` : `${quote}\n`;
  note.refs = [...new Set([...(note.refs || []), h.id])];
  await saveNote(note);
  if (!parseLinks(h.note).some((l) => norm(l) === norm(note.title))) {
    h.note = h.note ? `${h.note.trimEnd()} [[${note.title}]]` : `[[${note.title}]]`;
    await saveHighlight(h);
  }
  toast(`Nota «${note.title}» lista`, { label: 'Abrir', run: () => { location.hash = `#/note/${note.id}`; } });
  return note;
}
