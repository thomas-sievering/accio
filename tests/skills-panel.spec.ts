import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const token = 'isolated-chat-test-token';
const panel = (page: Page) => page.getByRole('tabpanel', { name: 'Skills' });
const projectList = (page: Page) => panel(page).locator('section').first();
const skillRow = (page: Page, name: string) => panel(page).locator('.skill-item').filter({ has: page.getByRole('button', { name: new RegExp(`^${name}\\b`) }) });

test('narrow panel wraps focus in both directions without a blank or background stop', async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await openSkills(page, baseURL!, /Skills fixture/);
  const first = page.getByRole('tab', { name: 'Skills', exact: true });
  const toggle = page.getByRole('button', { name: 'Side panel', exact: true });
  await first.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  for (const direction of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press(direction);
      expect(await page.evaluate(() => {
        const focused = document.activeElement;
        return !!focused?.closest('.side-panel, .panel-toggle');
      })).toBe(true);
    }
  }
  await page.screenshot({ path: info.outputPath('overlay-keyboard-focus.png') });
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  // Settings opened from the narrow panel must release its focus boundary.
  await toggle.click();
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await page.getByRole('tabpanel', { name: 'MCP' }).getByRole('button', { name: 'docs-search Remote', exact: true }).click();
  await expect(page.locator('.settings-page').getByRole('textbox').first()).toBeFocused();
  const accounts = page.locator('.sidebar nav').getByRole('button', { name: 'Accounts', exact: true });
  await accounts.focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('.sidebar nav').getByRole('button', { name: 'Secrets', exact: true })).toBeFocused();
});

async function openSkills(page: Page, baseURL: string, thread: RegExp) {
  await page.goto(`${baseURL}/#token=${token}`);
  await page.getByRole('button', { name: thread }).click();
  const toggle = page.getByRole('button', { name: 'Side panel', exact: true });
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  await expect(page.getByRole('tab', { name: 'Skills', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page).getByText('Loading skills…')).toHaveCount(0);
}

test('Skills tab lists project and inherited skills, adds, references, edits, disables and jumps to loads', async ({ page, baseURL }, testInfo) => {
  await openSkills(page, baseURL!, /Skills fixture/);

  // Project skills: the repository's own file, marked loaded by the turn that read it.
  const notes = skillRow(page, 'repo-notes');
  await expect(notes).toContainText('Repository');
  const loaded = page.getByRole('button', { name: 'repo-notes: loaded this thread. Show in transcript' });
  await expect(loaded).toBeVisible();

  // Inherited skills start folded behind their counts.
  const fold = panel(page).getByRole('button', { name: /^Inherited/ });
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(fold).toHaveAttribute('title', /^1 available · 0 loaded\./);
  await expect(fold.locator('.skills-count')).toHaveText('1');
  await expect(skillRow(page, 'lib-docs')).toHaveCount(0);
  await fold.click();
  await expect(skillRow(page, 'lib-docs')).toContainText('Profile · Library');
  await expect(skillRow(page, 'lib-docs').getByRole('button', { name: /loaded this thread/ })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('skills-panel.png') });

  // Loaded jumps to the reading tool call, opening the turn's fold.
  await expect(page.locator('.tool')).toHaveCount(0);
  await loaded.click();
  const read = page.locator('.tool').filter({ hasText: 'Read' });
  await expect(read).toHaveClass(/revealed/);
  await expect(read.locator('.tool-toggle')).toBeFocused();
  await expect(read).toBeInViewport();

  // Add skill searches the library skills not on here yet and turns one on for the project.
  await panel(page).getByRole('button', { name: 'Add skill', exact: true }).click();
  const search = page.getByRole('combobox', { name: 'Search library skills' });
  await expect(search).toBeFocused();
  await expect(panel(page).getByRole('option')).toHaveText([/lib-review/]);
  await search.fill('nothing like this');
  await expect(panel(page).getByText('No matching skills.')).toBeVisible();
  await search.fill('review');
  await search.press('Enter');
  await expect(panel(page).getByRole('status').filter({ hasText: 'lib-review added to this project' })).toBeAttached();
  const review = projectList(page).locator('.skill-item').filter({ hasText: 'lib-review' });
  await expect(review).toContainText('Library');
  await expect(review).not.toContainText('Library · Library');
  await expect(panel(page).getByRole('button', { name: 'Add skill', exact: true })).toBeFocused();

  // The selection is the hub's: a fresh load shows it too.
  await openSkills(page, baseURL!, /Skills fixture/);
  await expect(projectList(page).locator('.skill-item').filter({ hasText: 'lib-review' })).toBeVisible();

  // Expanded rows show instructions, source and path, and reference the skill in the next message.
  await page.locator('.composer textarea').fill('Please');
  await projectList(page).getByRole('button', { name: /^lib-review/ }).click();
  const reviewBody = projectList(page).locator('.skill-item.open');
  await expect(reviewBody.locator('.skill-content')).toContainText('Review instructions.');
  await expect(reviewBody).toContainText('Library');
  await expect(reviewBody.getByRole('button', { name: 'Edit instructions' })).toHaveCount(0);
  await reviewBody.getByRole('button', { name: 'Reference in message' }).click();
  await expect(page.locator('.composer textarea')).toHaveValue('Please Use the lib-review skill.');
  await expect(page.locator('.composer textarea')).toBeFocused();

  // Disable for this project takes it off again.
  await reviewBody.getByRole('button', { name: 'Disable for this project' }).click();
  await expect(projectList(page).locator('.skill-item').filter({ hasText: 'lib-review' })).toHaveCount(0);

  // Repository instructions are edited in place and saved to the checkout's file.
  await notes.getByRole('button', { name: 'repo-notes Repository', exact: true }).click();
  const path = (await notes.locator('.skill-path').textContent())!;
  await expect(notes.locator('.skill-content')).toContainText('Write notes in plain sentences.');
  await notes.getByRole('button', { name: 'Edit instructions' }).click();
  const editor = notes.getByRole('textbox', { name: 'Instructions' });
  const edited = (await editor.inputValue()).replace('Write notes in plain sentences.', 'Write notes as short lists.');
  await editor.fill(edited);
  await notes.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(notes.getByText('Saved to the repository. Applies from the next turn.')).toBeVisible();
  await expect(notes.locator('.skill-content')).toContainText('Write notes as short lists.');
  expect(await readFile(path.endsWith('SKILL.md') ? path : `${path}/SKILL.md`, 'utf8')).toContain('Write notes as short lists.');
  await page.screenshot({ path: testInfo.outputPath('skills-edited.png') });

  // Switching to a thread outside any project changes the context.
  await page.getByRole('button', { name: /Inline chat fixture/ }).click();
  await expect(panel(page).getByText('No project', { exact: true })).toBeVisible();
  await expect(panel(page).getByText(/Project skills need a project/)).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Add skill', exact: true })).toHaveCount(0);
  await expect(skillRow(page, 'repo-notes')).toHaveCount(0);
});

test('MCP tab lists every MCP server, flags sign-in and opens settings', async ({ page, baseURL }, testInfo) => {
  await openSkills(page, baseURL!, /Skills fixture/);
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  const mcp = page.getByRole('tabpanel', { name: 'MCP' });
  const row = (name: string) => mcp.locator('.mcp-item').filter({ has: page.getByRole('button', { name: new RegExp(`^${name}\\b`) }) });

  await expect(mcp.getByRole('heading', { name: 'Servers 2' })).toBeVisible();
  await expect(row('docs-search')).toContainText('Remote');
  await expect(row('docs-search')).toContainText('https://mcp.example.test/docs');
  await expect(row('docs-search')).toContainText('Signed out');
  await expect(row('local-db')).toContainText('db-mcp --readonly');
  await expect(row('local-db')).not.toContainText('Signed out');
  await page.screenshot({ path: testInfo.outputPath('mcp-panel.png') });

  // Arrow keys move between tabs, and the choice is remembered.
  await page.getByRole('tab', { name: 'MCP', exact: true }).press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Skills', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Skills', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await page.goto(`${baseURL}/#token=${token}`);
  await page.getByRole('button', { name: /Skills fixture/ }).click();
  await expect(page.getByRole('tab', { name: 'MCP', exact: true })).toHaveAttribute('aria-selected', 'true');

  // A row opens that server in settings.
  await page.getByRole('tabpanel', { name: 'MCP' }).getByRole('button', { name: 'docs-search Remote', exact: true }).click();
  await expect(page.locator('.layout.with-panel')).toBeHidden();
  await expect(page.getByText('docs-search').first()).toBeVisible();
});
