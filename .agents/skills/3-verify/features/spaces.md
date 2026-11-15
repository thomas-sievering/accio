# Spaces

A space groups projects that share context and can mark one of them as its home (GLOSSARY: Space, Home; ADR 0019). Spaces are shared settings on the hub, the same on every paired machine. A project is identified by its repository key, or `local:<project id>` without a remote.

## Sub-features

- `spaces-create`: add a space with a name and projects.
- `spaces-edit`: rename, add or remove projects.
- `spaces-exclusive`: a project already in another space is disabled in the picker, showing that space's name; the hub refuses it too.
- `spaces-home`: set, change and clear the home; removing the home's project clears it.
- `spaces-delete`: delete only the grouping; projects, checkouts and threads stay.
- `spaces-new-home`: `New home…` in the `Home project` picker opens the `New home` dialog: name (default `<space>-home`), profile (no default: a home is usually personal even for a work space, so it is always picked; each option shows the profile's GitHub account here), and `Create as` `Local folder` or `New GitHub repo`. Creating it makes a project from Accio's built-in home template (AGENTS.md with a section per project, CLAUDE.md, GLOSSARY.md, `docs/adr/`, `wiki/` with a page per project, `.agents/skills/`, one commit on `main`) in the profile's folder here, else the home folder. It saves the space as the editor shows it with the new project as home, then opens the home's first thread with the starter prompt.
- `space-view`: the space's page over the thread pane: the home pinned on top with `New thread in home`, then a card per other project with its profile, checkout here (or `Not on this machine`), threads that need you or are working, `Dashboard` and `New thread`. Reopening the app restores it, like the project dashboard.

## How to get to it (user POV)

- Settings, group `Projects and machines`, section `Spaces`.
- Each space is a row with `Edit <space>` and `Open <space>` buttons; `Add space` sits under the list. `Open` shows the space view.
- In a thread of a project that's in a space: click the project name before the `/` in its header, then `Space` (next to `Dashboard`; absent outside a space).

## Driving it with Playwright

Preconditions: healthy instance with at least two projects (add them as in [Projects](projects.md); local folders without a remote are fine).

- **Create.** In `page.locator('.sidebar nav')` click exact `Spaces`, then the button matching `/^Add space/`. Fill textbox `Name`; in group `Projects` check the projects' checkboxes (their names start with the project name). Choose the home with the `Home project` MenuSelect (button `Home project`, then a menuitemradio in menu `Home project`), then click exact `Add space`. Require the row to read `<n> projects · Home <project>`, and the saved space in the hub's `hub/settings.json` under `spaces` (or from `spaces.list`).
- **Exclusive.** Open `Add space` again. Require a project of the first space to be a disabled checkbox whose label shows `In <space>`. `Cancel` leaves without saving.
- **Home.** `Edit <space>`, pick another home, then uncheck the home's project: require the `Home project` button to read `No home`. `Save`; require the row to read `No home`.
- **New home.** First point the profile's folder here at a disposable folder (`machines.setProfileFolders`, or Settings / Machines), since the home is created in it, else in the real home folder. In `Add space` or `Edit <space>`, pick `New home…` in the `Home project` MenuSelect. In `getByRole('dialog', { name: 'New home' })` require textbox `Name` (`<space>-home`), MenuSelect `Profile` reading `Choose…` (`Create home` then shows `Choose a profile.`) and `Create as` (`Local folder`). Pick the profile; require the hint `Created in <folder>\<name>.`. `New GitHub repo` for a profile without a GitHub account here shows `This profile has no GitHub account on this machine.` A name with a space shows `Use letters, digits…` on `Create home`. `Create home` leaves Settings for the new thread: require `.thread-project-link` with the home's name, the space in `spaces.list` with the new project as `homeProjectKey`, and `AGENTS.md` in the folder with a `### <project>` per member. Clean up: delete the space, `checkouts.remove` the home with `deleteThreads`, restore the profile's folders and delete the folder.
- **Delete.** `Edit <space>`, `Delete`, then `Delete <space>`. Require the list back with no such row, and the projects still listed in Settings / Projects.

- **Space view.** In a thread of a member project, click `page.locator('.thread-project-link')`, then menuitem `Space`; require `getByRole('heading', { name: '<space>' })`. Region `Home` holds article `<home project>` with button `New thread in home`; region `Projects` holds an article per other project (named by the project, or by its key when it's not on this machine). In a project's article require the profile name, `.space-checkout` with its path (or `Not on this machine`, and `New thread in <key>` disabled), its open threads as `.row-title`, and buttons `<project> dashboard` and `New thread in <project>`. Reload and require the heading again. `<project> dashboard` opens the project dashboard. In Settings / Spaces, `Open <space>` leaves Settings for the view. `New thread in home` opens a draft whose header names the home; sending starts the thread there (`threads.list` as a second observation). Delete the space, and the project-name menu has `Dashboard` but no `Space`.

The chat fixture's specs `tests/spaces.spec.ts` and `tests/space-view.spec.ts` cover these with `pnpm verify:ui spaces.spec.ts space-view.spec.ts`. The 3-verify baseline has no sign-in, so it reaches the view only through `Open <space>` in Settings; starting threads needs a linked home.

## Thread context

Each turn of a thread in a space gets a `# Space: <name>` section in its per-turn instructions (sub-agents too). It lists the other projects with their checkout and branch here. A project missing here is cloned in the background, into its profile's folder (else the home folder), and listed as `not on this machine yet` until the clone is done. Its profile and clone URL come from a machine that has it, through the relay; this machine's own record of the project wins, and without a machine to ask the URL is `https://<key>.git`. A project that can't be cloned, such as a `local:` one from another machine, one no machine online has (an offline machine's last list doesn't count), or one whose clone failed (tried again after 10 minutes), is listed as `not available on this machine (<why>)`. With a home, a `## Home: <name>` part gives the home's checkout and its AGENTS.md as space-wide context, read again every turn and cut at 16 KB with the file's path. A thread in the home gets no copy of its own AGENTS.md. A home missing here is cloned before the thread's first turn, which waits for it; when that fails, the Home part says the home is not available on this machine and why, and the turn runs anyway. `start_thread` with `project` clones a missing sibling the same way before starting in it.

The UI doesn't show this text. Check it with the fake-harness suite `npx vitest run apps/worker/src/spaces/spaceContext.test.ts apps/worker/src/spaces/siblingThreads.test.ts`, which asserts on what each harness run received. In a real app, ask a thread in the space what its Space section says.

## New home in the worker

`spaces.createHome` checks the space's rules and that a thread can start in the profile (as `threads.start` would) before writing anything, then claims the folder, so a second request for the same name is refused. A failure while writing, committing, creating the GitHub repo or saving the space removes the folder (and the added project) again; a GitHub repo already created stays. `New GitHub repo` runs `gh repo create <login>/<name> --private --source <folder> --remote origin --push` as the profile's GitHub account chosen on this machine. Without one it is refused before anything is created; gh's active account is never used. The fake-harness suite `npx vitest run apps/worker/src/spaces/newHome.test.ts` covers the template, the home, the starter thread and its prompt, the refusals, and the GitHub path with a fake gh. Creating a real GitHub repo needs a signed-in gh and is not covered by any automated check: try it by hand with a disposable repo name and delete the repo afterwards.

## Gotchas

- `Create home` saves the space as the editor shows it, unsaved edits included; `Cancel` in the dialog leaves the editor as it was.

- `Cancel` on the editor leaves at once; only the sidebar, breadcrumb, Back and Escape ask `Discard changes?`.
- After `Delete <space>` the editor stays until the hub answers; wait for `Add space` before asserting the row is gone.
- A member whose project has no checkout on this machine is listed with `Not on this machine` (its key as its name), so saving keeps it. The space view lists it the same way, without `Dashboard`, and its `New thread` is disabled.
- A project with several checkouts here starts its `New thread` in the first one; pick another through the sidebar's `New thread`.
- The space view and the project dashboard share one place over the thread pane: `Dashboard` on a card replaces the view, and closing the dashboard returns to the thread pane.
