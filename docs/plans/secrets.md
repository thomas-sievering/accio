# Private secret entry and saved secrets

Status: implemented for the current local-machine release, 2026-11-03. Private entry, project memory, automatic reuse, Settings management, encrypted Hub storage, and Claude/Codex bridges ship together. Remote relay, opaque-reference consumers and external vaults remain future work. [ADR 0013](../adr/0013-private-secrets-and-project-memory.md) records the implementation decisions; the sections below preserve the agreed design and verification requirements.

## Outcome

A thread that needs a token uses an Accio-owned secret tool. Accio first resolves an existing binding for the current profile, project and credential purpose. If a permitted saved value is available, delivery happens automatically with a quiet use record, without displaying an input or confirmation card. Only missing information or access requires a card. The user's answer travels separately from messages and tool results. The harness receives either a temporary file path on its own machine or, when a compatible consumer exists, an opaque reference that the consumer resolves internally.

The initial handoff keeps the value out of the conversation. File delivery deliberately permits commands to read the value; Accio must say that clearly. Full-access harnesses and files owned by the same OS user are not a security sandbox.

The user can keep a named secret on the Hub and bind it to a permitted project so future turns, threads and harnesses can reuse it, including on other authorized paired machines. The binding belongs to the project identity, not its checkout path. The Hub already holds model-provider credentials and forwards authenticated requests, so reusable secrets extend that responsibility. The Hub still never runs a harness or shell command.

## Product decisions

- Use an inline request card, not the composer, a separate application window, or a global modal. Keep enough surrounding conversation visible to explain the task.
- The card asks for missing information. It does not introduce an approval prompt before ordinary tool calls; ADR 0005 continues to apply.
- A saved, permitted project binding is sufficient authorization for later uses within that policy. Do not ask the user to choose or approve that secret on every turn. Record **Using Cloudflare Pages deploy** quietly, with the saved source/project identified and no value.
- Show the secret's label, purpose, profile, project (or No project), requesting machine, and what will be able to use it. Derive identity from the server's thread context, not agent-written labels.
- In the internal one-time prototype, use **Use secret** and **Secret supplied**. In the first shipped project flow, make **Save & use** the primary action and **Use once** the explicit alternative, with **Saved for Personal / accio-site** scope copy. Say **Secret saved for this project** only when persistence and binding succeeded. Decline stays available.
- File-delivery copy: **Kept out of chat. Commands in this turn can read this secret.** Do not promise that an unrestricted agent can never inspect or print it.
- Recommend project memory through the explicit **Save & use** action rather than a hidden default or a preselected persistence checkbox. **Use once** never saves the value on the Hub. Default the saved name from the request label; renaming belongs in Settings rather than another required field in the card. Saving does not make the secret available to other projects or profiles.
- Never put a secret in a message, title, notification, copied transcript, tool input/result inspector, ordinary shared setting, URL, or browser storage.
- Match Accio's existing restrained dark interface: normal thread typography, one bordered card, neutral controls, and a quiet status indicator. Avoid a separate security-dashboard design.

## Settings placement

Add **Secrets** to the existing **Hub settings** navigation group with the first user-facing release, after Accounts. The internal transient-delivery prototype needs no page, but project memory needs a place to replace values and remove saved bindings from the outset.

Accounts remains named Claude and ChatGPT sign-ins. Hub under Connections remains the address, reachability and storage information for the Hub. Neither is a suitable management page for deployment tokens and MCP credentials.

Secrets has one list and one edit form. Require an explicit profile filter; a deep link from a thread selects its profile. A link from a profile's settings opens the same filtered list, rather than creating a second management surface. Ordinary navigation can remember a profile identifier locally, but never a value. Do not provide a global secret pool or silently combine personal and work credentials.

The list shows name, intended service/use, project access, updated time, and last-used time. Show delivery modes only when multiple supported modes make that information meaningful. Add secret is a page action; keep Replace and Delete on each row, with Rename and Change access in the edit form opened from the name. Values cannot be retrieved or revealed from the list or edit form. Replacement uses the same separate write-only transport as initial entry. Deletion removes Accio's stored value and outstanding grants; it does not claim to revoke the credential at the external service.

Settings and the exceptional thread picker share metadata and validation. A picker appears only when no deterministic project binding exists and a user must choose an existing eligible secret or authorize its project binding. It only offers same-profile entries the user can select and clearly identifies any new access being granted. Users need not leave the thread to supply a new value. The normal permitted saved-secret path has no picker.

## Resolution and project memory

Resolve credentials before publishing a pending card:

1. Look up a stable credential slot bound to the authenticated profile and project. A slot identifies the service, intended operation and relevant account/deployment target; a display label alone is not a safe lookup key. For example, Cloudflare Pages deploy for the selected account/target is different from a production database credential.
2. If the slot has one active permitted binding, deliver a fresh short-lived grant/file automatically. Do not wait for a click. File expiry or a consumed reference does not erase the saved value or its project binding.
3. If a suitable secret exists elsewhere in the same profile but this project has no binding, let the user choose/bind it once rather than pasting the value again. The agent cannot silently grant the project new access. If several candidates exist, ask once and remember the selected binding; do not pick by fuzzy label similarity.
4. If nothing suitable exists, show private entry with **Save & use**, **Use once**, and **Decline**. Saving stores the value on the Hub and binds the credential slot to this project; the next request resolves automatically. For No project, default to **Use once**; creating a profile-wide saved entry requires an explicit separate choice.
5. If the service reports an expired/revoked credential or insufficient access, explain the specific failure and offer replacement or a different binding. Do not delete a saved value merely because one request returned 401/403; the target or role may be wrong. A network failure or unavailable Hub produces an unavailable/retry outcome, not a fresh prompt to paste the same credential again.

Automatic reuse still validates profile/project, recipient machine, requested consumer/delivery, secret version and expiry for every grant. Narrow one-use delivery is independent of long-lived project memory. Deletion, access changes and replacement take effect on subsequent uses without relying on harness memory or chat history.

## Milestone 1: one-time entry for local commands

### User journey

1. The agent calls `request_secret` during an active turn with a label and a concrete reason. It does not ask the user to paste a token into chat.
2. A pending card appears in the thread. It contains a masked token input, **Use secret**, and **Decline**. The current turn remains running and Stop remains available. On its existing Working-shelf row, replace the spinner with a subtle **Needs a secret** indication derived from the pending request. Do not duplicate the thread elsewhere or add another durable thread status.
3. Submitting sends the value directly to the secret-request service, outside `threads.send`. Disable repeated submission while a request is in flight and retain the local value only when retry is necessary. Never echo submitted data in errors.
4. The machine writes the value into a protected, randomly named file outside the checkout and thread assets. The tool returns only `{ status: 'provided', file, expiresAt }`.
5. The agent reads the file inside the consuming command and keeps its contents out of stdout, command arguments, generated source and checked-in files. Passing a path to a CLI's existing file-input option is preferred when supported.
6. The card collapses to **Secret supplied**. The machine removes the file on turn completion/interruption and at a fixed expiry, whichever comes first.

If the collapsed row includes an expiry hint, it must cover both conditions, such as **For this turn · up to 15 min**. Do not say only that the file is removed at the end of the turn.

This first internal milestone intentionally supports file delivery only. Its tool description states that explicitly. It is a prerequisite, not the intended user-facing release by itself. Do not advertise an opaque-reference mode until at least one actual operation can consume it. The future `secretRef` default used by T3 is not useful without such a consumer.

### Tool and scope

Proposed initial input:

```ts
request_secret({
  slot: string, // stable service/operation/account-or-target purpose
  label: string,
  reason: string,
  clientRequestId?: string,
  timeoutMs?: number,
})
```

Require a live, authenticated tool session. Resolve `profileId`, `machineId`, `threadId`, `turnId`, and `projectId | null` server-side. Associate every request with that context. A model cannot name a different machine, thread or profile, supply a destination path, or turn an existing request into a different delivery mode.

Use a random request id and an idempotency key scoped to the invocation and thread/turn. Retrying the same invocation may return the same still-live delivery; it must not create another card or extend its expiry. Reject conflicting retry parameters. Initially allow one pending secret request per thread, with a clear safe error for parallel requests.

Default answer timeout: 10 minutes; maximum: 30 minutes. Delivered files expire after 15 minutes or when the turn ends. Return the actual expiry to the harness. A new request is necessary after timeout, cancellation, expiry or machine restart.

Limit the first version to UTF-8 token values, at most 16 KiB. Preserve the entered value exactly, including whitespace; do not normalize or trim a credential. Reject empty values. Multiline private keys, binary files and arbitrary credential bundles are later work.

### Lifecycle and recovery

Request states are `pending`, `provided`, `declined`, `expired`, and `cancelled`. File lifecycle is tracked separately so **provided** does not imply that the consuming command succeeded. Tool outcomes use those request statuses and return no value on failure.

- The first valid answer wins atomically across clients. Repeated submissions cannot overwrite an answer or deliver twice.
- Decline resolves the waiting tool promptly; the agent can continue with the remaining task or explain what needs the token.
- Stop, thread deletion, profile deletion, a failed harness connection, and turn completion cancel unanswered cards and clear any temporary delivery.
- Reconnecting a client reconstructs the card from metadata and status, never from the input value. Another paired client may answer once remote relay exists.
- A server restart marks pending requests cancelled, removes orphaned delivery files, and leaves the interrupted thread waiting for explicit Resume. It never replays a secret answer into a new turn.
- Do not steal focus from an active composer or another thread when a card arrives. Keep keyboard focus stable during submission and announce the result through a short live status.

Use memory for values between submission and file creation, with a narrowly scoped file writer; do not add a second durable plaintext answer store. Persist only enough nonsecret request and cleanup metadata for recovery.

### File protection and exposure

Create a dedicated directory owned by the machine's Accio service identity. On Unix, require directory mode 0700 and file mode 0600. On Windows, use and verify an appropriate owner/service ACL; Node's POSIX mode flags alone do not establish the same guarantee. Fail the delivery if the protection cannot be established.

Use exclusive creation, safe random names, no user-controlled file paths, UTF-8 without a BOM, and no following of an existing symlink/reparse point. Keep files out of the repository, profile config folders, transcript storage, attachment storage and ordinary backups. Cleanup runs at startup, on lifecycle changes and on a bounded expiry timer. Do not promise deletion on first read: arbitrary shell/file reads cannot reliably report consumption.

Accio's file-download, Markdown media snapshot and tool-media import routes must refuse managed secret paths. Do not make a secret file downloadable merely because a harness links to it. This reduces accidental exposure; unrestricted same-user commands can still copy or print values. A CLI may also persist its own login, so one-time delivery is not a promise that the receiving program stores nothing.

## Milestone 2: named secrets held by the Hub

Add the Settings entry described above, resolution before prompting, explicit **Save & use** / **Use once** entry, and a picker only for unbound or ambiguous saved credentials. This completes the first user-facing release together with milestone 1. Saved entries belong to one profile. Default project access is the current project; broader access requires an explicit Settings choice. A thread without a project can use a one-time value or a deliberately profile-wide saved entry.

Separate three concepts:

- A **saved secret** is a persistent named value on the Hub, with a version and access policy.
- A **grant** permits a specific thread/turn, machine and consumer/delivery to use a version. It is short lived and revocable.
- A **secret reference** is an opaque one-use handle for a registered consumer, not the saved value's stable identifier.
- A **project binding** maps a credential slot to a saved secret and its permitted use. This is what remembers the user's choice across turns, threads, harnesses and authorized machines.

An existing permitted secret can be reused within its configured access policy without an approval prompt on every use. New access or wider scope cannot be authorized by the agent itself. Saving a value does not implicitly enable every delivery mode or every integration.

Use a dedicated secret store and write-only value API. Metadata and identifiers can live with shared settings, but never raw values, decryption material or secret-bearing logs. Establish an encrypted-at-rest backend before releasing persistence: on Windows protect its key with DPAPI under the service identity; for a headless Hub, support an explicitly provisioned master key outside the data store. Document unlock/startup, backup and restore behavior and verify the intended deployment backend. Do not silently fall back to plaintext if a key or native store is unavailable. This milestone does not migrate existing Claude/ChatGPT account storage.

The user can replace a value without reading the previous one. Replacement increments its version and invalidates outstanding grants to the old version. Deletion also invalidates grants. Existing files are removed where reachable, but external processes and copied credentials cannot be recalled; externally revoking the token remains a service-specific action.

Keep a value-free use record: secret id/version, profile, project, machine, thread, operation, time and outcome. Do not record secret fingerprints, prefixes or suffixes as display hints.

### Consumer operations

Expose `secretRef` delivery only for registered consumers that accept a reference and resolve it entirely inside trusted service code. A grant is bound to that consumer and operation. Consume atomically once, validate scope and expiry before obtaining the value, and keep raw values out of tool responses and errors. Retry semantics depend on the operation: consuming once is not a guarantee that an external side effect succeeded or ran exactly once. Use the consuming operation's own idempotency support where available.

For Hub-side HTTP/MCP integrations, authenticate the allowed request on the Hub so the value need not reach the machine. Bind the destination and allowed operations in the integration definition, including redirect behavior; a generic arbitrary-URL proxy would defeat this separation. The Hub performs authenticated I/O, not a harness or a user shell command.

For commands that require credentials locally, grant explicit file delivery to the requesting machine over its authenticated connection. The Hub must not supply a filesystem path on its own computer. Reuse the temporary-file lifecycle from milestone 1.

Never extend the existing model-only profile key into a general credential-management or secret-read key. Secret tool sessions/grants need separate, limited authority. Accio's current same-process Hub placement is a deployment detail, not evidence of OS isolation; the separately protected Hub is the stronger boundary envisioned by ADRs 0001, 0002 and 0009.

## Later integrations

External vaults such as 1Password can back saved entries later. Persist their references and resolve them on the authorized service. An interactive laptop unlock is not a headless Hub authentication strategy; choose and verify the headless integration before offering it there. Avoid shipping a vault configuration page until an actual supported backend exists.

Automatic credential discovery, broad injection of all profile secrets into harness environments, arbitrary `get_secret` tools, browser password autofill, global clipboard watching, and a general password manager are outside this feature.

## Code boundaries

Implement by domain, following the repository's existing vertical slices:

- `packages/protocol/src/secrets.ts`: request metadata, safe states/events, answer/decline inputs, saved-secret metadata and credential-slot/project-binding identifiers. A dedicated authenticated `secretRequests.answer` method carries the private value; ordinary thread methods do not. Distinguish private submission bodies from broadcast/transcript types and never return raw validation errors containing submitted input.
- `apps/server/src/secrets/`: active requests, authenticated tool-session scope, waiting/cancellation, temporary-file delivery and cleanup. The machine owns thread/turn lifecycle.
- `apps/hub/src/secrets/`: milestone 2 storage, profile/project policies, grants, versions and registered Hub-side consumers. Do not import harness or thread execution code into the Hub.
- `apps/server/src/threads/harness.ts`: a small harness-neutral host-tools capability or broker reference bound to the running turn. Keep the request service independent of either SDK.
- `apps/server/src/threads/claudeCode.ts`: register the Accio tool through the SDK's supported MCP/tool mechanism and connect cancellation to the same service.
- `apps/server/src/threads/codex.ts` and `packages/codex/src/index.ts`: choose the bundled app-server's supported MCP or dynamic-tool mechanism. The current client rejects incoming client-tool requests, so prove that bridge before promising parity. Do not enable unrelated server requests or alter the Hub's account-only Codex usage.
- `apps/server/src/threads/threads.ts` and transcript handling: persist/broadcast metadata and cancel requests when the turn ends. A separate private answer route must bypass generic request/body logging and never flow through transcript or tool-detail serialization.
- `apps/web/src/secrets/`: inline request card, safe submission state, later picker and Settings forms. `Transcript.tsx` dispatches the typed card. `Settings.tsx` adds a Secrets route only in milestone 2.
- File/media serving and snapshot helpers: exclude managed secret storage and delivery paths. Failures must contain only safe labels/statuses.

The remote design uses the existing paired client/machine and Hub relay architecture when it exists. Milestone 1 can run within v0.1's local authenticated transport; it must not be described as proving remote pairing, revocation or relay.

## Delivery order

1. Prove tool registration and cancellation in both bundled harnesses with a harmless fixture. Establish the Windows file ACL approach. These are prerequisites to promising the feature's supported platforms/harnesses.
2. Add the request service, protocol, metadata-only transcript item and file cleanup. Keep a fake harness at the existing test boundary for deterministic lifecycle checks.
3. Add the inline card, decline/retry behavior, pending indication and file-delivery copy. Complete the internal milestone 1 only when both harnesses and Windows protection pass.
4. Prove the Hub credential-store backend and implement named profile-scoped entries, credential-slot/project bindings, versions and grants. Add automatic resolution, **Save & use** / **Use once**, Settings / Secrets, and a same-profile picker for exceptional unbound/ambiguous cases. Ship this combined flow as the first user-facing release, with explicit file-delivery policy.
5. Add the first actual registered opaque-reference consumer when its integration exists, then enable that delivery mode. External vault adapters follow demonstrated demand.

## Acceptance and verification

Use harmless unique marker values, never real user credentials, in fixtures and retained evidence.

- Drive the real card through the production UI: supply, decline, duplicate submission, safe error/retry, navigation away/back and reconnect. Verify the pending card and resulting state, not only a screenshot.
- Assert that a marker is absent from transcript files, tool-detail files, notifications, browser console/error output, ordinary RPC logs, shared settings, URLs and file/media downloads. Inspect the complete relevant outputs rather than only searching a summary. Do not claim that unrestricted shell stdout can be universally sanitized.
- Exercise cross-thread, cross-profile, wrong-machine, stale-turn, wrong-consumer and expired-grant rejection with the trusted identity boundary intact. An agent-supplied id must not change scope.
- Race two clients and two consumers; only the valid first operation wins. Retry the same tool invocation and check that neither delivery nor deadline is duplicated.
- Stop the turn, interrupt the harness, restart the server and expire a file. Confirm cleanup and that Resume asks again instead of reusing an old answer. Verify private directory/file access on Windows and a supported Unix target.
- Deny secret paths through file download, media snapshot and tool-media import, including indirect and platform-specific path forms supported by those routes.
- Prove an actual `request_secret` tool round trip with both Claude and Codex. Fake-harness UI coverage does not establish native tool registration. Never use a real token for this check.
- For milestone 2, add UI coverage for create, replace, scope changes, exceptional saved selection and delete; prove old grants fail and permitted same-profile uses work. Save for a project, then use the same slot from a new turn/thread and another authorized machine/harness: no input, picker or confirmation card should appear. A new file/grant is delivered even after a previous one expired. Verify **Use once** creates no persistent value or binding, another project/profile gets no silent access, ambiguous bindings ask only once, and Hub/network failures never cause a duplicate credential-entry prompt. Check browser storage contains no values and that unrelated clients receive only metadata.
- Run the repository's appropriate unit/integration checks and `pnpm typecheck`. Run `pnpm test:chat` for transcript/card changes and the project verification journey for the changed Settings flow. Add mapped entry points to the verification skill's feature map when implementation lands.

## Design artifacts

Opus 5.5 produced the [interactive mockup](secret-entry/mockup.html), [thread screenshot](secret-entry/thread.png), and [Settings screenshot](secret-entry/settings.png), and subsequently implemented the production UI in `apps/web/src/secrets/`. The standalone artifacts remain historical design explorations; the production card includes **Save & use** / **Use once** and automatic saved-secret reuse without confirmation. The browser journey in `tests/secret-ui.spec.ts` exercises the shipped flow.

## Sources

- [T3 request tool](https://github.com/pingdotgg/t3code/blob/499727ddad87468cc22e23e5d8c92b9013f546c0/apps/server/src/mcp/toolkits/orchestrator/tools.ts)
- [T3 request lifecycle and delivery](https://github.com/pingdotgg/t3code/blob/499727ddad87468cc22e23e5d8c92b9013f546c0/apps/server/src/secrets/SecretRequests.ts)
- [T3 private-card copy and states](https://github.com/pingdotgg/t3code/blob/499727ddad87468cc22e23e5d8c92b9013f546c0/packages/client-runtime/src/secretRequest.ts)
- [T3 filesystem secret store](https://github.com/pingdotgg/t3code/blob/499727ddad87468cc22e23e5d8c92b9013f546c0/apps/server/src/auth/ServerSecretStore.ts)
- [Accounts live only on the Hub](../adr/0002-accounts-live-only-on-the-hub.md)
- [The Hub owns shared settings](../adr/0004-hub-owns-shared-settings.md)
- [Threads run with full permissions](../adr/0005-threads-run-with-full-permissions.md)
- [The Hub never runs threads](../adr/0009-the-hub-never-runs-threads.md)
