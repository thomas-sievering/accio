import { test, expect } from '@playwright/test';
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
    await pick(page, 'Home', 'review-project');
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
    await pick(page, 'Home', 'delivery-project');
    await projects.getByRole('checkbox', { name: /^delivery-project/ }).uncheck();
    await expect(button('Home')).toHaveText('No home');
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
