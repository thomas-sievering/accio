import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { maybeGit } from '../git.js';

const exec = promisify(execFile);

/** Runs gh and returns stdout, or rejects. Injected by tests. */
export type GhRunner = (args: string[], options?: { cwd?: string; input?: string }) => Promise<string>;
/** Asks git's credential helpers which user name it would send to a URL, without prompting. */
export type GitUserOf = (cwd: string, url: string) => Promise<string | undefined>;

const runGh: GhRunner = async (args, options) => (await exec('gh', args, { cwd: options?.cwd, windowsHide: true, timeout: 15_000 })).stdout;

/**
 * GLOSSARY: GitHub account. The gh login a profile's threads use on this machine:
 * the one chosen in machine settings, else the one git sends for the repository's
 * origin. Its token reaches gh as GH_TOKEN, so Accio's own reads and the agent's
 * gh commands act as the same account that pushes.
 */
export class GitHubAccounts {
  constructor(
    /** The login chosen for a profile on this machine, if any. */
    private chosen: (profileId: string) => string | undefined,
    private gh: GhRunner = runGh,
    private gitUser: GitUserOf = gitCredentialUser,
  ) {}

  private known?: { at: number; logins: Promise<string[]> };

  /** The logins gh is signed in to on github.com here; empty when gh is missing or signed out. Read at most every 30 seconds. */
  logins(): Promise<string[]> {
    if (this.known && Date.now() - this.known.at < 30_000) return this.known.logins;
    const logins = this.gh(['auth', 'status', '--hostname', 'github.com', '--json', 'hosts']).then((out) => {
      const status = JSON.parse(out);
      return [...new Set<string>((status.hosts?.['github.com'] ?? []).map((a: any) => a.login).filter((l: unknown) => typeof l === 'string'))].sort();
    }).catch(() => [] as string[]);
    this.known = { at: Date.now(), logins };
    return logins;
  }

  /** The login for a profile in a repository: the chosen one, else git's for origin when gh knows it. */
  async login(profileId: string, cwd?: string): Promise<string | undefined> {
    const chosen = this.chosen(profileId);
    if (chosen) return chosen;
    if (!cwd) return undefined;
    const origin = await maybeGit(cwd, 'config', '--get', 'remote.origin.url');
    if (!origin || !/^https:\/\/github\.com\//i.test(origin)) return undefined;
    const logins = await this.logins();
    if (!logins.length) return undefined;
    const user = await this.gitUser(cwd, origin);
    return user && logins.includes(user) ? user : undefined;
  }

  /**
   * GH_TOKEN for gh run on behalf of a profile, or nothing to leave gh's active account.
   * The token stays in the child's environment; it is never logged or stored.
   */
  async env(profileId: string, cwd?: string): Promise<Record<string, string>> {
    const login = await this.login(profileId, cwd);
    if (!login) return {};
    try {
      const token = (await this.gh(['auth', 'token', '--hostname', 'github.com', '--user', login])).trim();
      return token ? { GH_TOKEN: token } : {};
    } catch { return {}; }
  }
}

async function gitCredentialUser(cwd: string, url: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    // Never prompt: a terminal or a credential manager window would block a background read.
    const child = execFile('git', ['credential', 'fill'], {
      cwd, windowsHide: true, timeout: 10_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' },
    }, (error, stdout) => resolve(error ? undefined : /^username=(.+)$/m.exec(stdout)?.[1]?.trim()));
    child.stdin?.end(`url=${url.replace(/\.git$/i, '')}\n\n`);
  });
}
