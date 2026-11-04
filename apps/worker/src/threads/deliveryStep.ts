import { z } from 'zod';
import { DELIVERY_STEPS, type DeliveryStepName, type ThreadDelivery } from '@accio/protocol';
import { accioTool } from '../tools/tools.js';

/**
 * GLOSSARY: Delivery step. A delivery turn is free-form text to accio, so the
 * agent says which part it is on through `delivery_step`. The Delivery panel shows
 * it; accio's own checks never depend on it.
 */
export const DELIVERY_STEP_TOOL = 'delivery_step';
export const MAX_STEP_NOTE = 160;

/** The line the delivery prompt adds so the agent reports its steps. */
export const DELIVERY_STEP_INSTRUCTIONS = `As you start each part of this work, call the ${DELIVERY_STEP_TOOL} accio tool: commit, integrate, verify, then publish, each with a short note on what you are doing. Call it again with a new note when that changes within a step, such as rerunning a failing test on the target branch.`;

export const deliveryStepInput = {
  step: z.enum(DELIVERY_STEPS).describe('commit: committing the work. integrate: fetching and integrating the target branch. verify: running tests and checks. publish: pushing and opening or updating the pull request.'),
  note: z.string().trim().max(MAX_STEP_NOTE).optional().describe('One short line on what you are doing now, such as "Rerunning the failing test on main"'),
};

/** Records the step on a running delivery; anything else is left alone. */
export function reportDeliveryStep(delivery: ThreadDelivery | undefined, name: DeliveryStepName, note: string | undefined, at: string): ThreadDelivery | undefined {
  if (delivery?.status !== 'running') return delivery;
  return { ...delivery, step: { name, at, ...(note ? { note } : {}) } };
}

/** The accio tool, listed only while the thread's delivery turn runs. */
export function deliveryStepTool(report: (threadId: string, step: DeliveryStepName, note: string | undefined) => Promise<void>, running: (threadId: string) => boolean) {
  return accioTool({
    name: DELIVERY_STEP_TOOL,
    description: 'Report which part of the delivery you are starting, so the user can follow it. It does not change what accio checks or publishes.',
    input: deliveryStepInput,
    available: running,
    call: async ({ step, note }, { threadId }) => {
      await report(threadId, step, note || undefined);
      return 'Noted.';
    },
  });
}
