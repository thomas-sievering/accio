import { isAbsolute, relative, sep } from 'node:path';

/** Whether `child` is `parent` or lies beneath it. Both paths must already be absolute or share a base. */
export function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

/** Paths compare case-insensitively on Windows and macOS, with one separator style. */
export function pathKey(p: string): string {
  const unified = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'linux' ? unified : unified.toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}
