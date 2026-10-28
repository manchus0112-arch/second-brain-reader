# Second Brain Reader

Lector de libros (EPUB y PDF) con notas conectadas, pensado para usarse en el iPhone como app instalada desde Safari.

- Subraya, escribe notas y crea **notas de concepto** desde lo que lees.
- Enlaza ideas con `[[concepto]]` y etiquétalas con `#tag` (por ejemplo `#research`).
- Grafo de notas y libros, búsqueda, y exportación a Markdown compatible con Obsidian.
- Todo se guarda en el propio teléfono (IndexedDB). Funciona sin conexión.

## Publicar

Es una web estática sin paso de compilación. En GitHub: Settings → Pages → Deploy from a branch → `main` / root.

## Probar en local

```
python3 -m http.server 8000
```

y abre http://localhost:8000.

Librerías incluidas en `vendor/`: epub.js 0.3.93, JSZip 3.10.1, pdf.js 4.10.38 (build legacy).

## App nativa para iPhone

Ver [INSTALAR-EN-IPHONE.md](INSTALAR-EN-IPHONE.md). El proyecto de Xcode está en `ios/` (Capacitor); `npm run ios` copia la web a `dist/`, la sincroniza y abre Xcode.
