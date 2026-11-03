import { DEFAULT_MODEL, modelKey, type ModelSelection, type ModelsState } from '@accio/protocol';
import { HARNESSES, type SharedSettings } from '@accio/hub';
import type { Profiles } from '../profiles/profiles.js';
import { UserError, type Broadcast, type Router } from '../rpc/router.js';
import { harnessModels } from './catalog.js';

/** ChatGPT reports its models in no useful order; list them newest version first ("GPT-6.1-Sol" before "GPT-6-Astra"). */
function newestFirst<T extends { name: string }>(models: T[]): T[] {
  const version = (name: string) => (/\d+(?:\.\d+)*/.exec(name)?.[0] ?? '0').split('.').map(Number);
  const compare = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (b[i] ?? 0) - (a[i] ?? 0);
    return 0;
  };
  return [...models].sort((a, b) => compare(version(a.name), version(b.name)));
}

/** Choices are scoped to one profile and the machine that will execute the turn. */
export class Models {
  constructor(private profiles: Profiles, private settings: SharedSettings, private machineId: string) {}

  list(profileId: string): ModelsState {
    const profile = this.profiles.profileView(profileId);
    const installed = this.settings.machine(this.machineId)?.harnesses ?? [];
    const models = HARNESSES.flatMap((h) => {
      if (!installed.some((i) => i.harnessId === h.id)) return [];
      const catalog = h.id === 'codex' ? newestFirst(this.profiles.codexModels(profileId).map((m) => ({ ...m, providerId: 'openai' as const }))) : harnessModels(h.id);
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
    const first = models.find((m) => m.harnessId === DEFAULT_MODEL.harnessId && m.id === DEFAULT_MODEL.modelId) ?? models.find((m) => m.isDefault) ?? models[0];
    return first ? { harnessId: first.harnessId, modelId: first.id } : DEFAULT_MODEL;
  }

  /**
   * 'default' on Codex is no longer a choice but still names the ChatGPT account's default:
   * threads stored while it was, and new threads on Codex-only profiles, resolve to that model.
   */
  resolve(profileId: string, selection: ModelSelection): ModelSelection {
    if (selection.harnessId !== 'codex' || selection.modelId !== 'default') return selection;
    const fallback = this.profiles.codexModels(profileId).find((m) => m.isDefault)?.id;
    return fallback ? { harnessId: 'codex', modelId: fallback } : selection;
  }

  /** The display name of a model, when this profile's list knows it. */
  modelName(profileId: string, selection: ModelSelection): string | undefined {
    return this.list(profileId).models.find((m) => m.harnessId === selection.harnessId && m.id === selection.modelId)?.name;
  }

  require(profileId: string, choice: ModelSelection = this.default(profileId)): ModelSelection {
    const selection = this.resolve(profileId, choice);
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
