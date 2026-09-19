import { defineConfig } from 'vite';

// A KIADÁS BÉLYEGE. Játszva kiderült, mennyire kell: a szörnyek egy
// részét a javítás után is láthatatlannak láttam volna, ha közben a
// böngésző egy RÉGEBBI kiadást szolgált ki — és erről semmi nem árulkodik
// a képernyőn. Egy szám a sarokban eldönti a kérdést, mielőtt bárki
// keresni kezdene egy hibát, ami már nincs.
const KIADAS = new Date().toISOString().slice(5, 16).replace('T', ' ');

export default defineConfig({
  define: { __KIADAS__: JSON.stringify(KIADAS) },
  base: './',
  build: { assetsDir: '.', rollupOptions: { output: { entryFileNames: 'app.js' } } },
});
