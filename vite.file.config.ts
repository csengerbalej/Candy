import { defineConfig } from 'vite';

/** Classic-script build so the greybox can be opened straight off file:// for QA. */
// A KIADÁS BÉLYEGE. Játszva kiderült, mennyire kell: a szörnyek egy
// részét a javítás után is láthatatlannak láttam volna, ha közben a
// böngésző egy RÉGEBBI kiadást szolgált ki — és erről semmi nem árulkodik
// a képernyőn. Egy szám a sarokban eldönti a kérdést, mielőtt bárki
// keresni kezdene egy hibát, ami már nincs.
const KIADAS = new Date().toISOString().slice(5, 16).replace('T', ' ');

export default defineConfig({
  define: { __KIADAS__: JSON.stringify(KIADAS) },
  base: './',
  build: {
    outDir: 'dist-file',
    assetsDir: '.',
    rollupOptions: { output: { format: 'iife', entryFileNames: 'app.js', inlineDynamicImports: true } },
  },
});
