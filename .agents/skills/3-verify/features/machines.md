# Machine settings

Users see which machine is connected, its installed harnesses, its shared name, and folders that suggest a profile for new projects.

## Sub-features

- `machines-status`: connected state, platform, app version and harness versions.
- `machines-list`: the selected hub's row above the list (`Hub on this machine · 0.1.<n>` or `Hub at <host> · 0.1.<n>`), and each machine's Accio version in its row; a connected machine behind main shows `Update` in its row, which starts its update without opening it.
- `machines-onboard`: Add machine opens setup steps for the selected hub; Generate pairing code issues a one-use code, Copy code acknowledges clipboard success or reports denial, and expired codes cannot be copied. Public hub addresses also offer a copyable setup prompt under Set up with a coding agent. Localhost addresses explain the reachability limit. Done returns focus to Add machine. Pair a second disposable worker through its first-run UI and require its Connected row in the original Machines list; code reuse must fail.
- `machines-name`: rename this machine and reopen the saved name.
- `machines-pair-browser`: Settings → Machines → Paired clients → `Pair a browser`. Require a QR code, the hub address, and a matching one-time text code. Pair a separate browser context at that address, then require its user-agent name under Paired clients and never in the Machines rows. `Unpair <browser>` asks for confirmation before removing it. Use the disposable relay fixture: `pnpm verify:ui browser-pairing.spec.ts --project=relay`.
- `machines-this-browser`: at the paired hub URL, open `This browser` in the sidebar footer. Change `Theme` and `Move on after sending`, reload and reopen the sheet, and require both choices to persist only in that browser context. The `Paired clients` section identifies the current pairing as `This browser`; `Unpair` → `Unpair this browser?` → `Unpair` returns directly to `Pair this browser`. Other pairings can still be revoked here. The web app has no Settings, Add project/Pick folder, account sign-in, Update or App screenshot controls, even at desktop widths. The worker URL still has Settings and Add project. Use the same `browser-pairing.spec.ts` relay fixture.
- `machines-folders`: add/remove profile folders and observe project-profile suggestions.
- `machines-revoke`: Revoke on another machine's page unpairs it from this hub after a confirmation; see `hubs/revoke` in [Hubs](hubs.md).
- `machines-github`: each profile's GitHub account, chosen in Settings → Profiles (`Automatic`, the account git uses for each repository, or a login gh is signed in to on any machine). The machine page shows it read-only under `Profile folders and GitHub on <machine>`, with a warning pill when gh there isn't signed in to it.

## How to get to it (user POV)

- Open `Settings` then `Machines`, then the row ending in `(this machine)`.
- Click the machine badge in the thread sidebar footer to open the same Machines list.
- In a new thread, the machine chip under the composer (`Run on machine: …`) opens a menu of connected machines. Remote execution is currently unavailable.

## Driving it with Playwright

Preconditions: healthy isolated instance; UI-created profiles for folder settings. A folder-suggestion check needs two profiles to distinguish a suggested selection from the single-profile default.

- **Settings entry.** Click `Settings`, then `page.locator('.sidebar nav').getByRole('button', { name: 'Machines', exact: true })`. Click `page.getByRole('button', { name: /\(this machine\)/ })`. Require `Connected`, the local platform, `accio version`, and installed harness sections. Compare version and local identity with the doctor report/read-only machine view.
- **Footer entry.** From the thread shell click the machine badge button (use the current ARIA snapshot to match its machine name/status), require the same Machines list and reopen the local machine. Do not use an icon coordinate.
- **Rename.** Fill `page.getByRole('textbox', { name: /^Machine name/ })` with `Verify machine`, click exact `Save`, and require `Verify machine` in the main breadcrumb navigation. Click `Machines` in that breadcrumb, reopen button matching `/Verify machine \(this machine\)/`, and require the textbox's saved value. Inspect this machine's `name` and `customName` in `<home>/hub/settings.json`.
- **Add folder.** With one profile, fill textbox `Folder path` with `fixture`, press `Enter`, then click exact `Save`. Reopen the machine and require the literal path. With several profiles, scope the folder input to the intended profile's `.setting-form`; the machine has one form and a shared Save footer for its name and all profile folders.
- **Remove folder.** Click `page.getByRole('button', { name: 'Remove ' + fixture, exact: true })`, save that profile's folders, reopen and require absence both in the UI and persisted `profileFolders` entry.
- **Suggested profile.** Create two profiles, assign a scratch parent folder to the second profile, save, then add a new child folder through `Add project`. Require the second profile option marked `(from its folders)` to be selected; save and verify the project actually belongs to that profile.
- **GitHub account.** In Settings → Profiles → `<profile>`, open the MenuSelect labelled `GitHub account`. Require `Automatic` first, then the logins from `gh auth status` across machines (the runner's worker reads the real gh); a login missing on some machine says so in its detail. Choose one, Save, reload, reopen the profile and require it selected; inspect the profile's `githubLogin` in `<home>/hub/settings.json`. Choosing `Automatic` and saving removes it. Open the machine and require a `GitHub account` row with the login in a green pill, or `Automatic`. `out/verify-github-account.mjs`-style journeys must create their profile through first run; with no gh sign-in the menu holds only `Automatic`, and choosing a login is unverified.
- **Proof.** Use `await capture('machines-persisted')` plus the relevant non-secret machine fields from `hub/settings.json`. The default smoke proves the settings entry, name change and folder save/reopen.

## Gotchas

- Machine name is shared through this run's hub. Isolation comes from its unique home/machine ID.
- `Folder path` adds on Enter or blur, but persists only after `Save`.
- The machine-name textbox's accessible name includes its help text. Use `/^Machine name/`, not an exact-name match.
- Two-profile suggestion behavior is unverified by the smoke's single-profile setup.
- A connected machine or discovered harness version does not establish that a provider account can run a turn. Remote machine execution is not implemented in v0.1.
