import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'limits.spec.ts', outputDir: './out/limits-browser', fullyParallel: false, workers: 1, timeout: 90_000,
  use: { baseURL: 'http://127.0.0.1:47482', viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
  webServer: { command: 'node --import tsx scripts/limits-test-server.ts', url: 'http://127.0.0.1:47482', reuseExistingServer: false, timeout: 30_000 },
});
