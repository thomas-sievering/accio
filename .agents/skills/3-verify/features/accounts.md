# Accounts

Users name Claude or ChatGPT accounts, sign in with the provider, and select those accounts in profiles. Referenced accounts cannot be deleted.

## Sub-features

- `accounts-named`: add, rename, cancel and delete a named provider account.
- `accounts-onboarding`: create/select an account directly from first-run setup.
- `accounts-claude`: consent-page/code sign-in, cancellation and sign-out.
- `accounts-chatgpt`: device-code sign-in, cancellation and sign-out.
- `accounts-in-use`: deletion is disabled while a profile references the account.

## How to get to it (user POV)

- Open `Settings` then `Accounts`. Choose `Add Claude account`, `Add ChatGPT account`, or an existing account.
- After adding the first profile, use onboarding's `Provider`, provider account selector, `Account name` and `Use account` controls.
- Select an account under Settings / Profiles to use it for coding.

## Driving it with Playwright

Preconditions: healthy isolated instance; a profile for selection/guard checks. Provider completion requires access to a real provider account and consent by its owner. Baseline has neither authentication nor an OAuth-code fixture; report completion unverified if unavailable.

- **Create through settings.** Click `Settings`, then `page.locator('.sidebar nav').getByRole('button', { name: 'Accounts', exact: true })`. Click button matching `/^Add ChatGPT account /` (or `/^Add Claude account /`), fill textbox `Account name`, click exact `Add account`. Require button `Sign in with ChatGPT` (or `Sign in with Claude`), click `Cancel`, require a row named `Verify ChatGPT Signed out` for the smoke's account.
- **Rename/cancel/delete.** Reopen that account row. Edit `Account name`, click `Save`, require the account list, and reopen to check the value. Cancel a new account via exact `Cancel` and require no new row. For an unreferenced account click `Delete` and require absence from the list.
- **First-run entry.** On the `Choose an account for …` step, select combobox named `Provider`, choose `OpenAI · ChatGPT` or `Anthropic · Claude`, leave `Add a new account` selected, fill textbox `Account name`, click `Use account`. Require the matching provider sign-in button. Repeat with an existing named account through the provider-specific account combobox; require its selection to persist in Profiles.
- **Deletion guard.** Select the account in a profile and save (see [Profiles](profiles.md)). Reopen the account in Accounts and assert `await page.getByRole('button', { name: 'Delete', exact: true }).isDisabled()`. Require text explaining the profile using it. Remove its profile reference before testing deletion.
- **Claude sign-in.** Click exact button `Sign in with Claude`, require placeholder `Code from Claude` and the external consent page. With owner-approved provider completion, enter its returned code using that placeholder and click `Finish`; require `Signed in as` and the expected identity. Test `Cancel` separately; signing out uses exact `Sign out` and must restore the sign-in button and disable affected profile sends.
- **ChatGPT sign-in.** Click exact button `Sign in with ChatGPT`; require a displayed device code, status `Waiting for sign-in…` and the provider page. Complete that provider flow with the account owner, then require `Signed in as`. Test `Cancel` separately; require the waiting UI to disappear. Sign out with `Sign out` and verify the identity disappears.
- **Proof.** Capture before/after each action and use the profile's account selector as a second UI view. Record safe account metadata only. The smoke covers named ChatGPT creation, profile selection and the in-use guard; it never begins OAuth.

## Gotchas

- Sign-in opens an external browser tab and contacts a provider; it is not an offline or dry-run action. Close only tabs created by the journey.
- ChatGPT device-code login can be disabled by account/workspace policy. That is a failed prerequisite for this journey, not a passing sign-in test.
- A named account and an enabled sign-in button do not establish provider authentication.
- The empty home cannot prove OAuth completion. Never copy the user's regular `.claude`, `.codex` or `.accio` credentials into a fixture or forge a signed-in store.
