import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { assetsDir: '.', rollupOptions: { output: { entryFileNames: 'app.js' } } },
});
