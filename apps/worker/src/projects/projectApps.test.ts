import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProjectAppView, ProjectsState } from '@accio/protocol';
import { git } from '../git.js';
import { Router } from '../rpc/router.js';
import { ProjectApps } from './projectApps.js';
import type { Projects } from './projects.js';
import { readableLog, startTarget, shouldAutoUpdate } from './projectApp.js';

vi.setConfig({ testTimeout: 60_000 });

let apps: ProjectApps | undefined;
let home: string | undefined;
afterEach(async () => {
  await apps?.close();
  apps = undefined;
  if (home) await rm(home, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
});

const SERVER = (version: string) =>
  `require('http').createServer((q,s)=>s.end('${version}|'+(process.env.ACCIO_HOME||'clean'))).listen(Number(process.env.PORT),'127.0.0.1');\n`;

async function setup() {
  home = await mkdtemp(join(tmpdir(), 'accio-apps-'));
  const source = join(home, 'source');
  const origin = join(home, 'origin.git');
  await mkdir(source);
  await git(source, 'init', '--quiet', '-b', 'main');
  await git(source, 'config', 'user.name', 'Accio Test');
  await git(source, 'config', 'user.email', 'accio@example.test');
  await git(source, 'config', 'core.autocrlf', 'false');
  await writeFile(join(source, 'server.cjs'), SERVER('v1'));
  await git(source, 'add', '.');
  await git(source, 'commit', '--quiet', '-m', 'v1');
  await git(home, 'init', '--quiet', '--bare', '-b', 'main', origin);
  await git(source, 'remote', 'add', 'origin', origin);
  await git(source, 'push', '--quiet', '-u', 'origin', 'main');
  await git(source, 'remote', 'set-head', 'origin', '-a');
  const state: ProjectsState = {
    projects: [{ id: 'p1', name: 'demo', profileId: 'personal', repoKey: null, startCommand: 'node server.cjs', setupCommand: 'node -e "require(\'fs\').writeFileSync(\'setup.txt\', String(Date.now()))"' }],
    checkouts: [{ id: 'c1', projectId: 'p1', path: source }],
  };
  const events: ProjectAppView[][] = [];
  apps = new ProjectApps(join(home, 'worker'), { state: () => state } as unknown as Projects, (event, data) => { if (event === 'projectApps.changed') events.push(data as ProjectAppView[]); },
    { pollMs: 300, graceMs: 1500, debounceMs: 100, setupTimeoutMs: 60_000 });
  await apps.load();
  const router = new Router();
  apps.register(router);
  let id = 0;
  const call = async (method: string, params: object): Promise<any> => {
    const response = await router.handle({ id: ++id, method, params });
    if (!response?.ok) throw new Error(response && !response.ok ? response.error : 'no response');
    return response.result;
  };
  const view = async () => (await call('projectApps.get', {}) as ProjectAppView[]).find((v) => v.projectId === 'p1')!;
  const until = async (predicate: (v: ProjectAppView) => boolean) => {
    for (let i = 0; i < 200; i++) { const v = await view(); if (predicate(v)) return v; await new Promise((r) => setTimeout(r, 100)); }
    throw new Error(`Timed out; last ${JSON.stringify(await view())}`);
  };
  const commit = async (file: string, content: string, message: string) => {
    await writeFile(join(source, file), content);
    await git(source, 'add', '.');
    await git(source, 'commit', '--quiet', '-m', message);
    await git(source, 'push', '--quiet');
    return git(source, 'rev-parse', 'HEAD');
  };
  return { home, source, state, call, view, until, commit, events };
}

it('runs the default branch in its own checkout, follows it, and restores the previous commit when an update fails', async () => {
  const { home, source, call, until, commit } = await setup();
  await call('projectApps.start', { projectId: 'p1' });
  const running = await until((v) => v.status === 'running' && !!v.url);
  expect(running.commit?.subject).toBe('v1');
  expect(running.branch).toBe('main');
  // Its own environment and checkout: the worker's settings stay out, and threads' files are untouched.
  expect(await (await fetch(running.url!)).text()).toBe('v1|clean');
  const appCheckout = join(home, 'worker', 'project-apps', 'p1');
  expect(await readFile(join(appCheckout, 'setup.txt'), 'utf8')).toBeTruthy();
  await writeFile(join(source, 'server.cjs'), 'local edits in a thread do not reach the app');

  await git(source, 'checkout', '--quiet', '--', 'server.cjs');
  await commit('server.cjs', SERVER('v2'), 'v2');
  const updated = await until((v) => v.status === 'running' && v.commit?.subject === 'v2' && !!v.url);
  expect(await (await fetch(updated.url!)).text()).toBe('v2|clean');

  await commit('server.cjs', 'process.exit(3)\n', 'broken');
  const restored = await until((v) => v.status === 'running' && !!v.failedUpdate && !!v.url);
  expect(restored.commit?.subject).toBe('v2');
  expect(restored.failedUpdate?.commit.subject).toBe('broken');
  expect(restored.failedUpdate?.message).toContain('code 3');
  expect(await (await fetch(restored.url!)).text()).toBe('v2|clean');
  // The failed tip is not retried by itself.
  await new Promise((r) => setTimeout(r, 1000));
  expect((await until(() => true)).commit?.subject).toBe('v2');

  const logs = await call('projectApps.logs', { projectId: 'p1' });
  expect(logs.text).toContain('Update failed');
  const changelog = await call('projects.changelog', { projectId: 'p1' });
  expect(changelog.commits.map((c: { subject: string }) => c.subject)).toEqual(['broken', 'v2', 'v1']);

  await call('projectApps.stop', { projectId: 'p1' });
  const stopped = await until((v) => v.status === 'stopped');
  expect(stopped.url).toBeNull();
  await expect(fetch(updated.url!)).rejects.toThrow();
});

it('with auto-update off, keeps its commit, offers the update, and restarts without changing code', async () => {
  const { call, until, commit } = await setup();
  await call('projectApps.setAutoUpdate', { projectId: 'p1', on: false });
  await call('projectApps.start', { projectId: 'p1' });
  const first = await until((v) => v.status === 'running' && !!v.url);
  await commit('server.cjs', SERVER('v2'), 'v2');
  const offered = await until((v) => v.available?.subject === 'v2');
  expect(offered.commit?.subject).toBe('v1');

  await call('projectApps.restart', { projectId: 'p1' });
  const restarted = await until((v) => v.status === 'running' && !!v.url && v.startedAt !== first.startedAt);
  expect(restarted.commit?.subject).toBe('v1');

  await call('projectApps.update', { projectId: 'p1' });
  const updated = await until((v) => v.status === 'running' && v.commit?.subject === 'v2' && !!v.url);
  expect(updated.available).toBeNull();
  expect(await (await fetch(updated.url!)).text()).toBe('v2|clean');
});

it('reports a start command that exits as failed', async () => {
  const { state, call, until } = await setup();
  state.projects[0]!.startCommand = 'node -e "process.exit(5)"';
  await call('projectApps.start', { projectId: 'p1' });
  const failed = await until((v) => v.status === 'failed');
  expect(failed.error).toContain('code 5');
});

it('chooses what Start and polls run', () => {
  const commit = (sha: string) => ({ sha, subject: sha, author: 'a', at: '' });
  expect(startTarget({ wanted: true, autoUpdate: true }, 'b')).toBe('b');
  expect(startTarget({ wanted: true, autoUpdate: true, commit: commit('a') }, 'b')).toBe('b');
  expect(startTarget({ wanted: true, autoUpdate: false, commit: commit('a') }, 'b')).toBe('a');
  expect(startTarget({ wanted: true, autoUpdate: true, commit: commit('a'), failedUpdate: { commit: commit('b'), message: '', at: '' } }, 'b')).toBe('a');
  expect(startTarget({ wanted: true, autoUpdate: true, commit: commit('a') }, null)).toBe('a');
  expect(shouldAutoUpdate({ wanted: true, autoUpdate: true, commit: commit('a') }, 'b')).toBe(true);
  expect(shouldAutoUpdate({ wanted: false, autoUpdate: true, commit: commit('a') }, 'b')).toBe(false);
  expect(shouldAutoUpdate({ wanted: true, autoUpdate: true, commit: commit('a') }, 'a')).toBe(false);
  expect(readableLog('\x1b[32mok\x1b[0m\n10%\r50%\r100%\n')).toBe('ok\n100%\n');
});
