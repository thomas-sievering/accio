# System prompt

Users read, but cannot edit, what Accio adds to each harness's own instructions on every turn.

## Sub-features

- `system-prompt-page`: Settings item after Harnesses; delivery per harness; each section once with the harnesses that receive it.
- `system-prompt-sent`: the text a harness actually receives on a turn, with the real harness and model filled in.

## How to get to it (user POV)

- Open `Settings`, then `System prompt` in the sidebar, directly below `Harnesses`.

## Driving it with Playwright

Preconditions: healthy isolated instance and one UI-created profile (first run blocks Settings until then). No account is needed.

- **Open.** Click `Settings`, then `page.locator('.sidebar nav').getByRole('button', { name: 'System prompt', exact: true })`. Require `aria-current="page"` on that item and breadcrumb `System prompt`.
- **Delivery.** In the card headed `How harnesses receive it`, require `Appended to Claude Code's built-in system prompt.` and `Sent as developer instructions, alongside Codex's built-in instructions.`
- **Sections.** Card headings (`.settings-section h2`) are `How harnesses receive it`, `Accio`, `Runtime`, `Inline media`, `File links`. Each section card has one `.prompt-section` per distinct text; its `list` named `Sent to` holds the harness names. All four currently show one block for `Claude Code`, `Codex`.
- **Placeholders.** The Runtime text contains `{harness}` and `{model}`; the page note explains both in `.note code`. Example paths follow the machine's platform (`C:/work/...` on Windows).
- **Proof.** `await capture('system-prompt')`. For `system-prompt-sent`, the unit tests in `apps/server/src/harnesses/systemPrompt.test.ts` prove the shown text equals the sent text once placeholders are filled in; a live turn needs a signed-in account and is otherwise unverified.

## Gotchas

- `System prompt` also appears as the breadcrumb label; scope the menu click to `.sidebar nav`.
- A section limited to some harnesses, or worded differently per harness, appears as several blocks; that is intended, not duplication.
