import type { HarnessView } from '@accio/protocol';
import { HARNESSES, type SettingsAccess } from '@accio/hub';
import type { Router } from '../rpc/router.js';
import type { Models } from './models.js';
import { systemPromptView } from './systemPrompt.js';

/** GLOSSARY: Harness. The ones accio knows, with the machines that report having each. */
export function registerHarnesses(router: Router, settings: SettingsAccess, models: Models) {
  router.on('harnesses.list', (): HarnessView[] =>
    HARNESSES.map((h) => {
      const offered = models.harnessModels(h.id);
      return {
      id: h.id,
      name: h.name,
      providers: [...h.providers],
      models: offered,
      machines: settings
        .machines()
        .flatMap((m) => m.harnesses.filter((i) => i.harnessId === h.id).map((i) => ({ machineId: m.id, version: i.version }))),
      };
    }),
  );
  // GLOSSARY: System prompt. As this machine sends it to each harness.
  router.on('systemPrompt.get', () => systemPromptView(HARNESSES));
}
