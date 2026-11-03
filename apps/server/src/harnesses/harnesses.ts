import type { HarnessView } from '@accio/protocol';
import { HARNESSES, type SettingsAccess } from '@accio/hub';
import type { Router } from '../rpc/router.js';
import { harnessModels } from './catalog.js';
import { systemPromptView } from './systemPrompt.js';

/** GLOSSARY: Harness. The ones accio knows, with the machines that report having each. */
export function registerHarnesses(router: Router, settings: SettingsAccess) {
  router.on('harnesses.list', (): HarnessView[] =>
    HARNESSES.map((h) => ({
      id: h.id,
      name: h.name,
      providers: [...h.providers],
      models: harnessModels(h.id),
      machines: settings
        .machines()
        .flatMap((m) => m.harnesses.filter((i) => i.harnessId === h.id).map((i) => ({ machineId: m.id, version: i.version }))),
    })),
  );
  // GLOSSARY: System prompt. As this machine sends it to each harness.
  router.on('systemPrompt.get', () => systemPromptView(HARNESSES));
}
