# UI / UX audit

Independent auditors (Claude Sonnet 5.5, Claude Opus 5.5, GPT 6.1 Sol) score Accio's web UI once per round. Between rounds the outer loop applies changes on the `ui_analysis` branch. The loop stops when every auditor scores every category 9 or higher.

## Categories

Score each 1-10. 10 means "nothing left to improve for a personal, focused coding tool". 9 means "only nitpicks". Below 7 means a user notices the problem in normal use.

| # | Category | What to look at |
|---|----------|-----------------|
| 1 | Minimalism / calmness | Nothing on screen that does not earn its place. Quiet colors, no glows, no competing accents, no redundant chips, labels or helper text. The app recedes behind the work. |
| 2 | Visual hierarchy & typography | Primary content reads first. Clear size/weight/color steps. Readable line length, measure and rhythm in the transcript and settings. |
| 3 | Consistency | Same spacing scale, radii, icon style, control sizes and wording across sidebar, thread pane, settings, sheets and menus. Terms match `GLOSSARY.md`. |
| 4 | Clarity & discoverability | A new user understands each view without a manual. Icon-only controls have obvious meaning or tooltips. Empty states explain the next step. |
| 5 | Feedback & state | Running, interrupted, failed, queued, settled and shipping states are unmistakable but calm. Loading, saving and errors are acknowledged where they happen. |
| 6 | Efficiency & flow | Few steps to start a thread, switch model, send, stop, find a thread. Sensible defaults. Keyboard works where expected (Enter, Escape, arrows, shortcuts). |
| 7 | Accessibility | Contrast, focus rings, keyboard reachability of menus and dialogs, ARIA names, hit target sizes. |
| 8 | Layout robustness | Narrow windows (900 px), tall and short windows, long titles, long transcripts, wide code and tool output. No overflow, clipping or jumping. |
| 9 | Forms & dialogs | Sheets and menus open and close predictably (Escape, outside click, Cancel). Validation is inline and specific. Destructive actions are confirmed without nagging. |

## What to test

Everything a user can reach. At minimum:

- First-run onboarding (profile, account gate, project) via the verify runner.
- Sidebar: thread rows, hover actions, right-click menu, Search, Filter, New thread picker, shelves (Working / Snoozed / Settled), footer buttons.
- Thread pane: transcript with text, tool calls (collapsed / expanded, failed), inline images, video, audio, file links, missing media, the Choice fixture, streaming (`stream update`), long context (`long context`), tool exploration (`explore tools`), steering and queue tray (`Steering fixture`, then Ctrl+Enter), Stop / Resume.
- Composer: model picker, effort control, Limits, Send / Queue, placeholder states, settled-thread Reopen / Archive.
- Delivery: Ship, Shipping options, Prepare for review, progress and completion (`Build delivery fixture`, `Build review fixture`, `Build CI progress fixture` in the delivery / review / ci-progress projects).
- Side panel (skills panel on the Skills fixture thread).
- Settings: every section (Profiles, Accounts, Limits, Machines, Hubs, Projects, Secrets, Tools, MCP servers, Skills, System prompt), add / edit / cancel / delete flows, breadcrumbs, Back.
- Dialogs: Add project sheet, project settings, delete confirmations, model picker, context menus.
- Window sizes: 1280x900, 1600x1000, 900x700.

## How to launch

The workspace is already built (`apps/web/dist` exists). Two isolated environments are available. Never touch the user's real `~/.accio`.

### A. Populated app (signed-in profile, projects, threads, fake harness)

```sh
ACCIO_CHAT_TEST_PORT=<your port> node --import tsx scripts/chat-test-server.ts
```

Wait for `Chat fixture ready: http://127.0.0.1:<port>`. Open `http://127.0.0.1:<port>/#token=isolated-chat-test-token` with Playwright (`import { chromium } from 'playwright'`). The home is a temp dir. Prompts the fake harness answers are listed at the top of `scripts/chat-test-server.ts`; any other prompt returns the media/tools fixture. Existing threads: `Inline chat fixture`, `Choice fixture`, `Skills fixture`. Projects: `delivery-project`, `review-project`, `ci-progress-project`, `skills-project`. Stop the server when done by killing the PID that listens on your port, nothing else.

### B. Fresh first-run (empty home, onboarding)

Write a journey module and run it with the 3-verify runner:

```sh
node .agents/skills/3-verify/scripts/verify.mjs out/ui-audit/<round>/<model>/journey.mjs
```

The journey's default export receives `{ page, capture, action, fixture, home }`. See `.agents/skills/3-verify/scripts/smoke.mjs` and `.agents/skills/3-verify/features/*.md` for selectors. The runner tears its own server down.

## What to produce

- Screenshots: `out/ui-audit/<round>/<model>/NN-<view>.png` (PNG, numbered in the order visited; include every view, dialog and window size you looked at).
- Report: `docs/ui-audit/<round>/<model>.md` with:
  1. A score table: category, score, one-line verdict.
  2. Per category: concrete findings, each with the screenshot filename and the smallest change that would fix it. Order by impact.
  3. "Top 5 changes" that would raise the lowest scores most.
  4. Anything that was unreachable and why.

Do not edit application code. Judge what is on screen, not what the code intends.
