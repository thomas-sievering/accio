# Round 4 changes

Consolidated from the three reports in this directory. All changes remain on `ui_analysis`.

| Category | Sonnet | Opus | GPT Sol |
|---|---:|---:|---:|
| Minimalism / calmness | 9 | 8 | 9 |
| Visual hierarchy & typography | 9 | 8 | 8 |
| Consistency | 8 | 8 | 9 |
| Clarity & discoverability | 8 | 8 | 8 |
| Feedback & state | 9 | 9 | 9 |
| Efficiency & flow | 9 | 9 | 8 |
| Accessibility | 8 | 8 | 8 |
| Layout robustness | 8 | 8 | 8 |
| Forms & dialogs | 8 | 8 | 9 |

## Applied changes

- Restore padding to the onboarding project sheet by restricting inline-form CSS to its step container. Simplify the sign-in step and show an empty-thread state after project setup.
- Route project shortcuts to the Settings project page and remove the separate project editor dialog.
- Guard dirty Settings editors when leaving through section navigation, breadcrumbs, Back, Escape or Limits. Offer Keep editing and Discard; Escape retains edits and returns focus to Save.
- Standardize destructive confirmations, compact the profile editor, reduce repeated helper text, and condition account-limit explanations on available data.
- Give effort and media actions a visible resting affordance. Use empty choice rings until interaction or selection, emphasize queue Save, simplify CI labels, and align notices with transcript captions.
- Deduplicate equal skill origin/source labels. Add Limits to Settings and expose the existing repair-thread action beside a blocked send.
- Include the sidebar resizer in the narrow overlay's inert boundary. Keep complete saved thread titles in the existing tooltip rather than growing focused rows and shifting their neighbors.
- Use Stop automatic fixes for the review action, since PR observation continues. Keep PR identity and observation controls visible afterward.

## Validation

Type-check and build pass; 63 unit-test files / 444 tests pass. All 23 browser tests pass after aligning two assertions with intended wording and skill-label deduplication. The production-server verification smoke passes at `out/verify/2026-11-04T11-53-24-384Z-691b152f`.

The fixture browser suites substitute provider/hosting boundaries; they do not establish live authentication, live provider turns or native OS integration. The optional resources journey remains unverified. The next independent round must score the built result on observed behavior; these changes do not establish a score of 9.

The focused resume check caught a new guard regression: React reused Keep editing as the submit button during its click, saving the edit. Separate keyed action groups fix it. `tests/settings.spec.ts` covers Escape, Keep editing, guarded Limits navigation, Discard and reopening the unchanged saved profile. The isolated check passes; evidence from the additional 900×700 journey is in `out/ui-audit/round-4/resume/`.

Final resume verification: all 24 browser tests pass (`out/r4-final-e2e.log`), type-check passes, and the production smoke passes again at `out/verify/2026-11-04T12-30-41-870Z-88a22419`. The encoding scan found no invalid UTF-8, NUL or backspace bytes in changed files.
