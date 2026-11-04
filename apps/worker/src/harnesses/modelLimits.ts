import type { LimitWindow, UsedUpLimit } from '@accio/protocol';

/** "Claude Fable 5.1", "claude-fable-5[1m]" and "fable" all become ["fable", ...version]. */
function words(text: string): string[] {
  return text.toLowerCase().replace(/\[[^\]]*\]$/, '').split(/[^a-z0-9]+/).filter((w) => w && w !== 'claude');
}

/**
 * Whether a limit window's scope names this model. Providers name scopes by family
 * ("Fable", "Opus") or by full name ("GPT-5.3-Codex-Spark"), and models by alias,
 * id or versioned name, so this matches on words: the scope's words must start the
 * model's id or name, and anything left over may only be a version. "Fable" matches
 * "Claude Fable 5.1" but "GPT-5" does not match "GPT-5.3-Codex-Spark".
 */
export function scopeMatchesModel(scope: string, model: { id: string; name: string }): boolean {
  const wanted = words(scope);
  if (!wanted.length) return false;
  return [model.id, model.name].some((text) => {
    const have = words(text);
    return wanted.every((w, i) => have[i] === w) && have.slice(wanted.length).every((w) => /^\d+$/.test(w));
  });
}

/** Used up means fully used and not yet reset. A window with no known reset time is not trusted to block anything. */
function usedUp(window: LimitWindow, now: number): boolean {
  return (window.usedPercent ?? 0) >= 100 && !!window.resetsAt && Date.parse(window.resetsAt) > now;
}

function describe(window: LimitWindow): UsedUpLimit {
  const kind = window.label.toLowerCase();
  const name = /limit$/.test(kind) ? kind : `${kind} limit`;
  // Anthropic's seven_day_fable arrives as the scope "fable".
  const scope = window.scope && window.scope === window.scope.toLowerCase() ? window.scope.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : window.scope;
  return { label: scope ? `${scope}'s ${name}` : `The ${name}`, resetsAt: window.resetsAt };
}

/**
 * The model's own used-up window that resets last, since the model is unavailable until then.
 * Extra usage is ignored on purpose: it is billed on top of the plan, so a used-up model
 * stays refused even when the account could pay to go on.
 */
export function modelLimit(model: { id: string; name: string }, windows: readonly LimitWindow[], now = Date.now()): UsedUpLimit | undefined {
  const own = windows.filter((w) => w.scope && usedUp(w, now) && scopeMatchesModel(w.scope, model));
  const last = own.sort((a, b) => Date.parse(b.resetsAt!) - Date.parse(a.resetsAt!))[0];
  return last && describe(last);
}

/** Used-up windows that apply to the whole account rather than one model. */
export function generalLimits(windows: readonly LimitWindow[], now = Date.now()): UsedUpLimit[] {
  return windows.filter((w) => !w.scope && usedUp(w, now)).map(describe);
}

/** The earliest moment one of these windows resets, after which availability changes. */
export function nextReset(windows: readonly LimitWindow[], now = Date.now()): number | undefined {
  const times = windows.filter((w) => usedUp(w, now)).map((w) => Date.parse(w.resetsAt!));
  return times.length ? Math.min(...times) : undefined;
}

/** "Fable's weekly limit is used up until Tue 4 Nov, 14:00 GMT+1." in this machine's time zone. */
export function usedUpMessage(limit: UsedUpLimit): string {
  const until = limit.resetsAt ? ` until ${new Date(limit.resetsAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}` : '';
  return `${limit.label} is used up${until}. Choose another model.`;
}
