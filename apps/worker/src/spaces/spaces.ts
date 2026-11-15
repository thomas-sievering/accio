import type { Space } from '@accio/protocol';
import type { SettingsAccess } from '@accio/hub';
import { UserError, type Broadcast, type Router } from '../rpc/router.js';

/**
 * GLOSSARY: Space. Kept with the hub's shared settings, so every paired machine has the
 * same spaces; the hub enforces their rules on every save (ADR 0019). Only the user's
 * clients reach these methods: no accio tool changes which space a project is in.
 */
export class Spaces {
  private announced: string;

  constructor(private settings: SettingsAccess, private broadcast: Broadcast) {
    this.announced = JSON.stringify(settings.spaces());
    // Any shared-settings change arrives here; clients hear only when spaces changed.
    settings.onMachinesChanged(() => this.announce());
  }

  list(): Space[] { return this.settings.spaces(); }

  private announce() {
    const spaces = this.list();
    const text = JSON.stringify(spaces);
    if (text === this.announced) return;
    this.announced = text;
    this.broadcast('spaces.changed', spaces);
  }

  register(router: Router) {
    router
      .on('spaces.list', async () => { await this.settings.refresh?.(); return this.list(); })
      .on('spaces.save', (space) => refused(() => this.settings.saveSpace(space)))
      .on('spaces.delete', async ({ id }) => { await refused(() => this.settings.deleteSpace(id)); return null; });
  }
}

/** The hub explains why it refused a save, such as a project already in another space. */
async function refused<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) {
    if ((error as { status?: number }).status === 400) throw new UserError((error as Error).message);
    throw error;
  }
}
