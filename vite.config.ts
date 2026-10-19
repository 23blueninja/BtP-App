import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` keeps the build portable (GitHub Pages subpaths, file hosting).
export default defineConfig({
  base: './',
  plugins: [react()],
  // The bundled rules text is ~800 KB (≈220 KB gzipped).
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    // Unit tests next to the code, plus the tests/ suite (browser tests in tests/e2e run separately).
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
