import type { EventName, Events, MethodName, ParamsOf, ResultOf } from '@accio/protocol';
import type { ConnectionStatus } from '../app/rpcClient';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Explicit request/event/connection scheduling, with no timers or providers. */
export class ObservationClient {
  status: ConnectionStatus = 'open';
  readonly requests: { method: MethodName; params: unknown; result: ReturnType<typeof deferred<unknown>> }[] = [];
  private events = new Map<EventName, Set<(value: unknown) => void>>();
  private statuses = new Set<(status: ConnectionStatus) => void>();

  call<M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    const result = deferred<unknown>();
    this.requests.push({ method, params, result });
    return result.promise as Promise<ResultOf<M>>;
  }
  onEvent<E extends EventName>(event: E, listener: (value: Events[E]) => void) {
    const listeners = this.events.get(event) ?? new Set();
    listeners.add(listener as (value: unknown) => void);
    this.events.set(event, listeners);
    return () => { listeners.delete(listener as (value: unknown) => void); };
  }
  onStatus(listener: (status: ConnectionStatus) => void) {
    this.statuses.add(listener);
    return () => { this.statuses.delete(listener); };
  }
  emit<E extends EventName>(event: E, value: Events[E]) {
    for (const listener of this.events.get(event) ?? []) listener(value);
  }
  setStatus(status: ConnectionStatus) {
    this.status = status;
    for (const listener of this.statuses) listener(status);
  }
  get listenerCount() {
    return this.statuses.size + [...this.events.values()].reduce((count, listeners) => count + listeners.size, 0);
  }
}
