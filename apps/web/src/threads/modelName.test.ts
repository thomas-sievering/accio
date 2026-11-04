import { describe, expect, it } from 'vitest';
import { prettyModelName } from './modelName';

describe('prettyModelName', () => {
  it.each([
    ['Claude Opus 5.5', 'Opus', '5.5'],
    ['Opus 5.5', 'Opus', '5.5'],
    ['GPT-6.1-Sol', 'Sol', '6.1'],
    ['gpt-5.3-codex', 'Codex', '5.3'],
    ['GPT-5.1-Codex-Max', 'Codex Max', '5.1'],
    ['GPT-5', 'GPT', '5'],
    ['Claude Haiku 5.5', 'Haiku', '5.5'],
  ])('%s → %s · %s', (input, name, version) => {
    expect(prettyModelName(input)).toEqual({ name, version });
  });

  it('leaves a name without a version whole', () => {
    expect(prettyModelName('Claude Code default')).toEqual({ name: 'Claude Code default' });
    expect(prettyModelName('Codex default')).toEqual({ name: 'Codex default' });
  });
});
