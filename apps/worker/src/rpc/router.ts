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
  /** Answers a validated call elsewhere, such as on the machine that owns its thread; undefined handles it here. */
  forward?: (method: string, params: unknown) => Promise<unknown> | undefined;
  constructor(private fallback?: Router) {}

  on<M extends MethodName>(name: M, handler: Handler<M>): this {
    this.handlers.set(name, handler);
    return this;
  }

  /** `local` skips forwarding: the call arrived from another machine and is about this one's work. */
  async handle(raw: unknown, { local = false } = {}): Promise<ResponseEnvelope | undefined> {
    const parsed = RequestEnvelope.safeParse(raw);
    if (!parsed.success) return undefined;
    const { id, method } = parsed.data;
    const fail = (error: string): ResponseEnvelope => ({ type: 'response', id, ok: false, error });
    const def = (methods as Record<string, { params: z.ZodType }>)[method];
    const handler = this.handlers.get(method);
    if (!handler && this.fallback) return this.fallback.handle(raw);
    if (!def || !handler) return fail(`Unknown method ${method}`);
    const params = def.params.safeParse(parsed.data.params ?? {});
    const privateInput = method === 'secretRequests.answer' || method.startsWith('secrets.');
    if (!params.success) return fail(privateInput ? 'Invalid secret request. Check the fields and try again.' : `Invalid params for ${method}: ${params.error.message}`);
    try {
      const forwarded = local ? undefined : this.forward?.(method, params.data);
      return { type: 'response', id, ok: true, result: (await (forwarded ?? handler(params.data as never))) ?? null };
    } catch (err) {
      if (err instanceof UserError) return fail(err.message);
      if (privateInput) return fail('Could not save or deliver the secret. Try again.');
      console.error(`[rpc] ${method} failed`, err);
      return fail(err instanceof Error ? err.message : String(err));
    }
  }
}

export type Broadcast = <E extends EventName>(event: E, data: Events[E]) => void;
