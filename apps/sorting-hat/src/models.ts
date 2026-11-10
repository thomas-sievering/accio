import type { CodexModel } from './openaiAuth.js';
import type { Fetch } from './types.js';

/** One model as Anthropic's `GET /v1/models` lists it; any other fields it sends are kept. */
export type AnthropicModel = { type: 'model'; id: string; display_name: string; created_at: string; [field: string]: unknown };

const MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1000';
const LISTED_FOR_MS = 6 * 60 * 60_000;
const RETRY_AFTER_MS = 5 * 60_000;

/**
 * Claude Code's stable aliases, listed while Anthropic does not answer for an
 * account. Claude Code resolves them itself, and Claude subscriptions are only
 * used through Claude Code, so they always name a model it can run.
 */
export const CLAUDE_ALIASES: AnthropicModel[] = [
  { type: 'model', id: 'opus', display_name: 'Claude Opus', created_at: '1970-01-01T00:00:00Z' },
  { type: 'model', id: 'sonnet', display_name: 'Claude Sonnet', created_at: '1970-01-01T00:00:00Z' },
  { type: 'model', id: 'haiku', display_name: 'Claude Haiku', created_at: '1970-01-01T00:00:00Z' },
];

type Listed = { models: AnthropicModel[]; until: number };

/**
 * The models each Claude account can use, as Anthropic lists them for its OAuth
 * token. Kept per account for a few hours; a new sign-in or sign-out forgets it.
 * When Anthropic does not answer, the aliases stand in and it is asked again
 * after a few minutes.
 */
export class ClaudeModelLists {
  private listed = new Map<string, Listed>();
  private asking = new Map<string, Promise<AnthropicModel[]>>();
  /** Bumped when an account's sign-in changes, so an answer for the old one is not kept. */
  private generation = new Map<string, number>();

  constructor(
    private fetchImpl: Fetch,
    /** The account's access token, refreshed first when forced; null when signed out. */
    private token: (accountId: string, force: boolean) => Promise<string | null>,
  ) {}

  models(accountId: string, now = Date.now()): Promise<AnthropicModel[]> {
    const listed = this.listed.get(accountId);
    if (listed && listed.until > now) return Promise.resolve(listed.models);
    let asking = this.asking.get(accountId);
    if (!asking) {
      const generation = this.generation.get(accountId) ?? 0;
      const pending: Promise<AnthropicModel[]> = this.read(accountId).then(
        (models) => this.keep(accountId, generation, models, LISTED_FOR_MS),
        (error) => {
          console.error('[sorting-hat] could not list Claude models', (error as Error).message);
          return this.keep(accountId, generation, CLAUDE_ALIASES, RETRY_AFTER_MS);
        },
      ).finally(() => { if (this.asking.get(accountId) === pending) this.asking.delete(accountId); });
      this.asking.set(accountId, asking = pending);
    }
    return asking;
  }

  /** After the account signed in again or out: its next list is read afresh. */
  forget(accountId: string) {
    this.listed.delete(accountId);
    this.asking.delete(accountId);
    this.generation.set(accountId, (this.generation.get(accountId) ?? 0) + 1);
  }

  private keep(accountId: string, generation: number, models: AnthropicModel[], forMs: number) {
    if ((this.generation.get(accountId) ?? 0) === generation) this.listed.set(accountId, { models, until: Date.now() + forMs });
    return models;
  }

  private async read(accountId: string): Promise<AnthropicModel[]> {
    const send = async (force: boolean) => {
      const token = await this.token(accountId, force);
      if (!token) throw new Error('The account is signed out.');
      // The headers the model routes add for a Claude account's token.
      return this.fetchImpl(MODELS_URL, { headers: {
        authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'anthropic-version': '2023-06-01', accept: 'application/json',
      }, signal: AbortSignal.timeout(15_000) });
    };
    let response = await send(false);
    if (response.status === 401) { await response.body?.cancel(); response = await send(true); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Anthropic answered ${response.status}`); }
    const body = await response.json() as { data?: unknown };
    const models = Array.isArray(body.data) ? body.data.filter((m): m is AnthropicModel => !!m && typeof m === 'object' && typeof (m as AnthropicModel).id === 'string') : [];
    if (!models.length) throw new Error('Anthropic listed no models');
    return models.map((m) => ({ ...m, type: 'model', display_name: typeof m.display_name === 'string' ? m.display_name : m.id, created_at: typeof m.created_at === 'string' ? m.created_at : '1970-01-01T00:00:00Z' }));
  }
}

/** Anthropic's list shape, all on one page. */
export function anthropicList(models: AnthropicModel[]) {
  return { data: models, has_more: false, first_id: models[0]?.id ?? null, last_id: models.at(-1)?.id ?? null };
}

/** OpenAI's model shape for one ChatGPT model; ChatGPT reports no creation time. */
export function openaiModel(model: CodexModel) {
  return { id: model.id, object: 'model' as const, created: 0, owned_by: 'openai' };
}

export function openaiList(models: CodexModel[]) {
  return { object: 'list' as const, data: models.map(openaiModel) };
}
