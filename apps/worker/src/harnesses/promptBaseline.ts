import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { PromptMeasurement } from '@accio/protocol';
import type { Harness } from '../threads/harness.js';
import type { BuiltinTool } from './builtinTools.js';
import { turnEnv } from '../threads/harnessEnv.js';
import { measurePrompt, promptCapture } from './promptMeasurement.js';
import { systemPromptText } from './systemPrompt.js';
import type { ToolAccess } from '../tools/tools.js';

/** No account, project or inference: stop at the first assembled request. Tools are enumeration-only. */
export async function measureBaseline(harness: Harness, harnessId: string, model: string, toolsOff: BuiltinTool[], tools?: ToolAccess): Promise<PromptMeasurement> {
  const home = await mkdtemp(join(tmpdir(), 'accio-prompt-'));
  const controller = new AbortController();
  let measurement: PromptMeasurement | undefined;
  const capture = await promptCapture(undefined, body => {
    const candidate = measurePrompt(body, systemPromptText({ harnessId, model }));
    // Claude also makes background naming requests on this endpoint.
    if (!candidate.accio.characters) return;
    measurement = candidate;
    controller.abort();
  });
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const env = turnEnv(home, 'baseline', harnessId, { baseUrl: capture.url, accessKey: 'local-measurement' });
    // Some harnesses need their isolated config folder to exist before startup.
    await mkdir(env.CLAUDE_CONFIG_DIR ?? env.CODEX_HOME!, { recursive: true });
    try {
      for await (const _message of harness.run({ cwd: home, prompt: 'Measure prompt.', sessionId: null, model, env, toolsOff, tools,
        requestSecret: async () => { throw new Error('Secret requests are disabled during prompt measurement'); }, signal: controller.signal })) { /* No model can answer. */ }
    } catch (error) {
      if (!measurement && !controller.signal.aborted) throw error;
    }
    if (!measurement) throw new Error('The harness did not produce a measurable request within 30 seconds.');
    return measurement;
  } finally {
    clearTimeout(timeout);
    controller.abort();
    await capture.close();
    if (dirname(resolve(home)) !== resolve(tmpdir()) || !home.includes('accio-prompt-')) throw new Error('Unexpected measurement directory');
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
