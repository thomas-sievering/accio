import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { CheckoutView, ProjectView } from '@accio/protocol';
import { UserError } from '../rpc/router.js';
import { pathKey, samePath } from '../paths.js';

export type Project = ProjectView;
export type Checkout = CheckoutView;
export type ProjectsData = { projects: Project[]; checkouts: Checkout[] };

/** What git says about a folder. */
export type FolderFacts = { root: string; repoKey: string | null };

function isInside(path: string, root: string): boolean {
  const p = pathKey(path);
  const r = pathKey(root);
  return p === r || p.startsWith(r + '/');
}

/** The profile whose folders hold this path most specifically (GLOSSARY: Profile folder). */
export function suggestProfile(profiles: readonly { id: string; folders: string[] }[], path: string): string | null {
  let best: { id: string; len: number } | null = null;
  for (const a of profiles) {
    for (const root of a.folders) {
      if (isInside(path, root) && (!best || root.length > best.len)) best = { id: a.id, len: root.length };
    }
  }
  return best?.id ?? null;
}

export function projectNameFor(facts: FolderFacts): string {
  return facts.repoKey ? facts.repoKey.split('/').pop()! : basename(facts.root) || facts.root;
}

/** The project a folder's checkout joins: the one with the same repo, if any. */
export function findProjectFor(data: ProjectsData, facts: FolderFacts): Project | null {
  if (facts.repoKey) return data.projects.find((p) => p.repoKey === facts.repoKey) ?? null;
  // GLOSSARY: a folder without a git remote is a project with a single checkout.
  const checkout = data.checkouts.find((c) => samePath(c.path, facts.root));
  return checkout ? (data.projects.find((p) => p.id === checkout.projectId) ?? null) : null;
}

/**
 * Adds a checkout. A known repo joins its project and keeps that project's
 * profile; anything else becomes a new project under the chosen profile.
 */
export function addCheckout(
  data: ProjectsData,
  facts: FolderFacts,
  profileId: string | undefined,
): { data: ProjectsData; checkout: Checkout } {
  if (data.checkouts.some((c) => samePath(c.path, facts.root))) {
    throw new UserError(`${facts.root} is already added`);
  }
  let project = findProjectFor(data, facts);
  let projects = data.projects;
  if (!project) {
    if (!profileId) throw new UserError('Choose the profile this project belongs to');
    project = { id: randomUUID(), name: projectNameFor(facts), profileId, repoKey: facts.repoKey };
    projects = [...projects, project];
  }
  const checkout: Checkout = { id: randomUUID(), projectId: project.id, path: facts.root };
  return { data: { projects, checkouts: [...data.checkouts, checkout] }, checkout };
}

/** Removes a checkout; a project left without checkouts goes with it. */
export function removeCheckout(data: ProjectsData, checkoutId: string): ProjectsData {
  const checkout = data.checkouts.find((c) => c.id === checkoutId);
  if (!checkout) throw new UserError('No such checkout');
  const checkouts = data.checkouts.filter((c) => c.id !== checkoutId);
  const projectStays = checkouts.some((c) => c.projectId === checkout.projectId);
  return { checkouts, projects: projectStays ? data.projects : data.projects.filter((p) => p.id !== checkout.projectId) };
}
