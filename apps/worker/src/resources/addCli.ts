import { join } from 'node:path';
import { z } from 'zod';
import { RESOURCE_LEVELS, ToolDefinition, type LevelContext, type ResourceScope, type ToolEntry, type ToolStatus } from '@accio/protocol';
import { levelScope, levelWhere, mergedScope } from './levelScope.js';
import { accioTool } from '../tools/tools.js';
import type { ConfirmationRequest } from '../threads/confirmations.js';

type Outcome = 'allowed' | 'declined' | 'expired' | 'cancelled';
export type AddCliDeps = {
  /** The calling thread, when it runs on this machine. */
  caller: (threadId: string) => { profileId: string; projectId: string } | undefined;
  levelContext: (profileId: string, projectId: string) => LevelContext;
  names: (at: LevelContext) => { profile?: string; space?: string; project?: string };
  tools: () => ToolEntry[];
  /** Saves the CLI and resolves with this machine's install and check. */
  save: (tool: ToolDefinition & { scope: ResourceScope }) => Promise<ToolStatus>;
  bin: (tool: ToolDefinition) => string;
  confirm: (threadId: string, request: ConfirmationRequest, signal: AbortSignal) => Promise<Outcome>;
};

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|-+$/g, '').slice(0, 60) || 'cli';

/**
 * GLOSSARY: CLI. The add_cli accio tool: a thread adds a CLI at its own project, space or
 * profile, or Everywhere after you allow it, then gets this machine's install and check back
 * (ADR 0021). It never removes a CLI or narrows its levels; that is up to you in Settings.
 */
export function addCliTool(deps: AddCliDeps) {
  return accioTool({
    name: 'add_cli',
    description: 'Add a command-line program (an npm package at an exact version) to Accio, so Accio installs it on every machine and lists it to threads at the level you choose: this thread\'s project, its space, its profile, or everywhere (which asks the user first). Waits for the install and health check on this machine and returns the result. Use it when the user asks to install or add a CLI for threads; programs installed globally by hand are not available to threads.',
    input: {
      package: z.string().trim().describe('npm package name, such as agent-desktop or @playwright/cli'),
      version: z.string().trim().describe('Exact version, such as 1.2.3. Look it up with `npm view <package> version`.'),
      executable: z.string().trim().describe('The command the package installs, from its package.json "bin"'),
      level: z.enum(RESOURCE_LEVELS).default('project').describe('Which threads get it: project (default), space, profile or everywhere'),
      name: z.string().trim().max(120).optional().describe('Display name; defaults to the executable'),
      description: z.string().trim().max(300).optional().describe('One line telling threads what it does; defaults to the package description'),
      check_args: z.array(z.string()).max(20).optional().describe('Arguments of the health check; defaults to ["--version"]'),
    },
    call: async (args, { threadId, signal, progress }) => {
      const caller = deps.caller(threadId);
      if (!caller) throw new Error('This thread is not on this machine.');
      const at = deps.levelContext(caller.profileId, caller.projectId);
      const scope = levelScope(args.level, at);
      const existing = deps.tools().find(t => t.package === args.package && t.version === args.version && t.executable === args.executable);
      const taken = deps.tools().map(t => t.id);
      let id = existing?.id ?? slug(args.executable);
      if (!existing) for (let n = 2; taken.includes(id); n++) id = `${slug(args.executable)}-${n}`;
      const parsed = ToolDefinition.safeParse({
        ...existing, id, name: args.name ?? existing?.name ?? args.executable, package: args.package, version: args.version, executable: args.executable,
        checkArgs: args.check_args ?? existing?.checkArgs ?? ['--version'], description: args.description ?? existing?.description,
      });
      if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
      const tool = parsed.data;
      const names = deps.names(at);
      const where = levelWhere(args.level, names);
      if (args.level === 'everywhere' && !existing?.scope.global) {
        const outcome = await deps.confirm(threadId, {
          title: `Add ${tool.name} for every thread?`,
          detail: `${tool.package}@${tool.version} runs as \`${tool.executable}\`. Accio installs it on every machine, with its install scripts, and lists it to threads of all your profiles.`,
          allowLabel: 'Add everywhere',
        }, signal);
        if (outcome !== 'allowed') return outcome === 'declined' ? 'The user declined adding this CLI everywhere. Nothing was saved; a narrower level such as project, space or profile needs no confirmation.' : 'The confirmation ended without an answer. Nothing was saved.';
      }
      progress(`Installing ${tool.package}@${tool.version}`);
      const status = await deps.save({ ...tool, scope: existing ? mergedScope(existing.scope, scope) : scope });
      const saved = `Saved ${tool.name} (${tool.package}@${tool.version}) for ${where}. Other machines install it on their own.`;
      if (status.status === 'ready') {
        return `${saved}\nReady on this machine. It is on the PATH from the next turn; in this turn run it as ${JSON.stringify(join(deps.bin(tool), tool.executable))}.\nCheck output:\n${(status.detail ?? '').slice(-1500)}`;
      }
      return `${saved}\nBut on this machine it is ${status.status}: ${(status.detail ?? '').slice(-1500)}${status.repairThreadId ? '\nA repair thread was started.' : ''}\nTo fix it, call add_cli again with the same package and a different version, executable or check_args.`;
    },
  });
}
