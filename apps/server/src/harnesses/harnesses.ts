import type { HarnessView } from '@accio/protocol';
import { HARNESSES, type SettingsAccess } from '@accio/hub';
import { UserError, type Router } from '../rpc/router.js';
import type { Models } from './models.js';
import { builtinToolViews, setBuiltinTool } from './builtinTools.js';
import { systemPromptView } from './systemPrompt.js';

/** GLOSSARY: Harness. The ones accio knows, with the machines that report having each. */
export function registerHarnesses(router: Router, settings: SettingsAccess, models: Models) {
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
}
