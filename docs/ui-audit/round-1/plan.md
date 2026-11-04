# Round 1 → 2 change plan

Consolidated from `gpt-sol.md`, `opus.md`, `sonnet.md`. Scores (GPT Sol / Opus / Sonnet): Minimalism 8/7/8, Hierarchy 7/7/8, Consistency 7/6/7, Clarity 6/6/7, Feedback 7/6/8, Efficiency 7/7/8, Accessibility 6/7/7, Layout 7/8/7, Forms 6/7/8.

Guiding rule: calm, minimal, consistent. Prefer removing over adding. No new large features (no command palette, no "/" popover, no Browse button in web mode).

## A. Thread pane (transcript, composer, delivery)

1. Remove the raw `Resources for this turn: {json}` notice (`apps/server/src/threads/threads.ts`). Never show it in the transcript or in the Stopped/interrupted bar; the bar says only "Stopped." with Resume. If resource info must remain visible, a collapsed, human-readable "Resources" disclosure (names only, no hashes) is acceptable; removing is preferred.
2. Shipped/settled line: no raw ISO timestamp (use local short time or relative). Say the outcome once: drop duplication between the transcript line, the pill and the "Thread settled · workspace retained" line.
3. Hide the diff chip when +0 −0 and hide Ship / Shipping options when there is nothing to ship. When Ship is disabled for a real reason, give it a tooltip with that reason.
4. Shipping options menu: choosing an option must not start delivery. It sets the mode (the main button label changes, e.g. "Prepare for review"); the main button starts it.
5. Media: put filename/size and Open/Download in one caption row directly under the image/video/audio, with ≥24px hit targets.
6. Expanded tool output: span the full transcript width; cap long output (~20 lines) with "Show all".
7. Queued-message edit tray closes when its turn ends / thread stops.
8. Running indicator says "Working" (not "Thinking") once text or tools are streaming; "Thinking" only for a known reasoning phase if at all.
9. Effort: a separate, labelled control (accessible name "Effort: …") next to the model, opening the choices; keep wheel/arrows. When the model has no effort choices, don't show an unexplained "auto".
10. Model picker: open on the active provider's list (not an empty Favourites tab), focus the selected model, ArrowUp/Down move through items. Same short model names in Favourites and provider groups.
11. Composer at 900px: model label never wraps above Limits.
12. Settled thread (any, not only shipped): show a calm state line with Reopen / Archive.
13. Steering hint: the running-state composer placeholder says "Enter steers · Ctrl+Enter queues".
14. Choice previews: one or two columns when the transcript is narrow; larger thumbnails.
15. Hide the machine chip in the draft when only one machine exists.

## B. Settings

1. One settings page shell: breadcrumb is the title (no repeated H1 that duplicates the breadcrumb leaf), one left edge for intro/heading/cards, intro paragraph then content.
2. One detail-page footer: Delete (left, with inline named confirmation "Delete <name>" + Cancel) · Cancel / Save (right). No "Done", no in-card "Save name". Sticky footer on long forms.
3. Profile editor: skill selections are staged in the form draft and committed on Save; Cancel discards. Deleting a saved profile uses the same inline confirmation.
4. List pages: every list uses the "Add X" row that opens a sub-page — including Secrets and Hubs (no permanent inline Add hub / Pair forms on the list page).
5. "Accio" / "Codex" / "Claude" capitalised everywhere in UI copy (also onboarding — coordinate: onboarding copy belongs to C).
6. Distinct icon for Accounts (not the Profiles two-person icon).
7. Status: one pill style for Connected / Signed out / Local everywhere.
8. Settings opens on the first nav item.
9. Single `main` landmark on Settings (inner one becomes `section`/`div`).
10. Inline validation messages instead of native browser bubbles (add `noValidate`, show "Name required" etc. under the field).
11. Tool install failure: lead with a human sentence ("Couldn't install @playwright/cli 0.0.0. Check the package and version, then retry."), raw error behind a Details disclosure; status above the action row.
12. Secrets: Profile is a field inside the Add secret form; "Used for" is labelled "Purpose key" with "Use the purpose shown by the requesting thread".
13. Skill source page: "Enable for…" wording, not "Enable synced skill" for an enabled skill.
14. Disabled Delete (in-use account): keep the reason right next to the button.

## C. Shell, sidebar, projects, tokens, accessibility

1. Tokens (`apps/web/src/ui/base.css`): raise `--dim`/`--muted` so meta and helper text meet 4.5:1 on panel/raised backgrounds; helper text 13px where it carries meaning. Re-check row sub-labels, shelf headings, "Worked for", captions, placeholders.
2. Visible focus ring everywhere (`:focus-visible` 2px outline) — inputs, composer chips, picker rows, sidebar search included.
3. Remove the disabled "Owl, coming soon" footer button.
4. Row hover actions (snooze, settle): tooltips + aria-labels, ≥24px hit areas. Toolbar icon buttons ≥32px hit areas.
5. Shelves (Working / Snoozed / Settled): chevrons showing expanded state; shelves live inside the scroll region so they never collide with the footer at 1280×500. Running threads stay in place in the main list (no jumping to a bottom shelf and back); the Working shelf rule is the same for every delivery phase (including waiting on CI).
6. Keyboard: Ctrl+N new thread; ArrowUp/Down move between sidebar thread rows; sidebar comes before the thread pane in tab order.
7. Project settings discoverable: clicking the project crumb in the thread header opens project settings; the Filter-menu gear stays but is visible on focus, not hover only. Project settings title uses the same dialog title style as Add project; checkout path uses regular inset and middle-truncation; "Remove" → "Remove checkout" with inline confirm; no duplicate "SKILLS" sub-heading; link row "Tools · MCP servers · Skills".
8. Dialog `aria-labelledby` on Add project / project settings sheets. Popovers hidden until anchored (no flash at 0,0).
9. Header: no dead ~150px strip on the right in the browser (reserve caption width only in the desktop app); side-panel toggle stays in one place.
10. Narrow windows: below ~1100px the side panel overlays the thread instead of splitting it.
11. Long titles: full title tooltip on keyboard focus too; project name never truncated to 4 chars by a status chip (truncate title first).
12. Onboarding: hide/dim sidebar controls (search, filter, new thread) while setup is incomplete; "accio" → "Accio" in onboarding copy; inline "Name required" instead of silently disabled Continue.
13. Project avatar colour derived from the project name/id, stable across restarts.
14. New thread preselects the current/filtered project.
