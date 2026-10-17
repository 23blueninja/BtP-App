import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` keeps the build portable (GitHub Pages subpaths, file hosting).
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { environment: 'node' },
});
