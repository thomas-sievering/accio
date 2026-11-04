import { DEFAULT_MODEL, accountInUse, modelKey, type HarnessModel, type ModelSelection, type ModelsState, type ModelView } from '@accio/protocol';
import { HARNESSES, type SettingsAccess } from '@accio/hub';
import type { Profiles } from '../profiles/profiles.js';
import { UserError, type Broadcast, type Router } from '../rpc/router.js';
import type { ClaudeModels } from './claudeModels.js';
import { generalLimits, modelLimit, nextReset, usedUpMessage } from './modelLimits.js';

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
  constructor(private profiles: Profiles, private settings: SettingsAccess, private machineId: string, private claude: ClaudeModels) {}

  namingSettings() { return this.settings.threadNaming(); }

  list(profileId: string): ModelsState {
    const profile = this.profiles.profileView(profileId);
    const installed = this.settings.machine(this.machineId)?.harnesses ?? [];
    const signedIn = (providerId: string) => { const provider = profile.providers.find((p) => p.id === providerId && p.available); return provider && accountInUse(provider); };
    const now = Date.now();
    const windows = (providerId: string) => { const account = signedIn(providerId); return account ? this.profiles.limitWindows(account.id) : []; };
    const models = HARNESSES.flatMap((h) => {
      if (!installed.some((i) => i.harnessId === h.id)) return [];
      const claudeAccount = signedIn('anthropic');
      const catalog = h.id === 'codex' ? newestFirst(this.profiles.codexModels(profileId).map((m) => ({ ...m, efforts: m.efforts ?? [], providerId: 'openai' as const })))
        : h.id === 'claudeCode' && claudeAccount ? this.claude.models(profileId, claudeAccount.id) : [];
      return catalog.flatMap((m): ModelView[] => {
        const provider = signedIn(m.providerId) && profile.providers.find((p) => p.id === m.providerId);
        if (!provider) return [];
        const limited = modelLimit(m, windows(m.providerId), now);
        return [{ ...m, harnessId: h.id, harnessName: h.name, providerName: provider.name, ...(limited ? { limited } : {}) }];
      });
    });
    const keys = new Set(models.map((m) => modelKey({ harnessId: m.harnessId, modelId: m.id })));
    const usedUp = (['anthropic', 'openai'] as const).flatMap((providerId) => generalLimits(windows(providerId), now).map((limit) => ({ ...limit, providerId })));
    return { models, favorites: this.settings.modelFavorites(profileId).filter((m) => keys.has(modelKey(m))), usedUp };
  }

  /** Every model the harness offers any profile on this machine, for settings shared by all of them. */
  harnessModels(harnessId: string): HarnessModel[] {
    const seen = new Map<string, HarnessModel>();
    for (const profile of this.profiles.all()) {
      for (const { harnessId: h, harnessName: _, providerName: __, limited: ___, ...model } of this.list(profile.id).models) {
        if (h === harnessId && !seen.has(model.id)) seen.set(model.id, model);
      }
    }
    return [...seen.values()];
  }

  /** A new thread's model. One whose own limit is used up is passed over while another is available. */
  default(profileId: string): ModelSelection {
    const listed = this.list(profileId).models;
    const models = listed.some((m) => !m.limited) ? listed.filter((m) => !m.limited) : listed;
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

  /**
   * The effort a turn runs at: the chosen one, else the model's own default. Codex
   * keeps a turn's effort for later turns, so the default is sent explicitly.
   */
  effort(profileId: string, selection: ModelSelection): string | undefined {
    return selection.effort ?? this.list(profileId).models.find((m) => m.harnessId === selection.harnessId && m.id === selection.modelId)?.defaultEffort;
  }

  /** The display name of a model, when this profile's list knows it. */
  modelName(profileId: string, selection: ModelSelection): string | undefined {
    return this.list(profileId).models.find((m) => m.harnessId === selection.harnessId && m.id === selection.modelId)?.name;
  }

  /** Waits until this profile's model lists are as complete as this machine can make them. */
  async ready(profileId: string): Promise<void> {
    const account = accountInUse(this.profiles.profileView(profileId).providers.find((p) => p.id === 'anthropic'));
    if (account) await this.claude.ready(profileId, account.id);
  }

  /** The listed model a choice names, with the effort it accepts; it may be limited. */
  private find(profileId: string, choice: ModelSelection): { selection: ModelSelection; model: ModelView } {
    const { effort, ...selection } = this.resolve(profileId, choice);
    const model = this.list(profileId).models.find((m) => m.harnessId === selection.harnessId && m.id === selection.modelId);
    if (!model) throw new UserError('This model is not available to this profile on this machine.');
    return { model, selection: effort && model.efforts.some((e) => e.id === effort) ? { ...selection, effort } : selection };
  }

  /**
   * The choice as it can run now. An effort the model no longer accepts is dropped,
   * so the model's default applies, rather than failing the thread. A model whose own
   * limit is used up is refused before its turn starts rather than failing during it.
   */
  require(profileId: string, choice: ModelSelection = this.default(profileId)): ModelSelection {
    const { model, selection } = this.find(profileId, choice);
    if (model.limited) throw new UserError(usedUpMessage(model.limited));
    return selection;
  }

  /** Like require, but a chosen effort the model does not accept is an error. */
  requireExact(profileId: string, choice: ModelSelection): ModelSelection {
    const selection = this.require(profileId, choice);
    if (choice.effort && selection.effort !== choice.effort) throw new UserError(`This model does not accept ${choice.effort} effort.`);
    return selection;
  }

  register(router: Router, broadcast: Broadcast) {
    router.on('threadNaming.get', () => this.namingSettings());
    router.on('threadNaming.save', async (settings) => {
      await this.settings.setThreadNaming(settings);
      return this.namingSettings();
    });
    this.settings.onMachinesChanged(() => broadcast('models.changed', null));
    this.watchLimits(() => broadcast('models.changed', null));
    router.on('models.list', ({ profileId }) => this.list(profileId));
    router.on('models.favorite', async ({ profileId, model, favorite }) => {
      await this.ready(profileId);
      // A model whose limit is used up can still be a favourite: it comes back when the limit resets.
      this.find(profileId, model);
      await this.settings.setModelFavorite(profileId, { harnessId: model.harnessId, modelId: model.modelId }, favorite);
      return this.list(profileId);
    });
  }

  /**
   * Announces a change whenever a used-up window appears or goes, including when one
   * resets, but not on every limits refresh, which would only make clients reload.
   */
  private watchLimits(changed: () => void) {
    let last = '';
    let timer: NodeJS.Timeout | undefined;
    const check = () => {
      const views = this.profiles.limitViews();
      const windows = views.flatMap((v) => v.snapshot?.windows ?? []);
      const now = Date.now();
      const current = JSON.stringify(views.map((v) => [v.accountId, (v.snapshot?.windows ?? []).filter((w) => nextReset([w], now) !== undefined).map((w) => [w.id, w.resetsAt])]));
      if (current !== last) { last = current; changed(); }
      clearTimeout(timer);
      const next = nextReset(windows, now);
      // Timers longer than about 24.8 days overflow; check again at least daily.
      if (next !== undefined) { timer = setTimeout(check, Math.min(next - now + 1000, 86_400_000)); timer.unref(); }
    };
    this.profiles.onLimitsChanged(check);
  }
}
