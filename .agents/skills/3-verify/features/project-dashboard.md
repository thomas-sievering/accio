# Project dashboard

A project's page, opened through `Dashboard` in the menu on the project name in a thread's header. Sections show Needs you, Working, Offline and Snoozed threads, one line each, then Recently shipped: the newest commits on `origin`'s default branch, one line each, with a pull request's merge commit shown by the PR's title. Issues, Changelog and Settled are folded.

## Sub-features

- `dashboard-open`: `Dashboard` in the thread header's project-name menu opens it; opening any thread or Limits leaves it; Esc or `Close dashboard` closes it.
- `thread-rows`: one line per thread. The group heading stands for a plain Ready state; any other state (a delivery such as `Shipping · #201`, `Needs attention`) shows as a quiet tag before the time.
- `issues`: the `Issues` fold lists the project's open issues (GitHub through gh, or `.scratch/<feature>/issues/*.md`) in dependency order with a graph in the gutter (`.issues-gutter`: one circle per issue, paths for lines), a `Ready`/`Blocked`/`Claimed` pill and `waits on …` on blocked rows. The combobox `Parent issue` (GitHub) or `Feature folder` (local) narrows it. Empty states: no checkout here, `No issue tracker. …`, the tracker's unavailable reason, `No open issues.`
- `issue-reader`: clicking an issue row opens the reader and marks the row `aria-current`. Wide windows show it as `complementary` `Issue` beside the dashboard (Esc or `Close issue` closes it before the dashboard); windows up to 1100px wide show it as a `dialog` named `<label> <title>`. It shows the state pill, triage label (`.issue-triage`), Blocked by and Blocks as buttons that move the reader and the highlight, the body from `threads.issueBody` (a local file without its title, `Status:` and `Blocked by:` lines) and `View on GitHub ↗` when the issue has a URL. `.issue-reader-actions` holds the thread action: `Open thread` when an open thread in the project works on the issue (or, for a Claimed issue, a settled one) (`thread.issue` is its ref, so a local issue claimed in that thread's worktree still reads Ready here), else `Start a thread`, disabled unless the issue is Ready. Start a thread calls `threads.start` with the picker's first message (`Work on <ref>: <title>`) and `issue`, so the worker names and claims the thread as for a picked issue, then opens it.
- `recently-shipped`: one line per commit; a commit delivered by a thread expands to its shipped note, things to try, `Open thread` and the PR. The SHA, author and date are in the row's tooltip.

## How to get to it (user POV)

- Open any thread of a project, click the project name before the `/` in its header, then `Dashboard`. For a project in a space the same menu also has `Space` ([Spaces](spaces.md)).
- A project's card in a space view has `<project> dashboard`.

## Driving it with Playwright

Preconditions: a thread in a project whose checkout has an `origin` remote with a default branch. The 3-verify baseline has no sign-in, so it cannot open a thread; `tests/project-dashboard.spec.ts` in `pnpm test:chat` drives the journey against the chat fixture.

- **Open.** Click `page.locator('.thread-project-link')`, then menuitem `Dashboard`. Require `getByRole('heading', { name: '<project>' })` and the thread in `.dashboard-rows`.
- **Commits.** Recently shipped lists `.changelog li`, newest first; a `Merge pull request #N from …` commit reads as the PR title from its body.
- **Issues.** In the chat fixture, start a thread in `issues-project` (gh is faked: #194 waits on #205, both under parent `#190 Threads survive restarts`) or `scratch-project` (local: `relay-reconnect` 02 waits on 01). Unfold `Issues`; require `.issues-row .issues-label` in order `#208, #205, #194, #201`, then pick the parent in the `Parent issue` combobox and require `#205, #194`. `tests/project-dashboard.spec.ts` drives both trackers and the no-tracker message.
- **Read an issue.** In `scratch-project`, narrow to `relay-reconnect` and click the `02` row's title button. Require `getByRole('complementary', { name: 'Issue' })` with heading `Show a reconnecting state on the machine chip`, the body text `The machine chip says Reconnecting while the relay retries.`, and the row `aria-current="true"`. Click the Blocked by button `01 Retry the relay handshake…`; require that heading, `Machines stay offline.`, a Blocks button `02 …` and the highlight on `01`. At a viewport ≤1100px wide the same click opens a `dialog` instead, closed by its `Close` button. In `issues-project` the body comes from the faked `gh issue view` (`The body of #194, read through gh.`) and `View on GitHub ↗` links the issue.
- **Start a thread.** Use a disposable project with its own local tracker under `.scratch/<feature>/issues/` (the spec adds `start-issue-project`: 01 ready, 02 blocked by 01, 03 `Status: claimed` with a thread started on it through `threads.start` with `issue`, then settled), so started threads leave the shared fixture's issues alone. In the reader, 02 has `Start a thread` disabled; 03 shows `Open thread`, which opens that thread. 01's `Start a thread` opens a thread whose first message is `Work on .scratch/onboarding/issues/01-welcome.md: Show a welcome card on first run`, titled `Show a welcome card on first run`, with `Status: claimed` in its worktree's copy; reopening the dashboard, 01 now shows `Open thread`.
- **Settled history.** With more than ten settled project threads, expand Settled and click `Show … more settled threads`; require the older rows, then open one.

## Gotchas

- The gutter layout is `apps/web/src/projects/issueGraph.ts`, unit-tested in `issueGraph.test.ts`; check lane changes there rather than by pixel. The worker caches a checkout's issues for 20 seconds, so reopening the fold right after a tracker change may show the previous list.
- Wait until the started thread, not its draft, is the selected sidebar row before opening the dashboard: a draft opens its thread once it has started, which leaves a dashboard opened in between.
- Recently shipped fetches `origin` each time the dashboard opens or a new delivery lands, so an unreachable remote shows the last fetched commits.
