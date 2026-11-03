// Starts Electron with a clean environment. Terminals inside other Electron apps
// (T3 Code, VS Code) export ELECTRON_RUN_AS_NODE, which would make Electron run as Node.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [dirname(fileURLToPath(import.meta.url))], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
