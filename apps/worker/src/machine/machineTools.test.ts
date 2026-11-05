import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { machineTools } from './machineTools.js';

it('finds the machine the user mentioned by its @ handle', async () => {
  const call = vi.fn(async () => ({ png: '' }));
  const [screenshot] = machineTools({
    here: 'here', machines: () => [{ id: 'm1', name: "Thomas's Laptop" }], call: call as never,
    folder: await mkdtemp(join(tmpdir(), 'accio-shots-')),
  });
  const context = { threadId: 't', signal: new AbortController().signal };
  expect(await screenshot!.call({ machine: '@thomas-s-laptop' }, context)).toContain("Accio on Thomas's Laptop");
  expect(call).toHaveBeenCalledWith('app.screenshot', { machineId: 'm1' });
  await expect(screenshot!.call({ machine: '@desk' }, context)).rejects.toThrow("No machine named @desk. Machines: Thomas's Laptop.");
});

it('says when the screenshot left out part of the window, and why', async () => {
  const call = vi.fn(async () => ({ png: '', note: 'Captured the page only: no permission.' }));
  const [screenshot] = machineTools({
    here: 'here', machines: () => [], call: call as never,
    folder: await mkdtemp(join(tmpdir(), 'accio-shots-')),
  });
  const context = { threadId: 't', signal: new AbortController().signal };
  expect(await screenshot!.call({}, context)).toContain('Captured the page only: no permission.');
});
