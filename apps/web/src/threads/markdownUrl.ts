import { isLocalFileSource, isRemoteMedia } from '@accio/protocol';

/** Preserve file destinations for custom resolvers without exposing raw host paths as browser navigation. */
export function markdownUrl(source: string, key: string): string | undefined {
  if (isLocalFileSource(source) || isRemoteMedia(source)) return source;
  if (key === 'src' && /^data:(?:image|audio|video)\/[\w.+-]+[;,]/i.test(source)) return source;
  if (key === 'href' && (/^(?:mailto|tel):/i.test(source) || source.startsWith('#'))) return source;
  return undefined;
}
