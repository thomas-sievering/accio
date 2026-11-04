# Accio UI/UX audit — round-1 — gpt-sol

Audited the built web UI in Chromium on Windows, 4 November 2026. This is an independent review of observed behavior, with no application-source edits. Scores describe the current UI, not the intended implementation. A 9 would mean only nitpicks remain; this round does not meet that bar.

| Category | Score | One-line verdict |
|---|---:|---|
| Minimalism / calmness | 8 | Quiet shell; raw diagnostics and repeated delivery details break the calm. |
| Visual hierarchy & typography | 7 | Good primary text; secondary text is too small and faint. |
| Consistency | 7 | Coherent styling, inconsistent save and dismissal semantics. |
| Clarity & discoverability | 6 | Core flow is approachable; effort, disabled delivery, and resource setup need explanation. |
| Feedback & state | 7 | Shipping and queue states work; technical errors obscure recovery. |
| Efficiency & flow | 7 | Fast thread creation and steering; resource navigation and hidden controls add friction. |
| Accessibility | 6 | Useful accessible names and focus rings; helper contrast and unnamed sheets need work. |
| Layout robustness | 7 | Main layouts hold; three panes and tiny choice previews strain narrow windows. |
| Forms & dialogs | 6 | Validation is often specific; Cancel can retain changes and deletion rules vary. |

## Minimalism / calmness — 8

1. **Raw turn-resource JSON intrudes into the transcript.** `03-tools-expanded.png` and `79-interrupted.png` expose internal skill IDs, full revision hashes, and MCP arrays. In the interrupted state the diagnostic is incorporated into the stopped notice. Smallest fix: render a collapsed “Resources used” disclosure containing human-readable names; keep hashes in its detail view. Keep “Stopped” and Resume on a separate concise line.
2. **Delivery repeats the same result in several places.** `91-shipped-complete.png` shows the publication reply, an ISO-timestamp receipt, a status pill, and a workspace-retention line, with the sidebar also showing main. Smallest fix: retain the status pill and one workspace line; put revision and human-formatted time in a receipt disclosure.
3. **An unavailable footer feature still occupies a control slot.** `01-initial.png` includes the disabled “Owl, coming soon” icon beside Settings and Limits. Smallest fix: remove it until usable, or move the announcement into Settings.

## Visual hierarchy & typography — 7

1. **Helper text carries essential meaning at an unnecessarily weak visual level.** `122-profile-form-stable.png` explains immediate skill saving in faint 12 px text; the same treatment is used for account guidance and folder ownership. Read-only computed styles in typography.json show rgb(105,106,112), approximately #696a70, for these hints. Smallest fix: raise meaningful helper text to 13 px and a muted color meeting 4.5:1 against its actual card background; preserve a weaker token only for nonessential decoration.
2. **Settings headings and their large containing cards waste vertical measure.** `122-profile-form-stable.png` fits only through the skills card at 900 px height; the form actions are below it. `134-profile-form-900.png` makes the cost more obvious. Smallest fix: reduce the 30-plus-pixel gaps between sections to 20–24 px and keep the form action row sticky within the settings pane.
3. **Media actions are visually disconnected from their item.** `03-tools-expanded.png` puts each small image at the left of the message measure and Open/Download at its far right. Smallest fix: place the filename, size and actions in one caption row immediately under the image, with an 8–12 px gap between actions.

## Consistency — 7

1. **One profile form mixes explicit and immediate saving.** `122-profile-form-stable.png` versus `123-profile-cancel-keeps-skill.png`: I checked lib-review, pressed Cancel, reopened Personal, and the checkbox remained checked. Smallest fix: stage skill selection with the rest of this form and commit it on Save. The warning text does not make Cancel mean what users expect.
2. **Destructive confirmation patterns differ across entities.** `124-profile-delete-before.png` → `125-profile-delete-after.png` demonstrates immediate deletion of an unused profile. Tools use Keep plus “Delete … from the hub” (`118-tool-delete-confirm.png`); secrets use Cancel plus Delete secret (`115-secret-delete-confirm.png`); threads replace their menu item with Delete for good (`10-delete-thread-confirm.png`). Smallest fix: standardize one inline confirmation row with Cancel and “Delete [name]” for saved entities, retaining the stronger consequence text where needed.
3. **The same model changes its visible name across picker groups.** The provider group uses “Claude Sonnet” in `101-model-picker-loaded.png`, while Favourites uses “Sonnet” in `102-model-favourites.png`. Smallest fix: use the same short display name in both lists, with provider/harness as secondary context if needed.

## Clarity & discoverability — 6

1. **Effort looks like a suffix rather than a control.** `132-effort-low.png` and `133-effort-keyboard.png` document successful wheel and ArrowUp changes, but the trigger visually combines model selection and effort. Its tooltip mentions scrolling; ordinary click opens the model list. Smallest fix: make the effort word a separate button with a small chevron and an accessible “Effort: …” name, opening the supported choices. Keep wheel and arrows as shortcuts.
2. **Disabled Ship has no persistent explanation.** `25-skills-900.png` shows Ship and its options disabled for the Skills fixture even though the thread looks ready. A user cannot infer whether the cause is repository state, remote configuration or model state. Smallest fix: give the disabled control a focusable explanation trigger or display “Add a Git remote to ship” when that is the actual blocker; avoid a generic disabled button.
3. **The secrets form asks users to invent a protocol-like purpose.** `41-secret-add.png` requires “Used for” with an example such as cloudflare.pages.deploy:docs. It is described, but remains difficult to derive without the requesting thread. Smallest fix: label it “Purpose key” and explicitly say “Use the purpose shown by the requesting thread”; offer recent request keys if available.
4. **First-run account gating leaves no obvious way to explore without signing in.** `59-onboarding-signin-gate.png` gives only the provider sign-in action in the main pane even though Settings and Add project are reachable in the shell. Smallest fix: add a secondary “Set up projects first” action opening the existing Add project sheet. Do not imply that adding a project completes authentication.

## Feedback & state — 7

1. **Install failure reports a filesystem symptom rather than the failed user task.** `117-tool-install-result.png` shows ENOENT and a long temporary node_modules path after saving @playwright/cli version 0.0.0. This proves an installation failure, not that npm returned a particular package error. Smallest fix: lead with “Couldn’t install @playwright/cli 0.0.0. Check the package and version, then retry”; put the exact error behind Details. Keep the existing Needs attention and repair link.
2. **The running indicator says Thinking while the assistant says it is running checks.** `87-delivery-working.png` juxtaposes “Thinking” with “Feature implemented. Running checks…”. The fake harness supplies the work text, so this is a generic state-label mismatch, not evidence of real checking. Smallest fix: use “Working” for the generic active indicator and reserve “Thinking” for a known reasoning phase.
3. **Initial popup positioning flashes away from its trigger.** `88-shipping-options.png` captures the shipping menu at (0,0); after allowing 600 ms it is correctly attached above Ship in `127-shipping-menu-stable.png`. Smallest fix: hide the popover until its first anchor measurement is available. This is a transient captured state, not persistent misplacement.

Positive evidence: queued messages expose Edit/Remove/Steer now (`76-queue.png`); stopping exposes Resume (`79-interrupted.png`); review reaches Waiting for merge (`97-review-prepared.png`); CI exposes its current image-build step (`99-ci-checks.png`); publication settles the thread and offers Reopen/Archive (`91-shipped-complete.png`).

## Efficiency & flow — 7

1. **Settings forces repeated scrolling to reach completion controls.** `134-profile-form-900.png` and `135-profile-actions-900.png` show the top and bottom of one profile form at 900×700. Smallest fix: keep Cancel/Save in a sticky bottom action bar while the form body scrolls.
2. **Limits and project administration are disconnected from the Settings navigation.** `71-limits.png` is a separate main view, while project settings are behind the thread filter (`11-filters.png`, `12-project-settings.png`). Smallest fix: add Projects and Limits navigation entries that reuse these existing views; preserve the fast toolbar shortcuts.
3. **Narrow Choice previews require an extra inspection step for every option.** `18-choice-900.png` renders all three desktop screenshots as tiny tiles. The lightbox works (`20-choice-lightbox.png`) but makes comparisons serial. Smallest fix: switch to one or two columns below a content-width breakpoint and retain labels/pick controls beneath each preview.

Positive evidence: keyboard Enter selected No project in the picker; Escape cleared thread search; queue editing and steering worked; favourites saved; wheel and arrow keys changed effort; rename, snooze, wake, settle and archive were exercised through UI controls.

## Accessibility — 6

1. **Necessary helper copy has insufficient contrast.** `122-profile-form-stable.png` and `41-secret-add.png` show faint instructions against dark cards. Computed styles confirm 12 px rgb(105,106,112) hints; this is approximately 3.2:1 against the roughly #1c1d20 card, below 4.5:1 for ordinary text. Smallest fix: use at least #92939b on that background and remeasure all muted text, including composer placeholders and skill descriptions.
2. **Project sheets have no accessible dialog name.** `12-project-settings.png` and `14-add-project.png` have visible headings, but their ARIA snapshots expose only an unnamed dialog. Smallest fix: connect each dialog’s aria-labelledby to its heading. Scope observation correctly: the native dialog’s lack of a role attribute does not mean it lacks dialog semantics.
3. **Icon-only toolbar controls are small precision targets.** `01-initial.png` shows the clustered controls; controls.json measures Filter, Add project and New thread at 30×30 px. These exceed the 24 px minimum, so this is not a claimed WCAG minimum-target violation. Smallest fix: expand their hit regions to 36×36 px while keeping the same icon sizes and spacing rhythm.

Positive evidence: visible focus outlines exist (`119-dialog-keyboard.png`); inputs generally have labels; tool input/result regions are named; thread status has text alternatives; project-sheet Tab navigation cycled among its controls and the document boundary, and Escape dismissed it. No screen-reader session or full accessibility conformance claim is made.

## Layout robustness — 7

1. **Three panes leave the main task too little space at 900 px.** `25-skills-900.png` keeps a roughly 271 px sidebar and 319 px skills panel, leaving about 310 px for the thread. The project breadcrumb is already truncated, and composer controls dominate its width. Smallest fix: at widths below 1100 px make the side panel an overlay drawer, or automatically collapse the thread sidebar while the panel is open.
2. **Long titles are reduced to indistinguishable prefixes.** `105-long-title.png` and `106-snoozed.png` truncate the renamed thread to its beginning. A hover title is available, so information is recoverable; the issue is scanning. Smallest fix: allow two title lines for selected/hovered rows, or expose the full title in a focused row tooltip without requiring the mouse.
3. **Desktop Choice screenshots become unreadable thumbnails at 900 px.** `18-choice-900.png`; use the responsive-column change described above. This shares evidence with efficiency and is one defect, not two independent failures.

Observed strengths: 70-paragraph history remained contained at 900×700 and 1600×1000 (`84-long-context-900.png`, `85-long-context-1600.png`); transcript and composer stayed in their own regions. Settings, Choice, inline media, skills and shipped main views were captured at all three requested sizes. No persistent whole-window horizontal overflow was observed in those views.

## Forms & dialogs — 6

1. **Cancel does not undo all changes in the profile editor.** `123-profile-cancel-keeps-skill.png` proves persistence after Cancel and reopening. Smallest fix: include skills in the form draft, apply on Save, and discard on Cancel. This is the highest-impact form defect.
2. **Saved-profile deletion has no confirmation or undo.** `124-profile-delete-before.png` → `125-profile-delete-after.png` removed the disposable profile immediately. Smallest fix: reuse the existing named inline confirmation pattern, or provide an Undo action after successful deletion.
3. **Long forms hide their destructive and completion actions below the viewport.** `134-profile-form-900.png` and `117-tool-install-result.png` require scrolling to see some actions or the failure detail. Smallest fix: use one sticky action row and place installation status above it rather than below the save controls.

Positive evidence: invalid folder, invalid URL and unpinned tool version produced local messages (`15-add-project-invalid.png`, `53-mcp-invalid-url.png`, `49-tool-version-validation.png`). MCP transport choices, secret access controls, and named destructive confirmations were reachable. The Add project sheet closed with Cancel and Escape. No assertion is made that every settings page supports outside-click dismissal; settings editors are full pages rather than modal dialogs.

## Coverage and limits

Evidence lives in out/ui-audit/round-1/gpt-sol/. There are 135 numbered PNG screenshots, plus ARIA snapshots for populated-app checkpoints, read-only control/typography measurements, screenshot-manifest.json, and scripts. The final screenshot sequence is ordered by capture time; the manifest maps original working names to final names. Early captures sometimes record a transition/loading frame; later *-loaded and *-stable captures distinguish final layout from transient behavior.

- **Populated server:** port 47613, started in the background and readiness confirmed from “Chat fixture ready”. Existing Inline, Choice and Skills fixtures opened; image lightbox, video/audio controls, file-link action, missing-media status, collapsed/expanded failed tools, model picker/favourites, effort wheel/arrows, Limits, long context, streaming and tool-exploration prompts exercised. Queue created with Ctrl+Enter, edited/cancelled, sent as steering; Stop and Resume exercised. Sidebar search/empty results, filter, picker/empty search, right-click menu, rename, snooze/wake, settle, deletion confirmation, and footer views inspected.
- **Delivery:** Build delivery fixture → Ship → completion → Reopen → Archive; Build review fixture → Prepare for review → Waiting for merge; Build CI progress fixture → Ship → image Build image step and subsequent check observation. These use a fake coding harness and fixture hosting reads with disposable real Git repositories. No real GitHub publication or provider execution is established. The PR URL is fixture output, not a PR created in the user's project.
- **Settings:** every actual sidebar section visited: Accounts, Secrets, Profiles, Harnesses, System prompt, Machines, Tools, MCP servers, Skills, Hubs. Limits is reached from the shell; Projects from Filter → project settings. Profiles/account add/edit/delete; secret add/edit/replace/cancel/delete; tool add/validation/install-failure/edit/delete confirmation; MCP remote/stdio forms, URL validation, save/auth change/delete; skill-source add/cancel/detail/scope/copy/delete confirmation; machine detail and hub connection forms inspected. Some forms were inspected without completing their external side effects, as listed below.
- **First run:** used a copy of the 3-verify runner with only its root/output-directory resolution changed, so every generated file stayed under the permitted audit tree. Production startup, doctor and teardown were retained. Successful evidence: verify/2026-11-03T23-32-56-484Z-1645202d, result PASSED and cleanup confirms teardown. Captured hub, profile, provider, sign-in gate and toolbar project sheet/inspection/add. Two preceding failed journeys are retained: one selector encoding error and one stale dropdown selector; these are audit-script failures, not product failures.
- **Unreachable or not fully proven:** authenticated first-run inline project step and OAuth completion require real provider approval; no credentials were supplied or copied. The onboarding toolbar project addition does not cover that gated inline step. Multi-machine/hub pairing, active-hub removal, OAuth MCP consent and actual remote MCP execution require another endpoint/device; only their available forms were inspected. Native Electron Browse/OS open behavior is unavailable in web mode. File-link click produced no browser preview or new tab, so OS file opening is unverified. Video/audio controls rendered with durations, but audible output/playback completion was not tested. Skill-source cloning/update/apply/rollback and project-copy execution were not completed; their forms were inspected. Machine rename/folder save and successful managed-tool install were not completed; install failure and deletion were. Tool exploration was invoked and its activity captured, not every generated tool payload expanded. External PR merge/failing-CI follow-ups, six-plus settled-thread paging and all cancellation races were not covered. No claim of exhaustive state-space coverage is made.
- **Cleanup:** browser closed. The only populated-server listener stopped was PID 10524 on port 47613, after checking its command line contained chat-test-server. The verify runner stopped its own production-server child. No other Node processes were stopped.

## Top 5 changes

1. **Make profile Cancel reliable:** stage skill selections with name/account edits and save them together. Evidence: `123-profile-cancel-keeps-skill.png`. Improves forms, consistency and trust.
2. **Raise meaningful muted-text contrast and size:** 13 px helper copy with measured 4.5:1 contrast, starting with profile skills and secret-purpose guidance. Evidence: `122-profile-form-stable.png`, `41-secret-add.png`. Improves accessibility, hierarchy and clarity.
3. **Make effort an explicit accessible control:** separate effort button/menu beside the model, retaining wheel/arrows as shortcuts. Evidence: `132-effort-low.png`, `133-effort-keyboard.png`. Improves discovery and efficient model configuration.
4. **Collapse a side pane at narrow widths:** use an overlay skills drawer below 1100 px, preserving transcript/composer space. Evidence: `25-skills-900.png`. Improves layout and the primary coding flow.
5. **Replace raw diagnostics with concise task feedback:** a human-readable Resources disclosure, a clean Stopped notice, and an installation summary with expandable details. Evidence: `03-tools-expanded.png`, `79-interrupted.png`, `117-tool-install-result.png`. Improves feedback, calmness and recovery.
