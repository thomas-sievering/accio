import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { git } from '../apps/worker/src/git.js';
import { chatClient, chatFixture, startProjectThread } from './chat.js';

test('review-only PR stays visible until an external merge, then settles without a transcript receipt and can be reopened', async ({ page, baseURL }, info) => {
  test.setTimeout(60_000);
  await startProjectThread(page, baseURL!, /review-project/, 'Build review fixture');
  await expect(page.getByText('Review feature implemented.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Shipping options', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /Prepare for review/ }).click();
  await page.getByRole('button', { name: 'Prepare for review', exact: true }).click();
  const actions = page.locator('.delivery-actions');
  await expect(actions).toContainText('Waiting for merge');
  // The chip already says it waits for a merge; the caption only says when it was checked.
  await expect(actions).not.toContainText('Prepared for review; merge manually');
  await expect(actions).toContainText('checked just now');
  await expect(actions.getByRole('button', { name: 'Stop automatic fixes', exact: true })).toBeVisible();
  // The sidebar has room for a short word; the row's title keeps the full status.
  await expect(page.locator('.row.active')).toContainText('Review');
  await expect(page.locator('.row.active .row-main')).toHaveAttribute('title', /Waiting for merge · #123/);
  await expect(page.locator('.row.active')).toContainText('#123');
  await expect(page.locator('.row.active .row-working')).toHaveCount(0);
  await page.locator('.row.active').screenshot({ path: info.outputPath('waiting-sidebar.png') });
  await actions.screenshot({ path: info.outputPath('waiting-delivery.png') });

  const client = await chatClient(baseURL!);
  try {
    const thread = (await client.call('threads.list', {})).find(t => t.title === 'Build review fixture')!;
    expect(thread.delivery).toMatchObject({ mode: 'review', status: 'ready', pullRequest: { state: 'open', number: 123 } });
    const metadata = await chatFixture(baseURL!);
    const host = JSON.parse(await readFile(metadata.reviewHostFile, 'utf8'));
    // External-host fixture: squash into the real disposable target and delete the source branch.
    // No thread state is set by the test; the machine observer must discover the outcome.
    await git(metadata.reviewFolder, 'merge', '--squash', host.branch);
    await git(metadata.reviewFolder, 'commit', '--quiet', '-m', 'external squash merge');
    await git(metadata.reviewFolder, 'push', '--quiet', 'origin', 'main');
    await git(metadata.reviewFolder, 'push', '--quiet', 'origin', '--delete', host.branch);
    const mergeRevision = await git(metadata.reviewFolder, 'rev-parse', 'HEAD');
    const merged = { ...host, state: 'MERGED', mergeRevision, mergedAt: new Date().toISOString(), checks: 'PENDING' };
    await writeFile(metadata.reviewHostFile, JSON.stringify(merged));
    await actions.getByRole('button', { name: 'Check now', exact: true }).click();
    await expect(actions).toContainText('Merged · checking main');
    // The merge is broadcast mid-check, before target checks are read; let that check finish first.
    await expect(actions.getByRole('button', { name: 'Check now', exact: true })).toBeEnabled();
    expect((await client.call('threads.list', {})).find(t => t.id === thread.id)!.settledAt).toBeNull();

    await writeFile(metadata.reviewHostFile, JSON.stringify({ ...merged, checks: 'SUCCESS' }));
    await actions.getByRole('button', { name: 'Check now', exact: true }).click();
    await expect(actions).toContainText('Merged into main');
    await expect(actions.locator('.delivery-status')).toHaveAttribute('title', 'Workspace retained');
    await expect(actions.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Archive', exact: true })).toBeEnabled();
    await expect(page.locator('.composer textarea')).toHaveAttribute('placeholder', 'Send a message to reopen this thread…');
    const shelf = page.getByRole('button', { name: /^Settled/ });
    if (await shelf.getAttribute('aria-expanded') === 'false') await shelf.click();
    await expect(page.locator('.shelf .row.active')).toContainText(/Merged\s·\s#123/);
    await expect(page.locator('.shelf .row.active .row-main')).toHaveAttribute('title', /Merged into main · #123/);
    await expect(actions).toContainText('Merged into main');
    await expect(page.locator('.thread .notice')).toHaveCount(0);
    await page.locator('.shelf .row.active').screenshot({ path: info.outputPath('merged-sidebar.png') });
    await actions.screenshot({ path: info.outputPath('merged-delivery.png') });
    const saved = (await client.call('threads.list', {})).find(t => t.id === thread.id)!;
    expect(saved).toMatchObject({ settledAt: expect.any(String), delivery: { publishedRevision: mergeRevision }, workspace: { releasedAt: null } });
    await page.reload();
    await expect(actions).toContainText('Merged into main');
    await actions.getByRole('button', { name: 'Reopen', exact: true }).click();
    await page.reload();
    await expect(actions.getByRole('button', { name: 'Reopen', exact: true })).toHaveCount(0);
    expect((await client.call('threads.list', {})).find(t => t.id === thread.id)!.settledAt).toBeNull();
    const items = await client.call('threads.transcript', { threadId: thread.id });
    expect(items.filter(item => item.kind === 'notice' && item.id.endsWith(':completed'))).toHaveLength(0);
    expect(items.filter(item => item.kind === 'user' && item.delivery === 'review')).toHaveLength(1);
  } finally { client.close(); }
});

test('stopping review follow-ups retains PR tracking and prevents later failed checks from restarting the agent', async ({ page, baseURL }, info) => {
  await startProjectThread(page, baseURL!, /review-project/, 'Build review fixture');
  await expect(page.getByText('Review feature implemented.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Shipping options', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /Prepare for review/ }).click();
  await page.getByRole('button', { name: 'Prepare for review', exact: true }).click();
  const actions = page.locator('.delivery-actions');
  await expect(actions).toContainText('Waiting for merge');
  await actions.getByRole('button', { name: 'Stop automatic fixes', exact: true }).click();
  await expect(actions).toContainText('Automatic fixes stopped · still tracking #123');
  await expect(actions.getByRole('link', { name: /#123/ })).toBeVisible();
  const metadata = await chatFixture(baseURL!);
  const host = JSON.parse(await readFile(metadata.reviewHostFile, 'utf8'));
  await writeFile(metadata.reviewHostFile, JSON.stringify({ ...host, checks: 'FAILURE' }));
  await actions.getByRole('button', { name: 'Check now', exact: true }).click();
  await expect(actions).toContainText('Needs attention');
  await expect(actions).toContainText('Checks are failing:');
  await expect(actions).toContainText('Automatic fixes are stopped.');
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  await actions.screenshot({ path: info.outputPath('follow-ups-stopped.png') });
  const client = await chatClient(baseURL!);
  try {
    const current = (await client.call('threads.list', {})).find(t => t.workspace?.branch === host.branch)!;
    expect(current).toMatchObject({ status: 'idle', settledAt: null, delivery: { followUpsStoppedAt: expect.any(String), keepOpen: true, pullRequest: { number: 123 } } });
    const items = await client.call('threads.transcript', { threadId: current.id });
    expect(items.filter(item => item.kind === 'user' && item.delivery === 'review')).toHaveLength(1);
  } finally { client.close(); }
});
