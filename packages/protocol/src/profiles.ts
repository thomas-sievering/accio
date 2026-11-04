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
  /** In the profile's order, which breaks ties when the hub chooses among them. */
  accounts: AccountView[];
  /**
   * The signed-in account the hub chose for the next request, by limits and
   * reset times. Absent from hubs that predate the choice.
   */
  inUseId?: string | null;
};

/** The account a profile's turns use at a provider; older hubs use the first signed-in one. */
export function accountInUse(provider: ProfileProviderView | undefined): AccountView | null {
  if (provider?.inUseId !== undefined) return provider.accounts.find((a) => a.id === provider.inUseId) ?? null;
  return provider?.accounts.find((a) => a.signedIn) ?? null;
}

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
  /** Each provider's accounts in order of use. A provider left out keeps its accounts. */
  accountIds: z.object({
    anthropic: z.array(z.string()).max(20).optional(),
    openai: z.array(z.string()).max(20).optional(),
  }).optional(),
  /**
   * The single-account form from before ordered accounts: selects only this
   * account, or none. accountIds takes precedence; clients send both so a hub
   * from before still applies the first account.
   */
  accountId: z.string().nullable().optional(),
  openaiAccountId: z.string().nullable().optional(),
});
export type SaveProfileParams = z.output<typeof SaveProfileParams>;

const ById = z.object({ id: z.string() });
const CompleteSignIn = z.object({ signInId: z.string(), code: z.string().trim().min(1, 'Paste the code from Claude’s page') });
const SignInId = z.object({ signInId: z.string() });

const SaveAccount = z.object({ id: z.string().optional(), name: z.string().trim().min(1, 'Name is required').max(80), providerId: z.enum(['anthropic', 'openai']).optional() });
export const profileMethods = {
  'accounts.list': method<z.ZodObject<{}>, AccountView[]>(z.object({})),
  'accounts.save': method<typeof SaveAccount, AccountView>(SaveAccount),
  'accounts.delete': method<typeof ById, null>(ById),
  'accounts.beginSignIn': method<typeof ById, { signInId: string; url: string; userCode?: string }>(ById),
  'accounts.signInStatus': method<typeof SignInId, { status: 'pending' } | { status: 'complete'; account: AccountView }>(SignInId),
  'accounts.cancelSignIn': method<typeof SignInId, null>(SignInId),
  'accounts.completeSignIn': method<typeof CompleteSignIn, AccountView>(CompleteSignIn),
  'accounts.signOut': method<typeof ById, AccountView>(ById),
  'profiles.list': method<z.ZodObject<{}>, ProfileView[]>(z.object({})),
  'profiles.save': method<typeof SaveProfileParams, ProfileView>(SaveProfileParams),
  'profiles.delete': method<typeof ById, null>(ById),
};

export type ProfileEvents = {
  'profiles.changed': ProfileView[];
  'accounts.changed': AccountView[];
};
