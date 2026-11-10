import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// A real model turn on the verify device, through its hub's signed-in account (see "Real model turns").
export const linkedHub = true;

export default async function realTurn({ page, home, fixture, runDir, action, capture }) {
  const button = (name) => page.getByRole('button', { name, exact: true });
  const project = page.getByRole('heading', { name: 'Add your first project', exact: true });
  await project.or(page.getByRole('heading', { name: /^(Name your first profile|Choose an account for )/ })).first().waitFor();
  assert(await project.isVisible(), 'The linked hub has no profile with a signed-in account.');
  await action('projects/first-run: add the disposable folder', async () => {
    await page.getByRole('textbox', { name: 'Folder', exact: true }).fill(fixture);
    await page.getByText(/no git remote; this folder is its own project/).waitFor();
    await button('Add').click();
    await project.waitFor({ state: 'hidden' });
  });
  await action('threads/picker: open a draft in the disposable project', async () => {
    await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search projects' }).fill('verify-project');
    await page.getByRole('option', { name: /^verify-project/ }).click();
    await page.locator('.composer textarea').waitFor();
  });
  await capture('draft');
  await action('threads/turn: send a prompt and receive a real reply', async () => {
    await page.locator('.composer textarea').fill('Reply with ACCIO_VERIFY_OK and do not run tools.');
    await button('Send').click();
    await page.locator('.messages .msg.user').getByText('Reply with ACCIO_VERIFY_OK').waitFor();
    await page.locator('.messages .msg.assistant').getByText(/ACCIO_VERIFY_OK/).first().waitFor({ timeout: 180_000 });
  });
  await capture('reply');
  await action('threads/turn: transcript persists the reply', async () => {
    // Transcripts are written when the turn settles, a little after the reply renders.
    let files = [], match = -1, transcripts = [];
    for (const deadline = Date.now() + 60_000; match < 0 && Date.now() < deadline; await new Promise((r) => setTimeout(r, 1000))) {
      files = (await readdir(home, { recursive: true })).filter((f) => /transcripts[\\/][^\\/]+\.json$/.test(f));
      transcripts = await Promise.all(files.map((f) => readFile(join(home, f), 'utf8')));
      match = transcripts.findIndex((t) => t.includes('ACCIO_VERIFY_OK') && /assistant/.test(t));
    }
    assert(match >= 0, `No persisted transcript contains the reply (checked ${files.length})`);
    await writeFile(join(runDir, 'transcript.json'), transcripts[match]);
  });
}
