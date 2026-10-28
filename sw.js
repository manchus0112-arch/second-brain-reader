// Funciona sin conexión: guarda la app en caché y la actualiza en segundo plano.
const CACHE = 'second-brain-v2';
const FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './vendor/jszip.min.js',
  './vendor/epub.min.js',
  './vendor/pdf.min.mjs',
  './vendor/pdf.worker.min.mjs',
  './js/app.js',
  './js/util.js',
  './js/db.js',
  './js/markdown.js',
  './js/brain.js',
  './js/highlights.js',
  './js/export.js',
  './js/epub-reader.js',
  './js/pdf-reader.js',
  './js/views/library.js',
  './js/views/reader.js',
  './js/views/notes.js',
  './js/views/search.js',
  './js/views/graph.js',
  './js/views/more.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const network = fetch(e.request)
        .then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => cached);
      if (cached) { e.waitUntil(network); return cached; }
      return network;
    }),
  );
});
