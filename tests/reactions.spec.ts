import { expect, test, type Page } from '@playwright/test';

const token = 'isolated-chat-test-token';
const question = 'Should I keep the existing cache?';

/** Selects `text` inside the last element matching `selector`, as dragging over it would. */
async function select(page: Page, selector: string, text: string) {
  await page.locator(selector).last().evaluate((root, text) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.indexOf(text);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + text.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return;
    }
    throw new Error(`No text "${text}"`);
  }, text);
}

test('reacting to selected assistant text adds chips that reach the model and show in the message', async ({ page, baseURL }, testInfo) => {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
  await page.getByRole('option', { name: 'No project', exact: true }).click();
  if (await page.getByRole('combobox', { name: 'Search profiles' }).isVisible()) await page.getByRole('option', { name: 'Personal', exact: true }).click();
  const textarea = page.locator('.composer textarea');
  await textarea.fill('Ask me about the cache');
  await textarea.press('Enter');
  const answer = page.locator('.msg.assistant').last();
  await expect(answer).toContainText(question);
  await expect(page.locator('.composer .stop')).toHaveCount(0);

  const bar = page.getByRole('toolbar', { name: 'React to the selected text' });
  const chips = page.locator('.composer-reaction');

  // Dragging over the answer offers the three reactions once the pointer lets go, just above it; Escape puts them away.
  const line = (await answer.locator('p').first().boundingBox())!;
  await page.mouse.move(line.x + 2, line.y + line.height / 2);
  await page.mouse.down();
  await page.mouse.move(line.x + line.width / 2, line.y + line.height / 2, { steps: 5 });
  await expect(bar).toBeHidden();
  await page.mouse.up();
  await expect(bar.getByRole('button')).toHaveText(['👍', '❓', '👎']);
  const barBox = (await bar.boundingBox())!;
  const answerBox = (await answer.boundingBox())!;
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(answerBox.y + 4);
  await page.screenshot({ path: testInfo.outputPath('reaction-bar.png') });
  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();

  await select(page, '.msg.assistant', question);
  await bar.getByRole('button', { name: 'Agree', exact: true }).click();
  await expect(bar).toBeHidden();
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toContainText(`👍${question}`);
  expect(await page.evaluate(() => getSelection()!.isCollapsed)).toBe(true);

  await select(page, '.msg.assistant', 'debounces');
  await bar.getByRole('button', { name: 'Unclear', exact: true }).click();
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(1)).toContainText('❓debounces');

  // Reacting to the same passage again replaces its reaction instead of adding a chip.
  await select(page, '.msg.assistant', 'debounces');
  await bar.getByRole('button', { name: 'Disagree', exact: true }).click();
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(1)).toContainText('👎debounces');

  // The chip's emoji switches the reaction, round the three.
  const kind = chips.nth(1).locator('.composer-reaction-kind');
  await kind.click();
  await expect(kind).toHaveText('👍');
  await kind.click();
  await expect(kind).toHaveText('❓');
  await page.locator('.composer').screenshot({ path: testInfo.outputPath('composer-reactions.png') });

  // A user message's text offers nothing.
  await select(page, '.msg.user', 'Ask me');
  await expect(bar).toBeHidden();

  // Reactions survive a reload, like the draft text.
  await textarea.fill('Go ahead');
  await page.reload();
  await expect(chips).toHaveCount(2);
  await expect(textarea).toHaveValue('Go ahead');

  await textarea.press('Enter');
  await expect(page.getByText(`Reactions: agree on "${question}"; unclear on "debounces". Typed: Go ahead`, { exact: true })).toBeVisible();
  await expect(chips).toHaveCount(0);
  const sent = page.locator('.msg.user').last();
  await expect(sent.locator('.reaction-card')).toHaveCount(2);
  await expect(sent.locator('.reaction-card').first().getByRole('img', { name: 'Agree' })).toHaveText('👍');
  await expect(sent.locator('.reaction-card blockquote')).toHaveText([question, 'debounces']);
  await expect(sent.locator('.msg-text')).toHaveText('Go ahead');
  await sent.screenshot({ path: testInfo.outputPath('message-reactions.png') });

  // A reaction alone can be sent.
  await select(page, '.msg.assistant >> nth=0', 'flushing');
  await bar.getByRole('button', { name: 'Agree', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await textarea.press('Enter');
  await expect(page.getByText('Reactions: agree on "flushing". Typed: nothing', { exact: true })).toBeVisible();
});
