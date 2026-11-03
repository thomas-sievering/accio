import { DEFAULT_MODEL, modelKey, type ModelSelection, type ModelsState } from '@accio/protocol';
import { HARNESSES, type SharedSettings } from '@accio/hub';
import type { Profiles } from '../profiles/profiles.js';
import { UserError, type Broadcast, type Router } from '../rpc/router.js';
import { harnessModels } from './catalog.js';

/** Choices are scoped to one profile and the machine that will execute the turn. */
export class Models {
  constructor(private profiles: Profiles, private settings: SharedSettings, private machineId: string) {}

  list(profileId: string): ModelsState {
    const profile = this.profiles.profileView(profileId);
    const installed = this.settings.machine(this.machineId)?.harnesses ?? [];
    const models = HARNESSES.flatMap((h) => {
      if (!installed.some((i) => i.harnessId === h.id)) return [];
      const catalog = h.id === 'codex' ? [...harnessModels(h.id), ...this.profiles.codexModels(profileId).map((m) => ({ ...m, providerId: 'openai' as const }))] : harnessModels(h.id);
      return catalog.flatMap((m) => {
        const provider = profile.providers.find((p) => p.id === m.providerId && p.available && p.accounts.some((account) => account.signedIn));
        return provider ? [{ ...m, harnessId: h.id, harnessName: h.name, providerName: provider.name }] : [];
      });
    });
    const keys = new Set(models.map((m) => modelKey({ harnessId: m.harnessId, modelId: m.id })));
    return { models, favorites: this.settings.modelFavorites(profileId).filter((m) => keys.has(modelKey(m))) };
  }

  default(profileId: string): ModelSelection {
    const models = this.list(profileId).models;
    const first = models.find((m) => m.harnessId === DEFAULT_MODEL.harnessId && m.id === DEFAULT_MODEL.modelId) ?? models[0];
    return first ? { harnessId: first.harnessId, modelId: first.id } : DEFAULT_MODEL;
  }

  executionModel(profileId: string, selection: ModelSelection): string | undefined {
    if (selection.modelId !== 'default') return selection.modelId;
    return selection.harnessId === 'codex' ? this.profiles.codexModels(profileId).find((m) => m.isDefault)?.id : undefined;
  }

  /** The display name of the model a turn runs as, when this profile's list knows it. */
  executionModelName(profileId: string, selection: ModelSelection): string | undefined {
    const id = this.executionModel(profileId, selection);
    return id ? this.list(profileId).models.find((m) => m.harnessId === selection.harnessId && m.id === id)?.name : undefined;
  }

  require(profileId: string, selection: ModelSelection = this.default(profileId)): ModelSelection {
    if (!this.list(profileId).models.some((m) => m.harnessId === selection.harnessId && m.id === selection.modelId)) {
      throw new UserError('This model is not available to this profile on this machine.');
    }
    return selection;
  }

  register(router: Router, broadcast: Broadcast) {
    this.settings.onMachinesChanged(() => broadcast('models.changed', null));
    router.on('models.list', ({ profileId }) => this.list(profileId));
    router.on('models.favorite', async ({ profileId, model, favorite }) => {
      this.require(profileId, model);
      await this.settings.setModelFavorite(profileId, model, favorite);
      return this.list(profileId);
    });
  }
}
