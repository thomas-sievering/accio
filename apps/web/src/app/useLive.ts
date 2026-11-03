import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventName, Events } from '@accio/protocol';
import { useClient } from './connection';
import { observeLive } from './observeLive';

/**
 * Server state that the client loads once per connection and then keeps current
 * from pushed events. The client never holds state of its own (GLOSSARY: Client).
 */
export function useLive<E extends EventName>(load: () => Promise<Events[E]>, event: E): Events[E] | undefined {
  const state = useLiveState(load, event);
  useEffect(() => {
    if (state.error) console.error(`Could not load ${event}; reconnect to retry: ${state.error}`);
  }, [event, state.error]);
  return state.value;
}

/** Use when a view can offer an inline load error and retry action. */
export function useLiveState<E extends EventName>(load: () => Promise<Events[E]>, event: E) {
  const client = useClient();
  const [state, setState] = useState<{ value?: Events[E]; error?: string }>({});
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => {
    setState((previous) => ({ value: previous.value }));
    return observeLive(client, event, () => latestLoad.current(), (value) => setState({ value }), (error) => {
      setState((previous) => ({ ...previous, error: error instanceof Error ? error.message : String(error) }));
    });
  }, [client, event, attempt]);
  return { ...state, retry };
}

export function useLocalState<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const client = useClient();
  key = `accio:${client.hubId}:${key}`;
  const [value, setValue] = useState<T>(() => (localStorage.getItem(key) as T | null) ?? initial);
  return [
    value,
    (v) => {
      localStorage.setItem(key, v);
      setValue(v);
    },
  ];
}
