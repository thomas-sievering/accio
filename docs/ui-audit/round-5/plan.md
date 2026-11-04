# Round 5 changes

GPT Sol scored seven categories 9, with Clarity and Accessibility 8. Sonnet and Opus initially failed at rate limits, then were resumed separately on Claude HRC. Their reports appeared while the outer loop was finishing the GPT Sol fixes.

| Category | Sonnet | Opus | GPT Sol |
|---|---:|---:|---:|
| Minimalism / calmness | 9 | 9 | 9 |
| Hierarchy / typography | 9 | 9 | 9 |
| Consistency | 8 | 8 | 9 |
| Clarity / discovery | 8 | 8 | 8 |
| Feedback / state | 8 | 8 | 9 |
| Efficiency / flow | 9 | 8 | 9 |
| Accessibility | 8 | 8 | 8 |
| Layout robustness | 8 | 8 | 9 |
| Forms / dialogs | 9 | 9 | 9 |

The parent had checked the original task results, which were failed, but did not re-read the resumed child threads before editing/rebuilding. Opus explicitly identifies screenshots 172–255 as potentially showing the modified build and excludes affected behaviors from its baseline proof. Sonnet also notes the changed checkout. Preserve these limitations; the scores are neither a clean final-build comparison nor proof of the fixes. All three need a stable-build audit next.

## Applied fixes

1. Full saved thread titles now appear in a wrapping tooltip on keyboard focus and pointer hover. The tooltip is portalled outside the sidebar scroll clip, dismisses on Escape/blur/scroll, and leaves row geometry unchanged. Effort uses the same visible focus tooltip to identify Auto/High.
2. Narrow side panels wrap Tab and Shift+Tab between visible enabled panel controls and the close toggle, eliminating the blank BODY stop. Open dialogs/popovers keep their own focus behavior, and Settings releases the panel's focus boundary.
3. Separate the blocked-send message from Open repair thread with an explicit space.
4. Remember the originating Settings route when opening Limits there; Close returns to that page and focuses its Limits entry. Global Limits retains its thread return.

## Additional Claude findings

- Resource readiness now precedes publishing a turn's state/user bubble. A rejected existing-thread send preserves the draft, prior thread state and transcript instead of producing orphan sent bubbles and a generic Failed banner. A new draft checks tools before allocating/storing its conversation. Regression tests cover repeated rejected sends, retry after readiness, and absence of a new blocked conversation.
- Settings restores focus to the originating list row (or breadcrumb), gives the discard controls a named group, and routes Escape in text fields through the dirty guard. Project Preview command submits on Enter like profile Name.
- Skill scope labels are neutral, tool readiness cards use the available width, tool Details uses the shared chevron, MCP deletion states its consequence, and queued Save uses the filled primary treatment.
- Invalid fields keep their red focus outline. Choice selection sits beside its label rather than obscuring the thumbnail, with 36 px controls. Media action targets are also 36 px.
- Expanded shelves scroll their first row into view. Pairing codes offer Copy. The onboarding project-added acknowledgement reuses its existing secondary row instead of shifting the step dots.
- Effort keeps its stable button width while its caret sits beside the displayed word, and repair conversations use the tool's display name.

Decisions: keep explicit Open app actions, contextual deletion layouts and the existing top-level Escape behavior. These serve concrete tasks; removing them or making all confirmations replace a footer would not automatically improve usability. A stable independent review must judge the resulting behavior.

For the next round, `scripts/chat-test-server.ts` accepts `ACCIO_CHAT_TEST_WEB_ROOT` (default unchanged). Each auditor will serve the saved web-build copy under `out/ui-audit/round-6/build/`, so later shared-checkout builds cannot change its populated-app screenshots. The parent also waits for all current child threads to finish before further implementation.

## Evidence and checks

The independent report and 161 numbered screenshots describe commit `31733b4`, before these fixes. Its two fresh-home onboarding journeys passed. Live-provider, native, screen-reader and omitted fixture coverage remain as listed in `gpt-sol.md`.

New browser checks cover actual Tab entry into a renamed long-title row, full tooltip text in the viewport, stable row height, Escape/focus retention, effort menu entry, 40 forward/reverse overlay Tab steps, releasing the boundary in Settings, and Settings/global Limits return destinations.

The first focused run caught a remaining 44→49 px row expansion from an old focus-only CSS rule. Removing that rule keeps the new tooltip from moving neighbors; the corrected title test passes. Settings and overlay focused checks also pass.

Final validation: type-check and build pass. The initial unit run passed 51 files but timed out in 12; all 12 pass with two workers (87 tests), establishing passes for all 63 files / 444 tests across runs. The initial browser run passed 24 of 27; two delivery waits timed out under load and the profile test raced creation. The profile test now waits for the saved editor before editing. Both delivery tests and both settings tests pass on rerun. All 27 browser tests therefore pass across the full run and focused reruns, rather than in one clean run. Logs: `out/r5-unit.log`, `out/r5-unit-rerun.log`, `out/r5-e2e.log`, `out/r5-e2e-rerun.log`.

Two final focused title/overlay checks pass with screenshots retained in `out/ui-audit/round-5/validation/`. The production smoke passes at `out/verify/2026-11-04T13-06-23-250Z-dbe14b90`. The local interactive before/after artifact is `out/ui-audit/comparison.html`; its score chart explicitly rates the earlier audited build, not these subsequent changes.

After incorporating the resumed Claude findings, the full unit run passes in one invocation with two workers: 63 files / 445 tests (`out/r5-combined-unit.log`). The final resource-readiness ordering also passes all 39 tests in the resource, concurrency and delivery files (`out/r5-readiness-unit.log`). The final combined browser and production-smoke results are recorded below once complete.

Final combined validation: build and type-check pass. The 28-test browser run passed 26 and identified the effort-width regression plus the new project selector's helper-text mismatch. The effort correction preserves fixed width and close caret spacing. The focused rerun passed 8 of 9, including effort and all Settings tests; Chromium returned `ERR_NO_BUFFER_SPACE` before the remaining title test loaded. That title test passes in its separate rerun. All 28 browser tests therefore pass across runs (`out/r5-combined-e2e.log`, `out/r5-combined-rerun.log`, `out/r5-final-title.log`). The production smoke plus UI pairing-code copy passes at `out/verify/2026-11-04T13-23-26-429Z-31816742` (`out/r5-combined-verify.log`). These are verification results, not independent scores.
