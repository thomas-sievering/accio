# Inline chat: remaining work

Milestone 1 (structured tool details, immutable local media snapshots, scoped media URLs, native players, current-file downloads, resize-aware scrolling) has shipped. Its behavior is described in the README; `tests/inline-chat.spec.ts` covers it in Chromium and Electron. Storage and delivery live in `apps/server/src/threads/assets.ts` and `content.ts`; renderers live beside `apps/web/src/threads/Transcript.tsx`.

## Milestone 2: interactive HTML and charts

Confirmed scope: an agent-facing publishing tool plus a sandboxed frame in the transcript.

- Publish through an Accio tool on the machine's MCP server (ADR 0011). Save the HTML as a thread asset and return a typed reference. Only results from that registered tool become an artifact item; an HTML code fence in Markdown never runs.
- Render a distinct artifact timeline item in an opaque-origin frame (`sandbox="allow-scripts allow-forms"`), with source-validated theme/height messages, bounded resizing, link handling and fullscreen. App credentials and the desktop bridge stay outside the frame.
- A headless preview/measurement tool can follow if fixed initial sizing plus live height reporting is insufficient.
- Done when interaction works inside the frame, survives restart, resizes within bounds, follows theme changes, and cannot reach parent storage or Accio's privileged bridge, in both the web client and Electron.

Reference implementation (T3 Code, MIT, at [`b7ab02e`](https://github.com/pingdotgg/t3code/tree/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f)): [`html_render` handler](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/apps/server/src/mcp/toolkits/html/handlers.ts), [`HtmlRender.ts`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/apps/server/src/htmlRender/HtmlRender.ts), [`HtmlRenderFrame.tsx`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/apps/web/src/components/chat/HtmlRenderFrame.tsx), [`BrowserDocumentFrame.tsx`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/apps/web/src/components/files/BrowserDocumentFrame.tsx#L171). Retain T3's copyright and license notice for copied code. Its state, routing and orchestration dependencies make copying whole components expensive; reuse small helpers and patterns.

## Later, uncommitted

- Composer paste/drop/upload: needs its own upload transport, prompt content blocks, attachment-only send validation and retry/resume retention. Composer and harness prompts are text-only today.
- MCP apps need an app protocol and a controlled host bridge.
- Reasoning, plans and nested-agent activity need their own transcript mapping.
- Highlighted code with Copy, Mermaid, math and richer diffs, by priority. Add Markdown block caching or virtualization only if measurements justify it.
