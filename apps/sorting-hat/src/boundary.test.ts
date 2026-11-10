import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

/** ADR 0018: the Sorting Hat imports nothing from Accio, so it can leave this repository. */
const root = fileURLToPath(new URL('..', import.meta.url));

it('depends on no Accio package', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const deps = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies });
  expect(deps.filter((d) => d.startsWith('@accio/'))).toEqual([]);
  const tsconfig = JSON.parse(await readFile(join(root, 'tsconfig.json'), 'utf8'));
  expect(tsconfig.references ?? []).toEqual([]);
});

it('imports nothing from Accio or from outside its own folder', async () => {
  const offending: string[] = [];
  for (const file of await readdir(join(root, 'src'), { recursive: true })) {
    if (!/\.[cm]?tsx?$/.test(file)) continue;
    const text = await readFile(join(root, 'src', file), 'utf8');
    for (const [, spec] of text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
      const outside = spec!.startsWith('.') && relative(join(root, 'src'), resolve(root, 'src', dirname(file), spec!)).startsWith('..');
      if (spec!.startsWith('@accio/') || outside) offending.push(`${file}: ${spec}`);
    }
  }
  expect(offending).toEqual([]);
});
