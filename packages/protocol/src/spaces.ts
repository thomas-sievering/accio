import { z } from 'zod';
import { method } from './rpc.js';
import type { ThreadView } from './threads.js';

/**
 * GLOSSARY: Project, as the hub and the paired machines know it: its repository key,
 * or `local:<project id>` for a folder without a remote. Hub resource scopes use the same key.
 */
export const projectKey = (project: { id: string; repoKey: string | null }) => project.repoKey ?? `local:${project.id}`;

const ProjectKey = z.string().trim().min(1).max(300);

/**
 * GLOSSARY: Space. A named group of projects that share context, stored with the hub's
 * shared settings (ADR 0019). A project key is in at most one space. The home, when set,
 * is one of the space's projects (GLOSSARY: Home).
 */
export type Space = { id: string; name: string; projectKeys: string[]; homeProjectKey?: string };

/** Saves a whole space: without `id` it adds one; without `homeProjectKey` the space has no home. */
export const SaveSpace = z.object({
  id: z.string().min(1).max(128).optional(),
  name: z.string().trim().min(1, 'Enter a name for the space.').max(100),
  projectKeys: z.array(ProjectKey).max(500),
  homeProjectKey: ProjectKey.optional(),
});
export type SaveSpace = z.output<typeof SaveSpace>;
const SpaceId = z.object({ id: z.string().min(1).max(128) });

/**
 * GLOSSARY: Home. Creates a new project from Accio's built-in home template, in the profile's folder
 * on this machine (else the home folder), as a local folder or a new GitHub repo under that profile's
 * GitHub login. It saves `space` as given with the new project added as its home, then starts the
 * home's first thread with the starter prompt.
 */
export const CreateHome = z.object({
  space: SaveSpace.omit({ homeProjectKey: true }),
  name: z.string().trim().min(1, 'Enter a name for the home.').max(100)
    .regex(/^(?!\.+$)[A-Za-z0-9._-]+$/, "Use letters, digits, '.', '-' or '_', as in a folder or repository name."),
  profileId: z.string().min(1),
  location: z.enum(['folder', 'github']),
});
export type CreateHome = z.output<typeof CreateHome>;
export type CreatedHome = { space: Space; checkoutId: string; path: string; thread: ThreadView };

/** No accio tool reaches these: only the user decides what context a project gets. */
export const spaceMethods = {
  'spaces.list': method<z.ZodObject<{}>, Space[]>(z.object({})),
  'spaces.save': method<typeof SaveSpace, Space>(SaveSpace),
  /** Deletes only the grouping; its projects, checkouts and threads stay as they are. */
  'spaces.delete': method<typeof SpaceId, null>(SpaceId),
  'spaces.createHome': method<typeof CreateHome, CreatedHome>(CreateHome),
};

export type SpaceEvents = { 'spaces.changed': Space[] };
