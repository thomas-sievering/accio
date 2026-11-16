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
  allowLabel: string;
  status: 'pending' | 'allowed' | 'declined' | 'expired' | 'cancelled';
  expiresAt: string;
};

const Answer = z.object({ threadId: z.string().min(1).max(160), requestId: z.string().min(1).max(160), allow: z.boolean() });

export const confirmationMethods = {
  'confirmations.answer': method<typeof Answer, null>(Answer),
};
