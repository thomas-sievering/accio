# Thread naming

Open Settings, then `Thread naming` in `.sidebar nav`. No provider account is
needed to inspect or save settings. Title generation and previews need an
available model and an existing thread.

- `naming-settings`: toggle `Automatically name new threads`, choose the
  `Naming model` MenuSelect, expand `Advanced`, and edit `Naming instructions`.
  Click `Save naming settings`, require `Naming settings saved`, reload and
  verify the saved values. Restore fixture preferences after the journey.
- `naming-preview`: choose `Example thread`, click `Try instructions`, and require
  an example title without changing the existing thread's title. The preview uses
  the current unsaved instructions. `tests/naming.spec.ts` covers this with the
  scripted provider boundary.
- `naming-unsaved`: change the automatic-title checkbox and instructions, then
  try another Settings section, Back and Escape separately. Check whether a
  discard guard appears and whether returning preserves the edits. Record silent
  loss as a UX finding; the current implementation discards changes on section
  navigation without a guard. A successful explicit save does not cover this.
- `naming-thread`: send a first message, require an automatically generated
  title, rename in the header and sidebar, reload, then use `Regenerate title`
  from Thread actions. `tests/naming.spec.ts` covers these entry points; live
  provider naming remains separate proof.
