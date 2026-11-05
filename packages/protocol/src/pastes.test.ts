import { describe, expect, it } from 'vitest';
import { foldsPaste, joinPastes, lineCount, pastesIn, splitPastes, summarizePastes, typedText } from './pastes.js';

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
