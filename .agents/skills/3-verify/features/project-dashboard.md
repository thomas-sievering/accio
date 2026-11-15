# Project dashboard

A project's page, opened through `Dashboard` in the menu on the project name in a thread's header. Sections show Needs you, Working and Snoozed threads, one line each, then Recently shipped: the newest commits on `origin`'s default branch, one line each, with a pull request's merge commit shown by the PR's title. Changelog and Settled are folded.

## Sub-features

- `dashboard-open`: `Dashboard` in the thread header's project-name menu opens it; opening any thread or Limits leaves it; Esc or `Close dashboard` closes it.
- `thread-rows`: one line per thread. The group heading stands for a plain Ready state; any other state (a delivery such as `Shipping · #201`, `Needs attention`) shows as a quiet tag before the time.
- `recently-shipped`: one line per commit; a commit delivered by a thread expands to its shipped note, things to try, `Open thread` and the PR. The SHA, author and date are in the row's tooltip.

## How to get to it (user POV)

- Open any thread of a project, click the project name before the `/` in its header, then `Dashboard`. For a project in a space the same menu also has `Space` ([Spaces](spaces.md)).
- A project's card in a space view has `<project> dashboard`.

## Driving it with Playwright

Preconditions: a thread in a project whose checkout has an `origin` remote with a default branch. The 3-verify baseline has no sign-in, so it cannot open a thread; `tests/project-dashboard.spec.ts` in `pnpm test:chat` drives the journey against the chat fixture.

- **Open.** Click `page.locator('.thread-project-link')`, then menuitem `Dashboard`. Require `getByRole('heading', { name: '<project>' })` and the thread in `.dashboard-rows`.
- **Commits.** Recently shipped lists `.changelog li`, newest first; a `Merge pull request #N from …` commit reads as the PR title from its body.
- **Settled history.** With more than ten settled project threads, expand Settled and click `Show … more settled threads`; require the older rows, then open one.

## Gotchas

- Recently shipped fetches `origin` each time the dashboard opens or a new delivery lands, so an unreachable remote shows the last fetched commits.
