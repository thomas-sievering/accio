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
  /** Ship runs it in the worktree before pushing; without it, Ship is a full agent turn. */
  testCommand?: string;
};

/** GLOSSARY: Checkout. One machine's copy of a project's repository. */
export type CheckoutView = {
  id: string;
  projectId: string;
  path: string;
};

/**
 * GLOSSARY: Project, as the hub keeps it in shared settings: a repository with a remote and the
 * profile it belongs to, whether or not any machine has a checkout of it. A folder without a
 * remote stays on its machine.
 */
export type HubProject = { repoKey: string; name: string; profileId: string };

/**
 * GLOSSARY: Project. One this machine has no checkout of that a thread can still start in from here:
 * a hub project, which the thread clones first, or a folder without a remote on another machine that
 * is online, where its thread runs.
 */
export type ProjectElsewhere = {
  /** Its repository key, else that machine's project id; other machines' threads in it carry this id. */
  id: string;
  name: string;
  profileId: string;
  repoKey: string | null;
  /** The other machines on the relay with a checkout of it, and those checkouts. */
  on: { machineId: string; checkoutId: string; path: string }[];
};

export type ProjectsState = {
  projects: ProjectView[];
  checkouts: CheckoutView[];
  /** Projects this machine has no checkout of that a thread can start in from here. */
  elsewhere?: ProjectElsewhere[];
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
/**
 * GLOSSARY: Checkout. Clones a repository onto a machine and adds it there, so a thread
 * can start on a machine that had no checkout yet. Goes under the profile's folder on
 * that machine, else the home folder; a clone of the same repository already there is reused.
 */
const CloneCheckout = z.object({
  machineId: z.string(),
  repoKey: z.string().min(1),
  /** The remote the asking machine fetches from, so the clone authenticates the same way. */
  url: z.string().min(1),
  profileId: z.string(),
});
/**
 * The URL the machine's checkout of the repository fetches from, so another machine can clone it the
 * same way without a thread to start there (GLOSSARY: Space).
 */
const CloneUrl = z.object({ machineId: z.string(), repoKey: z.string().min(1) });
/** deleteThreads records explicit confirmation to delete all current checkout threads. */
const RemoveCheckout = z.object({ id: z.string(), deleteThreads: z.boolean().optional() });
const SetProfile = z.object({ projectId: z.string(), profileId: z.string() });
const DeliverySettings = z.object({ projectId: z.string(), deliveryPolicy: z.enum(['direct', 'pull-request']), previewCommand: z.string().trim().max(2000), testCommand: z.string().trim().max(2000).optional() });

const ProjectId = z.object({ projectId: z.string() });

/** A commit as the dashboard shows it. */
export type CommitView = { sha: string; subject: string; author: string; at: string; /** Set on a pull request's merge commit, whose subject is then the PR's title. */ pullRequest?: number };

export type ProjectChangelog = { branch: string | null; commits: CommitView[] };

export const projectMethods = {
  'projects.get': method<z.ZodObject<{}>, ProjectsState>(z.object({})),
  'checkouts.inspect': method<typeof Path, FolderInspection>(Path),
  'checkouts.add': method<typeof AddCheckout, CheckoutView>(AddCheckout),
  'checkouts.clone': method<typeof CloneCheckout, CheckoutView>(CloneCheckout),
  'checkouts.cloneUrl': method<typeof CloneUrl, { url: string }>(CloneUrl),
  'checkouts.remove': method<typeof RemoveCheckout, null>(RemoveCheckout),
  'projects.setProfile': method<typeof SetProfile, ProjectView>(SetProfile),
  'projects.setDelivery': method<typeof DeliverySettings, ProjectView>(DeliverySettings),
  'projects.changelog': method<typeof ProjectId, ProjectChangelog>(ProjectId),
};

export type ProjectEvents = {
  'projects.changed': ProjectsState;
};
