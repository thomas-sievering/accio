/**
 * The Sorting Hat's own vocabulary. It imports nothing from Accio (ADR 0018), so
 * these mirror the shapes Accio's clients read today; keep them compatible.
 */

/** GLOSSARY: Provider. */
export type ProviderId = 'anthropic' | 'openai';

/** GLOSSARY: Account. Who it is; its tokens never leave the Sorting Hat. */
export type AccountView = { id: string; name: string; providerId: ProviderId; signedIn: boolean; email: string | null; organization: string | null };

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

/** GLOSSARY: Limits. One account's snapshot, shared by every house that has the account. */
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

/** Image types a ChatGPT model reads when Codex reports image input. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export type Fetch = typeof fetch;
