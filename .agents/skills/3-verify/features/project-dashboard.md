# Project dashboard and project app

A project's page, opened through `Dashboard` in the menu on the project name in a thread's header. On top it controls the **project app**: the project's start command, run on this machine from `origin`'s default branch in a detached checkout of its own (`<home>/project-apps/<projectId>`), apart from every thread's worktree. Sections show Needs you, Working and Snoozed threads, then Recently shipped with the running commit marked. Changelog and Settled are folded; logs open inside the app card.

## Sub-features

- `dashboard-open`: `Dashboard` in the thread header's project-name menu opens it; opening any thread or Limits leaves it; Esc or `Close dashboard` closes it.
- `app-commands`: `Start command` and `Setup command` in project settings. The dashboard's `Enter manually` and `<project> settings` buttons open them; Save or Cancel returns to the dashboard.
- `app-run`: `Start`, `Open app`, `Restart` (same commit), `Stop`; `Update & restart` appears when the branch has a newer commit.
- `app-follow`: `Auto-update from <branch>` switch (on by default) updates and restarts shortly after the branch advances; a failed update restores the previous commit and says so.

## How to get to it (user POV)

- Open any thread of a project, click the project name before the `/` in its header, then `Dashboard`.

## Driving it with Playwright

Preconditions: a thread in a project whose checkout has an `origin` remote with a default branch. The 3-verify baseline has no sign-in, so it cannot open a thread; `tests/project-dashboard.spec.ts` in `pnpm test:chat` drives the full journey against the chat fixture (its poll is shortened to one second).

- **Open.** Click `page.locator('.thread-project-link')`, then menuitem `Dashboard`. Require `getByRole('heading', { name: '<project>' })` and the thread in `.dashboard-rows`.
- **Commands.** Click `Enter manually`, fill textboxes `Start command` and `Setup command`, click `Save`. Require the dashboard heading again.
- **Run.** Click exact `Start`. Require `.app-status` `Running`, button `Open app`, and `.app-commit` with the branch tip's subject. `projectApps.get` over RPC gives the URL as a second observation.
- **Follow.** Push a commit to the origin. Require `.app-commit` to show its subject within the poll interval plus a few seconds; the source checkout stays clean.
- **Commits / Logs.** Recently shipped lists commits (`.changelog li.running` is the running commit). Click `Logs` inside the app card; `.app-logs` contains `$ <start command>`.
- **Settled history.** With more than ten settled project threads, expand Settled and click `Show … more settled threads`; require the older rows, then open one.
- **Stop.** Click exact `Stop`; require `Stopped` and a `Start` button.

## Gotchas

- The production poll is 60 s with a 15 s settle delay; allow for that when driving a real server.
- The app's checkout and logs belong to the machine; another machine's dashboard shows its own app.
