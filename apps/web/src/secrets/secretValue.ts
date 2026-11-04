/**
 * Rules shared by every place a secret value is typed: the thread card and
 * Settings. Values stay in component state only; nothing here stores, trims
 * or logs them.
 */
const MAX_SECRET_BYTES = 16 * 1024;

const encoder = new TextEncoder();

/** The value's UTF-8 size, which is what the server limits. */
function secretBytes(value: string): number {
  return encoder.encode(value).length;
}

/** Why a typed value cannot be sent, or undefined when it can. Whitespace counts as content. */
export function valueProblem(value: string): string | undefined {
  if (secretBytes(value) > MAX_SECRET_BYTES) return 'This value is larger than 16 KiB.';
  return undefined;
}

/**
 * An error message safe to show next to a value field. Validation messages and
 * anything that could contain what was typed fall back to the given text.
 */
export function safeError(err: unknown, value: string, fallback: string): string {
  const message = err instanceof Error ? err.message : '';
  if (!message || message.startsWith('Invalid params') || (value && message.includes(value))) return fallback;
  return message;
}

/** Props for a write-only value field: no autofill, spelling or capitalisation. */
export const valueInputProps = {
  type: 'password',
  autoComplete: 'off',
  spellCheck: false,
  autoCapitalize: 'off',
  autoCorrect: 'off',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
} as const;
