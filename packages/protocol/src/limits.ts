import { z } from 'zod';
import type { ProviderId } from './profiles.js';
import { method } from './rpc.js';

/** Provider-reported allowance. Unknown usage is null, never an invented zero. */
export type LimitWindow = {
  id: string;
  kind: 'session' | 'weekly' | 'monthly' | 'other';
  label: string;
  /** A model or other provider-defined scope; null means the general allowance. */
  scope: string | null;
  usedPercent: number | null;
  resetsAt: string | null;
  durationMinutes: number | null;
};

export type LimitsSnapshot = { observedAt: string; windows: LimitWindow[] };
export type LimitsProblem = {
  code: 'signInRequired' | 'rateLimited' | 'unavailable';
  message: string;
};

/** One hub-owned account snapshot, shared by every profile selecting that account. */
export type AccountLimitsView = {
  accountId: string;
  providerId: ProviderId;
  status: 'idle' | 'refreshing' | 'ready' | 'error' | 'signedOut' | 'unsupported';
  snapshot: LimitsSnapshot | null;
  /** Attempt time is separate from the last successful observation. */
  attemptedAt: string | null;
  retryAt: string | null;
  problem: LimitsProblem | null;
};

const RefreshLimits = z.object({
  /** Omit to refresh all named accounts. Shared profile references need only one id. */
  accountIds: z.array(z.string().min(1)).max(100).optional(),
  /** User-requested refresh bypasses freshness, while retryAt and a short cooldown still apply. */
  force: z.boolean().optional(),
});

export const limitsMethods = {
  'accounts.limits': method<z.ZodObject<{}>, AccountLimitsView[]>(z.object({})),
  'accounts.refreshLimits': method<typeof RefreshLimits, AccountLimitsView[]>(RefreshLimits),
};

export type LimitsEvents = { 'accounts.limitsChanged': AccountLimitsView[] };
