import { z } from 'zod';
import { method } from './rpc.js';

/** GLOSSARY: Account, as clients see it. Its login lives on the hub; clients only learn who is signed in. */
export type AccountView = {
  id: string;
  name: string;
  /** GLOSSARY: Job account. Never shares a login or hub access key with any other account. */
  isJob: boolean;
  /** Folders whose new projects default to this account, like fleet's roots. */
  roots: string[];
  /** GLOSSARY: Sign-in. Null until the account is signed in with Claude. */
  signIn: { email: string | null; organization: string | null } | null;
};

export const SaveAccountParams = z.object({
  /** Omit to create. */
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Name is required').max(40),
  isJob: z.boolean(),
  roots: z.array(z.string().trim().min(1)).default([]),
});
export type SaveAccountParams = z.output<typeof SaveAccountParams>;

const ById = z.object({ id: z.string() });
const AccountId = z.object({ accountId: z.string() });
const CompleteSignIn = z.object({ signInId: z.string(), code: z.string().trim().min(1, 'Paste the code from Claude’s page') });

export const accountMethods = {
  'accounts.list': method<z.ZodObject<{}>, AccountView[]>(z.object({})),
  'accounts.save': method<typeof SaveAccountParams, AccountView>(SaveAccountParams),
  'accounts.delete': method<typeof ById, null>(ById),
  /** Returns Claude's consent page; open it, approve, and paste the code it shows into completeSignIn. */
  'accounts.beginSignIn': method<typeof AccountId, { signInId: string; url: string }>(AccountId),
  'accounts.completeSignIn': method<typeof CompleteSignIn, AccountView>(CompleteSignIn),
  'accounts.signOut': method<typeof AccountId, AccountView>(AccountId),
};

export type AccountEvents = {
  'accounts.changed': AccountView[];
};
