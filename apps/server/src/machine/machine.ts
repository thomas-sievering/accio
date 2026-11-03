import { hostname, platform } from 'node:os';
import type { MachineInfo } from '@accio/protocol';
import type { Router } from '../rpc/router.js';

export const SERVER_VERSION = '0.1.0';

export function machineInfo(): MachineInfo {
  return { name: hostname(), platform: platform(), version: SERVER_VERSION };
}

export function registerMachine(router: Router) {
  router.on('machine.get', () => machineInfo());
}
