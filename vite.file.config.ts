import { defineConfig } from 'vite';

/** Classic-script build so the greybox can be opened straight off file:// for QA. */
// A KIADÁS BÉLYEGE. Játszva kiderült, mennyire kell: a szörnyek egy
// részét a javítás után is láthatatlannak láttam volna, ha közben a
// böngésző egy RÉGEBBI kiadást szolgált ki — és erről semmi nem árulkodik
// a képernyőn. Egy szám a sarokban eldönti a kérdést, mielőtt bárki
// keresni kezdene egy hibát, ami már nincs.
const KIADAS = (() => {
  // HELYI IDŐ, nem UTC. Az első változat `toISOString`-et használt, és a
  // játékos azt látta, hogy a bélyeg két órával korábbi az órájánál —
  // vagyis pont azt hitte róla, amit ki akartunk zárni: hogy régi.
  const most = new Date();
  const ket = (n: number): string => String(n).padStart(2, '0');
  return `${ket(most.getMonth() + 1)}-${ket(most.getDate())} ${ket(most.getHours())}:${ket(most.getMinutes())}`;
})();

export default defineConfig({
  define: { __KIADAS__: JSON.stringify(KIADAS) },
  base: './',
  build: {
    outDir: 'dist-file',
    assetsDir: '.',
    rollupOptions: { output: { format: 'iife', entryFileNames: 'app.js', inlineDynamicImports: true } },
  },
});
