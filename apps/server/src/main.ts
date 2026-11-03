import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accioHome, loadServerConfig } from './config/serverConfig.js';
import { startApp } from './app.js';

const home = accioHome();
const config = await loadServerConfig(home);
const builtWeb = join(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const webRoot = process.env.ACCIO_WEB_ROOT ?? (existsSync(builtWeb) ? builtWeb : undefined);

const app = await startApp({ home, ...config, webRoot });
const url = `http://${config.host}:${app.port}`;
// The desktop app reads this line to find the server and its token.
console.log(`ACCIO_READY ${JSON.stringify({ url, token: config.token })}`);
console.log(`accio server: ${url}/#token=${config.token}`);

let stopping: Promise<void> | undefined;
const shutdown = () => {
  stopping ??= app.close().then(() => { process.exit(0); }, (error) => {
    console.error('accio shutdown failed', error);
    process.exit(1);
  });
};
process.on('message', (message) => {
  if (message && typeof message === 'object' && 'type' in message && message.type === 'shutdown') shutdown();
});
process.on('disconnect', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
