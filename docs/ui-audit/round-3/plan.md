# Round 3 → 4 change plan

Consolidated from `gpt-sol.md`, `opus.md`, `sonnet.md` (this folder). Scores (Sonnet / Opus / GPT Sol): Minimalism 9/7/9, Hierarchy 8/8/8, Consistency 8/8/9, Clarity 8/8/8, Feedback 9/8/9, Efficiency 9/8/8, Accessibility 8/7/8, Layout 8/8/8, Forms 8/8/9.

Guiding rule: calm, minimal, consistent. Prefer removing over adding. One control per idea, no glows or decorative animation, no helper text that does not earn its place. Still out of scope: a "/" skills popover, a command palette, a Limits popover.

## A. Thread pane (transcript, composer, delivery)

Files: `apps/web/src/threads/` except the files listed under C; `threads.css` transcript/composer/delivery rules only.

1. Remove the queued-Ship decoration: the glowing outline and orbiting sparkles on "Ships when done" (`delivery.css` `delivery-armed` / `delivery-glow` / `delivery-sparkle` and their markup). The chip's spinner already says it is waiting.
2. Delivery row says each fact once. Shipped / merged: chip + Reopen + Archive (+ Open app where it exists); no separate word "Settled" when a delivery chip is present; no "Workspace retained" line (move it into the chip's `title`). Review: shorten the caption to "checked just now" (the chip already says "Waiting for merge · #123"). Ordinary settled threads keep "Settled · Reopen".
3. "Stop automatic follow-ups" → "Stop watching PR". Keep any explanation in a `title`, not on screen.
4. Snoozed thread pane: the same state row as Settled: "Snoozed until Thu 09:00 · Wake now".
5. Resumed turns: their tool group sits inside the turn's "Worked for" disclosure like every other turn, and "Resume" is not rendered as an italic user bubble (fold it into the "Stopped." line as "Stopped · resumed", or a muted caption).
6. One caption style: media captions inside tool results use the same 12 px caption as inline media. The CI detail line ("Revision … · Last checked … · Refreshes every 30s") uses the 12 px caption style. The tool-group header is either full width or has no background (no shrink-wrapped background bar).
7. Effort chip looks pressable: same resting/hover treatment as the model chip next to it (no new icon, no extra word).
8. Choice: the Pick control is visible without hover (quiet at rest, full on hover/focus), or the whole thumbnail is the pick button with a visible focus ring.
9. "Jump to latest" appears only when the reader is more than one viewport above the end.
10. Effort menu keyboard: opening it focuses the checked item; ArrowUp/Down and Home/End move; Enter picks; Escape closes and returns focus to the chip. Follow the model picker's existing pattern.

## B. Settings, dialogs, onboarding

Files: `app/Settings.tsx`, `app/settings.css`, `app/FirstRun.tsx`, `app/first-run.css`, `app/Sheet.tsx`, `ui/sheet.css`, `ui/forms.css`, `ui/menu-form.css`, and `profiles/`, `hub/`, `mcp/`, `skills/`, `secrets/`, `tools/`, `machine/`, `projects/`, `limits/`, `resources/`, `harnesses/`.

1. One validation pattern everywhere: the message sits under the offending field, the field gets the red outline, and focus moves to it. Fix Save secret and Connect hub (currently a sentence at the bottom of the card). Primary buttons stay enabled after a failed submit (Add tool, Add MCP server currently grey out). Add project's Add stays enabled and an empty click says "Choose a folder" under the field. Changing MCP transport clears the previous transport's submitted/error state.
2. Projects in Settings is a Settings detail page ("Settings / Projects / delivery-project") with the same form and footer, not the floating dialog; the dialog stays for the header-chip and Filter-gear shortcuts. The Projects list gets an "Add project" row (opens the existing Add project sheet) and row subtitles "Personal · 1 checkout".
3. Project dialog: Escape first cancels an inline confirmation; with unsaved changes, Escape or × shows one inline footer line "Discard changes? · Keep editing" instead of silently discarding. The inline confirmation's back-out button is "Keep", not a second "Cancel". The dialog body is capped (`calc(100vh - 160px)`) with internal scroll so Cancel · Save stay visible at 700 px.
4. Trim stacked helper text: Tools empty state is one row (drop "No tools yet" paragraph; keep the Add row with its one-line hint, no narrow max-width). Secrets: intro above the Profile select; empty card says "No saved secrets for <profile>." Account detail: fold "A name you choose…" into the field placeholder. Profile editor: section gaps 20–24 px, tighter name card, Saved secrets as a compact link row, so Skills is visible at 900×700.
5. Hubs: one intro sentence like every other section, first row at the same y as other pages, hub connection state uses `StatusPill`.
6. Profile wording: intro "A profile groups the accounts and projects for one side of your life, such as personal or work." Profile delete confirmation gets one consequence line, like hub removal.
7. System prompt page: regular weight (not bold), max width 72ch.
8. Skills list rows middle-truncate the repository path (`MidPath`), like the detail page.
9. Sticky settings footer: page background and a top border when stuck, so it never cuts helper text in half.
10. Settings list row focus: the 2 px rounded outline used on sidebar rows, not two full-width lines.
11. Disabled Delete text uses the `--dim` colour (currently nearly invisible).
12. Onboarding: a quiet "Set up a project first" link under the sign-in action that opens the existing Add project sheet; the step block is anchored at one fixed top offset across steps, and every step uses the same Continue layout.

## C. Shell, sidebar, menus, accessibility

Files: `app/App.tsx`, `app/layout.css`, `app/SidePanel.tsx`, `app/appEvents.ts`, `app/sidebar-footer.css`, `app/sidebar-toolbar.css`, `ui/context-menu.css`, `ui/menu.css`, and in `threads/`: `ThreadRow.tsx`, `ThreadList.tsx`, `ThreadShelves.tsx`, `ThreadMenu.tsx`, `ThreadActionsMenu.tsx`, `ThreadSearch.tsx`, `NewThreadButton.tsx`, `SnoozeNotice.tsx`, `shelves.ts`, `status.ts`, `new-thread.css`, sidebar/shelf/context-menu rules in `threads.css`.

1. Sidebar subtitle: while a delivery status shows, the subtitle is the status alone at full width (the project mark already names the project; keep the project in the row's `title` and accessible name). Use short sidebar status words: "Review · #123", "CI · step 2/4", "Ships when done", "Shipped". Idle rows keep "project · Ready". Remove the uneven gap after short project names.
2. Full title on keyboard focus and hover: a wrapping tooltip with the complete title (no row taller than two lines).
3. Menu keyboard pattern for the row context menu (incl. Shift+F10 / ContextMenu key), the header "…" menu and Filter: focus the first item on open, ArrowUp/Down and Home/End move, Enter activates, Escape closes and returns focus to the trigger; ArrowDown must not move to the next thread row while a menu is open.
4. Header rename edits the title in place in the header, like the sidebar row.
5. Narrow overlay: the scrim also covers the sidebar (or the sidebar is inert too) and Tab is contained in the panel until it is dismissed.
6. Filter button: no green dot while the filter chip is visible.
7. New-thread picker: no "←" back arrow on its first step.
8. Snooze status names the day: "Snoozed until tomorrow 09:00" / "Snoozed until Thu 09:00".
9. Limits page: no side-panel toggle; its close returns to the thread you came from.
10. Sidebar row hover actions (Snooze, Settle) leave the Tab order (`tabIndex={-1}`); they stay reachable through the row menu, which is now keyboard-operable. Settled shelf: bottom padding so the last row is not hidden under the footer at 500 px tall.
