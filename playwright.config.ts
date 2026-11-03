import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'inline-chat.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:47481', viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'node --import tsx scripts/chat-test-server.ts',
    url: 'http://127.0.0.1:47481',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
