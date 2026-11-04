# Accio UI audit — round 6 — gpt-sol

Independent audit of **037f47b01e5714fb0f968e58d88be7559e02019d**, on `ui_analysis`, 4 November 2026, Windows/Chromium. No app code, build, branch or commit was changed. I read the audit README, 3-verify skill and feature recipes, my round-5 report, round-5 plan and glossary. These scores judge the rendered UI and exercised behavior, not implementation claims or passing tests.

| Category | Score | Verdict |
|---|---:|---|
| Minimalism / calmness | 9 | Quiet transcript, resources and delivery surfaces; no material clutter defect observed. |
| Visual hierarchy & typography | 9 | Forms and transcript remain readable; technical clipboard failure text is a polish issue. |
| Consistency | 9 | Neutral scope status, primary queue Save and shared disclosures fit the surrounding UI. |
| Clarity & discoverability | 9 | Saved titles and effort are visibly explained on focus; secret access wording has a small ambiguity. |
| Feedback & state | 9 | Blocked sends preserve state, delivery and queue feedback work; repeated copy can retain stale success. |
| Efficiency & flow | 9 | Limits returns to its Settings origin; Enter saves Preview command; keyboard thread and queue flows work. |
| Accessibility | 9 | Focus title reveal and overlay wrap are corrected in the exercised keyboard paths. AT/live/native proof remains separate. |
| Layout robustness | 9 | Stable rows and effort width; required widths and 500 px height remain usable. |
| Forms & dialogs | 9 | Dirty Escape, Keep editing, Discard, clean focus return and inline validation behave correctly. |

**Verdict:** no material UI defect established in this audit's exercised scope; remaining findings are nitpicks. This is not a claim of exhaustive product verification. Available-but-untested branches and unavailable prerequisites are listed below. A 9 means only nitpicks in the observed UI, not that the audit loop must stop or that every platform is proven.

## Build, isolation and evidence

The populated fixture launched with **ACCIO_CHAT_TEST_PORT=47683** and **ACCIO_CHAT_TEST_WEB_ROOT=C:/Users/thoma/.t3/worktrees/accio/t3-4436a8c6/out/ui-audit/round-6/build**. It used disposable home `C:/Users/thoma/AppData/Local/Temp/accio-chat-browser-D3DHYp`, never a live user home or provider credentials. Provider execution and hosting reads are the fixture's fake production boundaries; disposable Git operations are real.

`build-check-start.json` matches all three SHA256 entries in `build-manifest.json`. `build-check-end.json` repeats disk hashes **and hashes the HTTP-served HTML, JavaScript and CSS**; all match the manifest, with HEAD still 037f47b. It records the served root, source commit, time and file modification times. No source/build change or mixed-build interval was observed. Fresh-home 3-verify uses `apps/web/dist`; `onboarding-web-build-hashes.json` records the same three web asset hashes, and both runner doctors accepted their production-build fingerprints.

Evidence: **193 numbered PNGs, each with a matching `.yml` ARIA snapshot**, under `out/ui-audit/round-6/gpt-sol/`; `evidence-index.json` lists them. Populated captures are 01–176; fresh-home captures are 301–311 and 341–346. The ranges identify separate journeys, not missing screenshots. Sizes exercised: **1280×900, 1600×1000, 900×700 and 1280×500**. Not every dialog was repeated at every size. Scripts, safe persisted observations, focus/geometry measurements and contact sheets are in that directory.

Host browser rules were followed: preview_status first, then an owned preview_open with reuseExistingTab=false. A snapshot initially succeeded, but subsequent two consecutive inspection attempts both failed with **“Preview automation snapshot timed out after 15000ms.”** I then used the permitted project Playwright fallback with an owned context. No rebuilding was used to troubleshoot. Both browsers were closed; `cleanup.json` records zero remaining listeners on 47683 after verifying and stopping only the owned `node --import tsx scripts/chat-test-server.ts` PID. Both fresh-home runners independently report server exit, closed port, scratch removal and retained evidence.

## Minimalism / calmness — 9

The skill row uses `lib-review / Library`, with revision and path disclosed only when expanded (`85-skill-library-expanded.png`). Scope text is neutral: `On only for the selected profiles and projects.` (`75-skill-scope-selected.png`), rather than an error-looking notice. Queue, progress and completed delivery remain subordinate to the transcript (`123-queued.png`, `117-ci-build.png`, `113-shipped.png`). There is no new material calmness issue or justified redesign.

Smallest related polish: clear the previous skill-copy success before another copy attempt, described under Feedback. This removes one unnecessary competing notice rather than adding explanatory prose.

## Visual hierarchy & typography — 9

The profile form at 900×700 shows its account controls, both skill choices and footer (`29-profile-compact.png`); the wide and 500 px variants retain clear grouping and scrollable content (`169-profile-wide.png`, `170-profile-short.png`). Tool input/result and failed-tool output are distinguishable (`06-failed-tool.png`, `145-full-tool-expanded.png`). The 401-line expansion remains bounded in the transcript at both narrow and wide sizes (`146-tool-401-900.png`, `147-tool-401-1600.png`).

**Nit:** a denied clipboard write exposes raw browser API wording: `Failed to execute 'writeText' on 'Clipboard': Write permission denied.` (`47-pairing-copy-redacted.png`, matching ARIA). This was an isolated browser permission condition, not evidence that copying generally fails. **Smallest fix:** show `Couldn’t copy. Select and copy the code manually, or allow clipboard access.` Keep the technical exception in diagnostics. With context clipboard permission granted, the same action says Copied and the clipboard matches the visible code (`153-pairing-copy-success-redacted.png`, `clipboard-result.json`). Codes are masked/redacted in both captures.

## Consistency — 9

The queue editor's Save is filled primary (`124-queue-edit-primary-save.png`), and tool readiness uses a full-width card with a chevron Details disclosure (`67-tool-failed-details.png`). Project settings use Settings breadcrumbs and staged actions (`48-project-detail.png`). Account/profile/tool/MCP/source deletion and checkout removal name their target and fit their local context (`41-account-delete.png`, `43-profile-delete.png`, `72-tool-delete.png`, `62-mcp-delete-consequence.png`, `80-source-delete.png`, `50-project-remove-confirm.png`).

The repair notice now has normal sentence/action spacing (`68-blocked-existing-send.png`, `71-blocked-fresh.png`). No separate material consistency finding remains. Smallest polish is to give the clipboard denial the same plain-language treatment as the other inline errors, rather than changing every confirmation to one layout.

## Clarity & discoverability — 9

**Round-5 title issue corrected:** Tab from Search enters the actual saved row and reveals its complete **saved** title in a visible wrapping tooltip (`13-saved-title-tab-tooltip.png`, repeated in `163-title-tab-final.png`). The title field saved its allowed-length value ending in `neigh`; the tooltip shows all of that value. I do not judge a longer string the field never saved. Escape dismisses the tooltip and keeps row focus (`164-title-escape-final.png`).

Effort now explains Auto with `Effort: Auto (the harness decides)` after focus and its normal delay; Escape dismisses it (`135-effort-focus-delayed.png`, `136-effort-dismiss-delayed.png`). High has its corresponding tooltip (`137-effort-high-delayed.png`). The caret sits beside the displayed word, not at the distant edge of its reserved width.

**Nit:** a saved secret with no selected projects says **No projects yet**, despite four projects existing in the app (`53-secret-saved.png`, `54-secret-edit.png`). Its detail form explains access, so this is a small list-label ambiguity. **Smallest fix:** say `No project access` or `No projects selected` for that metadata row. Reserve No projects yet for an actual empty project collection.

Onboarding's project-first route is explicit and acknowledges the added project (`305-onboarding-signin-gate.png`–`308-onboarding-project-added.png`). Repair uses the display name in both notice and thread title (`70-repair-thread-display-name.png`). No remaining material discovery failure was observed.

## Feedback & state — 9

**Blocked existing sends:** `68-blocked-existing-send.png` and `69-blocked-existing-repeat.png` retain `Blocked existing draft marker`, show a specific tool/repair notice, and keep Inline chat fixture Ready. `blocked-existing.json` records **1 user bubble before and 1 after**. The pre-existing failed *tool* remains a transcript fact; it is not a newly Failed thread. The repair action opens the named repair conversation (`70-repair-thread-display-name.png`).

**Blocked fresh send:** the pane remains a draft, the text remains, and the thread-row count is **4 before and 4 after** (`71-blocked-fresh.png`, `blocked-fresh.json`). `persisted-threads-after-block.json` contains the three original conversations plus the repair thread, with no blocked-marker conversation. This distinguishes the intended repair conversation from an orphan fresh-send conversation.

Steering, queue Save, Stop during an unsaved queue edit, Resume and eventual execution of the saved queue value are explicit (`121-steering-working.png`–`127-resumed-queue.png`; later transcript contains `Finished: Queued edited`, not Unsaved queue). Direct shipping passes through queued intent to Shipped (`112-ship-queued.png`–`114-shipped-900.png`). Review preparation shows Waiting for merge; stopping automatic fixes retains the PR identity and Check now (`108-review-waiting.png`–`111-review-still-tracking.png`). CI shows Build image, expanded details, Push image and Shipped (`117-ci-build.png`–`120-ci-shipped.png`).

**Nit:** after a successful Copy into project, repeating Copy leaves **Copied to … Commit it to share it** visible alongside **This project already has a skill with that name** (`77-skill-copied.png`, `78-skill-copy-refusal.png`). Nothing is overwritten, but success and failure coexist without a temporal distinction. **Smallest fix:** clear the prior success when a new attempt begins, or label it Previous copy. `copied-skill.txt` confirms the actual copied instructions.

Archive preserves the dirty workspace/file and explains refusal (`166-archive-dirty-refused.png`, `archive-refusal-files.json`), then clean archive keeps history (`167-archive-clean.png`). A follow-up creates a fresh workspace and replies (`168-archive-followup.png`); trying to archive this new undelivered work explains that it must ship first (`175-archive-followup-needs-ship.png`). A separate final clean archive of the delivered thread removes its workspace (`176-archive-final.png`, `archive-final-files.json`: exists=false).

## Efficiency & flow — 9

Limits entered from the profile detail returns to that same detail with **Limits focused** (`34-limits-from-settings.png`, `35-limits-return.png`, `limits-return-focus.json`). Global Limits closes back to the thread; its required sizes are `138-limits-1600.png`–`140-limits-900.png`. Preview command **Enter saves**, and reopening shows the exact command; I then cleared the disposable setting (`49-preview-enter-saved.png`).

Search empty/Escape clear, project filter/clear, row context menu/End/Escape, picker empty results/ArrowDown/Enter, model favourite selection, snooze/wake, settle/reopen and seven-thread shelf paging all work (`94-search-empty.png`–`107-shipping-options.png`, `160-settled-paging-short.png`–`162-settled-expanded-seven-short.png`). Copy code succeeds when the browser grants clipboard access. Repository instructions save and read back from the fixture file (`90-instructions-saved.png`, `saved-instructions.txt`).

No material flow fix is justified by these paths. Smallest useful polish is the copy-result reset above, which makes a repeated action easier to interpret without an extra step.

## Accessibility — 9

The visible title reveal now works through actual Tab entry, not just direct focus or an HTML title attribute. `title-stability.json` compares row rectangles before and after focus; the title row remains **44 px** and its neighbours do not shift. Both early and final title captures demonstrate this behavior.

The **900×700 overlay** completes **40 forward and 40 reverse Tab steps** through its visible controls and toggle, with **no BODY, underlying composer, sidebar control or resizer stop** (`83-overlay-forward.png`, `84-overlay-reverse.png`, `overlay-focus.json`). Settings also releases the panel boundary: I opened Settings while the wide panel was active, resized to 900×700 and tabbed through Settings controls (`141-settings-boundary-released.png`, `settings-resize-focus.json`). The initial BODY stop when entering that new document focus sequence is not a repeating overlay stop. A separate ordinary Escape-close/Settings sequence is `92-settings-after-overlay.png` and `settings-focus-boundary.json`.

Choice selection controls measure **36×36 px**, sit in the label row, and do not cover the thumbnail (`09-choice-900.png`, `11-choice-picked.png`, `choice-targets.json`). Media Open actions also measure 36 px high (`media-action-targets.json`). Invalid focused fields keep a red outline (`64-tool-invalid-focused.png`). Tool and image regions have useful names in ARIA snapshots. No new material keyboard defect was found; no screen-reader speech or exhaustive contrast certification is claimed.

## Layout robustness — 9

The title row does not expand on focus. Effort Auto and High both measure **86.171875 px** wide at identical x/y positions (`effort-geometry.json`). Choice wraps into two columns at 900 px and three at 1280 px without overlaying its pick controls (`09-choice-900.png`, `13-saved-title-tab-tooltip.png`). Inline media, long context and expanded output have narrow/wide evidence (`02-inline-1280.png`–`04-inline-900.png`, `128-long-context-1280.png`–`130-long-context-1600.png`, `146-tool-401-900.png`, `147-tool-401-1600.png`).

With seven other open/ready/review rows in the earlier dense shell, expanding Settled at **1280×500** brings its first row into view at **y=384, height=44**, above the footer (`142-settled-dense-short.png`, `settled-short-rect.json`). Seven settled threads later support Show 2 more and expansion at that same height (`160-settled-paging-short.png`–`162-settled-expanded-seven-short.png`).

Onboarding's project-added acknowledgment causes **no dot movement**: progressbar rectangles before/after are exactly `{x:366,y:401.6875,width:440,height:6}` (`onboarding-progress-before.json`, `onboarding-progress-after.json`, `344-onboarding-inspected-900.png`, `345-onboarding-added-900.png`). The 500 px onboarding capture remains usable (`346-onboarding-short.png`). No persistent whole-window horizontal overflow or material layout defect was observed. No additional layout change is warranted by this evidence.

## Forms & dialogs — 9

Text-field **Escape opens Discard changes?**, Keep editing preserves the draft and leaves Save enabled (`30-dirty-text-escape.png`, `31-keep-editing.png`). Subsequent section navigation and Limits are guarded (`32-dirty-section.png`, `33-dirty-limits.png`). Discard restores Personal with Save disabled; reopening agrees, and `persisted-profiles.json` retains Personal. **Clean Escape focuses the originating Personal row** (`36-clean-escape-origin.png`, `clean-escape-focus.json`). Keep editing did not save the tested rename.

Account/profile/secret/MCP/tool/source/hub/Add project validation is specific and local (`39-account-validation.png`, `42-profile-validation.png`, `52-secret-validation.png`, `58-mcp-validation.png`, `59-mcp-invalid-url.png`, `64-tool-invalid-focused.png`, `65-tool-invalid-version.png`, `81-source-validation.png`, `46-hub-validation.png`, `150-add-project-empty.png`, `151-add-project-invalid.png`). Switching invalid MCP remote transport to local clears irrelevant errors (`60-mcp-transport-reset.png`). MCP deletion now states **Threads lose this server's tools** (`62-mcp-delete-consequence.png`). Secret replacement begins blank (`55-secret-replace-blank.png`). Project removal and thread deletion ask explicitly (`50-project-remove-confirm.png`, `143-thread-delete-confirm.png`); a later disposable thread deletion completes (`165-thread-deleted.png`).

No material form defect was found. The smallest remaining label fix is the secret list's No projects yet wording, above; it does not require another confirmation or permanent warning.

## Top 5 follow-ups

Only **three UI fixes** are justified by this audit. I will not invent two more defects to fill a list.

1. Replace raw clipboard-denial text with an actionable plain-language message (`47-pairing-copy-redacted.png`).
2. Clear the previous skill-copy success when a subsequent attempt fails (`78-skill-copy-refusal.png`).
3. Rename a secret's empty access label to No projects selected / No project access (`53-secret-saved.png`).
4. **Verification, not an observed UI defect:** finish live/native preview and provider/limits/MCP flows with their actual prerequisites before claiming platform-wide readiness.
5. **Verification, not an observed UI defect:** run a screen reader through title tooltips, overlay focus, validation and dynamic notices; ARIA snapshots and keyboard cycling do not establish spoken announcements.

## Objections and evidence qualifications

- I do not carry forward my round-5 title, blank overlay BODY stop, Limits return or repair-spacing findings after observing them corrected. Conversely, an implementation description alone was not accepted as proof.
- A Ready conversation containing an intentionally failed Bash tool is not a Failed thread. The blocked-send audit checks user bubbles, draft, sidebar state and persisted conversations separately.
- The selected-model/effort controls changed successfully in this run, but I did not repeat round-5's reload persistence journey. Reported execution is fake-provider behavior, not actual reasoning effort proof.
- Capture 15 was taken before the tooltip delay. Use 135–137 for the complete effort focus/dismissal evidence. An initial video-control click left video paused; `152-video-playback.png` and `video-playback.json` are the successful proof (time 0.8668, paused=false, readyState=4, no error). Audio separately advanced to 0.855044. Audibility is not established.
- The first clean-archive filesystem observation (`archive-clean-files.json`) ran after the follow-up had already recreated the CI workspace path; its exists result does **not** establish a cleanup failure. The later separate delivered-thread archive is measured before any new follow-up and reports exists=false (`archive-final-files.json`).
- Some driver assumptions timed out: combined accessible names after validation, button versus summary Details, old delivery prose, duplicate Build image text, changing tool-summary labels and an attempted click behind the overlay scrim. Fresh ARIA resolved these. They are not product failures. All captured intermediate states are retained.
- Copy code's first failure is a browser clipboard permission limitation with poor error wording. The permitted-context success is separately established, not inferred from the presence of a button.

## Coverage and precise gaps

**Exercised UI:** shell empty-selection state; all three initial conversations; sidebar search/filter, actual Tab title reveal, row context and header menus, rename, snooze/wake, settle/reopen, seven settled rows/paging, deletion cancel/confirm, picker search/empty/keyboard selection, model favourite/select and effort menu; global/Settings Limits; media/tool disclosures and lightboxes; Choice view/pick; long transcript, streaming, exploration, steering/queue/Stop/Resume; direct queued delivery/completion, review preparation/stop fixes/check, CI progression; archive refusal/clean/follow-up; all Settings sections including Harnesses; profile/account create/validation/delete and account-in-use guard; profile dirty flows; machine detail/rename/reopen; hub forms/removal cancellation/pairing copy; project details/Preview Enter/remove cancellation; secret add/edit/blank replacement/cancel/delete using dummy value; tool install failure/details/repair/block/delete; MCP transport/validation/local creation/delete; library source details/update check/scope save/copy and overwrite refusal/delete cancellation; skill-source validation; repository/library/inherited panel views, instruction save, reference insertion, enable/disable and MCP tab; panel no-project context.

**Fresh home:** two custom 3-verify journeys passed:

- `out/verify/2026-11-04T13-30-03-023Z-f6d08020`: local hub, empty profile validation/create, provider selection, signed-out gate, project-first sheet, inspected add/acknowledgment/duplicate, 1280×900/900×700/1600×1000.
- `out/verify/2026-11-04T13-38-48-223Z-49541c5e`: remote hub form/empty validation/Back, local continuation, narrow project add, dot position comparison and 1280×500. Both cleanup files pass.

**Available but not fully tested — not “unreachable”:**

- Settings machine profile-folder add/remove and two-profile folder suggestion; project profile reassignment, two-checkout remote grouping and confirmed checkout removal. The fixture allows disposable prerequisites, but these journeys were omitted.
- Skill-source add/clone success, changed-revision preview/apply/rollback and confirmed source deletion. Existing Library Check for updates was exercised only in its up-to-date state. Creating revision history was omitted under this audit's no-commit restriction. Scope saved to a project and was reflected in the panel; every scope permutation was not tested.
- MCP bearer-token save/reopen/sign-out, remote OAuth failure/cancel, local MCP actual process use; definitions and forms do not prove a working external server.
- Hub pairing of a second independent hub/machine, switching/offline/reconnect, cross-window isolation/removal completion and revocation. Only single-hub forms, removal cancellation and code copying were exercised. Additional isolated services could be provisioned; they were not provisioned here.
- Delivery queued-intent cancellation, a newly failing review after Stop automatic fixes, externally merged review/target-check sequence, restart/recovery, unavailable origin/stale checkout, native preview startup/process termination. Open app was clicked without a configured command (`115-open-app-no-command.png`); no launch result was established. This is an omitted setup, not proof the preview feature is unavailable.
- All media Download payloads, file-link contents/OS opening, alternate media formats, exact native transport controls and every image variant's lightbox. Inline and tool images plus Choice lightboxes were observed; successful video/audio time progression is narrower than exhaustive media coverage.
- Search keyboard shortcuts, every hover stop/settle/wake route, running-row/menu Stop, every menu outside-click/arrow permutation, queue Steer now/remove, new-profile picker and model reload persistence. The main variants above passed, but they do not cover all equivalent entry points.
- Secret runtime request/reuse/Use once/Decline/cancel/expiry requires its separate scripted-harness fixture, which is available in the repo but was **not launched**. Settings dummy-value CRUD is not runtime secret-delivery proof. Deterministic limits failure/reset/shared-account fixtures were likewise available but not launched. Neither is called unreachable.

**Unavailable live/native prerequisites:** real Claude/ChatGPT consent, successful paid inference and real reported usage require credentials absent by design. Authenticated final inline onboarding is not reached through the signed-out gate. Real MCP OAuth/service execution, successful managed-tool repair and multi-machine production connectivity need corresponding services/accounts. The nonexistent tool produced Needs attention and a repair conversation, not a successful repair. Browser mode cannot establish Electron Browse, OS file opening/window controls or desktop preview opening; no native bridge was forged. Screen-reader speech, exhaustive contrast and timing/race coverage remain unverified.

The report is an independent observation of this stable build. Only my report and audit evidence were authored; other auditors' reports were not edited.
