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
| Accounts, houses, hat keys, sign-in, limits, account in use and forwarding; model lists and usage | `apps/sorting-hat/src/sortingHat.ts`, `proxy.ts` (model lists in `models.ts`, image routes in `images.ts`, usage in `usage.ts` and `usageTap.ts`); its HTTP management API in `api.ts` ([API.md](apps/sorting-hat/API.md)), its dashboard in `dashboard.ts` and `apps/sorting-hat/dashboard/` (Cloudflare Access check in `access.ts`) and its start in `standalone.ts` |
| The hub's link to its Sorting Hat: admin token, address for threads, profiles' houses, hat keys per profile and machine | `apps/hub/src/sortingHatLink.ts`, its HTTP client `sortingHatClient.ts`; threads receive the hat key and address through `machine.modelKey` in `apps/worker/src/profiles/profiles.ts` |
| Saved media | `apps/worker/src/threads/assets.ts`, web `threads/assetUrl.ts`, `useSavedAsset.ts` |
| First-message handoff | web `threads/ThreadPane.tsx`, `sentImages.ts` |
| App boundaries and roles | [README.md](README.md#how-it-fits-together) |

Worker thread paths above are relative to `apps/worker/src/` unless fully qualified.

## Motion

Plain CSS owns fades, hovers, presses and popover open/close (`apps/web/src/ui/motion.css`,
whose `--ease-settle` and timings are the house curve); view transitions own handoffs between
screens and the composer. Reach for `motion` (`motion/react`) only when CSS can't do it well:
springs that must stay interruptible, layout animations (rows sliding into place, height to
`auto`), exit animations of React-removed elements, and drag or gesture-driven values. Every
animation honours `prefers-reduced-motion`. For motion work see the `animate`,
`review-animations` and `smooth-ui` skills; for any new UI dependency use `pick-ui-library`.

## Waiting on an action

A click that waits on the server shows the wait on the control that started it: use
`Button` from `apps/web/src/ui/Button.tsx` with `busy` and an "-ing…" `busyLabel`
("Saving…", "Creating…"). It keeps its colour, shows a spinner (after 150 ms, so quick
actions don't flash) and takes no clicks. Never swap the label by hand and disable the
button: that fades it, which reads as unavailable; lint rule `accio/busy-button` flags it.
`SettingsFooter` and `ConfirmAction` already do this, given `busy` (and `busyLabel` for
anything but "Saving…"). Where one `busy` covers several buttons, track which one was
pressed so only it shows the wait; the others are just disabled.

- **Long waits.** When it can take more than a couple of seconds (git, GitHub, a clone, a
  model), also say in plain words what is happening, in a `role="status"` line beside it.
- **Lock only what the action depends on.** In a sheet, disable the form's fieldset while
  it saves. Block closing (`Sheet`'s `busy`) only when closing would hide work that keeps
  running; otherwise let the user move on.

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
