import { z } from 'zod';
import { method } from './rpc.js';

/** GLOSSARY: Hub, as a client sees it. Never its keys or tokens. */
export type HubInfo = {
  /** Where the hub runs. In v0.1 it always runs inside this machine's server (ADR 0007). */
  runs: 'inThisServer' | 'remote' | 'local';
  hubId?: string;
  /** The address threads call. */
  url: string;
  /** Whether the hub answered just now. */
  reachable: boolean;
  /** The file on the hub's computer that holds its accounts. */
  store: string;
  /** The file that holds the shared settings (ADR 0004). */
  settingsStore: string;
};

export type HubConnectionView = {
  id: string;
  name: string;
  url: string;
  status: 'connected' | 'connecting' | 'offline';
  error?: string;
  local: boolean;
  running: number;
};

const PairHub = z.object({ name: z.string().trim().min(1).max(80), url: z.string().url(), code: z.string().trim().min(1) });
const HubId = z.object({ id: z.string() });
const RenameHub = z.object({ id: z.string(), name: z.string().trim().min(1).max(80) });
const RevokeMachine = z.object({ id: z.string(), machineId: z.string() });

export const hubMethods = {
  'hub.get': method<z.ZodObject<{}>, HubInfo>(z.object({})),
  'hubs.list': method<z.ZodObject<{}>, HubConnectionView[]>(z.object({})),
  'hubs.pair': method<typeof PairHub, HubConnectionView>(PairHub),
  'hubs.rename': method<typeof RenameHub, HubConnectionView>(RenameHub),
  'hubs.remove': method<typeof HubId, null>(HubId),
  'hubs.createPairingCode': method<typeof HubId, { code: string; expiresAt: number }>(HubId),
  'hubs.revokeMachine': method<typeof RevokeMachine, null>(RevokeMachine),
};

export type HubEvents = { 'hubs.changed': HubConnectionView[] };
