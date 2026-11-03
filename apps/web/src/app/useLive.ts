import { useEffect, useState } from 'react';
import type { EventName, Events } from '@accio/protocol';
import { useClient, useConnectionStatus } from './connection';

/**
 * Server state that the client loads once per connection and then keeps current
 * from pushed events. The client never holds state of its own (GLOSSARY: Client).
 */
export function useLive<E extends EventName>(load: () => Promise<Events[E]>, event: E): Events[E] | undefined {
  const client = useClient();
  const status = useConnectionStatus();
  const [value, setValue] = useState<Events[E]>();

  useEffect(() => client.onEvent(event, setValue), [client, event]);
  useEffect(() => {
    if (status === 'open') load().then(setValue, () => {});
    // load is recreated each render; reloading on reconnect is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, status]);

  return value;
}

export function useLocalState<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => (localStorage.getItem(key) as T | null) ?? initial);
  return [
    value,
    (v) => {
      localStorage.setItem(key, v);
      setValue(v);
    },
  ];
}
