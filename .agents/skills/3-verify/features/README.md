# Accio verification map

This is the maintained source for driving Accio as a user. Read the affected feature files before writing a journey. Each listed entry point needs its own outcome; coverage of one does not establish coverage of another.

## Baseline preconditions

- Use the [3-verify launch](../SKILL.md#launch). It builds and starts the real production server and web app in a fresh home, with independent ports and Chromium context.
- Readiness includes the doctor and visible `Set up accio` heading. No accounts, profiles, projects or threads exist initially.
- The runner provides `fixture`, an empty local `verify-project` git repository without a remote. Its own git boundary prevents discovering the parent Accio checkout. The smoke creates `Verify personal`, a signed-out `Verify ChatGPT` account, a profile folder mapping, and a project through UI actions.
- Baseline has no provider credentials. Full sign-in, model availability, successful turns, transcript search and shelves require additional real user setup. Report these journeys as unverified with that reason until driven.

## Driving conventions

The harness is Playwright. Recipes use `page` from the runner's default-export journey contract and exact accessible roles/names from the app. Wrap actions with `action`, capture ARIA plus screenshots with `capture`, and assert outcomes. Scope settings navigation with `page.locator('.sidebar nav')`; breadcrumbs repeat names. Use `page.getByRole('button', { name: 'Back', exact: true }).click()` to leave settings. The app uses component state rather than feature URLs, so reloading returns to the thread shell.

## Proof and reporting

Record feature IDs and entry points in `actions.json`. Pair the action trace with the resulting UI and read-only persisted data. Preserve failures, their attempted actions and missing prerequisites. Capture before scratch teardown. The smoke's `coverage.json` explicitly separates verified paths from remaining ones. Artifacts live under the printed absolute `out/verify/<run>` path and survive cleanup; see [Evidence](../SKILL.md#evidence).

## Features

- [Profiles](profiles.md): first-run creation, settings creation, editing, cancel, delete and provider-account selection.
- [Accounts](accounts.md): named Claude and ChatGPT accounts, provider sign-in, sign-out and deletion guards.
- [Projects](projects.md): add folders through onboarding or toolbar, inspect duplicates, remote grouping, settings and removal.
- [Machines](machines.md): status, harness versions, machine names and profile folder defaults.
- [Threads](threads.md): project/profile picker, models, messages, stop/resume, search/filter, shelves and deletion.
- [Secrets](secrets.md): private entry, automatic saved reuse, one-time delivery, project access, replacement and deletion; includes the isolated scripted-harness journey.
