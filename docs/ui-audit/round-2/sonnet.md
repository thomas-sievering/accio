# UI / UX audit, round 2, model `sonnet`

Method: populated fixture server (port 4722) driven with Playwright at 1280x900, 1600x1000, 900x700 and 1280x500, dark theme only. First-run onboarding via the 3-verify runner (journey in `out/ui-audit/round-2/sonnet/j/journey.mjs`). Screenshots are in `out/ui-audit/round-2/sonnet/` (numbered by view; `s/` holds the scripts).

## Scores

| # | Category | Score | Verdict |
|---|----------|-------|---------|
| 1 | Minimalism / calmness | 9 | Raw JSON, ISO time, dead Owl button, disabled Ship pill and onboarding sidebar clutter are all gone. Remaining: an always-visible "auto" chip, the "Jump to latest" pill, a lone "SKILLS" sub-heading. |
| 2 | Visual hierarchy & typography | 8 | Clean title/body/meta steps, captions under media are tidy, settings share one left edge. Expanded tool output is still a ~150px box and settled rows are truncated. |
| 3 | Consistency | 8 | Accio casing, Accounts icon, Hubs row pattern and the settings footer are consistent. Still: Profiles has no intro while Tools/Machines do, "Delete thread..." then "Delete for good", Remove (hubs) vs Remove checkout (project) styling, sublabel project truncation differs per state. |
| 4 | Clarity & discoverability | 8 | Effort control, model picker, shelf chevrons, steering placeholder and Ship-mode menu are clear. Remaining: lowercase "auto" chip does not look like a control, the hover clock/check have no visible label, snoozing gives no acknowledgement, Choice thumbnails still unreadable. |
| 5 | Feedback & state | 8 | Working / Interrupted / Waiting for merge / CI step / Shipped read well and calmly; inline "Name required". Gap: a first Enter in a freshly opened draft is silently dropped (see Efficiency); no snooze toast. |
| 6 | Efficiency & flow | 7 | Ctrl+N, tab order starting in the sidebar, model picker arrow keys, Settings opening on the first item and mode-then-ship are all good. A real bug: pressing Enter within about a second of opening a draft after viewing another thread silently does nothing (text stays, no error). Rename is still a floating input. |
| 7 | Accessibility | 8 | Single main landmark, sidebar-first tab order, named hover buttons, dim text now #8f9099/#9a9ba3 on #18191d (about 5.5:1+), focus returns after Escape. Hit targets for Open/Download and hover icons are still small; disabled Delete is very faint. |
| 8 | Layout robustness | 8 | No horizontal overflow at 900/1280/1600; shelves no longer collide with the footer at 500px tall; side panel overlays at 900. Overlay hides the thread's header menu and part of the composer; row sublabel loses the project name (`revi...`, CI step text replaces it). |
| 9 | Forms & dialogs | 9 | Inline "Name required" in profile and onboarding, one detail footer (Delete left, Cancel/Save right) with the in-use reason beside Delete, Escape/Cancel/X work and return focus, crumb opens project settings. Nitpicks: project settings still has a duplicate "SKILLS" heading and a cramped checkout row. |

## Round-1 findings: fixed / not fixed

Fixed (verified on screen):
- Raw `Resources for this turn: {json}` in transcript and Stopped bar: gone; Stopped bar says only "Stopped." + Resume (`17-stopped.png`).
- ISO timestamp in the settled message: replaced by "Shipped to main · 83ae3f7"; one pill plus "Thread settled · Workspace retained" (`28-ship-after.png`).
- Disabled `+0 -0 Ship` pill: not shown on threads without a diff (`06`, `62`).
- "Owl, coming soon" button: removed (`01-home-1280.png`).
- Onboarding sidebar: controls hidden, "Accio" casing, inline "Name required" (`81`).
- Accio/accio casing, Accounts distinct icon, Hubs uses an "Add hub" row, Settings opens on Accounts, one `main` landmark.
- Hover clock/check now have names ("Snooze", "Settle"); shelves have chevrons; Settled shelf sits inside the list area and no longer overlaps the footer at 500px (`62-short.png`).
- Model picker opens on the active provider, ArrowDown/Up move through models; labelled "Effort: Auto" menu with Auto/Low/Medium/High/Extra high/Max (`09-effort.png`).
- Steering hint is the running placeholder "Enter steers · Ctrl+Enter queues" (`14-queue.png`).
- Media caption row with name, size, Open, Download directly under each item (`02-inline.png`).
- Tab order starts in the sidebar; Ctrl+N opens the new-thread picker; project crumb opens project settings; Filter gears always visible.
- Choosing "Prepare for review" only sets the button label; the main button starts it (`29`).
- Side panel overlays at 900px instead of squeezing the thread (`61-900-sidepanel.png`); composer label stays on one line.

Not fixed or only partly fixed:
- Expanded tool call is still a narrow ~150px box with wrapped output (`90-tool-expanded.png`).
- Row sublabel still truncates the project ("revi...") and CI progress replaces the project name entirely (`31-review-waiting.png`, `32-ci.png`); Settled row still shows "deli..." (`28`).
- "Auto" is still a bare lowercase text next to the model; it reads as a label, not a control.
- Snoozing still gives no acknowledgement (`72-snoozed.png`); only a new "Snoozed 1" shelf appears.
- Rename is still a floating input offset from the row while another row shows hover actions (`71-rename.png`).
- Context menu says "Delete thread..." then "Delete for good" (`73`); Hub "Remove" is a plain button while project uses a red "Remove checkout".
- Project settings: duplicate uppercase "SKILLS" heading, checkout path hugs the left edge (`55-project-settings.png`).
- Choice thumbnails are still about 225x140 with unreadable text (`05-choice.png`).
- Intro paragraph pattern still differs: Profiles / Accounts / Secrets have none, Tools / Machines / System prompt have one.
- The unreproduced round-1 "Enter does not send" is now reproduced (see below).

## Findings by category (ordered by impact)

### 6 Efficiency & flow
1. Silent dropped send: open a thread, click New thread, pick No project, fill text and press Enter immediately. The text stays in the composer and nothing is sent; pressing Enter again, or waiting about 1s after picking, works (run `s/h.mjs`; `18-stream.png` and `19-stream-done.png` show the stuck draft). Fix: queue the Enter until the draft is ready, or keep the Send button/Enter live and show an error.
2. Rename opens a free-floating input (`71-rename.png`). Fix: inline edit inside the row.
3. Positives: Enter sends, Ctrl+Enter queues, Steer now works, Escape closes pickers, Ctrl+N works.

### 8 Layout robustness
1. At 900 with the side panel open the overlay covers the thread header menu and the Limits control (`61-900-sidepanel.png`). Fix: leave a visible gap or a scrim and close on outside click.
2. Sidebar rows lose the project name when a status is present (`31`, `32`). Fix: status on its own line or truncate the title first.
3. With many threads the 900x700 sidebar clips the last row under the footer (`91-900-longtitle.png`), though it scrolls.

### 2 Visual hierarchy & typography
1. Expanded tool output narrow box (`90-tool-expanded.png`). Fix: span the transcript column.
2. Settled shelf row is dimmer and truncated (`28`). Fix: give the project its own line.
3. "Worked for <1s" separators are tiny but now readable.

### 4 Clarity & discoverability
1. "auto" chip (`02-inline.png`). Fix: render as "Effort: Auto" or an icon with tooltip, hide when only Auto exists.
2. Snooze/Settle hover icons rely on tooltips (`03`, not captured visually). Fine, but no feedback after Snooze.
3. Add project dialog is a path field only (`53-add-project.png`); acceptable in web mode.

### 3 Consistency
1. Delete verbs and Remove styles (see above). 2. Intro paragraph pattern. 3. "Jump to latest ↓" pill style differs from the other pills (`06-tools-expanded.png`).

### 5 Feedback & state
Good across running, stopped, queue, delivery, CI, review. Add a snooze acknowledgement. The Ship button is enabled while the thread is still Working (`24-delivery-ready.png`), which is allowed but slightly surprising.

### 7 Accessibility
Hit targets: Open/Download text links (~10px high), Snooze/Settle (~22px), disabled Delete is nearly invisible (`50-account-detail.png`). The effort menu overlaps content without a scrim (`09-effort.png`).

### 9 Forms & dialogs
Add profile validation inline (`52-add-profile-validation.png`), Add secret form is clear with "Purpose key" (`93-add-secret.png`), but it is long; Value being last is fine. Project settings duplicate heading.

### 1 Minimalism / calmness
Remaining noise: "auto", "Jump to latest ↓" lingering while at the top of a long thread, the extra "Open app" pill beside Ship (`24`).

## Top 5 changes
1. Fix the silent dropped Enter in a freshly opened draft (Efficiency, Feedback).
2. Make expanded tool output span the transcript width (Hierarchy, Minimalism).
3. Stop sidebar sublabels truncating the project name when a status shows ("revi...", CI text replacing the project); put status on its own line (Layout, Consistency).
4. Replace the bare "auto" chip with a clearly labelled effort control, and add a snooze acknowledgement (Clarity, Feedback).
5. Polish leftovers: inline rename, one delete/remove vocabulary and style, drop the duplicate "SKILLS" heading, consistent settings intro pattern, larger Open/Download hit targets (Consistency, Accessibility, Forms).

## Unreachable / not covered
- Real account sign-in and the "Add first project" onboarding steps (need real logins); I stopped at the account choice (`82-onb-3-account.png`).
- Real Open/Download of media, Electron window controls, Codex harness UI.
- Failed tool-call body, Tool install failure details, Reopen click, and light / high-contrast / reduced-motion modes were not exercised.
