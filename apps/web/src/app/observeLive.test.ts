import { describe, expect, it } from 'vitest';
import type { ThreadView } from '@accio/protocol';
import { deferred, ObservationClient } from '../testing/observationClient';
import { observeLive } from './observeLive';

const old = [{ id: 'old' }] as ThreadView[];
const newer = [{ id: 'newer' }] as ThreadView[];

describe('live replacement observation', () => {
  it('keeps a newer pushed event when the initial load completes later', async () => {
    const client = new ObservationClient();
    const load = deferred<ThreadView[]>();
    let value: ThreadView[] | undefined;
    const stop = observeLive(client, 'threads.changed', () => load.promise, (next) => { value = next; }, () => {});
    client.emit('threads.changed', newer);
    load.resolve(old);
    await Promise.resolve();
    expect(value).toEqual(newer);
    stop();
    expect(client.listenerCount).toBe(0);
  });

  it('ignores disconnected or disposed completions and loads again on reconnect', async () => {
    const client = new ObservationClient();
    const loads = [deferred<ThreadView[]>(), deferred<ThreadView[]>(), deferred<ThreadView[]>()];
    let index = 0;
    let value: ThreadView[] | undefined;
    let failure: unknown;
    const stop = observeLive(client, 'threads.changed', () => loads[index++]!.promise, (next) => { value = next; }, (error) => { failure = error; });
    client.setStatus('closed');
    expect(value).toBeUndefined();
    client.setStatus('open');
    loads[1]!.resolve(newer);
    loads[0]!.resolve(old); // Late completion from the disconnected request.
    await Promise.resolve();
    expect(value).toEqual(newer);
    client.setStatus('closed');
    client.setStatus('open');
    stop();
    loads[2]!.reject(new Error('disposed'));
    await Promise.resolve();
    expect(failure).toBeUndefined();
    expect(client.listenerCount).toBe(0);
  });

  it('reports current load failures but ignores failures superseded by an event', async () => {
    const client = new ObservationClient();
    const loads = [deferred<ThreadView[]>(), deferred<ThreadView[]>()];
    let index = 0;
    const errors: unknown[] = [];
    const stop = observeLive(client, 'threads.changed', () => loads[index++]!.promise, () => {}, (error) => errors.push(error));
    const error = new Error('Could not read threads');
    loads[0]!.reject(error);
    await Promise.resolve();
    expect(errors).toEqual([error]);
    client.setStatus('closed');
    client.setStatus('open');
    client.emit('threads.changed', newer);
    loads[1]!.reject(new Error('obsolete failure'));
    await Promise.resolve();
    expect(errors).toEqual([error]);
    stop();
  });
});
