import { describe, expect, it } from 'vitest';
import type { TranscriptItem } from '@accio/protocol';
import {
  RESUME_PROMPT,
  assertResumable,
  closeOpenTools,
  dropUnstarted,
  endTurn,
  fromStored,
  newThread,
  recoverAfterRestart,
  reopen,
  retryOf,
  settle,
  snooze,
  startTurn,
  titleFrom,
} from './thread.js';

const t0 = newThread({ checkoutId: 'c', projectId: 'p', profileId: 'a' }, '2026-01-01T00:00:00Z');

describe('thread lifecycle', () => {
  it('names the thread after the first message only', () => {
    const running = startTurn(t0, 'Fix the build\nit fails on CI', 'now');
    expect(running).toMatchObject({ status: 'running', title: 'Fix the build' });
    const again = startTurn(endTurn(running, 'completed', 'now'), 'something else', 'now');
    expect(again.title).toBe('Fix the build');
  });

  it('allows one turn at a time', () => {
    expect(() => startTurn(startTurn(t0, 'a', 'now'), 'b', 'now')).toThrow(/already working/);
  });

  it('maps turn outcomes to thread status', () => {
    const r = startTurn(t0, 'a', 'now');
    expect(endTurn(r, 'completed', 'now').status).toBe('idle');
    expect(endTurn(r, 'failed', 'now').status).toBe('failed');
    expect(endTurn(r, 'interrupted', 'now').status).toBe('interrupted');
  });

  it('marks turns that were running at restart as interrupted, and only those', () => {
    const running = startTurn(t0, 'a', 'now');
    const idle = { ...t0, id: 'other' };
    const { threads, interrupted } = recoverAfterRestart([running, idle]);
    expect(threads.map((t) => t.status)).toEqual(['interrupted', 'idle']);
    expect(interrupted.map((t) => t.id)).toEqual([running.id]);
  });

  it('resumes only interrupted threads', () => {
    expect(() => assertResumable(t0)).toThrow(/Only an interrupted/);
    expect(() => assertResumable({ ...t0, status: 'interrupted' })).not.toThrow();
  });

  it('closes tool calls left in flight', () => {
    const items: TranscriptItem[] = [
      { kind: 'tool', id: 'x', turnId: 't', name: 'Bash', summary: 'sleep', status: 'running' },
      { kind: 'tool', id: 'y', turnId: 't', name: 'Read', summary: 'a', status: 'done' },
    ];
    expect(closeOpenTools(items).map((i) => (i.kind === 'tool' ? i.status : ''))).toEqual(['error', 'done']);
  });

  it('shortens long titles', () => {
    expect(titleFrom('x'.repeat(80))).toHaveLength(60);
  });

  it('drops threads from before a first message was required, and keeps every other', () => {
    const named = startTurn(t0, 'a', 'now');
    expect(dropUnstarted([t0, endTurn(named, 'completed', 'now')]).map((t) => t.title)).toEqual(['a']);
  });
});

describe('shelving', () => {
  it('snoozes, settles and reopens, one shelf at a time', () => {
    const snoozed = snooze(t0, '2026-01-02T09:00:00Z');
    expect(snoozed).toMatchObject({ snoozedUntil: '2026-01-02T09:00:00Z', settledAt: null });
    const settled = settle(snoozed, 'now');
    expect(settled).toMatchObject({ snoozedUntil: null, settledAt: 'now' });
    expect(reopen(settled)).toMatchObject({ snoozedUntil: null, settledAt: null });
  });

  it('reopens a thread when you send it a message', () => {
    expect(startTurn(settle(t0, 'now'), 'a', 'now')).toMatchObject({ settledAt: null, snoozedUntil: null });
  });

  it('fills in shelf fields for threads stored before they existed', () => {
    const { snoozedUntil: _s, settledAt: _d, ...old } = t0;
    expect(fromStored(old)).toMatchObject({ snoozedUntil: null, settledAt: null });
  });
});

describe('retry', () => {
  const failed = { ...t0, status: 'failed' as const };
  const user = (text: string, resume?: boolean): TranscriptItem => ({
    kind: 'user',
    id: text,
    turnId: text,
    text,
    at: 'x',
    ...(resume ? { resume } : {}),
  });

  it('sends the failed turn’s message again', () => {
    expect(retryOf(failed, [user('first'), user('second')])).toEqual({ text: 'second', resume: false });
  });

  it('resumes again when the failed turn was a resume', () => {
    expect(retryOf(failed, [user('first'), user(RESUME_PROMPT, true)])).toEqual({ text: RESUME_PROMPT, resume: true });
  });

  it('retries only failed threads', () => {
    expect(() => retryOf(t0, [user('a')])).toThrow(/Only a failed/);
  });
});
