import { Alert, ArrowUp, Merge, PullRequest, Ship } from '../app/icons';
import type { StatusGlyph, StatusTone } from './status';

/** The static or spinning mark for a resolved status; colour comes from `tone-*`. */
export function StatusGlyphIcon({ glyph, tone }: { glyph: StatusGlyph; tone: StatusTone }) {
  switch (glyph) {
    case 'spinner': return <span className="row-working" />;
    case 'dot': return <span className={`row-flag tone-${tone}${tone === 'secret' ? ' needs-secret' : ''}`} />;
    case 'pr': return <PullRequest />;
    case 'merge': return <Merge />;
    case 'ship': return <Ship />;
    case 'push': return <ArrowUp />;
    case 'alert': return <Alert />;
  }
}
