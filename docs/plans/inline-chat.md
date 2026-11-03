# Inline chat: T3 Code research and Accio proposal

Status: milestone 1 implemented and verified. Research date: 2026-11-03. Interactive HTML/charts and composer uploads remain deferred.

Goal: bring T3 Code's useful inline content behavior into Accio's chat: readable tool activity, images, video/audio and file links in milestone 1, followed by interactive HTML/charts in milestone 2.

## Evidence and limits

### Implementation record

Milestone 1 now extends the existing transcript/cursor system with structured on-demand tool details, immutable local media snapshots, thread-scoped capability URLs, native players, current-file downloads and resize-aware scrolling. Storage and delivery live in `apps/server/src/threads/assets.ts` and `content.ts`; the client renderers live beside `Transcript.tsx`. Markdown destination normalization is shared with the renderer's URI normalizer so spaces, Unicode, literal percent sequences and Windows paths resolve consistently. SDK content-block envelope UUIDs preserve streamed text/tool ordering and replay identity.

Validation completed:

- `pnpm test`: 182 tests across 33 files passed.
- `pnpm typecheck`: passed.
- `pnpm build`: passed.
- `node node_modules/@playwright/test/cli.js test`: all 3 scenarios passed, exercising Chromium rendering/playback/history, scrolling/following, and the hidden Electron renderer with native downloads.

`pnpm test:chat` builds and runs the same browser/Electron suite. Fixtures use the real local server with an isolated temporary home and a deterministic fake harness; validation made no live model calls. The temporary release-age exception for the already-locked SDK versions was removed after installation; the repository's policy file is unchanged.

The comparison below is the original source audit at the pinned research revisions, before these implementation changes.

Source audit of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) at [`b7ab02e0f6077a72cadfa5c9a40db4db67bc325f`](https://github.com/pingdotgg/t3code/tree/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f), compared with Accio at `febe1b9baf4dbb4c290a3d65466c4b63b716ef8a`. These findings describe that source revision; the installed T3 app was not exercised and its exact version was not established. Upstream browser tests were read, not run.

T3 is [MIT licensed](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/LICENSE). Retain the copyright and license notice for copied code or substantial portions. Its state management, routing, styling, and orchestration dependencies make copying whole chat components expensive. Accio already shares React, `react-markdown`, and `remark-gfm`, so small helpers and rendering patterns are practical reuse targets.

## What T3 actually does

| Content | T3 mechanism | Accio today |
| --- | --- | --- |
| Assistant prose | Markdown pipeline with custom components, sanitized HTML, code blocks, tables, math and Mermaid | Markdown and GFM, ordinary code blocks and tables |
| Images | Markdown image renderer classifies remote URLs versus host files, resolves file assets, bounds dimensions, handles loading/failure, supports an expanded viewer and media actions | Ordinary remote Markdown images can render; no dedicated media renderer, host-file resolution or viewer |
| Video/audio | The Markdown image syntax is also an embed: `![Demo](/path/demo.mp4)` dispatches to a video player; audio extensions dispatch to an audio player | No dispatch by media type |
| Tool calls | Typed timeline entries with status, descriptive labels, disclosure, input/output inspectors, command output and diffs; large details fetched separately | Name + summary + running/done/error; expanded text output only |
| Tool result images | Recognizes supported image blocks, retains bounded image data server-side, serves assets, renders images in the tool inspector | Replaced with `[image]` |
| Files | Local links resolve in the thread's machine/workspace context and open the appropriate file surface | No general chat file viewer or local-file resolver |
| Interactive HTML | `html_render` publishes an HTML attachment; a validated tool result produces a distinct timeline row containing a sandboxed frame | No publishing tool, artifact item or document frame |
| MCP apps | A separate app frame and protocol; producing tool/server identity constrains the app reference | No equivalent integration |

### Media is a resolution problem as well as a UI problem

[`ChatMarkdown.tsx`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/apps/web/src/components/ChatMarkdown.tsx#L1372) dispatches image nodes by source and media type. [`markdownImages.ts`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/packages/client-runtime/src/markdownImages.ts) classifies direct URLs, workspace files and blocked sources. [`mediaPreview.ts`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/packages/shared/src/mediaPreview.ts) handles extensions, data MIME types and URL suffixes.

Filesystem paths belong to the machine running the thread. They become scoped asset URLs before reaching the browser. This also covers Windows paths; a raw `C:\...` or `file://` is not a usable cross-client media URL. [`AssetAccess.ts`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/apps/server/src/assets/AssetAccess.ts) mints and verifies grants, and [`http.ts`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/apps/server/src/http.ts#L164) supports byte ranges for playback and seeking.

[`ChatMarkdownMedia.tsx`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/apps/web/src/components/chat/ChatMarkdownMedia.tsx) provides bounded sizing, image placeholders and failures, expansion, and asset-backed variants. [`MediaVideoPlayer.tsx`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/apps/web/src/components/media/MediaVideoPlayer.tsx) defaults to no autoplay, loads metadata near the viewport, and keeps loaded/playing media stable when a URL is renewed.

### Tool details remain structured

[`V2ItemInspector.tsx`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/apps/web/src/components/chat/V2ItemInspector.tsx) fetches details when needed and selects an inspector for commands, file changes and dynamic tools. It renders tool images as assets rather than printing their base64. [`toolOutput.ts`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/packages/shared/src/toolOutput.ts) recognizes both MCP image blocks and Claude-style base64 image sources, with type/count/size bounds. Images appear in the expanded tool inspector; they are not all automatically promoted into the main reply.

[`TimelineWorkEntryRow.tsx`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/apps/web/src/components/chat/TimelineWorkEntryRow.tsx) and the group rows handle tool disclosure and presentation. The typed execution/timeline model is broader than Accio needs for its first version.

### HTML is explicitly published

The [`html_render` handler](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/apps/server/src/mcp/toolkits/html/handlers.ts) saves a document through [`HtmlRender.ts`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/apps/server/src/htmlRender/HtmlRender.ts), returning an attachment reference and sizing metadata. `html_preview` is a separate screenshot/measurement step.

[`HtmlRenderFrame.tsx`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/apps/web/src/components/chat/HtmlRenderFrame.tsx) resolves the saved document, fits its height, and offers fullscreen. [`BrowserDocumentFrame.tsx`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/apps/web/src/components/files/BrowserDocumentFrame.tsx#L171) uses an opaque-origin frame with `sandbox="allow-scripts allow-forms"`, validates message sources, and exchanges theme/height messages. The published tool's identity is checked before interpreting the output as an HTML reference. An arbitrary Markdown HTML code fence does not become a running app.

### Streaming and layout are part of the feature

T3 caches completed Markdown blocks where syntax permits and treats the unfinished tail separately. See [`markdownStreamBlocks.ts`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/apps/web/src/components/chat/markdownStreamBlocks.ts) and [`ChatMarkdown.tsx`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/apps/web/src/components/ChatMarkdown.tsx#L1722). [`useTimelineFollow.ts`](https://github.com/pingdotgg/t3code/blob/b7ab02e0f6077a72cadfa5c9a40db4db67bc325f/apps/web/src/components/chat/useTimelineFollow.ts) manages following, reading position and navigation. Preserve stable element identity so media and disclosures survive text updates. Accio should start with resize-aware following and memoized renderers; adopt more caching or virtualization only if measurements justify it.

## Accio's constraints

- [`Transcript.tsx`](../../apps/web/src/threads/Transcript.tsx) is a small switch over transcript item kinds. This is a good extension point.
- [`threads.ts`](../../packages/protocol/src/threads.ts#L35) has text-only user/assistant entries and tool entries containing a summary and optional string output. No asset reference or structured result type exists.
- [`transcript.ts`](../../apps/server/src/threads/transcript.ts#L92) discards tool input after summarizing it, flattens result blocks, and permanently caps output at 4,000 characters. Stream handling creates text entries only; tool rows arrive with completed assistant messages. Thinking and child-agent content are omitted.
- [`transport.ts`](../../apps/server/src/rpc/transport.ts) serves the static UI and authenticates WebSocket upgrades. It has no media endpoint or HTTP asset authorization. Adding an `<img>` component cannot fix this.
- [`observeTranscript.ts`](../../apps/web/src/threads/observeTranscript.ts) already handles snapshot/cursor boundaries and reconnects. Preserve those guarantees and its text delta API.
- The current scroll effect runs on React renders. An image decoding or a frame resizing can change layout without another transcript render, so richer media needs resize observation.
- Previously discarded tool input, image bytes and truncated output cannot be reconstructed from Accio's saved transcript alone.

## Proposed architecture

Keep the existing timeline and storage architecture. Add small capabilities within the thread slice:

1. **Structured tool details.** Store input and ordered result parts before generating the compact transcript view. A conceptual result union is text, image, video, audio, file, and unsupported-content fallback. Media parts contain asset IDs and MIME/name/dimension metadata, never base64 in routine transcript events. Preserve the provider's content ordering.
2. **Separate detail and asset storage.** Store complete tool details and media under the owning thread on its machine. Fetch large details on disclosure with a thread/item-scoped RPC. Keep previews small, with an explicit truncation indicator and a retained full result up to documented limits. Oversized results get an explicit limit/fallback rather than silent loss.
3. **Scoped media delivery.** Mint an exact-asset URL through authenticated RPC, then stream it over HTTP with MIME headers, GET/HEAD and byte ranges. Derive ownership from the thread and check it on every resolution. Do not put the general machine token in image URLs or expose an unrestricted `?path=` file server. Generated media outside the checkout must be explicitly imported as a thread asset.
4. **Focused UI components.** Extract `AssistantMarkdown`, `ToolCallRow`, `ToolDetails`, `InlineMedia`, `ImageViewer`, and `FileLink`. Pass the owning thread's context to resolvers. Keep generic tools usable with a JSON/text inspector, then add tailored command and file-change presentations where data supports them.
5. **Stable updates.** Keep item IDs and text deltas. Add tool detail revisions when required so expanded views can refresh without reordering or duplicate rows. Handle tool-use block starts/argument completion if supported by the SDK; incomplete JSON gets a pending presentation. Represent interruption separately from failure.

Use the same source resolver and media components for assistant Markdown and structured tool results. Keep the existing `assistant.text` representation for Markdown; a universal message-parts rewrite is unnecessary for the initial scope. Read old tool `output` strings as a legacy fallback. This is an extension of Accio's JSON files and event stream, not an adoption of T3's database or orchestration system.

**Confirmed media history:** retain embedded generated/local images, video and audio as immutable thread assets. Capture bytes server-side during ingestion, including references in completed assistant Markdown, so editing/deleting the source or opening the thread for the first time later does not change its media. Bind each Markdown embed to its saved asset while preserving the authored text for copying; do not rely on a client first-view fetch to create history. While capture is pending, show a loading state. Missing, unsupported or oversized sources produce an explicit fallback instead of an unrecorded live-file embed. Ordinary file links continue to open the current file and can become unavailable when that file disappears. Remote URLs retain their normal external-source behavior; durable capture of remote URLs is not implied by the local snapshot choice.

## Implementation map

The exact names of new modules can follow the implementation; these are the ownership boundaries and expected changes.

| Area | Files / boundary | Change |
| --- | --- | --- |
| Protocol | `packages/protocol/src/threads.ts` | Add structured detail/result and asset-reference types, optional Markdown media bindings, scoped detail/asset RPCs and an interrupted tool status; preserve text delta events and legacy output reads |
| Harness ingestion | `apps/server/src/threads/harness.ts`, `transcript.ts` | Recognize supported content, retain inputs and ordered results, map tool starts/completion, and surface unsupported content explicitly |
| Thread lifecycle | `apps/server/src/threads/threads.ts` plus thread detail/asset modules | Persist details and snapshot bytes before publishing durable references, coordinate pending capture, preserve observation cursors, and remove owned assets when deleting a thread |
| Markdown resolution | Shared parsing/resolution helpers used by ingestion and the web client | Resolve paths against the owning thread's checkout; bind completed local embeds to saved assets without interpreting incomplete streamed links as files |
| HTTP delivery | `apps/server/src/rpc/transport.ts` plus asset handler | Verify exact-resource grants; implement MIME-aware GET/HEAD and byte ranges without routing missing assets to the SPA fallback |
| Chat rendering | `apps/web/src/threads/Transcript.tsx` plus focused Markdown, tool and media components | Render the confirmed disclosure behavior, fetch full detail on expand, share media rendering between tool parts and Markdown, and keep legacy entries readable |
| Layout | Transcript scrolling and `apps/web/src/threads/threads.css` | Bound media dimensions, observe content resizing, preserve reading position and playback, and expose jump-to-latest |
| Verification | Existing transcript/observation tests plus focused asset and browser/Electron coverage | Exercise replay, persistence, access, snapshots, disclosure, media controls and scroll behavior |

Keep composer and harness prompt input text-only in milestone 1. The agent-facing HTML publisher and frame are milestone 2 changes.

## Proposed delivery order

Confirmed split: milestone 1 comprises stages 1 and 2 below (richer tools, inline images, video/audio and file links). Milestone 2 is stage 3 (interactive HTML/charts and its publishing tool). The user subsequently authorized implementing milestone 1.

### 1. Retain tool detail and build the media foundation

Change the protocol and reducer, add detail/asset storage and scoped delivery, retain compatibility with old transcripts, and preserve reconnect behavior. Render one tool result containing text plus an image through the whole path. This establishes a usable vertical slice before expanding the UI.

### 2. Complete the first user-visible media/tool experience

- Quiet tool rows with descriptive labels, visible active status, full input/output and generic fallbacks. Successful calls stay collapsed by default; failures expand automatically. Tool-result images remain inside those details unless the assistant explicitly embeds them in its reply. Preserve a reader's manual disclosure choice across subsequent updates.
- Inline remote and machine-file images with bounded size, loading/failure states, expand/close, and download/open actions.
- Native video/audio controls, no autoplay, lazy loading and working seeking. Preserve playback during transcript updates.
- File links with a useful open/download target. A broad PDF/Office/code preview suite can be added separately.
- Resize-aware following, preserved reading position, and a jump-to-latest action.
- Highlighted code with Copy is a useful adjacent improvement. Mermaid, math and richer diff presentation can follow according to priority.

### 3. Publish interactive HTML

Add a thread-scoped publishing capability for the Claude Agent SDK, likely a small SDK MCP server exposing an Accio render tool. Register it in [`claudeCode.ts`](../../apps/server/src/threads/claudeCode.ts), document its arguments for the agent, save HTML as a thread asset, and return a typed reference. Treat SDK support and lifecycle wiring as an implementation check.

Recognize references only from that registered publisher, add a distinct artifact timeline item, and render a sandboxed frame with narrow theme/height messaging, source validation, bounded resizing, link handling and fullscreen. Keep app credentials and privileged desktop APIs outside the frame. A headless preview/measurement tool can follow if fixed initial sizing plus live height reporting is insufficient.

### 4. Expand inputs and integrations as desired

Composer paste/drop/upload is explicitly deferred from milestone 1. It requires its own upload transport, prompt content blocks, attachment-only send validation, and retry/resume retention. The current composer and harness prompt are strings. MCP apps additionally need an app protocol and a controlled host bridge. Reasoning, plans and nested agent activity need their own transcript mapping. These additional integrations remain uncommitted scope and can use the foundation above.

## How we will know it works

Use a deterministic harness fixture with interleaved text, tool starts, input, text/image/text results, long output, a failed tool and interruption. Add media fixtures with known image dimensions and browser-playable video/audio; assert behavior in both the web client and Electron.

| Check | Observable result |
| --- | --- |
| Tool ingestion/replay | Input and supported results survive save/reload; content order and IDs remain stable; a repeated final message does not duplicate items |
| Legacy data | Existing transcript JSON still loads, with its original text output |
| Long output | Compact transcript stays bounded; expanded details expose retained output and explicit limits |
| Image rendering | Remote, checkout-relative, absolute Windows and imported tool images load through their intended path; missing/unsupported images show a fallback |
| Local media history | Emit local image/video/audio embeds, edit or delete their source files before the first client view, restart Accio, then observe the same saved bytes; ordinary file links still target current files |
| Tool disclosure | Success starts collapsed; failure opens automatically; active status remains visible; result images appear inside details, while explicit assistant embeds appear in the reply; reader disclosure choices survive updates |
| Access boundaries | Missing/expired grants and mismatched thread ownership fail; traversal and symlink escapes cannot expose arbitrary files; HTML/script content cannot masquerade as a raster tool image |
| Video/audio | Play, pause and seek work; range requests return valid 206/416 responses; later text updates do not restart playback |
| Scrolling | Late media loading follows while pinned; scrolling up holds the reading position; jump-to-latest restores following |
| Reconnect/restart | Expanded tool content and durable assets remain available; observing during a turn loses and duplicates no entries |
| HTML milestone | Interaction works inside the frame, survives restart, resizes within bounds, follows theme changes, and cannot access parent storage or Accio's privileged bridge |

Run `pnpm test`, `pnpm typecheck`, and `pnpm build` after implementation, plus focused browser/Electron checks for media playback, layout and frame behavior. Add repeatable browser coverage for those high-risk behaviors; there is currently no committed browser-test harness in Accio.

## Confirmed decisions

1. **Current work:** research and planning completed first; the user then authorized implementing milestone 1.
2. **Milestone 1:** richer tool rows, inline images, video/audio and file links.
3. **Milestone 2:** interactive HTML/charts, including an agent-facing publishing tool.
4. **Media history:** save snapshots of embedded local images/video/audio, so edits and deletion do not alter old messages. Ordinary file links open the current file.
5. **Disclosure:** successful calls stay collapsed, active status stays visible, failures expand automatically, and tool-result images appear inside details unless the assistant embeds them in its reply.
6. **Input scope:** composer paste/drop/upload is scheduled separately from milestone 1.

## Completion and boundaries

Milestone 1 is done when its checks above pass in the web client and Electron, the existing tests/typecheck/build pass, old transcripts still load, and locally embedded media remains unchanged after source deletion and restart. Milestone 2 adds the HTML-specific checks.

The research/planning task is complete with this source-linked report, the confirmed product decisions, the implementation map and the checkable acceptance criteria. The user's later instruction authorizes implementing milestone 1. Exact limits, schemas and module names can be settled during coding without changing the confirmed behavior.

Deferred from milestone 1 by the user: interactive HTML/charts and composer paste/drop/upload. Other optional integrations have no committed milestone. There are no unanswered product questions at this plan's level; implementation details above are proposals, not additional user confirmations.
