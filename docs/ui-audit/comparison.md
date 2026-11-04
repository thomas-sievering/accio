# UI audit comparison

Work is on `ui_analysis`. The comparison includes round-5 observations and subsequent fixes; the all-auditor threshold is still pending independent review.

## Changes visible in ordinary use

| Area | Before the audit | After round 4 |
|---|---|---|
| Transcript | Raw resource JSON and timestamp receipts interrupt reading. | Resource diagnostics are removed from the reading flow; one delivery chip states the outcome. |
| Delivery | Choosing a shipping mode starts it; stop wording suggests PR tracking stops. | Mode selection is separate from execution; Stop automatic fixes keeps PR observation explicit. |
| Settings | Different save/delete patterns; repeated titles; project settings hidden behind a gear. | Shared footers and inline confirmation; breadcrumb titles; Projects and Limits in navigation. |
| Unsaved edits | Settings navigation can discard edits. | Existing dirty editors ask Keep editing or Discard. A browser test proves keeping does not save and discarding preserves the original. |
| Profile editor | Separate cards push useful choices below the footer at 900×700. | One compact account/name card and a Saved secrets link leave both fixture skill choices visible. |
| Keyboard | Several menus lack focus and arrow navigation; no global search/new-thread shortcuts. | Menus take focus, arrows navigate, Escape restores focus; Ctrl+K, / and Ctrl+N reach common actions. |
| Sidebar | Long project/status combinations truncate; snooze has no acknowledgement. | Short delivery status with complete tooltip; snooze acknowledgement and Undo. |
| Narrow window | Three panes squeeze content and expose background controls. | Side panel overlays the app with a scrim and inert background, including the sidebar resizer. |
| Composer | Early Enter can be lost during machine loading; effort can reset after sending/reloading. | Loading alone no longer disables a draft; menu effort changes save immediately. Regression browser tests cover both. |
| Forms | Validation and confirmation wording vary. | Field-local errors and focus; consistent destructive action order; onboarding sheet padding restored. |

## Screenshot evidence

Before screenshots were captured by the independent round-1 auditors; after screenshots below were captured after the round-4 implementation. Fixture contents vary, so these are behavior comparisons rather than pixel-difference proofs. An interactive score chart and two matched 900×700 screenshot pairs are available locally at `out/ui-audit/comparison.html`.

- Profile before: `out/ui-audit/round-1/opus/116-settings-edit-profile.png`.
- Profile after, 900×700: `out/ui-audit/round-4/resume/03-compact-profile.png`.
- Guard after: `out/ui-audit/round-4/resume/01-unsaved-profile.png` and `out/e2e/chat/` settings-test evidence.
- Project page after: `out/ui-audit/round-4/resume/02-project-settings.png`.
- Limits entry result: `out/ui-audit/round-4/resume/04-settings-limits.png`.

The complete numbered evidence for each audit is under `out/ui-audit/round-N/<auditor>/`. These local files are ignored by Git; the reports and implementation are versioned.

Matched 900×700 pairs in the interactive artifact:

- Profile: `round-1/gpt-sol/134-profile-form-900.png` → `round-5/gpt-sol/022-compact-profile-900.png`.
- Shipped thread: `round-1/gpt-sol/92-shipped-900.png` → `round-5/gpt-sol/061-shipped-900.png`.

The latest fixes add keyboard-visible title/effort tooltips, stable focused row height, explicit panel Tab wrapping, repair-link spacing and a return to the originating Settings page from Limits. They are not yet independently scored.

## Score interpretation

Round 1 started at 6–8 across the nine categories. In round 4, Sonnet and GPT Sol each gave four categories 9; Opus gave Feedback and Efficiency 9. Every other round-4 score was 8. In round 5 GPT Sol gave seven categories 9, with Clarity and Accessibility 8. The Claude children initially failed at rate limits, then were resumed separately on Claude HRC and produced reports. Sonnet gave four categories 9 and Opus three, with other scores 8. Their reports note the shared checkout changed during the resumed runs; Opus limits its affected baseline evidence explicitly. See `round-5/plan.md` for the complete table and audit caveat. Scores cannot be presented as ratings of the subsequent fixes.

Live provider sign-in and real model execution, exhaustive screen-reader conformance, and native OS integration remain outside the established audit evidence. Mocked provider and hosting boundaries are identified in the fixture suites.
