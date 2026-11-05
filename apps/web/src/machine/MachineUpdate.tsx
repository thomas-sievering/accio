import { useEffect, useState } from 'react';
import type { MachineView, UpdateView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useAction } from '../app/useAction';
import { SettingRow } from '../app/Settings';

/** GLOSSARY: Update. Where a connected machine stands against main, kept current, and how to start its update. */
export function useMachineUpdate(machine: Pick<MachineView, 'id' | 'connected'>) {
  const client = useClient();
  const [view, setView] = useState<UpdateView>();
  const [unavailable, setUnavailable] = useState<string>();
  const action = useAction();
  useEffect(() => {
    setUnavailable(undefined);
    if (!machine.connected) { setView(undefined); return; }
    let active = true;
    const off = client.onEvent('update.changed', (next) => { if (next.machineId === machine.id) setView(next); });
    // Such as a machine whose Accio predates updates.
    void client.call('update.status', { machineId: machine.id }).then((next) => { if (active) setView(next); }, (e: Error) => { if (active) setUnavailable(e.message); });
    return () => { active = false; off(); };
  }, [client, machine.id, machine.connected]);
  const canUpdate = !!view && (view.state === 'behind' || (view.state === 'failed' && !!view.behind));
  const start = () => action.run(async () => setView(await client.call('update.start', { machineId: machine.id })));
  return { view, unavailable, canUpdate, start, busy: action.busy, error: action.error };
}

/** GLOSSARY: Update. The machine's Accio version, and one button when origin/main is ahead of it. */
export function MachineUpdate({ machine }: { machine: MachineView }) {
  const { view, unavailable, canUpdate, start, busy, error } = useMachineUpdate(machine);
  return (
    <SettingRow title="Accio version" description={error ?? describeUpdate(view) ?? unavailable}>
      <code title={view?.commit ?? undefined}>{machine.version}</code>
      {canUpdate && <button type="button" className="ghost" disabled={busy} onClick={start}>Update</button>}
    </SettingRow>
  );
}

export function describeUpdate(view?: UpdateView) {
  if (!view) return undefined;
  const commits = `${view.behind} commit${view.behind === 1 ? '' : 's'} behind main`;
  switch (view.state) {
    case 'behind': return commits;
    case 'updating': return `${view.detail ?? 'Updating'}…`;
    case 'restarting': return 'Restarting…';
    case 'blocked': return view.detail;
    case 'failed': return `Update failed and was rolled back: ${view.detail?.split('\n').filter(Boolean).at(-1) ?? ''}`;
    default: return undefined;
  }
}
