# UI / UX audit, round 4, model `sonnet`

Method: populated fixture server (port 47651) driven with Playwright at 1280x900, 900x700, 1600x1000 and 1280x500, dark theme only. First-run onboarding through the 3-verify runner (`out/ui-audit/round-4/sonnet/j/journey.mjs`, `journey2.mjs`). Screenshots are in `out/ui-audit/round-4/sonnet/` (numbered by view; `s/` holds the scripts). I judged what is on screen, not what the plan says. Keyboard behaviour was measured by reading `document.activeElement` after each key.

## Scores

| # | Category | Score | Verdict |
|---|----------|-------|---------|
| 1 | Minimalism / calmness | 9 | Delivery glow gone, one chip per outcome, settled row is chip + Reopen/Archive. Left: new-thread picker footer hint bar, four helper paragraphs on Add tool, the extra "Open app" pill. |
| 2 | Visual hierarchy & typography | 9 | Sidebar rows now read as title + one status word; tool/caption/"Worked for" columns line up; system prompt is regular weight. Left: 11 px sublabels, the bare "Auto" chip. |
| 3 | Consistency | 8 | Validation, intros and Settings detail pages are now uniform. Left: "Keep" vs "Cancel" as back-out, project edited in two different UIs, snooze wording differs between row and pane, the focused invalid field loses its red outline. |
| 4 | Clarity & discoverability | 8 | Full title is unreachable (row, header and tooltip all cut it); Choice shows three identical check marks that read as "already chosen"; "Auto" still looks like a label; Esc leaving Settings is silent. |
| 5 | Feedback & state | 9 | Working, Interrupted, queued/paused, Waiting for merge, CI step, Shipped, Archived, Snoozed + Undo (self-dismisses) are all calm and unmistakable. Nit: the Working line is top-of-turn first, bottom after a steer. |
| 6 | Efficiency & flow | 9 | Ctrl+N / Ctrl+K / "/", Shift+F10, arrows/Home/End in every menu, hover actions out of the Tab order, header rename in place. Nit: Ship stays enabled while Working with no hint that it queues until the chip appears. |
| 7 | Accessibility | 8 | Menu keyboard pattern is now excellent, focus returns to the trigger, scrim covers the sidebar. Left: Choice pick 28 px, 11 px sublabels, full title only via a truncated native `title`, invalid-field focus ring hides the red state. |
| 8 | Layout robustness | 8 | No overflow at 900/1280/1600; sticky footers hold at 700 px; project dialog scrolls inside. Left: full long title never readable, expanded Settled shelf at 500 px tall opens half-hidden, profile Skills section is below the fold at 900x700, first-run Add project sheet has no padding. |
| 9 | Forms & dialogs | 8 | One validation pattern, Esc layering, "Discard changes? · Keep editing", hub removal confirm. One real defect: the Add project sheet opened from onboarding ("Set up a project first") has no body padding at all. |

## Round-3 findings: fixed / not fixed

Fixed (verified on screen):
- Sidebar subtitle truncation: a delivery status now shows alone ("Review · #123", "CI · step 2/4", "Ships when done", "Shipped"), and the idle row is "project · Ready" (`37-review-waiting.png`, `39-ci-b.png`, `30-delivery-ready.png`, `34-ship-after.png`, `110-settled-open.png`). Biggest round-3 complaint is gone.
- Validate-on-click: Save secret and Connect hub now mark every empty field red, put the message under it and focus the first (`78-add-secret-validation.png`, `94-add-hub-validation.png`). Add project says "Choose a folder" under the field and Add stays enabled (`98-add-project-empty.png`).
- Choice "Pick" is visible without hover (28 px circle on every thumbnail) (`109-choice-hover.png`, `05-choice.png`). See the new finding about what it looks like.
- Settled row trimmed: chip + Reopen + Archive (+ Open app); "Settled" word and "Workspace retained" line gone (`34-ship-after.png`, `111-settled-thread.png`). Archived reads "Archived · history kept" + Reopen (`112-archived.png`).
- Hubs has an intro, first row at the same y as other pages; hub state uses a pill (`70-settings-Hubs.png`). Secrets intro is above the Profile select and the empty card says "No saved secrets for Personal." (`61-settings-Secrets.png`).
- Duplicate "Cancel" in the project delete confirm: now "Keep" + "Remove checkout and delete 1 thread" (`90-project-delete-confirm.png`).
- Disabled Delete on the account page is now legible, with a reason line (`71-account-detail.png`).
- Working glow/sparkles on the queued Ship chip removed (`33-ship-clicked.png`). Review caption shortened to "checked just now"; "Stop automatic follow-ups" became "Stop watching PR" (`37`).
- Limits page has no side-panel toggle (`11-limits.png`). Filter button has no green dot; New-thread picker has no back arrow (`43-filter.png`, `14-new-thread-picker-ctrln.png`).
- Snooze names the day ("Snoozed until tomorrow 09:00"); snoozed thread pane has "Wake now" (`47-snoozed.png`, `110-settled-open.png`).
- Tab stops: Snooze/Settle left the Tab order (measured: 14 Tab presses walk Filter, Add, New, then one stop per thread).
- Row context menu, header menu, Filter, effort menu and model picker: focus first item on open, ArrowUp/Down/Home/End, Enter, Escape returns focus to the trigger; Shift+F10 and the ContextMenu key open the row menu; ArrowDown while a menu is open does not change thread (script `s/p3.mjs`, `125-kb-rowmenu.png`).
- Header rename edits the title in place (`170-header-rename.png`).
- Narrow side-panel overlay: scrim also dims the sidebar (`53-900-sidepanel.png`).
- Settings: Projects is a page with a breadcrumb and Cancel · Save (`89-project-detail.png`), list has "Add project" and "Personal · 1 checkout" subtitles (`69-settings-Projects.png`); Tools empty state is one row (`66-settings-Tools.png`); System prompt regular weight; Saved secrets is a compact link row (`76-profile-detail.png`); profile intro reworded (`62-settings-Profiles.png`).
- Project dialog: body scrolls inside, Cancel · Save visible at 700 px (`124-900-project-dialog.png`); Escape or × with edits shows "Discard changes? · Discard · Keep editing", a second Escape returns to editing (`123-dialog-dirty-esc.png`).
- Onboarding: "Set up a project first" link exists under Continue (`154-onb-3-account.png`).
- Settled shelf at 500 px: last row is reachable (scroll area has bottom padding) (`140-500-shelf-scrolled.png`).

Not fixed or only partly fixed:
- "Auto" effort chip: at rest it is still plain text (same as the model chip beside it); it only shows a background on hover/focus (`02-inline.png`, `134-effort-hover.png`). Both chips now behave the same, but neither says "button" at rest.
- Wrapping full-title tooltip: not delivered. The row only gets a native `title`, which is itself cut to about 45 characters with "…" ("Investigate why the extraordinarily long thread title used … · delivery-project · Ready"). The header title is cut too (`130-long-title.png`, `131-long-title-tooltip.png`, `133-900-long-title.png`).
- Working line position: top of the turn at the start (`18-queue.png`, `21-stream-mid.png`), below the steered text after a steer (`19-steered.png`).
- "Open app" pill beside Ship still present (`30-delivery-ready.png`).
- Esc on a top-level Settings page leaves Settings with no hint (script `p5.mjs`).
- Skills list: source path is clipped by ellipsis in the middle at 900 (`145-900-skills-list.png`) but the 1280 row still prints the whole temp path (`68-settings-Skills.png`); fine in practice.
- Profile editor at 900x700: Skills section still starts below the fold, its first row is cut by the sticky footer (`141-900-profile-detail.png`). The plan wanted it visible.
- Snooze/Settle hover icons are still about 22 px (`03` style hover in `04-row-context.png`), though now mouse-only.

## Regressions / new defects introduced by round-3 changes

1. **First-run Add project sheet has no padding** (`155-onb-4-add-project-sheet.png`, `158-onb-sheet-late.png`, `159-onb-sheet-empty.png`). The "Set up a project first" link opens the sheet and the Folder label, input and footer touch the sheet edge, the footer is jammed under the field, and the validation text hugs the border. The same sheet in the populated app is padded (`98-add-project-empty.png`), so the sheet's body styles are missing in first-run (looks like a stylesheet that loads only after setup). A new user's first dialog looks broken.
2. **Choice pick controls read as "already picked"**: all three thumbnails carry the same dark circle with a check mark, and on B it sits on top of the thumbnail's own "Add account" button (`05-choice.png`, `109-choice-hover.png`). Visible is good; a check says "selected".
3. **Full thread title is unreachable** (above). Previously the native tooltip showed the whole title; now it is truncated to 45 characters.
4. **Focused invalid field loses its red outline**: in Add secret / Add hub / Add profile the first empty field gets the light focus ring while the others are red (`78-add-secret-validation.png`, `94-add-hub-validation.png`). The error text is still red, so it is only a nit.
5. **Snooze wording differs**: row says "Thu 09:00", pane says "tomorrow 09:00" (`110-settled-open.png`).

## Findings by category (ordered by impact)

### 9 Forms & dialogs
1. First-run Add project sheet unpadded (`155`, `158`). Smallest fix: make sure the sheet's body/footer padding rules are part of the base bundle (or inline in `Sheet`) so they apply before the first project exists.
2. Back-out wording: "Cancel" (hub remove, MCP delete, thread delete) vs "Keep" (project checkout) vs "Keep editing" (dialog) (`91`, `82`, `90`, `123`). Fix: pick "Keep" for confirmations everywhere, "Cancel" for forms.
3. Project is editable in two UIs (floating dialog from the header chip and Filter gear, page under Settings / Projects) with different footer layout and field order (`89-project-detail.png`, `121-gear-click.png`). Fix: open the Settings page from both shortcuts, drop the dialog.
4. Add secret / Add hub validation is specific, inline and focuses the first field. Keep.

### 4 Clarity & discoverability
1. Full title unreachable (`130`, `131`). Fix: put the complete title in a real tooltip (or `title` attribute without the ellipsis), and let the header title wrap to two lines on hover/focus.
2. Choice check marks (`05`). Fix: empty ring at rest, check on hover/focus, or put a visible word "Pick".
3. "Auto" at rest looks like a label (`02-inline.png`). Fix: give both composer chips the hover background at 40% at rest, or a 1 px outline.
4. Esc from a top-level Settings page exits Settings silently (`p5`). Fix: Escape only clears a form; leave Settings with Back.
5. Settings nav groups: Machines sits under "Hub settings", Projects under "Tools and skills" (`60-settings-open.png`). Fix: move Projects to "Hub settings" or give it its own group.

### 3 Consistency
1. Back-out wording (above). 2. Two project editors (above). 3. Snooze wording "Thu 09:00" vs "tomorrow 09:00" (`110`): use one formatter. 4. Invalid first field shows focus style, not red (`78`, `94`): red border wins over focus ring for invalid fields. 5. Destructive confirms differ in layout: hub remove puts the consequence under the name (`91`), MCP delete puts it to the right of Cancel (`82`), project puts it in the button label (`90`). Fix: one line under the title, buttons on the right.

### 7 Accessibility
1. Choice pick circle is 28 px (`109`) and Open/Download are 24 px. Fix: 36 px hit area via padding.
2. Sidebar sublabels are 11 px / 5.95:1 contrast (`w.mjs` measurement). Fix: 12 px.
3. Truncated native title is the only way to read long titles (`131`). Fix: see Clarity 1.
4. Everything else is good: Shift+F10, ContextMenu key, arrows, Home/End, Escape returning focus, scrim over the sidebar, named controls (`125`).

### 8 Layout robustness
1. Long titles are cut in the row, the header and the tooltip (`130`, `133`). Fix: see Clarity 1.
2. Expanding Settled at 500 px tall leaves the last row half under the footer until the user scrolls (`59-1280x500-settled-shelf.png`; reachable after scrolling, `140`). Fix: scroll the opened shelf into view.
3. Profile editor at 900x700: Skills starts under the footer (`141`). Fix: collapse "Saved secrets" and "Accounts" help line spacing further, or let Skills come before Saved secrets.
4. First-run sheet padding (`155`).
5. No horizontal overflow at 900, 1280 or 1600 (`56`-`59`). 900 settings forms are clean (`101`, `143`, `145`).

### 3/6 Efficiency
Strong: Ctrl+N picker, Ctrl+K and "/" focus search, ArrowDown walks rows, Enter on a draft sends, effort and model by keyboard, Snoozed shelf with Undo. Nit: Ship is enabled while Working; it correctly queues ("Ships when done", `33`), but the first click gives no preview of that.

### 2 Visual hierarchy & typography
1. 11 px sublabels (above). 2. Tools intro is two full lines above an "Add tool" row that already explains itself (`66-settings-Tools.png`). 3. System prompt page is still a very long monospaced wall (`64-settings-System-prompt.png`); fine for a read-only reference.

### 1 Minimalism / calmness
1. Picker footer hint "Navigate / Enter Select / Esc Close" (`14`) is helper text for a list that already highlights the row. Drop it.
2. Add tool form has four explanatory paragraphs (`80-add-tool.png`). Keep the first, drop the rest to placeholders.
3. "Open app" pill beside Ship/Reopen (`30`, `34`) is a third action competing with the delivery verb. Move into the "…" menu.
4. "Tools · MCP servers · Skills" link row at the bottom of the project dialog/page (`89`) is unexplained.

### 5 Feedback & state
Good everywhere reached (`17`-`20`, `29`-`40`, `47`, `112`). Nits: Working position jump (`18` vs `19`); CI step only advances every 30 s so two screenshots 8 s apart looked frozen (`39`, `40`), which is honest but "Checked Ns ago" next to the step would explain it.

## Top 5 changes
1. Fix the first-run Add project sheet padding so a new user's first dialog is not broken (Forms, Layout).
2. Make the complete thread title reachable: real tooltip / wrapping header title, no 45-character truncation (Clarity, Accessibility, Layout).
3. Replace the always-on check marks on Choice with a ring that becomes a check on hover, and enlarge the hit area (Clarity, Accessibility).
4. Unify the small things that still differ: confirmation back-out word, one project editor, one snooze time label, red border beating focus ring on invalid fields (Consistency).
5. Trim the last helper text and extras: picker hint bar, Add tool paragraphs, "Open app" pill; raise sidebar sublabels to 12 px (Minimalism, Hierarchy, Accessibility).

## Unreachable / not covered
- The sign-in step after "Choose an account" and the "Add first project" step that follows a real login: Continue starts a real provider login, so I stopped at the account choice (`154-onb-3-account.png`). The step has no Back button (confirmed in the aria tree), so a wrong provider choice cannot be undone before the login starts.
- Real Open/Download of media, Electron window controls, Codex harness UI, light / high-contrast / reduced-motion modes.
- The CI details disclosure and a second "Check now" poll: the CI fixture thread had already shipped by the time I returned (`140-500-shelf-scrolled.png` shows it in Settled), so only the in-progress state was captured (`38`-`40`).
- Hub removal confirm was reached and cancelled (`91-hub-remove-confirm.png`, `92-hub-remove-escaped.png`); the hub was not removed. Project checkout removal confirm was reached and kept (`90`). Pairing code was generated (`146-pairing-code.png`): the code is shown as plain text with an absolute expiry time and no Copy button, so it has to be selected by hand (nit; add a Copy action).
