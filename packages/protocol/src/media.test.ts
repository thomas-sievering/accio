import { describe, expect, it } from 'vitest';
import { isLocalFileSource, mediaMimeType, normalizeMarkdownSource } from './media.js';

describe('shared Markdown/media destinations', () => {
  it('matches renderer encoding for spaces, Unicode and Windows separators', () => {
    expect(normalizeMarkdownSource('my image.png')).toBe('my%20image.png');
    expect(normalizeMarkdownSource('my%2520image.png')).toBe('my%2520image.png');
    const windows = normalizeMarkdownSource('C:\\work\\my image.png');
    expect(windows).toBe('C:%5Cwork%5Cmy%20image.png');
    expect(isLocalFileSource(windows)).toBe(true);
    expect(mediaMimeType(windows)).toBe('image/png');
    expect(isLocalFileSource('javascript:alert(1)')).toBe(false);
  });
});
