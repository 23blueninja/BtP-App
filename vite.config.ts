import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` keeps the build portable (GitHub Pages subpaths, file hosting).
export default defineConfig({
  base: './',
  plugins: [react()],
  // The bundled rules text is ~800 KB (≈220 KB gzipped).
  build: { chunkSizeWarningLimit: 1500 },
  test: { environment: 'node' },
});
