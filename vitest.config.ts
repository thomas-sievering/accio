import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@accio/codex': fileURLToPath(new URL('./packages/codex/src/index.ts', import.meta.url)),
      '@accio/persistence': fileURLToPath(new URL('./packages/persistence/src/index.ts', import.meta.url)),
      '@accio/protocol': fileURLToPath(new URL('./packages/protocol/src/index.ts', import.meta.url)),
      '@accio/hub': fileURLToPath(new URL('./apps/hub/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['apps/*/src/**/*.test.ts', 'packages/*/src/**/*.test.ts'] },
});
