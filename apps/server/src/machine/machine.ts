import { randomUUID } from 'node:crypto';
import { hostname, platform } from 'node:os';
import { join } from 'node:path';
import type { MachineInfo, MachineView } from '@accio/protocol';
import type { HarnessInstall, SharedSettings } from '@accio/hub';
import type { Broadcast, Router } from '../rpc/router.js';
import { UserError } from '../rpc/router.js';
import { JsonFile } from '@accio/persistence';

export const SERVER_VERSION = '0.1.0';

/** This machine's stable id, created on first start. The hub knows the machine by it. */
export async function loadMachineId(home: string): Promise<string> {
  const file = new JsonFile<{ id?: string }>(join(home, 'machine.json'), () => ({}));
  const stored = await file.read();
  if (stored.id) return stored.id;
  const id = randomUUID();
  await file.write({ ...stored, id });
  return id;
}

export function machineInfo(id: string): MachineInfo {
  return { id, name: hostname(), platform: platform(), version: SERVER_VERSION };
}

/**
 * GLOSSARY: Machine. This machine connects to the hub on start and leaves on close;
 * every client sees all machines the hub knows, and edits each one's profile
 * folders there (ADR 0004).
 */
export class Machines {
  constructor(
    private here: MachineInfo,
    private settings: SharedSettings,
    private broadcast: Broadcast,
  ) {
    settings.onMachinesChanged(() => this.announce());
  }

  async connect(harnesses: HarnessInstall[]) {
    await this.settings.machineConnected({ ...this.here, harnesses });
  }

  async disconnect() {
    await this.settings.machineDisconnected(this.here.id);
  }

  /** Each profile's folders on this machine (GLOSSARY: Profile folder). */
  profileFoldersHere(): { id: string; folders: string[] }[] {
    const folders = this.settings.machine(this.here.id)?.profileFolders ?? {};
    return this.settings.profiles().map((p) => ({ id: p.id, folders: folders[p.id] ?? [] }));
  }

  views(): MachineView[] {
    return this.settings
      .machines()
      .map(({ id, name, platform, version, connected, lastSeen, harnesses, profileFolders }) => ({
        id,
        name,
        platform,
        version,
        connected,
        lastSeen,
        harnesses,
        profileFolders,
        thisMachine: id === this.here.id,
      }))
      .sort((a, b) => Number(b.thisMachine) - Number(a.thisMachine) || a.name.localeCompare(b.name));
  }

  /** Tells clients again, such as after a profile was added or deleted. */
  announce() {
    this.broadcast('machines.changed', this.views());
  }

  register(router: Router) {
    router
      .on('machine.get', () => ({ ...this.here, name: this.settings.machine(this.here.id)?.name ?? this.here.name }))
      .on('machines.list', () => this.views())
      .on('machines.rename', async ({ machineId, name }) => {
        if (!this.settings.machine(machineId)) throw new UserError('No such machine');
        await this.settings.renameMachine(machineId, name);
        return this.views().find((m) => m.id === machineId)!;
      })
      .on('machines.setProfileFolders', async ({ machineId, profileId, folders }) => {
        if (!this.settings.machine(machineId)) throw new UserError('No such machine');
        if (!this.settings.profiles().some((p) => p.id === profileId)) throw new UserError(`No profile ${profileId}`);
        await this.settings.setProfileFolders(machineId, profileId, folders);
        return this.views().find((m) => m.id === machineId)!;
      });
  }
}
