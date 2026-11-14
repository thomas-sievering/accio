import type { IncomingMessage } from 'node:http';

/** The largest body the management API reads: its JSON is small. */
export const MAX_MANAGEMENT_BODY = 1024 * 1024;

/**
 * The largest model request body the Sorting Hat forwards: Anthropic's own
 * limit for the Messages API, room for threads that carry many images.
 */
export const MAX_MODEL_BODY = 32 * 1024 * 1024;

/**
 * A request's whole body, or null once it is longer than `max`. The rest is
 * then read and dropped, not held, so the caller still receives the refusal
 * rather than a reset connection; the server's request timeout bounds it.
 */
export function readBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  const refuse = () => { req.resume(); return null; };
  if (Number(req.headers['content-length']) > max) return Promise.resolve(refuse());
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const stop = () => { req.off('data', data); req.off('end', end); req.off('error', reject); };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size <= max) return void chunks.push(chunk);
      stop();
      chunks.length = 0;
      resolve(refuse());
    };
    const end = () => { stop(); resolve(Buffer.concat(chunks)); };
    req.on('data', data).on('end', end).on('error', reject);
  });
}
