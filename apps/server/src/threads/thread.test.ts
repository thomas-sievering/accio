import { describe, expect, it } from 'vitest';
import type { TranscriptItem } from '@accio/protocol';
import { assertResumable, closeOpenTools, endTurn, newThread, recoverAfterRestart, startTurn, titleFrom } from './thread.js';

const t0 = newThread({ checkoutId: 'c', projectId: 'p', accountId: 'a' }, '2026-01-01T00:00:00Z');

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
});
