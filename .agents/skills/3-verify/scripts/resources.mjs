import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const git = (cwd, ...args) => promisify(execFile)('git', ['-c', 'user.name=verify', '-c', 'user.email=verify@example.invalid', ...args], { cwd, windowsHide: true });

/** Tools, MCP servers and skills settings, plus project/profile/machine integration. */
export default async function journey({ page, runDir, home, fixture, action, capture }) {
  const button = (name) => page.getByRole('button', { name, exact: true });
  const nav = (name) => page.locator('.sidebar nav').getByRole('button', { name, exact: true });
  const textbox = (name) => page.getByRole('textbox', { name, exact: true });
  const resources = () => readFile(join(home, 'hub/resources.json'), 'utf8').then(JSON.parse);
  const log = [];

  await action('profiles/first-run: create Verify personal', async () => {
    await page.getByPlaceholder('personal, work…').fill('Verify personal');
    await button('Add').click();
    await page.getByText('Choose an account for Verify personal', { exact: true }).waitFor();
  });
  await action('projects/toolbar: add the disposable folder', async () => {
    await button('Add project').click();
    await textbox('Folder').fill(fixture);
    await page.getByRole('dialog').getByText(/no git remote; this folder is its own project/).waitFor();
    await button('Add').click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  });
  const project = JSON.parse(await readFile(join(home, 'projects.json'), 'utf8')).projects[0];
  const key = project.repoKey ?? `local:${project.id}`;

  await action('tools/settings: empty state, preset, validation and optional save', async () => {
    await button('Settings').click();
    await nav('Tools').click();
    await page.getByText('No tools yet', { exact: true }).waitFor();
    await page.getByRole('button', { name: /^Add tool / }).click();
    await button('Use preset').click();
    assert.equal(await textbox('npm package').inputValue(), '@playwright/cli');
    assert.equal(await textbox('Executable').inputValue(), 'playwright-cli');
    assert.equal(await textbox('Version').inputValue(), '0.1.23');
    await textbox('Version').fill('1 2');
    await page.getByText('Use an exact version, such as 1.2.3.').waitFor();
    await textbox('Version').fill('0.1.23');
    await page.getByRole('checkbox', { name: /^Install on all machines/ }).waitFor();
    await button('Add tool').click();
    await page.getByRole('heading', { name: 'Playwright CLI', exact: true }).waitFor();
    await page.getByRole('group', { name: /\(this machine\): Pending$/ }).waitFor();
    await page.getByText(/Optional and not selected anywhere/).waitFor();
    const tool = (await resources()).tools.find((t) => t.id === 'playwright-cli');
    assert.deepEqual(tool.scope, { global: false, profileIds: [], projectKeys: [] });
    assert.equal(tool.package, '@playwright/cli');
    log.push({ tool });
  });
  await capture('tools-preset-saved');

  await action('tools/status: a failing install needs attention and explains the blocked repair', async () => {
    await button('Done').click();
    await page.getByRole('button', { name: /^Add tool / }).click();
    await textbox('Name').fill('Broken tool');
    await textbox('npm package').fill('accio-verify-missing-package-zz9');
    await textbox('Version').fill('0.0.1');
    await textbox('Executable').fill('accio-missing');
    await button('Add tool').click();
    await page.getByRole('heading', { name: 'Broken tool', exact: true }).waitFor();
    await button('Install and check').click();
    await page.getByRole('group', { name: /\(this machine\): Needs attention$/ }).waitFor({ timeout: 180_000 });
    await page.getByText(/^No repair thread: Sign in to a provider/).waitFor();
    assert(await button('Start repair thread').isEnabled());
    const status = (await resources()).toolStatuses.find((s) => s.toolId === 'broken-tool');
    assert.equal(status.status, 'error');
    assert.match(status.repairError, /Sign in to a provider/);
    log.push({ status: { ...status, detail: status.detail?.slice(0, 300) } });
  });
  await capture('tools-needs-attention');

  await action('mcp/settings: bearer server with profile scope, token never shown', async () => {
    await nav('MCP servers').click();
    await page.getByText('No MCP servers yet', { exact: true }).waitFor();
    await page.getByRole('button', { name: /^Add MCP server / }).click();
    await textbox('Name').fill('Linear (work)');
    await textbox('Server URL').fill('not a url');
    await page.getByText(/Enter a full URL/).waitFor();
    await textbox('Server URL').fill('https://example.invalid/mcp');
    await page.getByRole('combobox', { name: 'Authentication' }).selectOption('bearer');
    await page.getByRole('group', { name: 'Profiles' }).getByRole('checkbox', { name: 'Verify personal' }).check();
    await button('Add MCP server').click();
    await page.getByRole('heading', { name: 'Linear (work)', exact: true }).waitFor();
    await textbox('Bearer token').fill('verify-secret-token');
    await button('Save token').click();
    await page.getByText(/A token is saved on the hub/).waitFor();
    assert(!(await page.content()).includes('verify-secret-token'));
    const state = await resources();
    const m = state.mcps.find((x) => x.name === 'Linear (work)');
    assert.equal(m.scope.profileIds.length, 1);
    assert(!JSON.stringify(state).includes('verify-secret-token'));
    const creds = JSON.parse(await readFile(join(home, 'hub/mcp-credentials.json'), 'utf8'));
    assert(Object.keys(creds).includes(m.id));
    await button('Done').click();
    await page.getByRole('button', { name: /^Linear \(work\).*Signed in/ }).waitFor();
  });
  await action('mcp/oauth: sign-in failure stays visible', async () => {
    await page.getByRole('button', { name: /^Add MCP server / }).click();
    await textbox('Name').fill('Linear (personal)');
    await textbox('Server URL').fill('https://example.invalid/mcp');
    await page.getByRole('combobox', { name: 'Authentication' }).selectOption('oauth');
    await button('Add MCP server').click();
    await page.getByRole('heading', { name: 'Linear (personal)', exact: true }).waitFor();
    await page.getByText(/Signed out\. Threads can’t use/).waitFor();
    await button('Sign in').click();
    const alert = page.getByRole('alert');
    await alert.waitFor({ timeout: 60_000 });
    log.push({ oauthError: await alert.innerText() });
    await button('Done').click();
  });
  await action('mcp/stdio: local command server saves optional', async () => {
    await page.getByRole('button', { name: /^Add MCP server / }).click();
    await textbox('Name').fill('Local echo');
    await page.getByRole('radio', { name: /^Local command/ }).check();
    await button('Add MCP server').click();
    await page.getByText('Enter the command that starts the server, such as npx.').waitFor();
    await textbox('Command').fill('node');
    await page.getByRole('textbox', { name: 'Arguments, one per line' }).fill('-e\nprocess.stdin.resume()');
    await button('Add MCP server').click();
    await page.getByRole('heading', { name: 'Local echo', exact: true }).waitFor();
    const m = (await resources()).mcps.find((x) => x.name === 'Local echo');
    assert.deepEqual(m.args, ['-e', 'process.stdin.resume()']);
    assert.equal(m.auth, 'none');
    await button('Done').click();
    await page.getByRole('button', { name: /^Local echo.*Local$/ }).waitFor();
  });
  await capture('mcp-list');

  // Verification scaffolding: a disposable local Git skill source inside scratch.
  const source = join(dirname(fixture), 'skill-source');
  await mkdir(join(source, 'skills', 'demo'), { recursive: true });
  await writeFile(join(source, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: First description\n---\n# Demo\n');
  await git(dirname(fixture), 'init', '--quiet', source);
  await git(source, 'add', '.');
  await git(source, 'commit', '--quiet', '-m', 'one');

  await action('skills/settings: add a Git source; skills start optional', async () => {
    await nav('Skills').click();
    await page.getByText('No skill sources yet', { exact: true }).waitFor();
    await page.getByRole('button', { name: /^Add skill source / }).click();
    await textbox('Name').fill('Verify skills');
    await textbox('Git URL').fill(source);
    await button('Add source').click();
    await page.getByRole('heading', { name: 'Verify skills', exact: true }).waitFor({ timeout: 60_000 });
    await page.getByText('First description').waitFor();
    await page.getByText('Optional', { exact: true }).waitFor();
  });
  await action('skills/scope: enable synced skill for the profile', async () => {
    await button('Enable synced skill').click();
    await page.getByRole('group', { name: 'Profiles' }).getByRole('checkbox', { name: 'Verify personal' }).check();
    await button('Save').click();
    await page.getByText('Enabled: Verify personal').waitFor();
    assert.equal((await resources()).skills[0].scope.profileIds.length, 1);
  });

  await writeFile(join(source, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: Second description\n---\n# Demo\n');
  await mkdir(join(source, 'skills', 'extra'), { recursive: true });
  await writeFile(join(source, 'skills', 'extra', 'SKILL.md'), '---\nname: extra\ndescription: Added later\n---\n');
  await git(source, 'add', '.');
  await git(source, 'commit', '--quiet', '-m', 'two');

  await action('skills/update: preview shows changes without applying, then apply and roll back', async () => {
    const first = (await resources()).skills[0].revision;
    await button('Check for updates').click();
    const preview = page.getByRole('region', { name: /^Revision / });
    await preview.waitFor({ timeout: 60_000 });
    await preview.getByText('New', { exact: true }).waitFor();
    await preview.getByText('Changed', { exact: true }).waitFor();
    assert.equal((await resources()).skills[0].revision, first, 'preview must not activate');
    await capture('skills-preview');
    await page.getByRole('button', { name: /^Apply / }).click();
    await page.getByText('Added later').waitFor();
    const applied = await resources();
    assert.notEqual(applied.skills[0].revision, first);
    assert.equal(applied.skills.find((s) => s.name === 'demo').scope.profileIds.length, 1, 'scope survives update');
    await button('Switch to this revision').click();
    await page.getByText('First description').waitFor();
    await page.getByText('Added later').waitFor({ state: 'detached' });
    assert.equal((await resources()).skills[0].revision, first);
  });
  await action('skills/copy: copy into project once, refuse overwrite', async () => {
    await button('Copy into project').click();
    const select = page.getByRole('combobox', { name: 'Checkout on this machine' });
    await select.selectOption({ index: 1 });
    await button('Copy').click();
    await page.getByText(/^Copied to/).waitFor();
    await access(join(fixture, '.agents', 'skills', 'demo', 'SKILL.md'));
    await button('Copy').click();
    await page.getByRole('alert').getByText(/already has a skill/).waitFor();
  });
  await capture('skills-copied');

  await action('projects/sheet: inherited status and project-only selection preserve scope', async () => {
    await button('Back').click();
    await button('Filter threads').click();
    await button('verify-project settings').click();
    const dialog = page.getByRole('dialog');
    const skill = dialog.getByRole('group', { name: 'Skills' }).getByRole('checkbox', { name: /^demo/ });
    assert(await skill.isChecked());
    assert(await skill.isDisabled());
    await dialog.getByText('On for profile Verify personal').first().waitFor();
    const echo = dialog.getByRole('group', { name: 'MCP servers' }).getByRole('checkbox', { name: /^Local echo/ });
    assert(!(await echo.isChecked()));
    await echo.check();
    await dialog.getByText('On for this project').waitFor();
    const m = (await resources()).mcps.find((x) => x.name === 'Local echo');
    assert.deepEqual(m.scope, { global: false, profileIds: [], projectKeys: [key] });
    await capture('project-sheet-resources');
    await button('Close').click();
  });
  await action('profiles/settings: per-profile selection keeps project selections', async () => {
    await button('Settings').click();
    await page.getByRole('button', { name: /^Verify personal/ }).click();
    const group = page.getByRole('group', { name: 'MCP servers' });
    const work = group.getByRole('checkbox', { name: /^Linear \(work\)/ });
    assert(await work.isChecked());
    await work.uncheck();
    await page.waitForFunction(() => true);
    await assertEventually(async () => (await resources()).mcps.find((x) => x.name === 'Linear (work)').scope.profileIds.length === 0);
    assert(!(await work.isChecked()));
    assert.deepEqual((await resources()).mcps.find((x) => x.name === 'Local echo').scope.projectKeys, [key], 'project selection kept');
    await capture('profile-resources');
    await button('Done').click();
  });
  await action('machines/detail: managed tool readiness reuses status cards', async () => {
    await nav('Machines').click();
    await page.getByRole('button', { name: /\(this machine\)/ }).click();
    await page.getByRole('heading', { name: 'Managed tools', exact: true }).waitFor();
    await page.getByRole('group', { name: 'Broken tool: Needs attention' }).waitFor();
    await page.getByRole('group', { name: 'Playwright CLI: Pending' }).waitFor();
  });
  await capture('machine-tools');
  await action('responsive: tool detail at narrow width', async () => {
    await page.setViewportSize({ width: 560, height: 900 });
    await nav('Tools').click();
    await page.getByRole('button', { name: /^Broken tool/ }).click();
    await page.getByRole('heading', { name: 'Machines', exact: true }).waitFor();
  });
  await capture('tools-narrow');

  const state = await resources();
  await writeFile(join(runDir, 'persisted-resources.json'), JSON.stringify({ ...state, toolStatuses: state.toolStatuses.map((s) => ({ ...s, detail: s.detail?.slice(0, 300) })) }, null, 2));
  await writeFile(join(runDir, 'journey-log.json'), JSON.stringify(log, null, 2));
}

async function assertEventually(check, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail('Condition not met in time');
}
