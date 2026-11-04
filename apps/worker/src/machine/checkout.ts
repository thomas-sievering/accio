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
