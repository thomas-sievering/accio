# Round 5 changes

GPT Sol scored seven categories 9, with Clarity and Accessibility 8. Sonnet and Opus both stopped at provider rate limits and produced no round-5 scores. Their missing reviews cannot be counted as passes.

## Applied fixes

1. Full saved thread titles now appear in a wrapping tooltip on keyboard focus and pointer hover. The tooltip is portalled outside the sidebar scroll clip, dismisses on Escape/blur/scroll, and leaves row geometry unchanged. Effort uses the same visible focus tooltip to identify Auto/High.
2. Narrow side panels wrap Tab and Shift+Tab between visible enabled panel controls and the close toggle, eliminating the blank BODY stop. Open dialogs/popovers keep their own focus behavior, and Settings releases the panel's focus boundary.
3. Separate the blocked-send message from Open repair thread with an explicit space.
4. Remember the originating Settings route when opening Limits there; Close returns to that page and focuses its Limits entry. Global Limits retains its thread return.

## Evidence and checks

The independent report and 161 numbered screenshots describe commit `31733b4`, before these fixes. Its two fresh-home onboarding journeys passed. Live-provider, native, screen-reader and omitted fixture coverage remain as listed in `gpt-sol.md`.

New browser checks cover actual Tab entry into a renamed long-title row, full tooltip text in the viewport, stable row height, Escape/focus retention, effort menu entry, 40 forward/reverse overlay Tab steps, releasing the boundary in Settings, and Settings/global Limits return destinations.

The first focused run caught a remaining 44→49 px row expansion from an old focus-only CSS rule. Removing that rule keeps the new tooltip from moving neighbors; the corrected title test passes. Settings and overlay focused checks also pass.

Final validation: type-check and build pass. The initial unit run passed 51 files but timed out in 12; all 12 pass with two workers (87 tests), establishing passes for all 63 files / 444 tests across runs. The initial browser run passed 24 of 27; two delivery waits timed out under load and the profile test raced creation. The profile test now waits for the saved editor before editing. Both delivery tests and both settings tests pass on rerun. All 27 browser tests therefore pass across the full run and focused reruns, rather than in one clean run. Logs: `out/r5-unit.log`, `out/r5-unit-rerun.log`, `out/r5-e2e.log`, `out/r5-e2e-rerun.log`.

Two final focused title/overlay checks pass with screenshots retained in `out/ui-audit/round-5/validation/`. The production smoke passes at `out/verify/2026-11-04T13-06-23-250Z-dbe14b90`. The local interactive before/after artifact is `out/ui-audit/comparison.html`; its score chart explicitly rates the earlier audited build, not these subsequent changes.
