# UI audit comparison

Work is on `ui_analysis`. This is a working comparison through the round-4 fixes; the all-auditor threshold is still pending a new independent audit.

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

Before screenshots were captured by the independent round-1 auditors; after screenshots below were captured after the round-4 implementation. Fixture contents and viewport dimensions vary, so these are behavior comparisons rather than pixel-difference proofs.

- Profile before: `out/ui-audit/round-1/opus/116-settings-edit-profile.png`.
- Profile after, 900×700: `out/ui-audit/round-4/resume/03-compact-profile.png`.
- Guard after: `out/ui-audit/round-4/resume/01-unsaved-profile.png` and `out/e2e/chat/` settings-test evidence.
- Project page after: `out/ui-audit/round-4/resume/02-project-settings.png`.
- Limits entry result: `out/ui-audit/round-4/resume/04-settings-limits.png`.

The complete numbered evidence for each audit is under `out/ui-audit/round-N/<auditor>/`. These local files are ignored by Git; the reports and implementation are versioned.

## Score interpretation

Round 1 started at 6–8 across the nine categories. In round 4, Sonnet and GPT Sol each gave four categories 9; Opus gave Feedback and Efficiency 9. Every other round-4 score was 8. Round-4 scores were assigned before the subsequent fixes; they cannot be presented as ratings of those fixes. See the individual reports for exact verdicts and unmet preconditions.

Live provider sign-in and real model execution, exhaustive screen-reader conformance, and native OS integration remain outside the established audit evidence. Mocked provider and hosting boundaries are identified in the fixture suites.
