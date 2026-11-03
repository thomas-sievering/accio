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

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
