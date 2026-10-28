// Ajustes: exportar, copias de seguridad, almacenamiento y ayuda.
import { toast, saveFile, navBar, bindNav } from '../util.js';
import { db, requestPersistence } from '../db.js';
import { exportVault, exportBackup, importBackup } from '../export.js';

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const stamp = () => new Date().toISOString().slice(0, 10);

export async function moreView(root) {
  const [books, notes, hls] = await Promise.all([db.all('books'), db.all('notes'), db.all('highlights')]);
  let est = null;
  let persisted = false;
  try { est = await navigator.storage?.estimate?.(); persisted = await navigator.storage?.persisted?.(); } catch { /* no disponible */ }
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  root.innerHTML = `
    ${navBar({ title: 'Más' })}
    <div class="stats">
      <div><b>${books.length}</b><span>libros</span></div>
      <div><b>${hls.length}</b><span>subrayados</span></div>
      <div><b>${notes.length}</b><span>conceptos</span></div>
    </div>

    ${!standalone ? `<div class="card callout">
      <b>Instálala en tu iPhone</b>
      <p class="small">En Safari toca el botón Compartir y luego «Añadir a pantalla de inicio». Así se abre como una app y tus datos quedan guardados de forma estable.</p>
    </div>` : ''}

    <h2 class="section">Exportar</h2>
    <div class="card stack">
      <button class="btn" data-vault>Exportar a Markdown (Obsidian)</button>
      <p class="muted small">Un .zip con una carpeta de notas y una de libros con sus subrayados. Se abre directamente como bóveda de Obsidian.</p>
    </div>

    <h2 class="section">Copia de seguridad</h2>
    <div class="card stack">
      <button class="btn" data-backup>Crear copia completa (con libros)</button>
      <button class="btn" data-backup-light>Crear copia solo de notas y subrayados</button>
      <label class="btn file-btn">Restaurar una copia<input type="file" accept=".zip,application/zip" hidden></label>
      <p class="muted small">Todo vive en este teléfono. Haz una copia de vez en cuando y guárdala en iCloud Drive desde el menú de compartir.</p>
    </div>

    <h2 class="section">Almacenamiento</h2>
    <div class="card stack small">
      ${est ? `<div>Usado: <b>${mb(est.usage || 0)}</b> de ${mb(est.quota || 0)} disponibles</div>` : ''}
      <div>Protección contra borrado automático: <b>${persisted ? 'activa' : 'no activa'}</b></div>
      ${!persisted ? '<button class="btn" data-persist>Activar protección</button>' : ''}
    </div>

    <h2 class="section">Cómo usarla</h2>
    <div class="card small help">
      <p><b>Subrayar:</b> mantén el dedo sobre el texto, ajusta la selección y toca «Subrayar». Si el texto menciona un concepto que ya tienes, queda conectado solo.</p>
      <p><b>Conectar:</b> te sugiere conceptos a partir de lo que seleccionaste. Un toque y listo.</p>
      <p><b>Cerebro:</b> los temas que se repiten en tus subrayados aparecen como sugerencias. Al convertirlos en concepto reúnen todo lo que has leído sobre ellos, de todos tus libros.</p>
      <p><b>Leer cómodo:</b> desliza o toca los bordes para pasar página, toca el centro para ocultar las barras y usa «Aa» para el tema Sepia u Oscuro.</p>
      <p><b>Para expertos:</b> en las notas también puedes escribir <code>[[concepto]]</code> y <code>#etiqueta</code>.</p>
    </div>
    <p class="muted small center">Second Brain · v2</p>`;

  bindNav(root);
  const busy = async (btn, fn) => {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparando…';
    try { await fn(); } catch (e) { console.error(e); toast('Algo salió mal'); }
    btn.disabled = false;
    btn.textContent = label;
  };
  root.querySelector('[data-vault]').onclick = (e) => busy(e.target, async () => saveFile(await exportVault(), `second-brain-${stamp()}.zip`));
  root.querySelector('[data-backup]').onclick = (e) => busy(e.target, async () => saveFile(await exportBackup(), `copia-second-brain-${stamp()}.zip`));
  root.querySelector('[data-backup-light]').onclick = (e) => busy(e.target, async () => saveFile(await exportBackup({ includeBooks: false }), `copia-notas-${stamp()}.zip`));
  root.querySelector('[data-persist]')?.addEventListener('click', async () => {
    toast((await requestPersistence()) ? 'Protección activada' : 'Safari no lo permitió; instala la app en la pantalla de inicio');
    moreView(root);
  });
  root.querySelector('input[type=file]').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const r = await importBackup(file);
      toast(`Restaurado: ${r.books} libros, ${r.highlights} subrayados, ${r.notes} notas`);
      moreView(root);
    } catch (err) {
      toast(err.message || 'No se pudo restaurar');
    }
  };
}
