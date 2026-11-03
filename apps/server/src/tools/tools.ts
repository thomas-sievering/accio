import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';

/**
 * GLOSSARY: Accio tools. Tools accio gives every harness, served over MCP by the
 * machine the turn runs on (ADR 0011). Harnesses know them as the `accio` MCP
 * server. Each turn gets its own token, which says which thread a call belongs
 * to and stops working when the turn ends.
 */
export const ACCIO_MCP_SERVER = 'accio';
export const MCP_PATH = '/mcp';

export type AccioTool<Shape extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  description: string;
  input: Shape;
  call: (args: z.infer<z.ZodObject<Shape>>, context: { threadId: string }) => Promise<string> | string;
};

/** Typed helper so each tool's arguments are checked against its own shape. */
export function accioTool<Shape extends z.ZodRawShape>(tool: AccioTool<Shape>): AccioTool {
  return tool as unknown as AccioTool;
}

/** How one turn's harness reaches accio's tools. */
export type ToolAccess = { url: string; authorization: string };

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 1024 * 1024;

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: unknown; params?: Record<string, unknown> };

export class AccioTools {
  private grants = new Map<string, { threadId: string }>();
  private origin?: string;

  constructor(private tools: AccioTool[]) {}

  /** Where the machine server listens; known once its transport is up. */
  listen(origin: string) {
    this.origin = origin;
  }

  /** Access for one turn of a thread; revoke it when the turn ends. */
  grant(threadId: string): { access: ToolAccess; revoke: () => void } | undefined {
    if (!this.origin) return undefined;
    const token = randomBytes(32).toString('base64url');
    this.grants.set(token, { threadId });
    return { access: { url: `${this.origin}${MCP_PATH}`, authorization: `Bearer ${token}` }, revoke: () => this.grants.delete(token) };
  }

  /** Streamable HTTP, answered with plain JSON: no sessions or server-sent events are needed for these tools. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== MCP_PATH) return false;
    const token = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
    const grant = token ? this.grants.get(token) : undefined;
    if (!grant) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'This turn has no access to accio tools.' }));
      return true;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end();
      return true;
    }
    let message: RpcRequest;
    try {
      message = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, rpcError(null, -32700, 'Parse error'));
    }
    if (Array.isArray(message) || typeof message !== 'object' || message === null || typeof message.method !== 'string') {
      return json(res, 400, rpcError(null, -32600, 'Invalid request'));
    }
    // Notifications and responses need no answer.
    if (message.id === undefined || message.id === null) {
      res.writeHead(202).end();
      return true;
    }
    return json(res, 200, await this.answer(message as RpcRequest & { method: string }, grant.threadId));
  }

  private async answer({ id, method, params }: RpcRequest & { method: string }, threadId: string) {
    switch (method) {
      case 'initialize': {
        const asked = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '';
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[1],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: ACCIO_MCP_SERVER, version: '0.1.0' },
        });
      }
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list':
        // Claude Code would otherwise defer MCP tools behind its tool search; accio's are few and named in the system prompt.
        return rpcResult(id, { tools: this.tools.map(({ name, description, input }) => ({ name, description, inputSchema: inputSchema(input), _meta: { 'anthropic/alwaysLoad': true } })) });
      case 'tools/call': {
        const tool = this.tools.find((t) => t.name === params?.name);
        if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(params?.name)}`);
        const args = z.object(tool.input).safeParse(params?.arguments ?? {});
        if (!args.success) return rpcResult(id, toolResult(z.prettifyError(args.error), true));
        try {
          return rpcResult(id, toolResult(await tool.call(args.data, { threadId }), false));
        } catch (error) {
          return rpcResult(id, toolResult(error instanceof Error ? error.message : String(error), true));
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  }
}

function inputSchema(shape: z.ZodRawShape) {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(z.object(shape)) as Record<string, unknown>;
  return schema;
}

function toolResult(text: string, isError: boolean) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

function rpcResult(id: RpcRequest['id'], result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: RpcRequest['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  return true;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('Request too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
