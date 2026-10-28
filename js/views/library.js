// Biblioteca: importar libros, seguir leyendo, y ficha de cada libro.
import { esc, icons, toast, fmtDate, snippet, confirmSheet, saveFile, safeFileName, COLORS } from '../util.js';
import { db, addBook, deleteBook } from '../db.js';
import { openHighlightSheet } from '../highlights.js';
import { renderMarkdown } from '../markdown.js';
import { bookToMarkdown } from '../export.js';

const hue = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

export function coverHtml(b) {
  if (b.cover) return `<img class="cover" src="${b.cover}" alt="">`;
  return `<div class="cover placeholder" style="--h:${hue(b.title)}"><span>${esc(snippet(b.title, 40))}</span></div>`;
}

async function shrinkImage(src, width = 300) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const scale = Math.min(1, width / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

async function epubMeta(buf) {
  const book = window.ePub(buf.slice(0));
  try {
    await book.ready;
    const meta = book.packaging.metadata;
    let cover = null;
    try {
      const url = await book.coverUrl();
      if (url) cover = await shrinkImage(url);
    } catch { /* sin portada */ }
    return { title: meta.title, author: meta.creator, cover };
  } finally {
    book.destroy();
  }
}

async function pdfMeta(buf) {
  const lib = await import('../../vendor/pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await lib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
  try {
    const { info } = await doc.getMetadata().catch(() => ({ info: {} }));
    const page = await doc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 300 / vp1.width });
    const c = document.createElement('canvas');
    c.width = vp.width;
    c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    return { title: info?.Title, author: info?.Author, cover: c.toDataURL('image/jpeg', 0.8), pages: doc.numPages };
  } finally {
    doc.destroy();
  }
}

export async function importFiles(files) {
  let added = 0;
  for (const file of files) {
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    const isEpub = /\.epub$/i.test(file.name) || file.type === 'application/epub+zip';
    if (!isPdf && !isEpub) { toast(`${file.name}: solo EPUB o PDF`); continue; }
    toast(`Importando ${file.name}…`);
    try {
      const buf = await file.arrayBuffer();
      const meta = isPdf ? await pdfMeta(buf) : await epubMeta(buf);
      const fallback = file.name.replace(/\.(pdf|epub)$/i, '');
      await addBook({ ...meta, title: meta.title?.trim() || fallback, author: meta.author?.trim() || '', type: isPdf ? 'pdf' : 'epub', fileName: file.name, size: buf.byteLength }, buf);
      added++;
    } catch (e) {
      console.error(e);
      toast(`No se pudo importar ${file.name}`);
    }
  }
  if (added) toast(added === 1 ? 'Libro añadido' : `${added} libros añadidos`);
  return added;
}

function importButton(label = 'Importar libro') {
  return `<label class="btn primary file-btn">${icons.plus}<span>${label}</span><input type="file" accept=".epub,.pdf,application/epub+zip,application/pdf" multiple hidden></label>`;
}

export async function libraryView(root) {
  const [books, hls] = await Promise.all([db.all('books'), db.all('highlights')]);
  books.sort((a, b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt));
  const recent = books.find((b) => b.lastReadAt);
  const memo = hls.length ? hls[Math.floor(Math.random() * hls.length)] : null;
  const memoBook = memo && books.find((b) => b.id === memo.bookId);

  root.innerHTML = `
    <header class="page-head"><h1>Biblioteca</h1>${books.length ? importButton('Importar') : ''}</header>
    ${!books.length ? `
      <div class="empty">
        <div class="empty-art">${icons.note}</div>
        <h2>Tu biblioteca está vacía</h2>
        <p class="muted">Importa un libro EPUB o PDF desde la app Archivos. Mientras lees, selecciona texto para subrayar, escribir notas y crear conceptos que se conectan entre sí.</p>
        ${importButton()}
      </div>` : ''}
    ${recent ? `
      <a class="continue" href="#/read/${recent.id}">
        ${coverHtml(recent)}
        <div><div class="eyebrow">Seguir leyendo</div><div class="title">${esc(recent.title)}</div>
        <div class="progress"><span style="width:${Math.round((recent.progress || 0) * 100)}%"></span></div></div>
      </a>` : ''}
    ${memo ? `
      <a class="memo" href="#/read/${memo.bookId}/${memo.id}">
        <div class="eyebrow">Para recordar</div>
        <blockquote style="--hl:${COLORS[memo.color]}">${esc(snippet(memo.text, 260))}</blockquote>
        ${memo.note ? `<div class="muted small">${esc(snippet(memo.note, 140))}</div>` : ''}
        <div class="muted small">— ${esc(memoBook?.title || '')}</div>
      </a>` : ''}
    ${books.length ? `<h2 class="section">Libros <span class="muted">${books.length}</span></h2>
      <div class="book-grid">${books.map((b) => `
        <div class="book-card">
          <a href="#/read/${b.id}">${coverHtml(b)}</a>
          <a class="book-meta" href="#/book/${b.id}">
            <div class="title">${esc(b.title)}</div>
            <div class="muted small">${esc(b.author || b.type.toUpperCase())}</div>
            <div class="progress"><span style="width:${Math.round((b.progress || 0) * 100)}%"></span></div>
          </a>
        </div>`).join('')}</div>` : ''}`;

  root.querySelectorAll('input[type=file]').forEach((input) => {
    input.onchange = async () => {
      if (await importFiles([...input.files])) libraryView(root);
    };
  });
}

export async function bookView(root, id) {
  const book = await db.get('books', id);
  if (!book) { location.hash = '#/'; return; }
  const hls = (await db.byBook(id)).sort((a, b) => (a.page || 0) - (b.page || 0) || (a.start || 0) - (b.start || 0) || a.createdAt - b.createdAt);

  root.innerHTML = `
    <header class="page-head"><a class="icon-btn" href="#/">${icons.back}</a><span class="spacer"></span></header>
    <div class="book-hero">
      ${coverHtml(book)}
      <div>
        <h1>${esc(book.title)}</h1>
        <p class="muted">${esc(book.author || '')}</p>
        <p class="muted small">${book.type.toUpperCase()} · añadido ${fmtDate(book.addedAt)} · ${Math.round((book.progress || 0) * 100)}% leído</p>
        <div class="row wrap">
          <a class="btn primary" href="#/read/${book.id}">Leer</a>
          <button class="btn" data-export>Exportar subrayados</button>
          <button class="btn ghost danger-text" data-delete>${icons.trash}</button>
        </div>
      </div>
    </div>
    <h2 class="section">Subrayados <span class="muted">${hls.length}</span></h2>
    ${hls.length ? `<ul class="list">${hls.map((h) => `
      <li class="hl-item" data-id="${h.id}">
        <div class="hl-text" style="--hl:${COLORS[h.color]}">${esc(h.text)}</div>
        ${h.note ? `<div class="md small">${renderMarkdown(h.note)}</div>` : ''}
        <div class="row small"><a class="link" href="#/read/${book.id}/${h.id}">Ir al texto</a><button class="link" data-edit>Editar</button>${h.page ? `<span class="muted">pág. ${h.page}</span>` : ''}</div>
      </li>`).join('')}</ul>` : '<p class="muted">Aún no hay subrayados en este libro.</p>'}`;

  root.querySelector('.list')?.addEventListener('click', (e) => {
    if (!e.target.closest('[data-edit]')) return;
    const h = hls.find((x) => x.id === e.target.closest('[data-id]').dataset.id);
    openHighlightSheet(h, book, { onChange: () => bookView(root, id), onDelete: () => bookView(root, id) });
  });
  root.querySelector('[data-export]').onclick = async () => {
    const md = bookToMarkdown(book, hls);
    await saveFile(new Blob([md], { type: 'text/markdown' }), `${safeFileName(book.title)}.md`);
  };
  root.querySelector('[data-delete]').onclick = async () => {
    if (!(await confirmSheet('¿Eliminar libro?', `Se borrarán «${book.title}» y sus ${hls.length} subrayados. Las notas de concepto se conservan.`))) return;
    await deleteBook(id);
    toast('Libro eliminado');
    location.hash = '#/';
  };
}

