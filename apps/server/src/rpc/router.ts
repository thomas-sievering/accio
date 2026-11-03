import {
  methods,
  RequestEnvelope,
  type MethodName,
  type ResultOf,
  type ResponseEnvelope,
  type Events,
  type EventName,
} from '@accio/protocol';
import type { z } from 'zod';

type Handler<M extends MethodName> = (params: z.output<(typeof methods)[M]['params']>) => ResultOf<M> | Promise<ResultOf<M>>;

/** Error whose message is safe to show to the user. */
export class UserError extends Error {}

/** Dispatches validated requests to the handlers each domain slice registers. */
export class Router {
  private handlers = new Map<string, Handler<any>>();

  on<M extends MethodName>(name: M, handler: Handler<M>): this {
    this.handlers.set(name, handler);
    return this;
  }

  async handle(raw: unknown): Promise<ResponseEnvelope | undefined> {
    const parsed = RequestEnvelope.safeParse(raw);
    if (!parsed.success) return undefined;
    const { id, method } = parsed.data;
    const fail = (error: string): ResponseEnvelope => ({ type: 'response', id, ok: false, error });
    const def = (methods as Record<string, { params: z.ZodType }>)[method];
    const handler = this.handlers.get(method);
    if (!def || !handler) return fail(`Unknown method ${method}`);
    const params = def.params.safeParse(parsed.data.params ?? {});
    if (!params.success) return fail(`Invalid params for ${method}: ${params.error.message}`);
    try {
      return { type: 'response', id, ok: true, result: (await handler(params.data as never)) ?? null };
    } catch (err) {
      if (err instanceof UserError) return fail(err.message);
      console.error(`[rpc] ${method} failed`, err);
      return fail(err instanceof Error ? err.message : String(err));
    }
  }
}

export type Broadcast = <E extends EventName>(event: E, data: Events[E]) => void;
