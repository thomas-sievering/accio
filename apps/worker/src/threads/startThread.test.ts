import { expect, it, vi } from 'vitest';
import type { ModelView, ParamsOf, ThreadView } from '@accio/protocol';
import { findMachine } from '../machine/machineTools.js';
import { startThreadTool, type StartThreadDeps } from './startThread.js';

const context = { threadId: 'caller', signal: new AbortController().signal };
const machines = [{ id: 'here', name: 'Desk' }, { id: 'mac', name: 'MacGonagall' }];
const models = [
  { harnessId: 'claudeCode', id: 'opus', name: 'Claude Opus 5.5', efforts: [{ id: 'high' }, { id: 'max' }] },
  { harnessId: 'codex', id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol', efforts: [{ id: 'medium' }, { id: 'high' }] },
] as ModelView[];

function setup(caller: ReturnType<StartThreadDeps['caller']> = { checkoutId: 'co1', projectId: 'pr1', profileId: 'p1', model: { harnessId: 'claudeCode', modelId: 'opus', effort: 'high' } }) {
  const start = vi.fn(async (params: ParamsOf<'threads.start'>) => ({ id: 'new', title: 'Fix the window controls', ...params }) as unknown as ThreadView);
  const tool = startThreadTool({
    here: 'here',
    caller: (id) => id === 'caller' ? caller : undefined,
    models: () => models,
    sibling: async () => { throw new Error('No space'); },
    machine: (name) => { if (!name) return undefined; const found = findMachine(machines, name); return found.id === 'here' ? undefined : found; },
    start,
  });
  return { tool, start };
}

it('starts a thread in the caller\'s checkout on its model, here by default', async () => {
  const { tool, start } = setup();
  expect(await tool.call({ message: 'Fix it' }, context)).toBe('Started thread "Fix the window controls" (new) on this machine. It runs on its own and shows in the thread list. To be woken when it finishes or opens a PR, call wait_for and end your turn. Deliver it with deliver_thread, or settle it with settle_thread, from your next turn.');
  expect(start).toHaveBeenCalledWith({ checkoutId: 'co1', text: 'Fix it', model: { harnessId: 'claudeCode', modelId: 'opus', effort: 'high' }, startedBy: { threadId: 'caller', machineId: 'here' } });
});

it('starts it on the machine the user mentioned, on the model they mentioned', async () => {
  const { tool, start } = setup();
  expect(await tool.call({ message: 'Fix it', machine: '@macgonagall', model: '@sol' }, context)).toContain('on MacGonagall.');
  expect(start).toHaveBeenCalledWith({ checkoutId: 'co1', text: 'Fix it', machineId: 'mac', model: { harnessId: 'codex', modelId: 'gpt-6.1-sol', effort: 'high' }, startedBy: { threadId: 'caller', machineId: 'here' } });
});

it('starts a No project caller\'s thread in its profile', async () => {
  const { tool, start } = setup({ checkoutId: '', projectId: '', profileId: 'p1', model: { harnessId: 'claudeCode', modelId: 'opus' } });
  await tool.call({ message: 'Fix it' }, context);
  expect(start).toHaveBeenCalledWith({ profileId: 'p1', text: 'Fix it', model: { harnessId: 'claudeCode', modelId: 'opus' }, startedBy: { threadId: 'caller', machineId: 'here' } });
});

it('uses the mentioned model’s fallback when it cannot inherit the caller’s effort', async () => {
  const { tool, start } = setup({ checkoutId: 'co1', projectId: 'pr1', profileId: 'p1', model: { harnessId: 'claudeCode', modelId: 'opus', effort: 'max' } });
  await tool.call({ message: 'Fix it', model: '@sol' }, context);
  expect(start).toHaveBeenCalledWith({ checkoutId: 'co1', text: 'Fix it', model: { harnessId: 'codex', modelId: 'gpt-6.1-sol', effort: 'medium' }, startedBy: { threadId: 'caller', machineId: 'here' } });
});

it('refuses an unknown machine or model before starting anything', async () => {
  const { tool, start } = setup();
  await expect(tool.call({ message: 'Fix it', machine: '@laptop' }, context)).rejects.toThrow('No machine named @laptop. Machines: Desk, MacGonagall.');
  await expect(tool.call({ message: 'Fix it', model: '@haiku' }, context)).rejects.toThrow('No model is called @haiku. Mention one of: @opus, @sol.');
  expect(start).not.toHaveBeenCalled();
});
