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
  /** Every model it offers any profile on this machine. */
  models: HarnessModel[];
  /** The machines that have it installed. */
  machines: { machineId: string; version: string | null }[];
  /** GLOSSARY: Built-in tools. Its own tools, as switches shared by the whole hub. */
  tools: BuiltinToolView[];
};

/** GLOSSARY: Built-in tools. One switch over one or more tool names the model sees. */
export type BuiltinToolView = {
  id: string; name: string; description: string; tools: string[];
  /** Always on: the harness cannot work without it. */
  required: boolean;
  defaultOn: boolean;
  on: boolean;
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

const Effort = z.string().regex(/^[a-z]{1,32}$/);
/** GLOSSARY: Effort. Omitted to use the model's default level. */
export const ModelSelection = z.object({ harnessId: z.string().min(1), modelId: z.string().min(1), effort: Effort.optional() });
export type ModelSelection = z.output<typeof ModelSelection>;
/**
 * A provider allowance the account has used up, such as "Fable's weekly limit".
 * Nothing more runs on it until `resetsAt`, as the account's latest limits report it.
 */
export type UsedUpLimit = { label: string; resetsAt: string | null };
export type ModelView = HarnessModel & {
  harnessId: string; harnessName: string; providerName: string;
  /** The model's own limit is used up: turns on it are refused until it resets. */
  limited?: UsedUpLimit;
};
export type ModelsState = {
  models: ModelView[]; favorites: ModelSelection[];
  /** Used-up general allowances of the profile's accounts. Turns are not refused for them: the provider may still let them run, such as on extra usage. */
  usedUp: (UsedUpLimit & { providerId: ProviderId })[];
};
/** What new threads use until you pick another. Always a real model, never Claude Code's account default. */
export const DEFAULT_MODEL: ModelSelection = { harnessId: 'claudeCode', modelId: 'opus' };
/** Identifies the model alone, whatever its effort. */
export const modelKey = (model: ModelSelection) => JSON.stringify([model.harnessId, model.modelId]);

const ProfileId = z.object({ profileId: z.string() });
const HarnessTool = z.object({ harnessId: z.string().min(1), toolId: z.string().min(1), on: z.boolean() });
const HarnessId = z.object({ harnessId: z.string().min(1) });
const Favorite = ProfileId.extend({ model: ModelSelection, favorite: z.boolean() });
export const ThreadNamingSettings = z.object({
  automatic: z.boolean().default(true),
  model: ModelSelection.nullable().default(null),
  instructions: z.string().trim().max(2000).default(''),
});
export type ThreadNamingSettings = z.output<typeof ThreadNamingSettings>;
export const DEFAULT_THREAD_NAMING: ThreadNamingSettings = { automatic: true, model: null, instructions: '' };
export const modelMethods = {
  'threadNaming.get': method<z.ZodObject<{}>, ThreadNamingSettings>(z.object({})),
  'threadNaming.save': method<typeof ThreadNamingSettings, ThreadNamingSettings>(ThreadNamingSettings),
  'harnesses.list': method<z.ZodObject<{}>, HarnessView[]>(z.object({})),
  'harnesses.setTool': method<typeof HarnessTool, HarnessView[]>(HarnessTool),
  'harnesses.resetTools': method<typeof HarnessId, HarnessView[]>(HarnessId),
  'systemPrompt.get': method<z.ZodObject<{}>, SystemPromptView>(z.object({})),
  'models.list': method<typeof ProfileId, ModelsState>(ProfileId),
  'models.favorite': method<typeof Favorite, ModelsState>(Favorite),
};
export type ModelEvents = { 'models.changed': null };
