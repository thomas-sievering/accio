import type { ThreadView } from '@accio/protocol';
import { Check, Clock, StopSquare, Undo } from '../app/icons';
import { ProjectMark } from '../projects/ProjectMark';
import { useProjects } from '../projects/projects';
import { useThreadMenu } from './ThreadMenu';
import type { ShelfPlace } from './shelves';
import { useThreads, type ThreadActions } from './threads';

/**
 * Open threads are two-line cards (project and status above the title), shelved
 * ones slim rows, as in T3 Code. Hover shows the one or two actions that fit the
 * thread right now; right-click shows them all.
 */
export function ThreadRow({ thread: t, place }: { thread: ThreadView; place: ShelfPlace }) {
  const { selectedId, select, now, act } = useThreads();
  const { state } = useProjects();
  const project = state?.projects.find((p) => p.id === t.projectId)?.name;
  const card = place === 'open';
  const openMenu = useThreadMenu();
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(t, e.clientX, e.clientY);
  };

  const actions = (
    <span className="row-actions">
      {hoverActions(t, place).map((a) => (
        <button
          key={a.label}
          className="row-action"
          title={a.title}
          aria-label={a.label}
          onClick={() => void act[a.run](t.id).catch((e: Error) => console.error(e.message))}
        >
          {a.icon}
        </button>
      ))}
    </span>
  );
  const className = `row${card ? ' card' : ''}${t.id === selectedId ? ' active' : ''}${place === 'settled' ? ' settled' : ''}`;

  if (card) {
    return (
      <div className={className} onContextMenu={onContextMenu}>
        <button className="row-main" onClick={() => select(t.id)}>
          <span className="card-top">
            <ProjectMark id={t.projectId} />
            <span className="card-project">{project}</span>
            <CardStatus thread={t} now={now} />
          </span>
          <span className="row-name">{t.title}</span>
        </button>
        {actions}
      </div>
    );
  }
  return (
    <div className={className} onContextMenu={onContextMenu}>
      <button className="row-main" onClick={() => select(t.id)}>
        <span className="row-name">
          {t.title}
          {project && <span className="row-project">{project}</span>}
        </span>
        {place === 'snoozed' && t.snoozedUntil && <span className="row-meta">{wakeLabel(t.snoozedUntil, now)}</span>}
        {place === 'settled' && t.settledAt && <span className="row-meta">{timeAgo(t.settledAt, now)}</span>}
      </button>
      {actions}
    </div>
  );
}

type HoverAction = { label: string; title: string; icon: React.ReactNode; run: keyof ThreadActions };

/** A running thread offers Stop; an open one Snooze and Settle; a shelved one the way back. */
function hoverActions(t: ThreadView, place: ShelfPlace): HoverAction[] {
  if (place === 'snoozed') return [{ label: 'Wake', title: 'Wake now', icon: <Undo />, run: 'reopen' }];
  if (place === 'settled') return [{ label: 'Reopen', title: 'Reopen', icon: <Undo />, run: 'reopen' }];
  if (t.status === 'running') return [{ label: 'Stop', title: 'Stop this turn', icon: <StopSquare />, run: 'stop' }];
  return [
    { label: 'Snooze', title: 'Snooze until morning', icon: <Clock />, run: 'snooze' },
    { label: 'Settle', title: 'Settle', icon: <Check />, run: 'settle' },
  ];
}

function CardStatus({ thread: t, now }: { thread: ThreadView; now: Date }) {
  if (t.status === 'running')
    return (
      <span className="card-status working">
        <span className="row-working" />
        Working
      </span>
    );
  if (t.status === 'interrupted') return <span className="card-status interrupted">Interrupted</span>;
  if (t.status === 'failed') return <span className="card-status failed">Failed</span>;
  return <span className="card-status">{timeAgo(t.updatedAt, now)}</span>;
}

export function timeAgo(iso: string, now: Date): string {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

function wakeLabel(iso: string, now: Date): string {
  const when = new Date(iso);
  const time = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return when.toDateString() === now.toDateString() ? time : `${when.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}
