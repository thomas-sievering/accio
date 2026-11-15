import { z } from 'zod';
import type { ModelSelection, ModelView, ParamsOf, ThreadView } from '@accio/protocol';
import { mentionedModel } from '../harnesses/models.js';
import type { SiblingTarget } from '../spaces/siblingThreads.js';
import { accioTool } from '../tools/tools.js';

export const START_THREAD_TOOL = 'start_thread';

/** What a new thread takes from the thread that starts it. */
export type StartingThread = { checkoutId: string; projectId: string; profileId: string; model: ModelSelection };

export type StartThreadDeps = {
  caller: (threadId: string) => StartingThread | undefined;
  /** Models this machine offers the profile, to find one mentioned with @. */
  models: (profileId: string) => ModelView[];
  /** Name or @handle to machine; undefined for this machine. Throws on an unknown one. */
  machine: (name?: string) => { id: string; name: string } | undefined;
  /**
   * The checkout on the machine (this one when undefined) of the project of the caller's space that
   * `project` names; undefined for the caller's own project. Throws for any other project.
   */
  sibling: (callerProjectId: string, project: string, machine?: { id: string; name: string }) => Promise<SiblingTarget | undefined>;
  /** threads.start, through the relay when it names another machine. */
  start: (params: ParamsOf<'threads.start'>) => Promise<ThreadView>;
};

/**
 * GLOSSARY: Started thread. A new top-level thread one thread starts through the
 * start_thread accio tool, unlike a sub-agent: it has its own transcript and shows
 * in the list like any other. It works in the same project, on this machine or in
 * another machine's checkout of the same repository, on the starter's model unless
 * another is mentioned. GLOSSARY: Space. It can work in another project of the
 * starter's space instead, under that project's profile.
 */
export function startThreadTool(deps: StartThreadDeps) {
  return accioTool({
    name: START_THREAD_TOOL,
    description: 'Start a new top-level thread in this project, on this machine or on another paired machine, and return without waiting for it. '
      + 'It is a thread of its own that the user follows and talks to, not a sub-agent: use it when the user asks for a new thread, or for one on another machine. '
      + "When this project is in a space, name another of its projects, including the home, in `project` to get a change made there: the thread works in that project's checkout under its profile and ships the change on its own. "
      + 'It sees nothing of this conversation, so write the message as a complete task.',
    input: {
      message: z.string().trim().min(1).max(20_000).describe('The new thread\'s first message: the complete task, with the goal, relevant paths and context.'),
      machine: z.string().trim().max(200).optional().describe("Name or id of the machine, as in Settings → Machines, or one the user mentioned with @, such as '@laptop'. Defaults to this machine."),
      model: z.string().trim().min(1).max(80).optional().describe("A model the user mentioned with @, such as '@sol'. Defaults to this thread's model."),
      project: z.string().trim().min(1).max(300).optional().describe("Name or key of another project in this project's space, as listed in the Space section of your instructions, including the home. Defaults to this project."),
    },
    call: async ({ message, machine: machineName, model: handle, project }, { threadId }) => {
      const caller = deps.caller(threadId);
      if (!caller) throw new Error('This thread is not on this machine.');
      const target = deps.machine(machineName);
      const sibling = project ? await deps.sibling(caller.projectId, project, target) : undefined;
      const offered = deps.models(sibling?.profileId ?? caller.profileId);
      // Another profile may not offer this thread's model; the thread then starts on that profile's default.
      const inherited = !sibling || offered.some((m) => m.harnessId === caller.model.harnessId && m.id === caller.model.modelId);
      const model = handle ? mentionedModel(offered, handle, caller.model.effort).selection : inherited ? caller.model : undefined;
      const where = sibling ? { checkoutId: sibling.checkoutId } : caller.checkoutId ? { checkoutId: caller.checkoutId } : { profileId: caller.profileId };
      const started = await deps.start({ ...where, text: message, ...(model ? { model } : {}), ...(target ? { machineId: target.id } : {}) });
      return `Started thread "${started.title}" (${started.id})${sibling ? ` in ${sibling.name}` : ''} on ${target?.name ?? 'this machine'}. It runs on its own and shows in the thread list.`;
    },
  });
}
