---
name: smooth-ui
description: "Smooth a UI transition that jumps, flashes or arrives in pieces: record it, read it frame by frame, then make elements glide, fade or stay put. Use when a user action makes the screen stutter, pop or flicker."
---

# Smooth a UI transition

A jump is any frame where something the user is watching appears, vanishes, moves or resizes without motion. The goal is **one gesture**: everything that changes for a single action changes together, elements that persist across the change visibly travel to their new place, and nothing blinks out between two states. Instant feedback stays instant; motion only carries it.

Work from evidence: record before, change, record after, compare. A transition judged from code or a final screenshot is unverified.

## 1. Record the jump

Drive the real UI against an isolated server. For Accio use the chat fixture (`node --import tsx scripts/chat-test-server.ts` with `ACCIO_CHAT_TEST_PORT` set, token `isolated-chat-test-token`) or a [3-verify](../3-verify/SKILL.md) run; never the user's instance. If the fixture answers faster than the real backend, add a paced fixture (see `Naming fixture: slow` in `scripts/chat-test-server.ts`): a 100ms fake hides the intermediate states users actually see.

Write a journey module exporting `setup(page)` (reach the state before the action) and `trigger(page)` (the single action), then:

```powershell
pnpm --filter @accio/web build
node .agents/skills/smooth-ui/scripts/record.mjs "http://127.0.0.1:<port>/#token=isolated-chat-test-token" out/smooth-journey.mjs before
node .agents/skills/smooth-ui/scripts/changes.mjs out/smooth/before "spin|elapsed|typing"
```

`record.mjs` saves a video, before/after screenshots and `changes.json`: every element's box and opacity sampled each animation frame. The sampler is heavy, so its frame spacing is not a smoothness measure; the video is. Extract a contact sheet around the action to see pixels, including view-transition pseudo-elements the DOM log cannot see:

```powershell
ffmpeg -ss <s> -t 0.9 -i out/smooth/before/<video>.webm -vf "fps=25,crop=<w>:<h>:<x>:<y>,scale=500:-1,tile=4x5:padding=4:color=red" -frames:v 1 out/smooth/before/sheet.png
```

Find the action's start with `ffmpeg -i <video> -vf "select='gt(scene,0.003)',metadata=print:file=-" -f null -`.

**Done when** you have a timeline table: milliseconds after the action, what changed, and why it reads as a jump. Show it to the user before changing code.

## 2. Diagnose each jump

Classify every row; each class has its own cure:

| Jump | Typical cause | Cure |
|---|---|---|
| **Teleport**: the same thing vanishes here and reappears there | Two components render the one visual element, or a container is unmounted | Keep one element mounted and move it, or give both the same `view-transition-name` |
| **Flash**: a blank or empty frame between states | New view mounts before its async data | Seed the new view with what the old one already showed until data arrives |
| **Stagger**: parts of one control arrive frames apart | Remount refetches (lists, models, limits) | Cache the last result module-wide and render it at once; refresh behind it |
| **Pop**: an element or section appears at full size in one frame | Plain conditional render | `@keyframes` or `@starting-style` entry: fade plus a short rise, or height from 0 with `interpolate-size: allow-keywords` |
| **Snap**: a property flips (opacity, colour) | No transition on that property | `transition` on just that property |
| **Restyle**: a placeholder is replaced by a differently styled final element | Placeholder invented its own look | Build the placeholder from the final element's markup and classes so only words change |

Fix structure (teleports, flashes, staggers, restyles) before adding motion; motion on top of a structural jump only animates the jump.

## 3. Choreograph

- **Persisting elements travel.** Use the View Transitions API through `apps/web/src/ui/viewTransition.ts`: `viewTransition('<type>', () => setState(...))` runs the update with `flushSync`, scopes CSS through `:active-view-transition-type(<type>)`, queues a second transition until the first lands (starting one cuts the other short), and applies instantly without the API or under reduced motion. Name the persisting element (`view-transition-name`, unique per document) in both states.
- **Leaving elements go first, arriving ones follow.** Fade departures fast (about 150ms, slight lift); delay arrivals 40–200ms in reading order: the thing the user caused first, status after.
- **Opaque boxes cover rather than crossfade.** The default image-pair blend sums opacities; custom timings on both halves dip mid-move. For an opaque surface set `mix-blend-mode: normal`, leave the old snapshot static and fade the new one in over it.
- **Steps that differ only in words stay put** and swap quickly (about 120ms root crossfade).
- Use the shared motion vocabulary in `apps/web/src/ui/motion.css`: `--ease-settle`, no overshoot, groups around 300–400ms, fades 120–200ms.
- Every new animation gets a `prefers-reduced-motion: reduce` path that keeps fades and drops travel.

## 4. Verify

Record `after` with the same journey and compare the timelines and contact sheets row by row. Each jump from step 1 is gone or deliberately kept, and no new one appeared (a doubled ghost during a crossfade, a dimmed box, an arrival before its cause). Make a half-speed before/after clip for the user:

```powershell
ffmpeg -ss <s> -t 1.6 -i <before.webm> -ss <s> -t 1.6 -i <after.webm> -filter_complex "[0:v]setpts=2*PTS,scale=960:-2[a];[1:v]setpts=2*PTS,scale=960:-2[b];[a][b]vstack" -r 30 -pix_fmt yuv420p out/smooth/compare-half-speed.mp4
```

Then run the browser tests covering the changed flow (`pnpm test:chat` for threads) and `pnpm typecheck`. Tests asserting an element is hidden during a transition may need to assert the new still-mounted state instead. Compare any failure against an untouched checkout before attributing it.

**Done when** the after-timeline has no unplanned jump, tests match the baseline, and the user has the clip and the app running to try it.
