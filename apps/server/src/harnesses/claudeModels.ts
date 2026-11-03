import { homedir } from 'node:os';
import type { HarnessModel } from '@accio/protocol';
import { CLAUDE_MODELS, claudeModel, type ClaudeModelSource } from './catalog.js';

const RETRY_AFTER_MS = 5 * 60_000;

/**
 * The models Claude Code offers each profile's Claude account, with their effort
 * levels. Asked once per account and kept for the life of the process; until it
 * answers, or if it cannot, the stable aliases stand in.
 */
export class ClaudeModels {
  private known = new Map<string, HarnessModel[]>();
  private asking = new Map<string, Promise<void>>();
  private failedAt = new Map<string, number>();

  constructor(
    private source: ClaudeModelSource | undefined,
    private envFor: (profileId: string) => Promise<Record<string, string>>,
    private changed: () => void,
  ) {}

  /** `accountId` is the profile's selected Claude account: another account may offer other models. */
  models(profileId: string, accountId: string): HarnessModel[] {
    const key = JSON.stringify([profileId, accountId]);
    const known = this.known.get(key);
    if (!known) this.ask(key, profileId);
    return known ?? CLAUDE_MODELS;
  }

  /** Waits for the account's own list when Claude Code is still being asked for it, so a turn after a restart can use a model only it lists, such as Fable. */
  async ready(profileId: string, accountId: string): Promise<void> {
    this.models(profileId, accountId);
    await this.asking.get(JSON.stringify([profileId, accountId]));
  }

  private ask(key: string, profileId: string) {
    const source = this.source;
    if (!source || this.asking.has(key) || Date.now() - (this.failedAt.get(key) ?? -Infinity) < RETRY_AFTER_MS) return;
    this.asking.set(key, (async () => {
      try {
        const models = (await source(await this.envFor(profileId), homedir())).flatMap((info) => claudeModel(info) ?? []);
        if (!models.length) throw new Error('Claude Code reported no models');
        this.known.set(key, models);
        this.failedAt.delete(key);
        this.changed();
      } catch (error) {
        this.failedAt.set(key, Date.now());
        console.error('[models] could not read Claude Code models', (error as Error).message);
      } finally {
        this.asking.delete(key);
      }
    })());
  }
}
