# UI / UX audit, round 3, model `sonnet`

Method: populated fixture server (port 47631) driven with Playwright at 1280x900, 900x700, 1600x1000 and 1280x500, dark theme only. First-run onboarding via the 3-verify runner (journey in `out/ui-audit/round-3/sonnet/j/journey.mjs`). Screenshots are in `out/ui-audit/round-3/sonnet/` (numbered by view; `s/` holds the scripts). I judged what is on screen, not what the plan says.

## Scores

| # | Category | Score | Verdict |
|---|----------|-------|---------|
| 1 | Minimalism / calmness | 9 | The app is quiet: muted composer glyph, one chip for the delivery outcome, no receipt line, snooze toast self-dismisses. Left: a settled thread still shows chip + "Settled" + Reopen + Archive + Open app + a "Workspace retained" line; account detail has three helper lines. |
| 2 | Visual hierarchy & typography | 8 | Tool cards and captions now sit on one column and "Worked for" is above the reply. Still weak: sidebar sublabels (project and status both cut), the small "Auto" effort chip, Tools empty-state text wrapping at about half the card width. |
| 3 | Consistency | 8 | One delete verb, one confirm pattern for hub/MCP/project/thread, one leading-icon slot. Broken by: Add secret / Connect hub errors sit at the bottom of the form while Add profile / onboarding mark the field; Hubs has no intro sentence; Secrets puts its intro under the Profile select; two buttons named "Cancel" in the project dialog confirm. |
| 4 | Clarity & discoverability | 8 | Effort menu with a check, "Signed out" pill, Ship-mode menu, steering placeholder, picker path only on the highlighted row all read well. Left: "Auto" still looks like a label, Choice "Pick" is a hover-only 28px circle, Esc on a top-level Settings page leaves Settings without a hint. |
| 5 | Feedback & state | 9 | Working stays pinned through steering, "Snoozed until 09:00 · Undo", Interrupted + Resume, queue "paused", Waiting for merge, CI step, Shipped chip, Archived chip are all unmistakable and calm. Nit: the Working line is at the top of the turn at first and moves to the bottom after a steer. |
| 6 | Efficiency & flow | 9 | Ctrl+N, Ctrl+K and "/" focus search, ArrowDown walks the thread list, inline rename, an immediate Enter in a fresh draft now sends, effort and model by keyboard. Nit: each row adds Snooze and Settle tab stops. |
| 7 | Accessibility | 8 | Scrim, Escape and outside click close the narrow side panel and return focus to the toggle; named controls; contrast 6+:1 for dim text. Left: Choice pick only appears on hover, Snooze/Settle icons are about 22px, the disabled Delete is nearly invisible, the effort menu has no scrim. |
| 8 | Layout robustness | 8 | No horizontal overflow at 900/1280/1600; side panel overlays with a scrim at 900; shelves clear the footer at 500px tall. Big miss: sidebar subtitles still truncate both the project and the status ("review-projec… Waitin… · #123", "delivery-projec… Shipped to …"). |
| 9 | Forms & dialogs | 8 | Layered Escape (confirm, then up a level), hub removal needs a confirm and Cancel works, Add project focuses the field, project settings now uses Cancel · Save. Dropped from 9 because the new validate-on-click errors in Add secret and Connect hub are detached from the field they describe, with no red border or focus. |

## Round-2 findings: fixed / not fixed

Fixed (verified on screen):
- Expanded tool card is now the full transcript column; sibling cards no longer shrink-wrap (`13-tool-both-expanded.png`, `12-tool-failed-expanded.png`).
- Media caption row: "name · size  Open  Download" directly under the item at 12px, readable (`02-inline.png`, `57-1600-inline.png`).
- "Worked for …" sits above the reply, never below (`05-choice.png`, `22-stream-done.png`, `34-ship-after.png`).
- "Working · Ns" stays for the whole turn including after a steer (`19-steered.png`).
- Delivery outcome said once: the centred receipt line is gone; one chip "Shipped to main a349398" (`34-ship-after.png`).
- Every settled thread shows a state row with Reopen; Archive appears where there is a workspace; after Archive the chip reads "Archived · history kept" (`34`, `112-archived.png`).
- Effort chip reads "Auto" with a checked menu (`10-effort.png`); composer provider glyph is muted, brand colour only in the picker rail (`09-model-arrow.png`).
- Thread header "…" now holds Copy as Markdown, Rename, Snooze, Settle, Delete (`07-thread-actions.png`).
- Lightbox scales small images up (`108-lightbox.png`).
- Silent dropped Enter in a fresh draft: fixed (immediate fill + Enter sends; `114-fast-enter.png`).
- Inline rename in the row (`45-rename.png`); Snooze acknowledgement with Undo that self-dismisses (`47-snoozed.png`, `50-delete-escaped.png`); one delete vocabulary, inline "Cancel / Delete thread" confirm (`49-delete-confirm.png`).
- Ctrl+K and "/" focus search; new-thread picker shows the path only on the highlighted row (`14`, `15`).
- Narrow side panel: scrim, Escape and outside click close it, focus moves in and returns to the toggle (`53-900-sidepanel.png`, `55-900-scrim-click.png`). Toggle is hidden on home (`01-home-1280.png`).
- Hub removal asks first ("Remove Local dev" · Cancel · "You will be disconnected from this hub."), Escape cancels (`91-hub-remove-confirm.png`). MCP delete note only on the remote server; Escape cancels the confirm, then goes up a level.
- Skill source footer is "Done"; duplicate "SKILLS" label removed from profile and project settings (`87-skill-source.png`, `76-profile-detail.png`, `89-project-detail.png`).
- Settings rows share one icon slot (`60-settings-open.png`, `69-settings-Projects.png`); new Projects section lists projects and opens project settings (`69`, `89`); Limits hides the profile switch with one profile (`11-limits.png`); project dialog checkout path is middle-truncated with a Cancel · Save footer; Add project focuses the Folder field (`97-add-project.png`).
- MCP status in the side panel uses neutral text, not a red pill (`51-side-panel-1280.png`).

Not fixed or only partly fixed:
- Sidebar subtitle: project name still truncated whenever a status shows (`37-review-waiting.png`, `39-ci-b.png`) and the settled shelf has the same double truncation "delivery-projec… Shipped to …" (`34-ship-after.png`, `110-settled-open.png`). The plan's "project keeps a readable minimum, status truncates first" is not what renders.
- "Auto" is capitalised but still a bare 14px label beside the model; it reads as text, not a button (`02-inline.png`).
- Intro pattern: Profiles, Accounts and Secrets now have one, Hubs still has none, and Secrets puts it under the Profile select (`61-settings-Secrets.png`, `70-settings-Hubs.png`).
- Empty-submit validation was added for Save secret and Connect hub, but the message shows at the bottom of the card without marking the field (`78-add-secret-validation.png`, `94-add-hub-validation.png`).
- Open/Download are 24px ghost links now but still small; Snooze/Settle hover icons ~22px.
- "Jump to latest ↓" still shows when scrolled to the top of a transcript with an expanded block (`06-tools-expanded.png`); the extra "Open app" pill beside Ship remains (`30-delivery-ready.png`).
- The Ship button is still enabled while the thread is Working (`30-delivery-ready.png`).
- Choice thumbnails are bigger (237x148) but the Pick control is a 28px circle that appears only on hover (`109-choice-hover.png`).

## Regressions introduced by round-2 changes
1. Validate-on-click in Add secret and Connect hub: the error is rendered below the helper text at the bottom of the card, far from the field, with no red border or focus move (compare Add profile: `75-add-profile-validation.png`). Previously the button was disabled; now a user on a tall form may not see why nothing happened (`78`, `94`).
2. Side-panel toggle is still visible on the Limits page (`11-limits.png`) although the panel is meaningless there. Minor.
3. The "Working" line is at the top of the turn at first (`18-queue.png`) and jumps to the bottom after a steer (`19-steered.png`), so the same state is drawn in two places.
4. Project dialog delete confirm squeezes the checkout path ("C:\User…delivery-project") and shows two buttons named "Cancel" (inline and footer) (`90-project-delete-confirm.png`).
5. Escape on a top-level Settings page now leaves Settings. Intended, but it is silent and loses the section you were in; one Esc from a form is fine, a second Esc closing everything is surprising.

## Findings by category (ordered by impact)

### 8 Layout robustness
1. Sidebar subtitles truncate both halves (`37-review-waiting.png`, `39-ci-b.png`, `110-settled-open.png`). Smallest fix: put the status on the right of the title row (next to the time) and let the project own the whole second line, or drop the project name when a status is present and show it as a tooltip.
2. 1280x500 settled shelf partly hides its last row under the footer until scrolled (`59-1280x500-settled-shelf.png`). Fix: add bottom padding equal to the footer height to the scroll area.
3. No horizontal overflow at 900/1280/1600 (`56`–`59`). Side panel overlay at 900 leaves only ~310px of thread, dimmed (`53-900-sidepanel.png`); acceptable.

### 3 Consistency
1. Detached validation messages (see Regression 1). Fix: render the message under the empty field, add the same red border and focus it.
2. Hubs has no intro, and its first row starts at y=82 while every other page starts at y=90 (`70-settings-Hubs.png`). Fix: one short sentence ("Hubs hold your accounts and profiles.").
3. Secrets: intro sits under the Profile select; move it above (`61-settings-Secrets.png`).
4. Duplicate "Cancel" labels in the project dialog; make the inline one "Keep" or move the confirm into the footer.

### 2 Visual hierarchy & typography
1. Sidebar sublabel truncation (above).
2. Tools empty state "No tools yet…" wraps at roughly 380px inside an 840px card (`66-settings-Tools.png`); drop the max-width.
3. Account detail has three helper lines ("A name you choose…", "Used by Personal.", "Set by Anthropic…") of equal weight (`71-account-detail.png`). Fold the first into the field's placeholder.

### 4 Clarity & discoverability
1. "Auto" chip: show a leading icon or "Effort Auto" on first appearance; it is the one control that does not look pressable (`02-inline.png`).
2. Choice Pick is hover-only; show a visible "Pick" control or make the whole thumbnail the button with a visible focus ring (`109-choice-hover.png`).
3. Esc leaving Settings gives no hint; fine for power users.

### 5 Feedback & state
Good everywhere I could reach (`17`–`20`, `35`–`40`, `47`, `112`). Only nit: the Working position jump. Add a spinner-only treatment that stays in one place.

### 6 Efficiency & flow
Strong. Nit: each thread row adds two tab stops (Snooze, Settle); with 12 threads Tab walks 36 stops before the composer. Fix: make hover actions reachable by arrow keys or only on the focused row.

### 7 Accessibility
1. Choice Pick hover-only (above). 2. Disabled Delete is nearly invisible (`71-account-detail.png`); raise the disabled text to the dim-text colour. 3. Snooze/Settle ~22px hit area (`03-row-hover.png`). 4. The effort menu overlaps content without a scrim (`10-effort.png`); fine for a menu.

### 9 Forms & dialogs
1. Fix validation placement (above). 2. Project delete-confirm squeezes the row (`90`). 3. Add project bad-path error is specific and inline (`99-add-project-bad.png`); good.

### 1 Minimalism / calmness
1. Settled state row stacks chip, "Settled", Reopen, Archive, Open app and a "Workspace retained" line (`34-ship-after.png`). Fix: drop the word "Settled" (the shelf already says it) and move "Workspace retained" into the chip tooltip.
2. "Jump to latest ↓" at the top of a long transcript (`06-tools-expanded.png`); show it only when more than one viewport above the end.

## Top 5 changes
1. Fix sidebar subtitles so neither project nor status truncates ("review-projec… Waitin…", "delivery-projec… Shipped to …"): status beside the time, project owns line two (Layout, Hierarchy, Consistency).
2. Move the Save secret / Connect hub validation message under the offending field with a red border and focus, as Add profile does (Forms, Consistency).
3. Make "Auto" and the Choice Pick control look pressable: visible affordance on the effort chip, always-visible Pick (Clarity, Accessibility).
4. Trim the settled row to chip + Reopen/Archive and move "Workspace retained" into a tooltip (Minimalism).
5. Settings polish: one intro sentence for Hubs, intro above the Profile select in Secrets, uncollide the two "Cancel" buttons in the project delete confirm, raise the disabled Delete contrast (Consistency, Accessibility).

## Unreachable / not covered
- The sign-in step after "Choose an account" and the "Add first project" onboarding steps: Continue there starts a real provider login, so I stopped at the account choice (`107-onb-3-account.png`). The planned quiet "Back" on the sign-in step and the post-add acknowledgement are therefore unverified.
- Real Open/Download of media, Electron window controls, Codex harness UI, light / high-contrast / reduced-motion modes.
- Machine detail was captured (`79-machine-detail.png`) with no issues worth reporting; checkout removal confirm in the project dialog was reached and cancelled, not executed. The hub was not removed.
