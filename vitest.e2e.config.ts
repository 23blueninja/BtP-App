// Browser smoke tests against the production build (run `vite build` first):
//   npm run test:e2e
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    // One browser, one server: run the files one after another.
    fileParallelism: false,
  },
});
