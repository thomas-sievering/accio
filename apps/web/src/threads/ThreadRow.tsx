import type { ThreadView } from '@accio/protocol';
import { Check, Clock, Undo } from '../app/icons';
import { useProjects } from '../projects/projects';
import { useThreads } from './threads';

/** Where the row is shown decides its trailing mark and hover actions. */
export type RowPlace = 'open' | 'working' | 'snoozed' | 'settled';

export function ThreadRow({ thread: t, place }: { thread: ThreadView; place: RowPlace }) {
  const { selectedId, select, marks, now, settle, snooze, reopen } = useThreads();
  const { state } = useProjects();
  const onShelf = place !== 'open';
  const project = onShelf ? state?.projects.find((p) => p.id === t.projectId)?.name : undefined;
  const mark = marks[t.id];

  return (
    <div className={`row${t.id === selectedId ? ' active' : ''}${place === 'settled' ? ' settled' : ''}`}>
      <button className="row-main" onClick={() => select(t.id)}>
        <span className="row-name">
          {t.title}
          {project && <span className="row-project">{project}</span>}
        </span>
        {place === 'snoozed' && mark?.snoozedUntil && <span className="row-meta">{wakeLabel(mark.snoozedUntil, now)}</span>}
        {place === 'settled' && mark?.settledAt && <span className="row-meta">{timeAgo(mark.settledAt, now)}</span>}
        {t.status === 'running' && place !== 'settled' && <span className="row-working" title="Working" />}
        {place === 'open' && t.status === 'interrupted' && <span className="row-flag interrupted" title="Interrupted" />}
        {place === 'open' && t.status === 'failed' && <span className="row-flag failed" title="Last turn failed" />}
      </button>
      <span className="row-actions">
        {(place === 'open' || place === 'working') && (
          <>
            <button className="row-action" title="Snooze until morning" aria-label="Snooze" onClick={() => snooze(t.id)}>
              <Clock />
            </button>
            <button className="row-action" title="Settle" aria-label="Settle" onClick={() => settle(t.id)}>
              <Check />
            </button>
          </>
        )}
        {place === 'snoozed' && (
          <button className="row-action" title="Wake now" aria-label="Wake" onClick={() => reopen(t.id)}>
            <Undo />
          </button>
        )}
        {place === 'settled' && (
          <button className="row-action" title="Un-settle" aria-label="Un-settle" onClick={() => reopen(t.id)}>
            <Undo />
          </button>
        )}
      </span>
    </div>
  );
}

function timeAgo(iso: string, now: Date): string {
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
