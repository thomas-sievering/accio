import { homedir } from 'node:os';
import { join } from 'node:path';
import { startHubService } from './service.js';
import { HubTrust } from './trust.js';

const home = process.env.ACCIO_HOME ?? join(homedir(), '.accio-hub');
if (process.argv.includes('--pair')) {
  const pair = await HubTrust.createCode(home);
  console.log(`Pairing code: ${pair.code}\nExpires: ${new Date(pair.expiresAt).toISOString()}`);
} else {
  const service = await startHubService({ home, host: process.env.ACCIO_HOST ?? '127.0.0.1', port: Number(process.env.ACCIO_HUB_PORT ?? 47322), publicUrl: process.env.ACCIO_PUBLIC_URL });
  console.log(`ACCIO_HUB_READY ${JSON.stringify({ hubId: service.trust.id, port: service.port })}`);
  console.log(`Hub: ${process.env.ACCIO_PUBLIC_URL ?? service.url}`);
  if (!service.trust.paired) console.log(`First-device pairing code: ${(await service.createPairingCode()).code} (valid for 10 minutes)`);
  let stopping = false;
  const stop = () => { if (stopping) return; stopping = true; void service.close().then(() => process.exit(0), () => process.exit(1)); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  process.on('message', (message) => { if ((message as any)?.type === 'shutdown') stop(); });
  // A parent that forked this hub over IPC owns it; stop with that parent even if it was killed.
  process.on('disconnect', stop);
}
