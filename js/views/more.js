// Ajustes: exportar, copias de seguridad, almacenamiento y ayuda.
import { toast, saveFile } from '../util.js';
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
    <header class="page-head"><h1>Más</h1></header>
    <div class="stats">
      <div><b>${books.length}</b><span>libros</span></div>
      <div><b>${hls.length}</b><span>subrayados</span></div>
      <div><b>${notes.length}</b><span>notas</span></div>
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
      <p><b>Subrayar:</b> mientras lees, mantén el dedo sobre el texto para seleccionarlo y toca «Subrayar», «Nota» o «Concepto».</p>
      <p><b>Concepto:</b> crea una nota con ese nombre, guarda la cita y enlaza el subrayado con ella.</p>
      <p><b>Enlazar ideas:</b> escribe <code>[[nombre de una nota]]</code> en cualquier nota o subrayado. Si la nota no existe, se crea al tocar el enlace.</p>
      <p><b>Etiquetas:</b> escribe <code>#etiqueta</code> o usa las etiquetas rápidas. Marca con <code>#research</code> lo que quieras investigar más adelante.</p>
      <p><b>Pasar página:</b> desliza, toca los bordes o usa las flechas de abajo.</p>
    </div>
    <p class="muted small center">Second Brain · v1</p>`;

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
