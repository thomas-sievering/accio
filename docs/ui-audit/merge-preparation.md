# Merge preparation

The user requested merge preparation after six completed audit rounds. Further audits were stopped; the round-7 Claude runs hit rate limits. The all-auditor score threshold was not reached. The latest independent scores and curated screenshots are in [the comparison](comparison.md).

## Integration

Merged `origin/main` at `7b3654b` into `ui_analysis` in `1b15c54`. Resolved overlapping changes in Settings, delivery, thread naming, goals, streamed transcript layout and browser fixtures. Before publication, also integrated `2cdab84` (composer Tab thread cycling) in `97ee87a`, preserving both repair-thread navigation and thread cycling.

- Preserve main's automatic naming, regeneration from both thread menus and clickable title editor. Retain keyboard-visible full-title tooltips and rename length feedback.
- Preserve the Delivery side panel and CI track. Ship opens that panel; choosing a mode only stages it until the main action is pressed.
- Preserve goal continuation metadata, state transitions and dividers while keeping resource preparation before publishing a user message.
- Preserve immediate first-send startup feedback, the machine picker below the composer and messages that remain visible while streaming.
- Retain unsaved-form guards, Settings focus restoration, project navigation and the narrow panel focus boundary. Include main's built-in harness tools and thread naming settings.

## Validation

- Typecheck and production build pass. Vite reports the existing large-bundle advisory.
- Full workspace unit run: **480 tests in 69 files pass** (`out/merge-unit.log`, two workers).
- Full browser run: **40 tests pass in one invocation**, including targeted Electron journeys (`out/merge-e2e-final.log`). The first integration run passed 37/40: it caught a stale focus rule shrinking main's new 54 px sidebar rows to 44 px, plus two selectors that also matched the new clickable header title. Removed the stale rule, scoped those selectors to the sidebar, rebuilt and reran all 40 successfully. The original failure log remains at `out/merge-e2e.log`.
- Production smoke plus onboarding Back/invalid-field focus and clipboard denial/success/reset pass at `out/verify/2026-11-04T14-39-48-830Z-44159872` (`out/merge-verify.log`), after application change `32be6f4` and before the later composer integration. Server exit, port closure and scratch cleanup all passed.
- After the final composer integration: typecheck, build and all **95 web unit tests** pass (`out/merge-publish-unit.log`, `out/merge-publish-build.log`); all **13 affected browser tests** pass (`out/merge-publish-e2e.log`).
- `git diff --check` passes. Four curated PNGs are versioned; full local audit evidence remains ignored under `out/`.

## Coverage and outstanding polish

Round 6 independently scored build `037f47b`. GPT Sol rated every category 9; Sonnet retained 8 for Consistency, Clarity and Accessibility; Opus retained 8 for Accessibility and Forms. Subsequent fixes address their concrete findings, but neither those fixes nor this main integration have final independent ratings.

Live provider authentication/model turns, real GitHub/CI, exhaustive screen-reader coverage and native OS integration are outside the independent audit evidence. Browser fixture suites explicitly substitute provider/hosting boundaries; their targeted Electron journeys do not establish complete native coverage.

Compact CI wording, Settle Undo and preview acknowledgement remain optional polish. Previous force-stopped audits left some scratch state; an earlier automatic approval review blocked removal of one stopped probe's temporary folder. No unknown process was terminated or scratch directory deleted during merge preparation.

Automatic approval review initially rejected writing a temporary PR description, with only “blocked by policy” as its reason. After the user explicitly requested commit, push and merge, preparation resumed and the PR description was written successfully.
