import { z } from 'zod';
import { method } from './rpc.js';

/** The machine this server controls (see GLOSSARY: Machine). */
export type MachineInfo = {
  /** Stable across restarts; the hub knows the machine by it. */
  id: string;
  name: string;
  platform: string;
  version: string;
};

/** A harness installed on a machine, as the machine reports it. */
export type HarnessInstall = { harnessId: string; version: string | null };

/** GLOSSARY: Machine, as the hub records it. Its profile folders are stored on the hub too (ADR 0004). */
export type MachineView = MachineInfo & {
  /** Connected to the hub right now. */
  connected: boolean;
  /** The machine this client is talking to. */
  thisMachine: boolean;
  /** When it last connected or was last seen connected (ISO time). */
  lastSeen: string;
  harnesses: HarnessInstall[];
  /** Profile id → folders on this machine whose new projects default to that profile. */
  profileFolders: Record<string, string[]>;
};

export const SetProfileFolders = z.object({
  machineId: z.string(),
  profileId: z.string(),
  folders: z.array(z.string().trim().min(1)).default([]),
});

export const machineMethods = {
  'machine.get': method<z.ZodObject<{}>, MachineInfo>(z.object({})),
  'machines.list': method<z.ZodObject<{}>, MachineView[]>(z.object({})),
  'machines.rename': method<z.ZodObject<{ machineId: z.ZodString; name: z.ZodString }>, MachineView>(
    z.object({ machineId: z.string(), name: z.string().trim().min(1).max(100) }),
  ),
  'machines.setProfileFolders': method<typeof SetProfileFolders, MachineView>(SetProfileFolders),
};

export type MachineEvents = {
  'machines.changed': MachineView[];
};
