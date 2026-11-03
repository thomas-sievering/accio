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
const DeliverySettings = z.object({ projectId: z.string(), deliveryPolicy: z.enum(['direct', 'pull-request']), previewCommand: z.string().trim().max(2000) });

export const projectMethods = {
  'projects.get': method<z.ZodObject<{}>, ProjectsState>(z.object({})),
  'checkouts.inspect': method<typeof Path, FolderInspection>(Path),
  'checkouts.add': method<typeof AddCheckout, CheckoutView>(AddCheckout),
  'checkouts.remove': method<typeof RemoveCheckout, null>(RemoveCheckout),
  'projects.setProfile': method<typeof SetProfile, ProjectView>(SetProfile),
  'projects.setDelivery': method<typeof DeliverySettings, ProjectView>(DeliverySettings),
};

export type ProjectEvents = {
  'projects.changed': ProjectsState;
};
