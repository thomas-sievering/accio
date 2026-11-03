import { useConnectionStatus } from './connection';

const labels = { connecting: 'Connecting…', closed: 'Disconnected', unauthorized: 'Not authorised' } as const;

/** Says nothing while the link is up; names the problem when it is not. */
export function ConnectionNotice() {
  const status = useConnectionStatus();
  if (status === 'open') return null;
  return (
    <span className={`connection-notice status-${status}`} role="status">
      <span className="dot" />
      {labels[status]}
    </span>
  );
}
