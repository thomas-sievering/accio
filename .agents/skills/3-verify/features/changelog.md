# Changelog

Every change delivered on this machine, with its shipped note: what changed and what to try. The delivery turn writes the note through the `shipped_note` accio tool; Accio logs the change once the delivery is verified.

## Entry points

- `changelog-dashboard`: the `Changelog` fold on a project dashboard (project name in a thread header, then `Dashboard`), after Recently shipped. It lists that project's changes only, grouped by day, with a count in its heading.
- `changelog-search`: the `Search changes` box inside the fold, shown once the project has entries. Every word must match the summary, things to try, thread title, target or PR number. Escape clears a query.
- `changelog-open-thread`: each entry is a button opening the thread it came from. Entries whose thread was deleted stay listed but are not buttons.
- `shipped-note-thread`: after a verified delivery, the thread shows a `Merged into …` or `Shipped to …` block as its own turn, with the summary and a `Things to try` list.
- `shipped-note-inbox`: a delivered thread with a note stays at the top of the open list until you open it, then settles. Without a note it settles at once, as before.

## Drive the production instance

Use the isolated runner from [3-verify](../SKILL.md). An empty home cannot open a dashboard; `tests/project-dashboard.spec.ts` proves the fold and its empty state (`Nothing shipped yet.`).

Real entries need a verified delivery: a committed Git project with a remote the run may push to, a signed-in account (the verify device, see [Real model turns](../SKILL.md#real-model-turns)) and Ship. Never write entries or transcripts into storage to call that an end-to-end proof. Then:

1. Before opening the thread, require it at the top of the open list with its delivery status, not on Settled.
2. Open it and require the shipped-note block in the transcript; the thread then moves to Settled.
3. Open the project's dashboard, unfold `Changelog` and require the entry under `Today` with the thread title, summary and things to try. Search for a word from a thing to try, then for something absent.
4. Open another project's dashboard and require the entry absent from its Changelog.
5. Click the entry and require its thread open with the dashboard closed.

## Deterministic regression proof

`apps/worker/src/threads/deliveryObservation.test.ts` drives a direct delivery whose fake harness calls `shipped_note` over MCP: the note reaches the delivery, the transcript and `changelog.list` once, survives restart, and the thread settles only after `threads.readNote`. A second test backfills a delivery verified before the Changelog existed, without adding to its thread. `apps/web/src/changelog/changelog.test.ts` covers the project filter, search and day grouping.
