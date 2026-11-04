# Round 2 → 3 change plan

Consolidated from `gpt-sol.md`, `opus.md`, `sonnet.md` (this folder). Scores (Sonnet / Opus / GPT Sol): Minimalism 9/8/8, Hierarchy 8/7/8, Consistency 8/7/9, Clarity 8/7/8, Feedback 8/7/7, Efficiency 7/8/8, Accessibility 8/8/7, Layout 8/7/8, Forms 9/6/9.

Guiding rule: calm, minimal, consistent. Prefer removing over adding. One control per idea, no helper text that does not earn its place, no glows or decorative effects. No large new features (no "/" skills popover, no command palette, no Limits popover).

Already done by the outer loop (do not redo): a fresh draft no longer drops an early Enter (`threads/ThreadPane.tsx`, machines still loading); effort picked from its menu saves at once and a pending scroll/arrow save flushes on `pagehide` (`threads/steps.tsx`, `threads/ModelPicker.tsx`).

## A. Thread pane (transcript, composer, delivery)

Files: `apps/web/src/threads/` except the sidebar row files listed under C, plus the server delivery receipt.

1. One right edge: transcript blocks (text, media caption rows, tool cards, choice, notices) and the composer share one max-width column. An expanded tool card is always 100% of that column (no shrink-wrapped cards that jump width when a sibling expands).
2. Media: the caption row is as wide as the media (inline-flex), with filename · size then Open / Download immediately after it, as in tool results. Captions 12 px. Open / Download become 24 px-tall ghost buttons with visible hover and focus.
3. "Worked for …" is always above the turn's content, never below the reply.
4. The running line "Working · Ns" stays visible for the whole running turn, including after steering, pinned at the end of the active turn.
5. Every settled thread, shipped or not, shows one calm state row above the composer: "Settled" · Reopen, plus Archive only where a releasable workspace exists. Same row component for the shipped case.
6. Delivery outcome said once: keep the chip ("Shipped to main · abc1234"); remove the separate centred transcript receipt line (stop writing / rendering that notice in `apps/worker/src/threads/deliveries.ts` `receipt`, update its tests) and shrink the extra caption to at most "Workspace retained" (or move it into the chip's title).
7. Effort chip shows "Auto" (capitalised, like the menu); the effort menu marks the current value with the same trailing check the model picker uses.
8. The composer's provider glyph renders muted (currentColor, `--muted`), not orange. Brand colour stays only in the model picker rail.
9. Thread header "…" menu: label the item by what it copies (check what it really copies) and add the thread's existing actions (Rename, Snooze/Settle or Reopen, Delete) by reusing the sidebar row menu actions, so the menu earns its place.
10. Image lightbox scales small images up to fill a sensible part of the viewport (at least ~60% of the shorter side, never above natural ×4).
11. Choice pick buttons ≥ 28×28 px hit target.
12. Regression tests (Playwright, `tests/`): (a) New thread → No project → fill → Enter immediately sends (thread created); (b) in a fresh draft choose High from the effort menu and send at once → the new thread's effort is High and survives reload; (c) on an existing thread ArrowUp on effort then immediate reload keeps the new effort.

## B. Settings, dialogs, onboarding, limits

Files: `app/Settings.tsx`, `profiles/`, `hub/`, `mcp/`, `skills/` (settings and side panel), `secrets/`, `tools/`, `machine/`, `projects/`, `limits/`, `app/FirstRun.tsx`.

1. Remove hub: the same inline confirmation as every other delete ("Remove <hub name>" · Cancel), with the consequence "You will be disconnected from this hub." Never remove on the first click.
2. Escape in Settings: first cancels an open inline confirmation; else goes up one level (detail → its list); leaves Settings only from a top-level section page.
3. MCP delete consequence "Its saved sign-in goes too." only for remote servers that can have a sign-in.
4. Empty-submit handling, one rule: primary buttons stay enabled and validate on click with a specific inline message (as Add profile does). Apply to Save secret and Connect hub.
5. Skill source page: footer "Back" → "Done" (or remove it; the breadcrumb goes back). No page has two buttons named Back.
6. Remove duplicate inner "SKILLS" labels wherever a Skills heading already exists (profile editor, project settings). Remove the redundant under-card note on Secrets. Every top-level section page gets exactly one short intro sentence (Profiles, Accounts and Secrets currently have none).
7. Settings list rows: one leading icon slot for every row (provider glyph for accounts, hub icon for hubs, etc.) so row text starts at one x within a card.
8. Project settings dialog: same save model as the rest of settings (staged changes, Cancel · Save footer), an app-styled select instead of the OS-native list, checkout path at the regular inset and regular weight, middle-truncated. Skill-source repository paths: middle-truncate on one line, no mid-word wrap.
9. Add project sheet: focus the Folder field on open.
10. A "Projects" section in Settings (in the tools/skills group) listing projects; each opens the existing project settings. Keep the header chip and Filter gear shortcuts.
11. Limits: hide the "All profiles / <profile>" switch when there is only one profile.
12. Side-panel MCP status uses the same "Signed out" status pill as Settings (no red "Sign in" pill); the sign-in action stays on the detail page or a neutral button.
13. Onboarding: a quiet "Back" text button on the sign-in step to change provider; after adding a project during onboarding, acknowledge it (the project appears or the step advances).

## C. Shell, sidebar, side panel, accessibility

Files: `app/App.tsx`, `app/layout.css`, `app/SidePanel.tsx`, sidebar CSS, `threads/ThreadRow.tsx`, `ThreadList.tsx`, `ThreadShelves.tsx`, `ThreadMenu.tsx`, `ThreadActionsMenu.tsx`, `ThreadSearch.tsx`, `NewThreadButton.tsx`.

1. Narrow side panel (overlay mode): a dim scrim behind it; clicking the scrim or Escape closes it and returns focus to the toggle; focus moves into the panel when it opens; covered content is `inert` while it is open.
2. Side-panel toggle shows only when a thread is open (not on home or onboarding).
3. Sidebar row subtitle: the project name keeps a readable minimum (~10ch) and the status truncates first; never "revi…". Settled-shelf rows use the same row layout (project mark, title, "project · status").
4. Long thread titles: on keyboard focus and hover the full title is available (wrap the focused/hovered row title to two lines, or a tooltip that also appears on focus).
5. Inline rename: editing happens inside the row's title line, not in a floating input.
6. One delete vocabulary: context menu item "Delete thread", confirm button "Delete thread" (not "Delete thread..." then "Delete for good").
7. Snooze acknowledgement: a brief calm status message ("Snoozed until 08:00" with Undo) announced via `role="status"`, auto-dismissing.
8. Ctrl+K and "/" (when focus is not in a text field) focus the sidebar search box.
9. New-thread picker: no full temp paths under every project; show the path only for the highlighted row.

## Out of scope / not app UI

- "Published the committed change." while CI pends is the fake harness's fixed reply in `scripts/chat-test-server.ts`, not app copy.
