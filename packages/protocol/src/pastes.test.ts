import { describe, expect, it } from 'vitest';
import { foldsPaste, joinPastes, lineCount, pastesIn, reactionsIn, retypeMessage, splitPastes, summarizePastes, typedText } from './pastes.js';
import { reactionInfo } from './reactions.js';

describe('Pasted text', () => {
  it('folds a paste once it is long in characters or lines', () => {
    expect(foldsPaste('short')).toBe(false);
    expect(foldsPaste('x'.repeat(4000))).toBe(true);
    expect(foldsPaste('a\n'.repeat(60))).toBe(true);
    expect(lineCount('a\nb\n\n')).toBe(2);
  });

  it('round-trips pastes and typed text, pastes first', () => {
    const message = joinPastes(['log line 1\r\nlog line 2\n', 'second'], '  What failed?  ');
    expect(message.endsWith('What failed?')).toBe(true);
    expect(splitPastes(message)).toEqual([
      { kind: 'paste', text: 'log line 1\nlog line 2' },
      { kind: 'paste', text: 'second' },
      { kind: 'text', text: 'What failed?' },
    ]);
  });

  it('keeps a paste whole when it holds fences of its own', () => {
    const paste = 'before\n```pasted\ninner\n```\n````\nafter';
    const message = joinPastes([paste], 'Explain');
    expect(pastesIn(message)).toEqual([paste]);
    expect(typedText(message)).toBe('Explain');
  });

  it('leaves ordinary text and an unclosed fence alone', () => {
    expect(splitPastes('```ts\nconst a = 1;\n```')).toEqual([{ kind: 'text', text: '```ts\nconst a = 1;\n```' }]);
    expect(splitPastes('```pasted\nno end')).toEqual([{ kind: 'text', text: '```pasted\nno end' }]);
    expect(splitPastes('')).toEqual([]);
  });

  it('summarizes pastes by their size', () => {
    expect(summarizePastes(joinPastes(['a\nb\nc'], 'Why?'))).toBe('[Pasted text · 3 lines]\n\nWhy?');
  });
});

describe('Reaction', () => {
  it('round-trips reactions after pastes and before the typed text', () => {
    const message = joinPastes(['log'], 'Go on', [
      { kind: 'agree', quote: 'Use the existing cache.' },
      { kind: 'unclear', quote: 'It debounces the\nwatcher.' },
    ]);
    expect(message).toContain(`\`\`\`${reactionInfo('unclear')}\nIt debounces the\nwatcher.\n\`\`\``);
    expect(splitPastes(message)).toEqual([
      { kind: 'paste', text: 'log' },
      { kind: 'reaction', reaction: { kind: 'agree', quote: 'Use the existing cache.' } },
      { kind: 'reaction', reaction: { kind: 'unclear', quote: 'It debounces the\nwatcher.' } },
      { kind: 'text', text: 'Go on' },
    ]);
    expect(typedText(message)).toBe('Go on');
  });

  it('sends a reaction alone, and keeps a quote holding fences whole', () => {
    const quote = 'Run\n```sh\nnpm test\n```';
    const message = joinPastes([], '', [{ kind: 'disagree', quote }]);
    expect(reactionsIn(message)).toEqual([{ kind: 'disagree', quote }]);
    expect(typedText(message)).toBe('');
  });

  it('keeps pastes and reactions when the typed text is replaced', () => {
    const message = joinPastes(['log'], 'old', [{ kind: 'agree', quote: 'Yes' }]);
    expect(retypeMessage(message, 'new')).toBe(joinPastes(['log'], 'new', [{ kind: 'agree', quote: 'Yes' }]));
  });

  it('leaves a fence with an unknown reaction as text', () => {
    const text = '```reaction: 🎉 party\nhi\n```';
    expect(splitPastes(text)).toEqual([{ kind: 'text', text }]);
  });

  it('summarizes a reaction by its emoji and the start of its quote', () => {
    expect(summarizePastes(joinPastes([], 'Ok', [{ kind: 'unclear', quote: 'the  watcher\ndebounce' }]))).toBe('[❓ "the watcher debounce"]\n\nOk');
  });
});
