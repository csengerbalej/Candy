import { defineConfig } from 'vite';

/** Classic-script build so the greybox can be opened straight off file:// for QA. */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist-file',
    assetsDir: '.',
    rollupOptions: { output: { format: 'iife', entryFileNames: 'app.js', inlineDynamicImports: true } },
  },
});
