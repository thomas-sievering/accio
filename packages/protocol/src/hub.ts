import { z } from 'zod';
import { method } from './rpc.js';

/** GLOSSARY: Hub, as a client sees one of the machine's saved connections. Never its keys or tokens. */
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
  'hubs.list': method<z.ZodObject<{}>, HubConnectionView[]>(z.object({})),
  'hubs.pair': method<typeof PairHub, HubConnectionView>(PairHub),
  'hubs.rename': method<typeof RenameHub, HubConnectionView>(RenameHub),
  'hubs.remove': method<typeof HubId, null>(HubId),
  'hubs.createPairingCode': method<typeof HubId, { code: string; expiresAt: number }>(HubId),
  'hubs.revokeMachine': method<typeof RevokeMachine, null>(RevokeMachine),
};

export type HubEvents = { 'hubs.changed': HubConnectionView[] };
