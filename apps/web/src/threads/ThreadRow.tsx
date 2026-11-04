import type { ThreadView } from '@accio/protocol';
import { useTooltip } from '../app/Tooltip';
import { Check, Clock, StopSquare, Undo } from '../app/icons';
import { ProjectMark } from '../projects/ProjectMark';
import { useProjects } from '../projects/projects';
import { useNeedsSecret } from '../secrets/pendingSecrets';
import { StatusGlyphIcon } from './StatusMark';
import { shortStatus, statusText, threadStatus } from './status';
import { RowRename, useRenaming, useThreadMenu } from './ThreadMenu';
import { snoozeThread } from './SnoozeNotice';
import { wakeText, type ShelfPlace } from './shelves';
import { useThreads, type ThreadActions } from './threads';

/**
 * Compact rows keep project identity and activity secondary to the title.
 * Hover shows the actions that fit the thread; right-click shows them all.
 */
export function ThreadRow({ thread: t, place }: { thread: ThreadView; place: ShelfPlace }) {
  const { selectedId, select, now, act } = useThreads();
  const { state } = useProjects();
  const project = state?.projects.find((p) => p.id === t.projectId)?.name;
  // Every row has the same layout; only open rows carry the live status mark.
  const open = place === 'open';
  // Only a running turn can wait on a secret.
  const needsSecret = (useNeedsSecret(t.id) || t.needsSecret === true) && t.status === 'running' && open;
  const openMenu = useThreadMenu();
  const [renamingId] = useRenaming();
  const renaming = renamingId === t.id;
  const titleTip = useTooltip(t.title, '.row-title');
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // Shift+F10 and the menu key report no pointer: open under the row instead.
    if (e.clientX === 0 && e.clientY === 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      openMenu(t, rect.left + 24, rect.bottom);
    } else openMenu(t, e.clientX, e.clientY);
  };

  const actions = (
    <span className="row-actions">
      {hoverActions(t, place).map((a) => (
        <button
          key={a.label}
          className="row-action"
          // Pointer shortcuts only; the keyboard reaches the same actions through the row menu (Shift+F10).
          tabIndex={-1}
          title={a.title}
          aria-label={a.label}
          onClick={() => void (a.run === 'snooze' ? snoozeThread(act, t.id) : act[a.run](t.id)).catch((e: Error) => console.error(e.message))}
        >
          {a.icon}
        </button>
      ))}
    </span>
  );
  const status = threadStatus(t, { needsSecret });
  const statusLine = statusText(status.label, status.delivery?.pullRequest);
  const delivery = status.delivery;
  // Shelved rows say nothing of an idle turn; a delivery outcome stays visible.
  const showState = status.showLabel && (open || !!delivery);
  const className = `row open${t.id === selectedId ? ' active' : ''}${place === 'settled' ? ' settled' : ''}`;
  const Main = renaming ? 'div' : 'button';
  return (
    <div className={`${className}${renaming ? ' renaming' : ''}`} onContextMenu={onContextMenu}>
      <Main className="row-main" {...(renaming ? {} : { ...titleTip.props, onClick: () => select(t.id), title: `${t.title} · ${project ?? 'No project'}${showState ? ` · ${statusLine}` : ''}`, 'aria-current': t.id === selectedId ? 'page' as const : undefined })}>
        {t.projectId ? <ProjectMark id={t.projectId} /> : <span className="no-project-mark" />}
        <span className="row-name">
          {renaming ? <RowRename thread={t} /> : <span className="row-title">{t.title}</span>}
          {/* A delivery status takes the whole line: the project mark already names the project. */}
          <span className={`row-project${showState ? ' with-state' : ''}${delivery && showState ? ' delivery' : ''}`}>
            {!(delivery && showState) && <span className="row-project-name">{project ?? 'No project'}</span>}
            {showState && <span className={`row-state tone-${status.tone}`}>
              <span className="row-state-label">{delivery ? shortStatus(status.label) : status.label}</span>
              {delivery?.pullRequest && <span className="row-state-pr">&nbsp;· #{delivery.pullRequest.number}</span>}
            </span>}
          </span>
        </span>
        <span className="row-status">
          <span className="row-meta">{meta(t, place, now)}</span>
          {open && <span className={`row-mark tone-${status.tone}`} role="img" aria-label={statusLine}>
            <StatusGlyphIcon glyph={status.glyph} tone={status.tone} />
          </span>}
        </span>
      </Main>
      {actions}
      {!renaming && titleTip.tooltip}
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

function meta(t: ThreadView, place: ShelfPlace, now: Date): string {
  if (place === 'snoozed' && t.snoozedUntil) return wakeText(new Date(t.snoozedUntil), now);
  if (place === 'settled' && t.settledAt) return timeAgo(t.settledAt, now);
  return timeAgo(t.updatedAt, now);
}

function timeAgo(iso: string, now: Date): string {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}
