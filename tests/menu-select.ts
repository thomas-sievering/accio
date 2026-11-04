import type { Page } from '@playwright/test';

/** Chooses an option in a MenuSelect: its trigger and its menu share one label. */
export async function pick(page: Page, label: string, option: string | RegExp) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('menu', { name: label, exact: true }).getByRole('menuitemradio', { name: option }).click();
}
