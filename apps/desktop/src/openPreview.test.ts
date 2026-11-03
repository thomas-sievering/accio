import { expect, it } from 'vitest';
import { previewUrl } from './openPreview.js';
it('opens a local preview only from the owning desktop origin', () => {
  expect(previewUrl('http://127.0.0.1:4000/', 'http://127.0.0.1:4000', 'http://127.0.0.1:5100/')).toBe('http://127.0.0.1:5100/');
  expect(() => previewUrl('https://unrelated.test', 'http://127.0.0.1:4000', 'http://127.0.0.1:5100/')).toThrow(/Only this desktop/);
});
it.each(['file:///C:/secret', 'https://example.com', 'javascript:alert(1)', 'http://user:pass@127.0.0.1:5100/'])('refuses a non-preview destination: %s', url => {
  expect(() => previewUrl('http://127.0.0.1:4000/', 'http://127.0.0.1:4000', url)).toThrow();
});
