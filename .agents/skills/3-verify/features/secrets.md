# Secrets

Use this flow for private input, saved project credentials, the Working-row marker, or Settings / Secrets changes.

## Deterministic journey

Run `pnpm test:secrets`. It builds and drives the production UI/server with a scripted harness at the existing `AppDeps.harness` boundary, two signed-in fixture profiles, a disposable git project and dummy marker values. The fixture owns port 47483; do not attach to another process on that port. No real provider account or inference is used. `tests/setup-secrets.ts` owns the child, asks it to shut down over IPC and waits for private-file cleanup on Windows too.

`tests/secret-ui.spec.ts` drives Save & use, a second request with automatic reuse and no input/confirmation, Settings list, replacement, explicit profile-wide access, an empty other profile, deletion, Use once and Decline. The fixture reads delivered bytes at the harness boundary, checks for accidental values in thread storage, and removes its home. Inspect `out/secrets-ui/cleanup.json` after completion; all cleanup/exposure flags must be true. Trace, screenshot and video collection are disabled while typing. Use dummy markers only.

Native bridge coverage is separate: `pnpm exec vitest run apps/server/src/secrets` includes actual Claude CLI/SDK and pinned Codex calls against local scripted provider responses, including a pre-feature Codex thread resumed through the scoped MCP endpoint. It also checks encryption/reopening, project binding, cross-profile rejection, duplicate answers, cancellation, expiry, replacement/deletion invalidation and private file/media exclusions. These checks establish protocol behavior, not live-provider authentication or remote relay.

For hub connection changes, also run the hub service and machine connection tests. They exercise scoped secret resolution over authenticated HTTP, metadata-only snapshots/cache, rejection of model keys, matching profile IDs on independent hubs, and deletion of a machine-local delivery after hub removal or rotation of its saved secret. These use disposable keys and values; a production tunnel still needs its own observed check.

## User-facing entry points

- **secrets-request:** A harness calls `request_secret` with a stable service/operation/target purpose, label and reason. Open the thread's Working row and require `section.secret` with Needs a secret, correct profile/project/machine, masked input and the file-delivery privacy note. Type into `getByPlaceholder('Paste secret')`; Save & use is primary in a project, Use once is available, and Decline resolves without storing a value. A No project thread omits Save & use. Pending turns remain running and Stop stays available.
- **secrets-reuse:** Request the same purpose in another turn/thread in that project. Require a quiet Using record, no value field or confirmation, and continued work. A suitable same-profile unassigned secret offers Use selected once, with the project-access change explained; subsequent requests resolve automatically.
- **secrets-settings:** Open Settings, then scope navigation to `.sidebar nav` and click Secrets. Select `getByRole('combobox', { name: 'Profile', exact: true })`; wrapped labels can include option text, so use the combobox role. Verify metadata only. Add secret opens a write-only value form; its Used for field identifies the stable purpose. A name opens metadata/access editing, Replace opens a blank New value field, and Delete requires the explicit in-row Delete secret action. Reopen/reload to confirm persistence without retrieving values.
- **secrets-profile-link:** Settings / Profiles / one profile / Saved secrets and a thread's saved-use Manage link open the same Secrets page filtered to that profile. Switching profiles while a form is open is disabled; cancel/finish before switching.
- **secrets-recovery:** Stop during a pending card, expire it, or restart the owned disposable instance. Require cancellation/expiry and file removal. Saved values persist and can be reused through a fresh delivery; Use once creates no project memory. Never use a user's token to exercise these cases.

For a production-server journey without the scripted harness, use the main 3-verify runner. Create profiles/projects through its UI and exercise Settings add/edit/replace/delete with disposable values. Request cards additionally require a signed-in harness that actually calls the tool; do not seed transcript rows and report that as an end-to-end tool check. Record each entry as verified or unverified with its unmet prerequisite.

## Evidence boundaries

Capture a card only while its input is blank or after its value field is gone. Do not retain request bodies, value fields, provider stores, encryption keys or private-file contents in artifacts. Inspect only value-free metadata and cleanup/exposure flags. On non-Windows platforms saved storage requires a provisioned `ACCIO_SECRET_KEY`; unavailable saving must still leave Use once functional. Windows DPAPI and owner-only ACL behavior need a Windows run, and Unix permission behavior needs a Unix run. A local check does not establish another machine's delivery or pairing.
