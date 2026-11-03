# Profiles

Profiles separate personal/work configuration and choose one named account per provider. Saved names and selections must survive reopening the app.

## Sub-features

- `profiles-first-run`: create the first profile during onboarding.
- `profiles-settings`: add or cancel another profile in Settings.
- `profiles-edit`: rename and select Claude/ChatGPT accounts independently.
- `profiles-delete`: delete unused profiles; protect profiles with projects or threads.

## How to get to it (user POV)

- From an empty home, enter a name under `Set up accio` and choose `Add`.
- Choose `Settings` then `Profiles`; choose `Add profile` or an existing profile row.
- In a signed-out thread draft, choose `Choose account` to open that profile directly.

## Driving it with Playwright

Preconditions: healthy empty instance for onboarding. Other entries require a profile; create it through onboarding. Account selection requires named accounts from [Accounts](accounts.md).

- **Onboarding.** `await page.getByPlaceholder('personal, work…').fill('Verify personal'); await page.getByRole('button', { name: 'Add', exact: true }).click()`. Require text `Choose an account for Verify personal`. This proves profile creation, not completion of sign-in or project onboarding.
- **Settings creation.** Click button `Settings`, then `page.locator('.sidebar nav').getByRole('button', { name: 'Profiles', exact: true })` when switching sections. Click `page.getByRole('button', { name: /^Add profile / })`, fill textbox `Name` with `Verify work`, click exact button `Add profile`. Require heading `Verify work`. Click `Done` to return to the list.
- **Cancel.** Open `Add profile`, fill `Name` with `Discard me`, click `Cancel`. Require no profile button starting with `Discard me`, and no such persisted profile.
- **Rename/reopen.** Click profile button matching `/^Verify work No account selected$/`, fill textbox `Name` with `Verify work renamed`, click `Save`. Reload, reopen Settings, reopen that renamed row, and assert `inputValue()` equals the saved name.
- **Provider selection.** After creating `Verify ChatGPT`, use `await page.getByRole('combobox', { name: /OpenAI · ChatGPT account/ }).selectOption({ label: 'Verify ChatGPT · Signed out' })`. For a named `Verify Claude` account, use the `/Anthropic · Claude account/` combobox and option `Verify Claude · Signed out`. Click `Save`, reopen and inspect each selected option. Choosing one provider must preserve the other's selection.
- **Delete.** In an unused profile form click exact button `Delete`; require its row and persisted record to disappear. With a project/thread using that profile, attempt deletion and require the visible in-use error plus intact record.
- **Thread notice entry.** Open a signed-out draft following [Threads](threads.md), then click button `Choose account`. Require that draft's profile name in the `Name` textbox.
- **Proof.** `await capture('profiles-persisted')`. Inspect only the `profiles` fields in `<home>/hub/settings.json`; compare account selections through the reopened UI or read-only `profiles.list`, keeping credential material out of artifacts. The default smoke executes onboarding, settings creation, cancel, rename/reload, deletion of an unused profile, and ChatGPT selection.

## Gotchas

- Settings and onboarding use different name handles. The first-run input has a placeholder, while the settings form has a labeled textbox.
- Profile rows include account status in their accessible names. Match the expected full name or a constrained regular expression.
- Reload resets the selected settings section; reopening it is part of the persistence check.
- The baseline has no signed-in account. A selected signed-out account must keep coding disabled.
- Account mappings live with sensitive hub data; observe through UI/read-only RPC rather than copying the whole hub credential file.
