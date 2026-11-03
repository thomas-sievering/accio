import { defineConfig } from '@playwright/test';

// The fixture server reads the same variable, so worktrees can run checks side by side.
const origin = `http://127.0.0.1:${process.env.ACCIO_CHAT_TEST_PORT ?? 47481}`;

export default defineConfig({
  testDir: './tests',
  testMatch: 'inline-chat.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: origin, viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'node --import tsx scripts/chat-test-server.ts',
    url: origin,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
