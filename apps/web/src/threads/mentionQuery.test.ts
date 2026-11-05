import { describe, expect, it } from 'vitest';
import type { ModelView } from '@accio/protocol';
import { mentionAt, mentionOptions } from './mentionQuery';

const model = (id: string, name: string, harnessId = 'claudeCode'): ModelView => ({
  id, name, harnessId, harnessName: '', providerId: harnessId === 'codex' ? 'openai' : 'anthropic', providerName: '', description: '', efforts: [],
});

describe('mentionAt', () => {
  it('finds the @ the caret is in, at the start or after a space', () => {
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionAt('use @So for it', 7)).toEqual({ start: 4, query: 'so' });
  });

  it('ignores an @ inside a word or behind a space', () => {
    expect(mentionAt('mail a@b', 8)).toBeUndefined();
    expect(mentionAt('use @sol now', 12)).toBeUndefined();
  });
});

describe('mentionOptions', () => {
  const state = {
    models: [model('opus', 'Claude Opus 5.5'), model('sonnet', 'Claude Sonnet 5.5'), model('sol', 'GPT-6.1-Sol', 'codex'), model('max', 'GPT-5.1-Codex-Max', 'codex')],
    favorites: [{ harnessId: 'codex', modelId: 'sol' }], usedUp: [],
  };

  it('lists favourites first', () => {
    expect(mentionOptions(state, '').map((o) => o.handle)).toEqual(['sol', 'opus', 'sonnet', 'codex-max']);
  });

  it('matches the start of the handle or of any word', () => {
    expect(mentionOptions(state, 's').map((o) => o.handle)).toEqual(['sol', 'sonnet']);
    expect(mentionOptions(state, 'max').map((o) => o.handle)).toEqual(['codex-max']);
    expect(mentionOptions(state, 'gpt').map((o) => o.handle)).toEqual(['sol', 'codex-max']);
  });
});
