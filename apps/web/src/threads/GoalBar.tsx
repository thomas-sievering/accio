import type { ThreadView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Check, Close, Pause, Play, Target } from '../app/icons';
import { useAction } from '../app/useAction';

/** GLOSSARY: Goal. One line above the composer: the objective, where it stands, and pause, resume or clear. */
export function GoalBar({ thread }: { thread: ThreadView }) {
  const client = useClient();
  const { busy, error, run } = useAction();
  const goal = thread.goal;
  if (!goal) return null;
  const act = (action: 'pause' | 'resume' | 'clear') => void run(() => client.call('threads.goal', { threadId: thread.id, action }));
  const state = goal.status === 'active' ? 'working' : goal.status;
  return (
    <section className={`goal-bar ${goal.status}`} aria-label="Goal">
      {goal.status === 'achieved' ? <Check /> : <Target />}
      <span className="goal-objective" title={goal.objective}>{goal.objective}</span>
      <span className="goal-state" title={goal.detail}>{state}{goal.detail && goal.status !== 'active' ? ` · ${goal.detail}` : ''}</span>
      {goal.status === 'active' && <button aria-label="Pause goal" title="Pause goal" disabled={busy} onClick={() => act('pause')}><Pause /></button>}
      {goal.status === 'paused' && <button aria-label="Resume goal" title="Resume goal" disabled={busy} onClick={() => act('resume')}><Play /></button>}
      <button aria-label="Clear goal" title="Clear goal" disabled={busy} onClick={() => act('clear')}><Close /></button>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
