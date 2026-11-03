import { z } from 'zod';
import { method } from './rpc.js';

/**
 * An account as clients see it (GLOSSARY: Account). The hub key never leaves the
 * server; clients only learn whether one is set.
 */
export type AccountView = {
  id: string;
  name: string;
  /** GLOSSARY: Job account. Never shares a hub proxy with any other account. */
  isJob: boolean;
  hubUrl: string;
  hasHubKey: boolean;
  /** Folders whose new projects default to this account, like fleet's roots. */
  roots: string[];
};

export const SaveAccountParams = z.object({
  /** Omit to create. */
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Name is required').max(40),
  isJob: z.boolean(),
  hubUrl: z.string().trim(),
  /** Omit or leave empty to keep the stored key when editing. */
  hubKey: z.string().trim().optional(),
  roots: z.array(z.string().trim().min(1)).default([]),
});
export type SaveAccountParams = z.output<typeof SaveAccountParams>;

export const accountMethods = {
  'accounts.list': method<z.ZodObject<{}>, AccountView[]>(z.object({})),
  'accounts.save': method<typeof SaveAccountParams, AccountView>(SaveAccountParams),
  'accounts.delete': method<z.ZodObject<{ id: z.ZodString }>, null>(z.object({ id: z.string() })),
};

export type AccountEvents = {
  'accounts.changed': AccountView[];
};
