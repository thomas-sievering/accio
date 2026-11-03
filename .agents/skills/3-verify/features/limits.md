# Account limits

Limits follow profile → provider → account. The hub caches each named account once; profiles sharing it see one allowance. The UI shows reported windows, observation time and refresh problems separately.

## Entry points

- `limits-sidebar`: sidebar button `Limits`; defaults to the open thread/draft profile, then the sidebar filter, then All profiles.
- `limits-composer`: `.limits-chip` beside the selected model, opening that profile's limits. It appears for a signed-in selected account.
- `limits-account`: Settings / Accounts / named account / Limits, including an account no profile selects.
- `limits-navigation`: profile radios, shared-account references, account settings, Escape/close and returning to threads.
- `limits-refresh`: account/global refresh, failure with last-known values, retry deadline, reset confirmation, disconnect/reconnect and credential changes.

## Drive the production instance

Use the isolated runner from [3-verify](../SKILL.md). The empty home supports signed-out and missing-account paths. Create a profile and named account through the UI, select that account in the profile, then return to threads.

1. Click `page.getByRole('button', { name: 'Limits', exact: true })`. Require the profile radiogroup and rows only for selected accounts. A selected signed-out account says `Signed out` without a numeric meter. Providers without selected accounts are hidden in both individual and All profiles scopes; a profile with no selected accounts says `No accounts selected for this profile.`
2. Choose a radio with `page.getByRole('radio', { name: profileName, exact: true })`. ArrowRight/ArrowLeft must change selection and focus together. `All profiles` shows profile headings. With a shared account, require one account card and a reference from its other profile; `Show limits` must focus the original card.
3. An account card's `<account name> settings` button and its `Sign in` action must open the named account, whose Limits section uses the same data. Back returns to Limits.
4. Type an unsent message in a signed-in scratch draft or thread, then click `.limits-chip`. Require its profile radio checked, regardless of the previously viewed profile. Close/Escape returns to the unchanged message and restores focus. Repeat through account settings and Back. Opening a thread, including the thread already selected, leaves Limits and preserves its unsent follow-up.
5. For a successful provider read, require the expected named account, meter values, reset label and observation time. Model-specific windows are under `Model-specific limits`. Unknown usage says `Unknown` rather than a numeric meter. A used-up weekly window leaves reported session values intact.
6. Refresh the account. During refresh keep its previous values visible. After a failed refresh require `Last known`, the original observation timestamp, safe error text and a disabled Retry until its displayed deadline. When a reset passes, require `awaiting confirmation` or `checking…`, without a fabricated refill. Disconnecting must retain values, show a connection banner and disable refresh; reconnecting must recover.
7. Sign out in account settings. Require its meters to disappear immediately. Reauthenticate with a different identity: old values must clear and new limits must load without waiting for the minute timer. Removing an account's profile selection must leave other profiles and that account's own settings intact.

Wrap each exercised entry in `action`, capture its visible state, and record unverified branches with their missing prerequisites. The baseline does not have real provider authentication or controlled provider failures; it cannot establish successful upstream usage reads.

## Deterministic regression proof

`tests/limits.spec.ts` drives the real React app and server from an empty temporary home. Sign-in, profile selection and navigation all use the UI. `scripts/limits-test-server.ts` substitutes only provider I/O and model execution at existing production boundaries. Its scripted failure, unknown usage, reset and reauthentication cases verify frontend integration, not real provider compatibility. It closes its own provider popups and temporary server/home.

The suite captures all-profile, failed-refresh, disconnected, narrow-layout and composer evidence under Playwright's configured output directory. Run it with `pnpm test:limits`. Run the committed chat checks too when changing the composer entry or thread navigation. The hub's unit/RPC tests cover shared fetches, distinct account identities, safe errors, retry backoff, cancellation and late old-credential responses; browser tests do not replace those checks.
