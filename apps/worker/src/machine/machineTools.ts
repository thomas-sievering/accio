import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { findMentionedMachine, type MachineView, type ParamsOf, type ResultOf, type UpdateView } from '@accio/protocol';
import { accioTool } from '../tools/tools.js';

type Call = <M extends 'update.status' | 'update.start' | 'app.screenshot'>(method: M, params: ParamsOf<M>) => Promise<ResultOf<M>>;
export type MachineToolDeps = {
  here: string;
  machines: () => Pick<MachineView, 'id' | 'name'>[];
  /** Answers here or on the machine named in the params, through the relay. */
  call: Call;
  /** Where screenshots are saved on this machine. */
  folder: string;
  pollMs?: number;
  timeoutMs?: number;
};

const machine = z.string().trim().max(200).optional().describe("Name or id of the machine, as in Settings → Machines, or one the user mentioned with @, such as '@laptop'. Defaults to this machine.");

/** GLOSSARY: App screenshot and Update, as accio tools: any thread can look at and update Accio on each paired machine. */
export function machineTools(deps: MachineToolDeps) {
  const resolve = (name?: string) => name ? findMachine(deps.machines(), name) : { id: deps.here, name: 'this machine' };

  const screenshot = accioTool({
    name: 'app_screenshot',
    description: 'Take a screenshot of the Accio desktop app window on a paired machine, such as another computer running Accio. '
      + 'Optionally run JavaScript in the window first, for example to click a button that opens the view to capture; the capture waits for it, and for a returned promise. '
      + 'Returns the path of the saved PNG on this machine, to read or embed.',
    input: {
      machine,
      script: z.string().max(20_000).optional().describe('JavaScript run in the window before the capture, such as document.querySelector(\'[aria-label="Settings"]\').click()'),
    },
    call: async ({ machine: name, script }) => {
      const target = resolve(name);
      const { png, note } = await deps.call('app.screenshot', { machineId: target.id, ...(script ? { script } : {}) });
      await mkdir(deps.folder, { recursive: true });
      const path = join(deps.folder, `${slug(target.name)}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      await writeFile(path, Buffer.from(png, 'base64'));
      return `Saved a screenshot of Accio on ${target.name} to ${path}${note ? `\n\n${note}` : ''}`;
    },
  });

  const update = accioTool({
    name: 'app_update',
    description: 'Update Accio on a paired machine to the latest origin/main: it pulls, installs and builds in its checkout, then restarts. '
      + 'Waits until the machine is back on the new commit and reports it, or reports why the update failed or can\'t run. '
      + 'Push and merge changes to main first. Updating this machine restarts it, which interrupts this turn until it resumes.',
    input: { machine },
    call: async ({ machine: name }, { signal }) => {
      const target = resolve(name);
      const started = await deps.call('update.start', { machineId: target.id });
      if (target.id === deps.here) return 'Updating this machine. Accio restarts when the build is done and this turn continues afterwards.';
      const deadline = Date.now() + (deps.timeoutMs ?? 20 * 60_000);
      let last: UpdateView = started;
      while (Date.now() < deadline && !signal.aborted) {
        await new Promise((done) => setTimeout(done, deps.pollMs ?? 5000));
        // While it restarts the machine is offline; keep waiting.
        const view = await deps.call('update.status', { machineId: target.id }).catch(() => undefined);
        if (!view) continue;
        last = view;
        if (view.state === 'failed') return `The update on ${target.name} failed and was rolled back to ${view.commit}:\n${view.detail ?? ''}`;
        if ((view.state === 'current' || view.state === 'behind') && view.commit !== started.commit) {
          return `${target.name} restarted on ${view.commit}${view.state === 'behind' ? `, ${view.behind} commit(s) behind main again` : ', the latest main'}.`;
        }
      }
      return `${target.name} hasn't come back yet: ${last.state}${last.detail ? ` (${last.detail})` : ''}. Check again with app_update or Settings → Machines.`;
    },
  });

  return [screenshot, update];
}

/** The machine a tool argument names by id, name or @handle; throws listing the machines when none matches. */
export function findMachine<T extends Pick<MachineView, 'id' | 'name'>>(all: T[], name: string): T {
  const found = all.find((m) => m.id === name) ?? all.find((m) => m.name.toLowerCase() === name.toLowerCase())
    ?? findMentionedMachine(all, name);
  if (!found) throw new Error(`No machine named ${name}. Machines: ${all.map((m) => m.name).join(', ')}.`);
  return found;
}

function slug(name: string) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'machine'; }
