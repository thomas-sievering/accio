import { useState } from 'react';
import type { MachineView } from '@accio/protocol';
import { useHubs } from '../app/connection';
import { useAction } from '../app/useAction';
import { SettingRow, SettingsSection, useEscape } from '../app/Settings';

/**
 * GLOSSARY: Pairing. Unpairing another machine from this hub: Revoke asks first and says what it does,
 * then calls the hub's revocation, which closes the machine's connections and deletes its hat keys.
 * `revoked`: revoked from this window and not paired again since; the hub keeps the machine's record.
 */
export function RevokeMachine({ machine, revoked, onRevoked }: { machine: MachineView; revoked: boolean; onRevoked: () => void }) {
  const { hubs, selectedId, root } = useHubs();
  const hub = hubs.find((h) => h.id === selectedId);
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useAction();
  useEscape(confirming, () => setConfirming(false));
  if (!hub) return null;
  if (revoked) return (
    <SettingsSection title="Pairing">
      <SettingRow title="Revoked" description={`${machine.name} no longer has access to ${hub.name}. To use it again, pair it with a new code.`} />
    </SettingsSection>
  );
  const revoke = () => void run(async () => {
    await root.call('hubs.revokeMachine', { id: hub.id, machineId: machine.id });
    setConfirming(false);
    onRevoked();
  });
  return (
    <SettingsSection title="Pairing">
      <div role={confirming ? 'group' : undefined} aria-label={confirming ? `Revoke ${machine.name}?` : undefined}>
        <SettingRow
          title={confirming ? `Revoke ${machine.name}?` : `Paired with ${hub.name}`}
          description={confirming
            ? `${machine.name} loses access to ${hub.name}, and its hat keys are deleted on the Sorting Hat. Its threads stay on that machine. To use ${hub.name} again, it must be paired with a new code.`
            : `Revoke this machine’s pairing if it is lost or retired.`}>
          {confirming ? <>
            <button type="button" className="ghost" disabled={busy} autoFocus onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className="ghost danger" disabled={busy} onClick={revoke}>Revoke {machine.name}</button>
          </> : <button type="button" className="ghost danger" onClick={() => setConfirming(true)}>Revoke</button>}
        </SettingRow>
        {error && <div className="setting-form"><p className="error" role="alert">{error}</p></div>}
      </div>
    </SettingsSection>
  );
}
