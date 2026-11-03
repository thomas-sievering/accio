import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@accio/protocol': fileURLToPath(new URL('./packages/protocol/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['apps/*/src/**/*.test.ts', 'packages/*/src/**/*.test.ts'] },
});
