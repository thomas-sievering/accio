import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { TestClient } from '../apps/worker/src/testing/testApp.js';

const token = 'isolated-chat-test-token';

async function draftIn(page: Page, baseURL: string | undefined, project: RegExp) {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.getByRole('button', { name: 'New thread', exact: true }).first().click();
  await page.getByRole('option', { name: project }).click();
  await expect(page.locator('.composer textarea')).toBeVisible();
}

async function newestThread(baseURL: string | undefined, text: string) {
  const client = await TestClient.open(`${baseURL!.replace('http:', 'ws:')}/ws?token=${token}`);
  try {
    for (const thread of (await client.call('threads.list', {})).sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      const items = await client.call('threads.transcript', { threadId: thread.id });
      if (items.some((item) => item.kind === 'user' && item.text === text)) return thread;
    }
  } finally { client.close(); }
}

test('a GitHub issue picked in a new thread is named in the first message and assigned once it starts', async ({ page, baseURL }, info) => {
  const { issuesClaimFile } = JSON.parse(await readFile(resolve('out', `chat-test-${new URL(baseURL!).port}.json`), 'utf8'));
  await page.setViewportSize({ width: 1100, height: 760 });
  await draftIn(page, baseURL, /issues-project/);
  const trigger = page.getByRole('button', { name: 'Pick an issue', exact: true });
  await trigger.click();
  const picker = page.getByRole('dialog', { name: 'Pick an issue' });
  await expect(picker.getByRole('group').locator('.issue-picker-group span:first-child')).toHaveText(['Ready for agent', 'Needs triage', 'Blocked']);
  await expect(picker.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await expect(picker.getByRole('option', { name: /#194/ })).toContainText('blocked by #205');
  await expect(picker.getByRole('combobox')).toBeFocused();
  // The list opens below the chip, clear of the composer.
  expect((await picker.boundingBox())!.y).toBeGreaterThan((await trigger.boundingBox())!.y);
  await expect(picker).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('github-picker.png') });

  await page.keyboard.type('relay hub');
  await expect(picker.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(picker).toBeHidden();
  await expect(page.locator('.composer-chip')).toContainText('#208 Retry the relay handshake after the hub restarts');
  await expect(page.getByRole('button', { name: /^Issue: #208/ })).toContainText('#208 · claims on send');
  // The issue alone is enough to send.
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await page.locator('.composer textarea').fill('Keep the backoff simple');
  await page.screenshot({ path: info.outputPath('github-attached.png') });
  await page.locator('.composer textarea').press('Enter');

  const text = 'Work on #208: Retry the relay handshake after the hub restarts\n\nKeep the backoff simple';
  await expect(page.locator('.msg.user').filter({ hasText: 'Work on #208: Retry the relay handshake after the hub restarts' })).toBeVisible();
  await expect.poll(() => newestThread(baseURL, text).then((thread) => thread?.title)).toBe('#208 Retry the relay handshake after the hub restarts');
  await expect.poll(async () => JSON.parse(await readFile(issuesClaimFile, 'utf8').catch(() => '[]'))).toEqual([['issue', 'edit', '208', '--add-assignee', '@me']]);
});

test('a local issue is grouped by feature, removable, and marked claimed in the thread’s worktree', async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await draftIn(page, baseURL, /scratch-project/);
  await page.getByRole('button', { name: 'Pick an issue', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Pick an issue' });
  await expect(picker.locator('.issue-picker-group span:first-child')).toHaveText(['issue-picker', 'relay-reconnect']);
  await expect(picker.locator('.issue-picker-source')).toHaveText('.scratch');
  await expect(picker.getByRole('option', { name: /Show a reconnecting state/ })).toContainText('blocked by 01');
  await expect(picker).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('local-picker.png') });
  await picker.getByRole('option', { name: /Retry the relay handshake/ }).click();
  await expect(page.locator('.composer-chip')).toContainText('01 Retry the relay handshake after the hub restarts');

  // Removing the chip sends a plain message again; picking it back sends the issue.
  await page.getByRole('button', { name: 'Remove 01 Retry the relay handshake after the hub restarts', exact: true }).click();
  await expect(page.locator('.composer-chip')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pick an issue', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pick an issue', exact: true }).click();
  await picker.getByRole('option', { name: /Retry the relay handshake/ }).click();
  await page.locator('.composer textarea').press('Enter');

  const ref = '.scratch/relay-reconnect/issues/01-retry.md';
  const text = `Work on ${ref}: Retry the relay handshake after the hub restarts`;
  await expect(page.locator('.msg.user').filter({ hasText: text })).toBeVisible();
  let thread: Awaited<ReturnType<typeof newestThread>>;
  await expect.poll(async () => (thread = await newestThread(baseURL, text))?.workspace?.path).toBeTruthy();
  expect(thread!.title).toBe('Retry the relay handshake after the hub restarts');
  await expect.poll(() => readFile(join(thread!.workspace!.path, ref), 'utf8')).toContain('Status: claimed');
  await page.screenshot({ path: info.outputPath('local-sent.png') });
});

test('a project without issues offers no issue picker', async ({ page, baseURL }) => {
  await draftIn(page, baseURL, /delivery-project/);
  await expect(page.locator('.machine-trigger').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pick an issue', exact: true })).toHaveCount(0);
});
