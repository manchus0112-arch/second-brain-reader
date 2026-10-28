// Todo se guarda en el propio teléfono, en IndexedDB.
// Almacenes: books (metadatos), files (el archivo del libro), highlights, notes.
import { uid, norm, allTags } from './util.js';
import { conceptsOf } from './brain.js';

const DB_NAME = 'second-brain';
const DB_VERSION = 1;
let dbPromise;

function open() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('books', { keyPath: 'id' });
      db.createObjectStore('files', { keyPath: 'id' });
      db.createObjectStore('highlights', { keyPath: 'id' }).createIndex('bookId', 'bookId');
      db.createObjectStore('notes', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    const req = fn(t);
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  get: (store, id) => tx(store, 'readonly', (t) => t.objectStore(store).get(id)),
  all: (store) => tx(store, 'readonly', (t) => t.objectStore(store).getAll()),
  put: (store, value) => tx(store, 'readwrite', (t) => t.objectStore(store).put(value)),
  del: (store, id) => tx(store, 'readwrite', (t) => t.objectStore(store).delete(id)),
  byBook: (bookId) => tx('highlights', 'readonly', (t) => t.objectStore('highlights').index('bookId').getAll(bookId)),
};

// Pide al sistema que no borre los datos si falta espacio.
export async function requestPersistence() {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}

/* ---------- Libros ---------- */

export async function addBook(meta, data) {
  const book = { id: uid(), addedAt: Date.now(), lastReadAt: 0, progress: 0, location: null, ...meta };
  await tx(['books', 'files'], 'readwrite', (t) => {
    t.objectStore('files').put({ id: book.id, data });
    t.objectStore('books').put(book);
  });
  return book;
}

export async function updateBook(id, patch) {
  const book = await db.get('books', id);
  if (!book) return;
  Object.assign(book, patch);
  await db.put('books', book);
  return book;
}

export async function deleteBook(id) {
  const hls = await db.byBook(id);
  await tx(['books', 'files', 'highlights'], 'readwrite', (t) => {
    t.objectStore('books').delete(id);
    t.objectStore('files').delete(id);
    for (const h of hls) t.objectStore('highlights').delete(h.id);
  });
}

export const getBookData = async (id) => (await db.get('files', id))?.data;

/* ---------- Subrayados ---------- */

export async function saveHighlight(h) {
  h.id ||= uid();
  h.createdAt ||= Date.now();
  h.updatedAt = Date.now();
  h.tags ||= [];
  h.note ??= '';
  h.color ||= 'yellow';
  await db.put('highlights', h);
  return h;
}

/* ---------- Notas ---------- */

export async function saveNote(n) {
  n.id ||= uid();
  n.createdAt ||= Date.now();
  n.updatedAt = Date.now();
  n.tags ||= [];
  n.body ??= '';
  await db.put('notes', n);
  return n;
}

export async function findNoteByTitle(title) {
  const t = norm(title);
  return (await db.all('notes')).find((n) => norm(n.title) === t);
}

export async function getOrCreateNote(title) {
  return (await findNoteByTitle(title)) || saveNote({ title: title.trim(), body: '' });
}

// Todo lo que está conectado a una nota: enlaces explícitos y menciones de su título.
export async function backlinks(note) {
  const [notes, hls] = await Promise.all([db.all('notes'), db.all('highlights')]);
  const hit = (item) => conceptsOf(item, [note]).length > 0;
  return {
    notes: notes.filter((n) => n.id !== note.id && hit(n)),
    highlights: hls.filter(hit),
  };
}

export async function tagIndex() {
  const [notes, hls] = await Promise.all([db.all('notes'), db.all('highlights')]);
  const map = new Map();
  for (const item of [...notes, ...hls]) {
    for (const tag of allTags(item)) map.set(tag, (map.get(tag) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
