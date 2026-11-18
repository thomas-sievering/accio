import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHAT_TOKEN, chatClient } from './chat.js';
import { pick } from './menu-select.js';

// GLOSSARY: Space, Home. Managed in Settings / Spaces and stored with the hub's shared settings.
test('creates a space in Settings, adds projects and marks its home', async ({ page, baseURL }, info) => {
  const client = await chatClient(baseURL!);
  try {
    for (const space of await client.call('spaces.list', {})) await client.call('spaces.delete', { id: space.id });
    await page.goto(`${baseURL}/#token=${CHAT_TOKEN}`);
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    await button('Settings').click();
    await page.locator('.sidebar nav').getByRole('button', { name: 'Spaces', exact: true }).click();

    await page.getByRole('button', { name: /^Add space/ }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('hrc');
    const projects = page.getByRole('group', { name: 'Projects', exact: true });
    await projects.getByRole('checkbox', { name: /^delivery-project/ }).check();
    await projects.getByRole('checkbox', { name: /^review-project/ }).check();
    await pick(page, 'Home project', 'review-project');
    await page.screenshot({ path: info.outputPath('new-space.png') });
    await button('Add space').click();

    const row = page.locator('.setting').filter({ hasText: 'hrc' });
    await expect(row).toContainText('2 projects · Home review-project');
    const [saved] = await client.call('spaces.list', {});
    expect(saved).toMatchObject({ name: 'hrc', homeProjectKey: expect.any(String) });
    expect(saved!.projectKeys).toHaveLength(2);

    // A project of hrc can't join another space; the picker says where it is.
    await page.getByRole('button', { name: /^Add space/ }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('agents');
    const taken = projects.getByRole('checkbox', { name: /^delivery-project/ });
    await expect(taken).toBeDisabled();
    await expect(projects.locator('label', { hasText: 'delivery-project' })).toContainText('In hrc');
    await page.screenshot({ path: info.outputPath('project-in-another-space.png') });
    await button('Cancel').click();

    // Changing the home, then removing its project, leaves the space without one.
    await button('Edit hrc').click();
    await pick(page, 'Home project', 'delivery-project');
    await projects.getByRole('checkbox', { name: /^delivery-project/ }).uncheck();
    await expect(button('Home project')).toHaveText('No home');
    await button('Save').click();
    await expect(row).toContainText('1 project · No home');

    await button('Edit hrc').click();
    await button('Delete').click();
    await button('Delete hrc').click();
    await expect(page.getByRole('button', { name: /^Add space/ })).toBeVisible();
    await expect(page.locator('.setting').filter({ hasText: 'hrc' })).toHaveCount(0);
    await expect.poll(() => client.call('spaces.list', {})).toEqual([]);
  } finally {
    client.close();
  }
});

// GLOSSARY: Home. "New home…" creates the home from Accio's template and opens its first thread.
test('creates a new home from the Home project picker and opens its first thread', async ({ page, baseURL }, info) => {
  test.setTimeout(60_000);
  const client = await chatClient(baseURL!);
  const root = await mkdtemp(join(tmpdir(), 'accio-new-home-'));
  const { id: machineId, profileFolders } = await client.thisMachine();
  const personal = (await client.call('profiles.list', {})).find((p) => p.name === 'Personal')!;
  try {
    for (const space of await client.call('spaces.list', {})) await client.call('spaces.delete', { id: space.id });
    // The home goes in the profile's folder on this machine: a disposable one here.
    await client.call('machines.setProfileFolders', { machineId, profileId: personal.id, folders: [root] });
    await page.goto(`${baseURL}/#token=${CHAT_TOKEN}`);
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    await button('Settings').click();
    await page.locator('.sidebar nav').getByRole('button', { name: 'Spaces', exact: true }).click();
    await page.getByRole('button', { name: /^Add space/ }).click();
    // The space has no name yet: the dialog asks for it, as the editor's Name field is behind it.
    await page.getByRole('group', { name: 'Projects', exact: true }).getByRole('checkbox', { name: /^delivery-project/ }).check();
    await pick(page, 'Home project', 'New home…');

    const dialog = page.getByRole('dialog', { name: 'New home' });
    // One name to enter: the home's folder and repo are named after the space.
    await expect(dialog.getByRole('textbox')).toHaveCount(1);
    await dialog.getByRole('textbox', { name: 'Space name', exact: true }).fill('agents');
    // A home is usually personal, even for a work space: the profile is always picked.
    await expect(dialog.getByRole('button', { name: 'Profile', exact: true })).toHaveText('Choose…');
    await expect(dialog.getByRole('button', { name: 'Create as', exact: true })).toHaveText('Local folder');
    await dialog.getByRole('button', { name: 'Create home', exact: true }).click();
    await expect(dialog).toContainText('Choose a profile.');
    await pick(page, 'Profile', 'Personal');
    await expect(dialog).toContainText(`Creates agents-home in ${join(root, 'agents-home')}.`);
    // Without a GitHub account chosen for the profile, gh's active account is never used.
    await pick(page, 'Create as', 'New GitHub repo');
    await expect(dialog).toContainText('This profile has no GitHub account. Choose one in Settings / Profiles.');
    await pick(page, 'Create as', 'Local folder');
    await expect(page.getByRole('menu', { name: 'Create as' })).toBeHidden();
    await dialog.screenshot({ path: info.outputPath('new-home.png') });
    await dialog.getByRole('button', { name: 'Create home', exact: true }).click();

    // The home's first thread opens, in the new project.
    await expect(page.locator('.thread-project-link', { hasText: 'agents-home' })).toBeVisible({ timeout: 20_000 });
    const [space] = await client.call('spaces.list', {});
    const home = (await client.call('projects.get', {})).projects.find((p) => p.name === 'agents-home')!;
    expect(space).toMatchObject({ name: 'agents', homeProjectKey: `local:${home.id}` });
    expect(space!.projectKeys).toHaveLength(2);
    expect(await readFile(join(root, 'agents-home', 'AGENTS.md'), 'utf8')).toContain('### delivery-project');
    const thread = (await client.call('threads.list', {})).find((t) => t.projectId === home.id)!;
    expect(thread).toBeTruthy();
    await page.screenshot({ path: info.outputPath('new-home-thread.png') });
    await expect.poll(async () => (await client.call('threads.list', {})).find((t) => t.id === thread.id)?.status, { timeout: 20_000 }).toBe('idle');
  } finally {
    for (const space of await client.call('spaces.list', {}).catch(() => [])) await client.call('spaces.delete', { id: space.id }).catch(() => {});
    const { checkouts } = await client.call('projects.get', {}).catch(() => ({ checkouts: [] as { id: string; path: string }[] }));
    for (const c of checkouts.filter((c) => c.path.startsWith(root))) await client.call('checkouts.remove', { id: c.id, deleteThreads: true }).catch(() => {});
    await client.call('machines.setProfileFolders', { machineId, profileId: personal.id, folders: profileFolders[personal.id] ?? [] }).catch(() => {});
    client.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  }
});
