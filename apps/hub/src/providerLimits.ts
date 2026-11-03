import type { LimitWindow } from '@accio/protocol';
import { LimitsReadError, type LimitsRead } from './limits.js';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : null;
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const invalid = () => new LimitsReadError('unavailable', 'The provider returned limits in an unreadable format. Try again.');

function percent(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid();
  return Math.max(0, Math.min(100, value));
}

function timestamp(value: unknown, seconds = false): string | null {
  const ms = seconds && typeof value === 'number' ? value * 1000 : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : null;
}

function duration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function windowName(minutes: number | null, fallback: string): Pick<LimitWindow, 'kind' | 'label'> {
  if (minutes === 10080) return { kind: 'weekly', label: 'Weekly' };
  if (minutes === 43200 || minutes === 40320 || minutes === 44640) return { kind: 'monthly', label: 'Monthly' };
  if (minutes === null) return { kind: 'other', label: fallback };
  return { kind: minutes < 1440 ? 'session' : 'other', label: minutes % 60 === 0 ? `${minutes / 60}-hour` : `${minutes}-minute` };
}

/** OAuth account usage, not API billing. Keep each provider window and scope separate. */
export function anthropicLimits(raw: unknown): LimitsRead {
  const response = object(raw);
  if (!response) throw invalid();
  if (response.rate_limits_available === false) return { unsupported: true };
  const usage = object(response.rate_limits) ?? response;
  const windows: LimitWindow[] = [];
  let recognized = false;
  for (const [id, value] of Object.entries(usage)) {
    if (id !== 'five_hour' && !/^seven_day(?:_[a-z0-9_]+)?$/i.test(id)) continue;
    recognized = true;
    if (value == null) continue;
    const w = object(value);
    if (!w) throw invalid();
    const scope = id.startsWith('seven_day_') ? id.slice('seven_day_'.length).replaceAll('_', ' ') : null;
    windows.push({ id, kind: id === 'five_hour' ? 'session' : 'weekly', label: id === 'five_hour' ? '5-hour' : 'Weekly',
      scope, usedPercent: percent(w.utilization), resetsAt: timestamp(w.resets_at), durationMinutes: id === 'five_hour' ? 300 : 10080,
    });
  }
  if ('limits' in usage) {
    recognized = true;
    if (!Array.isArray(usage.limits)) throw invalid();
    for (const rawLimit of usage.limits) {
      const w = object(rawLimit);
      const kind = text(w?.kind);
      if (!w || !kind) continue;
      const model = object(object(w.scope)?.model);
      const scope = text(model?.display_name) ?? text(model?.id) ?? text(w.label);
      const minutes = duration(w.window_duration_minutes) ?? (kind.startsWith('weekly') ? 10080 : kind === 'five_hour' ? 300 : null);
      const name = windowName(minutes, text(w.label) ?? kind.replaceAll('_', ' '));
      windows.push({ id: text(w.id) ?? `${kind}:${text(model?.id) ?? scope ?? 'general'}`, ...name,
        scope: kind === 'weekly_scoped' || model ? scope : null, usedPercent: percent(w.percent ?? w.utilization),
        resetsAt: timestamp(w.resets_at), durationMinutes: minutes,
      });
    }
  }
  if (!recognized) throw invalid();
  return { windows: [...new Map(windows.map((w) => [w.id, w])).values()] };
}

/** Full account/rateLimits/read response from the hub's authenticated app-server. */
export function openaiLimits(raw: unknown): LimitsRead {
  const response = object(raw);
  if (!response || !('rateLimits' in response || 'rateLimitsByLimitId' in response)) throw invalid();
  const snapshots = new Map<string, ObjectValue>();
  if (response.rateLimitsByLimitId != null) {
    const byId = object(response.rateLimitsByLimitId);
    if (!byId) throw invalid();
    for (const [id, value] of Object.entries(byId)) {
      if (value === null) continue;
      const snapshot = object(value);
      if (!snapshot) throw invalid();
      snapshots.set(id, snapshot);
    }
  }
  if (response.rateLimits != null) {
    const snapshot = object(response.rateLimits);
    if (!snapshot) throw invalid();
    const id = text(snapshot.limitId) ?? 'codex';
    if (!snapshots.has(id)) snapshots.set(id, snapshot);
  }
  if (!snapshots.size) return { unsupported: true };
  const windows: LimitWindow[] = [];
  for (const [id, snapshot] of snapshots) {
    if (!('primary' in snapshot || 'secondary' in snapshot || 'individualLimit' in snapshot)) throw invalid();
    const scope = id === 'codex' ? null : text(snapshot.limitName) ?? id;
    for (const slot of ['primary', 'secondary'] as const) {
      if (snapshot[slot] == null) continue;
      const w = object(snapshot[slot]);
      if (!w) throw invalid();
      const minutes = duration(w.windowDurationMins);
      windows.push({ id: `${id}:${slot}`, ...windowName(minutes, slot === 'primary' ? 'Primary window' : 'Secondary window'),
        scope, usedPercent: percent(w.usedPercent), resetsAt: timestamp(w.resetsAt, true), durationMinutes: minutes,
      });
    }
    if (snapshot.individualLimit != null) {
      const w = object(snapshot.individualLimit);
      if (!w) throw invalid();
      const remaining = percent(w.remainingPercent);
      windows.push({ id: `${id}:individual`, kind: 'monthly', label: 'Monthly credit limit', scope,
        usedPercent: remaining === null ? null : 100 - remaining, resetsAt: timestamp(w.resetsAt, true), durationMinutes: null,
      });
    }
  }
  return { windows };
}

export function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (value === null || !value.trim()) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) && delay >= 0 ? Math.min(delay, 24 * 60 * 60_000) : undefined;
}
