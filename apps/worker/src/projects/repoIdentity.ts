/**
 * How a project is recognised across machines: by its git remote, normalised to
 * host/path (the same rule T3 uses). Local remotes (file: URLs, plain paths) are
 * ignored, since they would give unrelated repos the same identity.
 */

export type Remote = { name: string; url: string };

/** github.com/Owner/Repo.git, git@github.com:owner/repo, https://u@github.com/owner/repo/ → github.com/owner/repo */
export function normalizeRemoteUrl(url: string): string | null {
  const raw = url.trim();
  if (!raw || raw.startsWith('file:') || /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('/') || raw.startsWith('.')) {
    return null;
  }
  let host: string;
  let path: string;
  const scp = raw.match(/^(?:[^@/]+@)?([^:/]+):(?!\/\/)(.+)$/);
  if (scp && !raw.includes('://')) {
    host = scp[1]!;
    path = scp[2]!;
  } else {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }
    if (u.protocol === 'file:') return null;
    host = u.hostname;
    path = u.pathname;
  }
  path = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  if (!host || !path) return null;
  return `${host}/${path}`.toLowerCase();
}

/**
 * The remote that names the project: a fork groups by its own origin, so origin
 * wins, then upstream, then the first remaining remote alphabetically.
 */
export function repoKeyOf(remotes: readonly Remote[]): string | null {
  const usable = remotes
    .map((r) => ({ name: r.name, key: normalizeRemoteUrl(r.url) }))
    .filter((r): r is { name: string; key: string } => r.key !== null);
  const pick =
    usable.find((r) => r.name === 'origin') ??
    usable.find((r) => r.name === 'upstream') ??
    [...usable].sort((a, b) => a.name.localeCompare(b.name))[0];
  return pick?.key ?? null;
}

/** Parses `git remote -v`, keeping fetch URLs. */
export function parseRemotes(output: string): Remote[] {
  const remotes: Remote[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
    if (m) remotes.push({ name: m[1]!, url: m[2]! });
  }
  return remotes;
}
