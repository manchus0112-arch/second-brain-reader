// Exportar a Markdown (compatible con Obsidian) y copias de seguridad.
import { db, getBookData } from './db.js';
import { allTags, safeFileName } from './util.js';

const yamlList = (tags) => (tags.length ? `tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]\n` : '');

export function bookToMarkdown(book, hls) {
  const tags = [...new Set(hls.flatMap(allTags))];
  let md = `---\ntype: libro\nautor: ${JSON.stringify(book.author || '')}\n${yamlList(tags)}---\n\n# ${book.title}\n\n`;
  if (book.author) md += `*${book.author}*\n\n`;
  md += '## Subrayados\n\n';
  for (const h of hls) {
    md += `> ${h.text.replace(/\s+/g, ' ').trim()}\n`;
    if (h.page) md += `> — pág. ${h.page}\n`;
    md += '\n';
    if (h.note) md += `${h.note.trim()}\n\n`;
    const t = h.tags || [];
    if (t.length) md += `${t.map((x) => `#${x}`).join(' ')}\n\n`;
    md += '---\n\n';
  }
  return md;
}

export function noteToMarkdown(n) {
  const tags = allTags(n);
  return `---\n${yamlList(tags)}creado: ${new Date(n.createdAt).toISOString()}\n---\n\n# ${n.title}\n\n${(n.body || '').trim()}\n`;
}

function uniqueName(used, base) {
  let name = base;
  let i = 2;
  while (used.has(name.toLowerCase())) name = `${base} ${i++}`;
  used.add(name.toLowerCase());
  return name;
}

// Una carpeta tipo "bóveda" de Obsidian: Notas/ y Libros/
export async function exportVault() {
  const zip = new window.JSZip();
  const [notes, books, hls] = await Promise.all([db.all('notes'), db.all('books'), db.all('highlights')]);
  const used = new Set();
  for (const n of notes) zip.file(`Notas/${uniqueName(used, safeFileName(n.title))}.md`, noteToMarkdown(n));
  for (const b of books) {
    const list = hls.filter((h) => h.bookId === b.id).sort((x, y) => (x.page || 0) - (y.page || 0) || (x.start || 0) - (y.start || 0) || x.createdAt - y.createdAt);
    zip.file(`Libros/${uniqueName(used, safeFileName(b.title))}.md`, bookToMarkdown(b, list));
  }
  return zip.generateAsync({ type: 'blob' });
}

export async function exportBackup({ includeBooks = true } = {}) {
  const zip = new window.JSZip();
  const [notes, books, highlights] = await Promise.all([db.all('notes'), db.all('books'), db.all('highlights')]);
  zip.file('data.json', JSON.stringify({ app: 'second-brain-reader', version: 1, exportedAt: Date.now(), books, highlights, notes }));
  if (includeBooks) {
    for (const b of books) {
      const data = await getBookData(b.id);
      if (data) zip.file(`files/${b.id}.${b.type}`, data);
    }
  }
  return zip.generateAsync({ type: 'blob' });
}

export async function importBackup(file) {
  const zip = await window.JSZip.loadAsync(file);
  const entry = zip.file('data.json');
  if (!entry) throw new Error('No es una copia de seguridad de esta app');
  const data = JSON.parse(await entry.async('string'));
  let books = 0;
  for (const b of data.books || []) {
    const f = zip.file(`files/${b.id}.${b.type}`);
    if (f) await db.put('files', { id: b.id, data: await f.async('arraybuffer') });
    else if (!(await db.get('files', b.id))) continue; // libro sin archivo: no se puede abrir
    await db.put('books', b);
    books++;
  }
  for (const h of data.highlights || []) await db.put('highlights', h);
  for (const n of data.notes || []) await db.put('notes', n);
  return { books, highlights: data.highlights?.length || 0, notes: data.notes?.length || 0 };
}
