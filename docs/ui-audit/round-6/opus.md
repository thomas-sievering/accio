# UI / UX audit: round 6, Claude Opus 5.5

Build under review: commit `037f47b`. Screenshots are in `out/ui-audit/round-6/opus/`, numbered `01`–`248`. The same folder holds the driver scripts (`s01`–`s23`, `journey.mjs`, `lib.mjs`), the ARIA snapshots (`aria-*.yml`), `overlay-focus.json` and `server.log`. Captures are 1280x900 unless noted. Other sizes:

- 900x700: `49`–`69`, `207`–`216`, `237`.
- 1600x1000: `197`–`206`, `238`.
- 1280x500: `191`–`193`, `196`, `217`–`226`.

## Build and environment

- **Served root:** `ACCIO_CHAT_TEST_WEB_ROOT=C:/Users/thoma/.t3/worktrees/accio/t3-4436a8c6/out/ui-audit/round-6/build` on port 47682 (PID 21380, home `%TEMP%/accio-chat-browser-fo4U8a`).
- **Manifest hashes match.** I computed SHA-256 of the served files at the start and again at the end. They equal `build-manifest.json` (commit `037f47b01e57…`):
  - `index.html` = `22a5f239…c484`
  - `index-Dbfg1KLM.js` = `050526f1…6bee`
  - `index-DnsDTf1V.css` = `bcab4963…c2ce`
- **Shared checkout:** `git status` was clean before and after. `apps/web/dist` kept its 14:22:09 timestamps and has the same three hashes.
- **Onboarding** ran through the 3-verify runner, which serves `apps/web/dist`. That directory hashed identical to the manifest at the start and the end. Run `out/verify/2026-11-04T13-40-26-475Z-703ff546`, PASSED; its cleanup reports server exited, port closed and scratch removed.
- **No build change** happened during my run, so every capture shows `037f47b`.
- **Browser:** the host `preview_status` returned `available:false`, so every capture comes from the project's Playwright (Chromium) fallback.

## Scores

| # | Category | Score | Verdict |
|---|----------|-------|---------|
| 1 | Minimalism / calmness | 9 | A refused send is one quiet line, and nothing glows. Nits: 36 px bordered media buttons on every caption, and the all-red install log. |
| 2 | Visual hierarchy & typography | 9 | Queue Save is filled primary, and the transcript, chips and Settings read in the right order. Validation text is still small. |
| 3 | Consistency | 9 | Scope labels are neutral, the chevron is used everywhere, and MCP delete states its consequence. Nits: tool delete has no consequence line, "step 2/4" vs "2 of 4", "Copy code" as a text link. |
| 4 | Clarity & discoverability | 9 | The refused-send notice is specific, the repair link works, and the title tooltip shows the full saved title. Nits: Limits from Settings swaps to the thread sidebar, and a focused Choice ring shows a check. |
| 5 | Feedback & state | 9 | Refused sends leave state untouched. Interrupted, queued, review and CI states are exact. Nits: "Copied" never reverts, and Settle has no Undo toast while Snooze has one. |
| 6 | Efficiency & flow | 9 | Enter saves on both profile and project pages, Limits returns you to the Settings section you left, and the shortcuts work. |
| 7 | Accessibility | 8 | Tab entry onto a long title is fixed, and the overlay Tab cycle is clean. Some navigations still drop focus to `<body>` or the breadcrumb, and eight media buttons share the bare names "Open" and "Download". |
| 8 | Layout robustness | 9 | No row grows or shifts, the step dots don't move, the expanded shelf stays visible at 500 px, and nothing overflows at 900, 1280 or 1600. |
| 9 | Forms & dialogs | 8 | Edit forms are fully guarded. **Every "Add …" form discards typed input on Escape or section navigation, with no prompt** (`184`–`190`). |

## Required rechecks

| Recheck | Result | Evidence |
|---|---|---|
| Complete saved title from actual Tab entry, no growth or shift | **Pass.** Tab from Search goes Filter › Add project › New thread › Choice › the long row. On focus a tooltip shows the whole saved title, 120 of 120 characters (the rename field has `maxlength=120`). The tooltip is 360x54 and inside the viewport. The row stays 44 px and the next row stays at y=156, at both 1280 and 900, and also when the open row is focused. | `40`, `41`, `45`, `49`, `50`, `54`, s03 log |
| Title tooltip dismissal | **Pass with a nit.** Escape removes it, and moving to another row replaces it. While one row has keyboard focus, hovering another row shows a **second** tooltip (`43`: two tooltips stacked). Rows whose title fits ("Skills fixture") also get a redundant tooltip (`43`, `193`). | `42`, `43` |
| Effort tooltip, width and caret | **Pass.** On keyboard focus the tooltip says "Effort: Auto (the harness decides)", and Escape dismisses it (`46`). Width is 86 px for Auto, Low, Medium, High, Extra high and Max. The caret sits 3 px after the word: x=39 for "Auto", 34 for "Low", 68 for "Extra high". After choosing from the menu with the mouse, the tooltip reappears because focus returns to the button (nit). | `46`, `47`, `55`–`57`, s03/s04 logs |
| Overlay forward and reverse Tab | **Pass.** At 900x700, the Skills panel took 40 Tab and 40 Shift+Tab presses. They cycled through 7 stops inside the panel plus the toggle, with no `<body>`, separator or inert stop. "Resize sidebar" sits inside `[inert]`. "Resize side panel" is never a Tab stop. Escape closes the panel and focuses the toggle. Clicking the dimmed main area or the inert sidebar closes it. | `58`–`60`, `overlay-focus.json`, s06 log |
| Settings releases the boundary | **Pass, with a focus nit.** "Manage MCP servers" in the panel opens Settings with no `[inert]` left, and Tab reaches the whole Settings nav. Initial focus is `<body>`. Back returns to the thread with the panel open and focus on the MCP tab. | `66`, `68`, `69`, s09 log |
| Limits returns to the originating Settings section with focus | **Pass.** Settings › Machines › Limits opens the Limits page. Close (and Escape) returns to Settings › Machines with focus on the "Limits" nav button. The Limits page itself starts with focus on `<body>` and shows the thread sidebar instead of Settings. | `83`, `84`, s10 log |
| Dirty Keep editing never saves | **Pass.** Click, Enter and Space each keep "Personal EDITED" and move focus to Save. `hub/settings.json` still says `Personal` after each. | `72`, `73`, s10 log |
| Discard persists nothing | **Pass.** Profile: Discard goes to Accounts, the saved name stays `Personal`, and reopening shows `Personal`. Project: Discard after Keep editing leaves `projects.json` at the last saved value. | `77`, s10 log |
| Text-field Escape prompts (dirty) | **Pass on edit pages:** profile, project, MCP server, machine and account. Escape shows "Discard changes? · Keep editing · Discard" with focus on Keep editing. A second Escape dismisses the prompt and keeps the edit. **Fails on every "Add …" page** (see Forms #1). | `74`, `75`, `82`, s10/s18 logs, `184`–`190` |
| Clean Escape focuses the originating row | **Pass.** Escape from the field and Escape from the background both return to the list with focus on "Personal · Personal Claude". | `78`, s10 log |
| Project Preview command Enter saves | **Pass.** Enter persisted `node audit-enter.cjs` and returned to the list. Reopening showed it. I restored the empty value afterwards. Focus lands on the breadcrumb `NAV`, not on the project row. | `81`, s10 log |
| Broken tool refuses an existing-thread send | **Pass.** The thread shows no user bubble. The row stays "Ready", and every thread's title and status in `threads.json` is unchanged. The draft stays in the composer, and one line reads "Audit broken tool is not ready. A repair thread was started. Open repair thread". A second Enter doesn't stack another notice. | `92`, `93`, s11 log |
| Blocked fresh draft creates no orphan | **Pass.** A new draft shows the same notice, and the draft stays. The transcript count stays at 4 and `threads.json` is unchanged. | `95`, `96`, s11 log |
| Repair link spacing, repair thread, display-name title | **Pass.** The text reads "…was started. Open repair thread", with a space before the link. The link opens "Repair Audit broken tool" (display name, not the slug). | `92`, `94`, `97` |
| 36 px Choice pick on the label row; media controls | **Pass.** The three pick buttons are 36x36 on the label row and no longer cover the thumbnail. Open and Download are 47x36 and 72x36. The Choice nit is in Clarity #2. | `36`, `37`, `245`, `239`, s22/s23 logs |
| Queue Save primary | **Pass.** The queue edit shows a filled "Save" next to a quiet "Cancel". | `116`, `117` |
| Neutral scope status | **Pass.** "On for Personal" and "Optional" are neutral grey on the profile editor, the project page and the Skill source. | `74`, `165`, `178` |
| Full-width tool cards, chevron Details | **Pass.** The Machines readiness card fills the form width, and "› Details" turns to "⌄ Details" when expanded. | `90`, `100` |
| Invalid focused fields red | **Pass.** After an empty Add tool, the focused Name field has `aria-invalid=true`, a 2 px outline `rgb(196,127,132)` and an `aria-describedby` error. Unfocused invalid fields have red borders. New profile matches. | `87`, `148`, s11 log |
| MCP delete consequence | **Pass.** "Threads lose this server's tools. · Cancel · Delete local-db". | `163` |
| Copy pairing code | **Pass.** "Copy code" put `4519-9DD8-E70F-212C` on the clipboard and changed to "Copied". It still read "Copied" 2.5 s later (nit). | `169`, `195`, s19 log |
| Expanded Settled shelf, first row visible at 500 px | **Pass.** At 1280x500 the Settled header is at y=327 and its first row is at 355–399 inside the viewport. The list scrolls so that the row is visible. | `192`, `193`, `196`, s19 log |
| Onboarding project-added status doesn't shift the dots | **Pass.** The step dots stay at y=430 before and after "Back · Added verify-project." | `231`, `235`, journey log |

## Findings by category

### 1. Minimalism / calmness (9)

1. **The media captions carry heavy controls.** Every image, video and audio file has two bordered 36 px buttons beside 12 px caption text. The inline fixture shows 16 of them (`17`, `19`, `239`). They are taller than the caption line and pull the eye away from the media. *Fix:* keep the 36 px hit area but drop the border at rest, and show it on hover or focus.
2. The npm install Details renders the whole log in red monospace (`100`). Only the first line is the error. *Fix:* use the normal code colour and keep red for the summary line.
3. Good:
   - A refused send is one muted-red line with an inline link (`92`).
   - The review state is one chip, Check now and Stop automatic fixes (`137`).
   - The empty home has one sentence and one button (`01`).

### 2. Visual hierarchy & typography (9)

1. Validation text is still 12 px pinkish under each field (`87`, `148`). It is readable but faint next to the 14 px labels. *Fix:* use 13 px in `--danger`.
2. The Choice pick circles are near-black discs with a white ring, the heaviest objects in the card row (`36`). *Fix:* use a transparent fill at rest.
3. Good:
   - Queue Save is primary (`117`).
   - The transcript measure is unchanged at 1600 (`198`).
   - The CI chip, its caption and the details list step down clearly (`143`).

### 3. Consistency (9)

1. **Tool delete has no consequence line:** "Cancel · Delete Audit broken tool" (`101`). MCP ("Threads lose this server's tools.", `163`), hub ("You will be disconnected from this hub.", `172`) and checkout ("Remove checkout and delete 1 thread", `180`) all state theirs. *Fix:* "Threads on every machine lose this tool."
2. **The sidebar says "CI · step 2/4" while the chip says "CI · Build image · 2 of 4"** (`143`). This is unchanged since round 5. *Fix:* "CI · 2 of 4".
3. **"Copy code" is an underlined text link** (`169`). The other actions in that card ("Generate pairing code") and elsewhere are bordered buttons. *Fix:* use the small bordered button.
4. **Snooze shows an Undo toast; Settle shows none** (`191`, `194`). *Fix:* give Settle the same "Settled · Undo" toast.
5. Good: the chevron is used for tool Details, CI details and Inherited (`100`, `143`, `58`). Every confirmation puts quiet Cancel first and the red action last (`06`, `163`, `172`, `175`, `180`).

### 4. Clarity & discoverability (9)

1. **Settings › Limits replaces the Settings sidebar with the thread sidebar** (`83`). Close now returns you correctly (`84`), but while you're on the page you seem to have left Settings. *Fix:* render Limits inside the Settings shell when opened from there, with the Settings nav still showing "Limits" active.
2. **A focused Choice pick shows a check mark inside a double ring** (`245`), the same glyph as a picked option (`247`). A keyboard user can read focus as selection. *Fix:* show the ring only on focus, and the check only when picked.
3. After a project is added during onboarding, the sidebar still says only "No threads yet." (`235`). *Fix:* list the project with "no threads yet".
4. The refusal says "A repair thread was started" on every attempt, though it started earlier (`93`, `96`). *Fix:* "A repair thread is open."
5. Good:
   - The refusal names the tool and links to its repair thread (`92`).
   - The snoozed composer offers "Wake now" (`247`).
   - The tool page says what happens next: "Accio checks again when it completes." (`90`).

### 5. Feedback & state (9)

1. "Copied" never reverts to "Copy code" (s19 log: still "Copied" after 2.5 s). *Fix:* revert after about 2 s.
2. Settle has no Undo acknowledgement (Consistency #4).
3. Good:
   - A refused send changes neither the transcript nor the thread state (`92`, `96`).
   - "Interrupted" is amber in the sidebar, the queue shows "paused · Send now", and the banner offers Resume (`119`).
   - "Shipped to main · 7a0be27" comes with Reopen and Archive (`129`).
   - "Waiting for merge · #123" shows "checked just now" (`137`).
   - CI shows "1 of 2 checks complete" with the step (`143`).
   - Install failure says "Couldn't install … Check the package and version, then retry." (`90`).

### 6. Efficiency & flow (9)

1. Accidentally pressing Escape in an "Add …" form throws the input away (Forms #1), which forces you to retype it.
2. Good:
   - Enter saves both the profile and the project page (`81`).
   - Limits returns to the section you came from (`84`).
   - Ctrl+K and "/" focus Search, Ctrl+N opens the picker, and the arrows move between rows (s01 log).
   - Steering takes Enter and queueing takes Ctrl+Enter (`113`, `114`).
   - Effort changes with the arrow keys (s03 log).

### 7. Accessibility (8)

1. **Focus drops to `<body>` or the breadcrumb after in-app navigation:**
   - "Manage MCP servers" → Settings focuses `BODY` (s09 log).
   - Settings › Limits focuses `BODY` (s10 log).
   - After Enter-to-save, Discard, or deleting a tool, focus lands on the breadcrumb `NAV` (`Settings/Projects`, `Settings/Tools`), not on the row you edited (s10/s12 logs, `149` shows the ring around the breadcrumb).

   A keyboard user then has to find their place again. *Fix:* focus the page heading or first control on navigation, and the originating row after Save, Discard or Delete. Clean Escape already does this (`78`).
2. **Eight media buttons are named just "Open" and "Download"** (ARIA `aria-thread-inline.yml`, s22 log: `aria-label` null). A screen-reader list of buttons can't tell which file each belongs to. *Fix:* use `aria-label="Open Saved picture"` and similar, or `aria-describedby` pointing at the caption.
3. Two tooltips can show at once: one from keyboard focus and one from hover (`43`). *Fix:* keep a single tooltip instance.
4. Good:
   - Full title on keyboard focus without layout change (`41`).
   - A clean overlay cycle (`overlay-focus.json`).
   - Invalid fields have `aria-invalid` and `aria-describedby` (s11 log).
   - The discard controls are a named group (`aria-dirty-prompt.yml`).
   - The Choice view dialog takes focus on Close and returns it to "View A" on Escape (s23 log).

### 8. Layout robustness (9)

1. At 1280x500 the Settings sidebar scrolls under a tight "Back" header (`224`). The next item is clipped right under it, which looks cramped. *Fix:* add a 1 px rule or 8 px of padding under the sticky Back row.
2. Good:
   - No overflow found by script at 900, 1280 or 1600, in the inline, review and Settings views (s21 log).
   - The header truncates at 900 and has a `title` (`53`).
   - The sticky Save footer is visible at 500 px (`224`: Save at y=456–488).
   - Rows never shift (rechecks above).
   - The shelf stays visible at 500 px (`193`).
   - The step dots are stable (`235`).
   - Long tool output folds behind "Show all 401 lines" (`24`).

### 9. Forms & dialogs (8)

1. **Every "Add …" form drops typed input with no prompt.** I typed into New profile, New secret, New tool, New MCP server, New skill source, Add hub and New Claude account. In each, Escape from the field went straight back to the list (`184`–`190`). Section navigation also left without "Discard changes?" (s17 log: `keep prompt 0` for all seven). Edit pages for the same objects prompt (s18 log: `keep 1` for MCP, machine and account; `74`, `82`). This is a user-visible inconsistency and silent data loss. *Fix:* treat any non-empty new form as dirty and run it through the same guard.
2. The tool delete consequence is missing (Consistency #1).
3. Good:
   - Keep editing never saves, and Discard writes nothing (rechecks).
   - Add project validates inline: "Choose a folder" and "C:\definitely\not\here is not a folder" (`242`, `243`). Escape and an outside click close the sheet, and focus returns to "Add project" (s22 log).
   - Onboarding's sheet is padded 25 px with a footer band (`232`, journey log).
   - Thread actions has Copy as Markdown, Rename…, Wake now, Settle and Delete thread, and Escape returns focus to the trigger (`248`).

## Round-5 findings: status

| Round-5 finding | Status | Evidence |
|---|---|---|
| Refused send: bubble, Failed state, two red notices | Fixed | `92`, `93`, `96` |
| Settings → Limits leaves Settings, × goes home | Return fixed; while on the page the sidebar is still the thread sidebar | `83`, `84` |
| Focused long title wraps and grows | Fixed (tooltip, no geometry change) | `41`, `45`, `50` |
| Enter-to-save inconsistent | Fixed | `81` |
| Dirty Escape gives no feedback | Fixed on edit pages; new forms don't prompt | `74`, `184`–`190` |
| Clean Escape drops focus to `<body>` | Fixed (focus returns to the row) | `78` |
| "On for Personal" green | Fixed | `74` |
| MCP delete without a consequence line | Fixed (tool delete still lacks one) | `163`, `101` |
| Tool card ▶ Details | Fixed (chevron) | `100` |
| Tool card half width | Fixed | `90` |
| Queue Save not primary | Fixed | `117` |
| Choice ring over the thumbnail button | Fixed | `36` |
| Onboarding dots shift | Fixed | `231`, `235` |
| Repair title uses the slug | Fixed | `97` |
| "CI · step 2/4" vs "2 of 4" | Not fixed | `143` |
| Onboarding sidebar doesn't list the project | Not fixed | `235` |
| Effort trigger gap | Fixed (caret beside the word, fixed width) | `55`–`57` |

## Top 5 changes

1. **Guard new forms like edit forms** (Forms 8→9, Efficiency). A non-empty "Add …" form should show "Discard changes?" on Escape, section navigation, Back and the breadcrumb. `184`–`190`.
2. **Land focus somewhere meaningful after navigation** (Accessibility 8→9):
   - Settings opened from "Manage MCP servers": the heading or first row.
   - Limits: the heading.
   - After Save, Discard or Delete: the originating row, not the breadcrumb `NAV`.

   s09, s10 and s12 logs; `149`.
3. **Name media buttons by their file** (Accessibility): "Open Saved picture" and "Download Demo clip". Allow only one sidebar tooltip at a time. `43`, `239`.
4. **Close the remaining consistency gaps** (Consistency, Feedback):
   - A tool delete consequence line.
   - "CI · 2 of 4" in the sidebar.
   - "Copy code" as a button that reverts after 2 s.
   - An Undo toast for Settle.

   `101`, `143`, `195`, `194`.
5. **Polish two state signals** (Clarity, Minimalism):
   - The Choice pick shows a check only when picked, not on focus.
   - Media buttons are borderless at rest.
   - "A repair thread is open." on repeat refusals.
   - Limits from Settings keeps the Settings nav.

   `245`, `17`, `93`, `83`.

## Objections, unreachable features and coverage gaps

- **Fixture boundaries.** The provider harness and the PR/CI hosting are fakes from `scripts/chat-test-server.ts`, and Git publication is real but disposable. Not covered:
  - Live Claude or ChatGPT sign-in. Onboarding stops at "Sign in with Claude" (`231`), because that opens an external provider page.
  - Live model turns, live GitHub and real usage-limit numbers. The fixture account reports "doesn't report usage limits" (`16`), so populated Limits bars and reset confirmations were not visible.
  - MCP remote sign-in ("Sign in" on docs-search, `159`) is external and was not clicked.
- **Native and desktop limits.** Browser mode can't show the Electron shell, window controls, the native Browse picker, or OS file opening. "Current notes" / "Space notes" and media "Open" gave no visible in-page feedback in Chromium (`240`). Whether the desktop opens the file is unverified.
- **Screen readers.** Accessibility is judged from ARIA snapshots, focus tracing and `inert` checks, not from NVDA, JAWS or VoiceOver output.
- **Not driven, though available:**
  - I opened Hub removal, profile delete, checkout removal and MCP delete but did not confirm them. Only my own broken tool was deleted (`101`, `102`).
  - Second-hub pairing: I didn't submit Add hub with a code, because there was no second hub.
  - Skill "Copy into project", "Enable for…" and "Check for updates" were not driven.
  - Secrets: the add form was opened, but no secret was saved.
  - Light theme was not checked; the app showed dark only.
- **Repair precondition.** I added a managed tool with the nonexistent package `@accio-audit-r6/does-not-exist@1.0.0`. Installing it made a read-only npm registry lookup (404, `100`). The tool stayed in my disposable home, and I deleted it before the turn journeys.
- **Fixture-state side effects in my home:**
  - The long title from the rename (`40`).
  - Choice fixture and explore tools snoozed. There was no Wake menu item in the context menu; Wake now exists only in the thread.
  - Steering fixture settled.
  - The project Preview command set and then restored to empty (`projects.json` confirmed).
- **Resumed run.** After Resume, the "Finish steering fixture" send got the media fixture answer (`121`). That is fixture behaviour, not judged.
- **Scripting incidents:**
  - s12 first looked for a `Details` button; it is a disclosure, and the retry used its text.
  - s15 "account delete hover" timed out because Delete is disabled ("In use by Personal", `152`). That is correct behaviour.
  - s16 "ship-select" found no combobox role on the native select. The project page was still captured (`178`, `180`).
  - The first s22 Choice step failed because the thread was snoozed. s23 redid it through the Snoozed shelf.
- **Cleanup:** I confirmed PID 21380 as `node --import tsx scripts/chat-test-server.ts`, child of my own shell, and stopped only it. Port 47682 is closed. Every Playwright browser closed at the end of its script. The verify runner tore down its own instance. The temp home `%TEMP%/accio-chat-browser-fo4U8a` and `out/chat-test-47682.json` remain; the server was force-stopped, so it didn't remove them.
