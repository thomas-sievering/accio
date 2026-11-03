import { useCallback, useState } from 'react';

/**
 * Runs a server call with a busy flag and the error it threw, the pattern every
 * form and menu here needs. `run` resolves to the call's result, or undefined
 * when it failed (the message is then in `error`).
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(undefined);
    try {
      return await fn();
    } catch (err) {
      setError((err as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  const clear = useCallback(() => setError(undefined), []);
  return { busy, error, run, clear };
}
