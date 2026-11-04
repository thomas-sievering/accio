import { z } from 'zod';
import { method } from './rpc.js';

/** GLOSSARY: Project. A repository, recognised by its git remote; belongs to exactly one profile. */
export type ProjectView = {
  id: string;
  name: string;
  profileId: string;
  /** Normalised remote, such as github.com/owner/repo. Null for a folder without a remote. */
  repoKey: string | null;
  deliveryPolicy?: 'direct' | 'pull-request';
  /** Local command, with {port} substituted and PORT set for the owned preview. */
  previewCommand?: string;
  /** GLOSSARY: Project app. Command that runs the app from the default branch, with {port} and PORT like the preview. */
  startCommand?: string;
  /** Runs before the start command after each update, such as pnpm install. */
  setupCommand?: string;
  /** Ship runs it in the worktree before pushing; without it, Ship is a full agent turn. */
  testCommand?: string;
};

/** GLOSSARY: Checkout. One machine's copy of a project's repository. */
export type CheckoutView = {
  id: string;
  projectId: string;
  path: string;
};

export type ProjectsState = {
  projects: ProjectView[];
  checkouts: CheckoutView[];
};

/** What accio would do with a folder, before you add it. */
export type FolderInspection = {
  /** The repository root if the folder is inside one, else the folder itself. */
  path: string;
  name: string;
  repoKey: string | null;
  /** Set when a checkout of the same repository is already a project. */
  existingProject: ProjectView | null;
  alreadyAdded: boolean;
  /** From the profiles' folders; null when none matches. */
  suggestedProfileId: string | null;
};

const Path = z.object({ path: z.string().trim().min(1, 'Choose a folder') });
const AddCheckout = z.object({ path: z.string().trim().min(1), profileId: z.string().optional() });
/** deleteThreads records explicit confirmation to delete all current checkout threads. */
const RemoveCheckout = z.object({ id: z.string(), deleteThreads: z.boolean().optional() });
const SetProfile = z.object({ projectId: z.string(), profileId: z.string() });
const DeliverySettings = z.object({ projectId: z.string(), deliveryPolicy: z.enum(['direct', 'pull-request']), previewCommand: z.string().trim().max(2000), testCommand: z.string().trim().max(2000).optional() });

const AppSettings = z.object({ projectId: z.string(), startCommand: z.string().trim().max(2000), setupCommand: z.string().trim().max(2000) });
const ProjectId = z.object({ projectId: z.string() });
const AutoUpdate = z.object({ projectId: z.string(), on: z.boolean() });

/** A commit as the dashboard shows it. */
export type CommitView = { sha: string; subject: string; author: string; at: string };

/**
 * GLOSSARY: Project app. The app a project runs on this machine from its default branch,
 * in a checkout of its own, apart from every thread's worktree.
 */
export type ProjectAppView = {
  projectId: string;
  /** stopped: not wanted. exited: wanted, but the process ended by itself. */
  status: 'stopped' | 'starting' | 'running' | 'updating' | 'stopping' | 'exited' | 'failed';
  /** Follow the default branch and restart whenever it advances. */
  autoUpdate: boolean;
  branch: string | null;
  /** The commit that runs (or last ran) in the app's checkout. */
  commit: CommitView | null;
  /** The default branch's tip at the last fetch, when it differs from the running commit. */
  available: CommitView | null;
  /** An update that failed; the previous commit was restored. Cleared by the next successful update. */
  failedUpdate: { commit: CommitView; message: string; at: string } | null;
  error: string | null;
  /** Set while the app listens on its assigned port. */
  url: string | null;
  startedAt: string | null;
  checkedAt: string | null;
};

export type ProjectChangelog = { branch: string | null; commits: CommitView[] };

export const projectMethods = {
  'projects.get': method<z.ZodObject<{}>, ProjectsState>(z.object({})),
  'checkouts.inspect': method<typeof Path, FolderInspection>(Path),
  'checkouts.add': method<typeof AddCheckout, CheckoutView>(AddCheckout),
  'checkouts.remove': method<typeof RemoveCheckout, null>(RemoveCheckout),
  'projects.setProfile': method<typeof SetProfile, ProjectView>(SetProfile),
  'projects.setDelivery': method<typeof DeliverySettings, ProjectView>(DeliverySettings),
  'projects.setApp': method<typeof AppSettings, ProjectView>(AppSettings),
  'projects.changelog': method<typeof ProjectId, ProjectChangelog>(ProjectId),
  'projectApps.get': method<z.ZodObject<{}>, ProjectAppView[]>(z.object({})),
  'projectApps.start': method<typeof ProjectId, ProjectAppView>(ProjectId),
  'projectApps.stop': method<typeof ProjectId, ProjectAppView>(ProjectId),
  /** Restart the same commit. */
  'projectApps.restart': method<typeof ProjectId, ProjectAppView>(ProjectId),
  /** Fetch, move to the default branch's tip, set up and restart. */
  'projectApps.update': method<typeof ProjectId, ProjectAppView>(ProjectId),
  'projectApps.setAutoUpdate': method<typeof AutoUpdate, ProjectAppView>(AutoUpdate),
  'projectApps.logs': method<typeof ProjectId, { text: string }>(ProjectId),
};

export type ProjectEvents = {
  'projects.changed': ProjectsState;
  'projectApps.changed': ProjectAppView[];
};
