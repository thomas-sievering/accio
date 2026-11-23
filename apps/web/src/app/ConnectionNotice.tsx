import { useClient, useConnectionStatus } from './connection';

const labels = { connecting: 'Connecting…', closed: 'Disconnected', unreachable: 'Worker unreachable', unauthorized: 'Not authorised' } as const;

/** Says nothing while the link is up; names the problem when it is not. */
export function ConnectionNotice() {
  const client = useClient();
  const status = useConnectionStatus();
  if (status === 'open') return null;
  const label = client.browser && (status === 'closed' || status === 'unreachable') ? 'Hub unreachable' : labels[status];
  return (
    <span className={`connection-notice status-${status}`} role="status">
      <span className="dot" />
      {label}
    </span>
  );
}
