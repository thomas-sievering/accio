import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from './Button';

describe('Button', () => {
  it('is a plain button while idle', () => {
    expect(renderToStaticMarkup(<Button className="ghost" busyLabel="Saving…">Save</Button>))
      .toBe('<button type="button" class="ghost">Save</button>');
  });

  it('shows the wait while busy: spinner, busy label, aria-busy and no clicks', () => {
    expect(renderToStaticMarkup(<Button type="submit" busy busyLabel="Saving…">Save</Button>))
      .toBe('<button type="submit" disabled="" aria-busy="true"><span class="button-spinner" aria-hidden="true"></span>Saving…</button>');
  });

  it('keeps its own label beside the spinner without a busy label', () => {
    expect(renderToStaticMarkup(<Button busy>Delete Work</Button>)).toContain('</span>Delete Work</button>');
  });
});
