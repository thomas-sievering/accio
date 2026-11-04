# Accio UI/UX audit — round 3 — gpt-sol

Audited the current, already-built UI on Windows in Chromium on 4 November 2026. The populated instance used port **47633**, a disposable home, and the deterministic chat harness. No rebuild or application-source change was made. This report judges observed screens and interactions, not the change plan. There are **178 numbered PNG screenshots** in `out/ui-audit/round-3/gpt-sol/`.

| Category | Score | One-line verdict |
|---|---:|---|
| Minimalism / calmness | 9 | Delivery and media are substantially calmer; only small redundancies remain. |
| Visual hierarchy & typography | 8 | Transcript and captions read well; the profile editor still wastes scarce vertical space. |
| Consistency | 9 | Shared actions, project settings, model names, and deletion language are coherent. |
| Clarity & discoverability | 8 | Settled actions and Projects are clear; onboarding still conceals the project-first route. |
| Feedback & state | 9 | Effort persists, steering retains Working, and delivery progress is explicit. |
| Efficiency & flow | 8 | Preferences now stick; long forms and separate Limits navigation still add work. |
| Accessibility | 8 | The hidden-focus drawer defect is fixed; complete title recovery by keyboard remains incomplete. |
| Layout robustness | 8 | Main panes hold at all three sizes; sidebar identity and state still compete for too little room. |
| Forms & dialogs | 9 | Staged project saves, validation, Escape, and named confirmations behave predictably. |

Screenshot references below are filenames within that evidence directory. Repeated references across categories describe the same underlying issue, not additional independent defects. A 9 means only small polish issues were found in the exercised scope; it is not a claim about untested external services.

## Minimalism / calmness — 9

1. **The completed delivery footer can lose one more line.** `107-shipped-900.png` shows a compact Shipped chip, Settled, Reopen, Archive, Open app, then a separate “Workspace retained” line. This is much better than round 2, and the assistant publication sentence is fixture output, not a second app receipt. The remaining workspace line is minor visual overhead. **Smallest change:** put the workspace fact in Archive's explanatory tooltip or the delivery chip's details, rather than reserving a separate line.

The centered duplicate receipt is gone (`106-shipped-1280.png`). Media actions sit immediately after their filename and size (`144-media-playing.png`). Provider glyphs in the composer are muted, new-thread project paths appear only on the highlighted option (`79-new-thread-picker.png`), and stopped work uses the concise notice (`91-stopped-queue.png`). No raw resource JSON was exposed in the ordinary transcript; explicit tool input/output remains available on expansion.

## Visual hierarchy & typography — 8

1. **The compact profile editor still hides the Skills section below the fold.** At 900×700, `46-profile-900.png` reaches only Secrets before the sticky footer. A name-only card, a separate secrets navigation card, and large section gaps consume most of the available height. Saving is accessible, but scanning and changing the profile's useful settings still requires unnecessary scrolling. **Smallest change:** tighten the name card and section gaps to approximately 20–24 px; render Saved secrets as a compact link row. Keep the sticky footer.
2. **Sidebar status text is too compressed to support scanning.** `120-review-stable-900.png` and `135-ci-build-stable.png` show readable project prefixes but heavily shortened review/CI state. The complete state is clear in the thread pane, yet the sidebar no longer communicates it at a glance. **Smallest change:** use a short sidebar label such as “Review” or “CI”, keeping the step/PR detail in the thread pane and full accessible description.

Media captions/actions now measure **12 px**, with Open measuring **24 px high**. Their association with the relevant item is fixed (`144-media-playing.png`). Long text retains a readable measure at 1600×1000 (`96-long-context-1600.png`); expanded tool cards share a stable wide column (`154-tool-read-top.png`, `157-tool-all-lines-1600.png`).

## Consistency — 9

1. **Connection status still has a minor visual exception.** `41-settings-hubs.png` uses a dot and Connected text, whereas account and MCP states use quiet pills (`31-settings-accounts.png`, `38-settings-mcp-servers.png`). **Smallest change:** use the same quiet status treatment for hub connection state. This is polish, not a functional inconsistency.

Project settings now have staged Cancel/Save actions and an app-styled shipping menu (`76-project-settings-from-list.png`, `77-project-ship-select.png`). The skills source footer says Done (`71-skill-source.png`). Thread deletion uses Delete thread in both stages (`123-row-context-menu.png`, `134-thread-delete-confirm.png`). Model names match between the provider and Favourites views (`82-model-picker.png`, `83-model-favourites.png`), and effort uses capitalized Auto with a checked menu item (`84-effort-menu.png`).

## Clarity & discoverability — 8

1. **Onboarding still leaves the project-first route unexplained.** `172-onboarding-signin-gate-stable.png` offers Sign in with ChatGPT and Back in the main pane; the working Add project route remains an unexplained sidebar icon. The route is real: `170-onboarding-project-sheet.png` and `171-onboarding-project-added.png` prove adding the disposable project, including the new success acknowledgement. **Smallest change:** add a quiet “Set up a project first” link to the existing sheet below the sign-in action.
2. **Two-line title expansion does not reveal the full title.** In `177-title-tab-stable.png`, a keyboard-focused thread expands to “Investigate the streaming / queue and delivery state…” while most of its saved title stays hidden. Waiting 900 ms did not reveal an on-screen full-title tooltip. **Smallest change:** show a wrapping tooltip containing the complete title on keyboard focus as well as hover. Preserve the accessible full name.

Ordinary No project threads now explicitly show Settled and Reopen (`97-ordinary-settled.png`). Thread actions now names Copy as Markdown and exposes the actual management actions (`25-thread-actions.png`). Projects has a clear Settings entry and list (`40-settings-projects.png`, `148-projects-900.png`). Empty picker/search states and shipping mode selection are understandable (`80-picker-empty.png`, `131-search-empty.png`, `104-shipping-review-selected.png`).

## Feedback & state — 9

1. **The snooze acknowledgement could specify the day.** `126-snooze-acknowledged.png` says “Snoozed until 09:00” with Undo, without a date or “tomorrow”. The menu supplies some context, so this is a small ambiguity. **Smallest change:** include “tomorrow” when the wake time falls on the next day.

The material round-2 persistence defect is **fixed in these observations**: High survives draft → first send → reload (`85-effort-high-draft.png`, `86-effort-first-send.png`, `87-effort-reload.png`); ArrowUp on the existing stopped thread followed immediately by reload retains Extra high (`92-effort-arrow-reload.png`). This proves UI preference persistence, not the effort actually executed by a real provider.

Working remains visible at the end of an active turn after steering (`88-steered.png`). The queue displays “after this turn”, switches to paused after Stop, and closes its editor (`89-queued.png`, `90-queue-edit.png`, `91-stopped-queue.png`). Review reaches Waiting for merge and explains stopped follow-ups (`116-review-stable.png`, `122-review-followups-stopped.png`). CI exposes Build image step 2 of 4, Push image step 3 of 4, and completion (`135-ci-build-stable.png`, `136-ci-push-stable.png`, `137-ci-second-complete.png`). Tool installation displays Installing, then a useful Needs attention sentence with optional raw details (`138-tool-saved-installing.png`, `139-tool-install-result.png`, `140-tool-error-details.png`).

## Efficiency & flow — 8

1. **Routine profile changes still traverse oversized sections.** `46-profile-900.png` shows the same scrolling cost described under hierarchy. **Smallest change:** compact the cards/gaps, rather than adding another navigation layer.
2. **Limits remains outside Settings navigation.** The full Settings sidebar has Projects but no Limits entry (`40-settings-projects.png`); Limits is a separate footer/composer destination (`78-limits.png`). The shortcut is efficient once learned, but moving between account configuration and usage monitoring requires leaving the settings context. **Smallest change:** add a Settings navigation link to the existing Limits view, preserving the shortcuts.
3. **Title recovery still requires opening a thread or another action.** `177-title-tab-stable.png` cannot distinguish titles that share a long prefix. **Smallest change:** the focus-triggered full-title tooltip described above.

Ctrl+N opens the picker, Ctrl+K focuses search (`79-new-thread-picker.png`, `132-search-shortcut.png`), Escape clears search, effort choices persist, and model Favourites work. Inline rename occurs inside the row (`124-inline-rename.png`). Add project focuses Folder immediately (`28-add-project-focus.png`). The Limits view correctly omits its profile switch with only one profile (`78-limits.png`). Ship, reopen, settle again, and Archive were driven (`105-ship-requested.png`, `109-shipped-reopened.png`, `110-archived.png`).

## Accessibility — 8

1. **Sighted keyboard users still cannot recover a complete long title from row focus.** `177-title-tab-stable.png` has a clear visible focus ring and two-line expansion, but truncates the distinguishing text. The full accessible name and native title attribute are present (`keyboard-stable.json`); they do not produce a visible tooltip in the tested keyboard interaction. **Smallest change:** add a full wrapping tooltip on focus. This is a visual keyboard-information issue, not a claim that screen readers lack the name.
2. **The narrow overlay's focus boundary is only partial.** `23-skills-overlay-tab.png` shows focus reaching the uncovered sidebar while the panel is still open. The transcript is correctly inert, and that sidebar focus is visible, so the previous invisible Limits focus is no longer reproducible. Nevertheless, the scrimmed overlay does not contain keyboard navigation within its own controls. **Smallest change:** either include the sidebar in the overlay's inert boundary and contain Tab until dismissal, or make the intentionally usable sidebar part of a clearly nonmodal panel interaction. This is lower impact than the first finding; no hidden-focus failure is claimed here.

The major fix is real: opening the overlay moves focus to the Skills tab, the main pane is inert (`158-overlay-initial-focus.png`), scrim click dismisses it (`159-overlay-scrim-dismissed.png`), and Escape closes it and returns focus to Side panel (`20-panel-overlay-900.png`, `21-panel-escape.png`). Choice pick targets measure **28×28 px**, and actual Tab navigation reveals the button and its focus ring (`143-choice-targets.png`, `176-choice-tab-stable.png`). Toolbar buttons are named; the project dialogs are named; sticky form actions remain reachable. No screen-reader session or full contrast/conformance audit was performed.

## Layout robustness — 8

1. **Sidebar identity and status still fight for the same narrow subtitle.** `120-review-stable-900.png`, `125-long-title-keyboard.png`, and `135-ci-build-stable.png` show project names shortened near their ends and state text reduced to fragments. This is improved from round 2's “revi…”, but still weak for monitoring multiple project threads. **Smallest change:** reserve the project measure, shorten the visible status vocabulary, and show complete details on both hover and keyboard focus.
2. **The long-title fix runs out after two lines.** `177-title-tab-stable.png` still hides most of a 120-character title. **Smallest change:** use the full-title tooltip; do not expand the row to many lines.

Choice, media, long context, Skills, profile settings, account/project/skill lists, shipped, and review views were captured at **1280×900, 900×700, and 1600×1000**. No persistent whole-window horizontal overflow was observed. The narrow panel preserves the transcript's width, uses a scrim, and disables covered controls. Wide output is bounded inside the transcript (`155-tool-all-lines.png`, `156-tool-all-lines-900.png`, `157-tool-all-lines-1600.png`). At 1280×500 the sidebar scrolls, with a focused settled row still visible above the footer (`178-short-shelf-focus.png`); `162-sidebar-short.png` preserves the initially clipped shelf before that focus/scroll check. The profile footer stays available at 900×700.

## Forms & dialogs — 9

1. **Changing MCP transport retains the previous submit-validation state.** After submitting an invalid remote URL, selecting Local command immediately marks the untouched Command field invalid (`67-mcp-url-error.png` → `68-mcp-stdio.png`). The message is accurate for an eventual submission, so this is minor rather than a blocked flow. **Smallest change:** clear the transport-specific submitted/error state when changing transport; validate the new branch on its next submit.

Project settings **Cancel discards** a skill change; **Save persists** it after reopening (`142-project-save-persisted.png`). Profile Cancel also discards the skill change (`48-profile-cancel-discards.png`). Missing profile name, invalid folder, empty secret/hub submission, tool version, and MCP URL produce local errors (`49-profile-validation.png`, `29-add-project-invalid.png`, `59-secret-validation.png`, `44-hub-validation.png`, `65-tool-version-error.png`, `67-mcp-url-error.png`).

Named confirmations were exercised for profiles, accounts, secrets, tools, MCP, skill sources, threads, and checkout removal (`51-profile-delete-confirm.png`, `55-account-delete-confirm.png`, `63-secret-delete-confirm.png`, `141-tool-delete-confirm.png`, `70-mcp-delete-confirm.png`, `74-skill-source-delete.png`, `134-thread-delete-confirm.png`, `27-project-remove-confirm.png`). Disposable profile/account/secret/tool/MCP definitions were actually deleted. Checkout, skill source, and thread confirmations were cancelled. **Hub removal was inspected and cancelled, never confirmed** (`42-hub-remove-confirm.png`); Escape also cancels that confirmation before leaving Settings on a subsequent Escape (`163-hub-confirm-escape.png`, `164-settings-top-escape.png`). Local-command MCP deletion no longer claims a saved sign-in will be removed (`70-mcp-delete-confirm.png`).

## Round-2 findings: fixed / not fixed

| Round-2 finding | Round-3 observation |
|---|---|
| Repeated app delivery receipt/outcome | **Fixed materially.** No centered receipt; one persistent outcome chip. Workspace caption remains a nitpick (`106-shipped-1280.png`, `107-shipped-900.png`). |
| Media actions far from their item; 11 px captions | **Fixed.** Nearby filename/actions, measured 12 px text and 24 px-high Open (`144-media-playing.png`). |
| Profile form spends too much height before useful lower sections | **Not fixed.** Skills remains below the fold at 900×700 (`46-profile-900.png`). |
| Hub connection visual exception | **Not fixed; minor.** Dot/text still differs from other status treatments (`41-settings-hubs.png`). |
| Ordinary settled No project thread lacks Reopen | **Fixed.** Settled/Reopen is visible above its composer (`97-ordinary-settled.png`). |
| First-run sign-in gate hides project-first route | **Partly fixed.** Back and project-added acknowledgement are present; the alternative entry remains unexplained (`172-onboarding-signin-gate-stable.png`, `171-onboarding-project-added.png`). |
| Effort silently resets after first send/reload | **Fixed in both tested paths.** High survives first send/reload; immediate ArrowUp/reload retains Extra high (`85-effort-high-draft.png`, `86-effort-first-send.png`, `87-effort-reload.png`, `92-effort-arrow-reload.png`). |
| Projects and Limits absent from Settings | **Projects fixed; Limits not fixed.** Projects list exists; Limits remains a separate view (`40-settings-projects.png`, `78-limits.png`). |
| Narrow drawer hides focus behind itself; Escape fails | **Material defect fixed.** Focus enters the panel, main is inert, Escape/scrim dismiss and return focus. Sidebar remains tabbable, noted above (`158-overlay-initial-focus.png`, `21-panel-escape.png`, `23-skills-overlay-tab.png`, `159-overlay-scrim-dismissed.png`). |
| Choice buttons 22×22 px | **Fixed.** Measured 28×28 px and visible actual keyboard focus (`143-choice-targets.png`, `176-choice-tab-stable.png`). |
| Sidebar project labels collapse to a few characters | **Improved, not fully fixed.** Longer project prefix is protected, but identity/state remain shortened (`120-review-stable-900.png`, `135-ci-build-stable.png`). |
| Long title has no complete keyboard visual recovery | **Partly fixed.** Two-line expansion appears on keyboard focus; it still truncates the full title (`177-title-tab-stable.png`). |
| Add project starts focused on Close | **Fixed.** Folder receives focus (`28-add-project-focus.png`). |
| Previously fixed Save/Cancel, named deletion, short stopped notice, model names | **Retained in exercised flows.** See `48-profile-cancel-discards.png`, `51-profile-delete-confirm.png`, `91-stopped-queue.png`, `82-model-picker.png`, `83-model-favourites.png`. |

**Regression assessment:** no confirmed new material regression from the round-2 changes was established. The overlay's partial focus boundary and the two-line title limit are incomplete fixes, not a recurrence of the old hidden-focus failure. The MCP validation carryover was observed this round, but without prior-round evidence for that exact interaction I cannot attribute its introduction to these changes.

## Coverage, limitations, and evidence

- **Sidebar:** initial/home, rows and hover actions, context menus, inline rename, snooze acknowledgement, Snoozed shelf/wake, Settled shelf, settle/reopen, delete confirmation/cancel, search/results/empty/Escape, Ctrl+K, project filter/apply/clear/settings, new-thread picker/search-empty, Ctrl+N, footer Settings/Limits, and the short-height layout. There is no separate Working shelf in this build; running rows remain in the main list. Slash and a complete arrow-navigation matrix were not separately verified.
- **Transcript/composer:** all three initial fixtures; successful/failed tool expansions; full 401-line output; inline and tool-result images; image and Choice lightboxes; Choice pick; video/audio native controls; file links and missing media; model/provider/Favourites; effort menu, first-send persistence and immediate keyboard-change/reload; Limits; long context; streaming; tool exploration; steering; queue/edit/remove; Stop/Resume; ordinary settled Reopen. Playback observation showed both media elements unpaused with advancing time (`144-media-playing.png`); audio audibility was not assessed. Clicking a file link did not produce an in-app preview (`145-file-link-clicked.png`); native OS opening remains unverified.
- **Delivery:** Ship and Shipping options, changing modes without initiating delivery, shipped/reopened/archived state, Prepare for review/Waiting for merge/stopping follow-ups, CI build/push/completion. The first CI capture labeled `117-ci-build.png` had already advanced to Push image, and `118-ci-push.png` is actually completion; use the stable `135-ci-build-stable.png` and `136-ci-push-stable.png` for stage evidence. A second CI thread first produced no diff because the fixture writes the same file content; sending Build delivery fixture through its UI created a real disposable change while retaining that thread's CI fixture boundary. The deterministic publication sentence is not evidence of live GitHub publication. No real remote PR was created by this audit.
- **Settings:** every actual section: Accounts, Secrets, Profiles, Harnesses, System prompt, Machines, Tools, MCP servers, Skills, Projects, Hubs. Inspected add/edit/cancel/delete paths where available, signed-out account creation, machine rename/cancel, secret add/edit/replace/cancel/delete, invalid tool version and genuine missing-package installation failure/details/delete, MCP remote form/URL validation/stdio save/delete, source details/scope/copy/add/delete confirmation, project settings selection/cancel/save/reopen, Add project validation, checkout removal confirmation/cancel, hub add/empty validation and removal confirmation/cancel. Existing source scope/copy forms were inspected without applying a new source or copying files. System prompt and Harnesses are informational views, not writable forms. No native Browse picker is supplied by the web fixture.
- **Fresh first run:** final 3-verify runs passed at `out/verify/2026-11-04T09-17-21-312Z-72ceebb1` and `out/verify/2026-11-04T09-18-00-722Z-1fc638cb`. Screenshots `165-onboarding-hub.png` through `172-onboarding-signin-gate-stable.png` cover hub, profile, missing-name validation, provider choice, signed-out account, project sheet, project-added acknowledgement, and stable sign-in step, at 1280×900. Earlier runs and a failed stale account-button selector retain their own runner evidence; that selector failure is not assigned to the product. The runner separately cleaned its own instances.
- **Unreachable / unverified:** authenticated inline project-onboarding completion needs real provider approval; live Claude/Codex inference and provider effort execution need real accounts; MCP OAuth/service calls need a reachable authenticated service; successful managed-tool installation/repair, skill clone/update/apply/rollback/copy execution, multiple-machine/hub switching or pairing, external PR merge/review/failing-CI remediation, native Electron Browse/OS open, exhaustive races, and screen-reader output were not established. Hub removal was intentionally not executed. There were three settled fixture rows, so six-plus-row paging was not exercised.
- **Tooling and evidence quality:** shared preview reported `available:false`, so the requested Node/Playwright driver was used. Screenshots and ARIA snapshots were inspected; contact sheets supplement original PNGs. Some immediate captures intentionally preserve loading/transition states; findings cite stable evidence. Programmatic-focus exploratory shots are not used as proof of invisible keyboard focus: `176-choice-tab-stable.png` and `177-title-tab-stable.png` are the stable keyboard-modality checks, with read-only observations in `keyboard-stable.json`. Screenshot numbers follow capture order; first-run captures were normalized after the final reruns, with mapping retained in `screenshot-map.json`.
- **Cleanup:** all owned Playwright browsers were closed. Only listener **PID 31924** on **47633** was stopped, after its command line was verified to contain `chat-test-server`. `cleanup.json` records zero listeners afterward. No other Node processes were killed. No application files or other auditors' files were edited.

## Top 5 changes

1. **Reveal complete thread titles on keyboard focus and hover.** Add a wrapping full-title tooltip; two lines are not enough (`177-title-tab-stable.png`).
2. **Compact the profile editor.** Tighten the name card and section spacing and reduce Saved secrets to a link row so Skills is reached sooner at 900×700 (`46-profile-900.png`).
3. **Explain the project-first onboarding route.** Link directly to the existing Add project sheet from the sign-in gate (`172-onboarding-signin-gate-stable.png`).
4. **Use short sidebar status labels while protecting project identity.** Keep full CI steps and review details in the pane and accessible tooltip (`120-review-stable-900.png`, `135-ci-build-stable.png`).
5. **Complete the narrow panel's keyboard boundary.** Resolve whether the sidebar intentionally stays interactive; make the focus/inert model match that choice (`23-skills-overlay-tab.png`, `158-overlay-initial-focus.png`).
