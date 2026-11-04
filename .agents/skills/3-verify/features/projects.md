# Projects and checkouts

Users add a local folder to a profile. Folders sharing a git remote join one project as separate checkouts; a folder without a remote becomes its own project.

## Sub-features

- `projects-add`: inspect a typed folder and add it from each entry point.
- `projects-duplicates`: protect against adding the same folder twice.
- `projects-group`: match separate local checkouts by git remote.
- `projects-profile`: choose/change profile while no threads exist; preserve it once used.
- `projects-remove`: remove a checkout, explicitly confirm deletion of its threads when applicable.

## How to get to it (user POV)

- Onboarding's third `Add a project` step, after a profile has a signed-in account.
- Sidebar toolbar button `Add project` after creating any profile, even while signed out.
- `Filter threads` menu, then the named `<project> settings` button to inspect/reassign/remove checkouts.
- In Electron only, `Browse…` next to the Folder input opens the native picker.

## Driving it with Playwright

Preconditions: healthy instance, a UI-created profile, and `fixture` from the runner. Profile choice needs two profiles; removal with threads needs real completed or stopped threads. Baseline lacks sign-in for the inline onboarding path and thread deletion case.

- **Toolbar add.** Click exact button `Add project`; fill `page.getByRole('textbox', { name: 'Folder', exact: true })` with `fixture`. Wait for text `no git remote; this folder is its own project`; then click exact `Add`. Require the dialog to disappear and `<home>/projects.json` to contain a checkout with that path and a project assigned to the chosen profile.
- **Profile choice.** With two profiles and an inspected new folder, use the combobox named `/Profile/` to choose its actual profile option. Require the saved project's profile to match. With one profile the sheet displays a fact instead of a selector.
- **Reopen.** Click button `Filter threads`, then exact `verify-project settings`. Require the dialog to show `fixture` and the saved profile. `await capture('projects-persisted')` pairs with the saved project/checkout IDs.
- **Duplicate.** Close the project sheet using exact button `Close`; reopen `Add project`, fill `Folder` with the same path. Require `This folder is already added.` and a disabled `Add` button. Click `Cancel`; require the checkout count unchanged.
- **Inline onboarding.** Complete real provider sign-in first. When step 3 is current, fill textbox `Folder`, wait for inspection, choose a profile if shown, click `Add`. Require onboarding to finish, and reopen the project through `Filter threads` to establish the same saved state. Missing sign-in is a failed prerequisite for this entry point; toolbar add does not cover it.
- **Remote grouping.** Create two disposable local git repositories inside `<run>/scratch`, with the same remote URL using `git remote add origin https://example.invalid/accio-verify.git` in each directory; do not fetch or push. Add the first through the UI, then type the second folder. Require `Joins the existing project`, add it, and reopen project settings to see both paths. Require one project and two checkouts in the saved file. Capture the git commands and exit codes as fixture evidence.
- **Change profile.** With two profiles and no project threads, reopen its settings, open the `Profile` menu, choose the other `menuitemradio` and click `Save` (project settings stage changes; `Cancel` discards them). Reopen and compare the saved value. With a real project thread, require the selector disabled and the fixed-profile explanation.
- **Remove.** In project settings click `Remove checkout` for the intended path (scope to its row when several exist). It always asks to confirm: with no threads `Confirm remove`, with threads `Remove checkout and delete 1 thread` (or the plural count); `Cancel` preserves it. Only that explicit confirmation removes both the checkout and its threads. Verify the on-disk working folder remains intact.

## Gotchas

- Folder inspection debounces for 250 ms. Wait for its resulting facts/button state, not a fixed sleep.
- Plain folders have no remote grouping. A grouping journey without two matching remotes fails its fixture precondition.
- `Browse…` and clickable OS folder opening use Electron's bridge; browser server mode leaves them unavailable and cannot prove them.
- Project dialogs lack an accessible name; target role `dialog`, then its heading/content. `Close` belongs to the sheet header.
