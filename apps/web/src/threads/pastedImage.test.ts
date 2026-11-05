import { describe, expect, it } from 'vitest';
import { fittedSize, pastedImages } from './pastedImage';

describe('pasted images', () => {
  it('shrinks only images whose longer side is past the limit', () => {
    expect(fittedSize(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(fittedSize(4000, 1000)).toEqual({ width: 2000, height: 500 });
    expect(fittedSize(1000, 3000)).toEqual({ width: 667, height: 2000 });
  });

  it('takes image files from a paste and leaves text to the textarea', () => {
    const image = { name: 'shot.png' } as File;
    const items = [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => image },
      { kind: 'file', type: 'application/pdf', getAsFile: () => ({}) as File },
    ];
    expect(pastedImages({ items } as unknown as DataTransfer)).toEqual([image]);
    expect(pastedImages(null)).toEqual([]);
  });
});
