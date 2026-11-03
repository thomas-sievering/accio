# Delivery status and automatic settlement

Status: implemented and verified on 2026-11-03. The approved React UI was implemented by Opus 5.5 through Claude HRC.

Give every delivery a visible outcome. A thread awaiting a PR merge should say **Waiting for merge**. A confirmed merge should remain visible in the conversation and sidebar. Successful delivery should automatically move the thread to **Settled**, while retaining its workspace until **Archive**.

This extends [thread delivery](thread-delivery.md) and follows [ADR 0011](../adr/0011-threads-own-delivery-with-optional-pull-requests.md). Direct publication remains the default; PRs remain a project policy or an explicit review action.

## Implementation record

The server now saves PR identity before readiness checks, continues passive observation after review preparation and across restarts, records integration separately from final verification, and auto-settles newly verified deliveries without releasing their workspaces. Delivery IDs, work versions and organization versions fence stale observations. Reopen and stopped follow-ups retain their keep-open choice. Completion receipts are idempotent and recover after a restart. A failed completion-state write does not broadcast or retain automatic settlement.

The sidebar and composer now share a [status resolver](../../apps/web/src/threads/status.ts). Waiting has a static amber mark, completed merges retain a green badge in Settled, and ordinary completed turns say Ready. The selected thread stays selected when its shelf opens after automatic settlement. The delivery receipt exposes Reopen and Archive separately. Blocked and unavailable observations retain their reason or last known fact. Review-only preparation also exposes Stop automatic follow-ups because later check failures can otherwise continue fixes under its original limited grant.

Validation completed:

- The full unit suite passes 360 tests across 59 files, including 25 status-resolver tests. The resolver tests were rerun after the final stop-follow-ups predicate correction.
- `pnpm typecheck` and `pnpm build` pass.
- `pnpm test:chat` passes all eight scenarios present at that run, covering delivery, inline chat and the hidden Electron shell. The final [merge spec](../../tests/delivery-merge.spec.ts), including the additional stop-follow-ups scenario, passes both tests after the final change. Together these cover nine distinct browser/Electron scenarios.
- The isolated production smoke passed with doctor and cleanup evidence in `out/verify/2026-11-03T22-11-16-159Z-1ad1b181`. Its signed-out profile/project coverage is separate from the authenticated harness fixtures.

[Observation tests](../../apps/server/src/threads/deliveryObservation.test.ts) exercise real disposable Git repositories with deterministic hosting responses, including external squash merges after source-branch deletion, pending target checks, long waits, restart recovery, stopped follow-ups, stale results, snoozing and failed persistence. The merge browser tests use the production UI and real Git with injected coding-harness and hosting boundaries. They demonstrate action-to-state transitions, persisted receipts and Reopen, without setting thread state from test endpoints. Screenshots of waiting and merged sidebar/receipt states and stopped follow-ups were inspected. Live GitHub authentication, actual human review and live coding-provider turns remain unverified.

## Accio before this change

Audited Accio at `622051483e02bbf8378ca50f5186a042b975f139`.

1. A new thread in a Git repository with a commit gets a worktree at `<ACCIO_HOME>/workspaces/<thread-id>` and branch `accio/<thread-id>`. It starts from the source checkout's committed `HEAD`. Uncommitted source changes stay in the source checkout. Old threads, ordinary folders and empty repositories keep their original execution arrangement.
2. **Ship** is rendered only when `thread.workspace` exists. A remote is needed to enable it, and a signed-in model account is needed to run it. Being inside a Git project alone does not make an old thread eligible.
3. Clicking Ship records a durable request. If the agent is working, delivery waits for that turn to finish. The request captures the project's current delivery policy and origin's default branch.
4. The agent is instructed to commit intended changes, fetch and integrate the latest target, verify the combined result, then publish. Direct policy uses a normal push to the target branch. PR policy opens or updates a PR and authorizes merging it. **Prepare for review** opens or updates a PR and explicitly forbids merging, enabling auto-merge or entering a merge queue.
5. The machine independently checks the clean owned branch, remote target ancestry and GitHub checks. PR verification also matches the PR's head revision and base, and uses its merge commit for squash/rebase merges. The assistant's success message is insufficient proof.
6. Pending checks/reviews get machine-side checks every 30 seconds. Actionable failures or an authorized merge can continue the owning agent, with at most three continuations within an hour. Waiting survives restart. Review preparation ends at `ready`, and its timer stops.
7. Delivery currently becomes `delivered` without setting `settledAt`. **Archive** rechecks delivery, stops the owned preview, releases the clean owned worktree and branch, then settles. Manual Settle only organizes the list. Sending a new message reopens a settled thread; an archived thread gets a fresh worktree.

Shipping updates origin's target branch. It does not automatically advance the original project checkout, restart the user's app or prove a deployed version is healthy. The preparation/test instructions and integration retries are agent-driven; the current server has per-thread lifecycle coordination, without the project-wide publication coordination described in the ADR.

Relevant source: [worktree allocation, delivery verification and prompt](../../apps/server/src/threads/delivery.ts), [delivery scheduling and lifecycle](../../apps/server/src/threads/threads.ts), [protocol](../../packages/protocol/src/threads.ts), [composer controls](../../apps/web/src/threads/DeliveryActions.tsx), [sidebar status](../../apps/web/src/threads/ThreadRow.tsx), [shelves](../../apps/web/src/threads/shelves.ts).

## Gaps found in the audit

- An idle thread gets the sidebar label **Done** and a green dot even when its delivery is waiting or blocked. Delivery is visible only after opening the thread.
- There is no `waitingOn: 'merge'`. A ready PR in Ship mode is described as continuing delivery; review mode says Ready for review and stops monitoring. An external merge after that point is not automatically detected.
- PR identity is discovered during verification and is not always saved when verification throws a pending result. Repeated branch searches are the current fallback.
- `ready` and `delivered` are not connected to automatic settlement. Successful background verification also produces no durable success notice in the transcript.
- The one-hour automation budget also ends passive observation. A human review that takes a day should not make merge detection expire.
- **Cancel queued delivery** currently clears the delivery record. Stopping agent continuations should preserve any published PR and its observed outcome.

## T3 findings

Source audit of [pingdotgg/t3code at `a10490937dbd8a9e441b0518a77a60117f3ecf5a`](https://github.com/pingdotgg/t3code/tree/a10490937dbd8a9e441b0518a77a60117f3ecf5a), fetched from main on 2026-11-03. This is a source audit; the installed desktop app was not exercised and upstream tests were read, not run.

**Linking a PR establishes durable tracking.** T3 stores normalized PR identities and snapshots, including state, branch names, merge time, review/check state and mergeability. It supports explicit links, branch discovery and discovery of PRs created by shell commands. Its sidebar renders PR/stack badges independently of whether an agent is running. See [PR tools](https://github.com/pingdotgg/t3code/blob/a10490937dbd8a9e441b0518a77a60117f3ecf5a/apps/server/src/mcp/toolkits/pullRequests/tools.ts), [branch discovery](https://github.com/pingdotgg/t3code/blob/a10490937dbd8a9e441b0518a77a60117f3ecf5a/apps/server/src/orchestration-v2/ThreadPullRequestService.ts) and [status indicators](https://github.com/pingdotgg/t3code/blob/a10490937dbd8a9e441b0518a77a60117f3ecf5a/apps/web/src/components/ThreadStatusIndicators.tsx).

**Status synchronization and agent watching are separate services.** [PullRequestSyncReactor](https://github.com/pingdotgg/t3code/blob/a10490937dbd8a9e441b0518a77a60117f3ecf5a/apps/server/src/orchestration-v2/PullRequestSyncReactor.ts) sweeps linked PRs every minute. Open PRs quiet for 30 minutes use a five-minute cadence; other unfinished terminal metadata uses a slower cadence. Explicit refreshes and completed host close/merge commands request a fresh read. Complete merged snapshots stop ordinary polling. [PullRequestWatchReactor](https://github.com/pingdotgg/t3code/blob/a10490937dbd8a9e441b0518a77a60117f3ecf5a/apps/server/src/orchestration-v2/PullRequestWatchReactor.ts) separately handles agent wakeups for checks, comments, reviews and conflicts. Unwatching preserves the PR link and its status tracking.

**Settlement is a server decision with race protection.** [ThreadSettlementService](https://github.com/pingdotgg/t3code/blob/a10490937dbd8a9e441b0518a77a60117f3ecf5a/apps/server/src/orchestration-v2/ThreadSettlementService.ts) reacts to PR updates, merge events and work ending, plus periodic reconciliation. Auto-settle on merge [defaults to true](https://github.com/pingdotgg/t3code/blob/a10490937dbd8a9e441b0518a77a60117f3ecf5a/packages/contracts/src/settings.ts), with project overrides. It waits for active work and pending requests, respects explicit organization choices, and refuses to hide newer user work because an older PR merged. Unknown or still-open outcome links prevent merge-based settlement. A historical PR linked after its completion does not settle the thread. The [orchestrator](https://github.com/pingdotgg/t3code/blob/a10490937dbd8a9e441b0518a77a60117f3ecf5a/apps/server/src/orchestration-v2/Orchestrator.ts) rechecks live state before applying a settlement calculated from a snapshot.

T3 also settles closed PRs and can settle after inactivity. Accio should initially auto-settle successful delivery only. A closed, unmerged PR remains an explicit outcome needing attention. T3 can run configured settle scripts; Accio retains its separate, explicit Archive cleanup contract.

## User experience

Keep the existing shelves. A thread waiting on GitHub stays in the open list with a readable secondary status. The Working shelf continues to mean a running agent turn.

Use the same status resolver for the sidebar and composer. Keep the project visible; show a short delivery label beside or below it, with a linked PR number when available. Use text plus an icon; color is supporting information.

| Condition | Label | Result |
| --- | --- | --- |
| Ordinary work, no delivery requested | Working / Ready | Ready means the turn finished |
| Delivery queued behind work | Ships when done | Durable request remains cancelable |
| Interrupted queued request | Ship paused | Explicit resume remains necessary |
| Delivery agent running | Shipping / Preparing review | Existing turn behavior |
| PR checks pending | Waiting for checks · #123 | Machine observes without starting another agent |
| Required review missing | Waiting for review · #123 | Original merge authorization is unchanged |
| Open, prepared PR awaiting integration | Waiting for merge · #123 | Review-only preparation remains review-only |
| Merge queue or auto-merge awaiting completion | Waiting for merge · #123 | Enabling auto-merge is not confirmation of a merge |
| Host confirms merge; target verification/checks pending | Merged · checking main | Show the merge immediately; retain the open thread until delivery verification passes |
| PR merge and delivery verification complete | Merged into main · #123 | Auto-settle when no newer work or active turn needs the thread |
| Direct push and delivery verification complete | Shipped to main · abc1234 | Same automatic settlement rule |
| Failure requiring intervention | Needs attention · reason | Preserve workspace and expose the relevant retry/PR action |
| PR closed without merge | Closed without merging · #123 | Keep open; never show delivered |
| Provider unavailable or rate limited | Status unavailable · last checked … | Preserve the last known fact; retry observation with backoff |

For review-only requests, show **Waiting for merge** with supporting text **Prepared for review; merge manually** after preparation checks pass. If later checks or review changes need fixes, show that condition and keep the original limited authorization. For Ship with PR policy, the existing authorized merge continuation can run when ready; the status remains truthful while it waits or queues.

Completion writes a durable notice such as **PR #123 merged into main · abc1234. Thread settled; workspace retained.** or **Shipped to main · abc1234. Thread settled; workspace retained.** Include the PR link, revision and time. If settlement is deferred by newer work or an explicit reopen, the notice explains that the thread stays open. Repeated observations do not duplicate notices.

Move the row to Settled without navigating away from the selected conversation. Keep the merged/shipped badge on its settled row and the success receipt above the composer. **Reopen** stays available. **Archive** remains the explicit resource-release action and continues to work from a settled thread.

## State and ownership

Keep four independent facts: turn activity (`ThreadStatus`), delivery (`ThreadDelivery`), list organization (`settledAt`/`snoozedUntil`) and workspace ownership (`ThreadWorkspace`). A merge observer never deletes files or stops previews.

Extend the current delivery model rather than replacing it:

- Give each delivery request a stable ID. Record the work generation it applies to. Increment the generation when genuinely new user work starts; internal delivery continuations retain it. Background results must match both the request ID and generation before changing the current delivery or settling it.
- Retain the existing statuses. Add `merge` to `waitingOn`; use `ready` for completed review preparation and an open PR. Its presentation can say Waiting for merge while passive observation continues.
- Save structured PR identity (`host`, repository and number) plus its URL, head revision, target branch, state, merge commit, merge time and observation time. Save the link before checking readiness, so a pending check does not lose it. The current URL remains compatible with stored records.
- Record integration separately from final delivery verification. This lets a host-confirmed merge show immediately while existing target-branch/check verification is still pending. Direct pushes use a publication receipt with the same target/revision facts and no synthetic PR.
- Persist observation errors separately from publication failures. An authentication outage does not turn a known merge into an open PR or authorize another push.
- Keep the completed receipt in history when later work starts. Manual Reopen suppresses auto-settlement for that completed delivery ID; it must not immediately disappear back into Settled on the next refresh.

Older records get conservative defaults. Resume observation for existing `ready` and `waiting` requests with PRs, discovering and saving a structured link where necessary. Do not bulk-settle historical `delivered` records whose manual organization history is unknown. Newly confirmed completion transitions use the new rule; manual settlement stays available for old deliveries.

## Machine-side observation and settlement

Separate `observeDelivery` from `continueDelivery`. Observation reads Git/GitHub and records facts. Continuation runs the agent with the existing request's authorization. The one-hour/three-continuation budget limits agent execution; it does not expire observation of an open PR or pending publication checks.

For the first implementation, reuse `gh` and the machine server. Observe active waits about every 30 seconds and quiet open PRs every few minutes, with bounded concurrency, shared reads for the same PR and backoff on provider failures. Rebuild scheduling from persisted state on startup. Check-now and reconnect can request a refresh. Webhooks remain a later optimization.

An observer must read the stored PR by identity, so a deleted source branch or squash/rebase merge does not break outcome tracking. Validate its repository and intended base. Keep the verified feature head associated with the request; if the PR head changes, invalidate prior readiness and require fresh verification. A PR retargeted to another branch does not satisfy this delivery. If the owned checkout is missing or unreadable, still record the host's merge fact and report that local delivery verification is unavailable.

Use one completion function from both immediate post-turn verification and background observation. Under the existing thread lifecycle coordination, it must:

1. Re-read the thread and match request ID, work generation and expected revision after network work completes. Discard stale results after cancellation, a replacement delivery, new work or manual organization changes.
2. Persist confirmed integration and any remaining verification wait. A merge can be reported before final delivery success. Continue the existing proof that the merge/published revision reached the intended remote target and that applicable checks passed. Repository policy with no checks remains valid; creating a PR or entering a merge queue is insufficient.
3. When verification succeeds, record `delivered` and settle in the same persisted thread update if the thread has no running/starting turn, queued new user work, pending decision, newer work generation, active snooze or explicit keep-open choice for this delivery. If work is still ending, retry the settlement decision when it ends.
4. Append an idempotent success notice keyed by delivery ID, then broadcast the new thread view. Recover a missing notice or deferred settlement after restart without publishing or invoking the model again. Do not override a later Reopen.

Stopping automated follow-ups keeps the PR link and passive tracking. Before a PR exists, canceling the queued request can still remove that intent. Once publication exists, label the control **Stop automatic follow-ups**, retain the outcome record, and suppress automatic settlement for the stopped request. A background read started before cancellation cannot restore canceled authority. A fresh Ship request is needed to authorize more publication.

First release scope is the one PR already associated with a delivery. PRs created entirely outside Ship/Prepare for review need a later explicit **Link PR** action and thread-scoped `link_pull_request` tool; a pasted historical link must not imply merge authority or trigger settlement. Multiple outcome PRs/stacks require waiting for every relevant outcome, and are outside this first release.

## Implementation order

1. **Protocol and shared presentation.** Add request identity/generation, structured PR observation, merge wait and settlement suppression fields with legacy defaults. Implement a shared status resolver used by `ThreadRow` and `DeliveryActions`. Replace idle Done with Ready and preserve project/PR context. Keep badges visible in Settled.
2. **Durable observation.** Split discovery, host observation and final delivery verification in `delivery.ts`. Save PR identity before readiness evaluation. Move observation scheduling out of the agent retry budget and keep it alive after review mode reaches `ready`. Add restart recovery, backoff and stale-result guards in `threads.ts`; preserve links when follow-ups stop.
3. **Completion and settlement.** Route both verification paths through the shared completion function. Add integration receipts, guarded settle-on-delivery, idempotent transcript notices and manual reopen suppression. Keep Archive's independent verification and ownership checks.
4. **Behavior verification.** Extend the delivery tests with real temporary Git repositories and deterministic hosting responses. Exercise the real UI through the repository verification skill. Update the existing delivery notes to describe the shipped behavior only after those checks pass.

No migration to T3's event store or orchestration framework is needed. A general PR watch/comment service, multi-PR stacks, webhook infrastructure, project-wide publication coordination and updating/deploying the user's running app remain separate work.

## Acceptance criteria

- Visibility covers a new committed Git thread, an old Git thread, an empty repository, a plain folder, missing origin and a signed-out model account.
- A successful direct publication shows Shipped to the correct target, records its revision and settles exactly once without releasing its worktree.
- PR delivery distinguishes pending checks, required review, waiting for merge and a host-confirmed merge whose target checks are still pending.
- Prepare for review reaches Waiting for merge, makes no merge/auto-merge call, and detects a human merge later, including after the app/browser has closed and the machine server restarts.
- An open PR still gets observed after one hour and after agent continuations are exhausted. Stopping automatic follow-ups preserves its link and cannot restart the agent through a stale callback.
- Squash/rebase merges and deleted source branches remain detectable by stored PR identity. A different head, repository or target cannot satisfy an old delivery. Closed-unmerged, stale, missing-check and provider-error responses cannot produce a false success.
- A merge seen during active work records the fact without hiding that work. New work, a newer request, a snooze, a pending decision or manual Reopen wins over a stale observer result.
- Completion is correct through restart windows before/after the thread update and transcript notice: one success receipt, one settlement, no duplicate agent run or publication.
- The sidebar and composer agree in each state. Waiting on GitHub does not imply an agent is Working. Auto-settlement keeps the current conversation selected and exposes the success notice and Reopen action.
- Archive still rejects unpublished work, stops only owned previews, and releases only the thread's verified clean worktree. Settle performs no cleanup; later messages reopen normally.
