import { join } from 'node:path';
import { JsonFile } from '@accio/persistence';
import type { ChangelogEntry } from '@accio/protocol';
import type { Broadcast } from '../rpc/router.js';
import type { Thread } from './thread.js';

/**
 * GLOSSARY: Changelog. Every change delivered on this machine, each logged once by its
 * delivery id. Entries outlive their thread's later deliveries, archive and deletion.
 */
export class Changelog {
  private file: JsonFile<ChangelogEntry[]>;
  private entries: ChangelogEntry[] = [];

  constructor(home: string, private broadcast: Broadcast) {
    this.file = new JsonFile(join(home, 'changelog.json'), () => []);
  }

  async load() { this.entries = await this.file.read(); }

  /** Newest first. */
  list(): ChangelogEntry[] { return [...this.entries].sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt)); }

  /** Adds the entry unless its delivery is already logged; returns whether it was new. */
  async add(entry: ChangelogEntry): Promise<boolean> {
    if (this.entries.some((e) => e.id === entry.id)) return false;
    const next = [...this.entries, entry];
    await this.file.write(next);
    this.entries = next;
    this.broadcast('changelog.changed', this.list());
    return true;
  }
}

/** The entry for a thread's verified delivery, or undefined while it is not delivered. */
export function changelogEntry(thread: Thread): ChangelogEntry | undefined {
  const d = thread.delivery;
  if (d?.status !== 'delivered') return undefined;
  const url = d.pullRequest?.url ?? d.pullRequestUrl;
  const number = d.pullRequest?.number ?? Number(d.pullRequestUrl?.match(/\/pull\/(\d+)(?:[/?#]|$)/)?.[1]);
  const revision = d.publishedRevision ?? d.pullRequest?.mergeRevision ?? d.revision;
  return {
    id: d.id ?? `${thread.id}:${d.requestedAt}`,
    threadId: thread.id,
    projectId: thread.projectId,
    profileId: thread.profileId,
    title: thread.title,
    ...(d.note ? { note: d.note } : {}),
    target: d.pullRequest?.baseBranch ?? d.baseBranch,
    ...(url && number ? { pullRequest: { number, url } } : {}),
    ...(revision ? { revision } : {}),
    deliveredAt: d.completedAt ?? d.checkedAt ?? thread.updatedAt,
  };
}
