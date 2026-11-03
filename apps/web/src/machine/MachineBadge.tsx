import { useEffect, useState } from 'react';
import type { MachineInfo } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';

/** Which machine this client talks to, and whether the link is up. */
export function MachineBadge() {
  const client = useClient();
  const status = useConnectionStatus();
  const [machine, setMachine] = useState<MachineInfo | null>(null);

  useEffect(() => {
    if (status === 'open') client.call('machine.get', {}).then(setMachine, () => {});
  }, [client, status]);

  const label =
    status === 'open'
      ? (machine?.name ?? '…')
      : status === 'unauthorized'
        ? 'Not authorised'
        : status === 'connecting'
          ? 'Connecting…'
          : 'Disconnected';

  return (
    <div className={`machine status-${status}`} title={machine ? `accio ${machine.version} · ${machine.platform}` : undefined}>
      <span className="dot" />
      <span>{label}</span>
    </div>
  );
}
