# Thread delivery

One compact row above the composer: change counts, **Ship ▾**, and **Open app** when the project has a preview command.

- **Ship** finishes the task, integrates the latest default branch, verifies it and publishes. Clicking during work queues a durable request; **×** cancels that request without stopping the work. A queued request survives disconnects. After a server restart, resume the interrupted work explicitly.
- **Prepare for review** runs the same preparation and opens a PR, without permission to merge. The workspace stays available for review fixes.
- Project settings choose direct publication or a PR for Ship. This applies to new requests; an existing request keeps its recorded policy and target.
- The server verifies the Git revision and GitHub check results independently of the assistant's prose. GitHub verification needs an authenticated `gh` CLI on the execution machine. While waiting, machine-side checks run every 30 seconds; only actionable failures or an authorized merge wake the owning agent, up to three continuations within an hour. Review-only delivery stops watching when its PR is ready. Missing proof or exhausted retries retain the workspace and explain the blocker in the conversation. Waiting state survives server restarts.
- **Archive** becomes available after delivery. It verifies again, stops the owned preview and removes only this thread's clean worktree and matching branch, preserving history. Settle/snooze only organize the list; they do not free resources. New messages in an archived thread provision a fresh worktree from its delivered revision.

New threads in Git repositories with a commit get owned worktrees. Existing threads, ordinary folders and empty repositories retain their original working directories and have no Ship/Archive controls. Original project folders are never deleted. New worktrees start from committed HEAD; uncommitted changes in the source checkout stay there.

Preview commands run in the owned worktree with a separate `PORT`, `ACCIO_HOME`, `ACCIO_PORT` and `ACCIO_HUB_PORT`. `{port}` in the command is substituted; for example `pnpm dev --host 127.0.0.1 --port {port}`. The button opens only after an HTTP service responds. The wrapper stops its child process tree on normal shutdown or IPC disconnection. Only previews started by Accio are managed; unrelated shell commands or externally started services are not registered previews. This first implementation supports local web previews. Protected remote forwarding through the hub remains a later capability; the current product already gates remote thread execution.

## Later: generated replies

The pill to the right of **Open app** in the approved mockup is a **suggested user reply**, not another delivery action. Leave it out of this implementation.

Generate short, context-aware proposed answers with a cheap, fast model such as **Luna or Haiku**, separately from the thread's coding model. Selecting a suggestion should populate the composer for the user to edit and send. Suggestions carry no permission to publish, merge or clean up. Model routing, cancellation/staleness after new messages, cost limits and privacy/profile boundaries need to be specified before implementation.

## Follow-up infrastructure

Protected remote preview forwarding, webhook-based wakeups instead of machine-side GitHub checks, and registration of processes started outside the preview runner remain separate work. Waiting and review readiness continue to retain workspace ownership. The current process tracking must not be described as complete process isolation.
