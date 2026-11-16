import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResourceAccess } from '@accio/hub';
import type { ResourcesState, ToolEntry, ToolStatus } from '@accio/protocol';
import { ManagedTools } from './tools.js';

const tool: ToolEntry = { id: 'surf', name: 'Surf', package: 'surf-cli', version: '1.0.0', executable: 'surf', checkArgs: ['--version'], scope: { global: true, profileIds: [], spaceIds: [], projectKeys: [] } };

function fakeStore(tools: ToolEntry[]) {
  const state: ResourcesState = { tools, toolStatuses: [], sources: [], skills: [], mcps: [], skillVersions: [] };
  const store = { state: () => state, setToolStatus: async (status: ToolStatus) => { state.toolStatuses = [...state.toolStatuses.filter(s => s.toolId !== status.toolId), status]; } };
  return { state, store: store as unknown as ResourceAccess };
}

describe('ManagedTools', () => {
  let home: string | undefined;
  afterEach(async () => { if (home) await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

  it('installs with pnpm into one folder per machine, with install scripts allowed, and keeps the package description', async () => {
    home = await mkdtemp(join(tmpdir(), 'accio-tools-'));
    const { state, store } = fakeStore([tool]);
    const calls: { command: string; args: string[] }[] = [];
    const tools = new ManagedTools(home, 'here', store, () => {}, async () => 'repair', async (command, args) => {
      calls.push({ command, args });
      if (args.includes('add')) {
        const folder = join(args[args.indexOf('--dir') + 1]!, 'node_modules', 'surf-cli');
        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, 'package.json'), JSON.stringify({ version: '1.0.0', description: 'Drives a browser', bin: { surf: 'cli.js' } }));
        await writeFile(join(folder, 'cli.js'), '');
      }
      return '1.0.0';
    }, async () => ({ command: 'pnpm', args: [] }));
    const status = await tools.check(tool);
    expect(status).toMatchObject({ status: 'ready', description: 'Drives a browser' });
    expect(calls[0]).toEqual({ command: 'pnpm', args: ['add', '--dir', tools.folder(tool), '--ignore-workspace', '--config.dangerously-allow-all-builds=true', 'surf-cli@1.0.0'] });
    expect(state.toolStatuses[0]?.status).toBe('ready');
    // Installed once: the next check only runs the health check.
    await tools.check(tool);
    expect(calls.filter(c => c.args.includes('add'))).toHaveLength(1);
    await tools.close();
  });

  it('rechecks on a hub change only the CLIs whose installation changed', async () => {
    home = await mkdtemp(join(tmpdir(), 'accio-tools-'));
    const { state, store } = fakeStore([tool]);
    let checks = 0;
    const tools = new ManagedTools(home, 'here', store, () => {}, async () => 'repair', async (_command, args) => { if (!args.includes('add')) checks++; return '1.0.0'; }, async () => ({ command: 'pnpm', args: [] }));
    const folder = join(tools.folder(tool), 'node_modules', 'surf-cli');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'package.json'), JSON.stringify({ version: '1.0.0', bin: { surf: 'cli.js' } }));
    await writeFile(join(folder, 'cli.js'), '');
    tools.sync(); await tools.settled(['surf'], 5_000);
    expect(checks).toBe(1);
    state.tools = [{ ...tool, description: 'Renamed', scope: { ...tool.scope, global: false } }];
    tools.sync(); await tools.settled(['surf'], 5_000);
    expect(checks).toBe(1);
    state.tools = [{ ...tool, checkArgs: ['--help'] }];
    tools.sync(); await tools.settled(['surf'], 5_000);
    expect(checks).toBe(2);
    await tools.close();
  });
});
