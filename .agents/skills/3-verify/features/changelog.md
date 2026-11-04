# Changelog

Every change delivered on this machine, with its shipped note: what changed and what to try. The delivery turn writes the note through the `shipped_note` accio tool; Accio logs the change once the delivery is verified.

## Entry points

- `changelog-sidebar`: sidebar footer button `Changelog`, between Settings and Limits. It covers the main pane like Limits; opening a thread or draft, Close or Escape leaves it.
- `changelog-crumb`: the project name in a thread or draft header opens a menu: `Open in Explorer` (desktop app on its own server only), `Changelog` and `Project settings`. `Changelog` shows that project's changes only, with the project named in the header, whatever the sidebar filters.
- `changelog-search`: the `Search changes` box in its header. Every word must match the summary, things to try, thread title, target or PR number. Escape clears a query, then closes.
- `changelog-open-thread`: each entry is a button opening the thread it came from. Entries whose thread was deleted stay listed but are not buttons.
- `shipped-note-thread`: after a verified delivery, the thread shows a `Merged into …` or `Shipped to …` block as its own turn, with the summary and a `Things to try` list.
- `shipped-note-inbox`: a delivered thread with a note stays at the top of the open list until you open it, then settles. Without a note it settles at once, as before.

## Drive the production instance

Use the isolated runner from [3-verify](../SKILL.md). An empty home proves only the entry, empty state (`Nothing shipped yet.`), search empty state (`No changes found.`) and Escape/Close.

Real entries need a verified delivery: a committed Git project with a remote the run may push to, a signed-in account (the verify device, see [Real model turns](../SKILL.md#real-model-turns)) and Ship. Never write entries or transcripts into storage to call that an end-to-end proof. Then:

1. Before opening the thread, require it at the top of the open list with its delivery status, not on Settled.
2. Open it and require the shipped-note block in the transcript; the thread then moves to Settled.
3. Open `Changelog` and require the entry under `Today` with the project, thread title, summary and things to try. Search for a word from a thing to try, then for something absent.
4. Narrow the sidebar to another project and require the entry hidden; clear the filter.
5. Click the entry and require its thread open with the Changelog closed.

## Deterministic regression proof

`apps/worker/src/threads/deliveryObservation.test.ts` drives a direct delivery whose fake harness calls `shipped_note` over MCP: the note reaches the delivery, the transcript and `changelog.list` once, survives restart, and the thread settles only after `threads.readNote`. A second test backfills a delivery verified before the Changelog existed, without adding to its thread. `apps/web/src/changelog/changelog.test.ts` covers scope, search and day grouping.
