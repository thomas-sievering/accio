# Composer images

Status: slice 1 implemented, 2026-11-05 (`apps/worker/src/threads/uploads.ts`, `apps/web/src/threads/pastedImage.ts`, `MessageImages.tsx`; tests in `images.test.ts` and `tests/images.spec.ts`). It covers paste into new and existing threads, steering, queueing, retry and the model check, on both harnesses. Slices 2 to 4 remain. Replaces the "Composer paste/drop/upload" entry in [inline-chat.md](inline-chat.md).

## Problem

You can't show an agent a screenshot. The composer is a textarea. `threads.send` and `threads.start` carry only text and a choice pick. `HarnessTurn.prompt` is a string. Both harnesses already accept images: the Claude Agent SDK takes `image` content blocks, and Codex's `turn/start` and `turn/steer` take image input items.

## What already exists

- `ThreadAssets` (`apps/worker/src/threads/assets.ts`) is a per-thread, immutable asset store. It checks MIME types by sniffing bytes, enforces a 10 MiB image limit, and grants short-lived `/thread-assets/<token>` URLs over RPC. Assistant and tool media already use it, and pasted images should go into the same store.
- `InlineMedia` renders a `ThreadAsset` from `threads.assetUrl`.
- The composer has a chip row (`composer-chips`) for picked choices.

## Reference: T3 Code

T3 Code is MIT-licensed; its paths are at `github.com/pingdotgg/t3code`. Retain the notice for any code we copy.

- **Intake.** Paste (`clipboardData.items` of kind `file`), drop, and a file input all feed one `addComposerAttachments`. Validation is synchronous and reserves slots before any await, so concurrent pastes respect the count limit. See `apps/web/src/components/chat/useComposerAttachmentIntake.ts`.
- **Compression in the client.** Images are fitted to a 2000px long edge, then re-encoded at falling quality until they fit the byte limit. HEIC is converted to JPEG. See `apps/web/src/lib/imageCompression.ts`.
- **Upload before send.**
  - An RPC returns a signed, 10-minute upload URL. The client POSTs the raw bytes with XHR progress as soon as the image is added.
  - The send carries metadata only: `{ type: 'image', id, name, mimeType, sizeBytes }`.
  - Pending uploads are claimed into the thread when the turn is accepted. Stale ones are swept after 24h.
  - See `apps/server/src/assets/AttachmentUpload.ts` and `AttachmentClaims`.
- **Delivery.**
  - Claude gets base64 `image` blocks *before* the text block, because skill expansion needs the text last.
  - Codex gets `{ type: 'image', url: 'data:…' }` for both start and steer.
  - Both also get `[Attached image "x.png" is saved at: <path>]` in the text, so the agent can open the file with its tools.
- **Transcript.** User messages show thumbnails through signed URLs, and an optimistic message uses the blob URL until the server echo arrives. Clicking a thumbnail opens a lightbox.
- **Edge cases.**
  - Image-only messages are allowed.
  - A failed upload blocks send until it is retried or removed.
  - Drafts keep their images, serialised as data URLs in localStorage.

## Decision

Paste and send images to any thread, on both harnesses, local or remote. They are stored as thread assets and shown as thumbnails in the message.

- **Contract.**
  - Add `images?: ImageRef[]` to `Send`, to both `Start` variants, and to `QueuedMessage`. An `ImageRef` is `{ uploadId }` when sent and becomes a `ThreadAsset` once claimed.
  - The user `TranscriptItem` gets `images?: ThreadAsset[]`.
  - Relax the refine so that text, a pick, or at least one image is enough. `Start` loses `text.min(1)` on the same terms.
- **Limits.** At most 10 images per message, and only PNG, JPEG, GIF and WebP.
  - Claude rejects images over 5 MB base64 (about 3.75 MB raw) and downscales anything past roughly 1568px anyway.
  - So the client fits each image to a 2000px long edge and re-encodes it under 3.5 MB, as T3 does. The worker re-checks both.
- **Upload to the client's own worker.**
  - `threads.upload({ name, mimeType, data })` takes base64 bytes over the client's existing RPC socket and returns `{ uploadId }`.
  - The client already talks only to its own worker, and images are under 3.5 MB once shrunk, so a separate HTTP upload with progress was not worth its grants. Revisit this if progress or large files matter.
  - The worker checks the type against the bytes, keeps pending uploads in `<home>/uploads/` and sweeps them after 24h.
- **Claim on send.**
  - When the owning worker accepts `send` or `start`, it imports each upload with `ThreadAssets.importMedia` and records the assets on the user item. A new thread claims its uploads as its first turn starts. Uploads are deleted only after the send succeeds, so a refused send can be repeated.
  - Retry reads the images from that item. Queued messages are claimed when queued and hold the thread's assets.
  - `ThreadAssets.harnessFile` copies an asset to `<id>.<ext>` beside its `.bin`, so harnesses and their file tools see a typed file.
- **Remote threads (relay).**
  - The bytes sit on the client's worker, but the thread lives on another machine.
  - Before forwarding a `send` or `start`, the viewing worker streams each upload to the owner as `threads.uploadChunk` frames under `RELAY_FRAME_BYTES` (1 MiB), then forwards the call with the owner's upload ids.
  - The hub stays a dumb forwarder.
- **Harness input.**
  - `HarnessTurn` gets `images?: { path, mimeType }[]`, and the steer callback becomes `(text, images?)`.
  - Claude Code sends `message.content` as image blocks first and the text last; `SteeringInput` builds the same content.
  - Codex sends `{ type: 'localImage', path }`, a native app-server item that avoids base64 in JSON-RPC, for both `turn/start` and `turn/steer`.
  - Both append the saved path to the text, like T3, so shell tools can open the file.
  - Handoffs (ADR 0017) mention images by path in the handoff context.
- **Model check.** `HarnessModel` gets `imageTypes: string[]`, the image MIME types the model reads; empty means none.
  - Codex: from `model/list` `inputModalities`. If it includes `"image"`, the model reads PNG, JPEG, GIF and WebP. The hub stores it on `CodexModel`; models stored before this have no value and count as accepting images until the list refreshes.
  - Claude Code: `supportedModels()` reports no input types, and every current Claude model reads PNG, JPEG, GIF and WebP, so the catalog sets those four.
  - Composer: a paste the thread's model can't read is refused with the composer error ("GPT-x can't read images"). Switching to such a model with images pending disables send with the same error. The worker checks again on send and start.
  - A handoff (ADR 0017) to a model without image input passes the images as paths only.
- **Composer UI.** See the "Minimal UI" preference: one control per idea and no helper text. Preview the options before building.
  - Paste only: no drop and no attach button. A 56px thumbnail goes in the existing chip row, with an × on hover, dimmed while it uploads. Send waits until every image is uploaded.
  - A failed upload drops its thumbnail and shows why in the composer error line.
  - Slice 2: images also live in sessionStorage per draft, just as the text does, but only once they're uploaded (the upload id plus a small thumbnail data URL).
- **Transcript UI.** The user message shows a row of thumbnails above the text. Clicking one opens it full size in the existing `ImageViewer`.
- **Remote threads.** Until slice 3, a message with images to a thread on another machine is refused with "Images can't be sent to threads on <machine> yet."
- **Handoff.** Not yet: the handoff context carries a message's text only.

## Slices

Each slice can be tried with `pnpm try`.

1. **Paste into a local thread.**
   - Covers the upload endpoint, the pending store, the claim on `threads.send`, both harnesses including steer, the model check, and thumbnails in the composer and the transcript.
   - Done when a pasted screenshot is described correctly by Claude and by Codex, both as a new turn and mid-turn, and it survives a restart.
2. **Drafts that survive a reload.** Keeps pasted images in a draft across reloads. Starting from a draft, the queue and retry already shipped in slice 1.
3. **Remote threads.** Adds chunked forwarding over the relay, with a two-machine check following `3-verify/features/hubs.md`.
4. **Polish.** Adds HEIC conversion, which needs a decoder because Chromium can't read HEIC, and image paths in the handoff context.

## Tests

- `assets.test.ts`-style unit tests for upload grants: single use, expiry, size mismatch, MIME spoofing, and the sweep.
- Contract tests for the relaxed send validation.
- Harness tests asserting the Claude content order and the Codex `localImage` items.
- A `tests/` Playwright spec that pastes a fixture PNG through `ClipboardEvent` against the chat test server and checks the chip, the thumbnail after send, and the asset URL.

## Decided

- Paste only for now; no drop, no attach button (2026-11-05).
- Check the model accepts the image's type before it goes in the composer (2026-11-05).
