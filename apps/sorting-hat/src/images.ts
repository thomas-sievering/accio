import type { CodexModel } from './openaiAuth.js';

/**
 * Image generation through a ChatGPT account. ChatGPT's Codex backend has no
 * Images API, only Responses, where images come from its `image_generation`
 * tool. The Sorting Hat answers OpenAI's Images API by asking a small text model
 * of the account in use to call that tool once with the caller's prompt
 * unchanged; the image model draws the same whichever text model calls it.
 */

export type ImageRoute = 'generations' | 'edits';

/** `/openai/images/{generations,edits}`, and the same under `/openai/v1/` for clients whose base address ends in `/v1`. */
export function imageRoute(path: string): ImageRoute | undefined {
  return /^\/openai(?:\/v1)?\/images\/(generations|edits)$/.exec(path)?.[1] as ImageRoute | undefined;
}

export type ImageRequest = {
  prompt: string;
  /** Reference images as `data:` or https URLs; an edit has at least one. */
  images: string[];
  size?: string;
  quality?: string;
  background?: string;
  outputFormat: 'png' | 'jpeg' | 'webp';
  outputCompression?: number;
};

/** A request the Images API would refuse, with the parameter at fault. */
export class ImageRequestError extends Error {
  constructor(message: string, readonly param: string | null = null) { super(message); }
}

const QUALITIES = ['auto', 'low', 'medium', 'high'];
const BACKGROUNDS = ['auto', 'transparent', 'opaque'];
const FORMATS = ['png', 'jpeg', 'webp'] as const;
const MAX_PROMPT = 32_000;
const MAX_IMAGES = 16;

/** Reads an Images API request body (JSON, as OpenAI's API accepts it for GPT image models). */
export function readImageRequest(body: Buffer, route: ImageRoute): ImageRequest {
  let value: unknown;
  try { value = JSON.parse(body.toString('utf8')); } catch { throw new ImageRequestError('Send the request as JSON. The Sorting Hat does not read multipart form data; send reference images as `images: [{ "image_url": "data:image/png;base64,…" }]`.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ImageRequestError('The request body must be a JSON object.');
  const v = value as Record<string, unknown>;
  if (typeof v.prompt !== 'string' || !v.prompt.trim()) throw new ImageRequestError('`prompt` is required.', 'prompt');
  if (v.prompt.length > MAX_PROMPT) throw new ImageRequestError(`\`prompt\` is longer than ${MAX_PROMPT} characters.`, 'prompt');
  if (v.n !== undefined && v.n !== null && v.n !== 1) throw new ImageRequestError('The Sorting Hat makes one image per request: leave out `n` or send 1.', 'n');
  if (v.response_format !== undefined && v.response_format !== null && v.response_format !== 'b64_json') throw new ImageRequestError('Only `b64_json` is supported for `response_format`.', 'response_format');
  if (v.mask !== undefined && v.mask !== null) throw new ImageRequestError('`mask` is not supported; describe the change in the prompt instead.', 'mask');
  const choice = (name: string, allowed: readonly string[]) => {
    const given = v[name];
    if (given === undefined || given === null) return undefined;
    if (typeof given !== 'string' || !allowed.includes(given)) throw new ImageRequestError(`\`${name}\` must be one of ${allowed.join(', ')}.`, name);
    return given;
  };
  const size = v.size;
  if (size !== undefined && size !== null && (typeof size !== 'string' || !/^(auto|\d{2,5}x\d{2,5})$/.test(size))) throw new ImageRequestError('`size` must be auto or WIDTHxHEIGHT, such as 1024x1024.', 'size');
  const compression = v.output_compression;
  if (compression !== undefined && compression !== null && (typeof compression !== 'number' || !Number.isInteger(compression) || compression < 0 || compression > 100)) throw new ImageRequestError('`output_compression` must be a whole number from 0 to 100.', 'output_compression');
  const images = referenceImages(v);
  if (route === 'edits' && !images.length) throw new ImageRequestError('An edit needs at least one image in `images`.', 'images');
  return {
    prompt: v.prompt,
    images,
    ...(typeof size === 'string' ? { size } : {}),
    ...(choice('quality', QUALITIES) ? { quality: v.quality as string } : {}),
    ...(choice('background', BACKGROUNDS) ? { background: v.background as string } : {}),
    outputFormat: (choice('output_format', FORMATS) ?? 'png') as ImageRequest['outputFormat'],
    ...(typeof compression === 'number' ? { outputCompression: compression } : {}),
  };
}

/** `images: [{ image_url }]`, or `image` as one such object or URL or a list of them. */
function referenceImages(v: Record<string, unknown>): string[] {
  const given = v.images ?? v.image;
  if (given === undefined || given === null) return [];
  const list = Array.isArray(given) ? given : [given];
  if (list.length > MAX_IMAGES) throw new ImageRequestError(`Send at most ${MAX_IMAGES} images.`, 'images');
  return list.map((item) => {
    const url = typeof item === 'string' ? item : item && typeof item === 'object' ? (item as { image_url?: unknown }).image_url : undefined;
    if (typeof url !== 'string' || !/^(data:image\/[a-z0-9.+-]+;base64,|https:\/\/)/i.test(url)) {
      throw new ImageRequestError('Each image must be `{ "image_url": … }` with a `data:image/…;base64,` or https URL. File ids are not supported.', 'images');
    }
    return url;
  });
}

/** The account's text model that calls the image tool: a small one when it has one, since it only passes the prompt on. */
export function drivingModel(models: CodexModel[]): { id: string; effort?: string } | undefined {
  const model = models.find((m) => /\b(luna|nano|mini)\b/i.test(`${m.id} ${m.name}`)) ?? models.find((m) => m.isDefault) ?? models[0];
  if (!model) return undefined;
  const effort = ['none', 'minimal', 'low'].find((e) => model.efforts?.some((item) => item.id === e));
  return { id: model.id, ...(effort ? { effort } : {}) };
}

const INSTRUCTIONS = 'Call the image_generation tool exactly once. Pass the user\'s text through unchanged as the image prompt, and use any images they attached as references to edit or follow. Do not reply with text.';

/** The Responses request that makes one image. */
export function responsesBody(request: ImageRequest, model: { id: string; effort?: string }) {
  return {
    model: model.id,
    instructions: INSTRUCTIONS,
    input: [{ type: 'message', role: 'user', content: [
      ...request.images.map((url) => ({ type: 'input_image', image_url: url })),
      { type: 'input_text', text: request.prompt },
    ] }],
    tools: [{
      type: 'image_generation',
      output_format: request.outputFormat,
      ...(request.size ? { size: request.size } : {}),
      ...(request.quality ? { quality: request.quality } : {}),
      ...(request.background ? { background: request.background } : {}),
      ...(request.outputCompression !== undefined ? { output_compression: request.outputCompression } : {}),
      ...(request.images.length ? { action: 'edit' } : {}),
    }],
    tool_choice: { type: 'image_generation' },
    parallel_tool_calls: false,
    ...(model.effort ? { reasoning: { effort: model.effort } } : {}),
    store: false,
    stream: true,
    include: [],
  };
}

type ImageItem = { result?: string; status?: string; revised_prompt?: string; size?: string; quality?: string; background?: string; output_format?: string };

/** What a Responses stream for one image ended with: the Images API answer, or why it has none. */
export function imageReply(stream: string, now = Date.now()): { ok: true; body: unknown } | { ok: false; message: string } {
  let image: ImageItem | undefined;
  let usage: unknown;
  let failure: string | undefined;
  const text: string[] = [];
  for (const block of stream.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(line[5] === ' ' ? 6 : 5)).join('\n');
    if (!data) continue;
    let event: Record<string, any>;
    try { event = JSON.parse(data); } catch { continue; }
    const item = event.item;
    if (event.type === 'response.output_item.done' && item?.type === 'image_generation_call' && typeof item.result === 'string' && item.result) image = item;
    if (event.type === 'response.output_item.done' && item?.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) if (typeof part?.text === 'string' && part.text.trim()) text.push(part.text.trim());
    }
    if (event.type === 'response.completed' || event.type === 'response.incomplete') usage = event.response?.tool_usage?.image_gen;
    if (event.type === 'response.failed') failure = event.response?.error?.message ?? 'ChatGPT could not make the image.';
    if (event.type === 'error') failure = event.message ?? event.error?.message ?? 'ChatGPT could not make the image.';
  }
  if (!image) return { ok: false, message: failure ?? (text.length ? `ChatGPT made no image: ${text.join(' ')}` : 'ChatGPT made no image.') };
  return { ok: true, body: {
    created: Math.floor(now / 1000),
    data: [{ b64_json: image.result, ...(image.revised_prompt ? { revised_prompt: image.revised_prompt } : {}) }],
    ...(image.size ? { size: image.size } : {}),
    ...(image.quality ? { quality: image.quality } : {}),
    ...(image.background ? { background: image.background } : {}),
    ...(image.output_format ? { output_format: image.output_format } : {}),
    ...(usage && typeof usage === 'object' ? { usage } : {}),
  } };
}
