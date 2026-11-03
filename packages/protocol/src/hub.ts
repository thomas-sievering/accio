import { z } from 'zod';
import { method } from './rpc.js';

/** GLOSSARY: Hub, as a client sees it. Never its keys or tokens. */
export type HubInfo = {
  /** Where the hub runs. In v0.1 it always runs inside this machine's server (ADR 0007). */
  runs: 'inThisServer';
  /** The address threads call. */
  url: string;
  /** Whether the hub answered just now. */
  reachable: boolean;
  /** The file on the hub's computer that holds its accounts. */
  store: string;
  /** Each profile and the account the hub holds for it. */
  profiles: { profileId: string; name: string; account: { email: string | null; organization: string | null } | null }[];
};

export const hubMethods = {
  'hub.get': method<z.ZodObject<{}>, HubInfo>(z.object({})),
};
