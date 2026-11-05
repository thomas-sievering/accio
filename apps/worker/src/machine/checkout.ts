import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maybeGit } from '../git.js';

/** The git checkout this worker's code runs from, when it is Accio's own repository. */
export async function appCheckout(from = dirname(fileURLToPath(import.meta.url))): Promise<string | undefined> {
  const root = await maybeGit(from, 'rev-parse', '--show-toplevel');
  if (!root) return undefined;
  return await access(join(root, 'apps/desktop/package.json')).then(() => root, () => undefined);
}

/**
 * GLOSSARY: Accio version. 0.1.<commits on HEAD>, so it grows by one with each commit on main.
 * The hub image's build counts the same way (.github/workflows/hub.yml).
 */
export async function checkoutVersion(root: string): Promise<string | undefined> {
  const count = await maybeGit(root, 'rev-list', '--count', 'HEAD');
  return count ? `0.1.${count}` : undefined;
}
