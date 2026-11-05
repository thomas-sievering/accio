import { normalizeUri } from 'micromark-util-sanitize-uri';

/** Match the destination encoding used by react-markdown's mdast-to-hast renderer. */
export const normalizeMarkdownSource = normalizeUri;

/** Immutable bytes owned by one thread on the machine that ran it. */
export type ThreadAsset = { id: string; name: string; mimeType: string; sizeBytes: number };

/** GLOSSARY: Image attachment. The image types a pasted image may have; every harness reads these four. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
/** Claude refuses an image over 5 MB once base64-encoded; clients shrink pasted images below this. */
export const IMAGE_ATTACHMENT_BYTES = 3_500_000;
export const IMAGE_ATTACHMENT_MAX_EDGE = 2000;
export const IMAGES_PER_MESSAGE = 10;

/**
 * Whether a model reads an image of this type. A model that has not reported
 * the image types it reads (`imageTypes` absent) is assumed to read them all.
 */
export function readsImage(model: { imageTypes?: readonly string[] } | undefined, mimeType: string): boolean {
  return !model?.imageTypes || model.imageTypes.includes(mimeType);
}

/** "GPT-5 Codex can't read images" or "… can't read GIF images", for the composer and the worker alike. */
export function imageRefusal(modelName: string, imageTypes: readonly string[], mimeType: string): string {
  return imageTypes.length ? `${modelName} can't read ${mimeType.split('/')[1]!.toUpperCase()} images.` : `${modelName} can't read images.`;
}

export type ResultPart =
  | { type: 'text'; text: string }
  | { type: 'media'; asset: ThreadAsset }
  | { type: 'unsupported'; label: string };

export type ToolDetails = { input: unknown; parts: ResultPart[]; truncated?: boolean };
/** Source uses the same normalized destination encoding as the Markdown renderer. */
export type MediaBinding = { source: string; asset?: ThreadAsset; error?: string };
export type AssetUrl = { url: string; expiresAt: number };

const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg',
};

export function mediaMimeType(source: string): string | undefined {
  const data = /^data:((?:image|video|audio)\/[\w.+-]+)[;,]/i.exec(source)?.[1];
  if (data) return data.toLowerCase();
  let path = source.split(/[?#]/, 1)[0] ?? '';
  try { path = decodeURIComponent(path); } catch { /* Keep malformed destinations readable. */ }
  return TYPES[path.split('.').at(-1)?.toLowerCase() ?? ''];
}

export function mediaKind(mimeType: string): 'image' | 'video' | 'audio' | undefined {
  const kind = mimeType.split('/')[0];
  return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : undefined;
}

export function isRemoteMedia(source: string): boolean {
  return /^(?:https?:)?\/\//i.test(source);
}

/** Only host file references enter the server resolver; arbitrary URI schemes stay blocked. */
export function isLocalFileSource(source: string): boolean {
  return !!source && !source.startsWith('#') && !source.startsWith('?') &&
    (!/^[a-z][a-z\d+.-]*:/i.test(source) || /^[a-z]:(?:[\\/]|%5c|%2f)/i.test(source) || /^file:/i.test(source)) &&
    !source.startsWith('//') && !source.startsWith('\\\\');
}
