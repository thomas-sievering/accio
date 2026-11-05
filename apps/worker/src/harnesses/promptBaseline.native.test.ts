import { expect, it } from 'vitest';
import { claudeCode } from '../threads/claudeCode.js';
import { codexHarness } from '../threads/codex.js';
import { builtinToolsOff } from './builtinTools.js';
import { measureBaseline } from './promptBaseline.js';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { PromptMeasurement } from '@accio/protocol';
import { AccioTools } from '../tools/tools.js';
import { turnEnv } from '../threads/harnessEnv.js';
import { measurePrompt, promptCapture } from './promptMeasurement.js';
import { systemPromptText } from './systemPrompt.js';

it.each(['claudeCode', 'codex'])('measures the real %s baseline locally, with disabled tools absent', async harnessId => {
  const harness = harnessId === 'codex' ? codexHarness() : claudeCode;
  const model = harnessId === 'codex' ? 'gpt-5.5' : 'opus';
  const baseline = await measureBaseline(harness, harnessId, model, builtinToolsOff(harnessId));
  expect(baseline.harness.characters).toBeGreaterThan(100);
  expect(baseline.accio.characters).toBeGreaterThan(1000);
  expect(baseline.tools.characters).toBeGreaterThan(100);
  expect(baseline.toolCount).toBeGreaterThan(0);
  const withWeb = await measureBaseline(harness, harnessId, model, builtinToolsOff(harnessId, { web: true }));
  expect(withWeb.toolCount).toBeGreaterThan(baseline.toolCount);
  expect(withWeb.tools.characters).toBeGreaterThan(baseline.tools.characters);
}, 60_000);

it.each(['claudeCode', 'codex'])('captures real %s project context, turn additions and standard Accio tools', async harnessId => {
  const home = await mkdtemp(join(tmpdir(), 'accio-prompt-context-'));
  const tools = new AccioTools([{ name: 'measurement_fixture', description: 'A standard Accio tool fixture', input: {}, call: () => { throw new Error('Never execute'); } }]);
  const server = createServer((req, res) => { void tools.handle(req, res).then(handled => { if (!handled) res.writeHead(404).end(); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  tools.listen(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  const grant = tools.measurementGrant()!;
  const controller = new AbortController();
  const model = harnessId === 'codex' ? 'gpt-5.5' : 'opus';
  let measurement: PromptMeasurement | undefined;
  let toolJson = '';
  const capture = await promptCapture(undefined, body => {
    if (!measurePrompt(body, systemPromptText({ harnessId, model })).accio.characters) return;
    toolJson = JSON.stringify(body.tools);
    controller.abort();
  });
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    await writeFile(join(home, 'AGENTS.md'), '# Project instructions\nKeep changes inside this disposable project.');
    await writeFile(join(home, 'CLAUDE.md'), '# Project instructions\nKeep changes inside this disposable project.');
    const env = turnEnv(home, 'fixture', harnessId, { baseUrl: capture.url, accessKey: 'local-only' });
    await mkdir(env.CLAUDE_CONFIG_DIR ?? env.CODEX_HOME!, { recursive: true });
    try {
      for await (const _ of (harnessId === 'codex' ? codexHarness() : claudeCode).run({ cwd: home, env, model,
        sessionId: null, prompt: 'Ordinary question is conversation.', toolsOff: builtinToolsOff(harnessId), tools: grant.access,
        resourceInstructions: 'Turn instructions fixture.', signal: controller.signal, onPromptSize: value => { measurement = value; } })) { /* Captured before inference. */ }
    } catch (error) { if (!measurement) throw error; }
    expect(measurement?.context.characters).toBeGreaterThan(50);
    expect(measurement?.additional.characters).toBe('Turn instructions fixture.'.length);
    if (harnessId === 'codex') {
      // Codex defers MCP definitions behind tool search until a model requests them.
      expect(toolJson).toContain('"type":"tool_search"');
      expect(toolJson).toContain('accio');
    } else expect(toolJson).toContain('measurement_fixture');
  } finally {
    clearTimeout(timeout); controller.abort(); grant.revoke();
    await capture.close();
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    if (dirname(resolve(home)) !== resolve(tmpdir()) || !home.includes('accio-prompt-context-')) throw new Error('Unexpected fixture directory');
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 60_000);
