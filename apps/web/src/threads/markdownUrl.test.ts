import { describe, expect, it } from 'vitest';
import { markdownUrl } from './markdownUrl';

describe('Markdown destinations', () => {
  it('preserves host destinations for scoped custom renderers, including Windows paths', () => {
    for (const path of ['images/demo.png', '/tmp/demo.mp4', 'C:/work/demo.mp3', 'C:\\work\\demo.png', 'file:///C:/work/demo.png']) {
      expect(markdownUrl(path, 'src')).toBe(path);
      expect(markdownUrl(path, 'href')).toBe(path);
    }
  });

  it('allows remote media and ordinary safe links', () => {
    for (const source of ['https://example.com/demo.webm', 'http://example.com/picture', '//example.com/audio.mp3']) {
      expect(markdownUrl(source, 'src')).toBe(source);
      expect(markdownUrl(source, 'href')).toBe(source);
    }
    expect(markdownUrl('#section', 'href')).toBe('#section');
    expect(markdownUrl('mailto:someone@example.com', 'href')).toBe('mailto:someone@example.com');
  });

  it('blocks executable schemes and limits data sources to media resolution', () => {
    for (const source of ['javascript:alert(1)', 'vbscript:msgbox(1)', 'blob:https://example.com/id', 'data:text/html,<script>alert(1)</script>']) {
      expect(markdownUrl(source, 'src')).toBeUndefined();
      expect(markdownUrl(source, 'href')).toBeUndefined();
    }
    expect(markdownUrl('data:image/png;base64,abc', 'src')).toBe('data:image/png;base64,abc');
    expect(markdownUrl('data:image/png;base64,abc', 'href')).toBeUndefined();
  });
});
