# UI / UX audit: round 5, Claude Opus 5.5

Built commit under review: `31733b4`. Screenshots: `out/ui-audit/round-5/opus/NN-<view>.png` (01-255). Driver scripts (`s01`-`s27`, `journey.mjs`), ARIA snapshots (`aria-*.yml`), `overlay-focus.json` and `server.log` are in the same folder. The populated app ran on my own `scripts/chat-test-server.ts` instance on port 47672 (home `accio-chat-browser-CIRx1c`). Onboarding ran through the 3-verify runner (`out/verify/2026-11-04T13-01-54-301Z-dc382d38`, PASSED). Captures are 1280x900 unless noted. Other sizes: 1600x1000 (172-192, 245), 900x700 (193-215, 219, 222, 233, 244) and 1280x500 (216-218).

The host `preview_status` reported `available:false`, so every capture comes from the project's Playwright runner, as the brief allows.

## Build contamination (read first)

The brief said nobody would edit while the audits ran. In fact someone edited uncommitted source in the shared checkout during my run: `App.tsx`, `SidePanel.tsx`, `Composer.tsx`, `ModelPicker.tsx`, `ThreadRow.tsx` and `threads.css`. The first edit landed at 13:56:17, and `apps/web/dist` was rebuilt at least once, finally at 14:00:13. My server serves `dist` from disk, so pages loaded after an edit can show code that is not in `31733b4`. The row tooltip in `220`/`233` comes from the new `useTooltip` in `ThreadRow.tsx`, which proves a modified build was live by 13:58.

- **01-171 (up to 13:54:45)** come before every edit and show `31733b4`.
- **172-255 (13:56 onward)** may show the modified build. I score them only where the diff cannot change the behaviour:
  - Onboarding.
  - Review stop.
  - Add project sheet.
  - Media buttons.
  - Settings Escape focus.
  - The repair link's logic. The diff only adds a space before it.

  The overlay Tab wrap (`SidePanel.tsx`), the row title tooltip (`ThreadRow.tsx`/`threads.css`), the effort tooltip (`ModelPicker.tsx`) and the Limits return (`App.tsx`) are **unverified for `31733b4`** in that range.

I did not rebuild, switch branch or edit anything to work around this.

## Scores

| # | Category | Score | Verdict |
|---|----------|-------|---------|
| 1 | Minimalism / calmness | 9 | The green Filter icon, the review dot, the Add tool helper stack, the Skill source paragraph and the contradictory Limits sentence are all gone. Left: a blocked send stacks two red messages. |
| 2 | Visual hierarchy & typography | 9 | The CI chip reads "CI · Build image · 2 of 4", the CI link is muted, and the Choice rings are empty at rest. Queue-edit Save and Cancel now have equal weight, but Save is still not primary. |
| 3 | Consistency | 8 | Confirmations are now quiet Cancel first, red action last, everywhere. Left: "On for Personal" is green only in the profile editor, a ▶ triangle on the tool card, MCP delete without a consequence line, Enter saving one form but not another, and "step 2/4" next to "2 of 4". |
| 4 | Clarity & discoverability | 8 | The onboarding profile sentence, the Choice rings and the Inherited chevron are fixed. Settings → Limits leaves Settings, and its × goes to the empty home. A refused send says "The last turn failed." |
| 5 | Feedback & state | 8 | "Automatic fixes stopped · still tracking #123" is exact. A send refused for a broken tool shows a sent bubble, keeps the text in the composer, marks the row "Failed" and stacks two red notices. |
| 6 | Efficiency & flow | 8 | The dirty guard works on every exit, and Ctrl+K, Ctrl+N, "/" and the arrows all work. The new Settings → Limits entry loses your place. Enter-to-save works in the profile Name field but not on the project page. |
| 7 | Accessibility | 8 | Avatar letters are out of row names, media actions are real buttons, and the overlay sidebar and resize separator are inert. On `31733b4` a focused long title wraps to two lines and is still truncated. Escape on a clean detail page drops focus to `<body>`. |
| 8 | Layout robustness | 8 | The onboarding project sheet has 25 px padding and a footer band, and 1280x500 keeps a sticky footer. On `31733b4` a focused row grows by about 18 px and pushes its neighbours down. "Added verify-project." pushes the onboarding step dots down. |
| 9 | Forms & dialogs | 9 | Keep editing never saved, whether clicked, pressed with Enter or with Space. Discard persists, and the guard covers section nav, Back, the breadcrumb and Limits. Left: Escape on a dirty form gives no feedback, and the inconsistent Enter-to-save. |

## Required rechecks

| Recheck | Result | Evidence |
|---|---|---|
| Dirty settings navigation | **Pass.** Section nav, Back, the breadcrumb and Settings → Limits each show "Discard changes? · Keep editing · Discard" on the profile and project pages. A clean form navigates without a prompt. | `93`, `98`, `99`, `100`, `108`, s20/s22 logs |
| Keep editing must never save | **Pass.** Click, keyboard Enter and keyboard Space all keep the edit (`Personal EDITED`) and move focus to Save. `hub/settings.json` still says `Personal` after each one, and `projects.json` is unchanged after Keep editing on the project page. | `94`, `95`, s20 log `after keep click/Enter/Space … persisted Personal`, s22 log `project keep node keep.cjs "previewCommand": "node preview.cjs"` |
| Discard persistence | **Pass.** Discard navigates, nothing is written, and reopening shows the saved value: profile `Personal`, Preview command empty. | `101`, `103`, `109`, s22 log `project reopened ""` |
| Limits entry | **Guarded but flawed.** The Settings nav "Limits" is guarded when the form is dirty. It then leaves Settings for the app Limits page, and × returns to the empty home, not to Settings. The uncommitted `App.tsx` change targets exactly this. | `100`, `101`, `102` |
| Compact profile | **Pass.** One card with Name and two account selects, then Skills, then a footer. The page is 611 px tall. | `92`, `125` |
| Media / effort resting affordance | **Pass.** Open and Download are bordered 24 px buttons. Effort shows "Auto ⌄" at rest with a 10 px chevron and a hover background, and the arrow keys change it (`Effort: Low`). The 40 px gap between "Auto" and the chevron is a nitpick. | `17`, `29`, `32`, `228` |
| Onboarding project sheet padding | **Pass.** The dialog is 520 px wide, the input sits 25 px from both sides, and the buttons sit 13 px above the bottom with a footer rule. The sheet from the link and the one from the sidebar button are identical. | `239`, `240`, `241`, `243`, journey log `pad …` |
| Overlay focus boundary incl. resize separator | **Pass for the inert boundary.** "Resize sidebar" sits inside `[inert]` while the overlay is open, and 25 Tabs never reached a separator. The Tab wrap I saw (panel controls plus the toggle) may come from the uncommitted `SidePanel.tsx` change, so it is unverified for `31733b4`. | `197`, `219`, `overlay-focus.json` |
| Full title access | **Fail on `31733b4`.** Keyboard focus on the open row clamps the title to two lines that are still truncated ("…to test…"), and the row grows and pushes "Skills fixture" down. The native `title` attribute only helps mouse users. The later captures (`220`, `233`) show the uncommitted tooltip fix. The header shows the full title when it fits and has `title=` when it doesn't (900 px). | `162`, `161`, s25 log `header B title=…` |
| Stopped review fixes vs continued observation | **Pass.** Before: "Waiting for merge · #123 · Check now · Stop automatic fixes", whose tooltip says "The PR stays tracked; the agent no longer starts to fix failing checks". After: the chip and Check now remain, with the caption "Automatic fixes stopped · still tracking #123 · checked 1m ago". Check now still refreshes the time. | `223`-`226` |
| Repair thread link | **Pass (logic).** A failed tool install starts "Repair audit-broken-tool". A later send shows "Audit broken tool is not ready. A repair thread was started. Open repair thread", and the link opens the repair thread. The spacing in `251` comes from the modified build. | `249`-`253` |
| Skill label deduplication | **Pass.** The row shows "repo-notes · Repository · Loaded", and the detail shows "Source: This repository" once. Inherited shows "Profile · Library". | `41`, `43`, `44` |

## Findings by category

### 1. Minimalism / calmness (9)

1. **A refused send stacks two red blocks:** "The last turn failed. · Retry" in a red banner, then a red line "Audit broken tool is not ready. A repair thread was started. Open repair thread" (`251`). *Fix:* show only the tool line with its link, and drop the failed-turn banner for refusals that never started a turn.
2. Nitpick: the effort trigger is 86 px wide, with about 40 px of space between "Auto" and the chevron (`29`). *Fix:* size it to its content.
3. Good: the Filter icon stays neutral beside its chip (`11`). The review caption has no dot (`61`). Add tool has one helper sentence (`133`). The Skill source paragraph is gone (`140`). The Limits card has one sentence (`127`).

### 2. Visual hierarchy & typography (9)

1. **Queue-edit Save is not the primary button.** Save and Cancel are identical bordered buttons (`86`). *Fix:* use the small filled primary style on Save.
2. Validation text is still 12 px pinkish on the card (`123`, `133`). *Fix:* use `--danger` at 13 px.
3. Good: "CI · Build image · 2 of 4" with a chevron disclosure and a muted "image ↗" link (`66`, `69`). The Choice rings are empty until hover (`36`, `37`). The stop notice is one banner with Resume (`88`).

### 3. Consistency (8)

1. **"On for Personal" is green in the profile editor** (`92`, `125`) and neutral on the project page and Skill source (`47`, `140`). *Fix:* make it neutral everywhere.
2. **The MCP delete confirmation is "Cancel · Delete local-db" with no consequence text** (`138`). Hub, profile and checkout state their consequence (`147`, `150`, `155`). *Fix:* add "Threads lose this server's tools." before the buttons.
3. **The tool status card still uses "▶ Details"** (`249`), while CI details now uses the chevron (`66`). *Fix:* use the chevron.
4. **Enter in the profile Name field saves and returns to the list** (`110`, s22 log `persisted Personal 2`). Enter in the project Preview command field does nothing (`106`). *Fix:* make Enter submit every Settings detail form, or none of them.
5. The sidebar says "CI · step 2/4" while the chip says "2 of 4" (`66`). The repair thread title uses the slug ("Repair audit-broken-tool") instead of the tool's name, "Audit broken tool" (`250`). *Fix:* use one step format, and the display name.
6. Good: every confirmation is now a quiet Cancel followed by the red action. That covers thread delete, hub removal, profile delete, checkout removal and the discard prompt (`06`, `147`, `150`, `155`, `93`).

### 4. Clarity & discoverability (8)

1. **Settings → Limits leaves Settings.** The Settings sidebar is replaced by the app's thread sidebar, and × lands on "Pick a thread, or start a new one." (`101`, `102`). A user who came from Settings has lost their place. *Fix:* close back to the Settings section the user came from. The uncommitted `App.tsx` change does this, but it is unverified.
2. **"The last turn failed." for a send that was refused before it started** (`251`), and the sidebar row turns red "Failed" (`251`). *Fix:* call it "Not sent: Audit broken tool is not ready" and leave the thread state unchanged.
3. The onboarding sidebar says "No threads yet." after adding a project, but doesn't list the project (`242`). *Fix:* "verify-project · no threads yet".
4. Good: the profile sentence and validation match Settings (`235`, `236`). Inherited has a chevron when collapsed (`41`). The Choice pick is unambiguous (`36`).

### 5. Feedback & state (8)

1. **The refused-send state contradicts itself** (`251`):
   - The text appears as a sent user bubble ("Queued after repair").
   - The same text is still in the composer.
   - The thread is marked Failed.
   - Retry is offered, though it would hit the same broken tool.

   *Fix:* keep the draft in the composer only, with no bubble and no Failed state. Show the single tool notice with "Open repair thread".
2. Good: Interrupted is amber in the sidebar, the queue shows "paused · Send now", and the banner offers Resume (`88`). Shipped shows the chip, Reopen, Archive and Open app (`55`). The review stop state is explicit (`225`). "Needs attention" on the tool card says what to do (`249`).

### 6. Efficiency & flow (8)

1. **The Limits detour from Settings** (Clarity #1). Returning means Settings, then the section, then the item again.
2. **Inconsistent Enter-to-save** (Consistency #4).
3. Typing "/" in the composer still does nothing (scoped out, `35`).
4. Good: Ctrl+K and "/" focus Search, and Ctrl+N opens the picker (s01 log). The arrows move between rows. Shift+F10 and the menus work from the keyboard (round 4, unchanged). The dirty guard never takes more than one extra click.

### 7. Accessibility (8)

1. **Keyboard users can't read a long title on `31733b4`.** The focused open row clamps it to two still-truncated lines (`162`), and the native `title` doesn't appear on keyboard focus. *Fix:* show the full title in the existing Tooltip on focus-visible, without changing the row height. This is the uncommitted `ThreadRow.tsx` change, unverified.
2. **Escape on a clean Settings detail page drops focus to `<body>`** (s27 log `clean Esc -> … focus BODY`, `255`). *Fix:* focus the row that was opened.
3. Validation contrast (Hierarchy #2).
4. Good:
   - Row names start with the title, with no avatar letter (s01 log).
   - Open and Download are buttons with focus rings (`229`).
   - The 900 px overlay makes the sidebar, its resize separator and the main pane inert, and Escape returns focus to the toggle (`overlay-focus.json`).
   - The Settings row focus ring is one clean outline (`254`).
   - The sidebar separator is keyboard-resizable (272 → 288 with ArrowRight).

### 8. Layout robustness (8)

1. **A focused row grows by about 18 px and shifts its neighbours** on `31733b4` (`162` against `161`). *Fix:* keep it to one line (Accessibility #1).
2. **On the onboarding sign-in step, "Added verify-project." replaces the project link with its own line,** pushing the step dots from y=432 to y=479 (`238` against `242`). *Fix:* put the message on the same muted row as Back.
3. **Choice B's ring still covers the thumbnail's own "Add account" button** (`36`, `37`). *Fix:* move the ring to the label row, or inset it to the bottom-right.
4. The tool status card is half the content width, leaving an empty right half (`249`). *Fix:* make it full width like the other cards.
5. Good:
   - The onboarding sheet is padded (`239`).
   - At 1280x500 the project page keeps a sticky Cancel / Save footer (`218`).
   - The header truncates with `title=` at 900 px (s25 log).
   - Transcript, composer and settings stay in one column at 900, 1280 and 1600 (`173`, `194`, `207`).
   - Long tool output folds behind "Show all 401 lines" (`24`).

### 9. Forms & dialogs (9)

1. **Escape on a dirty form does nothing visible.** With focus in a field, the edit is kept and focus stays put (`96`, `97`, `107`). With focus elsewhere, focus moves to Save (`104`). It is safe, but the user gets no hint why Escape didn't leave, while on a clean page Escape does leave (`255`). *Fix:* show the same "Discard changes?" prompt on Escape.
2. Enter-to-save inconsistency (Consistency #4) and the missing MCP consequence line (Consistency #2).
3. Good:
   - Keep editing is safe from every input method, and Discard persists (rechecks above).
   - Cancel on a dirty form discards on purpose, without a prompt (`105`).
   - Add project validates inline: "Choose a folder" and "C:\definitely\not\here is not a folder" (`231`, `232`, `240`).
   - Escape and an outside click close the sheet, and focus returns to the trigger (s24 log).
   - The Add tool errors are inline per field, and Add tool stays enabled (`133`).

## Round-4 findings: status

| Round-4 finding | Status | Evidence |
|---|---|---|
| Add tool helper text stacked | Fixed (one sentence) | `133` |
| Skill source paragraph | Fixed | `140` |
| Filter icon turns green | Fixed | `11` |
| Review "checked" dot | Fixed | `61` |
| Limits card contradicts itself | Fixed | `127` |
| Queue edit buttons inverted | Partly fixed (now equal, Save not primary) | `86` |
| CI chip repeats the job | Fixed | `66` |
| "Stopped." / "Resumed" centred | Fixed (banner) | `88` |
| CI link bright blue | Fixed | `69` |
| Four confirmation layouts | Fixed, except MCP has no consequence line | `06`, `138`, `147`, `150`, `155` |
| Enabled skill has three labels | Partly fixed: all say "On for Personal", but green in the profile editor | `47`, `125`, `140` |
| Profile validation wording | Fixed | `236` |
| CI ▶ triangle | Fixed in CI. The tool card still has ▶ | `69`, `249` |
| Choice pick looks selected | Fixed | `36`, `37` |
| Onboarding profile sentence | Fixed | `235` |
| Inherited has no chevron | Fixed | `41` |
| "Remove it from those profiles" | Fixed | `127` |
| Sidebar blank after onboarding project | Fixed ("No threads yet.") | `242` |
| Media Open / Download bare text | Fixed | `17`, `229` |
| Focus lost after the discard prompt | Fixed (focus goes to Save) | s20 log |
| Avatar letter in row names | Fixed | s01 log |
| Onboarding project sheet unpadded | Fixed | `239`, `243` |
| Project dialog clipped at 500 px | N/A (the dialog is gone; the page has a sticky footer) | `218` |
| Sign-in step layout | Fixed | `238` |
| Settings project page discards silently | Fixed | `108`, `109` |

### New in round 5

1. **Settings → Limits exits Settings,** and × goes home (`101`, `102`). This entry point is new in round 4's changes.
2. **The refused-send state is contradictory:** sent bubble, text kept in the composer, Failed row, two red notices (`251`).
3. **Enter-to-save is inconsistent** between Settings forms (`106`, `110`).
4. **Escape on a clean detail page loses focus** (`255`).

## Top 5 changes

1. **Make a refused send a pure notice** (Feedback 8 → 9, Minimalism, Clarity). No user bubble, no Failed state and no Retry banner. Keep the draft and show one line: "Not sent: Audit broken tool is not ready. Open repair thread". `251`.
2. **Return Limits to its origin** (Clarity, Efficiency 8 → 9). When opened from Settings, × goes back to the same section with focus on "Limits". Verify the uncommitted `App.tsx` change against a clean build. `101`, `102`.
3. **Show the full title on keyboard focus without changing row height** (Accessibility, Layout 8 → 9). Verify the uncommitted `ThreadRow.tsx` / `threads.css` change on a clean build. `162`.
4. **One rule per form interaction** (Consistency 8 → 9, Forms):
   - Enter submits on every Settings detail form.
   - Escape on a dirty form shows the Discard prompt.
   - Escape on a clean page returns focus to the opened row.
   - MCP delete states its consequence.

   `96`, `106`, `110`, `138`, `255`.
5. **Last label nits** (Consistency, Hierarchy):
   - "On for Personal" in neutral everywhere.
   - A chevron on the tool card's Details.
   - "CI · 2 of 4" in the sidebar.
   - The repair thread named after the tool's display name.
   - Queue-edit Save as primary.
   - A full-width tool status card.
   - The Choice ring off the thumbnail's button.

   `36`, `86`, `125`, `249`, `250`.

## Unreachable, partial and objections

- **Build contamination:** see the top section. Shots 172-255 may come from a build with uncommitted edits. My conclusions for `31733b4` rely on 01-171, plus later captures whose code paths the diff doesn't touch. A clean re-audit of the overlay Tab wrap, title tooltip, effort tooltip and Limits return is needed once those edits are committed.
- **The host browser preview was unavailable** (`available:false`), so I used the Playwright runner.
- **Fixture boundaries:** the provider harness and hosting (PR/CI) are fakes from `scripts/chat-test-server.ts`. Not covered:
  - Live Claude or ChatGPT sign-in, so onboarding past "Sign in with Claude" is unreachable.
  - Live provider turns and live GitHub.
  - The Electron shell, the native folder picker and OS file opening (the "Current notes" / "Space notes" links).
  - Screen readers. Accessibility here is ARIA snapshots, focus and inert checks only.
- **Repair flow precondition:** I added a managed tool with the nonexistent package `@accio-audit-r5/does-not-exist@1.0.0` so that it fails. Installing it made a read-only npm registry lookup. The tool stayed in my disposable home.
- **Destructive actions were opened but never confirmed:** thread delete, hub, profile, MCP and checkout removal.
- **Script incidents:**
  - s03 assumed that the project breadcrumb opens a dialog. It now opens the Settings page, so the script typed into Preview command. I deleted those five captures and renumbered. `projects.json` showed nothing was saved.
  - s08 and s09 project-dialog steps no longer apply because the dialog was removed.
  - s05 stopped at "Limits" because it leaves Settings, which is the finding itself. The remaining sections are covered by s06/s07 and `246`.
- **Cleanup:** I stopped only my server (PID 5052, port 47672, command line confirmed as `scripts/chat-test-server.ts`). My Playwright browsers closed per script. The verify runner tore down its own instances.
