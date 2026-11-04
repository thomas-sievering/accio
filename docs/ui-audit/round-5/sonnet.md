# UI / UX audit, round 5, model `sonnet`

Built commit `31733b4` (dist as built at audit time). Method: populated fixture server on my port 47671 (`scripts/chat-test-server.ts`), driven with the project Playwright runner (Chromium, dark theme) at 1280x900, 900x700, 1600x1000 and 1280x500. First-run onboarding ran through the 3-verify runner with a custom journey (`out/ui-audit/round-5/sonnet/j/journey.mjs`, PASSED, run directory `out/verify/2026-11-04T12-54-28-632Z-fb29a982`). Scripts are in `out/ui-audit/round-5/sonnet/s/`; screenshots (169 PNG) are in `out/ui-audit/round-5/sonnet/`. I judged what is on screen. Keyboard behaviour was measured by reading `document.activeElement`, `inert` and computed styles after each key.

## Scores

| # | Category | Score | Verdict |
|---|----------|-------|---------|
| 1 | Minimalism / calmness | 9 | Quiet palette, one chip per outcome, Add tool is down to one helper line. Left: picker hint bar, "Open app" pill, Add secret's four helper paragraphs, a two-message failure stack. |
| 2 | Visual hierarchy & typography | 9 | Sidebar sublabels now 12 px, contrast 5.5:1 or better everywhere I measured. Left: the effort chip's chevron floats about 35 px from "Auto". |
| 3 | Consistency | 8 | Cancel wording and one project editor are now uniform. Left: Limits in the Settings nav leaves Settings, three different delete-confirm layouts, model chip vs effort chip, half-width Machines card on a tool page, invalid-field ring differs between onboarding and the sheet. |
| 4 | Clarity & discoverability | 8 | Choice ring, Limits entry and project shortcut now read well. Left: Esc leaves Settings silently, onboarding account step has no Back, a refused send leaves a duplicate draft, "Automatic fixes" is vague, full title only via a native tooltip. |
| 5 | Feedback & state | 8 | Working, Interrupted + Resume, paused queue, CI step, Waiting for merge, stopped fixes, Shipped, Snoozed + Undo are all calm and clear. Left: the refused-send / repair flow is messy (squashed link, stale banner, duplicate text), Working line moves from top to bottom after a steer. |
| 6 | Efficiency & flow | 9 | Ctrl+K and "/" focus search, Ctrl+N opens the picker, Enter steers, Ctrl+Enter queues, every menu has arrows/Esc/focus return, overlay Esc returns focus to the toggle. |
| 7 | Accessibility | 8 | Overlay boundary (sidebar, resizer, main) is `inert`, focus enters the panel and returns on Esc, contrast passes. Left: Choice rings 28 px and Open/Download 24 px, full title is pointer-only, the dirty-edit question is plain text (not announced as a group/alert), focus drops to `BODY` after some in-page navigation. |
| 8 | Layout robustness | 8 | No horizontal overflow at 900/1280/1600, compact profile now fits at 900x700. Left: expanded Settled shelf at 500 px tall opens half-hidden under the footer, header title truncates at 900. |
| 9 | Forms & dialogs | 9 | Onboarding sheet padding fixed, dirty-edit guard holds on every exit and never saved, one validation pattern, uniform "Cancel + Delete X" confirms. Left: focused invalid field hides its red outline, no Copy on the pairing code. |

## Round-4 findings rechecked (observed on the built UI)

| Finding | Result | Evidence |
|---|---|---|
| Dirty Settings edits: nav, Escape, Back, breadcrumb, Limits | **Fixed.** Each exit shows "Discard changes? · Keep editing · Discard"; focus lands on Keep editing; Keep returns focus to Save with the edited value intact. Escape twice returns to editing. The same guard works on the project page. | `29-dirty-nav-accounts`, `30-keep-editing`, `31-dirty-escape`, `32-dirty-back`, `33-dirty-crumb`, `34-dirty-limits`, `91-project-dirty-back` |
| Keep editing must never save | **Verified.** After Keep editing on all five exits I reloaded the page with the form still dirty; the profile list showed the unchanged name `Personal`. | `35-after-keep-reload-profiles` |
| Discard persists nothing | **Verified.** Edited to `Personal EDITED2`, nav, Discard; list and reopened editor show `Personal`. | `36-after-discard`, `37-reopened-after-discard` |
| Limits entry | **Fixed, with a consistency wrinkle.** Settings has a Limits item and the page shows the account and a Refresh. But it leaves Settings (Settings nav disappears, a close x appears), unlike every other item. | `17-settings-Limits`, `27-limits-closed`, `185-limits-page` |
| Compact profile editor | **Fixed.** At 900x700 Skills starts at y=384 and ends at y=599, above the sticky footer (y=648). | `38-900-profile-detail`, `28-profile-detail-1280` |
| Media / effort resting affordances | **Fixed.** Open/Download are bordered buttons at rest. Effort shows a chevron at rest. The Choice picks are empty rings that become a check on hover and after picking. Nit: model chip has no chevron while effort does, and the effort chevron floats away from its label. | `02-inline-thread`, `07-composer-rest`, `13-choice`, `170-choice-hover-B`, `173-choice-picked` |
| Onboarding project sheet padding | **Fixed.** Input inset 25 px, footer inset 17 px, validation text inside the sheet; works at 900x700. | `104-onb-project-sheet`, `105-onb-project-sheet-empty`, `106-onb-project-sheet-900` |
| Overlay focus boundary incl. resize separator | **Fixed.** At 900 px with the panel open `aside.sidebar`, the wrapper holding `.resizer-left`, and `.main` are all `inert`; the raw `focus()` on the separator does nothing; Tab never leaves the panel; the scrim sits over the separator and a click closes the panel; Esc closes it and returns focus to the toggle. | `40-900-sidepanel-overlay`, `41-900-after-escape`, script `g.mjs`, `jj.mjs` |
| Full title access | **Partly.** Row and header carry a native `title` with the full saved title and no ellipsis (a 144-character rename was stored at 120 characters). Generated titles are stored already cut at about 45 characters plus "…" (the complete prompt is the first message). The header shows about 120 characters at 1280 and truncates at 900. Native tooltips are pointer-only and do not render in headless screenshots, so I could verify the attribute, not the appearance. | `43-long-title-thread`, `47-long-title-renamed`, `50-900-long-title` |
| Stopped review fixes vs continued observation | **Fixed.** After "Stop automatic fixes" the line reads "Automatic fixes stopped · still tracking #123 · checked just now"; the PR chip, link and Check now remain; the sidebar still says "Review · #123". | `60-review-waiting`, `62-stopped`, `63-stopped-later` |
| Repair thread link | **Reachable and works, but the line is broken.** A deliberately failing managed tool produced "Broken tool is not ready. A repair thread was started.Open repair thread" with no space before the link. See finding 1. | `82-broken-tool`, `84-blocked-send`, `85`-style check in `x.mjs` |
| Skill label deduplication | **Fixed.** Project skill shows `Repository` once, inherited skill `Profile · Library`. | `86-skills-panel`, `87-skills-panel-inherited`, `89-skill-library` |

## Findings by category (ordered by impact)

### 5 Feedback & state / 4 Clarity
1. **Refused-send and repair flow is messy** (`84-blocked-send`). When a send is refused because a tool is broken: (a) the red line reads "...was started.Open repair thread" with no gap before the link; (b) "The last turn failed." plus Retry sits above a second, more specific error, so the failure is stated twice; (c) the refused message appears as a user bubble in the transcript and stays in the composer, so it shows twice, and refused sends persist as orphan bubbles (four stacked in the transcript after I retried, `143-explore-1`); (d) the "failed" banner remains after the cause is fixed. Smallest fixes: a flex `gap` or a leading space before the link; render only the specific error when one exists; clear the composer draft (or do not append the bubble) when the server refuses before a turn starts.
2. **Working line position** (`68-steer-working` vs `69-steered`, `70-queue-tray`). It sits at the top of the turn at the start and at the bottom after a steer. Smallest fix: always render it after the last item of the turn.
3. **Esc on a top-level Settings page leaves Settings silently** (`138-system-prompt`, `139-esc-top-level`). Smallest fix: Esc only dismisses a form or menu; leave with Back.
4. **Onboarding account step has no Back** (`103-onb-account`, aria tree has only Continue and "Set up a project first"). Continue starts a real provider login, so a wrong provider choice cannot be undone first. Smallest fix: a quiet Back link under Continue.

### 3 Consistency
1. **Limits in the Settings nav exits Settings** (`17-settings-Limits`). Smallest fix: show it as a normal Settings page with the breadcrumb, or drop it from the Settings nav (the sidebar already has it).
2. **Three delete-confirm layouts**: footer swap (tool, profile, MCP: `127`, `130`, `135`), inline row swap (project checkout `131`, hub `132`) and in-menu (thread `182`). Wording is now uniform (Cancel + "Delete X"), so this is a layout nit. Smallest fix: always replace the footer.
3. **Model chip vs effort chip**: effort has a chevron 35 px from its label, model has none (`07-composer-rest`). Smallest fix: same chevron-after-label pattern on both, or none.
4. **Machines card on a tool page is half width** while all other cards are full width (`82-broken-tool`, `127`). Smallest fix: `width: 100%`.
5. **Invalid field styling differs**: onboarding profile shows a red border (`102-onb-profile-empty`), but the focused first invalid field in the Add project sheet and Add tool form shows only the light focus ring (`106`, `81-add-tool-validation`). Smallest fix: invalid border wins over the focus ring.
6. **Settings nav groups**: Projects under "Tools and skills", Limits under "Hub settings" (`18-settings-Harnesses`). Smallest fix: move Projects into the first group.

### 7 Accessibility
1. **Small hit targets**: Choice ring 28x28, Open/Download 47x24, Limits 67x26 (`ff.mjs` measurements). Smallest fix: 36 px minimum hit area through padding.
2. **Full title is pointer-only** (native `title`; the title is not focusable). The accessible name of the row includes the complete text, so a screen reader is fine. Smallest fix: make the header title focusable or add a "Copy title" menu item.
3. **Dirty-edit prompt** is plain text next to two buttons (`29-dirty-nav-accounts`); focus moves to Keep editing, but the question is not a labelled group or alert. Smallest fix: `role="group" aria-label="Discard changes?"` on the footer. Not verified with a screen reader.
4. **Focus drops to `BODY`** after Generate pairing code, opening an account, and opening a machine (`dd.mjs` output). Smallest fix: move focus to the page heading or the clicked control.
5. Contrast measured: sidebar subtitle 12 px `#8f9099` on dark 5.5:1; media actions 6.35:1; effort chip 6.35:1. All pass AA.

### 8 Layout robustness
1. **Settled shelf at 500 px tall**: expanding it leaves the first row half under the footer until the user scrolls (`160-500-settled-open`). This is the same issue as round 4. Smallest fix: scroll the opened shelf into view.
2. **Header title at 900** truncates ("...with the le...", `50-900-long-title`); reachable through the tooltip only. Acceptable.
3. No horizontal overflow at 900 (measured) or 1600; 900 settings forms are clean (`155`-`159`); compact profile fits (`38`).
4. The "Jump to latest" pill overlays transcript text (`146-long-context-scrolled`). Nit.

### 9 Forms & dialogs
1. **Invalid-field ring** (above).
2. **Pairing code has no Copy action** (`133-pairing-code`); it must be selected by hand. Smallest fix: a Copy button.
3. Validation is specific and inline on Add tool (`81`), Add project (`105`), profile (`102`), with focus on the first invalid field. Confirms are uniform. Dirty guard holds everywhere (table above).

### 1 Minimalism / calmness
1. New-thread picker footer "Navigate / Enter Select / Esc Close" (`42-new-thread-picker`): drop it.
2. "Open app" pill beside Ship and Reopen (`53-delivery-ready`, `57-ship-3`): move into the "..." menu.
3. Add secret has four helper paragraphs plus per-option sub-lines (`98-add-secret`): keep the first, move the rest to placeholders.
4. The failure stack (finding 1 above) states the same failure twice.

### 2 Visual hierarchy & typography
1. Effort chevron spacing (above). 2. Everything else reads in clear steps: title, 12 px subtitle, transcript at a comfortable measure, tool column alignment.

### 6 Efficiency & flow
Strong. Measured: Ctrl+K and "/" focus Search; Ctrl+N opens the picker with focus in Search projects; Enter steers, Ctrl+Enter queues; Shift+F10 and context menu keys open row menus; Filter, effort, model, thread menus move focus on open and return it on Esc; effort accepts ArrowUp/ArrowDown on the focused chip (ArrowLeft/Right do nothing, although the tooltip says "arrow keys"). Nit: Ship stays enabled while Working and gives no preview that it queues.

## Top 5 changes
1. Clean up the refused-send/repair flow: space before the link, one error not two, no duplicate draft/bubble (Feedback, Clarity, Minimalism).
2. Scroll the expanded Settled shelf into view and keep the Working line in one place (Layout, Feedback).
3. Make Limits a normal Settings page (or remove it from the Settings nav) and add Back to the onboarding account step (Consistency, Clarity).
4. Let the invalid border beat the focus ring, add Copy to the pairing code, and give Choice and Open/Download 36 px hit areas (Forms, Accessibility).
5. Trim the leftovers: picker hint bar, "Open app" pill, Add secret helper text, unify delete-confirm layout and the effort/model chip pattern (Minimalism, Consistency).

## Verified without issue (for the record)
Sidebar rows, hover/right-click menus, Search (results and "No threads found."), Filter, New thread picker (Esc returns focus), Settled/Snoozed shelves with Undo, Snooze notice "Snoozed until tomorrow 09:00", thread delete confirm in the context menu (cancelled), transcript with images, video, audio, file links and missing media, tool calls (collapsed/expanded, failed), Choice (hover, pick), streaming, tool exploration, 70-paragraph long context with Jump to latest, steering + two queued messages, Stop, paused queue + Resume, Ship / Shipping options / Prepare for review / Waiting for merge / Check now / Shipped, CI step 2/4 then 3/4 then Shipped with details, skills panel and MCP panel, every Settings section, add forms for profile, account, secret, hub, MCP server, skill source and tool, project page from the header chip, delete confirms for tool, profile, project checkout, hub and MCP server (all cancelled except the tool, which I deleted to restore the fixture).

## Unreachable, unverified or objections
- **Sign-in and later onboarding steps**: Continue on the account step starts a real provider login. Not driven. Onboarding verified through welcome, profile (empty and named), account choice, and the Add project sheet (empty, validation, Escape, add `verify-project`).
- **No live auth, native or screen-reader coverage**: provider and hosting boundaries are fake; Electron window controls, native Browse picker, OS Open/Download for media, a screen reader, light/high-contrast/reduced-motion modes and native tooltip appearance were not tested.
- **Not exercised**: account sign-in/out, MCP OAuth, Add hub with a real code, second machine, Codex harness UI, final confirmation of project/hub/profile/MCP/thread deletion, Cancel delivery.
- **Browser tool deviation**: I did not call the host `preview_*` tools; I used the project Playwright runner directly because the parent reported preview snapshot timeouts. I cannot vouch for parity with the host preview browser.
- **Fixture side effects (mine)**: I created threads, renamed `Inline chat fixture` to a 120-character title, created and deleted a managed tool `Broken tool` (its install attempted a real npm registry lookup for a non-existent package, a request outside the fixture boundary), and generated one pairing code. All inside my temp home.
- **Shared checkout changed during the audit**: `git status` after my run shows uncommitted edits in `apps/web/src/*` (including a new `Tooltip.tsx`) and `tests/*`, plus `apps/web/dist/index.html` rebuilt at 14:00:13. I did not make them. My last screenshot is 13:59:37, so all my evidence predates the rebuild and describes the `31733b4` build.
- Stopped only my own server (PID 26072 on port 47671); all my Playwright browsers were closed by their scripts. Nothing committed, branch unchanged.

## Evidence index (`out/ui-audit/round-5/sonnet/`)
- `01`-`13`: home, thread, tools, effort, model picker, composer rest, row hover/context, header menu, side panel, Choice.
- `14`-`27`, `73`-`79`: every Settings section at 1280.
- `28`-`38`: profile editor, dirty-guard exits, keep/discard persistence, 900x700 compact profile.
- `36-900-home`, `37-900-thread`, `39`-`41`: 900x700 and side-panel overlay.
- `42`: new-thread picker. `43`-`50`: long title and rename. `51`-`57`: delivery, Shipping options, Shipped. `58`-`63`: review, check, stopped fixes. `64`-`67`: CI. `65-settled-shelf-open`: shelf.
- `68`-`72`: steering, queue, stopped, Resume. `80`-`85`: Add tool validation, broken tool, blocked send. `86`-`89`: skills panel and library. `90`-`92`, `127`-`139`: project page, delete confirms, pairing, MCP, account, machine, system prompt, Esc. `93`-`99`, `110`-`113`: filter, search, add forms. `100`-`109`: onboarding. `120`-`126`/`140`-`146`: streaming, tools, long context. `150`-`161`: 1600, 900 and 500 px views. `170`-`173`: Choice hover and pick. `180`-`185`: effort menu, snooze, delete, settled, Limits.
