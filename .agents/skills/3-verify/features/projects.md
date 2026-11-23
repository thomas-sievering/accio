# Projects and checkouts

Users add a local folder to a profile. Folders sharing a git remote join one project as separate checkouts; a folder without a remote becomes its own project.

## Sub-features

- `projects-add`: inspect a typed folder and add it from each entry point.
- `projects-duplicates`: protect against adding the same folder twice.
- `projects-group`: match separate local checkouts by git remote, and a folder of a repository the hub keeps from another machine (`Joins the existing project`, under the hub's profile).
- `projects-profile`: choose/change profile while no threads exist; preserve it once used.
- `projects-tool`: the `add_project` accio tool adds folders on the thread's machine, or repositories by remote alone, after the user allows it.
- `projects-remove`: remove a checkout, explicitly confirm deletion of its threads when applicable.

## How to get to it (user POV)

- Onboarding's third `Add a project` step, after a profile has a signed-in account.
- Sidebar toolbar button `Add project` after creating any profile, even while signed out.
- `Filter threads` menu, then the named `<project> settings` button to inspect/reassign/remove checkouts.
- In Electron only, `Browse…` next to the Folder input opens the native picker.

## Driving it with Playwright

Preconditions: healthy instance, a UI-created profile, and `fixture` from the runner. Profile choice needs two profiles; removal with threads needs real completed or stopped threads. Baseline lacks sign-in for the inline onboarding path and thread deletion case.

- **Toolbar add.** Click exact button `Add project`; fill `page.getByRole('textbox', { name: 'Folder', exact: true })` with `fixture`. Wait for text `no git remote; this folder is its own project`; then click exact `Add`. Require the dialog to disappear and `<home>/projects.json` to contain a checkout with that path and a project assigned to the chosen profile.
- **Profile choice.** With two profiles and an inspected new folder, use the `Profile` MenuSelect (button `Profile`, then a menuitemradio in menu `Profile`) to choose its actual profile. Require the saved project's profile to match. With one profile the sheet displays a fact instead of a selector.
- **Reopen.** Open Settings / Projects and click the `verify-project` row (the Filter gear `verify-project settings` and the project dashboard's `verify-project settings` button open the same Settings page once setup is done; clicking the thread header's project name opens its [project dashboard](project-dashboard.md); right-clicking it opens a menu with `Project settings`). Require the page to show `fixture` (middle-truncated; match its `title`) and the saved profile. `await capture('projects-persisted')` pairs with the saved project/checkout IDs.
- **Duplicate.** Leave the project page with `Cancel`, then `Back`; reopen `Add project`, fill `Folder` with the same path. Require `This folder is already added.`. `Add` stays pressable; clicking it must preserve the note and open dialog without adding another checkout. Click `Cancel`; require the checkout count unchanged.
- **Inline onboarding.** Complete real provider sign-in first. When step 3 is current, fill textbox `Folder`, wait for inspection, choose a profile if shown, click `Add`. Require onboarding to finish, and reopen the project through `Filter threads` to establish the same saved state. Missing sign-in is a failed prerequisite for this entry point; toolbar add does not cover it.
- **Remote grouping.** Create two disposable local git repositories inside `<run>/scratch`, with the same remote URL using `git remote add origin https://example.invalid/accio-verify.git` in each directory; do not fetch or push. Add the first through the UI, then type the second folder. Require `Joins the existing project`, add it, and reopen project settings to see both paths. Require one project and two checkouts in the saved file. Capture the git commands and exit codes as fixture evidence.
- **Change profile.** With two profiles and no project threads, reopen its settings, open the `Profile` menu, choose the other `menuitemradio` and click `Save` (project settings stage changes; `Cancel` discards them; leaving with unsaved changes asks `Discard changes?` with `Keep editing` and `Discard`). Reopen and compare the saved value. With a real project thread, require the selector disabled and the fixed-profile explanation.
- **Remove.** Removing a project's last checkout here leaves it on the hub, listed in New thread, while another machine has one; with none left anywhere the hub forgets it. In project settings click `Remove checkout` for the intended path (scope to its row when several exist). It always asks first, in group `Remove checkout <path>?`: with no threads `Remove checkout`, with threads `Remove checkout and delete 1 thread` (or the plural count); `Cancel` has focus and, like Escape, preserves it. Only that explicit confirmation removes both the checkout and its threads. Verify the on-disk working folder remains intact.

## add_project

The `add_project` accio tool (`apps/worker/src/projects/addProject.ts`) adds `folders` and `repositories` after one confirmation card for all of them, one row per project (name, then remote and folder) with what they share, such as the profile, said once below. A folder is inspected with `checkouts.inspect` and added like `Add project`; a repository (key or remote URL) is checked with `gh repo view` as the profile's GitHub account (github.com only) and registered on the hub by `Projects.addRepository`, with no checkout, so it shows in New thread and is cloned when a thread starts in it. A repository Accio already knows keeps its project and profile; a new one takes the named profile, else for a folder the one suggested by profile folders, else the calling thread's. Known ones are skipped; declined or expired adds nothing. Check it with `npx vitest run apps/worker/src/projects/addProject.test.ts apps/worker/src/projects/addRepository.test.ts`; in a real app, ask a thread to add a disposable repository, allow the card, and require it in New thread's project list.

## Gotchas

- Folder inspection debounces for 250 ms. Wait for its resulting facts/button state, not a fixed sleep.
- Plain folders have no remote grouping. A grouping journey without two matching remotes fails its fixture precondition.
- `Browse…` and clickable OS folder opening use Electron's bridge; a worker URL in Chromium leaves them unavailable and cannot prove them. At the paired hub URL there is no `Add project` or `Open in Explorer` control, and the project dashboard and Filter omit their Settings shortcuts (`browser-pairing.spec.ts`, relay fixture).
- Project settings are a Settings detail page (no dialog). The Add project sheet is the only project dialog; `Close` belongs to its header.
