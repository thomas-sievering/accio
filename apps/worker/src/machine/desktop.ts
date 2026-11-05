import { randomUUID } from 'node:crypto';

/**
 * The desktop app this worker runs inside, when it does. It can restart Accio
 * and capture its window; a headless worker (`pnpm worker`) has neither.
 */
export type DesktopHost = {
  /** Quits the app as usual, interrupting turns, and starts it again from the same checkout. */
  relaunch(): void;
  /** A PNG of the app's window, after running `script` in it if given; `note` says what it left out and why. */
  capture(script?: string): Promise<AppScreenshot>;
};

export type AppScreenshot = { png: Buffer; note?: string };

/** Messages between the desktop's main process and its worker over Node IPC. */
export type DesktopMessage =
  | { type: 'relaunch' }
  | { type: 'capture'; id: string; script?: string }
  | { type: 'captured'; id: string; png?: string; note?: string; error?: string };

const CAPTURE_TIMEOUT_MS = 30_000;

/** The host that started this process, if it is the desktop app (it sets `ACCIO_DESKTOP=1`). */
export function desktopHost(proc: NodeJS.Process = process): DesktopHost | undefined {
  if (proc.env.ACCIO_DESKTOP !== '1' || !proc.send) return undefined;
  const pending = new Map<string, { resolve(shot: AppScreenshot): void; reject(error: Error): void }>();
  proc.on('message', (message: DesktopMessage) => {
    if (message?.type !== 'captured') return;
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.png) waiting.resolve({ png: Buffer.from(message.png, 'base64'), ...(message.note ? { note: message.note } : {}) });
    else waiting.reject(new Error(message.error ?? 'Could not capture the window.'));
  });
  const send = (message: DesktopMessage) => { proc.send!(message); };
  return {
    relaunch: () => send({ type: 'relaunch' }),
    capture: (script) => new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('The window did not answer in time.')); }, CAPTURE_TIMEOUT_MS);
      timer.unref?.();
      pending.set(id, { resolve: (shot) => { clearTimeout(timer); resolve(shot); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      send({ type: 'capture', id, ...(script ? { script } : {}) });
    }),
  };
}
