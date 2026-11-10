import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HOURLY_FOR_DAYS, UsageLedger, type UsageEntry } from './usage.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });

async function ledgerFile() {
  const dir = await mkdtemp(join(tmpdir(), 'sorting-hat-usage-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'usage.json');
}

const NOW = Date.parse('2026-11-10T15:30:00Z');
const entry = (over: Partial<UsageEntry> = {}): UsageEntry => ({
  at: NOW, providerId: 'anthropic', houseId: 'personal', hatKeyId: 'key-pi', accountId: 'claude-1', model: 'claude-opus-5-5',
  tokens: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 }, ...over,
});

describe('the usage ledger', () => {
  it('sums requests per hour, and groups, splits and filters them', async () => {
    const ledger = new UsageLedger(await ledgerFile(), () => NOW);
    ledger.record(entry());
    ledger.record(entry({ at: NOW + 10 * 60_000 }));
    ledger.record(entry({ at: NOW + 60 * 60_000, hatKeyId: null, model: 'claude-haiku-5-5' }));
    ledger.record(entry({ at: NOW - 24 * 3_600_000, houseId: 'hrc', hatKeyId: 'key-work', accountId: 'claude-2' }));
    ledger.record(entry({ providerId: 'openai', accountId: 'gpt-1', model: 'gpt-6', tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 0 } }));

    const all = ledger.report();
    expect(all.totals).toEqual({ requests: 5, inputTokens: 41, outputTokens: 82, cacheReadTokens: 123, cacheWriteTokens: 160 });
    expect(all.rows).toEqual([{ ...all.totals }]);

    expect(ledger.report({ groupBy: ['house'] }).rows).toEqual([
      { houseId: 'personal', requests: 4, inputTokens: 31, outputTokens: 62, cacheReadTokens: 93, cacheWriteTokens: 120 },
      { houseId: 'hrc', requests: 1, inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 },
    ]);
    const byHour = ledger.report({ bucket: 'hour', groupBy: ['hatKey', 'model'], where: { house: 'personal', provider: 'anthropic' } });
    expect(byHour.rows.map(({ start, hatKeyId, model, requests }) => [start, hatKeyId, model, requests])).toEqual([
      ['2026-11-10T15:00:00Z', 'key-pi', 'claude-opus-5-5', 2],
      ['2026-11-10T16:00:00Z', null, 'claude-haiku-5-5', 1],
    ]);
    expect(ledger.report({ where: { hatKey: null } }).totals.requests).toBe(1);
    expect(ledger.report({ bucket: 'day', groupBy: ['account'] }).rows.map((r) => [r.start, r.accountId, r.requests])).toEqual([
      ['2026-11-09T00:00:00Z', 'claude-2', 1],
      ['2026-11-10T00:00:00Z', 'claude-1', 3],
      ['2026-11-10T00:00:00Z', 'gpt-1', 1],
    ]);
    // A bucket counts when it starts in [from, to).
    const range = ledger.report({ from: Date.parse('2026-11-10T15:00:00Z'), to: Date.parse('2026-11-10T16:00:00Z') });
    expect([range.from, range.to, range.totals.requests]).toEqual(['2026-11-10T15:00:00Z', '2026-11-10T16:00:00Z', 3]);
  });

  it('survives a restart, and merges hours older than the hourly window into days', async () => {
    const file = await ledgerFile();
    const first = new UsageLedger(file, () => NOW);
    const old = NOW - (HOURLY_FOR_DAYS + 3) * 24 * 3_600_000;
    first.record(entry());
    first.record(entry({ at: old }));
    first.record(entry({ at: old + 3_600_000 }));
    await first.close();

    const second = new UsageLedger(file, () => NOW);
    await second.load();
    expect(second.report().totals.requests).toBe(3);
    expect(second.report({ bucket: 'hour' }).rows.map((r) => [r.start, r.requests])).toEqual([
      ['2026-08-09T00:00:00Z', 2],
      ['2026-11-10T15:00:00Z', 1],
    ]);
    second.record(entry());
    await second.close();
    const stored = JSON.parse(await readFile(file, 'utf8'));
    expect(stored).toEqual({ version: 1,
      hours: [['2026-11-10T15:00:00Z', 'anthropic', 'personal', 'key-pi', 'claude-1', 'claude-opus-5-5', 2, 20, 40, 60, 80]],
      days: [['2026-08-09T00:00:00Z', 'anthropic', 'personal', 'key-pi', 'claude-1', 'claude-opus-5-5', 2, 20, 40, 60, 80]] });
  });

  it('stays small for a year of busy use', async () => {
    const file = await ledgerFile();
    const ledger = new UsageLedger(file, () => NOW);
    // Ten series (hat key × account × model) busy 16 hours a day, every day for a year.
    const series = Array.from({ length: 10 }, (_, i) => ({ hatKeyId: `0b6f3c1e-5d2a-4f8e-9c7b-${String(i).padStart(12, '0')}`, accountId: `a1d2c3b4-e5f6-4a7b-8c9d-${String(i % 3).padStart(12, '0')}`, model: ['claude-opus-5-5', 'claude-sonnet-5-5', 'gpt-6.1-sol'][i % 3]! }));
    for (let day = 0; day < 365; day++) for (let hour = 6; hour < 22; hour++) for (const s of series) {
      ledger.record(entry({ ...s, at: NOW - day * 24 * 3_600_000 - hour * 3_600_000, tokens: { input: 123_456, output: 65_432, cacheRead: 9_876_543, cacheWrite: 234_567 } }));
    }
    await ledger.close();
    const size = (await stat(file)).size;
    expect(size).toBeLessThan(4 * 1024 * 1024);
  });
});
