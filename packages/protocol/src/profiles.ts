import { z } from 'zod';
import { method } from './rpc.js';

/** GLOSSARY: Provider. */
export type ProviderId = 'anthropic' | 'openai';

/** GLOSSARY: Account. Who it is; its tokens never leave the Sorting Hat. */
export type AccountView = { id: string; name: string; providerId: ProviderId; signedIn: boolean; email: string | null; organization: string | null };

/** One provider as a profile uses it, with the profile's accounts there. */
export type ProfileProviderView = {
  id: ProviderId;
  name: string;
  /** What an account there is called, such as "Claude account". */
  accountName: string;
  /** Whether accio can sign in to it yet. */
  available: boolean;
  /** In its house's order, which breaks ties when the Sorting Hat chooses among them. */
  accounts: AccountView[];
  /** GLOSSARY: Account in use. The signed-in account the Sorting Hat chose for the next request, by limits and reset times. */
  inUseId: string | null;
};

/** The account a profile's turns use at a provider. */
export function accountInUse(provider: ProfileProviderView | undefined): AccountView | null {
  return provider?.accounts.find((a) => a.id === provider.inUseId) ?? null;
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
  /** GLOSSARY: House. The Sorting Hat house this profile links to; null while it links to none, so its threads can't run. */
  house: { id: string; name: string } | null;
};

/** Why a profile's threads can't run while it links to no house on the hub's Sorting Hat. */
export const noHouseMessage = (profile: string) => `${profile} isn’t linked to a house on the Sorting Hat. Choose one in Settings / Profiles.`;

/** Why nothing account-related works on a hub without a Sorting Hat. */
export const noSortingHatMessage = 'This hub has no Sorting Hat, which holds the accounts threads run with. Connect one in Settings / Hubs.';

/** GLOSSARY: Sorting Hat, as clients see the hub's link to one. Never its admin token. */
export type SortingHatView = {
  url: string;
  /** Where threads reach it, when other machines can't use `url` (such as a hub's internal network address); null to use `url`. */
  threadUrl: string | null;
  /** How this hub's hat keys are named on the Sorting Hat's dashboard: "Accio · <hubName> · …". */
  hubName: string;
  /** Its houses, for linking profiles, as last read. */
  houses: { id: string; name: string }[];
  /** Why the hub can't reach it right now, or null. */
  problem: string | null;
};

const ConfigureSortingHat = z.object({
  url: z.string().trim().url('Enter the Sorting Hat’s address, such as https://sortinghat.example.com').max(500),
  /** Omit to keep the token already saved for this address. */
  adminToken: z.string().trim().min(1, 'Paste the admin token from the Sorting Hat’s dashboard').max(500).optional(),
  hubName: z.string().trim().min(1, 'Name this hub').max(80),
  /** Omit to give threads `url`. */
  threadUrl: z.string().trim().url('Enter the address threads use, such as https://sortinghat.example.com').max(500).optional(),
});

export const SaveProfileParams = z.object({
  /** Omit to create. */
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Name is required').max(40),
  /** Each provider's accounts in order of use, set on the profile's house. A provider left out keeps its accounts. */
  accountIds: z.object({
    anthropic: z.array(z.string()).max(20).optional(),
    openai: z.array(z.string()).max(20).optional(),
  }).optional(),
  /** The Sorting Hat house to link, or null to unlink; omit to keep the link. */
  houseId: z.string().min(1).max(64).nullable().optional(),
  /** Make a house of the profile's name on the hub's Sorting Hat and link it, in place of houseId. */
  createHouse: z.boolean().optional(),
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
  'sortingHat.get': method<z.ZodObject<{}>, SortingHatView | null>(z.object({})),
  'sortingHat.configure': method<typeof ConfigureSortingHat, SortingHatView>(ConfigureSortingHat),
  'sortingHat.disconnect': method<z.ZodObject<{}>, null>(z.object({})),
};

export type ProfileEvents = {
  'profiles.changed': ProfileView[];
  'accounts.changed': AccountView[];
  'sortingHat.changed': SortingHatView | null;
};
