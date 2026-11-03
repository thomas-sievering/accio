import { z } from 'zod';
import { method } from './rpc.js';

/** GLOSSARY: Project. A repository, recognised by its git remote; belongs to exactly one account. */
export type ProjectView = {
  id: string;
  name: string;
  accountId: string;
  /** Normalised remote, such as github.com/owner/repo. Null for a folder without a remote. */
  repoKey: string | null;
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
  /** From the accounts' folders; null when none matches. */
  suggestedAccountId: string | null;
};

const Path = z.object({ path: z.string().trim().min(1, 'Choose a folder') });
const AddCheckout = z.object({ path: z.string().trim().min(1), accountId: z.string().optional() });
const ById = z.object({ id: z.string() });
const SetAccount = z.object({ projectId: z.string(), accountId: z.string() });

export const projectMethods = {
  'projects.get': method<z.ZodObject<{}>, ProjectsState>(z.object({})),
  'checkouts.inspect': method<typeof Path, FolderInspection>(Path),
  'checkouts.add': method<typeof AddCheckout, CheckoutView>(AddCheckout),
  'checkouts.remove': method<typeof ById, null>(ById),
  'projects.setAccount': method<typeof SetAccount, ProjectView>(SetAccount),
};

export type ProjectEvents = {
  'projects.changed': ProjectsState;
};
