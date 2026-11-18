import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { McpDefinition, RESOURCE_LEVELS, type LevelContext, type McpSave, type McpView } from '@accio/protocol';
import { accioTool, ACCIO_MCP_SERVER } from '../tools/tools.js';
import type { ConfirmationRequest } from '../threads/confirmations.js';
import { levelScope, levelWhere, mergedScope } from './levelScope.js';

type Outcome = 'allowed' | 'declined' | 'expired' | 'cancelled';
export type AddMcpDeps = {
  /** The calling thread, when it runs on this machine. */
  caller: (threadId: string) => { profileId: string; projectId: string } | undefined;
  levelContext: (profileId: string, projectId: string) => LevelContext;
  names: (at: LevelContext) => { profile?: string; space?: string; project?: string };
  mcps: () => McpView[];
  save: (mcp: McpSave) => Promise<McpView>;
  /** Starts the hub's OAuth sign-in and returns the page to open; the hub finishes it at its callback. */
  beginSignIn: (id: string) => Promise<{ url: string }>;
  setToken: (id: string, token: string) => Promise<void>;
  confirm: (threadId: string, request: ConfirmationRequest, signal: AbortSignal) => Promise<Outcome>;
};

const MAX_TOKEN = 16 * 1024;
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|-+$/g, '').slice(0, 60) || 'mcp';
const sameServer = (a: McpView, b: { url?: string; command?: string; args: string[] }) =>
  a.url ? a.url === b.url : a.command === b.command && JSON.stringify(a.args) === JSON.stringify(b.args);

/**
 * GLOSSARY: MCP server. The add_mcp accio tool: a thread adds an MCP server at its own project,
 * space or profile, or Everywhere after you allow it (ADR 0024). A remote server's sign-in stays
 * on the hub: a bearer token is read from a secret file, never from the conversation, and OAuth
 * returns a page for the user to open. It never removes a server or narrows its levels.
 */
export function addMcpTool(deps: AddMcpDeps) {
  return accioTool({
    name: 'add_mcp',
    description: 'Add an MCP server to Accio, so threads get its tools at the level you choose: this thread\'s project, its space, its profile, or everywhere (which asks the user first). A remote server (url) is reached through the hub, which keeps its sign-in; a local one (command) runs on the machine running the thread. Threads get it from their next turn. Use it when the user asks to add or connect an MCP server. For a bearer token, get it with request_secret first and pass the file as token_file; never ask for it in chat. For OAuth, the result has a sign-in link to show the user.',
    input: {
      name: z.string().trim().min(1).max(120).describe('Display name, such as Mobbin'),
      url: z.string().trim().optional().describe('A remote server\'s URL, such as https://mcp.example.com/mcp'),
      command: z.string().trim().optional().describe('A local server\'s command, such as npx; instead of url'),
      args: z.array(z.string()).max(50).optional().describe('A local server\'s arguments'),
      auth: z.enum(['none', 'bearer', 'oauth']).default('none').describe('How a remote server signs in: none (default), bearer (a token) or oauth'),
      oauth_client_id: z.string().trim().optional().describe('Only when the service needs a registered OAuth client'),
      token_file: z.string().trim().optional().describe('For bearer: the file request_secret returned. Accio reads it and keeps the token on the hub.'),
      level: z.enum(RESOURCE_LEVELS).default('project').describe('Which threads get it: project (default), space, profile or everywhere'),
    },
    call: async (args, { threadId, signal, progress }) => {
      const caller = deps.caller(threadId);
      if (!caller) throw new Error('This thread is not on this machine.');
      if (!!args.url === !!args.command) throw new Error('Give either url, for a remote server, or command, for a local one.');
      if (args.command && args.auth && args.auth !== 'none') throw new Error('A local server handles its own sign-in; use auth none, or add it by url.');
      if (args.token_file && args.auth !== 'bearer') throw new Error('token_file is only for auth bearer.');
      const at = deps.levelContext(caller.profileId, caller.projectId);
      const scope = levelScope(args.level, at);
      const target = { url: args.url, command: args.command, args: args.args ?? [] };
      const existing = deps.mcps().find(m => sameServer(m, target));
      const taken = [ACCIO_MCP_SERVER, ...deps.mcps().map(m => m.id)];
      let id = existing?.id ?? slug(args.name);
      if (!existing) for (let n = 2; taken.includes(id); n++) id = `${slug(args.name)}-${n}`;
      const parsed = McpDefinition.safeParse(args.url
        ? { id, name: args.name, transport: 'http', url: args.url, args: [], auth: args.auth, oauthClientId: args.oauth_client_id || undefined }
        : { id, name: args.name, transport: 'stdio', command: args.command, args: target.args, auth: 'none' });
      if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
      const mcp = parsed.data;
      const where = levelWhere(args.level, deps.names(at));
      if (args.level === 'everywhere' && !existing?.scope.global) {
        const outcome = await deps.confirm(threadId, {
          title: `Add ${mcp.name} for every thread?`,
          detail: `${mcp.url ?? [mcp.command, ...mcp.args].join(' ')}. Every thread of all your profiles gets its tools${mcp.transport === 'stdio' ? ', and runs its command on the machine running the thread' : ''}.`,
          allowLabel: 'Add everywhere',
        }, signal);
        if (outcome !== 'allowed') return outcome === 'declined' ? 'The user declined adding this MCP server everywhere. Nothing was saved; a narrower level such as project, space or profile needs no confirmation.' : 'The confirmation ended without an answer. Nothing was saved.';
      }
      // A token is read before saving, so a bad file saves nothing.
      const token = args.token_file ? await readToken(args.token_file) : undefined;
      progress(`Saving ${mcp.name}`);
      const saved = await deps.save({ ...mcp, scope: existing ? mergedScope(existing.scope, scope) : scope });
      if (token) await deps.setToken(saved.id, token);
      const done = `Saved ${saved.name} for ${where}. Threads get its tools from their next turn, not this one.`;
      if (saved.transport === 'stdio' || saved.auth === 'none') return done;
      if (saved.auth === 'bearer') return token || saved.signedIn ? `${done}\nIts token is saved on the hub.`
        : `${done}\nIt needs a bearer token before it works. Get it with request_secret and call add_mcp again with the same url, auth bearer and token_file.`;
      if (saved.signedIn) return `${done}\nIt is already signed in.`;
      progress(`Starting sign-in to ${saved.name}`);
      try {
        const { url } = await deps.beginSignIn(saved.id);
        return `${done}\nIt needs the user to sign in. Show them this link as a Markdown link and ask them to open it: ${url}\nThe hub finishes the sign-in when the page comes back; the link expires in 10 minutes. If it can't come back, they can sign in again from Settings → MCP servers → ${saved.name}.`;
      } catch (error) {
        return `${done}\nBut sign-in couldn't start: ${error instanceof Error ? error.message : String(error)}\nThe service may need an OAuth client ID (oauth_client_id), or another auth.`;
      }
    },
  });
}

async function readToken(path: string) {
  const text = (await readFile(path, 'utf8').catch(() => { throw new Error('Could not read token_file. Request the secret again and pass the path it returns.'); })).trim();
  if (!text) throw new Error('token_file is empty.');
  if (text.length > MAX_TOKEN) throw new Error('token_file is too large for a token.');
  return text;
}
