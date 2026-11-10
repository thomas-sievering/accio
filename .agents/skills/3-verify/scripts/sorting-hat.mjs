// Offline journey for the hub's own Sorting Hat (features/sorting-hat.md). It starts the
// standalone Sorting Hat with faked providers (scripts/sortinghat-test-server.ts), plays its
// dashboard through the admin API (two houses, one signed-out Claude account), then links this
// instance's hub to it through Settings / Hubs and drives accounts, profiles, limits and a
// draft. No real provider is contacted and no model turn is sent.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export default async function ({ page, context, home, fixture, action, capture }) {
  const adminToken = `hat-admin-${randomBytes(16).toString('hex')}`;
  const child = fork('scripts/sortinghat-test-server.ts', { execArgv: ['--import', 'tsx'], env: { ...process.env, ACCIO_SORTINGHAT_TEST_PORT: '0', SORTING_HAT_ADMIN_TOKEN: adminToken }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  let output = ''; child.stdout.on('data', (d) => { output += d; }); child.stderr.resume();
  try {
    const deadline = Date.now() + 30000;
    while (!/fixture ready: (\S+)/.test(output)) { if (Date.now() > deadline || child.exitCode !== null) throw new Error('Sorting Hat did not become ready'); await new Promise((r) => setTimeout(r, 50)); }
    const url = output.match(/fixture ready: (\S+)/)[1];
    const api = async (method, path, body) => {
      const res = await fetch(`${url}/api/${path}`, { method, headers: { authorization: `Bearer ${adminToken}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status}`);
      return res.status === 204 ? undefined : res.json();
    };
    // The dashboard's part, outside Accio.
    const claude = await api('POST', 'accounts', { name: 'Dashboard Claude', providerId: 'anthropic' });
    await api('POST', 'houses', { name: 'Personal', accounts: { anthropic: [claude.id] } });
    await api('POST', 'houses', { name: 'Work' });
    // Sign-in is faked only at the provider boundary: its consent page and token exchange.
    await context.route('https://**/*', (route) => route.fulfill({ status: 200, body: 'Scripted provider consent.' }));

    const button = (name) => page.getByRole('button', { name, exact: true });
    const section = (name) => page.locator('.sidebar nav').getByRole('button', { name, exact: true });
    const main = page.getByRole('main');
    const card = page.locator('.settings-section').filter({ has: page.getByRole('heading', { name: 'Sorting Hat', exact: true }) });
    const hubs = async () => {
      if (await button('Settings').isVisible()) await button('Settings').click();
      await page.locator('.sidebar nav').getByRole('button', { name: /^Hub: / }).click();
      await page.getByRole('menuitem', { name: 'Manage hubs' }).click();
    };
    const connect = async (token) => {
      await card.getByRole('textbox', { name: 'Address', exact: true }).fill(url);
      await card.getByLabel('Admin token', { exact: true }).fill(token);
      await card.getByRole('button', { name: 'Connect Sorting Hat', exact: true }).click();
    };
    const pick = async (menu, item) => {
      await button(menu).click();
      await page.getByRole('menu', { name: menu, exact: true }).getByRole('menuitemradio', { name: item }).click();
      await page.getByRole('menu', { name: menu, exact: true }).waitFor({ state: 'hidden' });
    };

    await action('profiles/first-run: create Verify personal', async () => {
      await button('Continue').click();
      await page.getByPlaceholder('personal, work…').fill('Verify personal');
      await button('Continue').click();
      await page.getByText('Choose an account for Verify personal', { exact: true }).waitFor();
    });
    await action('sorting-hat/settings: a wrong admin token is refused', async () => {
      await button('Settings').click();
      await hubs();
      assert.equal(await card.getByRole('textbox', { name: 'This hub’s name on the Sorting Hat', exact: true }).inputValue(), 'Local dev');
      await card.getByRole('textbox', { name: 'This hub’s name on the Sorting Hat', exact: true }).fill('Verify hub');
      await connect('hat-admin-wrong');
      await card.getByRole('alert').getByText(/refused the admin token/).waitFor();
    });
    await capture('sorting-hat-wrong-token');
    await action('sorting-hat/settings: connect with the admin token from the dashboard', async () => {
      await connect(adminToken);
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
    await action('sorting-hat/accounts: add, sign in and rename a Claude account on the Sorting Hat', async () => {
      await section('Accounts').click();
      await main.getByText(/Accounts are kept on the Sorting Hat at/).waitFor();
      await main.getByRole('button', { name: /^Dashboard Claude/ }).waitFor();
      await page.getByRole('button', { name: /^Add Claude account/ }).click();
      await page.getByRole('textbox', { name: 'Account name' }).fill('Accio Claude');
      await button('Add account').click();
      const opened = page.waitForEvent('popup'); await button('Sign in with Claude').click();
      const popup = await opened; await popup.waitForURL((u) => u.hostname === 'claude.ai');
      // The provider fixture redirects through the worker's loopback callback, as browser approval does.
      const authorize = new URL(popup.url()); const callback = new URL(authorize.searchParams.get('redirect_uri'));
      callback.searchParams.set('code', 'scripted'); callback.searchParams.set('state', authorize.searchParams.get('state'));
      await popup.goto(callback.href); await popup.close();
      await page.getByText('Signed in as', { exact: false }).waitFor();
      await page.getByRole('textbox', { name: 'Account name' }).fill('Accio Claude renamed');
      await button('Save').click();
      await main.getByRole('button', { name: /^Accio Claude renamed.*Signed in$/ }).waitFor();
      const remote = await api('GET', 'accounts');
      assert.deepEqual(remote.map((a) => [a.name, a.signedIn]), [['Dashboard Claude', false], ['Accio Claude renamed', true]]);
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
      await pick('House on the Sorting Hat', /^Personal/);
      await main.getByText('Save to use the accounts of Personal.', { exact: true }).waitFor();
      await capture('sorting-hat-house-picked');
      await button('Save').click();
      await page.getByRole('button', { name: /^Verify personal House Personal · Dashboard Claude · Signed out$/ }).click();
      await page.getByRole('list', { name: 'Anthropic · Claude accounts' }).getByText('Dashboard Claude', { exact: true }).waitFor();
      const settings = JSON.parse(await readFile(join(home, 'hub', 'settings.json'), 'utf8'));
      assert.equal(settings.profiles.find((p) => p.name === 'Verify personal')?.houseId, 'personal');
    });
    await capture('sorting-hat-profile-linked');
    await action('sorting-hat/profiles: choose and order the house’s accounts from the profile', async () => {
      await main.getByText('Choosing them here sets the accounts of the house Personal on the Sorting Hat, for every app that uses it.', { exact: false }).waitFor();
      await pick('Add another Claude account', /^Accio Claude renamed/);
      await button('Move Accio Claude renamed up').click();
      await button('Save').click();
      await page.getByRole('button', { name: /^Verify personal House Personal · Accio Claude renamed, Dashboard Claude · Signed out$/ }).waitFor();
      assert.deepEqual((await api('GET', 'houses/personal')).accounts.anthropic.length, 2);
      assert.equal((await api('GET', 'houses/personal')).accounts.anthropic[1], claude.id);
    });
    await action('sorting-hat/profiles: a new profile makes a house of its name', async () => {
      await page.getByRole('button', { name: /^Add profile/ }).click();
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Side');
      await button('House on the Sorting Hat').getByText('New house Side').waitFor();
      await main.getByText('Save to make this house on the Sorting Hat.', { exact: true }).waitFor();
      await capture('sorting-hat-new-profile-house');
      await button('Add profile').click();
      await page.getByRole('textbox', { name: 'Name', exact: true }).waitFor();
      await button('Cancel').click();
      await page.getByRole('button', { name: /^Side House Side · No account in its house$/ }).waitFor();
      assert((await api('GET', 'houses')).some((h) => h.id === 'side' && h.name === 'Side'));
    });
    await action('sorting-hat/accounts: a dashboard change shows up, and deleting an account another house holds names it', async () => {
      // On the dashboard: an account in Work, which no profile here uses.
      const spare = await api('POST', 'accounts', { name: 'Spare Claude', providerId: 'anthropic' });
      await api('PUT', 'houses/work/accounts', { anthropic: [spare.id] });
      await section('Accounts').click();
      await main.getByRole('button', { name: /^Spare Claude/ }).click({ timeout: 30000 });
      await button('Delete').click();
      await button('Delete Spare Claude').click();
      await main.getByText('This account is still in the house Work on the Sorting Hat.', { exact: false }).waitFor();
      await capture('sorting-hat-delete-refused');
      await button('Cancel').click();
    });
    await action('sorting-hat/limits: the Limits view shows the Sorting Hat’s limits', async () => {
      await button('Back').click();
      await button('Limits').click();
      const limits = page.getByRole('article', { name: /^Accio Claude renamed,/ });
      await limits.getByText('5-hour', { exact: false }).first().waitFor();
      await page.getByText('In use', { exact: true }).first().waitFor();
      await button('Refresh').click();
      await limits.getByText('5-hour', { exact: false }).first().waitFor();
    });
    await capture('sorting-hat-limits');
    await action('sorting-hat/settings: disconnect leaves the hub without accounts', async () => {
      await button('Close limits').click();
      await hubs();
      await card.getByRole('button', { name: 'Disconnect', exact: true }).click();
      await card.getByText(/Threads can’t run until this hub has a Sorting Hat again/).waitFor();
      await card.getByRole('button', { name: 'Disconnect', exact: true }).click();
      await card.getByRole('button', { name: 'Connect Sorting Hat', exact: true }).waitFor();
      assert.deepEqual(await api('GET', 'hat-keys'), []);
    });
    await capture('sorting-hat-disconnected');
    await action('sorting-hat/unreachable: account settings, limits and the composer say so', async () => {
      await connect(adminToken);
      await card.getByText('3 houses', { exact: true }).waitFor();
      child.send({ type: 'shutdown' }); await new Promise((r) => child.once('exit', r));
      // The hub reads the Sorting Hat every 15 seconds.
      await section('Accounts').click();
      await main.getByRole('alert').getByText(/Could not reach the Sorting Hat/).waitFor({ timeout: 30000 });
      assert.equal(await page.getByRole('button', { name: /^Add Claude account/ }).count(), 0);
      await capture('sorting-hat-unreachable-accounts');
      await section('Profiles').click();
      await page.getByRole('button', { name: /^Verify personal / }).click();
      await main.getByRole('alert').getByText(/Could not reach the Sorting Hat/).waitFor();
      await button('Cancel').click();
      await button('Back').click();
      await button('Limits').click();
      await page.getByRole('alert').getByText(/Could not reach the Sorting Hat/).waitFor();
      await capture('sorting-hat-unreachable-limits');
      await button('Close limits').click();
      await page.locator('.composer').getByText('Sorting Hat unreachable', { exact: true }).waitFor();
    });
    await capture('sorting-hat-unreachable-composer');
  } finally {
    if (child.exitCode === null) { child.send({ type: 'shutdown' }); await new Promise((r) => { child.once('exit', r); setTimeout(r, 5000); }); }
  }
}
