import { z } from 'zod';
import { method } from './rpc.js';

/**
 * GLOSSARY: Update. Where one machine's Accio stands against the latest `main`.
 * Only a desktop app started from a clean checkout of `main` can update itself.
 */
export type UpdateView = {
  machineId: string;
  /** The commit this machine's Accio runs, abbreviated; null when it doesn't run from a git checkout. */
  commit: string | null;
  /**
   * `current`: on the latest main. `behind`: an update is available. `blocked`: the checkout can't
   * fast-forward, see `detail`. `updating`/`restarting`: in progress. `failed`: the last update
   * failed and was rolled back, `detail` has the end of its log. `unsupported`: not a desktop app
   * running from a git checkout.
   */
  state: 'current' | 'behind' | 'blocked' | 'updating' | 'restarting' | 'failed' | 'unsupported';
  /** Commits on origin/main this machine doesn't have yet. */
  behind?: number;
  detail?: string;
};

const MachineId = z.object({ machineId: z.string().min(1) });
const Screenshot = z.object({
  machineId: z.string().min(1),
  /** JavaScript run in the window before the capture, such as a click that opens a view. */
  script: z.string().max(20_000).optional(),
});

export const updateMethods = {
  'update.status': method<typeof MachineId, UpdateView>(MachineId),
  'update.start': method<typeof MachineId, UpdateView>(MachineId),
  /**
   * GLOSSARY: App screenshot. A PNG of a machine's Accio window, base64-encoded. `note` says when
   * it shows less than the whole window, such as the page without its title bar buttons, and why.
   */
  'app.screenshot': method<typeof Screenshot, { png: string; note?: string }>(Screenshot),
};

export type UpdateEvents = { 'update.changed': UpdateView };
