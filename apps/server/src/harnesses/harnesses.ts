import type { HarnessView } from '@accio/protocol';
import { HARNESSES, type SharedSettings } from '@accio/hub';
import type { Router } from '../rpc/router.js';

/** GLOSSARY: Harness. The ones accio knows, with the machines that report having each. */
export function registerHarnesses(router: Router, settings: SharedSettings) {
  router.on('harnesses.list', (): HarnessView[] =>
    HARNESSES.map((h) => ({
      id: h.id,
      name: h.name,
      providers: [...h.providers],
      machines: settings
        .machines()
        .flatMap((m) => m.harnesses.filter((i) => i.harnessId === h.id).map((i) => ({ machineId: m.id, version: i.version }))),
    })),
  );
}
