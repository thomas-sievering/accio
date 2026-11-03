import { z } from 'zod';
import { method } from './rpc.js';
import type { HarnessModel } from './harnesses.js';
import type { ProviderId } from './profiles.js';

/** GLOSSARY: Effort. Omitted to use the model's default level. */
export const ModelSelection = z.object({ harnessId: z.string().min(1), modelId: z.string().min(1), effort: z.string().regex(/^[a-z]{1,32}$/).optional() });
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
const Favorite = ProfileId.extend({ model: ModelSelection, favorite: z.boolean() });
export const modelMethods = {
  'models.list': method<typeof ProfileId, ModelsState>(ProfileId),
  'models.favorite': method<typeof Favorite, ModelsState>(Favorite),
};
export type ModelEvents = { 'models.changed': null };
