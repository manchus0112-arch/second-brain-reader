// Reconocimiento de texto (OCR) para PDFs escaneados, con Tesseract.js dentro del propio teléfono.
// Cada página se reconoce una sola vez y el resultado se guarda; después se pinta como capa de texto
// invisible y seleccionable, igual que la de un PDF normal.
import { db } from './db.js';

const BASE = new URL('../vendor/tesseract/', import.meta.url).href;
let workerPromise = null;
let queue = Promise.resolve();

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: () => reject(new Error(`No se pudo cargar ${src}`)) });
    document.head.appendChild(s);
  });
}

async function getWorker() {
  workerPromise ||= (async () => {
    if (!window.Tesseract) await loadScript(`${BASE}tesseract.min.js`);
    return window.Tesseract.createWorker(['spa', 'eng'], window.Tesseract.OEM.LSTM_ONLY, {
      workerPath: `${BASE}worker.min.js`,
      corePath: `${BASE}core`,
      langPath: `${BASE}lang`,
      workerBlobURL: false,
    });
  })();
  return workerPromise;
}

// ¿La página no tiene texto propio? (típico de un escaneo)
export const looksScanned = (textLayerEl) => textLayerEl.textContent.replace(/\s+/g, '').length < 15;

export const getCachedOcr = (bookId, page) => db.get('ocr', `${bookId}:${page}`);

// Reconoce una página (una a la vez) y guarda las palabras con su posición relativa (0 a 1).
export function recognizePage(bookId, pdfPage) {
  const job = queue.then(async () => {
    const cached = await getCachedOcr(bookId, pdfPage.pageNumber);
    if (cached) return cached;
    const base = pdfPage.getViewport({ scale: 1 });
    const scale = Math.min(3, 1800 / base.width);
    const vp = pdfPage.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;

    const worker = await getWorker();
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const W = canvas.width;
    const H = canvas.height;
    const lines = [];
    for (const block of data.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          const words = (line.words || [])
            .filter((w) => w.text.trim() && w.confidence > 20)
            .map((w) => ({ t: w.text.trim(), x0: w.bbox.x0 / W, y0: w.bbox.y0 / H, x1: w.bbox.x1 / W, y1: w.bbox.y1 / H }));
          if (words.length) lines.push(words);
        }
      }
    }
    canvas.width = 0;
    const result = { id: `${bookId}:${pdfPage.pageNumber}`, bookId, page: pdfPage.pageNumber, lines };
    await db.put('ocr', result);
    return result;
  });
  queue = job.catch(() => {});
  return job;
}

let measureCtx;
function measure(text, font) {
  measureCtx ||= document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

// Pinta la capa de texto invisible a partir del OCR guardado.
export function buildOcrLayer(container, ocr, width, height) {
  container.innerHTML = '';
  container.classList.add('ocr');
  const frag = document.createDocumentFragment();
  for (const words of ocr.lines) {
    const lineH = Math.max(...words.map((w) => (w.y1 - w.y0) * height));
    words.forEach((w, i) => {
      const next = words[i + 1];
      const text = `${w.t} `;
      const left = w.x0 * width;
      const top = w.y0 * height;
      const fontSize = Math.max(6, lineH * 0.9);
      const target = next ? (next.x0 - w.x0) * width : (w.x1 - w.x0) * width * 1.08;
      const font = `${fontSize}px sans-serif`;
      const natural = measure(text, font) || 1;
      const span = document.createElement('span');
      span.textContent = text;
      span.style.cssText = `left:${left}px;top:${top}px;font:${font};transform:scaleX(${Math.max(0.2, target / natural)})`;
      frag.appendChild(span);
    });
    frag.appendChild(document.createElement('br'));
  }
  container.appendChild(frag);
}
