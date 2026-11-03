import { describe, expect, it, vi } from 'vitest';
import type { RpcClient } from '../app/rpcClient';
import { assetUrl } from './assetUrl';

function client(call = vi.fn(async () => ({ url: '/asset/grant', expiresAt: Date.now() + 60_000 }))) {
  return { call, httpUrl: (path: string) => new URL(path, 'https://owning-machine.test').href } as unknown as RpcClient;
}

describe('scoped media URL cache', () => {
  it('coalesces concurrent and later resolutions so transcript rerenders reuse a media source', async () => {
    const machine = client();
    const first = assetUrl(machine, 'thread', 'asset');
    const concurrent = assetUrl(machine, 'thread', 'asset');
    expect(first).toBe(concurrent);
    expect(await first).toMatchObject({ url: 'https://owning-machine.test/asset/grant' });
    await assetUrl(machine, 'thread', 'asset');
    expect(machine.call).toHaveBeenCalledTimes(1);
  });

  it('separates owning clients, threads, assets and attachment grants', async () => {
    const machine = client();
    await assetUrl(machine, 'thread', 'asset');
    await assetUrl(machine, 'other-thread', 'asset');
    await assetUrl(machine, 'thread', 'other-asset');
    await assetUrl(machine, 'thread', 'asset', true);
    expect(machine.call).toHaveBeenCalledTimes(4);
    expect(machine.call).toHaveBeenLastCalledWith('threads.assetUrl', { threadId: 'thread', assetId: 'asset', download: true });
    const other = client();
    await assetUrl(other, 'thread', 'asset');
    expect(other.call).toHaveBeenCalledTimes(1);
  });

  it('renews expired URLs and supports an explicit retry without caching failed requests', async () => {
    const call = vi.fn(async () => ({ url: '/asset/grant', expiresAt: Date.now() - 1 }));
    const machine = client(call);
    await assetUrl(machine, 'thread', 'asset');
    await assetUrl(machine, 'thread', 'asset');
    expect(call).toHaveBeenCalledTimes(2);
    call.mockResolvedValue({ url: '/asset/fresh', expiresAt: Date.now() + 60_000 });
    await assetUrl(machine, 'thread', 'asset');
    await assetUrl(machine, 'thread', 'asset', false, true);
    expect(call).toHaveBeenCalledTimes(4);
    call.mockRejectedValueOnce(new Error('Connection lost'));
    await expect(assetUrl(machine, 'thread', 'asset', false, true)).rejects.toThrow('Connection lost');
    expect(await assetUrl(machine, 'thread', 'asset', false, true)).toMatchObject({ url: 'https://owning-machine.test/asset/fresh' });
  });
});
