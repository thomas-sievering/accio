# Profiles

Profiles separate personal/work configuration and choose one named account per provider. Saved names and selections must survive reopening the app.

## Sub-features

- `profiles-first-run`: create the first profile during onboarding.
- `profiles-settings`: add or cancel another profile in Settings.
- `profiles-edit`: rename and select Claude/ChatGPT accounts independently.
- `profiles-delete`: delete unused profiles; protect profiles with projects or threads.

## How to get to it (user POV)

- From an empty home, keep `This PC` under `Set up Accio` and choose `Continue`, then enter a name and choose `Continue`.
- Choose `Settings` then `Profiles`; choose `Add profile` or an existing profile row.
- In a signed-out thread draft, choose `Choose account` to open that profile directly.

## Driving it with Playwright

Preconditions: healthy empty instance for onboarding. Other entries require a profile; create it through onboarding. Account selection requires named accounts from [Accounts](accounts.md).

- **Onboarding.** Click exact button `Continue` on the hub question (`This PC` is preselected), then `await page.getByPlaceholder('personal, work…').fill('Verify personal'); await page.getByRole('button', { name: 'Continue', exact: true }).click()`. Require text `Choose an account for Verify personal`. This proves profile creation, not completion of sign-in or project onboarding.
- **Settings creation.** Click button `Settings`, then `page.locator('.sidebar nav').getByRole('button', { name: 'Profiles', exact: true })` when switching sections. Click `page.getByRole('button', { name: /^Add profile/ })`, fill textbox `Name` with `Verify work`, click exact button `Add profile`. Require heading `Verify work`. Click `Cancel` to return to the list; the new profile is already saved.
- **Cancel.** Open `Add profile`, fill `Name` with `Discard me`, click `Cancel`. Require no profile button starting with `Discard me`, and no such persisted profile.
- **Rename/reopen.** Click profile button matching `/^Verify work No account selected$/`, fill textbox `Name` with `Verify work renamed`, click `Save`. Reload, reopen Settings, reopen that renamed row, and assert `inputValue()` equals the saved name.
- **Provider selection.** Each provider shows an ordered list (`OpenAI · ChatGPT accounts`, `Anthropic · Claude accounts`) or `No ChatGPT account selected.` After creating `Verify ChatGPT`, click button `Add ChatGPT account`, then in menu `Add ChatGPT account` click menuitemradio `/^Verify ChatGPT/` (its detail reads `Signed out`). Click `Save`, reopen and require `Verify ChatGPT` in list `OpenAI · ChatGPT accounts`. Do the same for `Verify Claude` through `Add Claude account`. Choosing one provider must preserve the other's list. With one account chosen, the next menu is `Add another ChatGPT account`; `Move <name> up` reorders, `Remove <name>` drops one, and the signed-in account in use shows `In use`.
- **Delete.** In an unused profile form click exact button `Delete`; require its row and persisted record to disappear. With a project/thread using that profile, attempt deletion and require the visible in-use error plus intact record.
- **Thread notice entry.** Open a signed-out draft following [Threads](threads.md), then click button `Choose account`. Require that draft's profile name in the `Name` textbox.
- **Proof.** `await capture('profiles-persisted')`. Inspect only the `profiles` fields in `<home>/hub/settings.json`; compare account selections through the reopened UI or read-only `profiles.list`, keeping credential material out of artifacts. The default smoke executes onboarding, settings creation, cancel, rename/reload, deletion of an unused profile, and ChatGPT selection.

## Gotchas

- Settings and onboarding use different name handles. The first-run input has a placeholder, while the settings form has a labeled textbox.
- Profile rows include account status in their accessible names. Match the expected full name or a constrained regular expression.
- Reload resets the selected settings section; reopening it is part of the persistence check.
- The baseline has no signed-in account. A selected signed-out account must keep coding disabled.
- Account mappings live with sensitive hub data; observe through UI/read-only RPC rather than copying the whole hub credential file.
