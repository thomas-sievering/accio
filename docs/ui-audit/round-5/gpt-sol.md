# Accio UI audit — round 5 — gpt-sol

Audited built commit **31733b4** on Windows in isolated Chromium, 4 November 2026. The populated fixture used my assigned port **47673**; two custom 3-verify journeys used their own fresh homes. No application code, build, branch or commit was changed. Scores describe observed UI, not the round-4 plan or its test results.

| Category | Score | Verdict |
|---|---:|---|
| Minimalism / calmness | 9 | Quiet working and delivery surfaces; repeated skill origin is gone. |
| Visual hierarchy & typography | 9 | Compact profile now exposes its useful controls at 900×700. |
| Consistency | 9 | Project details and destructive confirmations fit Settings; a recovery-link spacing nit remains. |
| Clarity & discoverability | 8 | Recovery and onboarding are clearer; full titles still lack a visible keyboard reveal. |
| Feedback & state | 9 | Queue, failed tools, shipping and continued PR observation are explicit. |
| Efficiency & flow | 9 | Dirty navigation and recovery links work; Limits return context is a small remaining detour. |
| Accessibility | 8 | Overlay no longer exposes the resizer; visual keyboard access to full titles remains incomplete. |
| Layout robustness | 9 | Stable rows, padded sheets and compact forms work at the exercised sizes. |
| Forms & dialogs | 9 | Keep editing does not save; Discard restores saved state; validation and confirmations work. |

Evidence is in `out/ui-audit/round-5/gpt-sol/`. 161 numbered screenshots are ordered by capture time across the independent journeys; screenshot-map.json preserves their original names for runner trace correlation. Screenshot references below identify actual captured states, with matching ARIA snapshots. A 9 means only minor polish in the exercised scope. No category is raised because the audit loop wants 9s.

## Minimalism / calmness — 9

The library skill now says **lib-review / Library**, rather than Library · Library (`035-skill-enabled.png`, `036-skill-library-expanded.png`). Expanded Source retains Library and the revision without repeating the row label. Shipping has a concise outcome chip and separate Reopen/Archive actions without duplicate Settled/workspace prose (`060-shipped-1280.png`, `061-shipped-900.png`). Queued Ship is a restrained spinner (`059-ship-queued.png`); CI's progress and expandable details stay subordinate (`064-ci-build.png`, `065-ci-details.png`). No material calmness defect was found.

Small polish opportunity: the effort trigger shows only Auto or High beside a chevron (`050-effort-resting.png`). Its meaning becomes explicit in the accessible name/menu. If new-user comprehension needs improvement, use a compact Effort label in its tooltip on keyboard focus; avoid adding permanent helper prose.

## Visual hierarchy & typography — 9

The compact profile correction is complete in this fixture: both lib-docs and lib-review, their descriptions and the sticky actions are visible at **900×700** (`022-compact-profile-900.png`). Saved secrets is now an inline link, and the name/account fields share one card. The wide form remains readable (`146-profile-wide.png`). This resolves my round-4 density objection.

Tool input/result labels, failed-command feedback and expanded output are distinguishable (`074-tools-expanded-real.png`, `075-tool-full-output-900.png`, `076-tool-full-output-1600.png`). Transcript and settings text retain their hierarchy across the three required sizes. Minor typography defect: the recovery message ends **started.Open repair thread**, visually joining the sentence and link (`107-blocked-send-with-link.png`). **Smallest fix:** add an explicit separating space or a small inline gap before the link.

## Consistency — 9

The header project shortcut opens the Settings project detail, with breadcrumbs and the same staged footer (`029-project-detail.png`). A dirty project breadcrumb offers the same Keep editing/Discard controls as a dirty profile (`030-project-dirty-breadcrumb.png`, `023-dirty-section.png`). Account, profile, MCP, tool, source, secret and hub removal confirmations name the target (`081-account-delete.png`, `083-profile-delete.png`, `099-mcp-delete.png`, `109-tool-delete.png`, `113-skill-source-delete.png`, `093-secret-delete.png`, `085-hub-remove-confirm.png`). Hub Connected is quiet and consistent with the other status treatments.

The recovery-link spacing above is the only new small visual exception established here. **Smallest fix:** separate the inline action using the same notice/action spacing as other captions.

## Clarity & discoverability — 8

1. **A sighted keyboard user still cannot reveal a complete saved title without opening Rename.** The long row remains two lines when focused, with its latter text clipped; the main header also ellipsizes it (`041-full-title-keyboard.png`, `145-title-keyboard-final.png`, `161-title-via-tab.png`). The final capture uses actual Tab presses from Search, not only a direct focus call. After 1.5–2.5 seconds there is no visible full-title popup. `title-focus-final.json` records the focused button, a 49 px height, the complete HTML `title` and no role=tooltip element. **Smallest fix:** show the complete saved title in a wrapping, noninteractive tooltip on focus as well as hover, retaining the stable row height.

   This is a narrower finding than “title unavailable”: the row's text/accessible name and native title contain the saved text. I did not run a screen reader. The observed failure is **visible keyboard recovery**, and a native HTML title does not establish that behavior. The title input limits the saved value; I judge the text actually saved, not the longer string initially typed.
2. **Minor:** Auto alone does not tell a new user that this is effort (`048-review-draft.png`, `050-effort-resting.png`). The chevron improves the resting affordance and the button is named Effort: Auto. **Smallest fix:** ensure a visible Effort tooltip also appears on focus.

Onboarding's project-first link is explicit, opens a padded sheet, adds the inspected folder and acknowledges Added verify-project (`138-onboarding-signin-gate.png`–`141-onboarding-project-added.png`). The empty sidebar correctly changes from No projects yet to No threads yet. Stop automatic fixes now describes the action accurately (`055-review-waiting-900.png`, `057-review-fixes-stopped.png`).

## Feedback & state — 9

The blocked first send reports that the missing tool is not ready and provides **Open repair thread**. Clicking it opens the generated repair conversation (`107-blocked-send-with-link.png`, `108-repair-thread-opened.png`). The failed tool detail says Needs attention and explains package/version recovery (`105-tool-failed-details.png`). This fixes the missing recovery path; the sentence/link spacing is a nit, not a failed recovery.

Sonnet/High survives first send and reload (`053-review-ready.png`, `124-model-effort-persisted.png`). Steering shows its inserted message while Working remains at the live end (`068-steered-working.png`). The queue says after this turn; its Save action is prominent while editing, and Stop closes the unsaved editor (`069-queued.png`–`071-stopped-queue.png`). Resume continues and the original queued message subsequently runs (`072-resumed.png`). Snooze names tomorrow in both acknowledgment and persistent pane state (`043-snoozed.png`).

Direct Ship advances from queued to Shipped; CI exposes Build image 2/4, Push image 3/4 and completion (`059-ship-queued.png`–`067-ci-complete.png`). After Stop automatic fixes, the PR link, still tracking #123 and Check now remain; a subsequent Check now succeeds (`057-review-fixes-stopped.png`, `058-review-observation-continues.png`). This proves the displayed continuation of observation, not behavior after a newly failing upstream check.

## Efficiency & flow — 9

The profile density fix removes the previous routine scroll. Limits is now an actual Settings navigation entry (`014-settings-machines.png`, `015-settings-limits.png`). Dirty entry to it is guarded (`025-dirty-limits.png`). Recovery is directly reachable from the failed send.

**Minor:** Limits entered from Settings opens the standalone shell view; closing it returns to the thread rather than the originating Settings page (`015-settings-limits.png`, `016-limits-900.png`, followed by the Choice thread). This is usable and consistent with the existing global shortcut, but costs a return trip when comparing account configuration with limits. **Smallest fix:** retain an origin destination for Close when Limits was opened from Settings.

Search empty state, Escape clearing, picker empty/search/keyboard selection, Filter menu, row Shift+F10, menu End/Escape, snooze/wake, settle/reopen and choice view/pick were exercised (`042-row-keyboard-menu.png`–`048-review-draft.png`, `126-choice-lightbox.png`–`129-thread-delete-confirm.png`).

## Accessibility — 8

The material remaining defect is the **visible full-title keyboard reveal** described above. The correction should preserve both the accessible full text and the stable row geometry.

The narrow overlay now excludes normal sidebar controls **and Resize sidebar** in both directions. `overlay-focus.json` records 24 forward Tabs, and `overlay-reverse-focus.json` records 18 reverse Tabs. They cycle through panel controls and its toggle; neither reaches the resizer or underlying composer (`033-overlay-focus-cycle.png`, `132-overlay-reverse-focus.png`). Escape closes the panel and restores its toggle (`134-overlay-escape-focus.png`).

**Minor:** each cycle includes a BODY focus stop between the toggle and first panel tab. There is briefly no visible in-app focus indicator. **Smallest fix:** wrap Tab/Shift+Tab explicitly between the first available panel control and the toggle, removing that blank step. This is not the previous leak to an actionable background control.

Choice selection rings are empty at rest and visibly selected after picking; image lightboxes and the project sheet are named (`008-choice-900.png`, `126-choice-lightbox.png`, `127-choice-picked.png`, `158-onboarding-sheet-900.png`). No screen-reader conformance or exhaustive contrast/hit-target audit is claimed.

## Layout robustness — 9

The full-title row no longer grows and displaces its neighbors; its measured focused height is 49 px. Its remaining information-reveal problem belongs to accessibility/discoverability. Profile skills fit above the short footer, and onboarding project-sheet padding is present at both 1280 and 900 widths (`022-compact-profile-900.png`, `139-onboarding-project-sheet.png`, `158-onboarding-sheet-900.png`, `159-onboarding-inspected-900.png`).

Inline media, Choice, long context and expanded tool output were captured at narrow/wide sizes (`005-inline-900.png`, `006-inline-1600.png`, `007-choice-1600.png`, `008-choice-900.png`, `119-long-context-1280.png`–`121-long-context-1600.png`, `075-tool-full-output-900.png`, `076-tool-full-output-1600.png`). Limits has all three required sizes (`125-limits-profile.png`, `154-limits-1280.png`, `155-limits-1600.png`). The 1280×500 shell retains its footer (`153-short-window.png`). No persistent whole-window horizontal overflow was observed. No new layout fix beyond the focus tooltip is warranted by these captures.

## Forms & dialogs — 9

**Keep editing never saved the tested rename.** I changed Personal to Personal unsaved, attempted section navigation, chose Keep editing, then attempted Limits and Back. The draft remained in the textbox and Save stayed enabled (`023-dirty-section.png`–`027-dirty-back.png`). Discard and reopening restored Personal, with Save disabled (`028-discard-reopened.png`). A read-only settings observation also retains only the saved Personal profile (`persisted-profile.json`). A later dirty breadcrumb and Discard repeat the result (`149-dirty-profile-breadcrumb.png`, `150-discard-after-escape.png`). A project skill change likewise triggered its breadcrumb guard (`030-project-dirty-breadcrumb.png`).

Escape **from the guard** keeps the edits and focuses Save (`026-dirty-escape.png`). Escape directly in the profile editor, including after clicking the breadcrumb area, stayed in the editor with the draft intact (`147-dirty-escape-entry.png`, `148-dirty-escape-noninput.png`); I do not claim it navigates away or opens a guard. This caused a driver assumption to time out, not data loss.

Empty account/profile/secret/tool/MCP/source/hub submissions show specific inline feedback; invalid versions and URL errors are local (`079-account-validation.png`, `082-profile-validation.png`, `089-secret-validation.png`, `101-tool-validation.png`, `102-tool-version-validation.png`, `095-mcp-validation.png`, `096-mcp-invalid-url.png`, `115-skill-source-validation.png`, `087-hub-validation.png`). Switching the invalid MCP remote form to Local command starts clean (`097-mcp-transport-clean.png`). Local MCP creation and named deletion work. Add project reports empty and nonexistent folders, and fresh-home duplicate detection works (`117-add-project-validation.png`, `130-invalid-project-stable.png`, `142-onboarding-project-duplicate.png`). No material form defect was found.

## Round-4 recheck and objections

| Required recheck | Observed outcome |
|---|---|
| Dirty section/breadcrumb/Back/Limits navigation | Guarded; Keep editing retains draft; Discard/reopen retains saved profile. |
| Keep editing must never submit | Passed in the exercised sequence; reopened UI and safe persisted profile agree. |
| Compact profile | Fixed at 900×700; both actual skill choices visible. |
| Limits in Settings | Present and usable; small origin-return nit. |
| Effort/media resting affordances | Chevron and adjacent media Open/Download controls visible at rest. Video/audio time advances while unpaused (`media-playback.json`). |
| Onboarding project padding | Fixed at 1280×900 and 900×700. |
| Overlay boundary including separator | Resizer no longer reached forward or backward; blank BODY stop remains. |
| Full-title access | Row geometry fixed; visible keyboard tooltip still absent. Do not accept the native `title` as proof of the requested focus reveal. |
| Stopped fixes vs observation | Correct wording and continued PR identity/check controls observed. |
| Repair thread action | Present in blocked send and opens the thread; missing separating space. |
| Skill label deduplication | Fixed in enabled row and expanded details. |

The plan's claim of an “existing tooltip” does not override the observed keyboard result. Conversely, I do not carry forward the old resizer, compact-form or misleading PR-label findings after seeing them corrected.

## Coverage and unmet preconditions

- **Shell/sidebar:** initial state; all three initial fixtures; header and keyboard row menus; rename/full-title focus; search/no results/Escape; filter; project/new-thread picker/search/no results/keyboard selection; snooze/wake; settled/reopen; thread-delete cancellation; Settings and global/composer Limits. No separate Working shelf exists in this fixture. Six-plus settled paging was not exercised.
- **Threads:** successful and failed tool disclosures, input/result and full 401-line output; image lightbox; inline and tool images; native video/audio playback; missing-media state; Choice lightbox/pick; 70-paragraph history, streaming update and tool exploration; model/favourite selection and model/effort reload; steering, queue edit, Stop/Resume. Media time advanced; audibility, download contents and native file opening were not established. Missing picture is an intentional fixture condition. A file-link label was observed, but no native opening is claimed.
- **Delivery:** direct queued Ship/completion/Reopen, review preparation/stopping automatic fixes/Check now, CI details/two steps/completion. Provider execution and hosting observations are fake boundaries in the prescribed chat fixture; disposable Git operations are real. No live PR was created. External merge, a newly failing review after stopping fixes, preview launch, dirty Archive refusal and archive/workspace deletion were not exercised.
- **Settings:** every actual section including Limits; signed-in and newly added signed-out account details; disposable account/profile creation, validation and deletion; profile Cancel/dirty navigation/Keep editing/Discard; machine details; secret add/edit/replace form/cancel/delete with a dummy value; tool validation, actual missing-package install failure, repair link and deletion; MCP remote validation/transport switch/local create/delete; skill-source detail/scope/copy forms and source add validation/delete confirmation; project detail/dirty guard/checkout-removal cancellation; Add project validation; hub add validation/removal cancellation. No hub/source/checkout deletion was confirmed.
- **Panel:** narrow Skills/MCP, repository and library expansion, instruction edit/cancel, enable/disable library skill, Loaded state and forward/reverse focus observations. Source clone/update/apply/rollback, project-copy execution and repository instruction saving were not exercised; these are explicit coverage gaps, not passed features or demonstrated blockers. The existing fixture permits some of them, so I do not mislabel them unreachable.
- **Onboarding:** custom journey passed at `out/verify/2026-11-04T12-46-43-646Z-391ca714`; remote-form/narrow-sheet journey passed at `out/verify/2026-11-04T12-50-16-825Z-464ea454`. Hub local choice, remote-form validation/Back, profile validation/creation, provider selection, account gate, project-first sheet, inspection/add/duplicate and all required sizes are captured. Both runners report server exit, closed port, removed scratch and retained evidence.
- **Unreachable live preconditions:** authenticated inline project onboarding completion, live Claude/ChatGPT consent/inference/actual effort execution, real-provider limits, real MCP authentication and successful repair execution require live credentials/services absent from these isolated fixtures. Multi-machine switching/pairing, cross-window hub isolation and revocation were not established. Native Electron Browse, OS file opening/window controls, screen-reader speech and exhaustive contrast/race coverage need separate proof.
- **Evidence caveats:** preview_status was called first; an owned tab was opened with reuseExistingTab=false. Its snapshot failed twice with “Preview automation snapshot timed out after 15000ms”, permitting the project Playwright fallback. Stale exact selectors and a changed tool-summary name caused driver timeouts; current snapshots resolved them. `073-tools-expanded.png` precedes the actual expansion; use `074-tools-expanded-real.png`. `104-blocked-send-repair-link.png` is the first in-flight attempt, not proof of the eventual error; use 107/108. `118-add-project-invalid.png` precedes folder inspection; use 130. Evidence preserves these intermediate states.

## Top 5 changes

1. **Provide a wrapping full-title tooltip on keyboard focus**, keeping rows compact. This addresses the only material remaining issue (`161-title-via-tab.png`).
2. **Remove the blank BODY stop from overlay Tab cycles** with explicit first/last-control wrapping (`overlay-focus.json`, `overlay-reverse-focus.json`).
3. **Separate the repair action from its preceding sentence** with a space or inline gap (`107-blocked-send-with-link.png`).
4. **Return Limits to its Settings origin when entered there**, preserving the global shortcut's thread return (`015-settings-limits.png`, `016-limits-900.png`).
5. **Make Effort explicit in the focus tooltip for Auto/High**, retaining the quiet resting chevron (`050-effort-resting.png`).

Items 2–5 are polish; they do not justify inventing additional material failures. Cleanup: the owned Playwright browser and preview tab were closed. Listener PID **34004** was verified as `node --import tsx scripts/chat-test-server.ts` before stopping it; port **47673** has zero remaining listeners (`cleanup.json`). Only this auditor's report/evidence was edited, apart from the prescribed launchers' own standard isolated artifacts.
