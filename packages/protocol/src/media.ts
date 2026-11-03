import { normalizeUri } from 'micromark-util-sanitize-uri';

/** Match the destination encoding used by react-markdown's mdast-to-hast renderer. */
export const normalizeMarkdownSource = normalizeUri;

/** Immutable bytes owned by one thread on the machine that ran it. */
export type ThreadAsset = { id: string; name: string; mimeType: string; sizeBytes: number };

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
