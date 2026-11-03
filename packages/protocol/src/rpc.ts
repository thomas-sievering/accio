import { z } from 'zod';

/** One request/response method: its params schema and (type-only) result. */
export type Method<P extends z.ZodType = z.ZodType, R = unknown> = {
  params: P;
  result: R;
};

export const method = <P extends z.ZodType, R>(params: P) =>
  ({ params, result: undefined as unknown as R }) satisfies Method<P, R>;

export const RequestEnvelope = z.object({
  id: z.number(),
  method: z.string(),
  params: z.unknown(),
});
export type RequestEnvelope = z.infer<typeof RequestEnvelope>;

export type ResponseEnvelope =
  | { type: 'response'; id: number; ok: true; result: unknown }
  | { type: 'response'; id: number; ok: false; error: string };

export type EventEnvelope = { type: 'event'; event: string; data: unknown };

export type ServerEnvelope = ResponseEnvelope | EventEnvelope;
