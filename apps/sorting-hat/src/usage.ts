import { JsonFile } from './store.js';
import type { ProviderId } from './types.js';
import type { Tokens } from './usageTap.js';

/** In the state directory, beside sorting-hat.json. */
export const USAGE_FILE = 'usage.json';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Hourly buckets older than this are merged into daily ones, so a year stays small. */
export const HOURLY_FOR_DAYS = 90;
const WRITE_AFTER_MS = 10_000;

/** One request's usage, as the model routes saw it. */
export type UsageEntry = {
  at: number;
  providerId: ProviderId;
  houseId: string;
  hatKeyId: string;
  accountId: string;
  /** The model the provider reported, else the one asked for; null when neither is known. */
  model: string | null;
  tokens: Tokens;
};

/** [start, providerId, houseId, hatKeyId, accountId, model, requests, input, output, cacheRead, cacheWrite] */
type Row = [string, ProviderId, string, string | null, string, string | null, number, number, number, number, number];
type UsageDocument = { version: 1; hours: Row[]; days: Row[] };

export type UsageDimension = 'house' | 'hatKey' | 'account' | 'model' | 'provider';
export const USAGE_DIMENSIONS: UsageDimension[] = ['house', 'hatKey', 'account', 'model', 'provider'];
export type UsageQuery = {
  /** Buckets starting at or after this, and before `to`. */
  from?: number;
  to?: number;
  groupBy?: UsageDimension[];
  /** Splits the totals by hour or day; without it, one row per group. */
  bucket?: 'hour' | 'day';
  /** Only usage that matches every one given. */
  where?: Partial<Record<UsageDimension, string | null>>;
};
export type UsageTotals = { requests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
export type UsageRow = UsageTotals & { start?: string; houseId?: string; hatKeyId?: string | null; accountId?: string; model?: string | null; providerId?: ProviderId };
export type UsageReport = { from: string | null; to: string | null; bucket: 'hour' | 'day' | null; groupBy: UsageDimension[]; rows: UsageRow[]; totals: UsageTotals };

const FIELD: Record<UsageDimension, { index: number; name: 'houseId' | 'hatKeyId' | 'accountId' | 'model' | 'providerId' }> = {
  provider: { index: 1, name: 'providerId' },
  house: { index: 2, name: 'houseId' },
  hatKey: { index: 3, name: 'hatKeyId' },
  account: { index: 4, name: 'accountId' },
  model: { index: 5, name: 'model' },
};

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const floor = (ms: number, size: number) => Math.floor(ms / size) * size;
const keyOf = (row: Row) => JSON.stringify(row.slice(0, 6));

/**
 * GLOSSARY: Usage. Tokens per hour, hat key, house, account and model, in
 * `usage.json`. Kept in memory and written a few seconds after a change (and on
 * close), so counting never waits for the disk. Hours older than
 * HOURLY_FOR_DAYS become days; nothing is deleted.
 */
export class UsageLedger {
  private file: JsonFile<UsageDocument>;
  private hours = new Map<string, Row>();
  private days = new Map<string, Row>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> = Promise.resolve();

  constructor(path: string, private now: () => number = Date.now) {
    // One line per document: it is rewritten whole, and indenting would double it.
    this.file = new JsonFile(path, () => ({ version: 1, hours: [], days: [] }), 0o600, 0);
  }

  async load() {
    const stored = await this.file.read();
    this.hours = new Map((stored.hours ?? []).map((row) => [keyOf(row), row]));
    this.days = new Map((stored.days ?? []).map((row) => [keyOf(row), row]));
    this.compact();
  }

  record({ at, providerId, houseId, hatKeyId, accountId, model, tokens }: UsageEntry) {
    const row: Row = [iso(floor(at, HOUR)), providerId, houseId, hatKeyId, accountId, model, 1, tokens.input, tokens.output, tokens.cacheRead, tokens.cacheWrite];
    add(this.hours, row);
    this.timer ??= setTimeout(() => { this.timer = undefined; void this.flush(); }, WRITE_AFTER_MS);
    this.timer.unref?.();
  }

  report({ from, to, groupBy = [], bucket, where = {} }: UsageQuery = {}): UsageReport {
    const groups = new Map<string, UsageRow>();
    const totals = zero();
    const dims = USAGE_DIMENSIONS.filter((d) => groupBy.includes(d));
    for (const row of [...this.days.values(), ...this.hours.values()]) {
      const start = Date.parse(row[0]);
      if ((from !== undefined && start < from) || (to !== undefined && start >= to)) continue;
      if (Object.entries(where).some(([d, value]) => row[FIELD[d as UsageDimension].index] !== value)) continue;
      const out: UsageRow = { ...(bucket ? { start: iso(bucket === 'day' ? floor(start, DAY) : start) } : {}), ...zero() };
      for (const d of dims) Object.assign(out, { [FIELD[d].name]: row[FIELD[d].index] });
      const key = JSON.stringify([out.start, ...dims.map((d) => row[FIELD[d].index])]);
      const group = groups.get(key) ?? (groups.set(key, out), out);
      for (const target of [group, totals]) addTotals(target, row);
    }
    const rows = [...groups.values()].sort((a, b) => (a.start ?? '').localeCompare(b.start ?? '') || b.inputTokens + b.outputTokens - a.inputTokens - a.outputTokens);
    return { from: from === undefined ? null : iso(from), to: to === undefined ? null : iso(to), bucket: bucket ?? null, groupBy: dims, rows, totals };
  }

  /** Writes what is in memory now. */
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.compact();
    const document: UsageDocument = { version: 1, hours: [...this.hours.values()], days: [...this.days.values()] };
    const write = () => this.file.write(document).catch((error) => console.error('[sorting-hat] could not write usage', (error as Error).message));
    return this.writing = this.writing.then(write, write);
  }

  async close() {
    await this.flush();
  }

  /** Hours that started before the cut, whole UTC days back, join their day. */
  private compact() {
    const cut = floor(this.now(), DAY) - HOURLY_FOR_DAYS * DAY;
    for (const [key, row] of this.hours) {
      const start = Date.parse(row[0]);
      if (start >= cut) continue;
      this.hours.delete(key);
      add(this.days, [iso(floor(start, DAY)), ...row.slice(1)] as Row);
    }
  }
}

function add(rows: Map<string, Row>, row: Row) {
  const key = keyOf(row);
  const existing = rows.get(key);
  if (!existing) return void rows.set(key, row);
  for (let i = 6; i < 11; i++) existing[i] = (existing[i] as number) + (row[i] as number);
}

function zero(): UsageTotals {
  return { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

function addTotals(target: UsageTotals, row: Row) {
  target.requests += row[6]; target.inputTokens += row[7]; target.outputTokens += row[8]; target.cacheReadTokens += row[9]; target.cacheWriteTokens += row[10];
}
