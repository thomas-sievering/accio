# Accounts

Users name Claude or ChatGPT accounts, sign in with the provider, and select those accounts in profiles. Referenced accounts cannot be deleted.

On a hub with a Sorting Hat of its own, accounts live there and the same recipes apply; its differences are in [Sorting Hat](sorting-hat.md).

## Sub-features

- `accounts-named`: add, rename, cancel and delete a named provider account.
- `accounts-onboarding`: create/select an account directly from first-run setup.
- `accounts-claude`: automatic browser sign-in, cancellation and sign-out.
- `accounts-chatgpt`: automatic browser sign-in, cancellation and sign-out.
- `accounts-in-use`: deletion is disabled while a profile references the account.

## How to get to it (user POV)

- Open `Settings` then `Accounts`. Choose `Add Claude account`, `Add ChatGPT account`, or an existing account.
- After adding the first profile, use onboarding's `Provider` radio cards, the provider account menu (when accounts exist) and `Continue`.
- Select an account under Settings / Profiles to use it for coding.

## Driving it with Playwright

Preconditions: healthy isolated instance; a profile for selection/guard checks. Provider completion requires access to a real provider account and consent by its owner. Baseline has neither authentication nor an OAuth-code fixture; report completion unverified if unavailable. Real turns can use the verify device's hub accounts instead (see [Real model turns](../SKILL.md#real-model-turns)); that is not sign-in proof.

- **Create through settings.** Click `Settings`, then `page.locator('.sidebar nav').getByRole('button', { name: 'Accounts', exact: true })`. Click button matching `/^Add ChatGPT account/` (or `/^Add Claude account/`), fill textbox `Account name`, click exact `Add account`. Require button `Sign in with ChatGPT` (or `Sign in with Claude`), click `Cancel`, require a row named `Verify ChatGPT Signed out` for the smoke's account.
- **Rename/cancel/delete.** Reopen that account row. Edit `Account name`, click `Save`, require the account list, and reopen to check the value. Cancel a new account via exact `Cancel` and require no new row. For an unreferenced account click `Delete` and require absence from the list.
- **First-run entry.** On the `Choose an account for …` step, click the `ChatGPT` or `Claude` radio in radiogroup `Provider`, then `Continue`. With no account at that provider yet, this creates `<profile> <provider>` and shows the matching provider sign-in button. When accounts exist, the `ChatGPT account` (or `Claude account`) MenuSelect offers `New account` and each named account; choose one, click `Continue`, and require its selection to persist in Profiles.
- **Deletion guard.** Select the account in a profile and save (see [Profiles](profiles.md)). Reopen the account in Accounts and assert `await page.getByRole('button', { name: 'Delete', exact: true }).isDisabled()`. Require text explaining the profile using it. Remove its profile reference before testing deletion.
- **Browser sign-in (both providers).** Click exact `Sign in with Claude` or `Sign in with ChatGPT`; require status `Waiting for sign-in. Accio will finish automatically.` and the provider consent page. Complete browser approval with the account owner; require `Signed in as` in Accio without entering a code. Test both a local hub and a remote Linux hub through its public address. Keep authorization URLs, callback codes, pairing codes and credential stores out of evidence. A plain account name is safe to record.
- **Cancel/sign out.** Cancel a waiting attempt and require the waiting UI to disappear. A late callback must fail. Sign out with exact `Sign out`; require the identity to disappear and affected profile sends to become disabled. Switching hubs during a pending attempt must preserve its original hub; return to that hub to observe completion.
- **Proof.** Capture before/after each action and use the profile's account selector as a second UI view. Record safe account metadata only. The smoke covers named ChatGPT creation, profile selection and the in-use guard; it never begins OAuth.

## Gotchas

- Sign-in opens an external browser tab and contacts a provider; it is not an offline or dry-run action. Close only tabs created by the journey.
- Sign-in requires Accio running on the browser's PC. A callback-port conflict is a failed attempt with retry, not a reason to offer a different login method.
- A named account and an enabled sign-in button do not establish provider authentication.
- The empty home cannot prove OAuth completion. Never copy the user's regular `.claude`, `.codex` or `.accio` credentials into a fixture or forge a signed-in store.
