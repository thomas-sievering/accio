import { z } from 'zod';
import { method } from './rpc.js';

/** Metadata only. Values have no read API and never enter shared settings. */
export type SecretSummary = {
  id: string;
  profileId: string;
  name: string;
  slot: string;
  projectIds: string[];
  profileWide: boolean;
  version: number;
  updatedAt: string;
  lastUsedAt: string | null;
};

export type SecretRequestItem = {
  kind: 'secret';
  id: string;
  turnId: string;
  requestId: string;
  slot: string;
  label: string;
  reason: string;
  profileId: string;
  profileName: string;
  projectId: string | null;
  projectName: string;
  machineName: string;
  status: 'pending' | 'provided' | 'declined' | 'expired' | 'cancelled';
  source?: 'once' | 'saved' | 'reused';
  secretName?: string;
  candidates: SecretSummary[];
  expiresAt: string;
};

const Id = z.string().min(1).max(160);
export const SecretSlot = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
const Value = z.string().min(1).max(16384);
const List = z.object({ profileId: Id });
const Save = z.object({
  id: Id.optional(), profileId: Id, name: z.string().trim().min(1).max(160), slot: SecretSlot,
  projectIds: z.array(Id).max(100), profileWide: z.boolean().optional(), value: Value.optional(),
});
const Delete = z.object({ id: Id });
const Answer = z.object({
  threadId: Id, requestId: Id,
  answer: z.discriminatedUnion('type', [
    z.object({ type: z.literal('once'), value: Value }),
    z.object({ type: z.literal('save'), value: Value }),
    z.object({ type: z.literal('existing'), secretId: Id }),
    z.object({ type: z.literal('decline') }),
  ]),
});

export const secretMethods = {
  'secrets.list': method<typeof List, SecretSummary[]>(List),
  'secrets.status': method<z.ZodObject<{}>, { available: boolean; reason?: string }>(z.object({})),
  'secrets.save': method<typeof Save, SecretSummary>(Save),
  'secrets.delete': method<typeof Delete, null>(Delete),
  'secretRequests.answer': method<typeof Answer, null>(Answer),
};

export type SecretEvents = { 'secrets.changed': { profileId: string } };
