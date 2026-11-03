import type { EventName, Events } from '@accio/protocol';
import type { RpcClient } from './rpcClient';

/** Replacement events are authoritative over an older in-flight list request. */
export function observeLive<E extends EventName>(
  client: Pick<RpcClient, 'status' | 'onStatus' | 'onEvent'>,
  event: E,
  load: () => Promise<Events[E]>,
  publish: (value: Events[E]) => void,
  failed: (error: unknown) => void,
): () => void {
  let active = true;
  let generation = 0;
  let revision = 0;
  const offEvent = client.onEvent(event, (value) => {
    if (!active || client.status !== 'open') return;
    ++revision;
    publish(value);
  });
  const connect = () => {
    const current = ++generation;
    if (client.status !== 'open') return;
    const before = revision;
    void load().then((value) => {
      if (active && current === generation && before === revision && client.status === 'open') publish(value);
    }, (error: unknown) => {
      if (active && current === generation && before === revision && client.status === 'open') failed(error);
    });
  };
  const offStatus = client.onStatus(connect);
  connect();
  return () => {
    active = false;
    ++generation;
    offStatus();
    offEvent();
  };
}
