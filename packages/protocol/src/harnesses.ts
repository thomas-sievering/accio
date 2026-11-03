import { z } from 'zod';
import { method } from './rpc.js';
import type { ProviderId } from './profiles.js';

export type HarnessModel = {
  id: string; name: string; providerId: ProviderId; description: string;
  /** The signed-in account's own default, as reported by the provider. */
  isDefault?: boolean;
  /** GLOSSARY: Effort. The levels this model accepts, lowest first, as its harness reports them; empty when it takes none. */
  efforts: ModelEffort[];
  /** The level the harness uses when none is chosen. */
  defaultEffort?: string;
};

/** One effort level a model accepts, such as 'high'. */
export type ModelEffort = { id: string; description?: string };

/** GLOSSARY: Harness. Which ones exist is a shared setting; each machine reports which it has. */
export type HarnessView = {
  id: string;
  name: string;
  /** The providers whose models it can use. */
  providers: ProviderId[];
  models: HarnessModel[];
  /** The machines that have it installed. */
  machines: { machineId: string; version: string | null }[];
};

/**
 * GLOSSARY: System prompt. What accio adds to each harness's own instructions, as
 * this machine sends it. Each section is listed once; a section whose text differs
 * between harnesses has one variant per distinct text.
 */
export type SystemPromptView = {
  /** Every harness and how it receives the system prompt. */
  harnesses: { id: string; name: string; delivery: string }[];
  sections: { id: string; title: string; variants: { harnessIds: string[]; text: string }[] }[];
};

export const harnessMethods = {
  'harnesses.list': method<z.ZodObject<{}>, HarnessView[]>(z.object({})),
  'systemPrompt.get': method<z.ZodObject<{}>, SystemPromptView>(z.object({})),
};
