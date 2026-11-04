# UI / UX audit, round 6, model `sonnet`

Commit `037f47b`, stable saved build `out/ui-audit/round-6/build/`. I did not edit app code, rebuild, switch branches or commit. `git status` at the end shows only another auditor's untracked `docs/ui-audit/round-6/opus.md`.

## Method and build integrity

- **Populated fixture:** `ACCIO_CHAT_TEST_WEB_ROOT=C:/Users/thoma/.t3/worktrees/accio/t3-4436a8c6/out/ui-audit/round-6/build ACCIO_CHAT_TEST_PORT=47681 node --import tsx scripts/chat-test-server.ts` (PID 27004).
- **Served root verified against `build-manifest.json`:** `curl` of `/`, `assets/index-Dbfg1KLM.js` and `assets/index-DnsDTf1V.css` from 47681 hashed to `22a5f239…c484`, `050526f1…6bee` and `bcab4963…ce` (all three equal the manifest). I rechecked at the end, after the audit: unchanged. `apps/web/dist/index.html` also still hashes to the manifest value, so the onboarding journey (which serves `apps/web/dist`) used the same bytes. I did not modify the saved build.
- **Browser:** project Playwright (Chromium, dark) at 1280x900, 1600x1000, 900x700 and 1280x500. ARIA snapshots (`.aria.yml`) sit next to most screenshots. Keyboard behaviour was measured by reading `document.activeElement`, `inert` and computed styles after each key.
- **Host preview tools (rule compliance):** `preview_status` first (no tab), then an owned `preview_open` with `reuseExistingTab=false`, incognito profile. The first `preview_snapshot` failed with `Preview snapshot failed: Preview automation snapshot timed out after 15000ms.` The second worked. `preview_resize` to 900x700 returned `"viewport":{"width":1280,"height":800}` (the request was ignored on the hidden tab). That is a second step failure, so I closed the tab (`t3_preview_close`) and used the project Playwright fallback for everything else. I cannot vouch for host-preview parity.
- **Fresh-home onboarding:** custom 3-verify journey `out/ui-audit/round-6/sonnet/j/journey.mjs`, PASSED, run `out/verify/2026-11-04T13-44-27-233Z-e3811803`, screenshots 200-210. An earlier run (`…13-43-53-367Z-7ea9efc7`, also PASSED) is **invalid for the dot-shift check**: my journey resized the page to 1280x900 while the runner's viewport is 1440x1000, which produced a fake 80 px / 13 px dot shift. The second run restores the original viewport and is the one I report.
- Scripts: `out/ui-audit/round-6/sonnet/s/*.mjs`. Screenshots: 208 PNG and 133 `.aria.yml` in `out/ui-audit/round-6/sonnet/`.
- I judged what is on screen.

## Scores

| # | Category | Score | Verdict |
|---|----------|-------|---------|
| 1 | Minimalism / calmness | 9 | Quiet palette, one chip per outcome, effort/Limits chips tiny. Left: picker hint bar, Add secret's five helper lines, "Open app" pill (kept by decision), two tooltips can show at once. |
| 2 | Visual hierarchy & typography | 9 | Clear title / 12-13 px subtitle / transcript steps; contrast 5.5 : 1 or better where measured. Nit: a 120-character title ends mid-word ("…queued and t") in the header. |
| 3 | Consistency | 8 | Neutral scope labels, full-width tool cards, filled queue Save, chevron Details all now match. Left: Limits from Settings still swaps in a different chrome (close x, no Settings nav), three delete-confirm layouts, model chip without chevron beside effort chip with one, hit areas of 18-36 px with no scale. |
| 4 | Clarity & discoverability | 8 | Refusal now reads clearly and the repair link works. Left: onboarding account step still has no Back, Choice label hover shows the check but the label is not clickable, a long rename is silently cut at 120, "Open app" gives no in-app acknowledgment, stale "Editing" label on a queued message. |
| 5 | Feedback & state | 9 | Working, Interrupted + Resume, paused queue, CI step, Waiting for merge, stopped fixes, Shipped, Snoozed + Undo and the refused send are calm and acknowledged where they happen. Left: Working line jumps from top to bottom after a steer, refusal notice is not a live region. |
| 6 | Efficiency & flow | 9 | Ctrl+N, Enter steers / Ctrl+Enter queues, Enter saves Preview command, menus move focus and return it, Escape routes. Nit: clean Escape in an editor lands on the breadcrumb, not the row. |
| 7 | Accessibility | 8 | Overlay Tab is now closed (no BODY or separator stop, 24 forward and 24 reverse steps), Settings releases the boundary, dirty prompt is a named group, invalid focus is red. Left: many targets are well under 36 px (queue tray 21-61 x 25, row hover actions 24, thread actions 28, Copy code 59 x 18, Limits 26), focus drops to BODY on Settings entry and after Generate pairing code, refusal notice is not announced. |
| 8 | Layout robustness | 9 | No horizontal overflow at 900 / 1280 / 1600 / short; 500 px Settled shelf now opens with its first row fully visible; long title wraps in the tooltip without moving rows. Nits: header truncates project and title at 900 and with the panel open, Skill source path ellipsis glitch, Tool Details card sits 1-5 px above the sticky footer. |
| 9 | Forms & dialogs | 9 | Dirty guard never saves, Discard persists nothing, Escape in a text field prompts, invalid focused fields stay red, Copy pairing code works, MCP delete states its consequence, validation is inline and specific. Nits: onboarding Continue leaves focus on the button (not the invalid field), Copy code is a small link. |

## Round-5 / parent-brief rechecks (observed on the saved build)

| Item | Result | Evidence |
|---|---|---|
| Complete saved title from actual Tab entry, no row growth or shift | **Passed.** Renamed a thread (196 characters typed). Tabbing Search > Filter > Add project > New thread > row 1 > row 2 > row 3 shows a wrapping tooltip with the full 120-character saved title on the third row, rows stay 44 px at tops 60 / 108 / 156 throughout, tooltip box 360 x 54 inside the viewport. Escape removes it (0 tooltips) and focus stays on the row. | `018`, `022`, `023`, `d2.mjs` |
| Title / effort tooltip dismissal | **Passed.** Escape clears the title tooltip and the effort tooltip (0 `[role=tooltip]`). Effort tooltip appears on hover and on keyboard focus after the menu closes ("Effort: Low"). Nit: focused row tooltip and hovered row tooltip appear together (`020`, two tooltips, one overlapping the neighbouring row). | `005`, `007`, `008`, `020` |
| Effort stable width and caret | **Passed.** Button box is 86.17 x 30 at rest ("Auto") and after choosing Low; caret sits right after the word. | `005`-`008`, `b.mjs` |
| Overlay Tab forward / reverse, no BODY or resizer stop | **Passed.** At 900x700 with the panel open, 24 Tab and 24 Shift+Tab steps cycle Skills tab > Refresh > Add skill > repo-notes > loaded > Inherited > Side panel. 0 BODY stops and 0 separator stops. `aside.sidebar`, the resizer wrapper and `.main` are `inert`; Escape closes and returns focus to the Side panel button. | `027`, `028`, `f.mjs` |
| Settings releases its focus boundary | **Passed.** Panel open > MCP tab > "Manage MCP servers" opens Settings with `inert` count 0 and Tab walks the Settings nav and page. | `226`, `sk.mjs` |
| Limits returns to originating Settings section with focus | **Passed.** From Profiles: Close returns to Profiles with focus on its Limits nav entry; Escape does the same. Nit: the Limits page still shows its own chrome (close x, sidebar thread list) rather than Settings. | `043`, `044`, `045` |
| Dirty "Keep editing" must never save | **Passed.** After Keep editing, reload while dirty: profile list shows unchanged `Personal`. | `050`, `051` |
| Discard persists nothing | **Passed.** Edit, nav away, Discard: list and reopened editor show `Personal`; Back-with-dirty prompt also discards cleanly. | `053`, `054`, `055` |
| Text-field Escape prompts | **Passed.** Typing then Escape in Name shows "Discard changes? Keep editing / Discard" as `group "Discard changes?"`, focus on Keep editing; Keep returns focus to Save with the edited value. | `049`, `050` |
| Clean Escape focuses originating row | **Not met.** Clean Escape from Profiles, Accounts, Projects, MCP servers and Machines editors (mouse or keyboard open) lands focus on the breadcrumb (`nav.crumbs`, ring drawn around "Settings / Profiles"), not the row I opened. Clicking the breadcrumb link does return focus to the row. See finding A2. | `056`-`061`, `j.mjs`, `k.mjs` |
| Project Preview command Enter saves | **Passed.** Edited the delivery project's Preview command, Enter saved, returned to the Projects list; after reload the field read the new value. Restored afterwards. | `064`-`066`, `l.mjs` |
| Broken managed tool refuses existing-thread send, draft kept, no bubbles, no Failed | **Passed.** Existing thread `Inline chat fixture`: Enter twice, 0 new user bubbles, draft `Hello again` still in the composer, sidebar row still `Ready`, notice "Broken tool is not ready. A repair thread was started. Open repair thread". | `075`-`077` |
| Blocked fresh draft creates no orphan | **Passed.** Draft in a new thread, Enter: sidebar list identical before and after (4 rows), draft text kept, same notice. | `079` |
| Repair link spacing, opens repair thread, display name | **Passed.** Link follows a space; opens `Repair Broken tool` (one repair thread reused across repeated sends). | `074`, `078` |
| 36 px Choice label-row pick and media controls | **Passed.** Pick rings measured 36 x 36 (A / B / C), Open 47 x 36, Download 72 x 36. Pick adds a "check" chip to the composer; Send sends "I pick C…". Nit: hovering the label shows the ring's check but clicking the label text does nothing. | `104`-`111`, `u*.mjs` |
| Queue Save primary | **Passed.** Save is filled `rgb(222,223,227)` on dark text, Cancel is the secondary fill. | `115` |
| Neutral scope status | **Passed.** Profile skills show "On for Personal" / "Optional"; panel shows "Repository" and "Profile · Library" in the same grey; only "Loaded" is tinted. | `047`, `103`, `153` |
| Full-width tool cards, chevron Details | **Passed.** Machines card spans the form width; Details is a `<details>` summary (tabindex 0) with a chevron that turns when open. | `071`, `082` |
| Invalid focused fields red | **Passed.** Add tool: focused first invalid input has `border-color rgb(196,127,132)` and a 2 px outline of the same colour; Add hub, Add project and Add skill source show the same pattern. | `069`, `092`, `157` |
| MCP delete consequence | **Passed.** Confirm reads "Threads lose this server's tools and its saved sign-in." with Cancel and "Delete docs-search". | `087` |
| Copy pairing code | **Passed.** Copy code puts `5F97-2897-2B39-BC30` on the clipboard and the link reads "Copied". | `089`, `090` |
| Expanded Settled shelf first row at 500 px | **Passed.** With 6 active + 3 settled threads at 1280x500 the first settled row is at 384-428, above the footer at 460, fully visible. | `138` |
| Onboarding project-added status does not shift dots | **Passed.** Dots at (636, 551) before and (636, 552) after in the 1440x1000 runner window; "Added verify-project." takes the same row as "Set up a project first" (top 493 in both). 1 px sub-pixel change only. | `203`, `210`, journey output |

## Findings by category (ordered by impact)

### 7 Accessibility
1. **Hit targets below 36 px** (`sj.mjs`, `x.mjs`, `v.mjs`): queue tray Steer now 61 x 25, Edit 28 x 25, Remove 21 x 25, Stop/Send 30 x 30; row hover Snooze/Settle 24 x 24; Thread actions 28 x 28; Limits chip 67 x 26; Copy code 59 x 18. The Choice and media controls were raised to 36 px, so the product now has two scales. Smallest fix: `min-height: 32-36px` (or transparent padding) on those buttons.
2. **Clean Escape lands on the breadcrumb, not the row** (`061`). The ring is drawn around "Settings / Profiles", which is not a control. Smallest fix: restore focus to the list row that opened the editor on Escape, exactly as the breadcrumb click already does.
3. **Focus drops to `BODY`** on Settings entry (`g.mjs`) and after Generate pairing code (`q.mjs`). Smallest fix: focus the page heading / Copy code control.
4. **Refusal notice is not announced.** ARIA tree: `text: Broken tool is not ready. A repair thread was started.` plus a button (`076-blocked-send-1.aria.yml`). Smallest fix: `role="status"` or `alert` on the notice.
5. Contrast spot checks pass: sidebar subtitle 11.4 : 1, placeholder 5.53 : 1, Limits chip 6.35 : 1, header chip 9.8 : 1.

### 3 Consistency
1. **Limits from Settings** still shows its own chrome (close x, sidebar thread list, no Settings nav) (`043`). It now returns correctly, so this is a nit. Smallest fix: render it inside the Settings shell.
2. **Model chip has no chevron, effort chip does** (`007`, `005`). Smallest fix: same pattern on both, or none.
3. **Three delete-confirm layouts** remain (footer swap, in-row hub/checkout, in-menu thread). Kept by decision; wording is uniform ("Cancel" + "Delete X").
4. Tooltips: focus and hover can show two at once (`020`). Smallest fix: one tooltip at a time.

### 4 Clarity & discoverability
1. **Onboarding account step has no Back** (`203`; buttons are Continue and "Set up a project first"). Continue starts a real provider login. Smallest fix: quiet Back link.
2. **Long rename is silently cut at 120** (196 typed; header shows "…queued and t", `024`). Smallest fix: `maxLength` on the field with a remaining count, or cut at a word with an ellipsis.
3. **Choice label looks clickable** (`109`: hovering "C · Grouped by provider" shows the ring's check). Clicking the label picks nothing. Smallest fix: make the whole label row the pick target (the brief's "label-row pick" intent) or stop previewing the check on label hover.
4. **"Open app" shows no in-app acknowledgment** (`131`): clicking it changed nothing visible in the browser (popups not tracked). Smallest fix: brief status or toast ("Opening preview on port N").
5. **Stale "Editing" label** on a queued message after Stop and reload, with no editor open (`118`).
6. A refused send shows the notice just above the composer; the link sits on the same line and works (`074`).

### 5 Feedback & state
1. **Working line moves** from the top of the turn (`112`) to below the steered reply after a steer (`115`). Smallest fix: always render it after the last item.
2. Everything else is acknowledged and calm: Working > Interrupted + Resume (`118`, `119`), paused queue, Waiting for merge · #123 (`142`), "Automatic fixes stopped · still tracking #123 · checked just now" (`148`), CI step 2 of 4 then Shipped after Check now (`144`-`147`), Shipped to main (`133`), Snoozed until tomorrow 09:00 + Undo (`212`), refused send with specific cause and preserved draft (`074`).

### 9 Forms & dialogs
1. **Onboarding empty Continue** shows the red field and message but keeps focus on Continue (`202`; `EMPTY FOCUS` BUTTON). Smallest fix: focus the invalid input.
2. **Copy code** is a 59 x 18 link (above).
3. Add project dialog Tab order: input > Cancel > Add > (browser/BODY) > Close > input (`sf.mjs`); that is native modal wrap, not a defect to fix.

### 1 Minimalism / calmness
1. New-thread picker hint bar "↑ ↓ Navigate · Enter Select · Esc Close" (`015`).
2. Add secret still carries five helper lines (`097`).
3. "Open app" pill beside Ship / Reopen / Archive (`129`, `133`); kept by decision.

### 2 Visual hierarchy & typography
Clear steps everywhere I looked. Nit: a 120-character title is cut at a character, not a word (`024`, header), and the skill source path ellipsis reads "accio-chat… C\skills-library" (`103`, `217`).

### 6 Efficiency & flow
Ctrl+N opens the picker with focus in Search, Esc returns focus to the previous control; Enter steers, Ctrl+Enter queues; Enter saves the Preview command and returns to the list; pick sends with one Enter; Shift+Tab from the first overlay control wraps to the toggle. Nit: Escape from a clean editor goes to the breadcrumb (above). After a Discard-on-nav the focus lands on the first row of the destination page (`053`).

### 8 Layout robustness
No horizontal overflow measured at 900x700, 1280x900, 1600x1000 and 1280x500 (thread, profile editor, Add secret). Compact profile editor fits at 900x700 above the sticky footer (`170`). Short height: settings forms scroll under a sticky footer (`178`), thread composer stays in view (`175`). Nits: header truncates the project chip and title at 900 and with the panel open (`026`, `153`); Tool Details card nearly touches the sticky footer when expanded (`082`); the "Jump to latest" pill overlays text (`125`).

## Top 5 changes
1. Raise small controls (queue tray, row hover actions, Thread actions, Limits, Copy code) to a 32-36 px hit area (Accessibility, Consistency).
2. Make Escape from a clean editor focus the originating row, and give Settings entry / pairing-code generation a real focus target instead of `BODY` (Accessibility, Efficiency).
3. Add `role="status"` to the refusal notice and keep the Working line after the last turn item (Accessibility, Feedback).
4. Add a Back link to the onboarding account step and focus the invalid field on onboarding Continue (Clarity, Forms).
5. Stop silently cutting long titles (`maxLength` with count), make Choice labels either clickable or non-hover-previewing, and give "Open app" an acknowledgment (Clarity).

## Objections
- I cannot call the "clean Escape focuses originating row" recheck met. The parent plan allows the originating row "or breadcrumb", so the behaviour may be as intended; the brief's wording and the visible ring around a non-control are why I record it as not met and a nit, not a regression.
- Score 9 in Feedback assumes the stale "Editing" label and the Working-line jump are nitpicks. A stricter auditor could reasonably hold that at 8.

## Unreachable, unverified, omitted
Each item is stated with its reason; none of these was unreachable because the fixture lacks the control.
- **Provider and hosting boundaries are fixtures:** no live sign-in, no real GitHub. Account Sign in / Sign in again / Sign out were not clicked (they open an external provider). MCP Sign in (OAuth) not clicked. Add hub with a real code was only validated empty. A second machine and remote-hub behaviour were not driven (single local machine).
- **Native / assistive:** Electron window controls, native Browse picker, OS file open for media Open/Download, screen reader announcements, light / high-contrast / reduced-motion modes and native tooltip appearance were not tested. Playwright cannot show native `title` tooltips; the app's own tooltips were captured.
- **Available but not exercised** (fixture reachable, I did not drive): Archive and Reopen buttons on the Shipped thread; Copy as Markdown; thread Rename cancel path; image "Expand image" viewer and media Open/Download clicks; Machine rename save and Add Profile folder; Cancel delivery; Check for updates and Copy into project in the Skills library; Skill "Enable for…" Save; panel Add skill's enable action and Edit instructions Save; Harness page interactions (viewed only); light-weight final confirmations of deletion for thread, profile, checkout, hub, MCP server and skill source (I opened each confirm and cancelled). The tool delete was confirmed on purpose.
- **Not tested at all four sizes:** Add skill source, Add MCP, Hubs add form and thread/queue-tray states were captured at 1280 only; 1600, 900 and short height cover home, thread, review bar, picker, profile detail, Add secret, Hubs and Limits.
- **Fixture side effects (mine, inside my temp home):** threads created and one renamed (long title, stored at 120), snoozed and settled threads, a managed tool `Broken tool` created and deleted (its install did a real registry lookup against `registry.npmjs.org` for a non-existent package and returned E404, i.e. one request outside the fixture boundary), one pairing code generated, the delivery project's Preview command edited then restored, one delivery shipped, one review PR prepared, one CI delivery shipped.
- **Cleanup:** I stopped my own server (PID 27004, `taskkill`, so the server's own cleanup hook did not run). I closed every Playwright browser at script end and closed the preview tab. I removed `out/chat-test-47681.json`. The temp home `%TEMP%\accio-chat-browser-5bCxwC` is only partly deleted: one workspace folder is busy. "Open app" starts a `previewRunner` child; two orphaned `node preview.cjs` processes (PIDs 12276 and 4776) exist and I could not attribute them to my server versus the other auditors', so I left them alone. Another auditor's preview runner (PID 8636, home `…D3DHYp`) is not mine.
- **Source and build timestamps:** `git log -1` was `037f47b` throughout; `git diff --stat` was empty at the end. The saved build and `apps/web/dist/index.html` had identical hashes at start and end; I made no mixed-build comparisons.

## Evidence index (`out/ui-audit/round-6/sonnet/`)
- `001`-`009`: home, inline thread, tools expanded, effort hover/menu/pick, model picker.
- `010`-`015`: row hover and context menu, Filter, Search results and none, New-thread picker.
- `016`-`024`: rename input, renamed row, Tab-entry title tooltip, Esc, hover tooltip (two tooltips), header title.
- `025`-`029`: 900 home, thread and side-panel overlay, Tab loop, closed.
- `030`-`042`: every Settings section at 1280. `043`-`046`: Limits return. `047`-`061`: profile editor, dirty guard, keep / discard, clean Escape focus.
- `062`-`066`: Projects, project page, Preview command Enter. `067`-`071`, `080`-`084`: tools list, Add tool validation, broken tool, Details, delete confirm.
- `072`-`079`: refused sends, repair thread, blocked fresh draft. `085`-`087`: MCP list, detail, delete consequence. `088`-`092`: Hubs, pairing code, Copied, Add hub.
- `093`-`103`, `218`-`222`: Add profile / account / secret / MCP / skill source, harnesses, machine, system prompt, skills library.
- `104`-`111`: Choice. `112`-`119`: steering, queue, edit, Stop, Resume. `120`-`126`: streaming, explore tools, long context.
- `127`-`133`: delivery. `134`-`138`: 500 px Settled shelf. `139`-`149`: review, CI, stopped fixes. `150`-`157`: thread actions, side panel, MCP tab, project settings, Add project sheet. `158`-`181`: 1600, 900 and short views. `200`-`210`: fresh-home onboarding. `211`-`217`, `223`-`226`: delete confirms, snooze, skill enable, panel add skill, Settings from overlay.
