import { z } from 'zod';
import { method } from './rpc.js';

/** The machine this worker runs on (see GLOSSARY: Machine). */
export type MachineInfo = {
  /** Stable across restarts; the hub knows the machine by it. */
  id: string;
  name: string;
  platform: string;
  version: string;
};

/** A harness installed on a machine, as the machine reports it. */
export type HarnessInstall = { harnessId: string; version: string | null };

/** A GitHub login as GitHub allows it, plus `_` for enterprise-managed users. */
export const GitHubLogin = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/, 'Not a GitHub login');

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
  /** GLOSSARY: GitHub account. The logins gh is signed in to on this machine, as it last reported. */
  githubAccounts?: string[];
  /** Profile id → the GitHub account this machine uses for that profile's threads. Unset: the account git uses for the repository. */
  profileGitHub?: Record<string, string>;
  /**
   * GLOSSARY: Relay. Set on another machine while it is on the relay, so new threads can start there:
   * the repositories (repo keys) it has a checkout of.
   */
  relay?: { repos: string[] };
};

const SetProfileFolders = z.object({
  machineId: z.string(),
  profileId: z.string(),
  folders: z.array(z.string().trim().min(1)).default([]),
});

const SetProfileGitHub = z.object({
  machineId: z.string(),
  profileId: z.string(),
  /** Null: use the account git uses for each repository. */
  login: GitHubLogin.nullable(),
});

export const machineMethods = {
  'machine.get': method<z.ZodObject<{}>, MachineInfo>(z.object({})),
  'machines.list': method<z.ZodObject<{}>, MachineView[]>(z.object({})),
  'machines.rename': method<z.ZodObject<{ machineId: z.ZodString; name: z.ZodString }>, MachineView>(
    z.object({ machineId: z.string(), name: z.string().trim().min(1).max(100) }),
  ),
  'machines.setProfileFolders': method<typeof SetProfileFolders, MachineView>(SetProfileFolders),
  'machines.setProfileGitHub': method<typeof SetProfileGitHub, MachineView>(SetProfileGitHub),
};

export type MachineEvents = {
  'machines.changed': MachineView[];
};
