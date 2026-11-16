import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { HubAccess } from '../profiles/claudeConfigFolder.js';
import { accioTool } from '../tools/tools.js';

const GENERATE_IMAGE_TOOL = 'generate_image';

const REFERENCE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
/** Each reference image's limit; the Sorting Hat takes 32 MB in all, and base64 adds a third. */
const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;
const MAX_REFERENCES = 3;

export type ImageToolDeps = {
  /** The thread's profile and working folder; undefined once it is gone. */
  thread: (threadId: string) => { profileId: string; cwd: string } | undefined;
  /** Whether the profile's house has a signed-in ChatGPT account to make images with. */
  canMakeImages: (profileId: string) => boolean;
  /** The profile's Sorting Hat address and hat key. */
  access: (profileId: string) => Promise<HubAccess>;
  /** Where images are saved on this machine. */
  folder: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

/**
 * GLOSSARY: Image generation. An accio tool that makes an image with the
 * profile's ChatGPT account, through the Sorting Hat's Images API, so every
 * harness can, and saves it on this machine for the thread to embed.
 */
export function imageTool(deps: ImageToolDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return accioTool({
    name: GENERATE_IMAGE_TOOL,
    description: 'Generate an image, or edit images, with the profile\'s ChatGPT account. Write the full prompt yourself: subject, style, composition, colours and any text to render; it is used as written. '
      + 'Pass reference images by path to edit them or to follow their look. Takes up to a minute or two and uses the ChatGPT account\'s limits. '
      + 'Returns the path of the saved image on this machine, to embed or copy where it is needed.',
    input: {
      prompt: z.string().trim().min(1).max(32_000).describe('What to draw, in full; for an edit, what to change.'),
      images: z.array(z.string().min(1).max(4096)).max(MAX_REFERENCES).optional().describe('Paths of reference images (PNG, JPEG, WebP or GIF) to edit or follow, absolute or relative to the working folder.'),
      size: z.enum(['auto', '1024x1024', '1536x1024', '1024x1536']).optional().describe('Square, landscape or portrait; auto (the default) lets the model choose. A hint: the model may make another size.'),
      quality: z.enum(['auto', 'low', 'medium', 'high']).optional().describe('Low is quicker for drafts; auto by default. A hint the model may override.'),
      background: z.enum(['auto', 'transparent', 'opaque']).optional().describe('Transparent for icons and cut-outs; auto by default.'),
    },
    available: (threadId) => { const thread = deps.thread(threadId); return !!thread && deps.canMakeImages(thread.profileId); },
    call: async ({ prompt, images = [], size, quality, background }, { threadId, signal, progress }) => {
      const thread = deps.thread(threadId);
      if (!thread) throw new Error('This thread is gone.');
      const references = await Promise.all(images.map((path) => dataUrl(resolve(thread.cwd, path))));
      const access = await deps.access(thread.profileId);
      progress(images.length ? 'Editing the image' : 'Generating the image');
      const route = references.length ? 'edits' : 'generations';
      const response = await fetchImpl(`${access.baseUrl.replace(/\/+$/, '')}/openai/v1/images/${route}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${access.accessKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, ...(references.length ? { images: references.map((url) => ({ image_url: url })) } : {}),
          ...(size ? { size } : {}), ...(quality ? { quality } : {}), ...(background ? { background } : {}), output_format: 'png' }),
        signal,
      });
      const text = await response.text();
      let body: { data?: { b64_json?: string; revised_prompt?: string }[]; size?: string; error?: { message?: string } } = {};
      try { body = JSON.parse(text); } catch {}
      const image = body.data?.[0]?.b64_json;
      if (!response.ok || !image) {
        const reason = body.error?.message ?? (text.trim().slice(0, 500) || `The Sorting Hat answered ${response.status}`);
        if (response.status === 404) throw new Error(`This profile's Sorting Hat can't make images yet; update it. (${reason})`);
        throw new Error(reason);
      }
      await mkdir(deps.folder, { recursive: true });
      const path = join(deps.folder, `${slug(prompt)}-${(deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-')}.png`);
      await writeFile(path, Buffer.from(image, 'base64'));
      const revised = body.data?.[0]?.revised_prompt;
      return `Saved the image${body.size ? ` (${body.size})` : ''} to ${path}`
        + (revised && revised.trim() !== prompt ? `\n\nThe model drew it from this prompt: ${revised}` : '');
    },
  });
}

/** A reference image as a data URL, read from this machine. */
async function dataUrl(path: string): Promise<string> {
  const type = REFERENCE_TYPES[extname(path).toLowerCase()];
  if (!type) throw new Error(`${path} is not a PNG, JPEG, WebP or GIF image.`);
  let bytes: Buffer;
  try { bytes = await readFile(path); } catch { throw new Error(`Can't read the image ${path}.`); }
  if (bytes.byteLength > MAX_REFERENCE_BYTES) throw new Error(`${path} is larger than ${MAX_REFERENCE_BYTES / 1024 / 1024} MB; send a smaller image.`);
  return `data:${type};base64,${bytes.toString('base64')}`;
}

/** The first words of the prompt, for a file name a person can recognise. */
function slug(prompt: string) {
  return prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 40).replace(/-+$/, '') || 'image';
}
