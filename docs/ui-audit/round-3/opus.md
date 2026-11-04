# UI / UX audit: round 3, Claude Opus 5.5

Screenshots: `out/ui-audit/round-3/opus/NN-<view>.png` (01-230). The populated app ran on an isolated chat-test server (port 47632). Captures are at 1280x900 unless noted. Extra sizes: 1600x1000 (163-183), 900x700 (184-203, 208-214), 1280x500 (204-207). First-run onboarding used the 3-verify runner (217-228). `zoom-*.png` files are 2-4x crops of existing screenshots. The driver scripts (`s01`-`s14`, `journey.mjs`) and ARIA snapshots (`aria-*.yml`) are in the same folder.

The hub removal confirmation was opened and then dismissed with Escape and Cancel (`129`-`131`). The hub was never removed, so one server session covers every capture.

## Scores

| # | Category | Score | Verdict |
|---|----------|-------|---------|
| 1 | Minimalism / calmness | 7 | The orange composer glyph, the receipt line, the one-profile Limits switch and the home panel toggle are gone. But the queued "Ships when done" chip has a pulsing glow and five orbiting sparkles, and settings pages still stack two to four helper sentences. |
| 2 | Visual hierarchy & typography | 8 | One right edge, media actions next to the filename, and "Worked for" at the top of normal turns. After Resume, a second tool summary sits above "Worked for". The System prompt page is set in bold monospace. |
| 3 | Consistency | 8 | Same MCP pill, an app-styled select, "Done", "Auto" and a check in the effort menu. Left: two validation styles, Projects opens a modal where every other Settings item opens a page, header rename uses a floating input, and two turn-summary formats. |
| 4 | Clarity & discoverability | 8 | Onboarding Back, a Projects section, a complete thread "…" menu and a Settled · Reopen row all work. A snoozed thread shows no state in its pane. "Stop automatic follow-ups" and "The sides of your life threads run under" still read badly. |
| 5 | Feedback & state | 8 | "Working · Ns" now stays through steering, settled threads say so, and Snooze shows "Snoozed until 09:00 · Undo". Sidebar delivery states are unreadable ("review-projec… Waitin… · #123"). |
| 6 | Efficiency & flow | 8 | Ctrl+K and "/" focus Search, Ctrl+N, arrow keys and Enter / Ctrl+Enter all work. Limits still replaces the thread, and menus can't be driven with arrow keys. |
| 7 | Accessibility | 7 | The narrow side panel now has a scrim, `inert`, focus-in and Escape, and Add project focuses Folder. But the context, thread "…", Filter and effort menus don't take focus when opened and ignore the arrow keys. |
| 8 | Layout robustness | 8 | The 900 px overlay no longer covers a live composer, and widths line up at 1600. The Skills list path still wraps mid-word, sticky footers cut helper text at 1280x900, and sidebar subtitles truncate both halves. |
| 9 | Forms & dialogs | 8 | Hub removal confirms, Escape goes up one level in Settings, and the MCP warning is correct. In the project dialog, Escape or Close silently throws away unsaved edits and an open confirmation. Validation messages sit in two different places. |

## Findings by category

### 1. Minimalism / calmness (7)

1. **The queued Ship chip glows and sparkles.** While "Ships when done" waits, the chip has a light-blue glowing outline (`delivery-glow`) and five animated `delivery-sparkle` particles orbiting the border (see the `s14-check.mjs` output). In screenshots they show as small stars at different spots on each frame. This is the only decorative animation in the app, and it breaks the "no glows" rule. `70-delivery-ships-when-done.png`, `71-delivery-progress-0.png`, `zoom-70.png`, `zoom-71.png`, `209-delivery-queued-900.png`. *Fix:* delete the glow and sparkle animations. The spinner in the chip already says "waiting".
2. **Helper text still stacks on settings pages.**
   - Tools empty state: intro paragraph, then "No tools yet / Start with the Playwright CLI preset…", then "Add tool / An npm package pinned to an exact version." That is three explanations above one action (`99-settings-tools.png`).
   - Profile editor: four helper sentences, one per card (`107`).
   - Secrets: an intro sentence below the Profile select, plus an empty-state paragraph inside the card (`94`).

   *Fix:* in empty lists, drop the "No … yet" row and keep the "Add …" row with its one-line hint. On Secrets, move the intro above the select and cut the in-card paragraph to "No saved secrets for Personal."
3. **The shipped state is still said three ways in one row:** "↑ Shipped to main | a039293", then "Settled", then the caption "• Workspace retained". `74-delivery-progress-3.png`, `90-ci-after-check-1.png`. The review row does the same: the chip says "Waiting for merge · #123" and the caption repeats "Prepared for review; merge manually · checked just now" (`78`). *Fix:* put "Workspace retained" and "checked just now" in the chip's `title`. Shorten the review caption to "checked just now".
4. **The Filter button shows a green dot while a "skills-project ×" chip is also visible** (`11-new-thread-with-filter.png`). Two signals for one state. *Fix:* drop the dot. The chip already shows the filter.

### 2. Visual hierarchy & typography (8)

1. **After Resume, tools appear above the turn header.** The resumed turn shows "› Read 1 file, ran 1 command · 1 failed" first, then the "Worked for <1s" divider, then the media (`229-steering-thread-resume-turn.png`, `230-…-expanded.png`). On a normal turn the same tools sit inside "Worked for <1s · 1 failed ⌄" (`22-thread-worked-expanded.png`). *Fix:* render the resumed turn's tool group inside its "Worked for" disclosure, like every other turn.
2. **"Resume" shows as an italic user bubble** (`229`, `214`). The user never typed it. *Fix:* fold it into the "Stopped." line ("Stopped · resumed"), or show it as a muted caption, not a message bubble.
3. **The System prompt page sets long paragraphs in bold monospace,** about 110 characters per line (`97-settings-system-prompt.png`). It is the heaviest text in Settings. *Fix:* use regular weight and a 72ch max width for these blocks.
4. **Captions have two sizes.** Inline media captions are 12 px; the same caption inside a tool result ("media.png · 315 B Open Download") is 13 px (`23-thread-tool-read-expanded.png` vs `18`). *Fix:* use the 12 px caption style in both.
5. **The tool-group header is shrink-wrapped** (its background ends at x≈642), while expanded tool rows span the column (`230`). *Fix:* make the group header full width, or give it no background.

### 3. Consistency (8)

1. **Validation messages appear in two places.** Add profile, Add tool and Add MCP server mark the field red and put the message under it (`105`, `115`, `118`). Save secret and Connect hub show a single red sentence at the bottom of the card and leave the empty field unmarked (`112-settings-add-secret-empty-submit.png`, `128-settings-add-hub-empty-submit.png`). *Fix:* render the Secret and Hub errors under the Name field, with the red outline, like Add profile.
2. **Projects is the only Settings section that opens a modal.** Every other row opens a detail page with a breadcrumb and footer (`109`, `113`, `116`). Clicking a project opens the floating project dialog over Settings, and the breadcrumb stays at "Settings / Projects" (`135-settings-project-detail.png`). *Fix:* render the same project form as a Settings detail page ("Settings / Projects / delivery-project"). Keep the dialog only for the header-chip and Filter-gear shortcuts.
3. **The Projects list has no "Add project" row,** unlike Profiles, Secrets, Tools, MCP servers, Skills and Hubs (`102-settings-projects.png`). Its intro says "Each project belongs to one profile.", but the rows don't show which profile. *Fix:* add an "Add project" row that opens the existing sheet. Change the subtitle to "Personal · 1 checkout".
4. **There are two rename styles.** Sidebar rename edits the title in place (`05`). Header "…" → Rename opens a floating input under the menu button, away from the title (`144-header-rename.png`). *Fix:* edit the header title in place.
5. **Sidebar subtitles have uneven spacing:** "No project ·  Ready" has a wider gap after the dot than "skills-project · Ready" (`01`, `67`). This comes from the new minimum width on the project name. *Fix:* set the minimum width on the project text without padding the short names, or drop it (see Feedback #1).
6. **Delete confirmations differ in how much they explain.** Hub removal says what happens ("You will be disconnected from this hub", `129`). Checkout removal says "Remove checkout and delete 1 thread" (`137`). Profile deletion just says "Delete Personal / Cancel", with no word on what happens to its projects and threads (`132`). *Fix:* add one consequence line to the profile confirmation, using the hub pattern.

### 4. Clarity & discoverability (8)

1. **A snoozed thread looks normal when opened.** The pane shows no snoozed state (`155-thread-snoozed.png`). The sidebar row says "Thu 09:00", and the earlier status said "Snoozed until 09:00" without a day (`149`, `152`). *Fix:* reuse the new settled row above the composer: "Snoozed until Thu 09:00 · Wake now". Include the day in the snooze status message too.
2. **"Stop automatic follow-ups"** on the review chip row is still jargon (`78`, `211`). *Fix:* "Stop watching PR".
3. **The profile wording is hard to parse.** "The sides of your life threads run under, such as personal or work." (`95`) and "A side of your life threads run under." (`219`) both lack a relative pronoun. *Fix:* "A profile groups the accounts and projects for one side of your life, such as personal or work."
4. **Typing "/" in the composer still does nothing** (`35-composer-slash.png`). The plan scoped this out. It still makes "Reference in message" in the side panel the only way to reference a skill. *Fix (later):* a plain list of skills on "/".
5. **The new-thread picker opens with a "←" back arrow** that has nothing to go back to (`12`, `13`). *Fix:* remove the arrow, or show it only on a second step.

### 5. Feedback & state (8)

1. **Sidebar delivery states are unreadable, and worse than in round 2.** The project name now keeps its width, so the status truncates first: "review-projec… Waitin… · #123", "ci-progress-projec… CI · imag…", "delivery-projec… Ships when …", "delivery-projec… Shipped to …" (`70`, `85`, `91-sidebar-after-delivery.png`, `152`). Round 2 showed "revi… Waiting for merge · #123". *Fix:* while a delivery status is shown, hide the project name in the subtitle (the avatar already names the project) and give the status the full width. Keep "project · Ready" for idle rows.
2. **The CI-pending reply still says "Verification complete. Published the committed change." while CI is on step 2 of 4** (`85`). The plan says this is fixed fixture text, so it isn't scored, but a user who sees it would think the work is done.
3. **The CI detail line is 10-11 px:** "Revision f6d01b5 · Last checked 10:04:03 · Refreshes every 30s" (`88-ci-details-expanded.png`). It is the smallest text in the app. *Fix:* use the 12 px caption style.
4. Good: "Working · Ns" now stays pinned to the end of the turn through Enter-steers and Ctrl+Enter queues (`59`, `61`). The queued item turns "paused · Send now" after Stop (`64`). Settled threads show "Settled · Reopen" (`153`). The new Snooze message offers Undo (`149`). Onboarding confirms "Added verify-project." (`227`).

### 6. Efficiency & flow (8)

1. **The composer's Limits button still replaces the thread with the full Limits page** (`34`). That page also shows a side-panel toggle with no panel behind it (`34`, `203`). The plan scoped the popover out. *Fix (minimum):* hide the side-panel toggle on the Limits page, and make the close "×" return to the thread you came from.
2. **Menus can't be used with the keyboard alone** (see Accessibility #1). Context-menu actions need the mouse or extra Tab presses.
3. Good: Ctrl+K and "/" focus Search (s01 log: `ctrl-k INPUT:Search threads`, `slash INPUT:Search threads`). Ctrl+N opens the picker, ArrowDown moves between rows, the filtered project is preselected (`11`), and the model picker supports arrow keys and Escape.

### 7. Accessibility (7)

1. **Four menus don't follow the menu keyboard pattern:** the context menu (Shift+F10), the thread "…" menu, Filter and effort. Opening one leaves focus on the trigger. ArrowDown does nothing, or in the sidebar context menu moves focus to the next thread row while the menu stays open. No item is highlighted (`215-context-menu-keyboard.png`, `216-header-menu-keyboard.png`; logs in `s12-keyboard.mjs` and `s13-menu-tab.mjs`). The items can only be reached with Tab. The model picker does this correctly. *Fix:* when a menu opens, focus its first item. Arrow keys and Home/End move between items, Escape returns focus to the trigger. Reuse the model picker's handling.
2. **Media Open / Download are still bare text** with no button shape (`17`, `164`). The plan asked for 24 px ghost buttons. *Fix:* add the 24 px ghost-button style with a hover background.
3. **The focus ring on Settings list rows is drawn as two full-width lines** above and below the row, so it reads as dividers (`138-settings-project-remove-checkout-esc.png`). *Fix:* use the 2 px rounded outline used on sidebar rows (`147`).
4. **In the narrow overlay, the thread list stays clickable while the pane behind the panel is inert** (`190-side-panel-scrim-click-900.png`: clicking the sidebar left the panel open). *Fix:* extend the scrim over the sidebar, or close the panel when a thread row is clicked.
5. Good: the overlay scrim, focus-in, Escape and return-focus all work (`188`, `189`). Add project focuses Folder (`159`). Long titles wrap to two lines on keyboard focus (`147`). The Choice pick buttons are 28x28. The effort chip's contrast is 10.6:1 and row subtitles are 5.9:1.

### 8. Layout robustness (8)

1. **The Skills list still wraps the repository path mid-word:** "…\Temp\accio-" / "chat-browser-Rom8j9\skills-library" (`101-settings-skills.png`, `177`, `197`). The detail page now middle-truncates it (`122`). *Fix:* use the same middle truncation on the list row.
2. **Sticky settings footers cut helper text in half** with no divider or fade (`113-settings-machine-detail.png`, `zoom-113.png`). *Fix:* when the footer is stuck, give it the page background and a top border.
3. **Sidebar subtitles truncate both halves** (Feedback #1). This is the most visible truncation problem at every width.
4. **The project dialog is taller than a 700 px window,** so its footer starts off screen (`202-project-settings-900.png`, `206`). It does scroll (`207`). *Fix:* cap the dialog body at `calc(100vh - 160px)` with internal scroll, so Cancel · Save stay visible.
5. **Onboarding content jumps vertically between steps.** The heading sits at y≈323, then 377, 329, 373 and 349 (`217`-`227`). The profile step also puts Continue inline, while the other steps use a full-width Continue. *Fix:* anchor the step block at a fixed top offset and use one Continue layout.
6. Good: transcript, tool cards and composer share one column at 1280 and 1600 (`24`, `166`). Long titles truncate in the header and wrap on focus (`148`, `147`). The 1280x500 thread view holds (`205`).

### 9. Forms & dialogs (8)

1. **The project dialog throws away unsaved edits without asking.** With an edited Preview command and the inline "Remove checkout" confirmation open, one Escape closed the whole dialog (`136` → `137` → `138`). The edit was gone when reopened (s08 log: `preview value after escape: node preview.cjs`). The Close "×" also discards an edit (`158`). Settings now cancels the inline confirmation first. *Fix:* Escape first cancels the inline confirmation. With unsaved changes, the next Escape or "×" shows one inline line, "Discard changes? · Keep editing", in the footer.
2. **Validation messages appear in two places** (Consistency #1). Add tool and Add MCP server also grey out their primary button after a failed submit (`115`, `118`), while Add profile stays enabled (`105`). *Fix:* leave the primary button enabled and re-validate on each click.
3. **Add project's "Add" button is disabled while Folder is empty** (`159`, s09 log `add disabled? true`), against the round-3 "validate on click" rule. It is minor here, because a typed path is checked as you type (`161`). *Fix:* enable it and show "Choose a folder" under the field on an empty click.
4. Good: hub removal confirms in place and says what happens (`129`). Escape cancels it (`130`), backs out of a detail page to its list (`133`), and leaves Settings only from a top-level section (`134`). The local MCP delete no longer mentions a sign-in (`120`). The project dialog has Cancel · Save with Save disabled until something changes (`47`, `136`). Add project shows "is not a folder" inline (`161`).

## Round-2 findings: fixed / not fixed

| Round-2 finding | Status | Evidence |
|---|---|---|
| Hub Remove has no confirmation | Fixed | `129`-`131` |
| Escape exits Settings from any depth | Fixed in Settings. The project dialog still closes outright | `121`, `133`, `134`, `138` |
| Wrong MCP delete warning for local servers | Fixed | `120` |
| Shipped state said three times | Partly fixed: receipt line gone; chip + "Settled" + "Workspace retained" remain | `74` |
| Orange starburst in every composer | Fixed (muted) | `17`, `49` |
| Settings helper text stacked | Partly fixed: inner "SKILLS" labels gone; Tools, Secrets and profile editor still stack | `94`, `99`, `107` |
| Limits switch with one profile | Fixed | `16`, `34` |
| Side-panel toggle on home / onboarding | Fixed. Still shown on the Limits page | `01`, `217`, `34` |
| Full temp paths in new-thread picker | Fixed (highlighted row only) | `12`, `13` |
| Open / Download far from media | Fixed (position). Still plain text, not ghost buttons | `18`, `164` |
| Three right edges | Fixed | `24`, `166` |
| "Worked for" moves | Fixed for normal turns. A resumed turn puts tools above it | `55`, `65`, `229` |
| Settings row text starts at different x | Fixed | `93`, `103` |
| Expanded tool card changes width | Fixed. The tool-group header is still shrink-wrapped | `23`, `230` |
| MCP "Sign in" red pill vs amber "Signed out" | Fixed | `46`, `100` |
| Project dialog auto-saves | Fixed (Cancel · Save). Now discards edits silently on Escape / "×" | `47`, `136`, `158` |
| Two ways to block empty submits | Partly fixed: validate on click everywhere except Add project. Error placement still differs | `112`, `128`, `159` |
| Native `<select>` in project dialog | Fixed | `157` |
| Two "Back" buttons on Skill source | Fixed ("Done") | `122` |
| Effort chip "auto" lower case | Fixed | `29`, `32` |
| Settled rows drop avatar / subtitle | Fixed (same row layout) | `152` |
| "/" does nothing | Not fixed (scoped out) | `35` |
| Settled thread without ship has no actions | Fixed | `153` |
| Effort menu doesn't mark current value | Fixed | `32` |
| Thread "…" menu holds a lone "Copy" | Fixed | `27`, `154` |
| Onboarding can't go back | Fixed | `221`, `222` |
| No Projects section in Settings | Fixed. It opens a modal, unlike other sections, and has no Add row | `102`, `135` |
| "Stop automatic follow-ups" jargon | Not fixed | `78` |
| Running line disappears after steer | Fixed | `59`, `61` |
| CI wait reads as done | Not app copy (fixture) | `85` |
| Onboarding add-project gives no feedback | Fixed ("Added verify-project."). The sidebar goes blank | `227` |
| Lightbox doesn't enlarge small images | Fixed | `26` |
| Delivery status squeezes project name | **Regressed:** now both halves truncate and the status is unreadable | `78`, `91` |
| Ctrl+K and "/" don't focus Search | Fixed | s01 log |
| Limits replaces the thread | Not fixed (scoped out) | `34` |
| New thread always via picker | Unchanged (optional) | `11` |
| Add project focus on Close | Fixed | `159` |
| Media links are small text | Not fixed | `164` |
| 900 px overlay: no scrim / focus | Fixed. The sidebar stays clickable | `188`-`190` |
| 900 px panel covers Send / Stop | Fixed (composer is inert under the scrim) | `188` |
| Checkout path offset and bold | Fixed | `47`, `135` |
| Skill source path wraps mid-word | Fixed on the detail page, not on the Skills list | `101`, `122` |

### Regressions introduced by the round-2 changes

1. **Sidebar subtitle truncation (plan C3).** The minimum width on the project name pushes delivery statuses down to "Waitin…" and "CI · imag…", and adds an uneven gap after short names ("No project ·  Ready"). `01`, `78`, `91`.
2. **Header rename (plan A9)** opens a floating input under the "…" button, the floating-rename pattern that plan C5 removed from the sidebar. `144`.
3. **Staged save in the project dialog (plan B8)** means Escape or "×" now silently discard edits, and Escape skips the "cancel the inline confirmation first" rule that Settings follows. `136`-`138`, `158`.
4. **The new Projects section (plan B10)** opens a modal instead of a Settings detail page and has no Add row. `102`, `135`.

## Top 5 changes

1. **Remove the glow and sparkles from the "Ships when done" chip** (Minimalism 7 → 8). Delete the `delivery-glow` and `delivery-sparkle` animations. The chip's spinner is enough. `70`, `zoom-71`, `209`.
2. **Make every menu keyboard-operable** (Accessibility 7 → 8, Efficiency). When the context menu, thread "…" menu, Filter or effort menu opens, focus its first item. Arrow keys and Home/End move between items, Escape returns focus to the trigger. Reuse the model picker's handling. `215`, `216`.
3. **Fix the sidebar subtitle** (Feedback, Layout, Consistency). While a delivery status shows, drop the project name (the avatar names the project) so the status gets the full width. Remove the padded minimum width that causes "No project ·  Ready". `78`, `85`, `91`, `01`.
4. **One dialog and form discipline** (Forms, Consistency). In the project dialog, Escape cancels the inline confirmation first. Unsaved edits ask "Discard changes?" before Escape or "×" closes it. Secret and Hub errors go under the field, as in Add profile. Primary buttons stay enabled after an error. `112`, `128`, `136`-`138`, `158`.
5. **Finish the Settings and thread-pane loose ends** (Consistency, Clarity, Hierarchy):
   - Open projects as a Settings detail page and add an "Add project" row.
   - Middle-truncate the Skills list path.
   - Give sticky footers a top border.
   - Show "Snoozed until Thu 09:00 · Wake now" in a snoozed thread.
   - Put a resumed turn's tools inside its "Worked for" disclosure.
   - Cut the stacked helper sentences on Tools, Secrets and the profile editor.

   `99`, `101`, `102`, `113`, `135`, `155`, `229`.

## Unreachable or partial

- **Onboarding past sign-in.** The account step needs a real Claude or ChatGPT browser sign-in, which the isolated runner can't complete. So the project step (4/4) inside onboarding wasn't reached. The toolbar Add project during onboarding was tested (`225`-`227`). The verify runner also wrote its own evidence folder under `out/verify/`.
- **Destructive actions were opened but not confirmed** (thread delete, profile delete, MCP delete, checkout removal, hub removal), to keep the fixture intact. All were cancelled.
- **"Current notes" / "Space notes" file links** open outside the page, so the headless browser can't capture them.
- **The CI and review flows** were captured at 1280 (`75`-`91`) and the review row at 900 (`211`). The CI flow wasn't repeated at 900.
