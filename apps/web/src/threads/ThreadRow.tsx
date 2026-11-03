import type { ThreadView } from '@accio/protocol';
import { Check, Clock, StopSquare, Undo } from '../app/icons';
import { ProjectMark } from '../projects/ProjectMark';
import { useProjects } from '../projects/projects';
import { useNeedsSecret } from '../secrets/pendingSecrets';
import { StatusGlyphIcon } from './StatusMark';
import { statusText, threadStatus } from './status';
import { useThreadMenu } from './ThreadMenu';
import type { ShelfPlace } from './shelves';
import { useThreads, type ThreadActions } from './threads';

/**
 * Compact rows keep project identity and activity secondary to the title.
 * Hover shows the actions that fit the thread; right-click shows them all.
 */
export function ThreadRow({ thread: t, place }: { thread: ThreadView; place: ShelfPlace }) {
  const { selectedId, select, now, act } = useThreads();
  const { state } = useProjects();
  const project = state?.projects.find((p) => p.id === t.projectId)?.name;
  // Working rows keep the full open look: project mark and the spinning status.
  const open = place === 'open' || place === 'working';
  // Only a running turn can wait on a secret; the mark stays on the Working shelf row.
  const needsSecret = (useNeedsSecret(t.id) || t.needsSecret === true) && t.status === 'running' && place === 'working';
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
  const status = threadStatus(t, { needsSecret });
  const statusLine = statusText(status.label, status.delivery?.pullRequest);
  const delivery = status.delivery;
  // Shelved rows are one line: a delivery outcome stays visible as a badge, also on hover.
  const badge = !open && delivery && <span className={`row-badge tone-${delivery.tone}`} title={statusText(delivery.label, delivery.pullRequest)}>
    <StatusGlyphIcon glyph={delivery.glyph} tone={delivery.tone} />{delivery.badge}
  </span>;
  const className = `row${open ? ' open' : ''}${t.id === selectedId ? ' active' : ''}${place === 'settled' ? ' settled' : ''}`;
  return (
    <div className={className} onContextMenu={onContextMenu}>
      <button className="row-main" onClick={() => select(t.id)} title={`${t.title} · ${project ?? 'No project'}${status.showLabel ? ` · ${statusLine}` : ''}`} aria-current={t.id === selectedId ? 'page' : undefined}>
        {open && (t.projectId ? <ProjectMark id={t.projectId} /> : <span className="no-project-mark" />)}
        <span className="row-name">
          <span className="row-title">{t.title}</span>
          {open ? <span className={`row-project${status.showLabel ? ' with-state' : ''}`}>
            <span className="row-project-name">{project ?? 'No project'}</span>
            {status.showLabel && <span className={`row-state tone-${status.tone}`}>
              <span className="row-state-label">{status.label}</span>
              {delivery?.pullRequest && <span className="row-state-pr">&nbsp;· #{delivery.pullRequest.number}</span>}
            </span>}
          </span> : project && <span className="row-project">{project}</span>}
        </span>
        {badge}
        {open && <span className="row-status">
          <span className="row-meta">{timeAgo(t.updatedAt, now)}</span>
          <span className={`row-mark tone-${status.tone}`} role="img" aria-label={statusLine}>
            <StatusGlyphIcon glyph={status.glyph} tone={status.tone} />
          </span>
        </span>}
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
