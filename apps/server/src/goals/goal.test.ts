import { expect, it } from 'vitest';
import { afterGoalTurn, finishGoal, goalInstructions, goalTurnStarted, newGoal, parseGoalCommand, pauseGoal, resumeGoal } from './goal.js';

it('reads /goal commands and leaves other messages alone', () => {
  expect(parseGoalCommand('/goal make the e2e tests pass')).toEqual({ type: 'set', objective: 'make the e2e tests pass' });
  expect(parseGoalCommand('  /goal Pause ')).toEqual({ type: 'pause' });
  expect(parseGoalCommand('/goal resume')).toEqual({ type: 'resume' });
  expect(parseGoalCommand('/goal clear')).toEqual({ type: 'clear' });
  expect(parseGoalCommand('/goals')).toBeUndefined();
  expect(parseGoalCommand('set a /goal')).toBeUndefined();
  expect(() => newGoal('', 'now')).toThrow('Write the objective');
});

it('keeps going after turns that did work, with no turn limit, and pauses on anything else', () => {
  const goal = { ...goalTurnStarted(newGoal('ship it', 'now'))!, turns: 500 };
  expect(afterGoalTurn(goal, 'completed', true)).toEqual({ goal, continue: true });
  expect(afterGoalTurn(goal, 'completed', false)).toMatchObject({ goal: { status: 'paused', detail: 'No progress in the last turn.' }, continue: false });
  expect(afterGoalTurn(goal, 'interrupted', true).goal).toMatchObject({ status: 'paused', detail: 'Stopped.' });
  expect(afterGoalTurn(goal, 'failed', true).goal).toMatchObject({ status: 'paused', detail: 'The last turn failed.' });
  expect(resumeGoal({ ...goal, status: 'paused', detail: 'Stopped.' })).toMatchObject({ status: 'active', turns: 500, detail: undefined });
});

it('stops when the harness reports the goal achieved or blocked', () => {
  const goal = newGoal('ship it', 'now');
  const achieved = finishGoal(goal, 'achieved', 'All 12 tests pass');
  expect(achieved).toMatchObject({ status: 'achieved', detail: 'All 12 tests pass' });
  expect(afterGoalTurn(achieved, 'completed', true)).toEqual({ goal: achieved, continue: false });
  expect(finishGoal(goal, 'blocked', 'Need a token')).toMatchObject({ status: 'paused', detail: 'Need a token' });
  expect(() => resumeGoal(achieved)).toThrow('achieved');
  expect(() => pauseGoal(achieved)).toThrow('no active goal');
  expect(goalInstructions(achieved)).toBeUndefined();
  expect(goalInstructions(goal)).toContain('Goal for this thread: ship it');
});
