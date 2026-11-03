import { defineConfig } from '@playwright/test';

const port = Number(process.env.ACCIO_CHAT_TEST_PORT ?? 47481);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  testMatch: 'inline-chat.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL, viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'node --import tsx scripts/chat-test-server.ts',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
