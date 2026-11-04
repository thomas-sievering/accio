# UI / UX audit, round 1, model `sonnet`

Method: populated fixture server (port 4711) driven with Playwright at 1280x900, 1600x1000, 900x700 (plus 1280x500 for height); first-run onboarding via the 3-verify runner. Screenshots are in `out/ui-audit/round-1/sonnet/`. Only the dark theme was reviewed.

## Scores

| # | Category | Score | Verdict |
|---|----------|-------|---------|
| 1 | Minimalism / calmness | 8 | Very quiet palette and sparse chrome. Marred by leaked raw JSON, a raw ISO timestamp, an always-visible disabled Ship pill and the permanent "Owl, coming soon" button. |
| 2 | Visual hierarchy & typography | 8 | Clear title / body / meta steps and a good transcript measure. Tool rows and settled rows are low contrast; settings intro paragraphs float without a consistent pattern. |
| 3 | Consistency | 7 | Strong card/row language in settings, but brand casing (`accio` vs `Accio`), duplicated Accounts/Profiles icon, mixed link/button styles, "Delete thread..." vs "Delete for good" vs "Remove", Hubs uses a different form pattern. |
| 4 | Clarity & discoverability | 7 | Hover-only unlabeled clock/check icons, cryptic "auto" next to the model, model picker opens on an empty Favourites tab, collapsed Snoozed/Settled shelves have no affordance. Empty states are good. |
| 5 | Feedback & state | 8 | Working / Interrupted / Waiting for merge / CI step / Shipped are distinct and calm. Raw JSON and ISO time leak into status lines; snoozing gives no confirmation. |
| 6 | Efficiency & flow | 8 | Enter to send, Ctrl+Enter queue, Steer now, Escape all work. Model picker keyboard entry is weak; no effort control was reachable; Settings opens on Profiles. |
| 7 | Accessibility | 7 | Good ARIA names, visible focus rings, menus return focus. Small low-contrast meta text, 22-26px hit targets, tab order reaches the sidebar last, two main landmarks in Settings, native validation bubble. |
| 8 | Layout robustness | 7 | No horizontal overflow at any size; long URLs wrap. At 900 wide with the side panel open the thread column is about 300px and "auto" wraps above "Limits"; at 500px tall the Settled shelf collides with the footer. |
| 9 | Forms & dialogs | 8 | Escape / X / Cancel behave and return focus; thread delete is a calm two-step. Validation is a native bubble, not inline; onboarding Continue is silently disabled. |

## Findings by category (ordered by impact)

### 1 Minimalism / calmness
1. Raw JSON leaks into the transcript: `Resources for this turn: {"tools":[],"skills":[{"id":"library:lib-docs","revision":"1d33..."}],"mcps":[...]}` appears centred above the first reply (`07-tools-expanded.png`, `17-steering.png`, `20/21-explore-*.png`, `22-tool-expanded.png`) and is merged into the amber "Stopped." bar (`19-stopped.png`). Fix: render it as a quiet chip ("1 skill, 2 MCP servers") or hide it unless expanded.
2. The settled message shows a raw ISO timestamp: "Shipped to main · 56eca9f · 2026-11-03T23:47:05.438Z. Thread settled; workspace retained." (`30-delivery-t3.png`), duplicating the pill directly below ("Shipped to main 56eca9f" and "Thread settled · Workspace retained"). Fix: drop the centred line or format the time relatively.
3. A disabled `+0 -0 | Ship | v` pill is shown on a thread with nothing to ship (`13-side-panel.png`, `62-900-sidepanel.png`). Fix: hide delivery controls until there is a diff.
4. The disabled "Owl, coming soon" footer button is permanent decoration (`01-home-1280.png`). Fix: remove until it exists.
5. Onboarding keeps the full live sidebar (search, filter, settings) beside a 4-step wizard (`70-onb-1-welcome.png`). Fix: hide or dim it during setup.

### 2 Visual hierarchy & typography
1. Settled shelf rows are dimmer than the active list and the project is truncated ("Build delivery fixture  deli...") (`59-archived.png`). Fix: lift contrast, drop the coloured "main" chip or put the project on its own line.
2. The collapsed "Worked for <1s >" row is about 12px at low contrast and is the only way to reach tool output (`06-inline-thread.png`). Fix: use the body-meta colour; keep failures red.
3. The expanded tool call panel is a narrow (about 150px) box in a 750px column (`22-tool-expanded.png`). Fix: let it span the transcript width.
4. Settings pages vary: some start with an intro paragraph (Tools, MCP servers, Skills, Machines, Harnesses), others with a heading (Profiles, Accounts), and the heading duplicates the breadcrumb ("Settings / Tools" then "Tools") (`44`, `45`, `46`, `38`). Fix: one pattern.
5. Choice thumbnails are about 225x140 and the mock text is unreadable (`11-choice.png`). Fix: larger cards or click-to-enlarge.

### 3 Consistency
1. Brand casing: "Set up accio", "Where should accio keep your accounts?", "accio installs...", "accio runs the executable..." vs "Accio's built-in...", "Deleting removes Accio's copy" (`70-onb-1-welcome.png`, `44-settings-Tools.png`, `53-add-tool.png`, `42-settings-System-prompt.png`). Fix: "Accio" everywhere.
2. Accounts and Profiles share the same two-people icon in the Settings nav (`38-settings-Accounts.png`). Fix: distinct icon for Accounts.
3. Destructive wording: "Delete thread..." becomes "Delete for good" in place (`03-row-context.png`, `57-delete-thread-confirm.png`), settings use "Delete", project checkouts use a red outlined "Remove" (`56-project-settings.png`) and Hubs uses an underlined text link "Remove" (`47-settings-Hubs.png`). Fix: one verb and one button style.
4. Hubs is the only page with permanent inline forms (Add hub, Pair another device) while every other page uses "Add X" row then sub-page (`47-settings-Hubs.png`). Fix: same row pattern.
5. The header icon cluster moves: with the side panel open the toggle jumps into the panel (x=1123 inside the panel vs the main header) and the "..." thread menu shifts (`06-inline-thread.png` vs `13-side-panel.png`). Fix: keep the toggle in one place.
6. Limits is a full page that replaces the thread (with its own X), while the composer "Limits" control reads like a popover (`09-limits-popover.png`). Fix: label it as a page or make it a popover.

### 4 Clarity & discoverability
1. Row hover actions are an unlabeled clock and check (snooze, settle); the accessible names only exist in the context menu (`03-row-context.png`, `11-choice.png`). Fix: tooltips plus aria-labels.
2. "auto" beside the model name is unexplained and no effort control was reachable (`08-model-picker.png`, `26b-after-select.png`). Fix: show "Effort: auto" in the picker or hide the label when there is nothing to choose.
3. The model picker opens on an empty "No favourites yet" tab when nothing is starred (`25-model-keyboard.png`); ArrowDown does not move into the list. Fix: open on the active provider and focus the selected model.
4. Snoozed / Settled shelves are bare text labels with counts, no chevron; snoozing a thread silently moves it (`34-snoozed.png`). Fix: chevron plus a brief "Snoozed until morning" acknowledgement.
5. The Add project dialog is a bare path field with `S:\my-repo` placeholder and no browse (`55-add-project.png`). Fix: add Browse where available.
6. Steering vs queue semantics: Enter while running steers ("Steered mid-turn"), Ctrl+Enter queues "after this turn"; the composer does not say so (`17-steering.png`, `18-queue-tray.png`). Fix: a hint "Enter steers, Ctrl+Enter queues".

### 5 Feedback & state
1. The Working shelf is pinned at the bottom of the sidebar, far from the top of the list where the thread also sits conceptually (`15-streaming-a.png`). Spinner in row and "Thinking" in the transcript header are good, but the location makes running threads easy to miss. Fix: Working above Ready.
2. Stop lands as an amber "Interrupted" row and a bar with Resume (`19-stopped.png`) - calm and clear, but the bar contains the raw JSON noted above.
3. Delivery states ("Ships when done" with spinner and X, "CI · image · Build image · step 2 of 4", "Waiting for merge · #123" with Check now and Stop automatic follow-ups, "Shipped to main" with Reopen / Archive) are unmistakable (`29d`, `32-ci-t3`, `31-review-t3`, `30-delivery-t3`). Minor: the clicked Ship pill keeps a bright focus ring after activation (`29d-ship-after.png`).
4. Validation uses the native browser bubble "Please fill out this field" (`50-add-profile-validation.png`). Fix: inline message under the field.

### 6 Efficiency & flow
1. Starting a thread is New thread then pick project (or No project) then type: good. Enter sends; Escape closes the model picker and returns focus to the trigger (`08b-after-esc.png`).
2. Model picker keyboard: ArrowDown after opening does not move within the list (`25-model-keyboard.png`).
3. Settings opens on Profiles rather than the first item (`37-settings.png`) and the nav order (Accounts, Secrets, Profiles) is not the task order. Fix: open on the first item or reorder.
4. Thread rename opens a free-floating input that overlaps the neighbouring row while another row's hover actions show (`58-rename.png`). Fix: inline rename in the row.
5. Unreproduced: once in a long scripted session Enter did not send a freshly typed long prompt (`63-900-longtitle.png`, `63-1600-longtitle.png`); I could not reproduce it in isolation (`66`, `67`, `68`, `69` all sent). Worth a manual check.

### 7 Accessibility
1. Two `main` landmarks exist while Settings is open (Playwright strict-mode violation on `locator('main')`). Fix: one landmark.
2. Tab order starts in the composer (model, Limits, Side panel) and reaches the sidebar last. Fix: sidebar first in DOM order, or add skip links.
3. Meta text (row sub-labels about 11px, shelf headings, hints under fields) is low contrast (`01-home-1280.png`, `47-settings-Hubs.png`). Fix: lift the meta colour toward 4.5:1.
4. Hit areas: hover icons about 22px, Open/Download links about 10px text (`06-inline-thread.png`). Fix: at least 28px targets.
5. Positives: visible focus ring on the model picker, Escape restores focus, buttons have names ("Thread actions", "Resize sidebar", "Cancel queued delivery", "Remove queued message").

### 8 Layout robustness
1. 900x700 with the side panel open: sidebar 270 + panel 320 leaves a thread column of about 310px, the breadcrumb truncates to "skills-pr..." and "auto" wraps above "Limits" in the composer (`62-900-sidepanel.png`, `63-900-longtitle.png`). Fix: auto-collapse the sidebar below about 1000px or make the panel an overlay; keep the model/effort label on one line.
2. 1280x500: the "Settled" shelf label is clipped under the footer icons (`61-short-inline.png`, `63-short-longtitle.png`). Fix: shelves inside one scroll region, footer fixed.
3. Long unbroken URLs and long prompts wrap inside the composer without horizontal overflow at all three widths (`63-1600-longtitle.png`, `67-long-url-sent.png`); `scrollWidth > innerWidth` was false everywhere.
4. Project names truncate to "revi..." / "deli..." when a status chip is present (`31-review-t3.png`). Fix: truncate the title first or put the status on its own line.
5. 1600x1000: transcript stays 750px and centred; generous whitespace stays calm.

### 9 Forms & dialogs
1. Add project and project settings dialogs close with Escape / X / Cancel and focus returns to the trigger (`55b-add-project-esc.png`). Good.
2. Native validation bubble (5.4) and a silently disabled onboarding Continue with no hint when the profile name is empty (`71-onb-2-profile.png`). Fix: inline "Name required".
3. Project settings: a red "Remove" beside the checkout path has no visible confirmation and the "Skills" section repeats an uppercase "SKILLS" sub-heading (`56-project-settings.png`). Fix: label it "Remove checkout" with confirm; drop the duplicate heading.
4. Account detail: "Delete" is disabled for an in-use account with the reason in small text (`51-account-detail.png`) - sensible.
5. Thread delete is a calm two-step in the context menu, no modal nagging (`57-delete-thread-confirm.png`).

## Top 5 changes
1. Stop leaking machine text into the UI: the raw `Resources for this turn: {...}` JSON (also inside the Stopped bar) and the ISO timestamp in the settled message (Minimalism, Feedback, Hierarchy).
2. Make controls self-explanatory: tooltips and aria-labels on the hover clock/check icons, a labelled effort control instead of "auto", a model picker that opens on the active provider with arrow-key support, chevrons on the Snoozed/Settled shelves (Clarity, Accessibility, Efficiency).
3. Fix 900px and short-window layout: collapse the sidebar or overlay the side panel under about 1000px, keep the composer model label on one line, put shelves in the scroll region so they never collide with the footer (Layout).
4. Normalise wording and patterns: "Accio" casing everywhere, a unique Accounts icon, one delete/remove verb and button style, Hubs on the same row-to-page pattern, one settings page header pattern (Consistency).
5. Replace native validation bubbles and the silent disabled onboarding Continue with inline messages; remove permanent clutter (disabled Ship pill without a diff, "Owl, coming soon"); fix a11y basics (single main landmark, sidebar-first tab order, higher meta-text contrast) (Forms, Minimalism, Accessibility).

## Unreachable / not covered
- Onboarding account sign-in and "Add first project" steps need a real Claude/ChatGPT login; I reached the account-choice step only (`70-onb-1-welcome.png`, `71-onb-2-profile.png`, `72-onb-3-account.png`).
- Real Open/Download of media, the Electron window-controls inset (the empty gap at the right of the header is probably that), and the Codex harness UI were not exercisable with the fake harness.
- No effort control appeared for any fake-harness model, so effort selection was not exercised.
- The failed tool-call body was not expanded; the settled-thread Reopen button was seen but not clicked.
- Light theme, high-contrast and reduced-motion modes were not checked.
