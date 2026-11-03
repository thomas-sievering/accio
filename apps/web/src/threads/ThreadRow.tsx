import type { ThreadView } from '@accio/protocol';
import { Check, Clock, Undo } from '../app/icons';
import { ProfileTile, useProfiles } from '../profiles/profiles';
import { useProjects } from '../projects/projects';
import { useThreads } from './threads';

/** Where the row is shown decides its look, trailing mark and hover actions. */
export type RowPlace = 'open' | 'working' | 'snoozed' | 'settled';

/**
 * Open and Working threads are two-line cards (project and status above the
 * title), shelved ones slim rows, as in T3 Code.
 */
export function ThreadRow({ thread: t, place }: { thread: ThreadView; place: RowPlace }) {
  const { selectedId, select, marks, now, settle, snooze, reopen } = useThreads();
  const { state } = useProjects();
  const { profiles = [], filter } = useProfiles();
  const project = state?.projects.find((p) => p.id === t.projectId)?.name;
  const mark = marks[t.id];
  const card = place === 'open' || place === 'working';

  const actions = (
    <span className="row-actions">
      {card && (
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
  );
  const className = `row${card ? ' card' : ''}${t.id === selectedId ? ' active' : ''}${place === 'settled' ? ' settled' : ''}`;

  if (card) {
    return (
      <div className={className}>
        <button className="row-main" onClick={() => select(t.id)}>
          <span className="card-top">
            {filter === 'all' && <ProfileTile profile={profiles.find((a) => a.id === t.profileId)} size="xs" />}
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
    <div className={className}>
      <button className="row-main" onClick={() => select(t.id)}>
        <span className="row-name">
          {t.title}
          {project && <span className="row-project">{project}</span>}
        </span>
        {place === 'snoozed' && mark?.snoozedUntil && <span className="row-meta">{wakeLabel(mark.snoozedUntil, now)}</span>}
        {place === 'settled' && mark?.settledAt && <span className="row-meta">{timeAgo(mark.settledAt, now)}</span>}
      </button>
      {actions}
    </div>
  );
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
