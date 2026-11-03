import { defineConfig } from '@playwright/test';
import { createServer } from 'node:net';

// Each verification invocation owns its port; never reuse another checkout's server.
const listener = createServer();
await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
const port = Number(process.env.ACCIO_CHAT_TEST_PORT ?? (listener.address() as { port: number }).port);
// Workers reload this config: inherit the invocation's choice rather than allocating again.
process.env.ACCIO_CHAT_TEST_PORT = String(port);
await new Promise<void>(resolve => listener.close(() => resolve()));
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  testMatch: ['inline-chat.spec.ts', 'delivery.spec.ts', 'effort.spec.ts', 'skills-panel.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL, viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'node --import tsx scripts/chat-test-server.ts',
    url: baseURL,
    env: { ACCIO_CHAT_TEST_PORT: String(port) },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
