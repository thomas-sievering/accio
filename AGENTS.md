# Working in Accio

Read [GLOSSARY.md](GLOSSARY.md) when changing domain behavior or UI wording.
For architecture changes, consult the relevant accepted [ADRs](docs/adr); plans
under `docs/plans` record scope and history and may predate the implementation.

## Find the existing owner

| Change | Start here |
| --- | --- |
| Thread state and lifecycle | `apps/worker/src/threads/threads.ts`, `state.ts`, `turns.ts` |
| Queued messages, goals and delivery wakeups | `Turns.dispatchPending` in `turns.ts` |
| Delivery policy and Git proof | `threads/deliveries.ts`, `delivery.ts`, `scriptedShip.ts` |
| Model availability and selection | `apps/worker/src/harnesses/models.ts`, `packages/protocol/src/models.ts` |
| Remote thread support | `apps/worker/src/relay/relay.ts`, `packages/protocol/src/relay.ts` |
| UI action availability | `apps/web/src/threads/useThreadAvailability.ts` |
| Accounts, houses, hat keys, sign-in, limits, account in use and forwarding; model lists and usage | `apps/sorting-hat/src/sortingHat.ts`, `proxy.ts` (model lists in `models.ts`, usage in `usage.ts` and `usageTap.ts`); its HTTP management API in `api.ts` ([API.md](apps/sorting-hat/API.md)), its dashboard in `dashboard.ts` and `apps/sorting-hat/dashboard/` (Cloudflare Access check in `access.ts`) and standalone start in `standalone.ts` (the hub embeds it through `SortingHatApi` in its `index.ts`) |
| A hub's own Sorting Hat: admin token, profiles' houses, hat keys per profile and machine | `apps/hub/src/sortingHatLink.ts`, its HTTP client `sortingHatClient.ts`; threads receive the key and address through `machine.modelKey` in `apps/worker/src/profiles/profiles.ts` |
| Saved media | `apps/worker/src/threads/assets.ts`, web `threads/assetUrl.ts`, `useSavedAsset.ts` |
| First-message handoff | web `threads/ThreadPane.tsx`, `sentImages.ts` |
| App boundaries and roles | [README.md](README.md#how-it-fits-together) |

Worker thread paths above are relative to `apps/worker/src/` unless fully qualified.

## Concurrent work

Before editing, identify the existing owner and consumers of the behavior. Keep
policy in that owner and reuse it from entry points. A task brief should name the
behavior, owning module, edit scope and verification seam. After integrating
worktrees, inspect semantic overlap as well as Git conflicts: look for competing
eligibility checks, caches, retry loops and state transitions. Extract shared
behavior only when actual callers need it; keep presentation in its feature.

## Verify the changed behavior

Follow [docs/verification.md](docs/verification.md) to select checks and diagnose
failures. For browser interactions, read the affected [feature recipes](.agents/skills/3-verify/features/README.md)
and use the isolated fixture or linked verification runner described there.
Use disposable data and repositories for verification, including publication checks.
Update the affected recipe when behavior or entry points change.
