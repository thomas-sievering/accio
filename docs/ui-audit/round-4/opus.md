# UI / UX audit: round 4, Claude Opus 5.5

Screenshots: `out/ui-audit/round-4/opus/NN-<view>.png` (01-244). The populated app ran on an isolated chat-test server on port 47652. Captures are 1280x900 unless noted. Other sizes: 1600x1000 (174-195), 900x700 (196-219), 1280x500 (220-222). First-run onboarding ran through the 3-verify runner (233-244). `zoom-*.png` files are 2x crops of existing screenshots. The driver scripts (`s01`-`s18`, `journey.mjs`, `journey2.mjs`) and ARIA snapshots (`aria-*.yml`) are in the same folder.

I opened the hub removal confirmation and cancelled it with Escape (`129`, `130`). The hub was never removed, so one server session covers every capture.

## Scores

| # | Category | Score | Verdict |
|---|----------|-------|---------|
| 1 | Minimalism / calmness | 8 | The Ship glow and sparkles are gone, the shipped row states each fact once, and Tools and Secrets lost their stacked text. Left: four helper sentences in the Add tool form, a dense paragraph on Skill source, and a Filter icon that turns green next to its own chip. |
| 2 | Visual hierarchy & typography | 8 | Resumed turns fold under "Worked for", the System prompt is regular weight at 72ch, and captions use one size. The queue-edit row makes Save look disabled and Cancel look primary. The CI chip says "image · Build image". |
| 3 | Consistency | 8 | Validation, Projects pages and in-place rename are now consistent. Confirmations come in four button orders and three words ("Cancel", "Keep", "Keep editing"). An enabled skill is labelled three different ways, and a snooze time two ways. |
| 4 | Clarity & discoverability | 8 | A snoozed thread says so and offers "Wake now", and "Stop watching PR" is plain. Onboarding still says "A side of your life threads run under." The Choice pick buttons show a checkmark at rest, so all three options look already selected. |
| 5 | Feedback & state | 9 | Sidebar delivery states read in full ("Ships when done", "Review · #123", "CI · step 2/4", "Shipped"). Running, stopped, resumed, queued/paused, settled and snoozed are all unmistakable. Only nitpicks are left. |
| 6 | Efficiency & flow | 9 | Every menu works from the keyboard. Ctrl+K, "/", Ctrl+N, Enter / Ctrl+Enter and Escape all work, and Limits now closes back to the thread. Limits is still a full-page detour, and "/" in the composer does nothing (both scoped out). |
| 7 | Accessibility | 8 | The menu keyboard pattern, the inert sidebar under the overlay, and hover actions taken out of the Tab order are all fixed. Left: media Open / Download are still bare text, focus drops to `<body>` after leaving the Discard prompt, and row names include the avatar letter ("RBuild review fixture"). |
| 8 | Layout robustness | 8 | The Skills path is middle-truncated, the project dialog fits at 700 px, and the onboarding heading stays put between steps. **Regression:** the onboarding "Set up a project first" sheet has no padding at all. |
| 9 | Forms & dialogs | 8 | The project dialog asks "Discard changes?", Escape cancels the inline confirmation first, and validation is inline everywhere. The same form on the new Settings page throws away edits silently on Escape or when you switch section. |

## Findings by category

### 1. Minimalism / calmness (8)

1. **The Add tool form still stacks helper text.** Under the fields: "Pin an exact version so every machine runs the same tool.", "Accio runs the executable with these arguments (separated by spaces) to check it works.", "Saving installs and checks this tool on this machine. Managed tools are available…", and "When a check fails, Accio starts a thread…". With the three red errors, that is seven lines of small text around five inputs (`115-settings-add-tool-empty-submit.png`). *Fix:* keep the Version hint as the field placeholder ("1.2.3, exact") and fold the "Saving installs…" sentence into the page intro. Drop the other two.
2. **The Skill source page opens its Skills section with a bold-laced paragraph:** "**Enable for…** keeps a skill managed by Accio… **Copy into project** writes an independent copy…" (`122-settings-skill-source.png`). *Fix:* move each explanation into its button's `title` and remove the paragraph.
3. **The Filter icon turns green while the "skills-project ×" chip is visible** (`11-new-thread-with-filter.png`). The dot is gone, but a tinted icon is still a second signal for one state, and it is the only green control in the toolbar. *Fix:* leave the icon in its normal colour. The chip already shows the filter.
4. **"checked just now" under the review chip has its own amber dot** (`82-review-progress-3.png`, `210-review-900.png`), even though the chip beside it already has an amber border. *Fix:* drop the dot.
5. **The account Limits card contradicts itself:** "This account doesn't report usage limits." and then "Set by Anthropic and counting all of this account's use, including use outside Accio." (`227-settings-account-detail.png`). *Fix:* show the second sentence only when limits are reported.

### 2. Visual hierarchy & typography (8)

1. **Queue-item edit inverts the button emphasis.** "Save" is dim plain text and "Cancel" has a filled background, so Cancel reads as the primary action. The edit field is also bold with a bright 2 px ring (`62-queue-edit.png`). *Fix:* give Save the small primary style and make Cancel plain. Use the regular-weight input style.
2. **The CI chip repeats itself:** "CI · image · Build image · step 2 of 4" (`85-ci-progress-1.png`). *Fix:* "CI · Build image · 2 of 4". The job name already appears in CI details.
3. **"Stopped." and "Resumed" are two centred lines** (`232-resume-scroll-up-3.png`). They are the only centred text in the transcript, and they use two rows for one event. *Fix:* one left-aligned muted line, "Stopped · resumed", in the same style as "Worked for".
4. **The "image ↗" link in CI details is bright underlined blue** (`88-ci-details-expanded.png`). It is the only browser-blue link in the app. *Fix:* use the muted underlined link style from "Current notes".

### 3. Consistency (8)

1. **There are four confirmation layouts.**
   - Hub: "Remove Local dev · Cancel", destructive first, consequence as the subtitle (`129`).
   - Checkout: "Keep · Remove checkout and delete 1 thread", safe first (`137-settings-project-remove-checkout.png`).
   - Profile: "Delete Personal · Cancel", then the consequence after the buttons (`132`).
   - Project dialog: "Discard changes? · Discard · Keep editing" (`147-project-settings-dirty-close.png`).

   The back-out word changes too: Cancel, Keep, Keep editing. *Fix:* one pattern everywhere, with the consequence text first, then a quiet back-out button, then the red action last. Use "Cancel" as the back-out word except in "Discard changes?", which keeps "Keep editing".
2. **An enabled skill has three labels:** "On for this profile" in green (profile editor, `107`), "Enabled: Personal" in green (Skill source, `122`), and "On for profile Personal" in grey (project page and dialog, `135`, `47`). *Fix:* use "On for Personal" in the neutral `--dim` colour on all three.
3. **The same snooze time is written two ways:** "Snoozed until tomorrow 09:00" in the pane and the status line (`171`, `166`), and "Thu 09:00" on the sidebar row (`170`). *Fix:* use the relative form ("tomorrow 09:00") in both places.
4. **Validation wording differs:** Add profile says "Name required" (`105`, `235`), while every other form uses a sentence ("Enter a name for the secret.", "Give the tool a name.", `112`, `115`). *Fix:* "Enter a name for the profile."
5. **The CI details disclosure uses a ▶ triangle** (`85`). Everything else uses the chevron ("Worked for ›", "Settled ›"). *Fix:* use the chevron.
6. Good: one validation pattern under the field (`105`, `112`, `115`, `118`, `128`, `159`). Projects is a detail page with a breadcrumb and an Add row (`102`, `135`). The header title is renamed in place (`161`). The uneven gap after "No project" is gone (`01`).

### 4. Clarity & discoverability (8)

1. **Choice options all look picked.** Each thumbnail has a filled dark circle with a checkmark at rest (`36-thread-choice.png`). A checkmark means "selected", so a new user reads all three as chosen. On B it also covers the thumbnail's own "Add account" button. *Fix:* show an empty ring at rest and the checkmark only on hover, focus or after picking.
2. **The onboarding profile sentence is still broken:** "A side of your life threads run under. Add more later in Settings." (`234`, `235`). Settings now reads well (`95`). *Fix:* reuse the Settings sentence, "A profile groups the accounts and projects for one side of your life, such as personal or work."
3. **A collapsed "INHERITED 1" in the side panel has no chevron.** The chevron only appears once it is expanded (`41`, `179` vs `44`), so it doesn't look clickable. *Fix:* show "›" when collapsed, as on the Settled shelf.
4. **"In use by Personal. Remove it from those profiles first."** uses a plural for one profile (`227`). *Fix:* "Remove it from Personal first."
5. Not fixed (scoped out): typing "/" in the composer still does nothing (`35-composer-slash.png`).
6. Good: snoozed threads show "Snoozed until tomorrow 09:00 · Wake now" (`171`), and Wake now works (`172`). The review row says "Stop watching PR" (`82`). The new-thread picker no longer has a back arrow (`12`).

### 5. Feedback & state (9)

1. **After onboarding adds a project, the sidebar goes completely blank.** "No projects yet." disappears, but the new project isn't listed either (`241-onboarding-after-project-first.png`, `242`). The "Added verify-project." line is the only confirmation. *Fix:* keep a one-line sidebar empty state ("verify-project · no threads yet").
2. **The CI-pending reply still says "Verification complete. Published the committed change."** while CI is on step 2 of 4 (`85`). This is fixture text, so it isn't scored.
3. Good: every sidebar delivery status is readable at 1280 and 900 (`70`, `82`, `85`, `91`, `210`). "Working · Ns" stays at the end of the turn through steering (`61`). After Stop the queue item turns "paused · Send now" (`64`). Shipped threads show the chip plus Reopen / Archive / Open app with no repeated "Settled" (`74`, `90`). The CI caption is now 12 px (`88`).

### 6. Efficiency & flow (9)

1. **Limits is still a full-page detour from the composer** (`34`). It no longer shows a panel toggle, and closing it returns to the thread you came from (`229-limits-closed-returns.png`, log `after limits close header S skills-project / Skills fixture`). The popover is scoped out.
2. Good: the context menu opens with Shift+F10 and focuses "Rename…". The arrow keys move between items, and Escape returns focus to the row (s12 log, `141-context-menu-keyboard.png`). The header "…" menu, Filter and effort menus work the same way (`142`). Ctrl+K and "/" focus Search, Ctrl+N opens the picker, and the Tab order no longer stops on hover actions (s12 log).

### 7. Accessibility (8)

1. **Media Open / Download are still bare 12 px text** with no button shape or hover background (`17`, `22`, `197`). This is the third round with this finding. *Fix:* 24 px ghost buttons with the hover background used on the composer chips.
2. **Focus is lost after backing out of "Discard changes?" with Escape.** The first Escape shows the prompt with focus on "Keep editing" (`150`). The second Escape returns to the form, but focus lands on `<body>` (s15 log: `dialogs after 2nd esc 1 focus BODY`, `151`). *Fix:* return focus to the field that was being edited, or else to Save.
3. **Thread and project rows include the avatar letter in their accessible names:** "RBuild review fixture…", "SSkills fixture…", "Cci-progress-project" (s12 tab-order log, s16 log). A screen reader says "R Build review fixture". *Fix:* `aria-hidden` on the letter avatar.
4. **Validation messages are 12 px pinkish-red on the card background** (`112`, `115`). They read but are faint next to 13-14 px labels. *Fix:* use the same `--danger` colour as "Delete thread" (`03`).
5. Good: the 900 px overlay makes both the pane and the sidebar inert, a click on the scrim closes it, and focus returns to the toggle (s10 log `inert: ASIDE.sidebar | DIV.main`, `201`-`203`). Opening the panel focuses its first tab. Add project focuses Folder (`158`).

### 8. Layout robustness (8)

1. **Regression: the onboarding "Set up a project first" sheet has no padding.** The "Folder" label and input touch the dialog's left and right edges, and Cancel / Add sit on the bottom edge with no footer band (`239-onboarding-project-first-sheet.png`, `zoom-239.png`). The same sheet opened from the onboarding sidebar button is correct (`243`), and so is the one in the main app (`158`). *Fix:* render the link's sheet through the same `Sheet` body and footer wrapper as the toolbar button.
2. **At 1280x500 the project dialog cuts off at "Checkouts on this machine"** with no fade or scrollbar to show that Skills is below (`222-project-settings-1280x500.png`). *Fix:* a 16 px bottom fade on the scroll area when there is more content.
3. **The sign-in step of onboarding uses an inline "Sign in with Claude" button plus two stacked underlined links,** "Back" and "Set up a project first" (`237`). Every other step has a full-width Continue (`233`, `234`, `241`). *Fix:* make the sign-in button full width and put Back and the project link on one muted row.
4. Good: the heading now sits at y=178 on every onboarding step (journey log). The Skills list path is middle-truncated (`213`). The project dialog fits at 900x700 with Cancel · Save visible (`218`). Long titles truncate in the header and wrap on focus (`164`, `165`, `197`). Transcript and composer share one column at 900, 1280 and 1600 (`17`, `175`, `197`).

### 9. Forms & dialogs (8)

1. **The Settings project page throws away unsaved edits without asking.** I edited the Preview command and pressed Escape: the page went back to the Projects list (`155-settings-project-dirty-escape.png`). Clicking another section did the same (`156`), and the edit was gone when I reopened the page (s15 log: `preview after nav away node preview.cjs`). The same form as a dialog asks "Discard changes? · Discard · Keep editing" (`147`, `150`, `154`). Plan B2 created this page in round 3, so this is new. *Fix:* use the dialog's dirty guard on Settings detail pages: Escape, Back, a section click or a breadcrumb click shows the same footer prompt.
2. **The queue-edit row has inverted button emphasis** (Hierarchy #1, `62`).
3. **The confirmation layouts differ** (Consistency #1).
4. Good: in the dialog, Escape first cancels the inline "Remove checkout" confirmation (`152` → `153`). With unsaved changes, Escape, "×" and an outside click all ask before closing (`147`, `150`, `154`). Add project keeps Add enabled and says "Choose a folder" or "… is not a folder" under the field (`159`, `160`). Add tool and Add MCP server keep their primary buttons enabled after a failed submit (`115`, `118`). Profile deletion now states its consequence (`132`).

## Round-3 findings: fixed / not fixed

| Round-3 finding | Status | Evidence |
|---|---|---|
| Ship chip glow and sparkles | Fixed | `70`, `184`, `208` |
| Helper text stacked (Tools, Secrets, profile editor) | Fixed on those pages. The Add tool form still stacks helper text | `94`, `99`, `107`, `115` |
| Shipped state said three ways; review caption repeats the chip | Fixed | `74`, `82` |
| Filter dot next to the filter chip | Partly fixed: the dot is gone, but the icon turns green | `11` |
| Resumed turn puts tools above "Worked for" | Fixed | `232` |
| "Resume" as an italic user bubble | Fixed (muted "Resumed" line, now split from "Stopped.") | `232` |
| System prompt in bold monospace | Fixed (weight 400, 527 px wide) | `97`, s18 log |
| Two caption sizes | Fixed | `22`, `23` |
| Shrink-wrapped tool-group header | Fixed | `23` |
| Validation in two places | Fixed | `112`, `128` |
| Projects opens a modal | Fixed (detail page) | `135` |
| No Add project row | Fixed | `102` |
| Two rename styles | Fixed | `161` |
| Uneven subtitle gap | Fixed | `01` |
| Delete confirmations explain differently | Partly fixed: profile has a consequence line now, but there are four button layouts | `129`, `132`, `137`, `147` |
| Snoozed thread looks normal | Fixed | `171`, `172` |
| "Stop automatic follow-ups" | Fixed | `82` |
| Profile wording | Fixed in Settings, **not in onboarding** | `95`, `235` |
| "/" does nothing | Not fixed (scoped out) | `35` |
| New-thread picker back arrow | Fixed | `12` |
| Sidebar delivery states unreadable | Fixed | `70`, `85`, `91`, `210` |
| CI detail line 10-11 px | Fixed | `88` |
| Limits replaces the thread; panel toggle on Limits | Partly fixed: no toggle, and close returns to the thread. Still a full page | `34`, `229` |
| Menus not keyboard-operable | Fixed | `141`, `142`, s12 log |
| Media Open / Download bare text | **Not fixed** | `17`, `197` |
| Settings row focus ring drawn as two lines | Not re-tested this round | n/a |
| Sidebar clickable under the 900 px overlay | Fixed | `201`-`203` |
| Skills list path wraps mid-word | Fixed | `101`, `213` |
| Sticky footer cuts helper text | Not reproduced (`zoom-113`, `216`) | `113`, `216` |
| Project dialog taller than 700 px | Fixed | `218` |
| Onboarding content jumps between steps | Fixed for the heading. The sign-in step still uses a different button layout | `233`-`241` |
| Project dialog discards edits on Escape / × | Fixed in the dialog. **The new Settings page discards silently** | `147`, `150`, `154`, `155`, `156` |
| Primary buttons grey out after a failed submit | Fixed | `115`, `118` |
| Add project's Add disabled when empty | Fixed | `159` |

### Regressions introduced by the round-3 changes

1. **The onboarding "Set up a project first" link (plan B12) opens an unpadded Add project sheet.** `239`, `zoom-239`. The sheet from the sidebar button is fine (`243`).
2. **The Settings project page (plan B2) discards edits on Escape or a section switch without asking,** while the dialog version of the same form asks. `155`, `156`.
3. **The discard prompt (plan B3) leaves focus on `<body>`** after a second Escape. `151`, s15 log.
4. **The new confirmation words (plan B3: "Keep", "Keep editing") added a third and fourth confirmation layout** instead of unifying them. `137`, `147`.
5. **The Filter dot (plan C6) turned into a green icon,** which is the same double signal. `11`.

## Top 5 changes

1. **Fix the onboarding Add project sheet** (Layout 8 → 9). Render the "Set up a project first" sheet through the same `Sheet` wrapper as the sidebar button, so it gets body padding and a footer band. `239`, `243`.
2. **Guard unsaved edits on every Settings detail page** (Forms 8 → 9). Reuse the dialog's "Discard changes? · Discard · Keep editing" footer for Escape, Back, a breadcrumb click or a section click when the form is dirty. After "Keep editing", return focus to the edited field. `151`, `155`, `156`.
3. **One confirmation pattern** (Consistency 8 → 9, Forms):
   - Order: consequence text, then a quiet "Cancel", then the red action on the right.
   - Apply it to hub removal, checkout removal, profile, MCP and thread delete. The discard prompt keeps "Keep editing" as its back-out word.

   `129`, `132`, `137`, `147`, `120`.
4. **One word per state** (Consistency, Clarity):
   - Enabled skills say "On for Personal" in the neutral colour.
   - Snooze times use the relative form everywhere.
   - "Enter a name for the profile."
   - Onboarding uses the Settings profile sentence.
   - Choice pick buttons show an empty ring at rest.

   `36`, `107`, `122`, `135`, `170`, `171`, `235`.
5. **Finish the small accessibility and hierarchy items** (Accessibility 8 → 9, Hierarchy 8 → 9):
   - Open / Download become 24 px ghost buttons.
   - `aria-hidden` on avatar letters in row names.
   - Queue edit: Save primary, Cancel plain.
   - "Stopped · resumed" on one line.
   - CI chip: "CI · Build image · 2 of 4".
   - Trim the Add tool helper sentences to one.

   `17`, `62`, `85`, `115`, `232`.

## Unreachable or partial

- **Onboarding past sign-in.** The account step needs a real Claude or ChatGPT browser sign-in, which the isolated runner can't complete. I tested the new "Set up a project first" path (`239`-`241`) and the sidebar Add project during onboarding (`243`). The runner also wrote its own evidence under `out/verify/`.
- **Destructive actions were opened but not confirmed** (thread delete, profile delete, MCP delete, checkout removal, hub removal), to keep the fixture intact.
- **"Current notes" / "Space notes" file links** open outside the page, so the headless browser can't capture them.
- **I didn't re-check the Settings list-row focus ring** from round 3 this round.
- **Harnesses has no editable items,** so there is no detail page to test (`96`).
