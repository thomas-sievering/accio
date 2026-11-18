import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { McpSave, McpView } from '@accio/protocol';
import { addMcpTool, type AddMcpDeps } from './addMcp.js';

const at = { profileId: 'personal', spaceId: 'agents', projectKey: 'github.com/me/app' };
const none = { global: false, profileIds: [], spaceIds: [], projectKeys: [] };
function setup(over: Partial<AddMcpDeps> = {}, mcps: McpView[] = []) {
  const saved: McpSave[] = [];
  const tokens: [string, string][] = [];
  const deps: AddMcpDeps = {
    caller: (id) => id === 't1' ? { profileId: 'personal', projectId: 'p1' } : undefined,
    levelContext: () => at,
    names: () => ({ profile: 'Personal', space: 'Agents', project: 'App' }),
    mcps: () => mcps,
    save: vi.fn(async (mcp) => { saved.push(mcp); return { ...mcp, args: mcp.args ?? [], auth: mcp.auth ?? 'none', scope: mcp.scope ?? none, signedIn: false } as McpView; }),
    beginSignIn: vi.fn(async (id) => ({ url: `https://auth.example.test/authorize?client=${id}` })),
    setToken: vi.fn(async (id, token) => { tokens.push([id, token]); }),
    confirm: vi.fn(async () => 'allowed' as const),
    ...over,
  };
  return { tool: addMcpTool(deps), deps, saved, tokens };
}
const call = (tool: ReturnType<typeof setup>['tool'], args: Record<string, unknown>, threadId = 't1') =>
  tool.call(args as never, { threadId, signal: new AbortController().signal, progress: () => {} });
const mobbin = { name: 'Mobbin', url: 'https://mcp.mobbin.test/mcp' };

describe('add_mcp', () => {
  it('adds a remote server for the thread\'s project by default, from the next turn', async () => {
    const { tool, saved, deps } = setup();
    const text = await call(tool, mobbin);
    expect(saved[0]).toMatchObject({ id: 'mobbin', name: 'Mobbin', transport: 'http', url: 'https://mcp.mobbin.test/mcp', auth: 'none', scope: { global: false, projectKeys: ['github.com/me/app'] } });
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(text).toContain('for threads in App');
    expect(text).toContain('next turn');
  });
  it('adds a local server by command at the thread\'s space', async () => {
    const { tool, saved } = setup();
    await call(tool, { name: 'Figma', command: 'npx', args: ['-y', 'figma-mcp'], level: 'space' });
    expect(saved[0]).toMatchObject({ transport: 'stdio', command: 'npx', args: ['-y', 'figma-mcp'], auth: 'none', scope: { spaceIds: ['agents'] } });
  });
  it('asks before adding everywhere and saves nothing when declined', async () => {
    const declined = setup({ confirm: vi.fn(async () => 'declined' as const) });
    expect(await call(declined.tool, { ...mobbin, level: 'everywhere' })).toContain('declined');
    expect(declined.saved).toEqual([]);
    const allowed = setup();
    await call(allowed.tool, { ...mobbin, level: 'everywhere' });
    expect(allowed.deps.confirm).toHaveBeenCalledWith('t1', expect.objectContaining({ title: 'Add Mobbin for every thread?' }), expect.anything());
    expect(allowed.saved[0]?.scope?.global).toBe(true);
  });
  it('adds a level to a server with the same URL instead of a second one', async () => {
    const existing: McpView = { id: 'design', name: 'Design', transport: 'http', url: mobbin.url, args: [], auth: 'oauth', scope: { ...none, profileIds: ['work'] }, signedIn: true };
    const { tool, saved, deps } = setup({ save: vi.fn(async (mcp) => { saved.push(mcp); return { ...existing, ...mcp, signedIn: true } as McpView; }) }, [existing]);
    const text = await call(tool, { ...mobbin, auth: 'oauth', level: 'profile' });
    expect(saved[0]).toMatchObject({ id: 'design', scope: { profileIds: ['work', 'personal'] } });
    expect(deps.beginSignIn).not.toHaveBeenCalled();
    expect(text).toContain('already signed in');
  });
  it('never takes the accio server\'s name', async () => {
    const { tool, saved } = setup();
    await call(tool, { name: 'Accio', url: 'https://example.test/mcp' });
    expect(saved[0]?.id).toBe('accio-2');
  });
  it('returns a sign-in link for OAuth', async () => {
    const { tool, deps } = setup();
    const text = await call(tool, { ...mobbin, auth: 'oauth' });
    expect(deps.beginSignIn).toHaveBeenCalledWith('mobbin');
    expect(text).toContain('https://auth.example.test/authorize?client=mobbin');
  });
  it('reads a bearer token from the secret file and keeps it out of the result', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'add-mcp-'));
    const file = join(dir, 'token');
    await writeFile(file, '  private-token\n');
    const { tool, tokens } = setup();
    const text = await call(tool, { ...mobbin, auth: 'bearer', token_file: file });
    expect(tokens).toEqual([['mobbin', 'private-token']]);
    expect(text).not.toContain('private-token');
    expect(text).toContain('token is saved');
  });
  it('asks for a secret when a bearer server has no token, and saves nothing for an unreadable file', async () => {
    const { tool, saved } = setup();
    expect(await call(tool, { ...mobbin, auth: 'bearer' })).toContain('request_secret');
    const bad = setup();
    await expect(call(bad.tool, { ...mobbin, auth: 'bearer', token_file: join(tmpdir(), 'missing-add-mcp-token') })).rejects.toThrow('token_file');
    expect(bad.saved).toEqual([]);
    expect(saved).toHaveLength(1);
  });
  it('needs exactly one of url or command', async () => {
    const { tool } = setup();
    await expect(call(tool, { name: 'X' })).rejects.toThrow('either url');
    await expect(call(tool, { name: 'X', url: 'https://x.test', command: 'npx' })).rejects.toThrow('either url');
  });
});
