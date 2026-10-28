// Copia la web (la misma que se publica en GitHub Pages) a dist/ para la app nativa.
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const FILES = ['index.html', 'styles.css', 'manifest.webmanifest', 'sw.js', 'icons', 'js', 'vendor'];
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
for (const f of FILES) cpSync(f, `dist/${f}`, { recursive: true });
console.log('dist/ listo');
