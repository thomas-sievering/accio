// Steps that several journeys share. Each drives the UI only, as the journey's own steps do.

/** The controls every journey reaches for: a button by its exact name, and a Settings section. */
export function controls(page) {
  return {
    button: (name) => page.getByRole('button', { name, exact: true }),
    section: (name) => page.locator('.sidebar nav').getByRole('button', { name, exact: true }),
  };
}

/** First run on an empty home: names the first profile Verify personal. */
export async function createFirstProfile(page) {
  const { button } = controls(page);
  await button('Continue').click();
  await page.getByPlaceholder('personal, work…').fill('Verify personal');
  await button('Continue').click();
  await page.getByText('Choose an account for Verify personal', { exact: true }).waitFor();
}

/** Adds `folder`, which has no git remote, through the toolbar's Add project. */
export async function addLocalProject(page, folder) {
  const { button } = controls(page);
  await button('Add project').click();
  await page.getByRole('textbox', { name: 'Folder', exact: true }).fill(folder);
  await page.getByRole('dialog').getByText(/no git remote; this folder is its own project/).waitFor();
  await button('Add').click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
}
