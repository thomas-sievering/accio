import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TranscriptItem } from '@accio/protocol';
import { useClient } from '../app/connection';

type Pending = Record<string, string[]>;
type Ctx = { pending: Pending; report: (threadId: string, items: TranscriptItem[]) => void };

const PendingCtx = createContext<Ctx | null>(null);

const pendingIds = (items: TranscriptItem[]) => items.flatMap((i) => i.kind === 'secret' && i.status === 'pending' ? [i.id] : []);
const same = (a: string[] | undefined, b: string[]) => (a?.length ?? 0) === b.length && b.every((id) => a?.includes(id));

/**
 * Which threads have an unanswered secret request, for the sidebar's quiet
 * "Needs a secret" mark. Learns from the open transcript and from item events
 * seen on this connection; forgets everything on reconnect, so a thread is never
 * marked from stale knowledge. A thread whose request began before this client
 * connected is marked once it is opened.
 */
export function PendingSecretsProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const [pending, setPending] = useState<Pending>({});

  useEffect(() => {
    const offItem = client.onEvent('thread.item', ({ threadId, item }) => {
      if (item.kind !== 'secret') return;
      setPending((p) => {
        const without = (p[threadId] ?? []).filter((id) => id !== item.id);
        const next = item.status === 'pending' ? [...without, item.id] : without;
        return same(p[threadId], next) ? p : { ...p, [threadId]: next };
      });
    });
    const offStatus = client.onStatus(() => setPending({}));
    return () => { offItem(); offStatus(); };
  }, [client]);

  const report = useCallback((threadId: string, items: TranscriptItem[]) => {
    const next = pendingIds(items);
    setPending((p) => same(p[threadId], next) ? p : { ...p, [threadId]: next });
  }, []);

  const value = useMemo(() => ({ pending, report }), [pending, report]);
  return <PendingCtx.Provider value={value}>{children}</PendingCtx.Provider>;
}

function usePending(): Ctx {
  const c = useContext(PendingCtx);
  if (!c) throw new Error('usePendingSecrets outside PendingSecretsProvider');
  return c;
}

/** True while this thread has a secret request waiting for an answer. */
export function useNeedsSecret(threadId: string): boolean {
  return (usePending().pending[threadId]?.length ?? 0) > 0;
}

/** The open thread's transcript is authoritative for its own mark. */
export function useReportPendingSecrets(threadId: string, items: TranscriptItem[] | undefined) {
  const { report } = usePending();
  useEffect(() => { if (items) report(threadId, items); }, [report, threadId, items]);
}
