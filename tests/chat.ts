import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TestClient } from '../apps/worker/src/testing/testApp.js';

/** The chat fixture's sign-in token (scripts/chat-test-server.ts). */
export const CHAT_TOKEN = 'isolated-chat-test-token';

/** The disposable repositories and files the chat fixture made (scripts/chat-test-server.ts). */
export type ChatFixture = {
  deliveryFolder: string; deliveryOrigin: string; reviewFolder: string; reviewOrigin: string; reviewHostFile: string; issuesClaimFile: string;
};

export async function chatFixture(baseURL: string): Promise<ChatFixture> {
  return JSON.parse(await readFile(resolve('out', `chat-test-${new URL(baseURL).port}.json`), 'utf8'));
}

/** A client of the chat fixture's server, for arranging what the browser does not cover. */
export function chatClient(baseURL: string) {
  return TestClient.open(`${baseURL.replace('http:', 'ws:')}/ws?token=${CHAT_TOKEN}`);
}

/** Opens a draft for a new thread without a project, on the Personal profile. */
export async function newChatDraft(page: Page) {
  await page.locator('.sidebar').getByRole('button', { name: 'New thread', exact: true }).click();
  await page.getByRole('option', { name: 'No project', exact: true }).click();
  if (await page.getByRole('combobox', { name: 'Search profiles' }).isVisible()) await page.getByRole('option', { name: 'Personal', exact: true }).click();
}

/** Opens the chat fixture and starts a thread in the project matching `project` with `text`. */
export async function startProjectThread(page: Page, baseURL: string, project: RegExp, text: string) {
  await page.goto(`${baseURL}/#token=${CHAT_TOKEN}`);
  await page.getByRole('button', { name: 'New thread', exact: true }).first().click();
  await page.getByRole('option', { name: project }).click();
  await page.locator('.composer textarea').fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

/**
 * Runs `use` in the desktop shell (tests/electron-shell.cjs) on the chat fixture, with a
 * disposable user data folder named after `prefix`, then closes it and removes the folder.
 */
export async function withElectron(baseURL: string, prefix: string, use: (desktop: ElectronApplication, page: Page) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), prefix));
  const require = createRequire(import.meta.url);
  const executablePath = require('electron') as string;
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined));
  const desktop = await _electron.launch({ executablePath, args: [resolve('tests/electron-shell.cjs'), `--user-data-dir=${home}`], env: { ...environment, ACCIO_CHAT_TEST_URL: baseURL, ACCIO_CHAT_TEST_DOWNLOADS: home } });
  try {
    await use(desktop, await desktop.firstWindow());
  } finally {
    await desktop.close();
    if (!resolve(home).startsWith(join(tmpdir(), prefix))) throw new Error('Unexpected test home');
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}
