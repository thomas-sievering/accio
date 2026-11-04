import { Chevron } from '../app/icons';
import type { DeliveryCI } from '@accio/protocol';

export function ciSummary(ci?: DeliveryCI): string | undefined {
  if (!ci?.checks.length) return undefined;
  const active = ci.checks.find(c => c.status === 'in_progress')
    ?? ci.checks.find(c => !['success', 'neutral', 'skipped'].includes(c.status));
  if (!active) return 'CI · Checks finishing';
  if (active.step) return `CI · ${active.step.name} · ${active.step.current} of ${active.step.total}`;
  return `CI · ${active.name} · ${active.status.replaceAll('_', ' ')}`;
}

export function DeliveryProgress({ ci }: { ci: DeliveryCI }) {
  return <details className="delivery-progress">
    <summary><Chevron />CI details · {ci.checks.filter(c => ['success', 'neutral', 'skipped'].includes(c.status)).length} of {ci.checks.length} checks complete</summary>
    <ul>{ci.checks.map((check, index) => <li key={index}>
      {check.url && /^https:\/\/github\.com\//.test(check.url)
        ? <a href={check.url} target="_blank" rel="noreferrer">{check.name} ↗</a> : <span>{check.name}</span>}
      <span>{check.status.replaceAll('_', ' ')}{check.step && ` · ${check.step.name} · step ${check.step.current} of ${check.step.total}`}</span>
    </li>)}</ul>
    <small>Revision {ci.revision.slice(0, 7)} · Last checked <time dateTime={ci.updatedAt}>{new Date(ci.updatedAt).toLocaleTimeString()}</time> · Refreshes every 30s</small>
  </details>;
}
