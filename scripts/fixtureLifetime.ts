/**
 * Stops a fixture server when nothing owns it any more, so hand-started probes cannot linger.
 * - Forked over IPC (tests/servers.ts): close when the parent disconnects, even if it was killed.
 * - Any launch: close when the parent process is gone.
 * - Standalone (no IPC): also close after ACCIO_FIXTURE_TTL_MINUTES (default 60).
 */
export function closeWhenOrphaned(name: string, close: () => void) {
  process.on('disconnect', close);
  const parent = process.ppid;
  setInterval(() => {
    try { process.kill(parent, 0); } catch { close(); }
  }, 5000).unref();
  if (!process.send) {
    const minutes = Number(process.env.ACCIO_FIXTURE_TTL_MINUTES ?? 60);
    setTimeout(close, minutes * 60_000).unref();
    console.log(`${name} fixture is standalone (pid ${process.pid}); it stops itself after ${minutes} min or on Ctrl+C.`);
  }
}
