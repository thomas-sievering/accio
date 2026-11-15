import type { ThreadView, WaitCondition } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Clock, Close } from '../app/icons';
import { useAction } from '../app/useAction';
import { useThreadAvailability } from './useThreadAvailability';

/** GLOSSARY: Wait. One line above the composer: what the thread waits for, and Cancel. */
export function WaitBar({ thread }: { thread: ThreadView }) {
  const client = useClient();
  const { unavailable } = useThreadAvailability(thread);
  const { busy, error, run } = useAction();
  const wait = thread.wait;
  if (!wait) return null;
  const joiner = wait.wakeWhen === 'all' ? ' and ' : ' or ';
  const met = wait.conditions.filter(c => c.metAt).length;
  const pending = wait.conditions.find(c => !c.metAt && c.detail)?.detail;
  return (
    <section className="goal-bar wait-bar" aria-label="Wait" title={unavailable}>
      <Clock />
      <span className="goal-objective" title={`When it wakes: ${wait.note}`}>
        Waiting for {wait.conditions.map((c, i) => <span key={i} className={c.metAt ? 'wait-met' : undefined}>{i ? joiner : ''}{conditionLabel(c)}</span>)}
      </span>
      {wait.wakeWhen === 'all' && wait.conditions.length > 1 && <span className="goal-state">{met} of {wait.conditions.length} met</span>}
      {pending && <span className="goal-state" title={pending}>{pending}</span>}
      <button aria-label="Cancel wait" title="Cancel wait" disabled={!!unavailable || busy} onClick={() => void run(() => client.call('threads.cancelWait', { threadId: thread.id }))}><Close /></button>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

export function conditionLabel(c: WaitCondition, now = new Date()): string {
  switch (c.kind) {
    case 'thread': return `“${c.title}” ${c.until === 'stopped' ? 'to stop' : c.until === 'pr_open' ? 'to open a PR' : 'to be delivered'}`;
    case 'pullRequest': {
      const number = /\/pull\/(\d+)/.exec(c.ref)?.[1] ?? c.ref;
      return `PR #${number} ${c.until === 'merged' ? 'to merge' : 'to finish its checks'}`;
    }
    case 'after': {
      const at = new Date(c.at);
      const sameDay = at.toDateString() === now.toDateString();
      return `${sameDay ? '' : `${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} `}${at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    }
    case 'command': return `\`${c.command.length > 60 ? `${c.command.slice(0, 59)}…` : c.command}\` to exit`;
  }
}
