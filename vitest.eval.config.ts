import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { catalogAssets } from './tooling/catalog-assets.mjs';

/**
 * The assistant test set (tooling/assistant-eval, docs/assistant-eval.md).
 * Separate from `npm test`: it calls the Messages API and costs money. Cases
 * share the session module, so everything runs in one worker, one at a time.
 */
export default defineConfig({
  plugins: [catalogAssets()],
  resolve: {
    alias: {
      '$lib': fileURLToPath(new URL('./src/lib', import.meta.url)),
      '$app/paths': fileURLToPath(new URL('./tests/fixtures/app-paths.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['tests/fixtures/indexeddb.ts'],
    include: ['tooling/assistant-eval/**/*.eval.ts'],
    restoreMocks: true,
    unstubGlobals: true,
    testTimeout: 15 * 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false, shuffle: false },
  },
});
