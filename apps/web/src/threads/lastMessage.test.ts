import { joinPastes, type TranscriptItem } from '@accio/protocol';
import { describe, expect, it } from 'vitest';
import { lastSentText } from './lastMessage';

const user = (id: string, text: string, extra: Partial<Extract<TranscriptItem, { kind: 'user' }>> = {}): TranscriptItem =>
  ({ kind: 'user', id, turnId: id, text, at: '2026-11-15T00:00:00Z', ...extra });

describe('lastSentText', () => {
  it('picks the text of your latest message', () => {
    expect(lastSentText([
      user('1', 'first'),
      { kind: 'assistant', id: 'a', turnId: '1', text: 'reply' },
      user('2', 'second\nline'),
      { kind: 'assistant', id: 'b', turnId: '2', text: 'reply' },
    ])).toBe('second\nline');
  });

  it('skips turns accio started itself', () => {
    expect(lastSentText([
      user('1', 'mine'),
      user('2', 'Continue.', { goal: 'continue' }),
      user('3', 'Wait met: PR merged', { wake: true }),
      user('4', 'Resume.', { resume: true }),
    ])).toBe('mine');
  });

  it('brings back only the typed text, without pastes or reactions', () => {
    expect(lastSentText([user('1', joinPastes(['long log'], 'What failed?', [{ kind: 'agree', quote: 'Yes' }]))])).toBe('What failed?');
  });

  it('has nothing when no message was sent or the last had no typed text', () => {
    expect(lastSentText(undefined)).toBeUndefined();
    expect(lastSentText([])).toBeUndefined();
    expect(lastSentText([user('1', 'earlier'), user('2', joinPastes(['only a paste'], ''))])).toBeUndefined();
  });
});
