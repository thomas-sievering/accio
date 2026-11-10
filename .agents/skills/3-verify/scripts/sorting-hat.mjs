// Offline journey for the hub's own Sorting Hat (features/sorting-hat.md). It starts a
// standalone Sorting Hat from the build in the run's scratch folder, plays its dashboard
// through the admin API (two houses, one signed-out Claude account), then links this
// instance's hub to it through Settings / Hubs and drives profiles and a draft. No provider
// is contacted and no model turn is sent.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export default async function ({ page, home, runDir, fixture, action, capture }) {
  const dir = join(runDir, 'scratch', 'sorting-hat');
  const child = fork('apps/sorting-hat/dist/main.js', ['--dir', dir, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = ''; child.stdout.on('data', (d) => { output += d; }); child.stderr.resume();
  try {
    const deadline = Date.now() + 15000;
    while (!output.includes('SORTING_HAT_READY')) { if (Date.now() > deadline || child.exitCode !== null) throw new Error('Sorting Hat did not become ready'); await new Promise((r) => setTimeout(r, 50)); }
    const { url } = JSON.parse(output.match(/SORTING_HAT_READY (\{[^\r\n]+\})/)[1]);
    const adminToken = (await readFile(join(dir, 'admin-token'), 'utf8')).trim();
    const api = async (method, path, body) => {
      const res = await fetch(`${url}/api/${path}`, { method, headers: { authorization: `Bearer ${adminToken}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status}`);
      return res.status === 204 ? undefined : res.json();
    };
    // The dashboard's part, outside Accio.
    const claude = await api('POST', 'accounts', { name: 'Dashboard Claude', providerId: 'anthropic' });
    await api('POST', 'houses', { name: 'Personal', accounts: { anthropic: [claude.id] } });
    await api('POST', 'houses', { name: 'Work' });

    const button = (name) => page.getByRole('button', { name, exact: true });
    const section = (name) => page.locator('.sidebar nav').getByRole('button', { name, exact: true });
    const main = page.getByRole('main');
    const card = page.locator('.settings-section').filter({ has: page.getByRole('heading', { name: 'Sorting Hat', exact: true }) });

    await action('profiles/first-run: create Verify personal', async () => {
      await button('Continue').click();
      await page.getByPlaceholder('personal, work…').fill('Verify personal');
      await button('Continue').click();
      await page.getByText('Choose an account for Verify personal', { exact: true }).waitFor();
    });
    await action('sorting-hat/settings: a wrong admin token is refused', async () => {
      await button('Settings').click();
      await page.locator('.sidebar nav').getByRole('button', { name: /^Hub: / }).click();
      await page.getByRole('menuitem', { name: 'Manage hubs' }).click();
      await card.getByRole('textbox', { name: 'Address', exact: true }).fill(url);
      await card.getByLabel('Admin token', { exact: true }).fill('hat-admin-wrong');
      assert.equal(await card.getByRole('textbox', { name: 'This hub’s name on the Sorting Hat', exact: true }).inputValue(), 'Local dev');
      await card.getByRole('textbox', { name: 'This hub’s name on the Sorting Hat', exact: true }).fill('Verify hub');
      await card.getByRole('button', { name: 'Connect Sorting Hat', exact: true }).click();
      await card.getByRole('alert').getByText(/refused the admin token/).waitFor();
    });
    await capture('sorting-hat-wrong-token');
    await action('sorting-hat/settings: connect with the admin token from the dashboard', async () => {
      await card.getByLabel('Admin token', { exact: true }).fill(adminToken);
      await card.getByRole('button', { name: 'Connect Sorting Hat', exact: true }).click();
      await card.getByText('2 houses', { exact: true }).waitFor();
      await card.getByText(new URL(url).host, { exact: true }).waitFor();
      await card.getByText('Hat keys are named “Accio · Verify hub · …”.', { exact: true }).waitFor();
      assert(!(await page.content()).includes(adminToken), 'The page holds no admin token after saving');
      for (const file of await readdir(join(home, 'hub'), { recursive: true })) {
        const text = await readFile(join(home, 'hub', String(file)), 'utf8').catch(() => '');
        assert(!text.includes(adminToken), `hub/${file} holds no admin token in the clear`);
      }
    });
    await capture('sorting-hat-linked');
    await action('sorting-hat/accounts: account settings point to the dashboard', async () => {
      await section('Accounts').click();
      await main.getByText(/These accounts are on the Sorting Hat at/).waitFor();
      await main.getByRole('button', { name: /^Dashboard Claude/ }).waitFor();
      assert.equal(await page.getByRole('button', { name: /^Add Claude account/ }).count(), 0);
    });
    await capture('sorting-hat-accounts');
    await action('sorting-hat/profiles: an unlinked profile says so in the list and form', async () => {
      await section('Profiles').click();
      await page.getByRole('button', { name: /^Verify personal No house on the Sorting Hat$/ }).click();
      await button('House on the Sorting Hat').waitFor();
      await main.getByText('Threads of this profile can’t run until it links to a house.', { exact: true }).waitFor();
      await button('Cancel').click();
    });
    await action('sorting-hat/threads: a draft for an unlinked profile shows why it can’t run', async () => {
      await button('Back').click();
      await button('Add project').click();
      await page.getByRole('textbox', { name: 'Folder', exact: true }).fill(fixture);
      await page.getByRole('dialog').getByText(/no git remote; this folder is its own project/).waitFor();
      await button('Add').click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('status').getByText(/isn’t linked to a house on the Sorting Hat, so this thread can’t run yet\./).waitFor();
      await page.locator('.composer textarea').fill('hello');
      assert(await button('Send').isDisabled(), 'Send stays disabled');
    });
    await capture('sorting-hat-thread-no-house');
    await action('sorting-hat/profiles: Choose house opens the profile; link it to Personal', async () => {
      await button('Choose house').click();
      assert.equal(await page.getByRole('textbox', { name: 'Name', exact: true }).inputValue(), 'Verify personal');
      await button('House on the Sorting Hat').click();
      await page.getByRole('menu', { name: 'House on the Sorting Hat', exact: true }).getByRole('menuitemradio', { name: /^Personal/ }).click();
      await page.getByRole('menu', { name: 'House on the Sorting Hat', exact: true }).waitFor({ state: 'hidden' });
      await main.getByText('Save to use the accounts of Personal.', { exact: true }).waitFor();
      await capture('sorting-hat-house-picked');
      await button('Save').click();
      await page.getByRole('button', { name: /^Verify personal House Personal · Dashboard Claude · Signed out$/ }).click();
      await page.getByRole('list', { name: 'Anthropic · Claude accounts' }).getByText('Dashboard Claude', { exact: true }).waitFor();
      const settings = JSON.parse(await readFile(join(home, 'hub', 'settings.json'), 'utf8'));
      assert.equal(settings.profiles.find((p) => p.name === 'Verify personal')?.houseId, 'personal');
    });
    await capture('sorting-hat-profile-linked');
    await action('sorting-hat/threads: once linked, the draft asks for a signed-in account instead', async () => {
      await button('Cancel').click();
      await button('Back').click();
      await page.getByRole('status').getByText(/isn’t signed in with Claude/).waitFor();
    });
    await capture('sorting-hat-thread-signed-out');
    await action('sorting-hat/settings: disconnect returns to the hub’s own accounts', async () => {
      await button('Settings').click();
      await page.locator('.sidebar nav').getByRole('button', { name: /^Hub: / }).click();
      await page.getByRole('menuitem', { name: 'Manage hubs' }).click();
      await card.getByRole('button', { name: 'Disconnect', exact: true }).click();
      await card.getByText(/Threads go back to the accounts this hub keeps itself/).waitFor();
      await card.getByRole('button', { name: 'Disconnect', exact: true }).click();
      await card.getByRole('button', { name: 'Connect Sorting Hat', exact: true }).waitFor();
      assert.deepEqual(await api('GET', 'hat-keys'), []);
    });
    await capture('sorting-hat-disconnected');
  } finally {
    child.kill();
  }
}
