import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MidPath } from './MidPath';

describe('MidPath', () => {
  it('keeps the last characters in their own span and the full text as the title', () => {
    const html = renderToStaticMarkup(<MidPath text="C:/Users/someone/projects/accio" tail={5} />);
    expect(html).toBe(
      '<span class="path-mid" title="C:/Users/someone/projects/accio">'
        + '<span class="path-head">C:/Users/someone/projects/</span>'
        + '<span class="path-tail">accio</span></span>',
    );
  });
});
