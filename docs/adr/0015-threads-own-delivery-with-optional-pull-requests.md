# Threads own delivery; pull requests are optional

Accepted design direction on 2026-11-03. The first local implementation and its remaining gaps are recorded in [thread delivery](../plans/thread-delivery.md). This ADR does not change the Git workflow of the tools developing accio.

## Context

Accio's development exposed gaps between implementation, integration, running the result and cleanup. Different threads performed those steps independently. This caused conflicting changes, stale app instances, port collisions and deletion of a checkout that another open thread still needed. A clean working tree and a merged branch did not establish that a checkout was unused.

Requiring a pull request for every change would preserve those handoffs. Accio should carry work from a request through to a usable result, including evidence that it works and recovery when it does not.

## Decision

### The thread owns delivery

A thread stays responsible for the requested outcome through implementation, verification, integration and checking the delivered result. Its history retains the intent, decisions, evidence, published revisions and follow-up. Review and research threads can finish by delivering findings without publishing code.

For code changes, "implemented", "verified", "published" and "running successfully" are distinct facts. A successful push alone does not prove that the user is running the changed version. An interrupted turn leaves delivery resumable from its recorded state.

### Accio owns execution resources

Accio allocates an isolated working copy and records the thread's ownership of its processes, application state, ports and previews. Parallel threads can implement independently without modifying a shared active checkout or sharing the user's live app state.

The working copy may be a managed Git worktree, a separate clone, or a clone inside a container or VM. The backend remains open. Filesystem isolation through a worktree alone does not isolate processes, ports, credentials or application data.

Pausing or finishing a turn preserves unfinished work. Settling a thread and reclaiming its execution resources are separate operations. Cleanup requires an explicit release of ownership, stopped owned processes and preservation of unpublished work; it cannot infer permission from a clean Git status or an idle turn. Reopening a thread restores its retained environment or provisions a new one with its saved work and history.

### Delivery targets the shared branch by default

The default project workflow publishes verified changes directly to the project's base branch, usually `main`, within the user's authorization. Delivery may be requested explicitly or authorized as part of the task. Starting a thread does not itself authorize publication.

Before publishing, integrate with the current base branch and verify the combined result. Coordinate the final branch update per project, including changes arriving from other machines. Advance the branch only from the base revision that was verified. If it moves, integrate and verify again. Bounded retries leave the thread waiting with a recorded reason instead of looping indefinitely.

Conflicts belong to the thread delivering the change. Resolve mechanical conflicts automatically; surface decisions that alter the requested behavior or require additional authority. Publication never overwrites another thread's published work.

A project may require a feature branch, PR/MR or a custom release flow. Those are project delivery policies, using the same ownership and verification model. A mandatory human PR review is not the default product workflow.

### Evidence and recovery are part of the result

Verification demonstrates the requested behavior in an isolated environment. Tests, builds and type checks contribute evidence; UI work also needs exercised interactions and an inspectable preview or recording. Record which revision was exercised and any material gaps.

After publishing, the owning thread checks the running or deployed result where the task authorizes it and reports the version the user can inspect. Retain enough history to revert a particular change while preserving later work. Persistent data needs its own backup and migration recovery plan; a Git revert cannot restore changed data.

### Machines execute; the hub coordinates

Consistent with [ADR 0009](0009-the-hub-never-runs-threads.md), harnesses, working copies, verification and Git operations run on a machine's accio worker. The hub may hold shared delivery policy and relay project coordination, but it does not acquire checkouts or run harnesses. The concrete coordination protocol remains open.

## Consequences

- Users follow outcomes, evidence and decisions in a thread. Worktrees, branches and resource cleanup become managed execution details.
- Accio needs durable ownership and delivery state that survive disconnects and restarts. Agent prompts alone cannot enforce resource ownership or coordinate branch updates.
- Parallel implementation still permits overlapping edits. Automatic integration must account for semantic interactions as well as textual conflicts.
- Fast feedback and recovery reduce the need for routine human handoffs. Destructive data changes still require a suitable recovery strategy and authorization.
- The first implementation can use managed local worktrees if it satisfies these guarantees. A sandbox provider or a cloud platform is not a prerequisite for documenting the model.

## Considered options

- **A PR and a separate integration thread for every change:** compatible with conventional tooling, but makes handoffs the default and splits responsibility for the outcome.
- **All threads edit one shared checkout:** cheap to start, but their files, Git state and running services interfere. Direct-to-main delivery does not require shared concurrent editing.
- **Require a VM per thread immediately:** offers stronger isolation, but commits accio to infrastructure before its execution lifecycle is defined. Support that backend through the same ownership model.

## Amp reference: verified behavior, not an implementation specification

Amp's public documentation was checked on 2026-11-03:

- [What Are Orbs?](https://ampcode.com/what-are-orbs) describes a fresh machine per new thread, with the repository cloned and tools prepared. [Orbs Overview](https://ampcode.com/docs/orbs) describes an isolated environment that pauses and resumes with its files and services. This replaces the user's management of local worktrees; it does not eliminate Git or concurrent integration.
- [Self-Hosted Orbs](https://ampcode.com/docs/orbs/self-hosted) supports multiple execution backends, including containers. Disk and process-memory preservation differ by backend. Archiving pauses an orb and retains its disk; deleting the thread can delete its orb. "Orb" does not mandate one virtualization technology.
- [One Runner, Many Worktrees](https://ampcode.com/news/one-runner-many-worktrees) explicitly documents Git worktrees on local runners, including an "Archive and Remove Worktree" action. Orbs and runners offer different execution arrangements.
- [Shipping Changes](https://ampcode.com/docs/orbs/shipping) describes a Ship action that sends instructions to the agent: commit, fetch and rebase onto the latest base branch, run tests, then push directly to that branch. A moved base triggers another integration attempt; substantive conflicts require checking with the user. Projects can choose feature-branch or custom shipping behavior. Shipping leaves the thread open for follow-up.
- [The Amp Way](https://ampcode.com/docs/using-amp/how-we-work) describes end-to-end ownership, agent feedback loops and the core team's use of direct-to-main delivery without mandatory PR reviews.
- [Culture Stops Slop](https://www.youtube.com/watch?v=tEse6n4hEJQ), especially [27:21](https://www.youtube.com/watch?v=tEse6n4hEJQ&t=1641s), [48:29](https://www.youtube.com/watch?v=tEse6n4hEJQ&t=2909s) and [53:53](https://www.youtube.com/watch?v=tEse6n4hEJQ&t=3233s), motivates ownership of the feature lifecycle, behavioral evidence and reconsidering the cost of mandatory review queues.

These sources do not establish that Amp uses a central integration queue, or that it never uses Git worktrees internally. Accio's ownership enforcement and project coordination are its own design requirements.
