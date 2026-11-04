# Accio UI/UX audit — round 4 — gpt-sol

Audited the current built UI in Chromium on Windows on 4 November 2026, using the isolated chat server on **47653** and the fresh-home 3-verify runner. No rebuild or application-source edit was made. There are **191 numbered PNG screenshots** in `out/ui-audit/round-4/gpt-sol/`, accompanied by ARIA snapshots and focused keyboard observations. Scores reflect observed behavior, not completion of the change plan.

| Category | Score | One-line verdict |
|---|---:|---|
| Minimalism / calmness | 9 | Shipping is quiet and concise; small skill-label redundancy remains. |
| Visual hierarchy & typography | 8 | Transcript hierarchy works; the narrow profile editor still spends too much height before its choices. |
| Consistency | 9 | Settings, project details, status pills and confirmations are coherent. |
| Clarity & discoverability | 8 | Project-first onboarding is clear; Stop watching PR misstates the action's scope. |
| Feedback & state | 9 | Effort persists and work, queue, review and CI states are explicit. |
| Efficiency & flow | 8 | Keyboard menus work; form scrolling and disconnected recovery/navigation still add steps. |
| Accessibility | 8 | Sidebar controls are inert under the overlay, but its resize handle still receives keyboard focus. |
| Layout robustness | 8 | Main views fit all three sizes; complete title recovery now shifts neighboring rows. |
| Forms & dialogs | 9 | Validation, staged saves, discard prompts and named confirmations behave predictably. |

Screenshot references are filenames in that evidence directory. Repeated references across categories identify the same issue, not additional defects. A 9 means only small polish issues in the exercised scope; real provider authentication, OS integration and screen-reader conformance are not established by this audit.

## Minimalism / calmness — 9

1. **A library skill repeats its origin.** After adding lib-review through the side panel, its row says **Library · Library** (`184-skill-enabled.png`, `185-library-skill-expanded.png`). One word is the origin kind and the other is this source's name, but the visual result earns neither repetition. **Smallest change:** deduplicate equal origin/source labels; retain the source name in expanded details.

The shipped footer now contains the outcome chip and actions without a second Settled label or Workspace retained line (`132-shipped-1280.png`, `133-shipped-900.png`). The workspace fact is available on the chip. Queued Ship has a spinner without the old decorative glow (`130-ship-queued.png`, `131-ship-queued-1280.png`). Review's caption is short (`139-review-waiting-1280.png`). Media actions remain next to their item (`10-media-playing.png`).

## Visual hierarchy & typography — 8

1. **The compact profile form still hides its actual skill choices at 900×700.** `40-profile-900.png` reaches the Skills heading and explanation, but the first choice is cut by the sticky footer and the second is below it. The name-only card and a roughly 60 px Saved secrets card consume space before the useful lower controls. This is improved from round 3, but the stated compact-editor result is incomplete. **Smallest change:** make Saved secrets a plain compact link row and reduce the name-card padding; preserve the sticky Save/Cancel footer and ordinary section spacing.

Transcript text, turn disclosures and tool input/output have clear hierarchy (`108-all-tools-expanded.png`). Media captions remain readable and attached to their items. CI details use a restrained small caption instead of competing with the current step (`146-ci-details.png`). Long context and full tool output remain bounded at wide sizes (`104-long-context-1600.png`, `165-tool-full-output-1600.png`).

## Consistency — 9

1. **The same origin information is combined inconsistently in skill rows.** Repository skills have one clear origin label; the newly enabled library skill renders Library · Library (`185-library-skill-expanded.png`). **Smallest change:** apply the deduplication described under calmness. This is one shared polish issue, not two separate problems.

Hub Connected now uses a quiet pill (`35-settings-hubs.png`), resolving my round-3 exception. Settings / Projects / delivery-project is a real detail page with the same staged form and footer (`73-project-settings-detail.png`); shortcuts still open the dialog (`123-project-dialog.png`). Done, Delete thread, model names and confirmation naming remain consistent. No other material visual inconsistency was established.

## Clarity & discoverability — 8

1. **Stop watching PR promises more than it does.** The waiting-review screen offers **Stop watching PR** (`139-review-waiting-1280.png`). After using it, the screen says **Automatic follow-ups stopped · still tracking #123**, retains Check now and retains Waiting for merge (`142-review-stopped-watching.png`, `187-review-stopped-stable.png`). A user can reasonably expect the button to stop tracking/polling, while the result explicitly says tracking continues. **Smallest change:** use **Stop automatic fixes** or the previous **Stop automatic follow-ups**, with the tooltip explaining that PR tracking continues. Do not add another permanent explanation before the action.

The project-first route is now explicit and works from the sign-in gate (`171-onboarding-signin-gate.png` → `172-onboarding-project-sheet.png` → `174-onboarding-project-added.png`). Ordinary settled threads have Settled/Reopen (`118-ordinary-settled.png`). Short Review · #123 and CI · step 2/4 sidebar labels are legible (`140-review-waiting-900.png`, `144-ci-build-900.png`). Empty search and picker states explain the result (`119-search-empty.png`, `84-picker-empty.png`).

## Feedback & state — 9

1. **A blocked send explains the tool failure without offering its recovery action.** `91-steering-current.png` preserves the attempted first send: “Audit missing tool is not ready. A repair thread was started.” The prompt and Send remain available, but the notice provides no route to that thread. The tool detail does offer Open repair thread (`92-tool-failed.png`). **Smallest change:** reuse that Open repair thread action in the composer error. The failure is acknowledged clearly; this is a recovery-location issue rather than silent data loss.

High survives draft → first send → reload (`90-effort-high-draft.png`, `95-effort-first-send.png`, `96-effort-reload.png`). A separate Sonnet/High draft retains both selections after send and reload (`178-sonnet-high-draft.png`, `179-sonnet-first-send.png`, `180-sonnet-reload.png`). A stable keyboard End/Enter selection persists as Max after immediate reload (`182-effort-current-menu.png`, `183-effort-end-reload.png`, `effort-second-keyboard.json`). These observations establish UI preference persistence, not effort executed by a real provider.

Working remains at the active transcript end after steering (`97-steered-working.png`). Queue says after this turn, then paused after Stop; the editor closes (`98-queue-tray.png`–`100-stopped-queue.png`). Resume uses a muted Stopped. Resumed caption and normal tool disclosure (`101-resumed.png`). Snooze names tomorrow (`116-snooze-ack.png`, `117-snoozed-pane.png`). CI was observed at Build image step 2/4, Push image step 3/4, and Shipped (`143-ci-build-1280.png`, `147-ci-push.png`, `148-ci-complete.png`).

## Efficiency & flow — 8

1. **Routine profile changes still require unnecessary scrolling.** `40-profile-900.png` is the same density issue described above. **Smallest change:** compact the two low-information cards before Skills.
2. **Tool recovery requires leaving the failed send and finding Settings / Tools.** `91-steering-current.png` and `92-tool-failed.png` expose the disconnected notice/action. **Smallest change:** link to the existing repair thread in the composer notice.
3. **Limits still sits outside Settings navigation.** All Settings sections are visible in `34-settings-projects.png`; Limits is absent. It remains a separate footer/composer destination (`81-limits.png`, `188-limits-900.png`). **Smallest change:** add a Settings navigation entry that opens the existing Limits view, preserving its shortcuts and return behavior.

Ctrl+N, Ctrl+K, Escape search clearing, search results, project filters and filter clearing were driven. Row context menus open with Shift+F10; row/header/filter menus support arrows, Home/End and Escape. Escape restores their trigger (`row-menu-keyboard.json`, `header-menu-keyboard.json`, `filter-keyboard.json`; `114-row-keyboard-menu.png`, `121-filter-menu.png`). Effort navigation also works (`effort-keyboard.json`). Header rename edits in place (`112-header-inline-rename.png`). Limits has no irrelevant side-panel toggle and Close returns to the previous thread (`81-limits.png`, `82-limits-return.png`).

## Accessibility — 8

1. **The narrow overlay's keyboard boundary still leaks to the sidebar resizer.** Stable Tab navigation reaches Refresh skills, Add skill, the skill row, Loaded, Inherited and the panel toggle, then leaves the panel and eventually focuses **Resize sidebar**, under the dimmed portion of the window (`166-overlay-escaped-to-resizer.png`; `overlay-recheck-focus.json`). The sidebar's normal buttons are correctly inert, but its sibling resize separator is not. **Smallest change:** include that separator in the inert boundary and wrap Tab/Shift+Tab between the panel's first/last available controls and its close toggle. Keep Escape returning to Side panel.

This is narrower than the early loading observation: the initial pass briefly cycled without skill controls; the stable recheck proves those controls are reachable. I do **not** report them as inaccessible. `151-overlay-resize-focus.png` is also misleadingly named: it actually shows the repository skill's focus ring; use **166** for the resizer finding.

Complete saved titles are now visible on actual keyboard focus (`113-long-title-keyboard.png`), resolving the previous information-access defect; the row-height tradeoff is recorded under layout. Choice Pick controls are visible at rest and named (`11-choice-1280.png`), menus focus their items, the project dialog is named, and invalid fields receive inline errors/focus (`38-hub-validation.png`, `52-secret-validation.png`, `79-add-project-empty-validation.png`). No screen-reader session or exhaustive contrast/target audit was performed.

## Layout robustness — 8

1. **Full-title recovery now changes the list geometry considerably.** `113-long-title-keyboard.png` shows the focused title wrapping to about five lines, growing the row from its ordinary compact height to roughly 100 px and moving the following rows. Round 3 truncated after two lines; round 4 reveals the complete saved title, but at the cost of list stability while navigating. **Smallest change:** keep the row at at most two lines and put the complete title in a wrapping tooltip on both focus and hover. Include project/state in its secondary line if needed.
2. **The profile form still loses useful controls below the footer at short height.** `40-profile-900.png` shows the remaining density problem. **Smallest change:** the compact Saved secrets/name treatment above; do not reduce text size or remove sticky actions.

Media, Choice, Skills, long context, shipped, review and CI views were captured at 1280×900, 900×700 and 1600×1000. Profiles, Accounts, Projects and Skills settings also have narrow/wide captures. Limits has all three sizes. Full 401-line output is bounded inside the transcript (`163-tool-full-output-1280.png`, `164-tool-full-output-900.png`, `165-tool-full-output-1600.png`). No persistent whole-window horizontal overflow was observed. At 1280×500 the focused final settled row remains above the footer (`162-sidebar-short-focused.png`). The project dialog keeps Cancel/Save visible at 900×700 (`127-project-dialog-900.png`).

## Forms & dialogs — 9

1. **The remaining form polish issue is density, not broken submission.** The profile's first skill choice meets the sticky footer at 900×700 (`40-profile-900.png`). **Smallest change:** compact the name and Saved secrets areas as described above. Save/Cancel remain available, so this does not constitute an unreachable form.

The material validation changes work: Add project allows an empty submission and shows Choose a folder (`79-add-project-empty-validation.png`); invalid folder and duplicate folder have specific feedback (`80-add-project-invalid.png`, `175-onboarding-project-duplicate.png`). Secret/hub errors are local to fields (`52-secret-validation.png`, `38-hub-validation.png`). Add tool and Add MCP server stay enabled after invalid submission (`58-tool-empty-validation.png`, `59-tool-version-validation.png`, `62-mcp-validation.png`, `63-mcp-invalid-url.png`). Switching to Local command clears the old MCP URL validation without immediately condemning the untouched Command field (`64-mcp-transport-switch.png`).

Project Save persists a skill selection after reopening (`75-project-save-persisted.png`); a later save restores it. Project-dialog Escape with unsaved edits offers Discard/Keep editing (`124-project-discard-prompt.png`). Escape first cancels checkout removal (`125-checkout-remove-confirm.png`, `126-checkout-escape.png`). Profile Cancel discards a skill change (`42-profile-cancel.png`); an empty name gives validation (`43-profile-validation.png`). Named confirmations were inspected for profile, account, secret, tool, MCP, source, thread, checkout and hub (`45-profile-delete-confirm.png`, `48-account-delete.png`, `56-secret-delete.png`, `94-tool-delete.png`, `66-mcp-delete.png`, `70-skill-delete-confirm.png`, `154-thread-delete-confirm.png`, `125-checkout-remove-confirm.png`, `36-hub-remove-confirm.png`). Disposable profile/account/secret/tool/MCP records were actually deleted. Source/thread/checkout confirmations were cancelled. **Hub removal was cancelled, never confirmed.**

## Round-3 findings: fixed / not fixed

| Round-3 finding | Round-4 observation |
|---|---|
| Workspace retained adds a redundant delivery-footer line | **Fixed.** Fact moved off the permanent row; no duplicate Settled beside a delivery chip (`132-shipped-1280.png`). |
| Profile editor wastes height before Skills | **Partly fixed, still present.** Heading is visible sooner, but the actual choices are still cut/below the footer at 900×700 (`40-profile-900.png`). |
| Sidebar review/CI state compressed into fragments | **Fixed for status.** Review · #123 and CI · step 2/4 are fully readable (`140-review-waiting-900.png`, `144-ci-build-900.png`). Project text is replaced by status; the full project remains in the native row title (`sidebar-semantics.json`). |
| Hub connection state visually differs from account/MCP pills | **Fixed.** Connected uses a quiet pill (`35-settings-hubs.png`). |
| Sign-in gate conceals project-first route | **Fixed.** Visible link opens the actual sheet and adding succeeds (`171-onboarding-signin-gate.png`–`174-onboarding-project-added.png`). |
| Two-line title still conceals full saved title from keyboard users | **Information access fixed, with a layout regression.** All saved text is shown, but the row expands to roughly five lines (`113-long-title-keyboard.png`). |
| Snooze acknowledgement omits the day | **Fixed.** Tomorrow appears in acknowledgement and persistent thread state (`116-snooze-ack.png`, `117-snoozed-pane.png`). |
| Limits absent from Settings | **Not fixed.** Still a separate view (`34-settings-projects.png`, `81-limits.png`). |
| Narrow overlay leaves sidebar keyboard-interactive | **Partly fixed.** Sidebar controls are inert and dimmed; its separate resizer still receives Tab focus (`166-overlay-escaped-to-resizer.png`). |
| MCP transport switch carries invalid-submit state into new branch | **Fixed.** Local command starts clean after invalid remote URL (`63-mcp-invalid-url.png`, `64-mcp-transport-switch.png`). |
| Previously corrected effort persistence, Working after steering, stopped queue editor, Choice targets and staged project saves | **Retained in exercised flows.** See `95-effort-first-send.png`, `96-effort-reload.png`, `97-steered-working.png`, `100-stopped-queue.png`, `11-choice-1280.png`, `75-project-save-persisted.png`. |

**Regressions introduced by the round-3 changes:** complete title expansion now moves neighboring rows substantially, replacing the previous truncation problem (`113-long-title-keyboard.png`). The renamed Stop watching PR action creates a semantic mismatch with its still-tracking result (`139-review-waiting-1280.png`, `142-review-stopped-watching.png`). The remaining resizer leak is an incomplete focus-boundary fix, not evidence that normal sidebar buttons are still tabbable. The compact profile change is an improvement with an unmet density goal, not a regression.

## Coverage, unreachable paths, and evidence quality

- **Sidebar:** initial/home, all initial fixture rows, hover actions, right-click and Shift+F10 menus, header menu, arrows/Home/End/Escape, sidebar/header inline rename, complete keyboard title recovery, snooze acknowledgement/persistent state/Wake now, Settled/Reopen, delete-confirmation cancel, search/results/empty/Escape/Ctrl+K, Filter/apply/clear/project settings, New thread picker/search empty/Ctrl+N, Settings/Limits footer, delivery status rows, short-height shelf focus. Running rows stay in the main list; there is no separate Working shelf. Six-plus settled paging was not exercised.
- **Threads/composer:** Inline chat, Choice and Skills fixtures; successful/failed tool input/output, full 401-line result, image lightbox, tool-result and inline images, native video/audio playback, file-link click and missing-media state; Choice lightbox/pick; long context, stream update and explore tools; steering, queue/edit/remove, Stop/Resume; model/provider/Favourites, actual Sonnet selection and model/effort first-send/reload persistence, effort arrows/Home/End/Enter/Escape, Limits, ordinary settled/Reopen. Media time advanced with unpaused elements; audibility and native OS opening were not established. The fixture's missing image is intentional, not an app defect.
- **Delivery:** direct Ship, options, queued Ship without glow, completion, Reopen, settle again and Archive; Prepare for review, waiting state, Stop watching PR; CI Build image, details, Push image and completion. Harness and hosting reads are substituted at the fixture's existing dependency boundaries; Git repositories/publication are disposable and real. No live GitHub PR was created, and the assistant's fixture sentence is not proof of remote GitHub publication. Open app's actual preview launch, external merge and failed-CI remediation were not driven.
- **Skills panel:** open/close, narrow scrim/Escape and focus cycle, Skills/MCP tabs, repository instruction expansion/edit form/cancel/reference insertion, loaded marker, inherited expansion, Add skill picker, enabling lib-review and disabling it again (`184-skill-enabled.png`–`186-skill-disabled.png`). Repository instruction saving and source revision operations were not executed.
- **Settings:** every actual section—Accounts, Secrets, Profiles, Harnesses, System prompt, Machines, Tools, MCP servers, Skills, Projects, Hubs. Add/edit/cancel/delete forms were inspected where available; disposable definitions were saved/deleted as described above. Machine rename was edited/cancelled. Signed-in account detail and a new signed-out ChatGPT account were inspected; no real OAuth was initiated. Secret add/edit/replace/cancel/delete, genuine missing-package tool installation/failure/details/delete, MCP remote URL validation/transport switch/local save/delete, skill source details/scope/copy forms/add validation/delete confirmation, project detail save/reopen, project dialog discard/checkout confirmation, Add project validation, hub add validation/removal cancel were driven. Harnesses and System prompt are informational pages. No real hub was removed or paired.
- **Fresh onboarding:** runner **passed** at `out/verify/2026-11-04T11-38-57-487Z-2eb4cdd2`. Screenshots `167-onboarding-hub.png`–`177-onboarding-signin-1600.png` cover hub, profile, missing-name validation, provider choice, sign-in gate, the new project-first link, inspected project, successful add, duplicate validation and narrow/wide gate. The runner cleaned its own child server/home. Authenticated inline onboarding completion remains unreachable without real provider approval; the project-first route does not bypass that account prerequisite.
- **Other unavailable/unverified branches:** live Claude/Codex inference and actual executed effort, authenticated MCP/OAuth/service behavior, successful tool install/repair completion, skill clone/update/apply/rollback/copy execution, multiple hub/machine switching or pairing, native Electron Browse/OS opening, screen-reader output, exhaustive contrast and timing/race coverage. These require external prerequisites or broader scenarios; no scores are based on pretending they passed.
- **Evidence caveats:** screenshot numbers follow visit order, including fresh onboarding between the two populated-app passes. Every numbered screenshot has an ARIA snapshot. `25-settings-profiles.png` actually shows Accounts, the default Settings landing section. `91-steering-current.png` is an intentional blocked-send state during the failing-tool test, not a steering-harness failure; deleting the disposable tool allowed the same prompt to run. Stale exact selectors for field names that gained inline-error descriptions, a wrong copy-form Cancel assumption, and a guessed skill-row label caused driver timeouts; their resulting UI was inspected and corrected, rather than scored as product failures. The stable overlay findings supersede the loading-state focus cycle. Contact sheets supplement, but do not replace, original PNG inspection.
- **Cleanup:** the owned Playwright browser was closed. Only listener **PID 15452** on **47653** was stopped after checking its command line contained `chat-test-server`; `cleanup.json` records **zero remaining listeners**. No other Node processes were stopped. No application source or other auditor's files were edited. The launchers create their own standard fixture/runner artifacts as prescribed by the README.

## Top 5 changes

1. **Complete overlay focus containment.** Make the sidebar resizer inert and wrap Tab/Shift+Tab within the panel/toggle (`166-overlay-escaped-to-resizer.png`).
2. **Finish compacting the profile editor.** Replace the Saved secrets card with a compact link row and reduce name-card padding, bringing actual skill choices above the 700 px footer (`40-profile-900.png`).
3. **Reveal full titles without moving the list.** Keep rows at two lines and show a wrapping full-title tooltip on focus and hover (`113-long-title-keyboard.png`).
4. **Name the PR action for what it stops.** Use Stop automatic fixes/follow-ups while tracking continues (`139-review-waiting-1280.png`, `142-review-stopped-watching.png`).
5. **Connect the blocked-send notice to recovery.** Add the existing Open repair thread action beside the tool-not-ready error (`91-steering-current.png`, `92-tool-failed.png`).
