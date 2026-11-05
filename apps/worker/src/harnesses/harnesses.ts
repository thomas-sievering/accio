import type { HarnessView } from '@accio/protocol';
import { HARNESSES, type SettingsAccess } from '@accio/hub';
import { UserError, type Router } from '../rpc/router.js';
import type { Models } from './models.js';
import { builtinToolViews, builtinToolsOff, setBuiltinTool } from './builtinTools.js';
import { systemPromptView } from './systemPrompt.js';
import { measureBaseline } from './promptBaseline.js';
import type { Harness } from '../threads/harness.js';
import type { AccioTools } from '../tools/tools.js';

/** GLOSSARY: Harness. The ones accio knows, with the machines that report having each. */
export function registerHarnesses(router: Router, settings: SettingsAccess, models: Models, runners: Record<string, Harness>, tools: AccioTools) {
  const list = (): HarnessView[] => HARNESSES.map((h) => ({
    id: h.id,
    name: h.name,
    providers: [...h.providers],
    models: models.harnessModels(h.id),
    machines: settings
      .machines()
      .flatMap((m) => m.harnesses.filter((i) => i.harnessId === h.id).map((i) => ({ machineId: m.id, version: i.version }))),
    tools: builtinToolViews(h.id, settings.harnessTools()[h.id]),
  }));
  router.on('harnesses.list', list);
  // GLOSSARY: Built-in tools. One switch for the whole hub; each turn reads it when it starts.
  router.on('harnesses.setTool', async ({ harnessId, toolId, on }) => {
    let next: Record<string, boolean>;
    try { next = setBuiltinTool(harnessId, settings.harnessTools()[harnessId] ?? {}, toolId, on); }
    catch (error) { throw new UserError((error as Error).message); }
    await settings.setHarnessTools(harnessId, next);
    return list();
  });
  router.on('harnesses.resetTools', async ({ harnessId }) => {
    await settings.setHarnessTools(harnessId, {});
    return list();
  });
  // GLOSSARY: System prompt. As this machine sends it to each harness.
  router.on('systemPrompt.get', () => systemPromptView(HARNESSES));
  const pending = new Map<string, ReturnType<typeof measureBaseline>>();
  router.on('systemPrompt.measure', async ({ harnessId }) => {
    const harness = runners[harnessId];
    if (!harness || !HARNESSES.some(h => h.id === harnessId)) throw new UserError('This harness is not available on this machine');
    if (pending.has(harnessId)) return pending.get(harnessId)!;
    const model = models.harnessModels(harnessId)[0]?.id ?? (harnessId === 'codex' ? 'gpt-5.5' : 'opus');
    const grant = tools.measurementGrant();
    const result = measureBaseline(harness, harnessId, model, builtinToolsOff(harnessId, settings.harnessTools()[harnessId]), grant?.access).finally(() => grant?.revoke());
    pending.set(harnessId, result);
    try { return await result; } finally { pending.delete(harnessId); }
  });
}
