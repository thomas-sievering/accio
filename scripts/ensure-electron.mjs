// Electron 45 no longer downloads its binary during install; fetch it if missing.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

// Resolve from the desktop app: it is the only package that depends on electron.
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
let installJs;
try {
  installJs = require.resolve('electron/install.js');
} catch {
  process.exit(0);
}
let present = false;
try {
  present = existsSync(require('electron'));
} catch {}
if (!present) spawnSync(process.execPath, [installJs], { stdio: 'inherit' });
