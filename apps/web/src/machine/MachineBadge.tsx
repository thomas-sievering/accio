import { useClient, useConnectionStatus } from '../app/connection';
import { useLive } from '../app/useLive';

/** Which machine this client talks to, and whether the link is up. */
export function MachineBadge({ onOpen }: { onOpen: () => void }) {
  const client = useClient();
  const status = useConnectionStatus();
  const machines = useLive(() => client.call('machines.list', {}), 'machines.changed');
  const machine = machines?.find((m) => m.thisMachine);

  const label =
    status === 'open'
      ? (machine?.name ?? '…')
      : status === 'unauthorized'
        ? 'Not authorised'
        : status === 'connecting'
          ? 'Connecting…'
          : 'Disconnected';

  return (
    <button className={`machine status-${status}`} title={machine ? `accio ${machine.version} · ${machine.platform}` : undefined} onClick={onOpen}>
      <span className="dot" />
      <span>{label}</span>
    </button>
  );
}
