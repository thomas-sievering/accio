import { expect, test, type Page } from '@playwright/test';
import { CHAT_TOKEN, chatClient } from './chat.js';

const chip = (page: Page) => page.getByRole('button', { name: /^Select model:/ });

/** GLOSSARY: Borrowing. A Personal thread picks one of Work's models, then one of its own again. */
test('a thread borrows another profile’s accounts from the model picker, and gives them back', async ({ page, baseURL }) => {
  const client = await chatClient(baseURL!);
  const work = await client.signedIn('Work');
  const thread = await client.call('threads.start', { profileId: 'personal', text: 'Borrow fixture' });
  const borrowing = async () => (await client.call('threads.list', {})).find((t) => t.id === thread.id)?.borrowFrom;
  try {
    await page.goto(`${baseURL}/#token=${CHAT_TOKEN}`);
    await page.locator('.sidebar').getByRole('button', { name: /Borrow fixture/ }).click();
    await expect(chip(page)).toBeEnabled();

    await chip(page).click();
    const picker = page.getByRole('dialog', { name: 'Choose a model' });
    const accounts = picker.getByRole('group', { name: 'Whose accounts' });
    await expect(accounts.getByRole('button', { name: 'Personal', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await accounts.getByRole('button', { name: 'Work', exact: true }).click();
    // Another profile's list ticks nothing: the thread's model is Personal's.
    await expect(picker.locator('[data-model-choice][aria-pressed="true"]')).toHaveCount(0);
    await picker.locator('[data-model-choice]', { hasText: 'Sonnet' }).click();

    await expect(chip(page)).toHaveAccessibleName('Select model: Claude Sonnet, on Work’s accounts');
    await expect(chip(page).locator('.model-borrowed')).toHaveText('Work');
    await expect.poll(borrowing).toBe(work.id);

    // It reopens on the accounts in use; picking one of Personal's models gives Work's back.
    await chip(page).click();
    await expect(accounts.getByRole('button', { name: 'Work', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(picker.locator('[data-model-choice][aria-pressed="true"]')).toContainText('Sonnet');
    await accounts.getByRole('button', { name: 'Personal', exact: true }).click();
    await picker.locator('[data-model-choice]', { hasText: 'Opus' }).click();
    await expect(chip(page)).toHaveAccessibleName(/^Select model: Claude Opus[^,]*$/);
    await expect(chip(page).locator('.model-borrowed')).toHaveCount(0);
    await expect.poll(borrowing).toBeUndefined();
  } finally {
    await client.call('threads.delete', { threadId: thread.id }).catch(() => {});
    await client.call('profiles.delete', { id: work.id }).catch(() => {});
    client.close();
  }
});
