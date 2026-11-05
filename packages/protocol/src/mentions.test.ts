import { describe, expect, it } from 'vitest';
import { findMentionedModel, modelHandles, prettyModelName, splitMentions } from './mentions.js';

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

describe('model mentions', () => {
  const models = [
    { name: 'Claude Opus 5.5' }, { name: 'Claude Sonnet 5.5' },
    { name: 'GPT-6.1-Sol' }, { name: 'GPT-6-Sol', older: true as const }, { name: 'GPT-5.1-Codex-Max' },
  ];

  it('names each offered model by its family', () => {
    expect(modelHandles(models).map((h) => h.handle)).toEqual(['opus', 'sonnet', 'sol', 'codex-max']);
  });

  it('adds the version when two offered models share a family', () => {
    expect(modelHandles([{ name: 'Claude Opus 5.5' }, { name: 'Claude Opus 5' }]).map((h) => h.handle)).toEqual(['opus-5.5', 'opus-5']);
  });

  it('finds a model by its handle or its versioned handle, never an older one', () => {
    expect(findMentionedModel(models, '@sol')?.name).toBe('GPT-6.1-Sol');
    expect(findMentionedModel(models, 'sol-6.1')?.name).toBe('GPT-6.1-Sol');
    expect(findMentionedModel(models, 'sol-6')).toBeUndefined();
    expect(findMentionedModel(models, 'nope')).toBeUndefined();
  });

  it('splits mentions of offered models out of a message', () => {
    expect(splitMentions('use @sol for this, mail a@b.com, ask @nobody or @Opus.', models)).toEqual([
      { text: 'use ' }, { text: '@sol', model: models[2] }, { text: ' for this, mail a@b.com, ask @nobody or ' },
      { text: '@Opus', model: models[0] }, { text: '.' },
    ]);
  });
});
