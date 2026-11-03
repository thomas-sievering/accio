import { z } from 'zod';
import { method } from './rpc.js';
import type { HarnessModel } from './harnesses.js';
import type { ProviderId } from './profiles.js';

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
/** GLOSSARY: Preset. The four levels each harness has, least capable first. */
export const PRESET_LEVELS = ['low', 'medium', 'high', 'ultra'] as const;
export type PresetLevel = (typeof PRESET_LEVELS)[number];
/** GLOSSARY: Preset. A model and effort that one level stands for in one harness. */
export type PresetView = {
  harnessId: string; level: PresetLevel; model: ModelSelection;
  /** Chosen in settings, rather than accio's default for the level. */
  custom: boolean;
};
export type ModelsState = {
  models: ModelView[]; favorites: ModelSelection[];
  /** Each harness's presets whose model this profile can use. */
  presets: PresetView[];
  /** Used-up general allowances of the profile's accounts. Turns are not refused for them: the provider may still let them run, such as on extra usage. */
  usedUp: (UsedUpLimit & { providerId: ProviderId })[];
};
/** What new threads use until you pick another. Always a real model, never Claude Code's account default. */
export const DEFAULT_MODEL: ModelSelection = { harnessId: 'claudeCode', modelId: 'opus' };
/** Identifies the model alone, whatever its effort. */
export const modelKey = (model: ModelSelection) => JSON.stringify([model.harnessId, model.modelId]);

const ProfileId = z.object({ profileId: z.string() });
const Favorite = ProfileId.extend({ model: ModelSelection, favorite: z.boolean() });
const SavePreset = z.object({
  harnessId: z.string().min(1), level: z.enum(PRESET_LEVELS),
  /** Null returns the level to accio's default. */
  choice: z.object({ modelId: z.string().min(1), effort: Effort.optional() }).nullable(),
});
export const modelMethods = {
  /** Shared by every profile and machine; the harness's own presets are listed with it. */
  'presets.save': method<typeof SavePreset, null>(SavePreset),
  'models.list': method<typeof ProfileId, ModelsState>(ProfileId),
  'models.favorite': method<typeof Favorite, ModelsState>(Favorite),
};
export type ModelEvents = { 'models.changed': null };
