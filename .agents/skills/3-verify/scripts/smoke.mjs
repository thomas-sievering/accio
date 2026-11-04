import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export default async function smoke({ page, runDir, home, fixture, action, capture, doctor }) {
  const button = (name) => page.getByRole('button', { name, exact: true });
  const settings = page.locator('.sidebar nav');
  const section = (name) => settings.getByRole('button', { name, exact: true });
  const profileRow = (name) => page.getByRole('button', { name: new RegExp('^' + name + ' No account selected$') });
  const settingsFile = () => readFile(join(home, 'hub/settings.json'), 'utf8').then(JSON.parse);

  await action('profiles/first-run: create Verify personal', async () => {
    await button('Continue').click();
    await page.getByPlaceholder('personal, work…').fill('Verify personal');
    await button('Continue').click();
    await page.getByText('Choose an account for Verify personal', { exact: true }).waitFor();
    assert((await settingsFile()).profiles.some((p) => p.name === 'Verify personal'));
  });
  await capture('profiles-first-run');
  await action('profiles/settings: create Verify work', async () => {
    await button('Settings').click();
    await section('Profiles').click();
    await page.getByRole('button', { name: /^Add profile/ }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Verify work');
    await button('Add profile').click();
    await page.getByRole('main').getByRole('navigation').getByText('Verify work', { exact: true }).waitFor();
    await button('Cancel').click();
    await profileRow('Verify work').waitFor();
  });
  await action('profiles/settings: rename and reload persisted profile', async () => {
    await profileRow('Verify work').click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Verify work renamed');
    await button('Save').click();
    await profileRow('Verify work renamed').waitFor();
    await page.reload();
    await button('Settings').click();
    await section('Profiles').click();
    await profileRow('Verify work renamed').click();
    assert.equal(await page.getByRole('textbox', { name: 'Name', exact: true }).inputValue(), 'Verify work renamed');
    await button('Cancel').click();
    assert((await settingsFile()).profiles.some((p) => p.name === 'Verify work renamed'));
  });
  await capture('profiles-persisted');
  await action('profiles/settings: cancel a draft and delete unused profile', async () => {
    await page.getByRole('button', { name: /^Add profile/ }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Discard me');
    await button('Cancel').click();
    assert.equal(await page.getByRole('button', { name: /^Discard me/ }).count(), 0);
    await profileRow('Verify work renamed').click();
    await button('Delete').click();
    // Delete asks once more, naming what goes.
    await button('Delete Verify work renamed').click();
    await page.getByRole('button', { name: /^Add profile/ }).waitFor();
    assert.deepEqual((await settingsFile()).profiles.map((p) => p.name), ['Verify personal']);
  });

  await action('accounts/settings: create a signed-out ChatGPT account', async () => {
    await section('Accounts').click();
    await page.getByRole('button', { name: /^Add ChatGPT account/ }).click();
    await page.getByRole('textbox', { name: 'Account name', exact: true }).fill('Verify ChatGPT');
    await button('Add account').click();
    await button('Sign in with ChatGPT').waitFor();
    await button('Cancel').click();
    await page.getByRole('button', { name: 'Verify ChatGPT Signed out', exact: true }).waitFor();
  });
  await action('accounts/profiles: select the named account and reopen it', async () => {
    await section('Profiles').click();
    await profileRow('Verify personal').click();
    await page.getByRole('combobox', { name: /OpenAI · ChatGPT account/ }).selectOption({ label: 'Verify ChatGPT · Signed out' });
    await button('Save').click();
    await page.getByRole('button', { name: 'Verify personal Verify ChatGPT · Signed out', exact: true }).click();
    assert.match(await page.getByRole('combobox', { name: /OpenAI · ChatGPT account/ }).locator('option:checked').innerText(), /Verify ChatGPT/);
    await button('Cancel').click();
  });
  await capture('accounts-selected');
  await action('accounts/settings: an account in use cannot be deleted', async () => {
    await section('Accounts').click();
    await page.getByRole('button', { name: 'Verify ChatGPT Signed out', exact: true }).click();
    assert(await button('Delete').isDisabled());
    await button('Cancel').click();
  });

  await action('machines/settings: rename this machine and persist profile folders', async () => {
    await section('Machines').click();
    await page.getByRole('button', { name: /\(this machine\)/ }).click();
    // The name and the profile folders save together from the page's one footer.
    await page.getByRole('textbox', { name: /^Machine name/ }).fill('Verify machine');
    await page.getByRole('textbox', { name: 'Folder path', exact: true }).fill(fixture);
    await page.getByRole('textbox', { name: 'Folder path', exact: true }).press('Enter');
    await button('Save').click();
    await page.getByRole('main').getByRole('navigation').getByText('Verify machine', { exact: true }).waitFor();
    await page.getByRole('main').getByRole('navigation').getByRole('button', { name: 'Machines', exact: true }).click();
    await page.getByRole('button', { name: /Verify machine \(this machine\)/ }).click();
    await page.getByText(fixture, { exact: true }).waitFor();
    const machine = (await settingsFile()).machines.find((m) => m.name === 'Verify machine');
    assert(machine && Object.values(machine.profileFolders).flat().includes(fixture));
  });
  await capture('machines-persisted');

  await action('projects/toolbar: add the disposable local folder', async () => {
    await button('Back').click();
    await button('Add project').click();
    await page.getByRole('textbox', { name: 'Folder', exact: true }).fill(fixture);
    await page.getByRole('dialog').getByText(/no git remote; this folder is its own project/).waitFor();
    await button('Add').click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const projects = JSON.parse(await readFile(join(home, 'projects.json'), 'utf8'));
    assert(projects.checkouts.some((c) => c.path.toLowerCase() === fixture.toLowerCase()));
  });
  await action('projects/settings: reopen project settings and check duplicate protection', async () => {
    // Filter appears only once setup is done; Settings / Projects opens the same form as a detail page.
    await button('Settings').click();
    await section('Projects').click();
    await page.getByRole('main').getByRole('button', { name: /^verify-project/ }).click();
    // The checkout path is cut in the middle to fit; its tooltip holds the full path.
    await page.getByRole('main').getByTitle(fixture, { exact: true }).first().waitFor();
    await capture('projects-persisted');
    await button('Cancel').click();
    await button('Back').click();
    await button('Add project').click();
    await page.getByRole('textbox', { name: 'Folder', exact: true }).fill(fixture);
    await page.getByText('This folder is already added.', { exact: true }).waitFor();
    // Add stays pressable; with a folder already added it does nothing and the note stays.
    await button('Add').click();
    await page.getByText('This folder is already added.', { exact: true }).waitFor();
    assert(await page.getByRole('dialog').isVisible());
    await button('Cancel').click();
  });
  await capture('final');
  await writeFile(join(runDir, 'persisted-settings.json'), JSON.stringify(await settingsFile(), null, 2));
  await writeFile(join(runDir, 'persisted-projects.json'), await readFile(join(home, 'projects.json')));
  await writeFile(join(runDir, 'doctor-after.json'), JSON.stringify(await doctor(), null, 2));
  await writeFile(join(runDir, 'coverage.json'), JSON.stringify({
    verified: ['profiles: first-run, settings, rename, cancel, delete, reload', 'accounts: create signed out, select, delete protection', 'machines: rename, folders, reopen', 'projects: toolbar add, filter settings, duplicate protection'],
    unverified: ['provider OAuth completion: no signed-in account in disposable home', 'threads, models, search and shelves with real turns: requires provider authentication', 'Electron native folder picker and OS folder opening: server/browser mode does not supply desktop bridge', 'project remote grouping, removal, profile reassignment and inline first-run add: separate mapped journeys'],
  }, null, 2));
}
