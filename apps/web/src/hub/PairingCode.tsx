import type { ReactNode } from 'react';
import { formatDayTime } from '../ui/dates';

export type Pairing = { code: string; expiresAt: number };

/** A one-time pairing code and when it expires, as hub settings and machine onboarding show it. */
export function PairingCode({ pairing, expired, children }: { pairing: Pairing; expired?: boolean; children?: ReactNode }) {
  return <p role="status">
    {expired ? 'Code expired. Generate a new one.' : <><code>{pairing.code}</code> · expires at {formatDayTime(pairing.expiresAt)}</>}
    {children && <> {children}</>}
  </p>;
}
