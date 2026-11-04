# Accio UI/UX audit — round 2 — gpt-sol

Audited the existing build on Windows in Chromium on 4 November 2026. The populated instance used port 4721 and a disposable home. No rebuild, application-code edit, commit, or access to `~/.accio` was made. Scores describe observed behavior. The UI has improved substantially, especially settings forms, but still has problems beyond nitpicks.

| Category | Score | One-line verdict |
|---|---:|---|
| Minimalism / calmness | 8 | Calm shell and clean stopped notices; completed delivery still repeats itself. |
| Visual hierarchy & typography | 8 | Meaningful helper text is readable; media captions and actions remain undersized and spread apart. |
| Consistency | 9 | Shared form actions, named deletion confirmations, and model names are now coherent. |
| Clarity & discoverability | 8 | Effort and project settings are discoverable; ordinary settled threads and onboarding still hide useful next steps. |
| Feedback & state | 7 | Working, queue, review, and CI states are clear; effort changes silently disappear. |
| Efficiency & flow | 8 | Keyboard navigation and sticky actions help; lost preferences and scattered settings add work. |
| Accessibility | 7 | Contrast, dialog names, and targets improved; the narrow drawer allows invisible keyboard focus. |
| Layout robustness | 8 | Choice and main layouts hold at all requested sizes; drawer occlusion and sidebar truncation remain. |
| Forms & dialogs | 9 | Cancel now discards profile skills, Save persists them, and destructive confirmations are predictable. |

Screenshot filenames below refer to `out/ui-audit/round-2/gpt-sol/`. Related findings appear under more than one category where they affect both; they are not independent defects.

## Minimalism / calmness — 8

1. **Delivery completion still says the outcome repeatedly.** `117-shipped-complete.png` and `118-shipped-900.png` show the assistant publication reply, a centered “Shipped to main · revision” receipt, a persistent Shipped pill with the same revision, and “Thread settled · Workspace retained.” The raw ISO timestamp is gone, but the repetition remains. **Smallest change:** retain one persistent outcome and one workspace fact; place the historical receipt/revision in an optional detail disclosure.
2. **Media actions occupy a much wider measure than the image they belong to.** `149-media-captions-stable.png` shows 160 px images with Open/Download near the opposite end of a 600 px caption row. The vertical relationship is better, but the association is still visually weak. **Smallest change:** size the image caption to the image or group actions immediately after filename/size.

Positive evidence: the Owl placeholder is gone (`01-initial.png`), raw turn-resource JSON is absent from the exercised transcripts, and Stop produces a concise “Stopped.” notice (`92-stopped-queue.png`). Empty diff/Ship controls do not clutter the unchanged Skills fixture (`23-skills-overlay-900.png`).

## Visual hierarchy & typography — 8

1. **Media metadata and its actions are still 11 px.** `149-media-captions-stable.png`; `media-typography.json` measures the caption at 11 px. Contrast is good, approximately 6.35:1, so this is a size/reading-comfort finding, not a failed-contrast claim. **Smallest change:** use 12–13 px captions/actions and keep them beside their item.
2. **Long profile forms still spend substantial height between sections.** At 900×700, `42-profile-900.png` reaches only the Secrets section before the sticky footer. The footer fixes completion access, but frequent account/skill work still involves scrolling through large cards and gaps. **Smallest change:** reduce inter-section spacing to 20–24 px and tighten the name card.

Positive evidence: important profile hints are now 13 px, rgb(143,144,153) against rgb(27,28,32), approximately 5.36:1 (`typography.json`, `40-profile-edit.png`). The primary transcript measure remains readable at 1600 px (`99-long-context-1600.png`).

## Consistency — 9

1. **Connection status retains a minor visual exception.** The settings hub card uses a dot and Connected text, while account and tool state use outlined pills (`35-settings-profiles.png`, `47-account-edit.png`, `69-tool-error-visible.png`). **Smallest change:** use the same quiet status treatment for the current hub. This is a polish issue, not a workflow failure.

The material round-1 inconsistencies are fixed: profile skills participate in Save/Cancel; saved profiles, accounts, tools, MCP definitions, and secrets use named confirmation actions (`45-profile-delete-confirm.png`, `50-account-delete-confirm.png`, `63-secret-delete-confirm.png`, `70-tool-delete-confirm.png`, `76-mcp-delete-confirm.png`). Sonnet has the same visible name in provider and Favourites views (`85-model-picker.png`, `86-model-favourites.png`). Machine editing uses the shared Cancel/Save footer (`52-machine-edit.png`).

## Clarity & discoverability — 8

1. **An ordinary settled No project thread has no explicit state/action row.** `106-settled-manually.png` shows only the changed composer placeholder and a collapsed Settled shelf. There is no composer Reopen action. The header’s Thread actions menu contains only Copy (`108-settled-actions.png`). Reopening required expanding the shelf and using its row menu. **Smallest change:** show “Settled” with Reopen beside the composer for every settled thread; show Archive where a releasable workspace exists.
2. **The first-run sign-in gate still hides the project-first route.** `156-onboarding-signin-gate-stable.png` offers only Sign in with ChatGPT in the main pane. The Add project icon works, as independently proven in `13-onboarding-project-sheet.png` and `14-onboarding-project-added.png`, but that alternative is unexplained. **Smallest change:** add “Set up a project first” linking to the existing sheet.

Positive evidence: effort has a separately named button and choice menu (`87-effort-options.png`), the project breadcrumb opens settings (`30-project-sheet.png`), Secrets explains the purpose key (`59-secret-add.png`), and shipping-option selection changes the main action without starting delivery (`114-review-mode-selected.png`, `123-review-mode-idle.png`).

## Feedback & state — 7

1. **Effort changes silently revert to Auto.** In a fresh draft, I selected High and then sent the first message. `88-effort-selected.png` → `89-steering-running.png` shows High becoming Auto. A second independent fresh draft reproduced it with Opus: `132-effort-retest-before.png` → `133-effort-retest-after.png`. On an existing thread ArrowUp displayed Low (`134-effort-keyboard.png`), but reloading returned Auto (`135-effort-reload.png`). There was no saving indication or error. Read-only thread metadata also contained no selected effort on the first tested thread. **Smallest change:** persist the chosen effort with draft creation and existing-thread updates, retain it when applying server snapshots, and surface any rejected save. These observations establish a user-visible persistence defect; they do not establish what effort a real provider executed.

Positive evidence: “Working” replaces the mismatched generic Thinking label (`89-steering-running.png`, `112-delivery-working.png`). Queue editing closes on Stop while the queued item remains visibly paused (`91-queue-edit.png` → `92-stopped-queue.png`). Tool installation leads with a useful sentence and collapses the raw error (`69-tool-error-visible.png`). Review reaches Waiting for merge, stopped follow-ups remain explained, and CI shows actual fixture steps (`125-review-prepared.png`, `127-review-followups-stopped.png`, `128-ci-build-progress.png`, `129-ci-push-progress.png`).

## Efficiency & flow — 8

1. **Changing effort requires corrective work after sending or reloading.** The persistence defect above directly affects the normal model-configuration flow (`132-effort-retest-before.png`, `133-effort-retest-after.png`, `135-effort-reload.png`). **Smallest change:** fix persistence so choosing effort is one lasting action.
2. **Limits and Projects remain outside Settings navigation.** `35-settings-profiles.png` lists the available sections; neither is present. Limits is a separate footer/composer view (`82-limits.png`), while project administration is reached through the filter or project crumb (`30-project-sheet.png`). **Smallest change:** add Settings links to the existing views while retaining the shortcuts.

Positive evidence: Ctrl+N opens the picker; Enter chooses its selected option (`83-new-thread-keyboard.png`); ArrowDown moves between sidebar rows; Escape clears search (`110-search-no-results.png`). Model ArrowDown focused Sonnet; favourites worked. Steering, Ctrl+Enter queueing, editing/removal, Stop and Resume were exercised. Sticky form actions remain available at 900×700 (`42-profile-900.png`). Narrow Choice uses two columns (`20-choice-900.png`).

## Accessibility — 7

1. **The narrow drawer can completely hide the keyboard focus.** At 900×700, open Skills, focus the model button, then Tab through Effort to Limits. `138-drawer-hidden-limits-focus.png` contains no visible Limits focus indicator because the drawer covers it. Read-only geometry placed focused Limits at x=767.75, y=647, width=67.25, inside the drawer’s x≈581–900 footprint. Its computed 2 px focus outline exists but is occluded. Escape left the drawer open. **Smallest change:** in overlay mode, make covered content inert and manage focus within the drawer, with Escape closing it and returning focus; alternatively collapse a pane so controls remain exposed.
2. **Choice pick buttons remain 22×22 px.** The initial Choice snapshots measure these targets (`20-choice-900.png`, `21-choice-lightbox.png`). **Smallest change:** expand the pick hit area to at least 24 px, preferably 28–32 px. This is a target-size observation; no full WCAG conformance determination is claimed.

Positive evidence: the sampled meaningful helper copy now exceeds 4.5:1; the Add project and project settings dialogs have accessible names (`31-add-project.png`, `30-project-sheet.png`); toolbar targets are 32×32 px and row actions 24×24 px; form controls have visible focus (`59-secret-add.png`). Settings contains one main landmark. No screen-reader session was performed.

## Layout robustness — 8

1. **The overlay preserves transcript width by covering useful controls.** `23-skills-overlay-900.png` and `138-drawer-hidden-limits-focus.png` show the composer extending behind the drawer, including Limits/Send. This fixes the previous squeezed three-pane layout but introduces the focus issue above. **Smallest change:** use a dismissible modal drawer with proper focus containment, or temporarily collapse the sidebar.
2. **Sidebar project names still collapse to a few characters.** In review state, `125-review-prepared.png` and `126-review-900.png` show “revi…” before Waiting for merge. Settled rows reduce delivery-project to “deli…” (`118-shipped-900.png`). A 120-character title remains an indistinguishable prefix; focusing it for 900 ms produced no visible full-title tooltip (`150-long-title-keyboard-tooltip.png`). **Smallest change:** give project names a minimum readable measure, truncate title/status first, and display the full title on keyboard focus.

Positive evidence: Choice was captured at 900×700, 1280×900, and 1600×1000 (`20-choice-900.png`, `142-choice-1280.png`, `19-choice-1600.png`); the narrow two-column change works. Long context, media/tools, skills, settings, and shipped views were exercised across the requested sizes. No persistent whole-window horizontal overflow was observed. Shelves stay clear of the footer at 1280×500 (`107-shelves-short.png`).

## Forms & dialogs — 9

1. **Add project initially focuses Close rather than Folder.** `31-add-project.png` exposes Close as the active control. **Smallest change:** autofocus Folder so typing the path is the first keyboard action. This is a small efficiency polish issue.

The material form defects are fixed. Selecting lib-review, cancelling, and reopening left it unchecked (`41-profile-cancel-discards.png`); selecting it and saving persisted it (`147-profile-skill-saved.png`). Machine Cancel discarded a rename and Save retained it. Profile/account/tool/MCP/secret delete flows showed named confirmations. Folder, profile-name, tool-version, and MCP-URL errors were local and specific (`145-invalid-folder.png`, `43-profile-name-validation.png`, `66-tool-version-validation.png`, `73-mcp-url-validation.png`). Project removal explains deletion of its one thread before confirmation (`146-checkout-remove-confirm.png`); cancellation preserved it. Project sheets closed through Escape and outside click; the Choice lightbox and model/effort popovers closed through Escape.

## Round-1 findings: fixed / not fixed

| Round-1 finding | Current result and evidence |
|---|---|
| Raw resource JSON; noisy stopped notice; Owl placeholder | **Fixed** in exercised fixtures — `07-tool-calls-open.png`, `92-stopped-queue.png`, `01-initial.png`. |
| Profile Cancel retained skills; immediate profile deletion | **Fixed** — `41-profile-cancel-discards.png`, `45-profile-delete-confirm.png`, `147-profile-skill-saved.png`. |
| Weak helper contrast/size; unnamed project dialogs; small toolbar targets | **Fixed / improved** — measured 13 px, 5.36:1 profile hints; named dialogs; 32 px toolbar (`typography.json`, `30-project-sheet.png`, `31-add-project.png`). |
| Hidden effort control; differing model names | **Discoverability/name fixed**, but effort persistence now fails in two drafts and after reload — `85-model-picker.png`, `86-model-favourites.png`, `132-effort-retest-before.png`, `133-effort-retest-after.png`, `135-effort-reload.png`. Regression candidate; first-send persistence was not established in round 1. |
| Raw install error; generic Thinking; popover anchor flash | **Fixed / not reproduced** — human error and Working observed; shipping menu was anchored in the immediate capture (`69-tool-error-visible.png`, `112-delivery-working.png`, `113-shipping-options.png`). No frame-by-frame timing claim. |
| Long forms hide actions; inconsistent deletion wording | **Fixed** for exercised editors — `42-profile-900.png`, `45-profile-delete-confirm.png`, `63-secret-delete-confirm.png`, `70-tool-delete-confirm.png`. |
| Purpose guidance; unexplained disabled Ship on unchanged Skills fixture | **Fixed for those views** — Purpose key guidance is explicit; unnecessary Ship is absent (`59-secret-add.png`, `23-skills-overlay-900.png`). A changed worktree without a remote was not exercised, so its disabled reason remains unverified. |
| Tiny Choice previews; squeezed three panes | **Choice fixed; pane issue partly fixed with a regression** — two columns work, but overlay hides keyboard focus (`20-choice-900.png`, `138-drawer-hidden-limits-focus.png`). |
| Repeated delivery output; far-away media actions | **Partly fixed** — timestamp removed and caption moved beneath media; repeated outcome and excessive horizontal separation remain (`117-shipped-complete.png`, `149-media-captions-stable.png`). |
| Large settings gaps; scattered Limits/Projects; keyboard long-title recovery; sign-in-only first-run main pane | **Not fixed** — `42-profile-900.png`, `35-settings-profiles.png`, `150-long-title-keyboard-tooltip.png`, `156-onboarding-signin-gate-stable.png`. |

## Top 5 changes

1. **Persist effort reliably.** Preserve the chosen level through first send, server updates, and reload; acknowledge failure. Highest impact on trust and normal configuration flow.
2. **Finish the narrow drawer’s interaction model.** Prevent focus behind it, support Escape and focus restoration, and keep primary controls usable.
3. **Protect sidebar project names and keyboard title recovery.** Avoid four-character project labels and reveal the complete focused title.
4. **Show a consistent settled-state row.** Give every settled thread an explicit Reopen action, with Archive where applicable.
5. **Say delivery completion once.** Consolidate the repeated receipt/status and keep optional revision details folded away.

## Coverage, evidence, and unreachable paths

- **Populated app:** inspected sidebar rows/hover actions/right-click menus, rename, snooze/wake, settle/reopen, deletion confirmation, search/empty result/Escape, project filtering/clearing, new-thread picker/empty search, footer settings and Limits. Running threads remained in the main list; there was no separate Working shelf in this build. Nonempty Snoozed/Settled shelves and the short window were exercised.
- **Transcript/composer:** collapsed/expanded successful and failed tools; long output with Show all affordance; text; image lightbox; filenames with spaces/Unicode/percent signs; missing-media status; file links; Choice/lightbox/pick; model/provider/Favourites and keyboard movement; effort menu/arrows; Limits; streaming; 70-paragraph context; exploration; steering; queue/edit/remove; Stop/Resume. Video/audio playback was started through native controls and read-only observation confirmed `paused:false` with advancing time (`152-media-playback.png`). Audible output was not assessed. File-link click exposed no browser preview; native OS opening remains unverified.
- **Delivery:** Build delivery fixture → mode selection → queued Ship → Shipped → Reopen → Archive (`115-ship-queued.png`, `117-shipped-complete.png`, `120-shipped-reopened.png`, `157-archived-stable.png`); Build review fixture → Prepare for review → Waiting for merge → stop automatic follow-ups; Build CI progress fixture → Ship → Build image → Push image → completion. The harness and hosting responses are deterministic substitutes; repositories/publication are disposable real Git. The displayed GitHub PR is a fixture URL, not a PR created for this audit. Real provider inference, live GitHub reviews, external merge, and failing-CI remediation are unverified.
- **Settings:** every actual section was visited: Accounts, Secrets, Profiles, Harnesses, System prompt, Machines, Tools, MCP servers, Skills, Hubs. Limits and project administration were reached through their actual external entry points. Exercised add/edit/cancel/confirmation paths include profiles/accounts, secret add/edit/replace/cancel/delete, tool add/version rejection/install failure/delete, MCP remote/stdio/invalid URL/save/delete, skill source/scope/copy/add forms, repository instruction edit/cancel, machine rename/cancel/save, hub add/cancel, and project remove/cancel. Opening a form does not prove its external service operation.
- **First run:** the unmodified 3-verify runner executed `journey.mjs` and `gate-journey.mjs` against fresh homes. It proved hub/profile creation, inline missing-name validation, provider choice, the stable sign-in gate, a signed-out account, and toolbar project inspection/add. Evidence: `out/verify/2026-11-04T08-08-35-839Z-4e59fb1e`, `out/verify/2026-11-04T08-28-11-595Z-26efacb8`, and `out/verify/2026-11-04T08-29-08-534Z-a7cef9cd`. The middle run captured a transition; `156-onboarding-signin-gate-stable.png` is the stable evidence. All runners passed and tore down their owned servers/scratch homes. Authenticated inline project onboarding and provider OAuth were unreachable without provider approval.
- **Other unverified operations:** real MCP OAuth/remote calls, hub pairing/switching/removal across endpoints, multiple-machine behavior, successful managed-tool installation/paid repair, skill-source clone/update/apply/rollback and project-copy execution, six-plus settled-row paging, native Electron Browse/OS open, and exhaustive cancellation races. Their required endpoints, accounts, fixture counts, or native bridge were absent; available forms were inspected. No full accessibility-conformance claim is made.
- **Browser tooling:** preview automation was used first. Repeated timeout opening Profiles with a fresh locator caused a switch to Playwright on the same isolated server. Locator/time-out failures during exploration were audit-driver failures, not assigned product defects. Some numbered screenshots intentionally preserve transitions; findings use the specified stable evidence. ARIA snapshots, read-only typography measurements, and selected non-secret thread state accompany the screenshots.
- **Cleanup:** the Playwright browser and preview tab were closed. Only PID 21012, listening on populated port 4721, was stopped after checking its command line. `cleanup.json` confirms the port closed. Verification runners separately stopped only their own children. This auditor made no application-file edits or commits; concurrent workspace changes belong to other work. The audit retains 155 numbered PNG screenshots.
