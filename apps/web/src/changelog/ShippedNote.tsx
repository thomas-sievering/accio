import type { ChangelogEntry } from '@accio/protocol';
import { Merge, Ship } from '../app/icons';
import { landedText } from './changelog';

/**
 * GLOSSARY: Shipped note. Where a delivered change landed, what changed and what to try.
 * The thread shows it as its own turn; the Changelog lists it with the thread it came from.
 */
export function ShippedNote({ entry, link = true, inThread = false }: { entry: ChangelogEntry; link?: boolean; inThread?: boolean }) {
  const landed = landedText(entry);
  const tryList = entry.note?.test ?? [];
  return (
    <div className={`shipped${inThread ? ' in-thread' : ''}`}>
      <div className="shipped-head">
        {entry.pullRequest ? <Merge /> : <Ship />}
        {link && entry.pullRequest
          ? <a href={entry.pullRequest.url} target="_blank" rel="noreferrer" title={`Open PR #${entry.pullRequest.number}`}>{landed}</a>
          : <span>{landed}</span>}
        {entry.revision && <span className="shipped-rev" title="Revision on the target">{entry.revision.slice(0, 7)}</span>}
      </div>
      <p className="shipped-summary">{entry.note?.summary ?? entry.title}</p>
      {tryList.length > 0 && (
        <ul className="shipped-try" aria-label="Things to try">
          {tryList.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      )}
    </div>
  );
}
