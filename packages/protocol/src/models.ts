import { z } from 'zod';
import { method } from './rpc.js';
import type { HarnessModel } from './harnesses.js';

export const ModelSelection = z.object({ harnessId: z.string().min(1), modelId: z.string().min(1) });
export type ModelSelection = z.output<typeof ModelSelection>;
export type ModelView = HarnessModel & { harnessId: string; harnessName: string; providerName: string };
export type ModelsState = { models: ModelView[]; favorites: ModelSelection[] };
/** What new threads use until you pick another. Always a real model, never Claude Code's account default. */
export const DEFAULT_MODEL: ModelSelection = { harnessId: 'claudeCode', modelId: 'opus' };
export const modelKey = (model: ModelSelection) => JSON.stringify([model.harnessId, model.modelId]);

const ProfileId = z.object({ profileId: z.string() });
const Favorite = ProfileId.extend({ model: ModelSelection, favorite: z.boolean() });
export const modelMethods = {
  'models.list': method<typeof ProfileId, ModelsState>(ProfileId),
  'models.favorite': method<typeof Favorite, ModelsState>(Favorite),
};
export type ModelEvents = { 'models.changed': null };
