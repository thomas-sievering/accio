import type { MethodName } from './index.js';
import type { CheckoutView, HubProject, ProjectView } from './projects.js';
import type { ThreadView } from './threads.js';
import type { AccountView, ProfileView } from './profiles.js';
import type { MachineView } from './machine.js';
import type { Space } from './spaces.js';
import type { PairedClientView } from './hub.js';

/**
 * GLOSSARY: Relay. Frames machines and clients exchange through the hub.
 * The hub routes by `to`, stamps the authenticated sender, and never stores the payload.
 */
export type RelayFrame = { to: string; from?: string; fromKind?: 'machine' | 'client' } & (
  | { kind: 'request'; id: string; method: string; params: unknown }
  | { kind: 'response'; id: string; ok: true; result: unknown }
  | { kind: 'response'; id: string; ok: false; error: string }
  /** `to: '*'` reaches every other machine connected to the relay. */
  | { kind: 'event'; event: string; data: unknown }
  /** Part of a serialized frame too large for one WebSocket message. `id` is the request id for requests. */
  | { kind: 'chunk'; id: string; index: number; total: number; data: string }
);

/** Frames only the hub sends. */
export type RelayHubFrame =
  | { kind: 'peers'; from: 'hub'; machines: string[]; clients?: string[] }
  | { kind: 'undeliverable'; from: 'hub'; id: string };

/** What a machine shares about its own work with the other machines. */
export type RelaySnapshot = {
  threads: ThreadView[];
  projects: ProjectView[];
  checkouts: CheckoutView[];
  /** Orders snapshots from one machine: a new `boot` replaces, otherwise the higher `seq` wins. */
  version: { boot: string; seq: number };
};

/** A thread owned by another machine, as the viewing machine shows it. */
export type RemoteMachine = { id: string; name: string; online: boolean };

export type BrowserSharedState = {
  hubId: string;
  clientId: string;
  version?: string;
  profiles: ProfileView[];
  accounts: AccountView[];
  machines: Pick<MachineView, 'id' | 'name' | 'platform' | 'version' | 'harnesses' | 'lastSeen'>[];
  projects: HubProject[];
  spaces: Space[];
  clients: PairedClientView[];
};

/**
 * Thread methods a machine serves to the others through the relay. Anything not
 * listed, such as hubs.*, secrets.* or pairing, never runs for another machine.
 * `threads.start` arrives naming the serving machine's own checkout or a profile.
 * Saved assets/files use the media transport in relay.ts on the worker; local previews and skills are not relayed.
 */
export const RELAY_THREAD_METHODS = [
  'threads.start', 'threads.observe', 'threads.transcript', 'threads.toolDetails', 'threads.media', 'threads.deliverySummary',
  'threads.send', 'threads.queued', 'threads.stop', 'threads.resume', 'threads.retry',
  'threads.deliver', 'threads.cancelDelivery', 'threads.checkDelivery', 'threads.archive',
  'threads.goal', 'threads.cancelWait', 'threads.setModel', 'threads.snooze', 'threads.settle', 'threads.reopen',
  'threads.rename', 'threads.regenerateTitle', 'threads.previewTitle', 'threads.delete',
  'threads.offeredIssues', 'threads.implementIssue', 'secretRequests.answer', 'confirmations.answer',
] as const satisfies readonly MethodName[];

/**
 * Methods about a machine itself, addressed by `machineId`. A call names the machine it is
 * about; any other machine forwards it there through the relay.
 */
export const RELAY_MACHINE_METHODS = ['update.status', 'update.start', 'app.screenshot', 'checkouts.clone', 'checkouts.cloneUrl'] as const satisfies readonly MethodName[];
export type RelayMachineMethod = typeof RELAY_MACHINE_METHODS[number];

export const RELAY_CLIENT_READS = [
  'threads.observe', 'threads.transcript', 'threads.toolDetails', 'threads.deliverySummary', 'threads.media',
  'harnesses.list', 'models.list', 'secrets.status',
] as const satisfies readonly MethodName[];

/**
 * `threads.upload` is the browser's alone: a paired browser has no machine to keep an
 * image on, so it uploads to the machine its message goes to (GLOSSARY: Image attachment).
 */
export const RELAY_CLIENT_THREAD_ACTIONS = [
  'threads.start', 'threads.upload',
  'threads.deliver', 'threads.cancelDelivery', 'threads.checkDelivery',
  'threads.send', 'threads.queued', 'threads.stop', 'threads.setModel', 'secretRequests.answer', 'confirmations.answer',
] as const satisfies readonly (typeof RELAY_THREAD_METHODS[number] | 'threads.upload')[];
