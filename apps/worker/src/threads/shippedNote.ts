import { z } from 'zod';
import type { ShippedNote, ThreadDelivery } from '@accio/protocol';
import { accioTool } from '../tools/tools.js';

/**
 * GLOSSARY: Shipped note. The delivery turn tells the person who will try the change
 * what changed and what to try. Accio shows it in the thread and the Changelog once
 * the delivery is verified; it never affects what Accio checks or publishes.
 */
export const SHIPPED_NOTE_TOOL = 'shipped_note';

export const SHIPPED_NOTE_INSTRUCTIONS = `Before you finish, call the ${SHIPPED_NOTE_TOOL} accio tool once with a one-line summary of what changed for the user and up to five short things they can try to see it working. Write for the person who will use the change, not for a reviewer: no file names or test counts. Call it again if a later fix changes that.`;

export const shippedNoteInput = {
  summary: z.string().trim().min(1).max(200).describe('One line on what changed for the user, e.g. "Running threads sit on Working below the inbox"'),
  test: z.array(z.string().trim().min(1).max(200)).max(5).describe('Short things to try, each one sentence, e.g. "Start a turn and watch the thread move to Working"'),
};

/** Records the note on a running delivery; anything else is left alone. */
export function recordShippedNote(delivery: ThreadDelivery | undefined, note: ShippedNote): ThreadDelivery | undefined {
  if (delivery?.status !== 'running') return delivery;
  return { ...delivery, note };
}

/** The accio tool, listed only while the thread's delivery turn runs. */
export function shippedNoteTool(record: (threadId: string, note: ShippedNote) => Promise<void>, running: (threadId: string) => boolean) {
  return accioTool({
    name: SHIPPED_NOTE_TOOL,
    description: 'Tell the user what this delivery changed and what to try once it ships. Accio shows it in the thread and the project changelog after the delivery is verified.',
    input: shippedNoteInput,
    available: running,
    call: async ({ summary, test }, { threadId }) => {
      await record(threadId, { summary, test });
      return 'Noted.';
    },
  });
}
