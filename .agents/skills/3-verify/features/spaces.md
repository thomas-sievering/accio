# Spaces

A space groups projects that share context and can mark one of them as its home (GLOSSARY: Space, Home; ADR 0019). Spaces are shared settings on the hub, the same on every paired machine. A project is identified by its repository key, or `local:<project id>` without a remote.

## Sub-features

- `spaces-create`: add a space with a name and projects.
- `spaces-edit`: rename, add or remove projects.
- `spaces-exclusive`: a project already in another space is disabled in the picker, showing that space's name; the hub refuses it too.
- `spaces-home`: set, change and clear the home; removing the home's project clears it.
- `spaces-delete`: delete only the grouping; projects, checkouts and threads stay.

## How to get to it (user POV)

- Settings, group `Projects and machines`, section `Spaces`.
- Each space is a row with an `Edit <space>` button; `Add space` sits under the list.

## Driving it with Playwright

Preconditions: healthy instance with at least two projects (add them as in [Projects](projects.md); local folders without a remote are fine).

- **Create.** In `page.locator('.sidebar nav')` click exact `Spaces`, then the button matching `/^Add space/`. Fill textbox `Name`; in group `Projects` check the projects' checkboxes (their names start with the project name). Choose the home with the `Home` MenuSelect (button `Home`, then a menuitemradio in menu `Home`), then click exact `Add space`. Require the row to read `<n> projects · Home <project>`, and the saved space in the hub's `hub/settings.json` under `spaces` (or from `spaces.list`).
- **Exclusive.** Open `Add space` again. Require a project of the first space to be a disabled checkbox whose label shows `In <space>`. `Cancel` leaves without saving.
- **Home.** `Edit <space>`, pick another home, then uncheck the home's project: require the `Home` button to read `No home`. `Save`; require the row to read `No home`.
- **Delete.** `Edit <space>`, `Delete`, then `Delete <space>`. Require the list back with no such row, and the projects still listed in Settings / Projects.

The chat fixture's spec `tests/spaces.spec.ts` covers these with `pnpm verify:ui spaces.spec.ts`.

## Gotchas

- `Cancel` on the editor leaves at once; only the sidebar, breadcrumb, Back and Escape ask `Discard changes?`.
- After `Delete <space>` the editor stays until the hub answers; wait for `Add space` before asserting the row is gone.
- A member whose project has no checkout on this machine is listed with `Not on this machine` (its key as its name), so saving keeps it.
