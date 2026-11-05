# Machine settings

Users see which machine is connected, its installed harnesses, its shared name, and folders that suggest a profile for new projects.

## Sub-features

- `machines-status`: connected state, platform, app version and harness versions.
- `machines-list`: the selected hub's row above the list (`Hub on this machine · 0.1.<n>` or `Hub at <host> · 0.1.<n>`), and each machine's Accio version in its row; a connected machine behind main shows `Update` in its row, which starts its update without opening it.
- `machines-onboard`: Add machine opens setup steps for the selected hub; Generate pairing code issues a one-use code, Copy code acknowledges clipboard success or reports denial, and expired codes cannot be copied. Public hub addresses also offer a copyable setup prompt under Set up with a coding agent. Localhost addresses explain the reachability limit. Done returns focus to Add machine. Pair a second disposable worker through its first-run UI and require its Connected row in the original Machines list; code reuse must fail.
- `machines-name`: rename this machine and reopen the saved name.
- `machines-folders`: add/remove profile folders and observe project-profile suggestions.

## How to get to it (user POV)

- Open `Settings` then `Machines`, then the row ending in `(this machine)`.
- Click the machine badge in the thread sidebar footer to open the same Machines list.
- In a new thread, the machine chip under the composer (`Run on machine: …`) opens a menu of connected machines. Remote execution is currently unavailable.

## Driving it with Playwright

Preconditions: healthy isolated instance; UI-created profiles for folder settings. A folder-suggestion check needs two profiles to distinguish a suggested selection from the single-profile default.

- **Settings entry.** Click `Settings`, then `page.locator('.sidebar nav').getByRole('button', { name: 'Machines', exact: true })`. Click `page.getByRole('button', { name: /\(this machine\)/ })`. Require `Connected`, the local platform, `accio version`, and installed harness sections. Compare version and local identity with the doctor report/read-only machine view.
- **Footer entry.** From the thread shell click the machine badge button (use the current ARIA snapshot to match its machine name/status), require the same Machines list and reopen the local machine. Do not use an icon coordinate.
- **Rename.** Fill `page.getByRole('textbox', { name: /^Machine name/ })` with `Verify machine`, click exact `Save name`, require heading `Verify machine`. Click `All machines`, reopen button matching `/Verify machine \(this machine\)/`, require the textbox's saved value. Inspect this machine's `name` and `customName` in `<home>/hub/settings.json`.
- **Add folder.** With one profile, fill textbox `Folder path` with `fixture`, press `Enter`, click exact `Save folders`. Reopen the machine and require the literal path. With several profiles, scope the folder input and save button to the form containing the intended profile's text; each profile owns its own form.
- **Remove folder.** Click `page.getByRole('button', { name: 'Remove ' + fixture, exact: true })`, save that profile's folders, reopen and require absence both in the UI and persisted `profileFolders` entry.
- **Suggested profile.** Create two profiles, assign a scratch parent folder to the second profile, save, then add a new child folder through `Add project`. Require the second profile option marked `(from its folders)` to be selected; save and verify the project actually belongs to that profile.
- **Proof.** Use `await capture('machines-persisted')` plus the relevant non-secret machine fields from `hub/settings.json`. The default smoke proves the settings entry, name change and folder save/reopen.

## Gotchas

- Machine name is shared through this run's hub. Isolation comes from its unique home/machine ID.
- `Folder path` adds on Enter or blur, but persists only after `Save folders`.
- The machine-name textbox's accessible name includes its help text. Use `/^Machine name/`, not an exact-name match.
- Two-profile suggestion behavior is unverified by the smoke's single-profile setup.
- A connected machine or discovered harness version does not establish that a provider account can run a turn. Remote machine execution is not implemented in v0.1.
