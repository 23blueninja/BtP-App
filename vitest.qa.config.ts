// The per-commit QA pass: the whole suite with sampled (smaller) matrices.
//   npm run test:qa
import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vite.config';

export default mergeConfig(base, defineConfig({ test: { env: { QA: '1' } } }));
