# UI / UX audit: round 1, Claude Opus 5.5

Screenshots: `out/ui-audit/round-1/opus/NN-<view>.png` (01-157). Populated app on an isolated chat-test server at 1280x900 unless noted. Extra sizes: 1600x1000 (136-142), 900x700 (143-149, 153). First-run onboarding: 3-verify runner (154-157).

Numbering note: 100-103 are the CI and review captures from the first session. Settings starts at 104.

## Scores

| # | Category | Score | Verdict |
|---|----------|-------|---------|
| 1 | Minimalism / calmness | 7 | Quiet and dark overall. A few things don't earn their place: raw debug lines, a "+0 −0" chip, a disabled "Owl" button and repeated settled/shipped lines. |
| 2 | Visual hierarchy & typography | 7 | The transcript reads well. Settings repeats the breadcrumb title as a heading and has uneven left edges. Media actions sit far from their media. |
| 3 | Consistency | 6 | Settings detail pages use different footers, link and button styles, and capitalisation ("accio", "codex"). Accounts and Profiles share an icon. Each delivery state uses a different layout. |
| 4 | Clarity & discoverability | 6 | Project settings hide behind a hover-only gear in the Filter menu. "/" does nothing. Picking a shipping option starts delivery. Settled threads only explain themselves after a ship. |
| 5 | Feedback & state | 6 | Running, interrupted and shipping states are clear. But the interrupt banner shows raw resource JSON, the queued-edit tray outlives its turn, and the shipped line uses a raw ISO timestamp. |
| 6 | Efficiency & flow | 7 | Few clicks to start, send, steer and stop. The project picker opens on Enter. There are no global shortcuts: Ctrl+K, Ctrl+N and "/" do nothing, and arrow keys don't move through threads. |
| 7 | Accessibility | 7 | Good ARIA names on icon buttons and menus. Focus is often only a faint border change. Two `main` landmarks on settings pages. Small 11-12 px muted meta text has low contrast. |
| 8 | Layout robustness | 8 | 900 px, long titles and long transcripts hold up. Small faults: a ~150 px dead strip at the header's right, a checkout path overflowing its column, and media wider than the composer at 1600. |
| 9 | Forms & dialogs | 7 | Escape, outside click and Cancel work. Delete confirms in place, which is nice. Validation is inline. Footers vary (Cancel/Save, Done/Save, Done only, inline "Save name"), and Hubs puts a full Add form on the list page. |

## Findings by category

### 1. Minimalism / calmness (7)

1. **Raw "Resources for this turn: {json}" line in the transcript.** A centred grey paragraph of JSON (skill ids, revision hashes, MCP names) appears whenever resources change. It is debug data in the main reading column. `26-thread-worked-expanded.png`, `66-steer-queued-enter.png`, `67-steer-ctrl-enter.png`. *Fix:* drop the line. If it matters, show it inside the collapsed "Worked for" group as "Skills: lib-docs · MCP: docs-search, local-db".
2. **"+0 −0" diff chip and a Ship button on a thread with no changes.** `35-side-panel-skills.png`, `132-project-breadcrumb-click.png`, `103-review-mode-selected.png`. *Fix:* hide the diff chip when both counts are 0, and hide or disable Ship when nothing changed.
3. **Shipped state is said three times.** The transcript line "Shipped to main · 8e69198 · 2026-11-03T23:34:53.038Z. Thread settled; workspace retained.", the green "Shipped to main | 8e69198" chip and the "• Thread settled · Workspace retained" caption all say the same thing. `83-delivery-progress-2.png`. *Fix:* keep the chip row and remove the other two lines, or keep only a short transcript line.
4. **Disabled "Owl, coming soon" button in the sidebar footer.** A permanent dead icon next to Settings and Limits. `01-home-1280.png`, `aria-home.yml`. *Fix:* remove it until Owl exists.
5. **Orange Claude starburst on every composer.** It is the only saturated colour on most screens, so it competes with state colours (green ready dots, amber interrupted). `19-draft-no-project.png`, `53-limits-composer.png`. *Fix:* render the provider glyph in the muted foreground colour inside the composer and keep the brand colour in pickers.
6. **Sidebar is fully active during onboarding.** Search, Filter, New thread, Settings and Limits all show next to "No projects yet." while setup isn't done. `154-onboarding-hub.png`. *Fix:* hide or disable the sidebar controls until the profile exists.

### 2. Visual hierarchy & typography (7)

1. **Settings pages repeat the breadcrumb leaf as a section heading.** For example "Settings / Profiles" then "Profiles", "Accounts / Personal Claude" then "Personal Claude", "MCP servers / docs-search" then "docs-search". `107-settings-profiles.png`, `117-settings-account-detail.png`, `123-settings-mcp-detail.png`. *Fix:* drop the first heading when it equals the breadcrumb leaf, or turn it into the page H1 and drop the breadcrumb leaf.
2. **Uneven left edges in settings.** Intro paragraphs start at x=356, headings at 370, and some heading/button pairs at 384 (Secrets "Saved secrets"). `106-settings-secrets.png`, `108-settings-harnesses.png`, `111-settings-tools.png`. *Fix:* use one inset for intro, heading and card.
3. **Open and Download are pinned ~440 px from a 160 px image.** On images they read as orphaned. The audio player's actions sit at a different x again. `21-thread-inline-scrolltop.png`, `20-thread-inline-top.png`, `137-thread-inline-1600.png`. *Fix:* size the caption row to the media width.
4. **Expanded tool output has no height cap.** A long Read result fills several screens of "Complete output." `28-thread-tool-failed-expanded.png`. *Fix:* cap at ~20 lines with "Show all".
5. **Project settings title is small and muted.** "skills-project" is lighter than the field labels below it. `134-project-settings.png`. *Fix:* use the dialog title style from Add project, at the same weight as other dialog titles.

### 3. Consistency (6)

1. **Detail-page footers differ.** Account: Delete · Cancel · Save (`117`). MCP server: Delete · Done · Save (`123`). Skill source: Delete source · Done (`124`). Machine: inline "Save name" button inside the card and an "All machines" link instead of a breadcrumb leaf (`120`). Add tool / Add profile: Cancel · Add X (`115`, `122`). *Fix:* use Cancel + Save on every editable page (Delete at left), the full breadcrumb on every detail page, and no in-card save buttons.
2. **List-page patterns differ.** Profiles, Accounts, Tools, MCP and Skills use an "Add X" row inside the card. Secrets uses an outlined "Add secret" button beside a heading (`106`). Hubs shows the whole Add-hub form inline, plus "Remove" as an underlined link (`114`). *Fix:* use the "Add X" row in Secrets and Hubs, with the add form on its own sub-page, and make Remove a button.
3. **Capitalisation of product and harness names.** "accio" appears in the onboarding heading (`154`), Tools intro (`111`), Add tool help (`122`), Account limits (`117`) and "accio version" on Machine (`120`). "codex" (`120`) sits next to "Codex" (`108`). *Fix:* "Accio" and "Codex" everywhere.
4. **Accounts and Profiles share the same two-person icon** in the settings nav. `104-settings-landing.png`. *Fix:* give Accounts a key-card or at-sign icon.
5. **Status pills vs plain text.** "Connected", "Signed out" and "Local" are pills in Machines and MCP. Harnesses show "Connected" as plain subtext. The side panel shows a "Loaded" pill next to plain "Repository". `108`, `110`, `112`, `35`. *Fix:* pick one treatment for status.
6. **Project link labels in project settings.** "Manage tools · MCP servers · Skills" mixes verb and noun forms. `134`. *Fix:* "Tools · MCP servers · Skills".
7. **Project avatar colours change between server starts** (for example delivery-project is brown in `12`, teal in `133`). *Fix:* derive the colour from the project id or name, not the temp path.

### 4. Clarity & discoverability (6)

1. **Project settings are only reachable through a hover-only gear inside the Filter menu.** The breadcrumb project chip in the thread header does nothing on click (`132`), and Settings has no Projects section (`104`). `133-filter-project-rightclick.png`, `134-project-settings.png`. *Fix:* make the header project chip open project settings, and add a Projects section to Settings.
2. **Picking "Prepare for review" in Shipping options starts the delivery straight away.** The menu uses checkmark radio items ("Ship to main ✓"), which read as a mode setting, not an action. `89-shipping-options-menu.png`, `103-review-mode-selected.png`. *Fix:* either have the option change the main button label ("Prepare for review") without acting, or use plain action items without checkmarks.
3. **Typing "/" in the composer shows nothing.** No skill or command list appears, even on the Skills thread where a skill is loaded. `36-composer-slash.png`. *Fix:* show a small skills popover on "/", or drop the expectation by mentioning "Reference in message" in the placeholder.
4. **A settled thread opened from the shelf has no visible state or actions.** Only the placeholder "Send a message to reopen this thread…" hints at it (`77-thread-settled-composer.png`). A shipped settled thread does get Reopen / Archive chips (`83`). *Fix:* show the same "Settled · Reopen · Archive" row for every settled thread.
5. **Skill source page offers "Enable synced skill" for a skill that is already enabled** ("Enabled: Personal"). `124-settings-skill-source.png`. *Fix:* label it "Enable for…" or show the current scope as the button state.
6. **Settings opens on Profiles, the third nav item.** Accounts is first. `104`. *Fix:* open on the first item, or move Profiles first.

### 5. Feedback & state (6)

1. **The interrupt banner shows raw JSON.** After Stop, the amber banner reads "Resources for this turn: {"tools":[],"skills":[{"id":"library:lib-docs","revision":"9388…"}],"mcps":[…]} Stopped." `71-thread-interrupted.png`. *Fix:* the banner should say only "Stopped." (or "Interrupted · Resume"). Don't concatenate the last system line into it.
2. **The queued-message edit tray outlives its turn.** "Steer now please" with Save / Cancel stays open above the composer after Stop and is still open after the resumed turn finishes (`71`, `76-sidebar-shelves-expanded.png`). *Fix:* close the edit tray when the turn ends. Keep the queued item as a normal queued chip, or send it.
3. **Raw ISO timestamp in the shipped line.** "2026-11-03T23:34:53.038Z". `83`. *Fix:* use a relative or local time ("just now", "23:34").
4. **A thread that is shipping and waiting on CI is not in the Working shelf.** The CI-progress thread stays in the main list with a small upload icon (`94-ci-progress-3.png`), while "Ships when done" and "Preparing review" threads do move to Working (`80`, `103`). *Fix:* treat CI-wait delivery as Working, or keep all delivery phases in the main list. Either way, be consistent.
5. **Running threads jump between the top list and the bottom Working shelf.** Starting a turn moves the row to the bottom of the sidebar and finishing moves it back to the top. `58`, `60`, `61`. *Fix:* show running state in place, or keep the Working shelf at the top under Search.
6. **"Thinking" label while text is streaming.** `61-turn-streaming.png`. *Fix:* "Writing" or just the timer once text arrives.
7. Good: the in-place "Delete for good" confirmation (`08`), the spinner plus "Ships when done" chip (`80`), the CI step text "image · Build image · step 2 of 4" (`94`) and the inline folder validation (`129`) are all clear and calm.

### 6. Efficiency & flow (7)

1. **No global keyboard shortcuts.** Ctrl+K, Ctrl+N and "/" do nothing on the home view (`s18-kbd-long.mjs`). Arrow keys don't move between sidebar threads (`151-keyboard-arrow-down-sidebar.png`). *Fix:* add Ctrl+N (new thread), Ctrl+K or "/" (focus search), and ArrowUp/Down between thread rows.
2. **New thread always opens the project picker first,** even when a project is filtered or the current thread has a project. `16-new-thread-picker.png`. *Fix:* preselect the current or filtered project and let the picker be one click away.
3. **The draft machine chip "PC-TOM (local)" shows even with one machine.** `19-draft-no-project.png`. *Fix:* hide it when only one machine is connected.
4. Good: Enter sends, Ctrl+Enter steers, the picker has ↑ ↓ Enter Esc hints, and effort cycles from the composer chip (`49`, `50`).

### 7. Accessibility (7)

1. **Weak focus indicators.** Keyboard focus on the sidebar search is only a slightly lighter border (`150-keyboard-tab-sidebar.png`). The composer chips get a faint fill (`51`, `52`). The project picker's selected row is barely lighter than the rest (`16`). *Fix:* a 2 px `--ring` outline on `:focus-visible` for all buttons, rows and inputs.
2. **Two `main` landmarks on settings pages.** Playwright's `locator('main')` resolves to 2 elements on Settings (see `s14-settings-flows.mjs` output). *Fix:* make the inner one a `section` or `div`.
3. **Low-contrast meta text.** Sidebar subtitles ("No project · Ready"), "Worked for <1s", image captions and settings help text are ~11-12 px mid-grey on near-black. `01`, `21`, `115`. *Fix:* raise muted text one step lighter, or make it 12-13 px.
4. **Small hit targets.** Row hover actions (snooze, settle) are ~16 px icons (`02`). Media "Open / Download" are tiny text links (`21`). *Fix:* at least 24x24 px hit areas.
5. Good: icon buttons have names ("Filter threads", "Add project", "skills-project settings"), menus use menuitemradio, and the delete confirmation works from the keyboard (`05`).

### 8. Layout robustness (8)

1. **Dead strip at the right of the header.** The side-panel toggle sits ~150 px from the right edge at every width (1123 of 1280, 1443 of 1600, 1283 of 1440). It looks like space reserved for window controls that don't exist in the browser. `01`, `136`, `154`. *Fix:* right-align it when there are no native window controls.
2. **Checkout path breaks out of the dialog's column.** It is monospace bold, starts left of the inputs (x=399 vs 405) and wraps mid-word. `134`, `149`. *Fix:* use the regular inset and the same truncate-middle as the side panel path (`39`).
3. **Media is narrower than the composer at 1600.** The transcript media column ends at x=1168 while the composer runs to 1316, so the content and input don't line up. `137-thread-inline-1600.png`. *Fix:* use one max-width for the transcript and the composer.
4. **900 px with the side panel open leaves the thread ~300 px wide.** The project crumb truncates to "skills-pr…". `146-side-panel-900.png`. *Fix:* below ~1000 px, overlay the side panel instead of splitting.
5. Good: long titles truncate cleanly in the sidebar and header (`152`, `153`), long context scrolls with "Jump to latest" (`21`, `63`), and 900x700 settings and drafts don't clip (`147`, `148`).

### 9. Forms & dialogs (7)

1. **Inconsistent footers and save model** (see Consistency #1). Profile skills "save immediately, separately from Save" (`116`) and project-settings skills "save immediately" while Preview command has no Save button at all (`134`). It's unclear whether Preview command saves. *Fix:* one model per surface. In the project dialog, add Cancel / Save or show a "Saved" tick next to the field.
2. **Hubs page puts a full Add-hub form on the list page** with a disabled "Connect hub" button. `114-settings-hubs.png`. *Fix:* use an "Add hub" row that opens the form.
3. **Secrets form needs "Finish or cancel this form to switch profiles."** The profile switch sits above the form instead of inside it. `119-settings-add-secret.png`. *Fix:* put Profile as a field inside the Add secret form and remove the top card.
4. **Disabled Delete on an account in use is near-invisible** and has no reason next to it. The reason is in body text higher up. `117`. *Fix:* keep Delete enabled and show the "Used by Personal" error inline on click, or add a tooltip.
5. Good: the Add project sheet (`126`-`131`) closes on Escape and outside click and validates inline with a specific message. The context menu Delete confirms in place without a modal (`08`, `09`). Model picker and Limits close on Escape and outside click (`47`, `54`, `56`).

## Top 5 changes

1. **Remove raw resource JSON from the transcript and the interrupt banner** (Feedback, Minimalism, Hierarchy). `26`, `66`, `71`. The banner should read only "Stopped." / "Interrupted".
2. **Unify the settings detail-page shell:** full breadcrumb, no repeated heading, Delete left plus Cancel / Save right everywhere, "Add X" rows for every list (Secrets, Hubs), and "Accio" / "Codex" capitalised (Consistency, Forms). `106`, `114`, `117`, `120`, `123`, `124`.
3. **Make project settings discoverable:** the header project chip opens them, and Settings gets a Projects section. Shipping options should change the main button label instead of firing (Clarity). `89`, `103`, `132`, `133`.
4. **Fix state lifecycle glitches:** close the queued-edit tray when the turn ends, use the same Working-shelf rule for all delivery phases, stop rows jumping between top list and bottom shelf, show Reopen / Archive for every settled thread, and use a human timestamp in the shipped line (Feedback). `71`, `76`, `77`, `83`, `94`.
5. **Keyboard and focus pass:** a visible `:focus-visible` ring, Ctrl+N / Ctrl+K, ArrowUp/Down in the thread list, a single `main` landmark, and ≥24 px hit areas for row actions (Accessibility, Efficiency). `02`, `150`, `151`.

## Unreachable or partial

- **Onboarding past the account gate** (`156`). Continuing needs a real Claude or ChatGPT sign-in, which the isolated runner can't complete, and there is no skip button. The project step of onboarding was not seen.
- **Prepare-for-review completion.** Captured only up to "Preparing review…" (`103`). The first session was cut off before the final state, and I didn't re-run it.
- **Destructive deletes in settings** (profile, MCP server, skill source, checkout Remove) were opened but not confirmed, to keep the fixture intact for the other captures. The thread delete flow was exercised (`08`, `09`).
- **Settings → Projects** as named in the brief doesn't exist as a section. Project settings were reached through the Filter menu gear (`134`).
