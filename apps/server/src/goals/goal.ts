import { z } from 'zod';
import type { ThreadGoal } from '@accio/protocol';
import { accioTool } from '../tools/tools.js';
import { UserError } from '../rpc/router.js';

/**
 * GLOSSARY: Goal. The same on every harness: accio keeps the goal, tells the
 * harness about it each turn, starts the next turn itself, and offers
 * `finish_goal` only while a goal is active. No harness's own goal feature is used.
 */
export const MAX_OBJECTIVE = 4000;
export const FINISH_GOAL_TOOL = 'finish_goal';

export type GoalCommand = { type: 'set'; objective: string } | { type: 'pause' | 'resume' | 'clear' };

/** `/goal <objective>`, `/goal pause`, `/goal resume` or `/goal clear`; undefined for any other message. */
export function parseGoalCommand(text: string): GoalCommand | undefined {
  const match = /^\/goal(?:\s+([\s\S]*))?$/u.exec(text.trim());
  if (!match) return undefined;
  const argument = (match[1] ?? '').trim();
  const lower = argument.toLowerCase();
  if (lower === 'pause' || lower === 'resume' || lower === 'clear') return { type: lower };
  return { type: 'set', objective: argument };
}

export function newGoal(objective: string, at: string): ThreadGoal {
  if (!objective) throw new UserError('Write the objective after /goal, such as /goal make the e2e tests pass.');
  if (objective.length > MAX_OBJECTIVE) throw new UserError(`Keep the goal under ${MAX_OBJECTIVE} characters.`);
  return { objective, status: 'active', turns: 0, setAt: at };
}

/** A turn on an active goal starts; it counts toward the limit. */
export function goalTurnStarted(goal: ThreadGoal | undefined): ThreadGoal | undefined {
  return goal?.status === 'active' ? { ...goal, turns: goal.turns + 1 } : goal;
}

export type GoalNext = { goal: ThreadGoal | undefined; continue: boolean };

/**
 * After a turn ends: keep going on a completed turn that did some work, pause on
 * anything else. There is no turn limit, as in Claude Code and Codex; a turn that
 * used no tools is the stall guard, since it only talked. A goal the harness
 * finished during the turn is left as it is.
 */
export function afterGoalTurn(goal: ThreadGoal | undefined, outcome: 'completed' | 'interrupted' | 'failed', usedTools: boolean): GoalNext {
  if (goal?.status !== 'active') return { goal, continue: false };
  if (outcome === 'interrupted') return { goal: { ...goal, status: 'paused', detail: 'Stopped.' }, continue: false };
  if (outcome === 'failed') return { goal: { ...goal, status: 'paused', detail: 'The last turn failed.' }, continue: false };
  if (!usedTools) return { goal: { ...goal, status: 'paused', detail: 'No progress in the last turn.' }, continue: false };
  return { goal, continue: true };
}

export function resumeGoal(goal: ThreadGoal | undefined): ThreadGoal {
  if (!goal) throw new UserError('This thread has no goal. Set one with /goal <objective>.');
  if (goal.status === 'achieved') throw new UserError('This goal is achieved. Set a new one with /goal <objective>.');
  return { ...goal, status: 'active', detail: undefined };
}

export function pauseGoal(goal: ThreadGoal | undefined): ThreadGoal {
  if (goal?.status !== 'active') throw new UserError('There is no active goal to pause.');
  return { ...goal, status: 'paused', detail: undefined };
}

/** What the harness reads about the goal at the start of every turn on it. */
export function goalInstructions(goal: ThreadGoal | undefined): string | undefined {
  if (goal?.status !== 'active') return undefined;
  return [
    `Goal for this thread: ${goal.objective}`,
    'Work toward it until it is achieved and verified. accio starts your next turn automatically while the goal is active, and pauses it after a turn that uses no tools.',
    `When the goal is achieved and you have checked it, call ${FINISH_GOAL_TOOL} with outcome "achieved" and the evidence. If you cannot continue without the user, call it with outcome "blocked" and what you need. Do not call it otherwise.`,
  ].join('\n');
}

/** What the harness reads for a `/goal <objective>` message. */
export function newGoalPrompt(objective: string): string {
  return `New goal for this thread: ${objective}

Start working toward it.`;
}

/** The prompt of a turn accio starts itself. */
export const CONTINUE_PROMPT = 'Continue working toward the goal.';

export const finishGoalInput = {
  outcome: z.enum(['achieved', 'blocked']).describe('"achieved" once the goal is met and verified; "blocked" when you need the user to continue'),
  summary: z.string().trim().min(1).max(2000).describe('The evidence it is achieved, or what you need from the user'),
};

/** The accio tool, bound to how this machine records the result. */
export function finishGoalTool(finish: (threadId: string, outcome: 'achieved' | 'blocked', summary: string) => Promise<void>, active: (threadId: string) => boolean) {
  return accioTool({
    name: FINISH_GOAL_TOOL,
    description: "Report that this thread's goal is achieved and verified, or that you are blocked and need the user. accio then stops starting new turns for it. Finish your reply after calling it.",
    input: finishGoalInput,
    available: active,
    call: async ({ outcome, summary }, { threadId }) => {
      await finish(threadId, outcome, summary);
      return outcome === 'achieved' ? 'Goal marked achieved. Summarize the result for the user and end your turn.' : 'Goal paused. Tell the user what you need and end your turn.';
    },
  });
}

/** Applies what the harness reported. */
export function finishGoal(goal: ThreadGoal | undefined, outcome: 'achieved' | 'blocked', summary: string): ThreadGoal {
  if (goal?.status !== 'active') throw new UserError('This thread has no active goal.');
  return { ...goal, status: outcome === 'achieved' ? 'achieved' : 'paused', detail: summary };
}
