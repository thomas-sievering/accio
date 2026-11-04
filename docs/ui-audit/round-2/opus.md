# UI / UX audit: round 2, Claude Opus 5.5

Screenshots: `out/ui-audit/round-2/opus/NN-<view>.png` (01-188). The populated app ran on an isolated chat-test server (port 47622) at 1280x900 unless noted. Extra sizes: 1600x1000 (142-154), 900x700 (155-167), 1280x500 (168-170). First-run onboarding used the 3-verify runner (172-188; 180-183 repeat 172-175 from a second run). Driver scripts and ARIA snapshots are in the same folder.

Note on `125-settings-hub-remove-confirm.png`: the name records what I expected to capture. The screenshot actually shows the "Connect to a hub" screen, because Remove had no confirmation step. That state persisted on the server (`126`), so I restarted the fixture server. Captures 127 onward come from a fresh fixture, so thread ages and lists reset.

## Scores

| # | Category | Score | Verdict |
|---|----------|-------|---------|
| 1 | Minimalism / calmness | 8 | Debug JSON, the "+0 −0" chip, the Owl button and the onboarding sidebar clutter are gone. Left: a shipped state still said three times, the orange glyph in every composer, and settings helper text on top of helper text. |
| 2 | Visual hierarchy & typography | 7 | Repeated settings headings are gone and tool output is capped. Media actions still float far from their media. The transcript, tool cards and composer end at three different right edges. "Worked for" moves between the top and bottom of a turn. |
| 3 | Consistency | 7 | Settings footers, icons and capitalisation are now consistent. Left: the same MCP state shows as a red "Sign in" pill in one place and an amber "Signed out" pill in another, a native `<select>` in the project dialog, two save models, two ways of blocking empty submits, and two different "Back" buttons on one page. |
| 4 | Clarity & discoverability | 7 | The project chip opens project settings, and Shipping options now only relabels the button. Left: "/" still does nothing, a settled thread with nothing shipped has no Reopen / Archive, the effort menu doesn't mark the current value, and onboarding can't go back to switch provider. |
| 5 | Feedback & state | 7 | "Stopped." is clean, there are no ISO timestamps, rows no longer jump between lists, and "Working" replaces "Thinking". But the running line disappears after a steer, "Published the committed change." shows while CI is still pending, and adding a project during onboarding gives no acknowledgement. |
| 6 | Efficiency & flow | 8 | Ctrl+N, ArrowUp/Down in the thread list, and a preselected filtered project all help. Ctrl+K and "/" still don't focus search. The composer's Limits button replaces the thread with a full page. |
| 7 | Accessibility | 8 | Visible focus rings, a single `main` and 24 px row actions. Add project opens with focus on Close instead of the Folder field. Media Open / Download are still small 11-12 px text links. |
| 8 | Layout robustness | 7 | At 900 px the side panel now overlays, but it covers the composer's Send and Stop buttons and the header actions, with no scrim. Right edges at 1600 px are still misaligned, and the checkout path still sits outside the dialog's column. |
| 9 | Forms & dialogs | 6 | Footers are now unified (Delete · Cancel · Save) and inline validation is good. But **Remove hub disconnects at once, with no confirmation**, and leaves the app on "Connect to a hub". Escape on any settings detail or inline delete confirmation closes all of Settings. One delete warning is wrong for local servers. |

## Findings by category

### 1. Minimalism / calmness (8)

1. **Shipped state is still said three times.** The centred transcript line "Shipped to main · a7a16ca", the green chip "Shipped to main | a7a16ca", and the caption "• Thread settled · Workspace retained" all sit within 450 px of each other. `74-delivery-progress-3.png`, `90-ci-after-check-1.png`, `164-delivery-shipped-900.png`. *Fix:* drop the centred transcript line. The chip row already carries the state, so the caption can shrink to "Workspace retained" or go into the chip's tooltip.
2. **The orange Claude starburst is still on every composer.** It is the only saturated colour in most views (`17`, `39`, `49`). *Fix:* render the composer glyph in `--muted-foreground` and keep brand colour in the model picker rail and onboarding cards.
3. **Settings pages stack helper text.** Secrets has a note under the Profile select, an empty-state paragraph inside the card and a third note under the card (`94-settings-secrets.png`). The project dialog has a two-line paragraph, then a "SKILLS" label (`47`). The profile editor has a "Skills" heading, a paragraph and then another "SKILLS" label (`106`). *Fix:* remove the inner "SKILLS" label wherever a "Skills" heading already exists, and remove the under-card note on Secrets.
4. **Limits shows an "All profiles / Personal" switch when there is only one profile.** `16-limits-footer.png`, `34-limits-composer.png`. *Fix:* hide the segmented control when there is one profile.
5. **The side-panel toggle shows where there is no side panel to open:** on the home view and in onboarding. `01-home-1280.png`, `172-onboarding-start.png`. *Fix:* render the toggle only when a thread is open.
6. **The new-thread picker prints full temp paths under every project.** `12-new-thread-picker.png`. *Fix:* show the path only for the highlighted row, or show the parent folder name only.

### 2. Visual hierarchy & typography (7)

1. **Open / Download are still pinned to the right of a 600 px column under 160 px images** (x≈910-1000 at 1280; `18`, `22`, `143`). Inside a tool result the same actions sit right after the caption (`23`). *Fix:* make the caption row `inline-flex` at the media's width, so actions follow the filename the way they do in tool results.
2. **The thread pane has three right edges.** At 1280 the media column ends at x=1008, expanded tool cards at 1082 and the composer at 1156. At 1600: 1168, 1242 and 1316. `24-thread-tool-failed-expanded.png`, `143-thread-inline-1600.png`, `144-thread-tool-output-1600.png`. *Fix:* give transcript blocks the composer's max-width. Cap only the media itself, not its caption row.
3. **"Worked for" changes position.** It is a header above the turn in `18` and `52`, but a footer below the reply in `65`, `66` and `75`. *Fix:* always render it above the turn's content.
4. **The left text edge differs inside settings lists.** Rows without an icon start at x=373 (Accounts "Personal Claude", Hubs "Local dev"). The "Add …" rows in the same card start at 419. `92-settings-landing.png`, `102-settings-hubs.png`. *Fix:* give every list row the same 32 px leading icon slot (provider glyph for accounts, hub icon for hubs).
5. **Expanding a tool row changes its width.** The Read card is shrink-wrapped (ends at x≈660, `23`) until a sibling expands, then it stretches to x=1082 (`24`, `27`). *Fix:* set the expanded tool card to `width: 100%` of the transcript column.

### 3. Consistency (7)

1. **One MCP state, two treatments.** The side panel shows docs-search with a red-outlined "Sign in" pill (`46-side-panel-tab-mcp.png`). Settings shows the same server with an amber "Signed out" status pill (`100-settings-mcp-servers.png`). *Fix:* use the amber "Signed out" pill in both places and put the "Sign in" action on the detail page or in a neutral button.
2. **Two save models.** The profile editor says "Applied when you Save" (`106`). The project dialog says "Changes save immediately" and has no Save button, so it isn't clear whether Preview command has saved (`47`, `135`). *Fix:* give the project dialog the settings footer (Cancel · Save), or show a "Saved" tick next to each field after it auto-saves.
3. **Two ways to block empty submits.** Add profile and Add tool validate on click with specific red messages (`104`, `113`). Save secret and Connect hub are simply disabled, with no reason (`110`, `123`). *Fix:* keep primary buttons enabled and validate on click everywhere, as Add profile does.
4. **A native `<select>` in the project dialog.** It opens a white-on-blue OS list over the Preview command field (`135-project-settings-ship-select.png`), unlike every other menu in the app. *Fix:* use the app's menu/select component, as Settings / Secrets → Profile already does.
5. **Two "Back" buttons on the Skill source page.** The settings sidebar has "Back" (leave Settings) and the footer has "Back" (return to the Skills list) (`120-settings-skill-source.png`). Playwright's `getByRole('button', {name: 'Back'})` resolves to two elements. *Fix:* label the footer button "Done" or remove it. The breadcrumb already goes back.
6. **The effort chip reads "auto" in lower case, but the menu says "Auto".** `32-effort-open.png`. *Fix:* show "Auto" in the chip.
7. **Settled shelf rows drop the project avatar and subtitle** that main rows have, and truncate to "deli…" next to "↑ main". `74`, `164`. *Fix:* reuse the main row layout (avatar, title, "delivery-project · Shipped").

### 4. Clarity & discoverability (7)

1. **Typing "/" still does nothing.** `35-composer-slash.png`. *Fix:* open a small skills list on "/" (the side panel already lists them), or stop offering "Reference in message" as the only way in.
2. **A settled thread with nothing shipped has no visible state or actions.** Choice fixture after Settle shows only the placeholder "Send a message to reopen this thread…" (`141-thread-settled-no-ship.png`). A shipped thread gets Reopen / Archive (`74`). *Fix:* show "Settled · Reopen · Archive" above the composer for every settled thread.
3. **The effort menu doesn't mark the current value** (no check next to "Auto"), while the model picker does (`32` vs `30`). *Fix:* add the same trailing check.
4. **The thread "…" menu holds a single "Copy" item** without saying what it copies (`27-thread-header-actions.png`). *Fix:* label it "Copy transcript" (or whatever it copies) and add Rename / Settle / Delete so the menu earns its place.
5. **Onboarding commits to a provider without a way back.** After picking Claude and pressing Continue, the step shows only "Sign in with Claude" (`184-onboarding-account-step2.png`). There is no Back link or provider switch. *Fix:* add a "Back" text button next to the sign-in button.
6. **There is still no Projects section in Settings.** Project settings are reachable from the header chip and the Filter menu gear, but not from Settings (`92`). *Fix:* add a "Projects" item under "Tools and skills" that lists projects and opens the same dialog.
7. **"Stop automatic follow-ups"** on the review chip row is jargon (`79`). *Fix:* "Stop watching PR".

### 5. Feedback & state (7)

1. **The running indicator disappears after a steer.** Before steering, "Working · 1s" heads the turn (`58`). After the first steer (Enter) it is gone, although the turn is still running: only the sidebar spinner and the red Stop button show it (`59`, `60`, `62`). *Fix:* keep the "Working · Ns" line pinned to the end of the active turn until the turn ends.
2. **CI wait reads as done.** While CI is "step 2 of 4", the transcript already says "Verification complete. Published the committed change." (`85-ci-progress-1.png`). *Fix:* while delivery is pending CI, word that reply as "Pushed. Waiting for CI." and show the final line only when CI passes.
3. **Adding a project during onboarding gives no feedback.** The sheet closes, "No projects yet." disappears, the sidebar goes blank and the onboarding step doesn't change (`187-onboarding-after-add-project.png`). *Fix:* list the project in the sidebar right away (as it does after onboarding), or tick the step-4 dot.
4. **The image lightbox doesn't enlarge small images.** A 160x90 thumbnail opens as the same 160x90 inside a small dialog (`26-thread-image-lightbox.png`). *Fix:* scale the image up to at least 60 % of the viewport, with `image-rendering: auto`.
5. **Delivery status pushes the project name to 4 characters in sidebar rows:** "revi… Waiting for merge · #123" and "delivery-pr… Ships when done". `79`, `70`, `163`. *Fix:* drop the project name from the subtitle while a delivery status is shown (the avatar already identifies the project).
6. Good: "Stopped." with Resume and a "paused · Send now" queued item (`64`), the in-place spinner on running rows (`50`, `58`), the "Ships when done" chip, and CI details with "Last checked 09:31:21 · Refreshes every 30s" (`88`).

### 6. Efficiency & flow (8)

1. **Ctrl+K and "/" don't focus Search** (focus stays on `body`; see `s01-home-sidebar.mjs` output). *Fix:* bind both to focus the sidebar search box.
2. **The composer's Limits button replaces the thread view with the full Limits page** (`34`). To check usage mid-thread you must navigate away. *Fix:* open a popover anchored to the chip, with "Open Limits" inside it.
3. **A new thread always goes through the picker**, even with a project filter on. The filtered project is now preselected, so Enter picks it (`11`). *Fix (optional):* when a filter is active, skip the picker and open the draft on that project. The picker stays one click away in the composer.
4. Good: Ctrl+N opens the picker (`14`), ArrowDown moves between thread rows (`15`), Enter steers and Ctrl+Enter queues with a clear placeholder (`50`), and Escape closes the model picker and returns focus to its chip.

### 7. Accessibility (8)

1. **Add project opens with focus on the Close button,** not the Folder field (runner log: `focus BUTTON:Close`; `131-add-project-sheet.png`). *Fix:* `autoFocus` the Folder input.
2. **Escape navigates further than expected in Settings** (see Forms #2). Keyboard users lose their place.
3. **Media Open / Download are 11-12 px text links** with no visible focus or hover target beyond the text (`18`). *Fix:* make them 24 px-tall ghost buttons.
4. **The 900 px side panel overlay has no scrim** and doesn't trap or move focus. The composer behind it stays interactive but half hidden (`158`). *Fix:* add a scrim, move focus into the panel and close it on Escape.
5. Good: a clear 2 px focus ring on rows and chips (`15`, `33`), one `main` landmark, 24x24 row actions and 32x32 toolbar buttons (measured), and the effort chip's title explains scroll / arrow keys.

### 8. Layout robustness (7)

1. **The side panel at 900 px covers the composer's Send / Stop buttons and the header "…" menu** (`158-side-panel-900.png`). *Fix:* below ~1000 px, shrink the composer to the remaining width, or close the panel when the composer gets focus.
2. **Right-edge misalignment at 1600** (Hierarchy #2). `143`, `144`.
3. **The checkout path still sits 6 px left of the dialog column (x=399 vs 405) and is bold.** It is now middle-truncated, which helps. `47`, `135`, `136`. *Fix:* use the regular inset and regular weight.
4. **The Skill source repository path wraps mid-word in a code pill,** and the Skills list wraps the path onto a second line (`101`, `120`). *Fix:* middle-truncate paths on one line, as the side panel does.
5. Good: the long title truncates in the sidebar and header at 1280 and 900 (`137`, `138`, `156`). 1280x500 holds (`168`-`170`). Delivery chips fit at 900 (`163`, `164`).

### 9. Forms & dialogs (6)

1. **Remove hub has no confirmation and logs you out.** On Settings / Hubs, clicking "Remove" on the connected hub removed it immediately. The whole app switched to the "Connect to a hub" screen, and the server kept that state for every new session (`124` → `125`, `126`). Every other destructive action confirms in place (thread delete `06`, profile delete `127`, MCP delete `118`, checkout remove `136`). *Fix:* the same inline "Remove Local dev / Cancel" confirmation, worded "You'll be signed out of this hub".
2. **Escape exits Settings from any depth.** Escape on the inline "Delete local-db / Cancel" confirmation (`118` → `119`) and on an account detail page (`129`) both closed Settings and returned to home. *Fix:* Escape should cancel the inline confirmation first, then go up one breadcrumb level, and leave Settings only from a top-level section.
3. **The delete warning for a local MCP server is wrong:** "Delete local-db … Its saved sign-in goes too." A stdio server has no saved sign-in (`118`). *Fix:* show that sentence only for remote servers.
4. **Disabled primary buttons don't say why** (Save secret `110`, Connect hub `123`). See Consistency #3.
5. **Project dialog save model** (see Consistency #2).
6. Good: unified footers with Delete at the left and Cancel · Save at the right (`106`, `108`, `111`, `114`), the account Delete disabled with "In use by Personal. Remove it from those profiles first." next to it (`108`), the Add project sheet's inline "is not a folder" error (`133`), and Escape / outside click closing the sheet.

## Round-1 findings: fixed / not fixed

| Round-1 finding | Status | Evidence |
|---|---|---|
| Raw "Resources for this turn: {json}" in the transcript | Fixed | `22`, `40`, `59` |
| "+0 −0" chip and Ship on an unchanged thread | Fixed | `39`, `41` |
| Shipped state said three times, raw ISO timestamp | Partly fixed: timestamp gone, still three statements | `74`, `90` |
| Disabled "Owl" footer button | Fixed | `01` |
| Orange starburst in the composer | Not fixed | `17`, `49` |
| Sidebar fully active during onboarding | Mostly fixed: Search, Filter and New thread hidden; Add project, Settings, Limits and the panel toggle remain | `172` |
| Settings repeats breadcrumb leaf as heading | Fixed | `92`-`102`, `108` |
| Uneven left edges in settings | Partly fixed: intro and card aligned; row text insets still differ | `92`, `102` |
| Open / Download far from media | Not fixed | `18`, `143` |
| Expanded tool output uncapped | Fixed ("Show all 401 lines") | `24` |
| Project settings title small and muted | Fixed | `47` |
| Detail-page footers differ | Fixed (Skill source keeps "Back") | `106`, `108`, `111`, `114`, `120` |
| Secrets / Hubs list patterns differ | Fixed: both use "Add …" rows, and Remove is a button | `94`, `102` |
| "accio" / "codex" capitalisation | Fixed | `96`, `111`, `172` |
| Accounts and Profiles share an icon | Fixed | `92` |
| Status pills vs plain text | Partly fixed in settings; side panel still mixes ("Repository" text plus "Loaded" pill, red "Sign in") | `41`, `46` |
| "Manage tools · MCP servers · Skills" | Fixed ("Tools · MCP servers · Skills") | `47` |
| Project avatar colour changes between starts | Fixed: delivery-project is brown in both server starts | `09`, `163` |
| Project settings only via hover gear | Fixed: header chip opens them and the gear is always visible. No Settings section yet | `09`, `47` |
| Shipping option starts delivery | Fixed: it relabels the button | `76`, `77` |
| "/" does nothing | Not fixed | `35` |
| Settled thread without ship has no actions | Not fixed | `141` |
| "Enable synced skill" on an enabled skill | Fixed ("Enable for…") | `120` |
| Settings opens on the third item | Fixed (opens on Accounts) | `92` |
| Interrupt banner shows raw JSON | Fixed ("Stopped.") | `64` |
| Queued edit tray outlives its turn | Fixed: becomes a "paused" queued item and Resume sends it | `64`, `65` |
| CI-wait thread not in Working shelf | Fixed differently: all delivery phases stay in place in the main list | `85` |
| Running rows jump between lists | Fixed | `50`, `58` |
| "Thinking" while streaming | Fixed ("Working") | `53` |
| No global shortcuts, no arrow keys | Partly fixed: Ctrl+N and arrows work; Ctrl+K and "/" don't | `14`, `15` |
| New thread always opens the picker | Partly fixed: filtered project preselected | `11` |
| Machine chip with one machine | Fixed | `49` |
| Weak focus indicators | Fixed | `15`, `33` |
| Two `main` landmarks | Fixed | `s05-settings.mjs` output "mains 1 1" |
| Low-contrast meta text | Improved: 12 px timestamps measure about 5:1 | `s12-metrics.mjs` |
| Small hit targets | Fixed for row actions (24x24). Media links still small | `02`, `18` |
| Dead strip right of header | Fixed | `01`, `142` |
| Checkout path outside column | Partly fixed: middle-truncated, still offset and bold | `47`, `135` |
| Media narrower than composer at 1600 | Not fixed | `143` |
| 900 px side panel squeezes the thread | Fixed differently: now overlays, but covers the composer | `158` |
| Inconsistent footers / save model | Footers fixed. Project dialog still auto-saves | `47`, `106` |
| Hubs full Add form on list page | Fixed | `102`, `123` |
| Secrets profile switch outside the form | Fixed: Profile is a field inside the form | `110` |
| Disabled account Delete has no reason | Fixed | `108` |

## Top 5 changes

1. **Confirm and scope destructive and Escape actions in Settings** (Forms 6 → 8). Give "Remove" on a hub the inline confirmation every other delete has. Make Escape cancel an inline confirmation first, then go up one breadcrumb level. Show "Its saved sign-in goes too." only for remote MCP servers. `118`, `119`, `124`-`126`, `129`.
2. **Align the thread column** (Hierarchy, Layout). One max-width for transcript blocks, tool cards and the composer. Media captions as wide as the media, with Open / Download right after the filename as 24 px ghost buttons. "Worked for" always above the turn. `18`, `23`, `24`, `65`, `143`, `144`.
3. **Make running and settled state explicit everywhere** (Feedback, Clarity). Keep "Working · Ns" visible through steering. Word the CI-pending reply as waiting, not published. Show "Settled · Reopen · Archive" for every settled thread. Remove the centred "Shipped to main" transcript line. `59`, `74`, `85`, `141`.
4. **Fix the 900 px side panel overlay** (Layout, Accessibility). Add a scrim, move focus into the panel, close it on Escape, and keep the composer's Send and Stop buttons uncovered (shrink the composer, or close the panel when the composer gets focus). `158`.
5. **One rule per pattern** (Consistency, Clarity). Use the same "Signed out" pill in the side panel and Settings. Use the app select in the project dialog, plus a Save footer or a "Saved" tick. Validate on click instead of silently disabling Save secret and Connect hub. Mark the current effort with a check, use "Auto" in the chip, and rename the footer "Back" on the Skill source page to "Done". `32`, `46`, `47`, `100`, `110`, `120`, `135`.

## Unreachable or partial

- **Onboarding past sign-in.** Step 3 needs a real Claude or ChatGPT browser sign-in, which the isolated runner can't complete. Step 4 (project) inside onboarding wasn't reachable. The toolbar Add project during onboarding was tested (`185`-`187`).
- **Snooze in the second fixture session.** The "explore tools" thread didn't exist after the server restart, so the snoozed shelf wasn't captured this round. The context-menu snooze item was seen (`03`, `04`).
- **Destructive deletes were opened but not confirmed** (profile, MCP server, checkout) to keep the fixture intact. The hub removal happened by accident, because it had no confirmation.
- **"Current notes" / "Space notes" file links** open outside the page, so they can't be captured in the headless browser (`28` shows the transcript after the click).
