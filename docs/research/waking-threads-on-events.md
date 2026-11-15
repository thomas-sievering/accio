# Waking a thread on events

Researched 2026-11-15 for issue #177's coordinator thread. This is a research note; nothing here is implemented.

**Question.** How can a thread wait for, or be woken by, events without staying in a turn? The events in question:

- a started thread finishes,
- a pull request opens or merges,
- CI finishes,
- a background command exits.

**Sources.**

- **Accio** at `a3f6e90`. Paths are relative to the repo root.
- **T3 Code** `origin/main` at [`834eb51301`](https://github.com/pingdotgg/t3code/commit/834eb51301) (2026-11-15). In the links below, `ov2/` means `apps/server/src/orchestration-v2/`.
- **Claude Agent SDK 0.3.317** (Claude Code 2.1.317), the version pinned in `pnpm-lock.yaml`. Its type files are cited as `sdk.d.ts` and `sdk-tools.d.ts`. Docs come from `code.claude.com/docs/en/*`, and the changelog is `anthropics/claude-code` `CHANGELOG.md`.

**Requirement.** The solution must not depend on one harness. It goes through accio's own MCP server (ADR 0011): one `accioTool` that Claude Code sees as `mcp__accio__wait_for` and Codex as `accio/wait_for`, with all the watching done by the accio worker. Harness features (Claude Code's background tasks, Monitor, Cron, ScheduleWakeup; Codex background terminals) are only compared, not built on.

## Summary

- **Why background commands die.** Accio ends the harness process at the end of every turn, so anything the harness started in the background dies with it. Nothing in the worker or hub reacts to *another* thread's progress.
- **What Accio can already wake for.** Accio already starts turns with nobody present, through three paths: queued messages, goal continuation and delivery follow-ups, all in `Turns.dispatchPending`. It also has a cross-machine way to queue a message to any thread (`threads.send` over the relay), and every machine already receives other machines' thread status and delivery/PR state in relay snapshots.
- **What is missing.** A durable record of *what a thread is waiting for*, and a watcher that turns a met condition into a queued message.
- **Recommendation.** Add a **Wait**: an accio tool `wait_for` that records conditions on the calling thread and ends the turn. The worker that owns the thread watches the conditions and, when one is met, queues a message that starts the next turn. Build it with started-thread conditions first, then PR/CI, then timers, then commands run by Accio.
- **Not recommended for now.** Keeping Claude Code alive between turns, as T3 does. It is Claude-only, costly, and fights ADR 0011 and the turn model.

## 1. Accio today

### Why background commands die

The Claude harness creates a new `query()` every turn, resuming the saved session. When the `result` for the newest input arrives, it returns, and its `finally` closes the query:

```ts
// apps/worker/src/threads/claudeCode.ts:127-134
input.close(); … q.close(); await q.return();
```

`Query.close()` "terminate[s] the underlying process" (`sdk.d.ts:3354-3361`), and "background tasks are automatically cleaned up when Claude Code exits" ([interactive-mode](https://code.claude.com/docs/en/interactive-mode.md#how-backgrounding-works)).

The next turn resumes the session in a fresh process. On resume, Claude Code closes each task left behind by the earlier process with a `task_notification` of status `stopped`. That is the "didn't finish before the previous session ended" notice the coordinator saw.

- Accio already skips the empty `result` that answers such a notice (`claudeCode.ts:109-111`).
- Accio handles no other `task_*` system message; `transcript.ts:76-78` reads only `system/init`.

Codex ends the same way: `await client.close()` at the end of every turn (`apps/worker/src/threads/codex.ts:155`).

Accio already admits this limit in its built-in tool defaults (`apps/worker/src/harnesses/builtinTools.ts:32-34`):

- `Monitor` is off.
- `CronCreate` is off: "Never fire: accio closes Claude Code after each turn."
- `ScheduleWakeup` is off: "Paces /loop, which accio does not run."

### Turns that start with nobody present

`Turns.dispatchPending` (`apps/worker/src/threads/turns.ts:128-133`) runs three steps in a fixed order: a queued message, then the goal, then a queued delivery. Each step bails out if the thread is busy.

**When it runs:**

- after a turn that ends `completed` (`turns.ts:353-356`),
- after a lifecycle action leaves the thread idle (`threads.ts:578-585`),
- after the queue is edited (`threads.ts:294`).

A failed or interrupted turn does not dispatch.

**Delivery follow-ups.** These are the only timer-driven wakes:

- **Timer.** Each one is an in-memory `setTimeout` per thread (`apps/worker/src/threads/deliveries.ts:36`) that calls `timer.unref()`.
- **Cadence.** 30 s, or 2 min when quiet, backing off to 15 min after failures (`deliveries.ts:245-266`).
- **Restart.** Timers are re-armed at startup from the persisted `delivery.status` (`deliveries.ts:59-67`).
- **Work per tick.** Each tick reads the PR through `gh`, including `state`, `mergedAt`, `statusCheckRollup`, `reviewDecision` and `mergeable` (`apps/worker/src/threads/delivery.ts:30`). It starts a turn only when there is something to act on (`deliveries.ts:~344-367`): "No model is held open while the host is waiting."
- **Coverage.** It only observes deliveries started by Ship. A PR the agent opens with `gh` on its own is not watched.

### Queued messages

Queued messages live on `thread.queuedMessages` and are persisted with the thread (`threads.ts:558-566`).

- **Only entry point.** The RPC `threads.send` with `mode: 'queue'` (`threads.ts:253-277`).
- **Idle thread.** `send` starts a turn at once.
- **Running thread.** The message is queued, and `dispatchPending` picks it up when the turn ends.

There is no public `enqueue`. The existing seam is the in-process router, which is the pattern `start_thread` and `read_thread` already use:

```ts
router.handle({ id: 0, method: 'threads.send', params: { threadId, text, mode: 'queue' } })
```

`router.handle` forwards to `relay.forward` for threads on other machines (`apps/worker/src/rpc/router.ts:30-44`, `apps/worker/src/relay/relay.ts:120-139`). `threads.send` is a relayed method (`packages/protocol/src/relay.ts:54`). The relay rejects the call when the owning machine is offline (`relay.ts:132`).

### Started threads and `read_thread`

**`start_thread`** (`apps/worker/src/threads/startThread.ts:28-48`) calls `threads.start` and returns only a string with the new thread's title and id.

- `threads.start` has no parent field (`packages/protocol/src/threads.ts:253-258`), and nothing records who started a thread.
- The GLOSSARY says: "The starting thread does not wait for it."

**`read_thread`** (`apps/worker/src/threads/handoff.ts:106-128`) returns a page of the transcript, relayed through `threads.transcript`. It does not return the thread's status or delivery state.

### Signals that already exist

- **Thread status.** `ThreadStatus = 'idle' | 'running' | 'interrupted' | 'failed'` (`packages/protocol/src/threads.ts:199`). Delivery has its own status, plus `pullRequestUrl` and `pullRequest` (`threads.ts:109-115`).
- **Change broadcast.** Every `state.update` broadcasts `threads.changed`, and the relay pushes a debounced `relay.snapshot` of all local `ThreadView`s to the other machines (`relay.ts:97-101`, stored at `:284`).
- **Cross-machine view.** Any machine can therefore see a remote thread move from `running` to `idle`, or its delivery gain a PR or become `delivered`, by diffing `relay.merged()`. No code does this yet.
- **`onWorkFinished`** (`turns.ts:350`). This is a single callback for completed work turns, used today for title refinement. It is not a subscription.

## 2. T3 Code

T3 has gone furthest down the "keep the harness alive" road. It also already has the pieces of a Wait.

- **Claude query kept open.** T3 keeps one Claude `query()` open in streaming-input mode. Its prompt is an unbounded queue turned into an `AsyncIterable` ([ClaudeAdapterV2.ts#L1447](https://github.com/pingdotgg/t3code/blob/834eb51301/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L1447)). Background tasks therefore survive the end of a turn.
- **Wake turns.** Frames that arrive after a `result` are buffered as a *wake turn*: "Background local_bash tasks can trigger wake turns on the query stream with no active provider turn" ([#L5843](https://github.com/pingdotgg/t3code/blob/834eb51301/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L5843)).
  - Monitor wakes arrive "with a bare turn and no task_notification frame" and have to be inferred ([#L5996](https://github.com/pingdotgg/t3code/blob/834eb51301/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L5996)).
  - `ScheduleWakeup` keeps the thread Working ([458a792](https://github.com/pingdotgg/t3code/commit/458a79208752696b8ccbb7031a2e8e5d10ffbcd1), 2026-11-11).
  - The adapter is about 14k lines, and much of it handles these edge cases.
- **`t3_background_wait` MCP tool.** The agent declares that it is waiting on background work, and the thread stays Working ([mcp/toolkits/orchestrator/tools.ts#L146](https://github.com/pingdotgg/t3code/blob/834eb51301/apps/server/src/mcp/toolkits/orchestrator/tools.ts#L146)). The tool is Claude/OpenCode only.
- **Codex: no exit event.** T3's Codex adapter only lists or terminates background terminals and gets no exit event ([CodexAdapterV2.ts#L2786](https://github.com/pingdotgg/t3code/blob/834eb51301/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L2786)). On Codex, a finished background command wakes nothing.
- **Delegated tasks wake the parent.** `delegate_task`, `task_status` and `task_cancel` ([tools.ts#L89](https://github.com/pingdotgg/t3code/blob/834eb51301/apps/server/src/mcp/toolkits/orchestrator/tools.ts#L89); [8b460a3](https://github.com/pingdotgg/t3code/commit/8b460a3c851d629df896f7420aa32eb32df1daca), 2026-10-14) start child threads.
  - When a child reaches a terminal state, `ProviderContinuationService` queues a synthetic message to the parent: "Delegated task X reached a terminal state. Use task_status with taskId X to read the result." ([ov2/ProviderContinuationService.ts#L20](https://github.com/pingdotgg/t3code/blob/834eb51301/apps/server/src/orchestration-v2/ProviderContinuationService.ts#L20)).
  - Retries back off up to 5 s.
  - The Codex adapter also wakes an idle parent for direct children only ([CodexAdapterV2.ts#L6940](https://github.com/pingdotgg/t3code/blob/834eb51301/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L6940)).
- **`PullRequestWatchReactor`** ([18b2132](https://github.com/pingdotgg/t3code/commit/18b21325c3ab1ff4f0ee7b017d9c4eefc2b2d307), 2026-10-03): "agents can watch a PR and get woken when checks, reviews, or conflicts need them."
  - **Agent tools.** `link_pull_request` and related tools.
  - **Polling.** It sweeps every 2 min, re-reads quiet PRs every 10 min and fingerprinted ones every 30, with at most 4 reads in flight ([ov2/PullRequestWatchReactor.ts#L48](https://github.com/pingdotgg/t3code/blob/834eb51301/apps/server/src/orchestration-v2/PullRequestWatchReactor.ts#L48)).
  - **Wake rules.** It merges news into one wake per thread. A run of comment-only wakes is capped at 10 to stop bot loops. It tells the agent when no checks have reported after 15 min ([ov2/pullRequestWatch.ts#L10](https://github.com/pingdotgg/t3code/blob/834eb51301/apps/server/src/orchestration-v2/pullRequestWatch.ts#L10)).
- **Scheduled tasks** (`apps/server/src/scheduledTasks/`; [contracts/scheduledTask.ts#L29](https://github.com/pingdotgg/t3code/blob/834eb51301/packages/contracts/src/scheduledTask.ts#L29)). These are server-owned, not harness-owned.
  - Kinds: `interval`, `fixed_time`, `once` and `webhook`.
  - Thread modes: `new_thread`, `continue` and `fresh_session`.
- **Notifications** ([ThreadNotificationCoordinator.tsx#L61](https://github.com/pingdotgg/t3code/blob/834eb51301/apps/web/src/components/ThreadNotificationCoordinator.tsx#L61); [0e0ddae](https://github.com/pingdotgg/t3code/commit/0e0ddaeedf30698bec131caf040a8e8d7b2e3f37), 2026-09-12). These are desktop and web alerts on status changes, for the user and not the agent.

**What to take from T3.** Delegation, PR watching and schedules all end in the same act: the server queues a continuation message to a thread. Only the Claude background-task path depends on the harness process staying alive.

## 3. Claude Code and the Agent SDK

- **Background task messages.** Background Bash, Monitor and background subagents report through system messages:
  - `task_started`, `task_progress` and `task_updated`;
  - `task_notification`, with status `completed`, `failed` or `stopped` (`sdk.d.ts:6386`);
  - `background_tasks_changed`, the full live set (`sdk.d.ts:3833`).

  ([typescript reference](https://code.claude.com/docs/en/agent-sdk/typescript.md))
- **Automatic wake while the process lives.** A finished task can start a turn by itself when it lands on an idle session. That turn has `origin.kind === 'task-notification'`, a "synthetic turn injected for a delivery that arrives without a fresh user prompt, such as a finished background task" (typescript.md, SDKMessageOrigin). This only happens while the process is alive. Streaming input mode is required for the `Query` control methods (`sdk.d.ts:2955-2958`) and for queueing ([streaming-vs-single-mode](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode.md)).
- **Time limits on background Bash.** In SDK sessions the default is 30 min and the maximum is 2 h (`sdk-tools.d.ts:831`; [tools-reference](https://code.claude.com/docs/en/tools-reference.md#time-limit-for-background-commands)). So even a live process won't wait for hours on one command.
- **Monitor limits.** 5 min by default, 30 min at most; one notice at the deadline lets the agent re-arm it (tools-reference.md#monitor-tool).
- **Scheduling.** `CronCreate`, `ScheduleWakeup` (60–3600 s) and `/loop` "only fire while Claude Code is running and idle… No catch-up for missed fires" ([scheduled-tasks](https://code.claude.com/docs/en/scheduled-tasks.md)). `CronCreate` with `durable: true` is saved to `.claude/scheduled_tasks.json`, but it still fires only from a running process.
- **Hooks.** No hook fires on a background task starting or finishing. `TaskCreated` and `TaskCompleted` belong to the todo tool ([hooks](https://code.claude.com/docs/en/hooks.md)). A `Stop` hook can block in order to continue, capped at 8 blocks in a row, and it sees `background_tasks` and `session_crons` (`sdk.d.ts:10086-10110`). That keeps a turn alive; it does not wake an idle one.
- **Durable schedules.** Durable scheduling lives outside the process: cloud routines (minimum interval 1 h), Desktop tasks, or a host that runs prompts itself and marks them with `CLAUDE_CODE_HOST_SCHEDULED_RUN=1` (typescript.md, "Declare a scheduled run"; [routines](https://code.claude.com/docs/en/routines.md)). The SDK's own answer to durable wakes is therefore *the host schedules turns*, which is option B or D below.

## 4. Options

Every option ends by queuing a message through the `threads.send` seam, so `dispatchPending` and the glossary's Queued message stay the single way a turn starts on its own. The options differ in what they watch, and in who declares the watch.

### A. Started threads report back to the starting thread

`start_thread` records the starting thread on the new one (`startedBy: { threadId, machineId }`). When the started thread ends a turn, or its delivery gains a PR or reaches `delivered` or `blocked`, its worker queues a short report to the starting thread: "Started thread X is idle (PR #N open). Read it with read_thread."

- **Owner.** `threads/startThread.ts` records the link. A hook on the end of a turn (beside `onWorkFinished` in `turns.ts`) and on delivery status changes (`deliveries.ts`) sends the report.
- **ADRs and glossary.** Changes "The starting thread does not wait for it." ADR 0009 is unaffected: workers do it all. It needs no new term, only an amended Started thread entry.
- **Across machines.** The child's worker calls `threads.send` on the parent. Over the relay this fails while the parent's machine is offline, so it needs a retry (an outbox) or a catch-up step when the machine reconnects.
- **Cost.** Small. However, every turn of the child pings the parent, including when the user chats with the child directly. That is noisy, and the parent can't say which events it cares about. It covers only the first of the four event kinds.

### B. A Wait: `wait_for` ends the turn and the worker wakes the thread (recommended)

The thread calls the accio tool `wait_for` with one or more conditions and a note to itself, then ends its turn. The worker stores the conditions on the thread (`thread.wait`), watches them, and on the first match (or all, by choice) queues a message describing what happened. The thread can then call `wait_for` again for the next wave.

**Conditions:**

| Kind | Met when | Watched through |
| --- | --- | --- |
| `thread` (id or handle, state `idle`/`settled`/`pr_open`/`delivered`/`any_stop`) | the started thread reaches it | relay snapshots / local `threads.changed`; no polling |
| `pull_request` (URL or number, `open`/`merged`/`closed`/`checks_done`) | GitHub says so | the `gh` PR reader in `delivery.ts`, on the delivery cadence |
| `after` (duration or time) | the time passes | a persisted deadline with an unref'd timer, like delivery |
| `command` (shell command in the thread's checkout) | it exits | the worker runs it as an owned process (ADR 0015) and keeps the output tail |

- **Owner.** A new `apps/worker/src/threads/waits.ts`:
  - It owns the condition model, the watcher and re-arming at startup, as `Deliveries.resumeObservation` does.
  - The tool goes in the `AccioTools` registration (`hub/connections.ts`).
  - When a wait is met, the module enqueues the wake message and calls `dispatchPending`.
  - `continueGoal` skips threads that are waiting, so a goal pauses on a Wait and doesn't spend turns.
- **ADRs and glossary.**
  - **ADR 0011.** One tool serves both harnesses, so Codex gets the same behaviour.
  - **ADR 0009.** The hub stays a relay.
  - **ADR 0015.** Accio owns the processes run by `command` waits, and they show up as owned execution resources.
  - **New term: Wait.** "What a thread waits for between turns, set by its harness through the wait_for accio tool: started threads reaching a state, a pull request opening, merging or finishing its checks, a time, or a command accio runs exiting. accio starts the thread's next turn when it is met, with what happened. You can talk to the thread meanwhile; a bar above the composer shows the Wait and can cancel it." _Avoid_: Subscription, watch, trigger, wakeup, sleep.
  - **Glossary amendments.** Turn gains "or a Wait being met" among what starts a turn. Started thread gains "unless it waits for it".
- **Across machines.**
  - **Where it runs.** The waiting thread's own machine watches its Wait.
  - **Thread conditions.** These read the same `ThreadView` (status, `delivery.pullRequest`) that relay snapshots already bring from other machines, so they need no new relay method.
  - **PR conditions.** These need `gh` on the waiting machine. That already holds for any machine with a checkout.
  - **Offline machine.** If the waiting machine is offline, nothing fires until it reconnects. It then evaluates the Wait against the fresh snapshot, because the condition is a state, not an event that could be missed.
  - **Commands.** These run on the waiting thread's machine, in its checkout.
- **Cost.** Medium.
  - One durable field, one module, one tool and a composer bar.
  - It spends one turn per wake, and no model is held open while waiting.
  - PR polling adds `gh` calls. Waits and deliveries on the same repository should share one read per tick, following T3's batching and anti-loop caps.
  - Command waits need process-group cleanup on Settle (ADR 0015).

### C. Keep Claude Code alive between turns

Hold one streaming `query()` per thread, as T3 does. Turn its `task-notification` turns, and Monitor and ScheduleWakeup wakes, into Accio turns. Switch Monitor, Cron and ScheduleWakeup back on.

- **Owner.** `threads/claudeCode.ts` plus `turns.ts`, which would have to accept a turn started by the harness.
- **ADRs and glossary.**
  - It strains ADR 0011, whose per-turn bearer token expires when the turn ends. A wake turn started by the harness would have no valid token, so tools would need tokens that live as long as the session.
  - It strains ADR 0017: a handoff must end the live process, together with its tasks.
  - The Turn definition would gain "or the harness itself".
- **Across machines.** Purely local. A worker restart or app update kills everything, and Claude Code recovers nothing. Only the "stopped" notice survives.
- **Cost.** High, and limited.
  - It is Claude-only: Codex app-server has no exit event for background terminals, as T3's adapter shows.
  - Each idle thread keeps a Claude Code process.
  - Background Bash is capped at 2 h in SDK sessions, and Monitor at 30 min.
  - T3 needed a large share of a 14k-line adapter for its edge cases.
  - It does not, by itself, let a thread wait for another *thread*.

### D. Scheduled wakeups only

The accio tool `wake_me(after, note)`, or the host-side `CLAUDE_CODE_HOST_SCHEDULED_RUN` pattern: the worker starts the thread's next turn at a time, and the agent polls `gh` and `read_thread` itself.

- **Owner.** `threads/waits.ts`, or a smaller `threads/wakeups.ts`.
- **ADRs and glossary.** It fits everything above. The term would be the `after` kind of a Wait.
- **Across machines.** Local timer; it survives restarts if it is persisted.
- **Cost.** Smallest to build. Every tick is a model turn, however, even when nothing has changed: token cost grows with how long the wait is divided by the interval. Latency is a full interval. It is a good fallback, but it shouldn't be the main mechanism.

### Comparison

| | Events covered | Harnesses | Survives restart | Turns spent | Build cost |
| --- | --- | --- | --- | --- | --- |
| A. Report back | started threads | both | needs outbox | one per child turn (noisy) | small |
| **B. Wait** | threads, PRs/CI, time, commands | both | yes (state-based) | one per met wait | medium |
| C. Live process | background commands, Monitor, cron | Claude only | no | one per wake | high |
| D. Timers | anything, by polling | both | yes | one per tick | smallest |

## 5. Recommendation

Build **B, the Wait**, in slices. Each slice is useful by itself:

1. **`thread` conditions.**
   - Record `startedBy` on started threads, so `wait_for` can default to "all threads I started and haven't seen finish".
   - Watch through relay snapshots.
   - Add the Wait bar and cancelling it.
   - This alone unblocks the #177 coordinator.
2. **`pull_request` conditions.** Reuse the delivery PR reader and its cadence.
3. **`after`**, which also covers D.
4. **`command` conditions.** Accio runs the command as an owned process. This replaces `run_in_background` polling for both harnesses.

Every slice is the same accio tool on both harnesses, and the worker does every check itself: snapshots, `gh`, timers and the processes it owns. No slice reads a harness's own task or schedule messages, so a thread keeps its Wait across a handoff (ADR 0017) and behaves the same on Claude Code and Codex.

Drop option C: it is Claude Code-only. Keep Monitor, Cron and ScheduleWakeup off. Accio's shared system prompt should tell every harness to use `wait_for`, not its own background commands, for any wait that outlasts a turn.

## Open questions

- Should `wait_for` end the turn itself, for example by having the tool's result tell the harness to stop, or only record the Wait and rely on the harness ending its turn? T3's `t3_background_wait` relies on the system prompt.
- Does Codex app-server keep unified-exec sessions across `thread/resume`? This was not checked. Even if it does, closing the client ends them.
- Should a message from the user cancel a Wait, or keep it, with the wake message queued behind the user's turn? Keeping it seems right for a coordinator.
