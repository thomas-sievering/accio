import type { DeliveryCI } from '@accio/protocol';

const finished = (status: string) => ['success', 'neutral', 'skipped'].includes(status);

export function ciSummary(ci?: DeliveryCI): string | undefined {
  if (!ci?.checks.length) return undefined;
  const active = ci.checks.find(c => c.status === 'in_progress')
    ?? ci.checks.find(c => !finished(c.status));
  if (!active) return 'CI · Checks finishing';
  if (active.step) return `CI · ${active.step.name} · ${active.step.current} of ${active.step.total}`;
  return `CI · ${active.name} · ${active.status.replaceAll('_', ' ')}`;
}

/** Live CI jobs and their current step, nested under the station waiting on them. */
export function DeliveryProgress({ ci }: { ci: DeliveryCI }) {
  return <div className="delivery-progress">
    <ul>{ci.checks.map((check, index) => {
      const tone = finished(check.status) ? 'done' : check.status === 'in_progress' || check.status === 'queued' ? 'active' : 'failed';
      return <li key={index} className={`ci-${tone}`}>
        <i aria-hidden="true" />
        {check.url && /^https:\/\/github\.com\//.test(check.url)
          ? <a href={check.url} target="_blank" rel="noreferrer">{check.name} ↗</a> : <span>{check.name}</span>}
        <span>{check.step ? `${check.step.name} · step ${check.step.current} of ${check.step.total}` : check.status.replaceAll('_', ' ')}</span>
      </li>;
    })}</ul>
    <small>{ci.checks.filter(c => finished(c.status)).length} of {ci.checks.length} checks complete · {ci.revision.slice(0, 7)} · last checked <time dateTime={ci.updatedAt}>{new Date(ci.updatedAt).toLocaleTimeString()}</time></small>
  </div>;
}
