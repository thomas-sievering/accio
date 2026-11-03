import { z } from 'zod';
import { method } from './rpc.js';

/** GLOSSARY: Provider. */
export type ProviderId = 'anthropic' | 'openai';

/** GLOSSARY: Account. Who it is; its tokens never leave the hub. */
export type AccountView = { id: string; name: string; providerId: ProviderId; signedIn: boolean; email: string | null; organization: string | null };

/** One provider as a profile uses it, with the profile's accounts there. */
export type ProfileProviderView = {
  id: ProviderId;
  name: string;
  /** What an account there is called, such as "Claude account". */
  accountName: string;
  /** Whether accio can sign in to it yet. */
  available: boolean;
  accounts: AccountView[];
};

/**
 * GLOSSARY: Profile, as clients see it: profile → providers → accounts. It lives
 * on the hub; clients only learn who each account is. Profile folders are per
 * machine, so they are on MachineView.
 */
export type ProfileView = {
  id: string;
  name: string;
  providers: ProfileProviderView[];
};

export const SaveProfileParams = z.object({
  /** Omit to create. */
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Name is required').max(40),
  accountId: z.string().nullable().optional(),
});
export type SaveProfileParams = z.output<typeof SaveProfileParams>;

const ById = z.object({ id: z.string() });
const ProfileId = z.object({ profileId: z.string() });
const CompleteSignIn = z.object({ signInId: z.string(), code: z.string().trim().min(1, 'Paste the code from Claude’s page') });

const SaveAccount = z.object({ id: z.string().optional(), name: z.string().trim().min(1, 'Name is required').max(80) });
export const profileMethods = {
  'accounts.list': method<z.ZodObject<{}>, AccountView[]>(z.object({})),
  'accounts.save': method<typeof SaveAccount, AccountView>(SaveAccount),
  'accounts.delete': method<typeof ById, null>(ById),
  'accounts.beginSignIn': method<typeof ById, { signInId: string; url: string }>(ById),
  'accounts.completeSignIn': method<typeof CompleteSignIn, AccountView>(CompleteSignIn),
  'accounts.signOut': method<typeof ById, AccountView>(ById),
  'profiles.list': method<z.ZodObject<{}>, ProfileView[]>(z.object({})),
  'profiles.save': method<typeof SaveProfileParams, ProfileView>(SaveProfileParams),
  'profiles.delete': method<typeof ById, null>(ById),
  /** Returns Claude's consent page; open it, approve, and paste the code it shows into completeSignIn. */
  'profiles.beginSignIn': method<typeof ProfileId, { signInId: string; url: string }>(ProfileId),
  'profiles.completeSignIn': method<typeof CompleteSignIn, ProfileView>(CompleteSignIn),
  'profiles.signOut': method<typeof ProfileId, ProfileView>(ProfileId),
};

export type ProfileEvents = {
  'profiles.changed': ProfileView[];
  'accounts.changed': AccountView[];
};
