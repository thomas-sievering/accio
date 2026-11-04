# Scripted Ship

Status: implemented, 2026-11-04 (`apps/worker/src/threads/scriptedShip.ts`). Extends [thread delivery](thread-delivery.md) within [ADR 0015](../adr/0015-threads-own-delivery-with-optional-pull-requests.md).

## Problem

Ship currently starts a full coding-model turn (`deliveryPrompt` in `apps/worker/src/threads/delivery.ts`). The model spends minutes and a share of the user's limit on `git add`, `git fetch`, `git rebase`, `pnpm test` and `git push`. That work is mechanical in the common case. Accio already verifies the result independently afterwards, so the turn adds no trust. It only adds the judgment needed when something goes wrong.

T3 Code shows the other extreme: its Git action runs commit, push and PR creation as server code, with a cheap model writing the messages. It never integrates the base branch or runs tests. Accio should keep its guarantees and drop the turn when nothing needs judgment.

## Decision

On Ship, the worker runs the steps itself. It starts an agent turn only at the first step that needs judgment, and hands over what happened. Verification and observation after publishing stay as they are.

```
commit ─► fetch ─► rebase ─► test ─► push ─► (existing verify / observe)
  │                  │         │       │
  │               conflict   fails   rejected (main moved)
  │                  │         │       └─► back to fetch, at most 3 times
  └──────────────────┴─────────┴──────────► agent turn with deliveryPrompt + detail
```

### Steps

1. **Wait for idle.** A Ship clicked during a turn stays queued, as today. The scripted run starts only when the thread is idle with no queued messages.
2. **Commit.** If the worktree has uncommitted or untracked (non-ignored) files, `git add -A` and commit. The lightweight model already chosen for thread naming (`namingModel` in `naming.ts`) writes the commit message and the shipped note in one call, from the thread transcript and the diff stat. Without a lightweight model, use the thread title as the message and skip the note. Never spend a coding-model turn on this.
3. **Fetch and rebase** onto `origin/<base>`. On conflict, run `git rebase --abort` and hand over with the conflicting file list. Accio never resolves conflicts itself.
4. **Test.** Run the project's **test command** in the worktree, with the same isolated environment previews get (`PORT`, `ACCIO_HOME`, `ACCIO_PORT=0`, `ACCIO_HUB_PORT=0`). The output is not shown in the thread; only a handover uses it. On failure, rerun once (the flaky rule the prompt already states). If it fails again, hand over with the output tail. Skip the run when the rebase didn't change `HEAD` and the tests already passed on this exact revision in this delivery.
5. **Push.** Direct policy: `git push origin HEAD:refs/heads/<base>` without force. If the push is rejected because `main` moved, go back to step 3, at most 3 times in total, then hand over. Any other push error blocks the delivery with the Git message.
6. **Verify.** Call the existing `Deliveries.verify`. Nothing changes from here on.

Each step sets `delivery.step` directly, so the Delivery panel shows the same commit → integrate → verify → publish progress without the `delivery_step` tool.

### Handover

A handover starts the existing delivery turn with `delivery.detail` set to what happened, for example "Rebase onto main conflicted in apps/web/src/threads/ModelPicker.tsx" or "`pnpm test` failed twice on the rebased revision: …". The worktree is left clean on the pre-rebase commit (after the abort), so the agent starts from a known state. The existing prompt already covers conflicts, checking a failure on `main`, retrying and asking the user. The follow-up budget is unchanged.

### When the old path runs

- The project has no test command. Accio cannot run tests on its own, so the agent turn runs as it does today. Ship never publishes untested work.
- **Prepare for review** and the pull-request policy, for the first version. They can use the same steps later (push the branch, `gh pr create` with the generated title and body). Merging stays as it is today.

### Settings

Add one field to the project's delivery settings, next to the preview command: **Test command**, e.g. `pnpm install --frozen-lockfile && pnpm build && pnpm test`. It extends `DeliverySettings` in `packages/protocol/src/projects.ts`. No other UI changes.

### Interruptions

- **Cancel** during a scripted run kills the running step's process tree, aborts an in-progress rebase and leaves the delivery cancelled, as today.
- **Restart** during a scripted run: on startup, abort any in-progress rebase in owned worktrees whose delivery was `running`, then mark the delivery blocked with the existing "request Ship again" message.
- The scripted run holds the thread's lifecycle lock, so sending a message waits for it or is rejected, as during a delivery turn today.

## What this gives up

- **Behavior checks before publishing.** The agent turn can drive the UI after integrating. The scripted path only runs the test command. In practice the implementing turn already checked the behavior before the user clicked Ship. A rebase onto unrelated changes rarely breaks UI behavior that the test suite misses. If that turns out wrong, a project could opt into always handing over.
- **"Finish any remaining implementation."** The scripted path ships what is in the worktree. Clicking Ship means the user considers the work done.

## Code

- New `apps/worker/src/threads/scriptedShip.ts`: the step runner. It takes the workspace, delivery, test command and a `report(step, note)` callback, and returns either `published` or `handover(detail)`. It uses `git()` from `../git.js` and the preview environment builder.
- `Deliveries.dispatch` calls the runner when the policy is direct, the mode is ship and a test command exists. Otherwise it starts the delivery turn as it does now. On `handover`, it sets `detail` and starts the delivery turn. On `published`, it calls `verify`.
- `Naming` gets a second prompt for the commit message and the shipped note, using the same model selection and the same cancellation.

## Tests

Use real temporary Git repositories, as `delivery.test.ts` does.

- Clean path: commit, rebase, passing test command, push lands on the bare origin, then the delivery verifies with no turn started.
- Conflict: hand over with the file list. The worktree is clean at the pre-rebase commit.
- Failing tests: rerun once, then hand over with the output tail. A command that fails once and then passes publishes, and the flaky run is noted.
- Moved base: another clone pushes between test and push, so the runner rebases, tests again and pushes, within 3 attempts.
- No test command: the delivery turn starts, unchanged.
- Cancel and restart during the test step: process killed, no rebase left in progress, delivery blocked or cancelled.
- Browser: `tests/delivery.spec.ts` gets a scripted-path case where the panel shows each step and **Shipped to main** appears without a model turn.

## Open questions

1. Should a project be able to force the agent path, for projects whose tests cannot run on the worker? Proposal: leaving the test command empty already does that.
