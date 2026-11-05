import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { brotliDecompressSync, gunzipSync, inflateSync, zstdDecompressSync } from 'node:zlib';
import type { PromptMeasurement, PromptSize } from '@accio/protocol';
import type { Harness, HarnessTurn } from '../threads/harness.js';
import { systemPromptText } from './systemPrompt.js';

/** Unicode characters, rather than UTF-16 code units. This is deliberately not a tokenizer. */
export function promptSize(text: string): PromptSize {
  const characters = Array.from(text).length;
  return { characters, estimatedTokens: Math.ceil(characters / 4) };
}

function instructionText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(instructionText).join('');
  if (value && typeof value === 'object') {
    const part = value as Record<string, unknown>;
    return typeof part.text === 'string' ? part.text : '';
  }
  return '';
}

/** Harness context has explicit wrappers; arbitrary user prose stays conversation. */
function contextText(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.input) ? body.input : Array.isArray(body.messages) ? body.messages : [];
  return messages.flatMap(item => {
    if (!item || item.role !== 'user') return [];
    const parts: string[] = typeof item.content === 'string' ? [item.content] : Array.isArray(item.content) ? item.content.map(instructionText) : [];
    return parts.flatMap(text => {
      if (/^# AGENTS\.md instructions for [^\n]+\r?\n/.test(text) || /^<(environment_context|skills_instructions|permissions instructions)>/.test(text)) return [text];
      // Claude can put reminders and the user's actual message in the same content block.
      return [...text.matchAll(/<system-reminder>[\s\S]*?<\/system-reminder>/g)]
        .map(match => match[0]).filter(reminder => /# claudeMd|Contents of [^\n]*CLAUDE\.md|following skills are available/.test(reminder));
    });
  }).join('');
}

/** Count only instruction roles and exposed tool JSON; conversation and images are excluded. */
export function measurePrompt(body: Record<string, unknown>, accioText: string, additionalText = ''): PromptMeasurement {
  let instructions = [instructionText(body.system), instructionText(body.instructions),
    ...(Array.isArray(body.input) ? body.input.flatMap((item) => item && ['system', 'developer'].includes(item.role) ? [instructionText(item.content)] : []) : []),
  ].join('');
  const take = (text: string) => {
    if (!text || !instructions.includes(text)) return '';
    instructions = instructions.replace(text, '');
    return text;
  };
  const accio = take(accioText);
  const additional = take(additionalText);
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return { at: new Date().toISOString(), ...(typeof body.model === 'string' ? { model: body.model } : {}),
    harness: promptSize(instructions), accio: promptSize(accio), additional: promptSize(additional),
    context: promptSize(contextText(body)),
    tools: promptSize(tools.length ? JSON.stringify(tools) : ''), toolCount: tools.length };
}

/**
 * One listener per turn, so concurrent threads cannot share measurements. Forward
 * the original bytes and headers; decode only a temporary copy for counting.
 * The baseline uses the same boundary with no upstream at all.
 */
export async function promptCapture(upstream: string | undefined, observe: (body: Record<string, unknown>) => void) {
  const server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method === 'POST' && ['/v1/messages', '/responses', '/openai/responses'].includes(path)) {
        try {
          const encoding = req.headers['content-encoding'];
          const decoded = encoding === 'gzip' ? gunzipSync(body) : encoding === 'br' ? brotliDecompressSync(body)
            : encoding === 'deflate' ? inflateSync(body) : encoding === 'zstd' ? zstdDecompressSync(body) : body;
          const parsed = JSON.parse(decoded.toString('utf8'));
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) observe(parsed);
        } catch { /* Measurement must not change provider behavior on an unfamiliar payload. */ }
      }
      if (!upstream) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Local prompt measurement complete' } }));
        return;
      }
      const target = new URL(req.url ?? '/', upstream);
      // Codex's configured base URL includes /openai; its local URL keeps that prefix.
      const headers = { ...req.headers, host: target.host };
      const forward = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, { method: req.method, headers }, (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.once('error', () => res.destroy());
        response.once('aborted', () => res.destroy());
        response.pipe(res);
      });
      forward.on('error', () => { if (res.headersSent) res.destroy(); else res.writeHead(502).end(); });
      res.once('close', () => forward.destroy());
      forward.end(body);
    })().catch(() => { if (!res.headersSent) res.writeHead(502); res.end(); });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start prompt measurement');
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }) };
}

/** Adapters opt in only when a caller needs counts; title generation is untouched. */
export function measuredHarness(harnessId: string, harness: Harness): Harness {
  return { ...harness, async *run(run: HarnessTurn) {
    if (!run.onPromptSize) { yield* harness.run(run); return; }
    const key = harnessId === 'codex' ? 'ACCIO_OPENAI_URL' : 'ANTHROPIC_BASE_URL';
    const upstream = run.env[key];
    if (!upstream) { yield* harness.run(run); return; }
    const capture = await promptCapture(upstream, body => {
      const measurement = measurePrompt(body, systemPromptText({ harnessId, model: run.model, modelName: run.modelName }), run.resourceInstructions);
      // The harness can issue auxiliary requests (for example session naming).
      if (measurement.accio.characters) run.onPromptSize!(measurement);
    });
    try {
      const prefix = new URL(upstream).pathname.replace(/\/$/, '');
      yield* harness.run({ ...run, env: { ...run.env, [key]: capture.url + prefix } });
    } finally { await capture.close(); }
  } };
}
