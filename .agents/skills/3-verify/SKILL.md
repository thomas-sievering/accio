---
name: 3-verify
description: "Verify Accio's React app through its real browser UI: launch an isolated server, drive settings, projects or coding threads, capture evidence, and diagnose failures after behavior changes."
---

# Verify Accio

Read [the feature index](features/README.md), then the affected feature files. Drive every mapped entry point relevant to the change; record each as passed, failed, or unverified with its unmet precondition. The default smoke covers selected offline paths; its coverage report is not a claim that the whole map passed.

## Launch

From the repository root, use Node and the pnpm version pinned in `package.json`:

```powershell
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm verify
```

On Linux, browser system libraries may require `pnpm exec playwright install --with-deps chromium`. The proven target is Windows with local Chromium.

`pnpm-workspace.yaml` exempts `@anthropic-ai/*` and `@openai/*` from pnpm's minimum release age, so new harness SDK releases install directly. If install rejects any other package as too new, inspect the rejected versions; do not override the policy or add exemptions without the user's agreement.

`pnpm verify` builds the workspace and runs [the runner](scripts/verify.mjs) with [the smoke journey](scripts/smoke.mjs). After a successful build, repeat or supply a custom journey with:

```powershell
node .agents/skills/3-verify/scripts/verify.mjs
node .agents/skills/3-verify/scripts/verify.mjs out/verify-journey.mjs
```

The runner prints an absolute `out/verify/<timestamp>-<id>` evidence directory. It forks the production `apps/worker/dist/main.js` with:

- `ACCIO_HOME=<run>/scratch/home`, initially empty.
- `ACCIO_HOST=127.0.0.1`, `ACCIO_PORT=0`, `ACCIO_HUB_PORT=0` for independent ephemeral ports.
- `ACCIO_WEB_ROOT=<checkout>/apps/web/dist` for the actual built UI.

Production startup creates the token and machine identity, runs state migrations, loads all domains, and starts the in-process hub. No database or seed credentials are needed. Readiness requires `ACCIO_READY`, a passing doctor, and the visible `Set up Accio` heading in Chromium. The smoke then creates its prerequisites through the UI. Git must be on PATH: the runner uses `git init --quiet` to make its disposable `verify-project` a repository without a remote, so folder inspection cannot discover Accio's parent repository. This is verification scaffolding, recorded in `fixture.json` and removed with scratch.

Each run owns a fresh browser context, home and ports, so runs can coexist. Use only the instance created by this runner. Browser mode shares the React UI with Electron but cannot prove Electron startup, the native Browse picker, OS folder opening, or window controls. Those require a separate desktop proof; do not simulate `window.accioDesktop` and call that native coverage.

## Real model turns

Real turns use the **verify device**: one machine identity, `~/.accio-verify/device.json` (or `ACCIO_VERIFY_DEVICE`), paired with a real hub whose accounts are already signed in. Journeys that `export const linkedHub = true` start from a fresh home that has already joined that hub (seeded `machine.json` and `hub-connections.json` only). Provider credentials stay on the hub; the scratch home is still removed. Seeding is scaffolding, not pairing proof. The device's machine appears on the hub as `Accio verify`.

- `pnpm verify:real`: adds the disposable project, opens a draft through New thread, sends `Reply with ACCIO_VERIFY_OK…`, and requires the streamed reply plus a persisted transcript (copied to `transcript.json`).
- Link once (or after the device is revoked): get a pairing code from a device already on the hub (Settings → Hubs, or `hubs.createPairingCode` on that device), then run `pnpm verify:link-hub` with `ACCIO_VERIFY_HUB_URL` and `ACCIO_VERIFY_PAIRING_CODE` set. It pairs through first-run setup, names the machine, and saves the device file. Never print the code or the device file.

One run uses the device at a time; others wait up to 15 minutes on `device.json.lock`. `pnpm try` (the hands-on desktop launch from a checkout) holds the same lock while its window is open, but closes that window when a run asks for the device, so a forgotten window never blocks you. Real turns spend the hub account's quota and run tools with full permissions, so keep prompts inside the disposable project. A journey can `export const headed = true`.

## Doctor

The runner performs this read-only check before any journey. When an active run looks wrong:

```powershell
pnpm verify:doctor out/verify/<the-printed-run-directory-name>
```

Use the actual printed directory name as the argument. Inside a custom journey, run `await doctor()` instead. The check requires the recorded child PID to exist, the checkout and build hashes to match, static HTML to load, and authenticated WebSocket reads of machines, profiles, accounts, projects and threads to succeed. It matches the connected local machine to this run's `machine.json`. The fresh home and token associate the endpoint with the owned instance. A PID alone is insufficient. `doctor.json` and `doctor-after.json` preserve the two smoke checks. A doctor failure after cleanup is expected: the server and its home are gone.

## Drive

Use Playwright against the real production UI. The runner supplies `page`, `context`, `home`, `fixture`, `runDir`, `action`, `capture`, and `doctor` to a journey's default async export. The committed `smoke.mjs` is the executable reference for profiles, named accounts, machine settings and adding projects. It never signs in or sends a model request.

For inline media, tool-detail or delivery changes, also run `pnpm test:chat` (`tests/inline-chat.spec.ts`, `tests/delivery.spec.ts` and `tests/delivery-merge.spec.ts`). It covers Chromium and a hidden Electron shell against `scripts/chat-test-server.ts`, which substitutes the coding harness and, for PR delivery, hosting reads at production dependency boundaries. Git repositories and publication are real and disposable. This coverage does not establish live GitHub or coding-provider authentication. Each invocation allocates its own port; `ACCIO_CHAT_TEST_PORT` can override that choice. A fixture server started by hand (`node --import tsx scripts/chat-test-server.ts`) stops itself when its parent process exits or after `ACCIO_FIXTURE_TTL_MINUTES` (default 60); stop it sooner with Ctrl+C.

For a changed flow, write `out/verify-journey.mjs` as an ES module with the same export contract, then run it with the command above. Copy the relevant mapped recipe into that journey, assert the expected outcomes, and wrap each interaction group in `await action('feature/entry: expected behavior', async () => { ... })`. Save checkpoints with `await capture('feature-state')`. Locators time out after 5 s (`ACCIO_VERIFY_TIMEOUT_MS` overrides); pass a longer `timeout` to a single wait for slow real effects such as a model reply. User actions go through Playwright clicks, typing, keyboard presses and menu choices. Use read-only files or RPC only as a second observation of effects; never create the tested state through internal setters or test endpoints.

Real handles in this app:

- `page.getByRole('button', { name: 'Settings', exact: true })` opens settings. In settings, scope section navigation to `page.locator('.sidebar nav')` because breadcrumb buttons repeat section names.
- `page.getByRole('textbox', { name: 'Name', exact: true })` edits a profile. First run instead uses `page.getByPlaceholder('personal, work…')`.
- Dropdowns are the app's own `MenuSelect`, not native selects: a button and a `menu` sharing one label, with `menuitemradio` choices. `selectOption` and `combobox` lookups do not apply. Pick with `await page.getByRole('button', { name: label, exact: true }).click()`, then `page.getByRole('menu', { name: label, exact: true }).getByRole('menuitemradio', { name: option }).click()` (as `tests/menu-select.ts` does).
- A profile's accounts are an ordered list per provider (list `OpenAI · ChatGPT accounts`), added through the `Add ChatGPT account` / `Add Claude account` MenuSelect and removed with `Remove <name>`.
- Settings lists end in a dashed `Add <thing>` row whose name is exact (`Add profile`, `Add tool`, `Add MCP server`, `Add skill source`, `Add hub`).
- `page.getByRole('button', { name: 'Add project', exact: true })`, followed by textbox `Folder`, reaches the local project sheet.
- `page.getByRole('button', { name: 'New thread', exact: true })` opens the picker. Its inputs are comboboxes `Search projects` and `Search profiles`; choices have role `option`. New thread, `Search threads` and `Filter threads` are hidden until setup is done (a profile with a signed-in account and a project), so the offline baseline cannot reach them.
- Popover menus fade out over about 120 ms. Assert dismissal with `await menu.waitFor({ state: 'hidden' })`, not an immediate `isVisible()`.

Selectors and complete journeys for the remaining branches live in the feature files. Use fresh ARIA snapshots to resolve ambiguities. Preserve Unicode labels literally.

For interactive debugging, set `ACCIO_VERIFY_HEADED=1` in the invoking shell, and put `await page.pause()` at the desired checkpoint in a custom journey. Resume the inspector to finish and clean up; remove the environment variable afterward. An agent can also modify and rerun a journey without using an interactive browser tool. If a host mandates a browser tool for interactive work, follow that host's tool rules.

## Evidence

On failure the runner prints the failed action's label, the message without stack frames and, for locator failures, the page's ARIA snapshot. Set `ACCIO_VERIFY_VERBOSE=1` to print the full stack instead; it is always in `result.json`.

Each run retains `result.json` (including failures), `actions.json`, `trace.zip`, screenshots and `.aria.yml` snapshots, `server.log`, browser errors, observed browser request destinations, and `cleanup.json`. The smoke additionally saves non-secret `persisted-settings.json`, `persisted-projects.json`, doctor reports and `coverage.json`. Open a trace with:

```powershell
pnpm exec playwright show-trace out/verify/<the-printed-run-directory-name>/trace.zip
```

Prove the action and resulting state, not just a final screenshot. Reopen saved values through a second UI view and inspect the corresponding persisted fields. For thread tool actions, also inspect their scratch project files; for thread state, inspect `threads.json` and `transcripts/<id>.json`. Copy only the needed non-secret fields into the evidence directory before teardown. Never copy account credential stores wholesale.

Mocks belong only at an existing production boundary (for example the injectable provider transport in `startApp`); identify them in the proof and keep real-provider coverage unverified. The default proof uses no mocks. A disabled Send button is proof of the signed-out gate, not a successful coding turn. A missing account, model or transcript is a failed journey precondition, never a reason to weaken its assertion.

There is no dry-run mode here: UI saves write real files in the disposable home. Provider sign-in opens an external page, and a sent coding turn can call a paid provider and execute tools with full permissions. For any future dry-run flow, observe files, network and git refs to establish what it actually skips. Browser `requests.json` covers browser traffic only; it cannot establish that the server made no upstream requests.

## Cleanup

The runner's `finally` closes its Playwright context/browser, sends IPC `{ type: 'shutdown' }` to its own forked production server, waits for exit (with an owned-child fallback), and removes only `<run>/scratch`. It checks that the server port stopped answering, writes `cleanup.json`, and confirms `result.json` still exists. This runs on failed journeys too. Never kill by process name or delete `out/verify` as cleanup; failed evidence must survive.

For an interrupted invocation, send Ctrl+C to the runner and allow it to finish teardown. If the runner itself was forcibly terminated, first inspect that run's `instance.json`, confirm the PID's command line and home belong to this checkout/run, and stop only that owned PID if it still exists. Then remove only that run's resolved `scratch` child. Record manual cleanup and retain evidence. Never stop the user's desktop/server instance.

## Helpers

- `scripts/verify.mjs`: executable Node launcher, read-only doctor, evidence and teardown. Run via `pnpm verify` or the explicit Node commands above.
- `scripts/smoke.mjs`: default journey module; invoked by the runner, not as a standalone process. Extend coverage through a custom journey with the same injected arguments.
- `scripts/resources.mjs`, `scripts/hubs.mjs`: offline journeys for tools/MCP/skills and hubs; run them through the runner as their feature files say.
- `scripts/real-turn.mjs`, `scripts/link-hub.mjs`: the verify-device journeys behind `pnpm verify:real` and `pnpm verify:link-hub`.

## Keeping this current

A change that renames, moves or hides a control updates the feature file that names it and any journey script that drives it, in the same change. Rerun `pnpm verify` and the offline journeys (`resources.mjs`, `hubs.mjs`) whenever a change touches settings, first run, menus or the sidebar.
