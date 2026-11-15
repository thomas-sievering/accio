import { useEffect, useSyncExternalStore } from 'react';

/**
 * GLOSSARY: Harness skill. The harness the open draft would start on, chosen in its
 * model picker, so the side panel lists that harness's skills before the thread exists.
 */
let current: string | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const set = (value: string | undefined) => { if (value === current) return; current = value; for (const listener of listeners) listener(); };

/** Called by the draft while it is open. */
export function useShareDraftHarness(harnessId: string) {
  useEffect(() => { set(harnessId); }, [harnessId]);
  useEffect(() => () => set(undefined), []);
}

export function useDraftHarness() {
  return useSyncExternalStore(subscribe, () => current);
}
