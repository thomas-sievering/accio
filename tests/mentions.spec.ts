import { expect, test } from '@playwright/test';

const token = 'isolated-chat-test-token';

test('typing @ offers models, machines and threads, typing after it lists matches, and the sent message shows a chip', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
  await page.getByRole('option', { name: 'No project', exact: true }).click();
  if (await page.getByRole('combobox', { name: 'Search profiles' }).isVisible()) await page.getByRole('option', { name: 'Personal', exact: true }).click();
  const input = page.locator('.composer textarea');
  const menu = page.getByRole('listbox', { name: 'Mention a model, machine or thread' });

  await input.pressSequentially('use @');
  await expect(menu).toBeVisible();
  // Only @: a row per kind. This machine is online, so Machines is offered.
  await expect(menu.getByRole('option').first()).toHaveText('Models');
  await expect(menu.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await expect(menu.getByRole('option', { name: 'Machines' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mention-kinds.png') });
  // Enter opens a kind, and Backspace goes back to the kinds with the @ kept.
  await input.press('Enter');
  await expect(menu.getByRole('option').first()).not.toHaveText('Models');
  await page.screenshot({ path: testInfo.outputPath('mention-menu.png') });
  await input.press('Backspace');
  await expect(menu.getByRole('option').first()).toHaveText('Models');
  await expect(input).toHaveValue('use @');

  await input.pressSequentially('so');
  await expect(menu.getByRole('option').first()).toHaveText('Sonnet');
  // Enter picks rather than sends.
  await input.press('Enter');
  await expect(menu).toBeHidden();
  await expect(input).toHaveValue('use @sonnet ');

  await input.pressSequentially('for this, ask @');
  await expect(menu).toBeVisible();
  await input.press('Escape');
  await expect(menu).toBeHidden();
  await input.pressSequentially('h');
  await expect(menu).toBeHidden();
  await input.press('Backspace');
  await input.press('Backspace');
  await input.pressSequentially('@ha');
  await input.press('Tab');
  await expect(input).toHaveValue('use @sonnet for this, ask @haiku ');

  // In the composer each mention shows as a pill over its typed text.
  await expect(page.locator('.composer-backdrop .composer-mention')).toHaveText(['@sonnet', '@haiku']);
  await page.locator('.composer').screenshot({ path: testInfo.outputPath('mention-pills.png') });

  await input.press('Enter');
  const message = page.locator('.msg.user').first();
  await expect(message.locator('.mention')).toHaveText(['Sonnet', 'Haiku']);
  await expect(message).toContainText('for this, ask');
  await message.screenshot({ path: testInfo.outputPath('mention-chip.png') });
});

test('typing @ lists the online machines too, and a sent machine mention shows a chip', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
  await page.getByRole('option', { name: 'No project', exact: true }).click();
  if (await page.getByRole('combobox', { name: 'Search profiles' }).isVisible()) await page.getByRole('option', { name: 'Personal', exact: true }).click();
  const input = page.locator('.composer textarea');
  const menu = page.getByRole('listbox', { name: 'Mention a model, machine or thread' });

  await input.pressSequentially('screenshot @');
  await menu.getByRole('option', { name: 'Machines' }).click();
  const here = menu.getByRole('option').filter({ hasText: 'This machine' });
  const handle = (await here.getAttribute('title'))!;
  const name = (await here.locator('.mention-machine').textContent())!;
  await here.click();
  await expect(menu).toBeHidden();
  await expect(input).toHaveValue(`screenshot ${handle} `);

  await input.press('Enter');
  const message = page.locator('.msg.user').first();
  await expect(message.locator('.mention')).toHaveText([name]);
  await expect(message.locator('.mention')).toHaveAttribute('title', `Machine ${name} · ${handle}`);
  await message.screenshot({ path: testInfo.outputPath('machine-chip.png') });
});

test('typing @ lists recent threads under Threads, and a mentioned thread shows as a chip with its title', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=${token}`);
  const newThread = async () => {
    await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
    await page.getByRole('option', { name: 'No project', exact: true }).click();
    if (await page.getByRole('combobox', { name: 'Search profiles' }).isVisible()) await page.getByRole('option', { name: 'Personal', exact: true }).click();
  };
  await newThread();
  const input = page.locator('.composer textarea');
  await input.fill('Trace the flaky checkout total');
  await input.press('Enter');
  await expect(page.locator('.msg.user').first()).toContainText('Trace the flaky checkout total');

  await newThread();
  const menu = page.getByRole('listbox', { name: 'Mention a model, machine or thread' });
  await input.pressSequentially('what did @');
  await menu.getByRole('option', { name: 'Threads' }).click();
  await expect(menu.locator('.mention-back')).toContainText('Threads');
  const option = menu.getByRole('option').first();
  await expect(option).toHaveAttribute('data-group', /Open|Working/);
  await page.screenshot({ path: testInfo.outputPath('mention-threads.png') });
  const handle = (await option.getAttribute('title'))!;
  const threadTitle = (await option.locator('.mention-thread').textContent())!;
  await option.click();
  await expect(input).toHaveValue(`what did ${handle} `);
  await expect(page.locator('.composer-backdrop .composer-mention')).toHaveText([handle]);
  await page.locator('.composer').screenshot({ path: testInfo.outputPath('thread-pill.png') });

  await input.pressSequentially('find?');
  await input.press('Enter');
  const message = page.locator('.msg.user').first();
  await expect(message.locator('.mention')).toHaveText([threadTitle]);
  await message.screenshot({ path: testInfo.outputPath('thread-chip.png') });
});
