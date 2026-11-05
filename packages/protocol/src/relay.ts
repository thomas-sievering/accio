import type { MethodName } from './index.js';
import type { CheckoutView, ProjectView } from './projects.js';
import type { ThreadView } from './threads.js';

/**
 * GLOSSARY: Relay. Frames a machine exchanges with other machines through the hub.
 * The hub reads only `to`, stamps `from` with the authenticated sender and forwards
 * the frame unchanged; it never stores or interprets the rest.
 */
export type RelayFrame =
  | { kind: 'request'; to: string; from?: string; id: string; method: string; params: unknown }
  | { kind: 'response'; to: string; from?: string; id: string; ok: true; result: unknown }
  | { kind: 'response'; to: string; from?: string; id: string; ok: false; error: string }
  /** `to: '*'` reaches every other machine connected to the relay. */
  | { kind: 'event'; to: string; from?: string; event: string; data: unknown }
  /** Part of a serialized frame too large for one WebSocket message. `id` is the request id for requests. */
  | { kind: 'chunk'; to: string; from?: string; id: string; index: number; total: number; data: string };

/** Frames only the hub sends. */
export type RelayHubFrame =
  | { kind: 'peers'; from: 'hub'; machines: string[] }
  | { kind: 'undeliverable'; from: 'hub'; id: string };

/** What a machine shares about its own work with the other machines. */
export type RelaySnapshot = {
  threads: ThreadView[];
  projects: ProjectView[];
  /** Absent from machines on an earlier build: no thread can start there. */
  checkouts?: CheckoutView[];
  /** Orders snapshots from one machine: a new `boot` replaces, otherwise the higher `seq` wins. */
  version: { boot: string; seq: number };
};

/** A thread owned by another machine, as the viewing machine shows it. */
export type RemoteMachine = { id: string; name: string; online: boolean };

/**
 * Thread methods a machine serves to the others through the relay. Anything not
 * listed, such as hubs.*, secrets.* or pairing, never runs for another machine.
 * `threads.start` arrives naming the serving machine's own checkout or a profile.
 * Methods that hand out local HTTP URLs (assets, files, previews) wait for a relayed stream.
 */
export const RELAY_THREAD_METHODS = [
  'threads.start', 'threads.observe', 'threads.transcript', 'threads.toolDetails', 'threads.deliverySummary',
  'threads.send', 'threads.queued', 'threads.stop', 'threads.resume', 'threads.retry',
  'threads.deliver', 'threads.cancelDelivery', 'threads.checkDelivery', 'threads.archive',
  'threads.goal', 'threads.setModel', 'threads.snooze', 'threads.settle', 'threads.reopen',
  'threads.rename', 'threads.regenerateTitle', 'threads.previewTitle', 'threads.delete',
] as const satisfies readonly MethodName[];

/**
 * Methods about a machine itself, addressed by `machineId`. A call names the machine it is
 * about; any other machine forwards it there through the relay.
 */
export const RELAY_MACHINE_METHODS = ['update.status', 'update.start', 'app.screenshot', 'checkouts.clone'] as const satisfies readonly MethodName[];
export type RelayMachineMethod = typeof RELAY_MACHINE_METHODS[number];
