import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { Projects } from '../projects/projects.js';
import { ThreadState } from './state.js';
import { newThread, type Thread } from './thread.js';

function setup(change: (t: Thread) => Thread = t => t) {
  const state = new ThreadState(tmpdir(), {} as Projects, () => {}, () => false);
  const thread = change(newThread({ checkoutId: 'c', projectId: 'p', profileId: 'a' }, '2026-01-01T00:00:00Z'));
  state.list = [thread];
  return { state, thread };
}

const withDelivery = (status: NonNullable<Thread['delivery']>['status']) => (t: Thread): Thread =>
  ({ ...t, delivery: { id: 'd', workVersion: 0, mode: 'ship', policy: 'direct', baseBranch: 'main', requestedAt: '2026-01-01T00:00:00Z', status } });

describe('thread busy rule', () => {
  it('an idle thread can take a turn', () => {
    const { state, thread } = setup();
    expect(state.busy(thread)).toBeUndefined();
    expect(() => state.assertFree(thread)).not.toThrow();
  });

  it('a running turn keeps the thread busy until it ends', () => {
    const { state, thread } = setup();
    state.running.set(thread.id, new AbortController());
    expect(state.busy(thread)).toBe('running');
    expect(() => state.assertFree(thread)).toThrow('This thread is already working. Stop it or wait for it to finish.');
    state.running.delete(thread.id);
    expect(state.busy({ ...thread, status: 'running' })).toBe('running');
  });

  it.each([
    ['closing', 'This machine is shutting down', (s: ThreadState) => { s.closing = true; }],
    ['lifecycle', 'Wait for the current thread action to finish.', (s: ThreadState, id: string) => { s.lifecycle.add(id); }],
    ['stopping', 'Wait for this turn to stop.', (s: ThreadState, id: string) => { const c = new AbortController(); c.abort(); s.running.set(id, c); }],
    ['messages', 'Wait for the messages sent to this thread to be handled.', (s: ThreadState, id: string) => { s.messageOps.set(id, Promise.resolve()); }],
  ] as const)('%s keeps the thread busy, with one message', (reason, message, hold) => {
    const { state, thread } = setup();
    hold(state, thread.id);
    expect(state.busy(thread)).toBe(reason);
    expect(() => state.assertFree(thread)).toThrow(message);
  });

  it.each(['queued', 'running'] as const)('a %s delivery keeps the thread busy', (status) => {
    const { state, thread } = setup(withDelivery(status));
    expect(state.busy(thread)).toBe('delivery');
    expect(() => state.assertFree(thread)).toThrow('Finish or cancel delivery before sending more work.');
  });

  it('queued messages keep the thread busy', () => {
    const { state, thread } = setup(t => ({ ...t, queuedMessages: [{ id: 'm', text: 'next' }] }));
    expect(state.busy(thread)).toBe('queued');
    expect(() => state.assertFree(thread)).toThrow('Send or remove queued messages first.');
  });

  it('names the first reason when several hold', () => {
    const { state, thread } = setup(t => ({ ...t, queuedMessages: [{ id: 'm', text: 'next' }] }));
    state.running.set(thread.id, new AbortController());
    state.lifecycle.add(thread.id);
    expect(state.busy(thread)).toBe('lifecycle');
    state.closing = true;
    expect(state.busy(thread)).toBe('closing');
  });

  it('a stop in progress outranks the turn it stops', () => {
    const { state, thread } = setup();
    const controller = new AbortController();
    state.running.set(thread.id, controller);
    controller.abort();
    expect(state.busy(thread, { allow: ['running'] })).toBe('stopping');
  });

  it('a delivery turn starts on its own queued delivery, but not while another turn runs', () => {
    const { state, thread } = setup(withDelivery('queued'));
    expect(state.busy(thread, { delivering: true })).toBeUndefined();
    state.running.set(thread.id, new AbortController());
    expect(state.busy(thread, { delivering: true })).toBe('running');
  });

  it('releasing a worktree also waits for its owned preview', () => {
    const { state, thread } = setup();
    expect(state.busy(thread, { preview: false })).toBeUndefined();
    expect(state.busy(thread, { preview: true })).toBe('preview');
    expect(() => state.assertFree(thread, { preview: true })).toThrow('Stop the app preview in this worktree first.');
    state.messageOps.set(thread.id, Promise.resolve());
    expect(state.busy(thread, { preview: true })).toBe('messages');
  });

  it('skips the reasons a caller works alongside', () => {
    const { state, thread } = setup(t => ({ ...t, queuedMessages: [{ id: 'm', text: 'next' }] }));
    state.running.set(thread.id, new AbortController());
    state.messageOps.set(thread.id, Promise.resolve());
    // Steering joins the running turn and adds to its queue from inside a message operation.
    expect(state.busy(thread, { allow: ['running', 'queued', 'messages'] })).toBeUndefined();
    expect(state.busy(thread, { allow: ['running', 'messages'] })).toBe('queued');
  });
});
