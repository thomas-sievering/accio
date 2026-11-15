import { test, expect } from '@playwright/test';
import { projectKey } from '../packages/protocol/src/spaces.js';
import { chatClient, startProjectThread } from './chat.js';

// GLOSSARY: Space, Home. The space view gathers a space's projects: the home on top, then the rest.
test('the space view opens from the project menu and Settings, lists its projects, comes back on reload and starts a thread in the home', async ({ page, baseURL }, info) => {
  test.setTimeout(60_000);
  const client = await chatClient(baseURL!);
  try {
    for (const space of await client.call('spaces.list', {})) await client.call('spaces.delete', { id: space.id });
    const { projects } = await client.call('projects.get', {});
    const byName = (name: string) => projects.find((p) => p.name === name)!;
    const delivery = byName('delivery-project');
    const review = byName('review-project');
    // Fixture: the space is arranged directly; Settings / Spaces is covered by spaces.spec.ts.
    const elsewhere = 'github.com/acme/elsewhere';
    const space = await client.call('spaces.save', { name: 'hrc', projectKeys: [projectKey(delivery), projectKey(review), elsewhere], homeProjectKey: projectKey(review) });

    await startProjectThread(page, baseURL!, /delivery-project/, 'Queued hrc follow-up');
    await expect(page.getByText('Finished: Queued hrc follow-up', { exact: true })).toBeVisible();

    // The project-name menu offers the space next to Dashboard.
    const crumb = page.locator('.thread-project-link', { hasText: 'delivery-project' });
    await crumb.click();
    await page.getByRole('menuitem', { name: 'Space', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'hrc' })).toBeVisible();

    // The home is pinned on top with its own action.
    const home = page.getByRole('region', { name: 'Home' });
    await expect(home.getByRole('article', { name: 'review-project' })).toBeVisible();
    await expect(home.getByRole('button', { name: 'New thread in home' })).toBeEnabled();

    // One row per other project: profile, checkout here, its open threads, dashboard and New thread.
    const others = page.getByRole('region', { name: 'Projects' });
    const deliveryRow = others.getByRole('article', { name: 'delivery-project' });
    await expect(deliveryRow).toContainText('Personal');
    await expect(deliveryRow.locator('.space-checkout')).not.toHaveText('Not on this machine');
    await expect(deliveryRow.locator('.row-title', { hasText: 'Queued hrc follow-up' })).toBeVisible();
    await expect(deliveryRow.getByRole('button', { name: 'New thread in delivery-project' })).toBeEnabled();
    const missing = others.getByRole('article', { name: elsewhere });
    await expect(missing).toContainText('Not on this machine');
    await expect(missing.getByRole('button', { name: `New thread in ${elsewhere}` })).toBeDisabled();
    await expect(missing.getByRole('button', { name: `${elsewhere} dashboard` })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('space-view.png') });

    // Reopening the app comes back to the space view.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'hrc' })).toBeVisible();

    // A project row leads to its dashboard.
    await deliveryRow.getByRole('button', { name: 'delivery-project dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'delivery-project' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Recently shipped' })).toBeVisible();

    // Settings / Spaces opens the same view from the space's row.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('.sidebar nav').getByRole('button', { name: 'Spaces', exact: true }).click();
    await page.getByRole('button', { name: 'Open hrc', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'hrc' })).toBeVisible();

    // New thread in home opens a draft in the home and the thread starts there.
    const homeThreads = async () => (await client.call('threads.list', {})).filter((t) => t.projectId === review.id).length;
    const before = await homeThreads();
    await home.getByRole('button', { name: 'New thread in home' }).click();
    await expect(page.getByRole('heading', { name: 'hrc' })).toHaveCount(0);
    await page.locator('.composer textarea').fill('Home follow-up');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.thread-project-link', { hasText: 'review-project' })).toBeVisible();
    await expect.poll(homeThreads).toBe(before + 1);

    // Outside any space, the project-name menu has no Space entry.
    await client.call('spaces.delete', { id: space.id });
    await page.locator('.thread-project-link', { hasText: 'review-project' }).click();
    await expect(page.getByRole('menuitem', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Space', exact: true })).toHaveCount(0);
  } finally {
    for (const space of await client.call('spaces.list', {}).catch(() => [])) await client.call('spaces.delete', { id: space.id }).catch(() => {});
    client.close();
  }
});
