import { z } from 'zod';
import { findMentionedModel, modelHandles, type ModelSelection, type ModelView, type ParamsOf, type ThreadView } from '@accio/protocol';
import { accioTool } from '../tools/tools.js';

export const START_THREAD_TOOL = 'start_thread';

/** What a new thread takes from the thread that starts it. */
export type StartingThread = { checkoutId: string; profileId: string; model: ModelSelection };

export type StartThreadDeps = {
  caller: (threadId: string) => StartingThread | undefined;
  /** Models this machine offers the profile, to find one mentioned with @. */
  models: (profileId: string) => ModelView[];
  /** Name or @handle to machine; undefined for this machine. Throws on an unknown one. */
  machine: (name?: string) => { id: string; name: string } | undefined;
  /** threads.start, through the relay when it names another machine. */
  start: (params: ParamsOf<'threads.start'>) => Promise<ThreadView>;
};

/**
 * GLOSSARY: Started thread. A new top-level thread one thread starts through the
 * start_thread accio tool, unlike a sub-agent: it has its own transcript and shows
 * in the list like any other. It works in the same project, on this machine or in
 * another machine's checkout of the same repository, on the starter's model unless
 * another is mentioned.
 */
export function startThreadTool(deps: StartThreadDeps) {
  return accioTool({
    name: START_THREAD_TOOL,
    description: 'Start a new top-level thread in this project, on this machine or on another paired machine, and return without waiting for it. '
      + 'It is a thread of its own that the user follows and talks to, not a sub-agent: use it when the user asks for a new thread, or for one on another machine. '
      + 'It sees nothing of this conversation, so write the message as a complete task.',
    input: {
      message: z.string().trim().min(1).max(20_000).describe('The new thread\'s first message: the complete task, with the goal, relevant paths and context.'),
      machine: z.string().trim().max(200).optional().describe("Name or id of the machine, as in Settings → Machines, or one the user mentioned with @, such as '@laptop'. Defaults to this machine."),
      model: z.string().trim().min(1).max(80).optional().describe("A model the user mentioned with @, such as '@sol'. Defaults to this thread's model."),
    },
    call: async ({ message, machine: machineName, model: handle }, { threadId }) => {
      const caller = deps.caller(threadId);
      if (!caller) throw new Error('This thread is not on this machine.');
      const target = deps.machine(machineName);
      const model = handle ? mentioned(deps.models(caller.profileId), handle, caller.model) : caller.model;
      const where = caller.checkoutId ? { checkoutId: caller.checkoutId } : { profileId: caller.profileId };
      const started = await deps.start({ ...where, text: message, model, ...(target ? { machineId: target.id } : {}) });
      return `Started thread "${started.title}" (${started.id}) on ${target?.name ?? 'this machine'}. It runs on its own and shows in the thread list.`;
    },
  });
}

function mentioned(models: ModelView[], handle: string, current: ModelSelection): ModelSelection {
  const model = findMentionedModel(models, handle);
  if (!model) throw new Error(`No model is called @${handle.replace(/^@/, '')}. Mention one of: ${modelHandles(models).map((h) => `@${h.handle}`).join(', ')}.`);
  // The effort carries over where the model accepts it; threads.start drops it otherwise.
  return { harnessId: model.harnessId, modelId: model.id, ...(current.effort ? { effort: current.effort } : {}) };
}
