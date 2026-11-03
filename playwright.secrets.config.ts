import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'secret-ui.spec.ts', workers: 1, fullyParallel: false, timeout: 45_000,
  outputDir: './out/secrets-ui/results',
  use: { baseURL: 'http://127.0.0.1:47483', viewport: { width: 1280, height: 900 }, trace: 'off', screenshot: 'off', video: 'off' },
  globalSetup: './tests/setup-secrets.ts',
});
