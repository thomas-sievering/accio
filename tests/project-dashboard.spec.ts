import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { TestClient } from '../apps/worker/src/testing/testApp.js';

const exec = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await exec('git', ['-C', cwd, ...args], { windowsHide: true })).stdout.trim();
const server = (version: string) => `require('http').createServer((q,s)=>s.end('${version}')).listen(Number(process.env.PORT),'127.0.0.1');\n`;

test('the project dashboard starts the app from main, follows new commits, and lists threads, commits and logs', async ({ page, baseURL }, info) => {
  test.setTimeout(90_000);
  const { deliveryFolder } = JSON.parse(await readFile(resolve('out', `chat-test-${new URL(baseURL!).port}.json`), 'utf8'));
  const home = dirname(deliveryFolder);
  const folder = join(home, 'dashboard-project');
  const origin = join(home, 'dashboard-origin.git');
  await mkdir(folder);
  await git(folder, 'init', '--quiet', '-b', 'main');
  await git(folder, 'config', 'user.name', 'Accio Browser Test');
  await git(folder, 'config', 'user.email', 'browser@example.test');
  await git(folder, 'config', 'core.autocrlf', 'false');
  await writeFile(join(folder, 'server.cjs'), server('dashboard v1'));
  await git(folder, 'add', '.');
  await git(folder, 'commit', '--quiet', '-m', 'Serve v1');
  await git(home, 'init', '--quiet', '--bare', '-b', 'main', origin);
  await git(folder, 'remote', 'add', 'origin', origin);
  await git(folder, 'push', '--quiet', '-u', 'origin', 'main');
  await git(folder, 'remote', 'set-head', 'origin', '-a');
  const client = await TestClient.open(`${baseURL!.replace('http:', 'ws:')}/ws?token=isolated-chat-test-token`);
  // Fixture: the folder is added like any project; everything under test goes through the UI.
  const checkout = await client.call('checkouts.add', { path: folder, profileId: 'personal' });
  const app = async () => (await client.call('projectApps.get', {})).find((a) => a.projectId === checkout.projectId);
  try {
    await page.goto(`${baseURL}/#token=isolated-chat-test-token`);
    await page.getByRole('button', { name: 'New thread', exact: true }).first().click();
    await page.getByRole('option', { name: /dashboard-project/ }).click();
    await page.locator('.composer textarea').fill('Delivery follow-up');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Fresh workspace ready.', { exact: true })).toBeVisible();

    // The breadcrumb's project name opens the dashboard with the project's threads.
    await page.locator('.thread-project-link', { hasText: 'dashboard-project' }).click();
    await page.getByRole('menuitem', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'dashboard-project' })).toBeVisible();
    await expect(page.locator('.dashboard-rows .row-title', { hasText: 'Delivery follow-up' })).toBeVisible();

    // No start command yet: an agent can set it up, or you enter it in the project's settings.
    await expect(page.getByRole('button', { name: 'Set up with agent' })).toBeVisible();
    await page.getByRole('button', { name: 'Enter manually' }).click();
    await page.getByRole('textbox', { name: 'Start command' }).fill('node server.cjs');
    await page.getByRole('textbox', { name: 'Setup command' }).fill('node -e "require(\'fs\').writeFileSync(\'setup-ran.txt\', \'yes\')"');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'dashboard-project' })).toBeVisible();

    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.locator('.app-status')).toHaveText('Running', { timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Open app' })).toBeVisible();
    await expect(page.locator('.app-commit')).toContainText('Serve v1');
    const first = await app();
    expect(await (await fetch(first!.url!)).text()).toBe('dashboard v1');

    // A new commit on main updates and restarts the app by itself.
    await writeFile(join(folder, 'server.cjs'), server('dashboard v2'));
    await git(folder, 'commit', '--quiet', '-am', 'Serve v2');
    await git(folder, 'push', '--quiet');
    await expect(page.locator('.app-commit')).toContainText('Serve v2', { timeout: 30_000 });
    await expect(page.locator('.app-status')).toHaveText('Running', { timeout: 20_000 });
    await expect.poll(async () => { const a = await app(); return a?.url ? (await fetch(a.url).then((r) => r.text(), () => '')) : ''; }, { timeout: 20_000 }).toBe('dashboard v2');
    // The thread's own checkout is untouched; the app runs from a checkout of its own.
    expect(await git(folder, 'status', '--porcelain')).toBe('');

    // Recently shipped sits on the page itself; the app's logs open inside its card.
    await expect(page.locator('.changelog li').first()).toContainText('Serve v2');
    await expect(page.locator('.changelog li.running')).toContainText('Serve v2');
    await expect(page.locator('.changelog li')).toHaveCount(2);
    await page.getByRole('button', { name: 'Logs', exact: true }).click();
    await expect(page.locator('.app-logs')).toContainText('$ node server.cjs');
    await page.screenshot({ path: info.outputPath('project-dashboard.png') });

    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.locator('.app-status')).toHaveText('Stopped', { timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();

    // Opening a thread from the dashboard leaves it.
    await page.locator('.dashboard-rows .row-main').first().click();
    await expect(page.getByRole('heading', { name: 'dashboard-project' })).toHaveCount(0);
    await expect(page.getByText('Fresh workspace ready.', { exact: true })).toBeVisible();

    // The project's full Changelog is a fold on its dashboard.
    await page.locator('.thread-project-link', { hasText: 'dashboard-project' }).click();
    await page.getByRole('menuitem', { name: 'Dashboard', exact: true }).click();
    await page.locator('.dashboard-fold > summary', { hasText: 'Changelog' }).click();
    await expect(page.getByText('Nothing shipped yet.')).toBeVisible();
  } finally {
    await client.call('projectApps.stop', { projectId: checkout.projectId }).catch(() => {});
    await client.call('checkouts.remove', { id: checkout.id, deleteThreads: true }).catch(() => {});
    client.close();
  }
});


test('all settled project threads remain reachable beyond the first page', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const folder = await mkdtemp(join(tmpdir(), 'accio-settled-browser-'));
  const client = await TestClient.open(`${baseURL!.replace('http:', 'ws:')}/ws?token=isolated-chat-test-token`);
  let checkoutId: string | undefined;
  try {
    const checkout = await client.call('checkouts.add', { path: folder, profileId: 'personal' });
    checkoutId = checkout.id;
    for (let index = 0; index < 12; index++) {
      const thread = await client.call('threads.start', { checkoutId: checkout.id, text: `Settled history ${index}` });
      await expect.poll(async () => (await client.call('threads.list', {})).find(t => t.id === thread.id)?.status).toBe('idle');
      await client.call('threads.settle', { threadId: thread.id });
    }
    await page.goto(`${baseURL}/#token=isolated-chat-test-token`);
    await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
    await page.getByRole('option', { name: new RegExp(folder.split(/[\\/]/).at(-1)!) }).click();
    await page.locator('.thread-project-link').click();
    await page.getByRole('menuitem', { name: 'Dashboard', exact: true }).click();
    const fold = page.locator('.dashboard-fold').filter({ has: page.locator('summary', { hasText: 'Settled' }) });
    await expect(fold).not.toHaveAttribute('open', '');
    await fold.locator('summary').click();
    await expect(fold.locator('.row-main')).toHaveCount(10);
    await fold.getByRole('button', { name: 'Show 2 more settled threads', exact: true }).click();
    await expect(fold.locator('.row-main')).toHaveCount(12);
    await fold.locator('.row-main').last().click();
    await expect(page.locator('.msg.user')).toContainText('Settled history');
  } finally {
    if (checkoutId) await client.call('checkouts.remove', { id: checkoutId, deleteThreads: true }).catch(() => {});
    client.close();
    await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
