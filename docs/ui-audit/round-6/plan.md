# Round 6 changes

All three auditors completed the same saved build, commit `037f47b`, with matching manifest hashes. Each report records its exercised and omitted branches; a score is not proof of live/native or screen-reader coverage.

| Category | Sonnet | Opus | GPT Sol |
|---|---:|---:|---:|
| Minimalism / calmness | 9 | 9 | 9 |
| Hierarchy / typography | 9 | 9 | 9 |
| Consistency | 8 | 9 | 9 |
| Clarity / discovery | 8 | 9 | 9 |
| Feedback / state | 9 | 9 | 9 |
| Efficiency / flow | 9 | 9 | 9 |
| Accessibility | 8 | 8 | 9 |
| Layout robustness | 9 | 9 | 9 |
| Forms / dialogs | 9 | 8 | 9 |

## Applied changes

- New profile, account, secret, tool, MCP, skill-source and hub forms register actual unsaved values with the shared leave guard. Blank forms leave without a prompt. Explicit Cancel still discards deliberately. Secret replacement and metadata edits also register their changes.
- Settings waits for the previous pane to release focus, then focuses the originating named row, another available row after deletion, or the first detail field. Limits focuses its named heading. Pairing-code generation restores focus to its button after the temporary disabled state.
- Media Open and Download have file-specific accessible names. Composer failures are status announcements. Only one tooltip is shown at a time, and short unclipped titles do not get redundant tooltips.
- Queue, sidebar hover, thread-menu, Limits and pairing-copy targets are at least 32 px. Pairing copy is a button; Copied clears after two seconds and before another attempt. Clipboard denial gives actionable wording rather than a raw API exception.
- Prior skill-copy success clears before a repeated attempt. A secret with no selected project access says No project access.
- Onboarding Back returns to editing the same profile without creating a duplicate. Invalid Continue focuses the profile input. Thread rename shows its 120-character limit/count.
- Choice focus has an empty ring; the check means selected only. Running activity follows the visible answer consistently before and after steering; completed duration/work disclosure retains its position above the answer.
- Tool deletion explains that threads on every machine lose the tool.

## Verification

Build and type-check pass. All 86 web unit tests pass, including the changed live-transcript grouping. No server code changed this round; the previous full server/workspace run passed 445 tests.

Seven new browser checks prove typed new-form input survives Keep editing and Escape, section/breadcrumb exits prompt, Discard persists nothing, and blank forms leave cleanly. Focus checks cover initial Settings entry from the narrow MCP panel, Limits entry, origin return and new-form navigation. The tooltip test additionally proves focus plus pointer hover never shows two tooltips.

The full browser run passed 34 of 35; the new panel-to-Settings focus check exposed a selector-order bug that preferred the breadcrumb. Splitting the detail-control and breadcrumb fallbacks fixes it. All 13 Settings/panel checks then pass (`out/r6-focus-rerun.log`), so all 35 browser tests pass across the full run and focused rerun. Evidence/logs remain in `out/r6-e2e.log`, `out/r6-focused.log`, `out/r6-title.log` and `out/ui-audit/round-6/validation/`.

The production journey exercises onboarding Back/invalid focus and clipboard denial/success/reset; it passes at `out/verify/2026-11-04T14-04-36-727Z-fb9d5818` (`out/r6-verify.log`). These implementation checks do not replace the next independent ratings.

## Decisions and limits

Keep the explicit Open app action, contextual deletion layouts and Settings-to-Limits return. Do not alternate border visibility on media controls again: visible resting affordances and larger hit areas were requested and independently verified. CI's compact sidebar wording, Settle Undo and native preview acknowledgement remain polish rather than a reason to redesign already high-scoring surfaces.

The auditors force-stopped their fixture servers. Some temporary homes and a preview process could not be attributed safely for deletion/termination; no process was stopped by name or port. Preserve the audit cleanup qualifications. Future audit servers should receive their supported IPC shutdown so owned previews and scratch state can clean up normally.

The local `out/ui-audit/audit-server.mjs` wrapper was proven to send the existing IPC shutdown through a per-port control file, including when the shell closes stdin. The final probe exited with code 0, closed port 47690 and removed its fixture metadata. An earlier owned probe was stopped by verified PID, but automatic approval review blocked deleting its scratch folder (`C:/Users/thoma/AppData/Local/Temp/accio-chat-browser-1aRWc6`, reason: blocked by policy). It and `out/chat-test-47689.json` remain; no probe server is left running.
