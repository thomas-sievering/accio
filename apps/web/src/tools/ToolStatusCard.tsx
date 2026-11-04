import type { MachineView, ToolDefinition, ToolStatus } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useAction } from '../app/useAction';
import { useThreads } from '../threads/threads';

export type Readiness = { label: 'Ready' | 'Installing' | 'Needs attention' | 'Offline' | 'Pending'; tone: 'ok' | 'busy' | 'bad' | 'idle' };

/** What one machine's copy of a managed tool looks like right now. */
export function readiness(machine: MachineView | undefined, status: ToolStatus | undefined): Readiness {
  if (machine && !machine.connected) return { label: 'Offline', tone: 'idle' };
  if (status?.status === 'ready') return { label: 'Ready', tone: 'ok' };
  if (status?.status === 'installing') return { label: 'Installing', tone: 'busy' };
  if (status?.status === 'error') return { label: 'Needs attention', tone: 'bad' };
  return { label: 'Pending', tone: 'idle' };
}

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : undefined);
const firstLine = (text?: string) => text?.trim().split(/\r?\n/).find(Boolean);

/**
 * One machine's readiness for one tool, with the actions that fix it. Checks and
 * repairs run on the machine itself, so only this machine's card can start them.
 */
export function ToolStatusCard({ tool, machine, status, heading, onOpenThread }: {
  tool: ToolDefinition;
  machine: MachineView;
  status: ToolStatus | undefined;
  /** What the card is titled by: the machine (on a tool's page) or the tool (on a machine's page). */
  heading: 'machine' | 'tool';
  onOpenThread: (threadId: string) => void;
}) {
  const client = useClient();
  const { threads } = useThreads();
  const { busy, error, run } = useAction();
  const r = readiness(machine, status);
  const local = machine.thisMachine;
  const running = status?.status === 'installing';
  const repairThread = status?.repairThreadId ? threads?.find((t) => t.id === status.repairThreadId) : undefined;
  const title = heading === 'machine' ? `${machine.name}${local ? ' (this machine)' : ''}` : tool.name;
  const remoteReason = `Checks and repairs run on ${machine.name} itself. Starting them from another machine isn’t available yet.`;

  let text: string;
  if (r.label === 'Offline') text = status ? `Last known: ${status.status === 'ready' ? `ready (${status.version ?? tool.version})` : status.status === 'error' ? 'needs attention' : status.status}${status.checkedAt ? `, ${when(status.checkedAt)}` : ''}.` : `${machine.name} hasn’t reported on this tool.`;
  else if (r.label === 'Ready') text = `${status?.version ?? tool.version} · checked ${when(status?.checkedAt) ?? 'just now'}`;
  else if (r.label === 'Installing') text = status?.detail ?? 'Installing and checking…';
  else if (r.label === 'Needs attention') text = status?.detail ?? 'The last check failed.';
  else text = local ? 'Not checked yet.' : `${machine.name} checks it when accio starts there, or before a thread there needs it.`;

  return (
    <div className="tool-card" aria-label={`${title}: ${r.label}`} role="group">
      <div className="tool-card-head">
        <b>{title}</b>
        <span className={`pill ${r.tone}`}><span className="dot" />{r.label}</span>
      </div>
      <p className={`tool-card-text${r.label === 'Needs attention' ? ' failed' : ''}`} title={status?.detail}>
        {r.label === 'Needs attention' ? <code>{text}</code> : r.label === 'Ready' && firstLine(status?.detail) ? <>{text} · <code>{firstLine(status?.detail)}</code></> : text}
      </p>
      {status?.status === 'error' && (
        status.repairThreadId
          ? <p className="hint">{repairThread ? `A repair thread is ${repairThread.status === 'running' ? 'working on it' : 'open'}. accio checks again when it completes.` : 'A repair thread was started but is no longer listed here.'}</p>
          : status.repairError && <p className="warn tool-card-text" role="status">No repair thread: {status.repairError}</p>
      )}
      <div className="tool-card-actions">
        {status?.repairThreadId && repairThread && (
          <button type="button" className="ghost" onClick={() => onOpenThread(repairThread.id)}>Open repair thread</button>
        )}
        {status?.status === 'error' && !status.repairThreadId && (
          <button type="button" className="ghost" disabled={busy || !local} title={local ? undefined : remoteReason} onClick={() => run(() => client.call('tools.repair', { id: tool.id, machineId: machine.id }))}>
            Start repair thread
          </button>
        )}
        <button type="button" className="ghost" disabled={busy || running || !local} title={local ? undefined : remoteReason}
          onClick={() => run(() => client.call('tools.check', { id: tool.id, machineId: machine.id }))}>
          {running ? 'Checking…' : status?.status === 'ready' ? 'Check again' : 'Install and check'}
        </button>
      </div>
      {!local && machine.connected && <p className="hint">{remoteReason}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
