import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

/**
 * ADR 0018: the Sorting Hat imports nothing from Accio, so it carries copies of
 * some of Accio's packages. This reads both as text, never importing a package,
 * and fails when a copy differs from its package beyond the differences below.
 * When a package changes, bring the change into the copy or record why not.
 */
const repo = fileURLToPath(new URL('../../..', import.meta.url));

/** Lines of the package (`from`) that the copy replaces with `to`; `from` must occur exactly once. */
type Intended = { reason: string; from: string[]; to: string[] };
type Copy = {
  copy: string;
  package: string;
  /** Compare only these declarations, with their doc comments; omit to compare whole files. */
  names?: string[];
  intended: Intended[];
};

/** A block of whole lines, written as they appear in the file. */
const block = (strings: TemplateStringsArray) => String.raw(strings).replace(/^\n|\n$/g, '').split('\n');

const COPIES: Copy[] = [
  {
    copy: 'apps/sorting-hat/src/store.ts',
    package: 'packages/persistence/src/index.ts',
    intended: [
      {
        reason: 'The copy says where it comes from.',
        from: block`import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';`,
        to: block`
// A copy of the JsonFile and JsonStore in Accio's packages/persistence: the Sorting Hat
// imports nothing from Accio (ADR 0018), so it carries its own.
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';`,
      },
      {
        reason: 'The Sorting Hat creates no private files or directories of its own.',
        from: block`export { privateDirectory, privateFile, privatePowerShell } from './privateFiles.js';`,
        to: [],
      },
      {
        reason: 'An indentation option, so large state files can be written on one line.',
        from: block`
    private mode = 0o600,
  ) {}`,
        to: block`
    private mode = 0o600,
    /** Indentation, as JSON.stringify takes it; 0 writes one line. */
    private space = 2,
  ) {}`,
      },
      {
        reason: 'Writes with the indentation option.',
        from: block`    const body = JSON.stringify(value, null, 2);`,
        to: block`    const body = JSON.stringify(value, null, this.space);`,
      },
    ],
  },
  {
    copy: 'apps/sorting-hat/src/codex.ts',
    package: 'packages/codex/src/index.ts',
    intended: [
      {
        reason: 'The copy says where it comes from and what it leaves out.',
        from: block`import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';`,
        to: block`
// The part of Accio's packages/codex the Sorting Hat needs for ChatGPT accounts:
// starting the bundled Codex app-server in an account's own credential home. It
// imports nothing from Accio (ADR 0018), so it carries its own copy. It never
// starts a Codex thread or turn.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';`,
      },
      {
        reason: 'Only codexInstall read files, and the Sorting Hat does not report its Codex version.',
        from: block`import { access, readFile } from 'node:fs/promises';`,
        to: [],
      },
      {
        reason: 'Client requests serve Accio tools on threads, which the Sorting Hat never starts.',
        from: block`  onRequest?(handler: (method: string, params: Record<string, any>) => Promise<unknown>): () => void;`,
        to: [],
      },
      {
        reason: 'Accounts need no extra environment, configuration or experimental API.',
        from: block`export type CodexFactory = (options: { home: string; cwd?: string; env?: NodeJS.ProcessEnv; config?: string[]; signal?: AbortSignal; experimental?: boolean }) => Promise<CodexClient>;`,
        to: block`export type CodexFactory = (options: { home: string; cwd?: string; signal?: AbortSignal }) => Promise<CodexClient>;`,
      },
      {
        reason: 'Only startCodex uses the environment, and the home is an account\'s, not Accio\'s.',
        from: block`
/** Remove inherited provider credentials and configuration before choosing an accio home. */
export function codexEnv(base: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {`,
        to: block`
/** Remove inherited provider credentials and configuration before choosing the credential home. */
function codexEnv(base: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {`,
      },
      {
        reason: 'Starts Codex without the options the smaller factory leaves out.',
        from: block`
export const startCodex: CodexFactory = async ({ home, cwd, env = process.env, config = [], signal, experimental = false }) => {
  if (signal?.aborted) throw new Error('Codex was interrupted before starting');
  const args = ['app-server', ...['cli_auth_credentials_store="file"', ...config].flatMap((c) => ['-c', c])];
  const child = spawn(executable(), args, { cwd, env: codexEnv(env, home), windowsHide: true, stdio: 'pipe' });`,
        to: block`
export const startCodex: CodexFactory = async ({ home, cwd, signal }) => {
  if (signal?.aborted) throw new Error('Codex was interrupted before starting');
  const args = ['app-server', '-c', 'cli_auth_credentials_store="file"'];
  const child = spawn(executable(), args, { cwd, env: codexEnv(process.env, home), windowsHide: true, stdio: 'pipe' });`,
      },
      {
        reason: 'Initializes without the experimental API, under the client name Codex already knows.',
        from: block`
    await client.request('initialize', { clientInfo: { name: 'accio', title: 'accio', version: '0.1.0' }, ...(experimental ? { capabilities: { experimentalApi: true } } : {}) });`,
        to: block`
    // The client name Codex reports upstream; unchanged from when the hub held accounts.
    await client.request('initialize', { clientInfo: { name: 'accio', title: 'accio', version: '0.1.0' } });`,
      },
      {
        reason: 'No client request handler, as above.',
        from: block`  private requestHandler?: (method: string, params: Record<string, any>) => Promise<unknown>;`,
        to: [],
      },
      {
        reason: 'Refuses every client request, as above.',
        from: block`
          // Only the machine adapter registers a narrowly scoped client tool handler.
          const respond = (response: object) => { if (!this.ended) child.stdin.write(JSON.stringify({ id: msg.id, ...response }) + '\n'); };
          if (this.requestHandler) {
            void Promise.resolve().then(() => this.requestHandler!(msg.method, msg.params ?? {})).then(
              result => respond({ result }), () => respond({ error: { code: -32601, message: 'Unsupported or expired Accio tool request' } }),
            );
          } else respond({ error: { code: -32601, message: 'accio does not implement this client request' } });`,
        to: block`
          if (!this.ended) child.stdin.write(JSON.stringify({ id: msg.id, error: { code: -32601, message: 'The Sorting Hat does not implement this client request' } }) + '\n');`,
      },
      {
        reason: 'No client request handler, as above.',
        from: block`
  onRequest(handler: (method: string, params: Record<string, any>) => Promise<unknown>) {
    this.requestHandler = handler;
    return () => { if (this.requestHandler === handler) this.requestHandler = undefined; };
  }`,
        to: [],
      },
      {
        reason: 'The Sorting Hat runs no turns.',
        from: block`      // after the app-server exits, even after kill(). Never pin a turn on them.`,
        to: block`      // after the app-server exits, even after kill(). Never pin a caller on them.`,
      },
      {
        reason: 'The Sorting Hat does not report its Codex version.',
        from: block`
}

export async function codexInstall(): Promise<{ harnessId: 'codex'; version: string | null }> {
  try {
    await access(executable());
    const pkg = JSON.parse(await readFile(join(dirname(launcher()), '..', 'package.json'), 'utf8'));
    return { harnessId: 'codex', version: pkg.version };
  } catch { return { harnessId: 'codex', version: null }; }
}`,
        to: block`}`,
      },
    ],
  },
  {
    copy: 'apps/sorting-hat/src/types.ts',
    package: 'packages/protocol/src/profiles.ts',
    names: ['ProviderId', 'AccountView'],
    intended: [],
  },
  {
    copy: 'apps/sorting-hat/src/types.ts',
    package: 'packages/protocol/src/limits.ts',
    names: ['LimitWindow', 'LimitsSnapshot', 'LimitsProblem', 'AccountLimitsView'],
    intended: [
      {
        reason: 'Limits are shared by houses in the Sorting Hat, not by profiles.',
        from: block`/** One hub-owned account snapshot, shared by every profile selecting that account. */`,
        to: block`/** GLOSSARY: Limits. One account's snapshot, shared by every house that has the account. */`,
      },
    ],
  },
  {
    copy: 'apps/sorting-hat/src/types.ts',
    package: 'packages/protocol/src/media.ts',
    names: ['IMAGE_TYPES'],
    intended: [
      {
        reason: 'The Sorting Hat reads these for ChatGPT models, not for pasted images.',
        from: block`/** GLOSSARY: Image attachment. The image types a pasted image may have; every harness reads these four. */`,
        to: block`/** Image types a ChatGPT model reads when Codex reports image input. */`,
      },
    ],
  },
];

const read = async (path: string) => (await readFile(join(repo, path), 'utf8')).replace(/\r\n/g, '\n').split('\n');

/** One exported declaration with the doc comment above it, ending at its top-level semicolon. */
function declaration(lines: string[], name: string, path: string): string[] {
  const start = lines.findIndex((line) => new RegExp(`^export (?:type|const|interface) ${name}\\b`).test(line));
  if (start < 0) throw new Error(`${path} has no export named ${name}`);
  let first = start;
  if (lines[start - 1]?.trimEnd().endsWith('*/')) while (first > 0 && !lines[first]!.startsWith('/**')) first--;
  let depth = 0;
  for (let end = start; end < lines.length; end++) {
    for (const c of lines[end]!) depth += c === '{' || c === '[' || c === '(' ? 1 : c === '}' || c === ']' || c === ')' ? -1 : 0;
    if (depth === 0 && /[;}]\s*$/.test(lines[end]!)) return lines.slice(first, end + 1);
  }
  throw new Error(`${path}: ${name} never ends`);
}

const indexOf = (lines: string[], part: string[]) => {
  const found: number[] = [];
  for (let i = 0; i + part.length <= lines.length; i++) if (part.every((line, j) => lines[i + j] === line)) found.push(i);
  return found;
};

it.each(COPIES.map((c) => [`${c.copy} copies ${c.package}`, c] as const))('%s', async (_, c) => {
  let expected = await read(c.package);
  let actual = await read(c.copy);
  if (c.names) {
    expected = c.names.flatMap((name) => [...declaration(expected, name, c.package), '']);
    actual = c.names.flatMap((name) => [...declaration(actual, name, c.copy), '']);
  }
  for (const difference of c.intended) {
    const found = indexOf(expected, difference.from);
    if (found.length !== 1) throw new Error(`${c.copy}: the intended difference "${difference.reason}" matches ${found.length} places in ${c.package}; update it`);
    expected.splice(found[0]!, difference.from.length, ...difference.to);
  }
  expect(actual.join('\n'), `${c.copy} differs from ${c.package} beyond its intended differences`).toBe(expected.join('\n'));
});
