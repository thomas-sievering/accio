import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { imageTool } from './imageTool.js';

const cleanup: string[] = [];
afterEach(async () => { for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true }); });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

async function setup(reply: (url: string, body: any) => Response = () => Response.json({ data: [{ b64_json: PNG.toString('base64'), revised_prompt: 'A fox' }], size: '1024x1536' })) {
  const dir = await mkdtemp(join(tmpdir(), 'image-tool-'));
  cleanup.push(dir);
  const sent: { url: string; headers: Headers; body: any }[] = [];
  const tool = imageTool({
    thread: (id) => id === 'gone' ? undefined : { profileId: id === 'no-chatgpt' ? 'work' : 'personal', cwd: dir },
    canMakeImages: (profileId) => profileId === 'personal',
    access: async () => ({ baseUrl: 'https://hat.test/', accessKey: 'hat-key' }),
    folder: join(dir, 'images'),
    now: () => new Date('2026-11-15T10:00:00.000Z'),
    fetchImpl: (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      sent.push({ url, headers: new Headers(init.headers), body });
      return reply(url, body);
    }) as typeof fetch,
  });
  const progress: string[] = [];
  const call = (args: Record<string, unknown>, threadId = 't1') => Promise.resolve(tool.call(args as never, { threadId, signal: new AbortController().signal, progress: (m) => progress.push(m) }));
  return { dir, tool, sent, call, progress };
}

describe('generate_image', () => {
  it('is offered only to threads whose profile has a signed-in ChatGPT account', async () => {
    const { tool } = await setup();
    expect(tool.available?.('t1')).toBe(true);
    expect(tool.available?.('no-chatgpt')).toBe(false);
    expect(tool.available?.('gone')).toBe(false);
  });

  it('asks the Sorting Hat with the profile’s hat key and saves the image for the thread', async () => {
    const { call, sent, dir, progress } = await setup();
    const result = await call({ prompt: 'A fox', size: '1024x1536', quality: 'low' });
    const path = join(dir, 'images', 'a-fox-2026-11-15T10-00-00-000Z.png');
    expect(result).toBe(`Saved the image (1024x1536) to ${path}`);
    expect(await readFile(path)).toEqual(PNG);
    expect(sent).toEqual([{ url: 'https://hat.test/openai/v1/images/generations', headers: expect.any(Headers), body: { prompt: 'A fox', size: '1024x1536', quality: 'low', output_format: 'png' } }]);
    expect(sent[0]!.headers.get('authorization')).toBe('Bearer hat-key');
    expect(progress).toEqual(['Generating the image']);
  });

  it('edits with reference images read from the working folder, and shows a rewritten prompt', async () => {
    const { call, sent, dir } = await setup(() => Response.json({ data: [{ b64_json: PNG.toString('base64'), revised_prompt: 'A green apple on white' }] }));
    await writeFile(join(dir, 'apple.png'), PNG);
    const result = await call({ prompt: 'Make it green', images: ['apple.png'] });
    expect(sent[0]!.url).toBe('https://hat.test/openai/v1/images/edits');
    expect(sent[0]!.body.images).toEqual([{ image_url: `data:image/png;base64,${PNG.toString('base64')}` }]);
    expect(result).toContain('The model drew it from this prompt: A green apple on white');
  });

  it('says why when there is no image', async () => {
    const refused = await setup(() => Response.json({ error: { message: 'ChatGPT made no image: I can’t make that image.' } }, { status: 502 }));
    await expect(refused.call({ prompt: 'refuse' })).rejects.toThrow('ChatGPT made no image: I can’t make that image.');
    const old = await setup(() => Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'Unknown Codex endpoint' } }, { status: 404 }));
    await expect(old.call({ prompt: 'A fox' })).rejects.toThrow('can\'t make images yet; update it');
    const { call, sent } = await setup();
    await expect(call({ prompt: 'x', images: ['missing.png'] })).rejects.toThrow('Can\'t read the image');
    await expect(call({ prompt: 'x', images: ['notes.txt'] })).rejects.toThrow('is not a PNG, JPEG, WebP or GIF image');
    expect(sent).toHaveLength(0);
  });
});
