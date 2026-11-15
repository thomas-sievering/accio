import { projectKey, type CheckoutView, type ProjectsState } from '@accio/protocol';
import { httpsUrlOf } from '../projects/git.js';
import { checkoutHere } from '../projects/project.js';

export type MissingCheckoutsDeps = {
  /** This machine's projects and checkouts. */
  projects: () => ProjectsState;
  /** This machine's checkout of a repository, cloned from `url` under the profile's folder here when there is none. */
  clone: (repoKey: string, url: string, profileId: string) => Promise<CheckoutView>;
  /** The profile another machine records the repository under and the URL to clone it from; undefined when none has it. */
  source: (repoKey: string) => { profileId: string; url: () => Promise<string> } | undefined;
};

/** A project's checkout on this machine, or why it can't have one. */
export type Found = { checkout: CheckoutView } | { unavailable: string };

/** How long a failed clone is reported instead of tried again. */
const RETRY_AFTER_MS = 10 * 60_000;

/**
 * GLOSSARY: Checkout, Space. This machine's checkout of a project of a space, by its key, cloned here
 * when there is none on disk: under the project's profile as this machine or another one online records it,
 * from the URL a machine with a checkout fetches from. A project without a remote, or that no machine
 * online has, so its profile isn't known, can't be had here.
 */
export class MissingCheckouts {
  private cloning = new Map<string, Promise<CheckoutView>>();
  private failed = new Map<string, { reason: string; at: number }>();

  constructor(private deps: MissingCheckoutsDeps) {}

  /** The project's checkout here, waiting for its clone when it has none. */
  async checkout(key: string): Promise<Found> {
    const found = await this.find(key);
    if (!('cloning' in found)) return found;
    return found.cloning.then((checkout) => ({ checkout }), () => ({ unavailable: this.failed.get(key)?.reason ?? 'its clone failed' }));
  }

  /** The project's checkout here without waiting: one missing is cloned in the background and is `cloning` until done. */
  async lookup(key: string): Promise<Found | { cloning: true }> {
    const found = await this.find(key);
    return 'cloning' in found ? { cloning: true } : found;
  }

  private async find(key: string): Promise<Found | { cloning: Promise<CheckoutView> }> {
    const state = this.deps.projects();
    const project = state.projects.find((p) => projectKey(p) === key);
    const here = await checkoutHere(state, project);
    if (here) return { checkout: here };
    const pending = this.cloning.get(key);
    if (pending) return { cloning: pending };
    const failed = this.failed.get(key);
    if (failed && Date.now() - failed.at < RETRY_AFTER_MS) return { unavailable: failed.reason };
    if (key.startsWith('local:')) return { unavailable: 'it has no remote to clone it from' };
    const source = this.deps.source(key);
    // Each machine records a project's profile itself: this one's record wins.
    const profileId = project?.profileId ?? source?.profileId;
    if (!profileId) return { unavailable: "no machine that has it is online, so its profile isn't known" };
    const clone = (async () => this.deps.clone(key, source ? await source.url() : httpsUrlOf(key), profileId))()
      .then((checkout) => { this.failed.delete(key); return checkout; }, (error: Error) => {
        this.failed.set(key, { reason: lowerFirst(error.message.replace(/\.$/, '')), at: Date.now() });
        throw error;
      })
      .finally(() => this.cloning.delete(key));
    // A clone in the background has nobody waiting for its failure, which is kept in `failed`.
    clone.catch(() => {});
    this.cloning.set(key, clone);
    return { cloning: clone };
  }
}

function lowerFirst(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
