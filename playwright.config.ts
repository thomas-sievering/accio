import { defineConfig } from '@playwright/test';
import { createServer } from 'node:net';

/** Browser suites. Each project drives its own fixture server (`scripts/<project>-test-server.ts`, started by tests/servers.ts). */
const suites = {
  chat: { testMatch: ['naming.spec.ts', 'goal.spec.ts', 'inline-chat.spec.ts', 'delivery.spec.ts', 'delivery-merge.spec.ts', 'effort.spec.ts', 'new-thread.spec.ts', 'skills-panel.spec.ts', 'settings.spec.ts', 'project-dashboard.spec.ts', 'mentions.spec.ts', 'images.spec.ts'], timeout: 30_000 },
  limits: { testMatch: ['limits.spec.ts'], timeout: 90_000 },
  secrets: { testMatch: ['secret-ui.spec.ts'], timeout: 45_000 },
};

// Each invocation owns its ports; never reuse another checkout's server. Workers reload this
// config, so they inherit the invocation's ports (ACCIO_<SUITE>_TEST_PORT) instead of allocating again.
async function port(suite: string) {
  const name = `ACCIO_${suite.toUpperCase()}_TEST_PORT`;
  if (!process.env[name]) {
    const listener = createServer();
    await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
    process.env[name] = String((listener.address() as { port: number }).port);
    await new Promise<void>(resolve => listener.close(() => resolve()));
  }
  return process.env[name];
}

const projects = [];
for (const [name, suite] of Object.entries(suites)) {
  projects.push({ name, ...suite, outputDir: `./out/e2e/${name}`, use: { baseURL: `http://127.0.0.1:${await port(name)}` } });
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  globalSetup: './tests/servers.ts',
  use: { viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
  projects,
});
