import { z } from 'zod';
import { method } from './rpc.js';

/**
 * GLOSSARY: Confirmation. An accio tool asking you to allow one action before it goes on, such as
 * add_cli turning a CLI on Everywhere. Pending, the card offers Allow and Decline.
 */
export type ConfirmationItem = {
  kind: 'confirmation';
  id: string;
  turnId: string;
  requestId: string;
  title: string;
  detail: string;
  /** What the action covers, one row each, such as the projects add_project adds; shown under the detail. */
  items?: ConfirmationEntry[];
  allowLabel: string;
  status: 'pending' | 'allowed' | 'declined' | 'expired' | 'cancelled';
  expiresAt: string;
};

/** One row of a confirmation: what it is, and a quieter note on where or how. */
export type ConfirmationEntry = { label: string; note?: string };

const Answer = z.object({ threadId: z.string().min(1).max(160), requestId: z.string().min(1).max(160), allow: z.boolean() });

export const confirmationMethods = {
  'confirmations.answer': method<typeof Answer, null>(Answer),
};
