# System prompt

Users read, but cannot edit, what Accio adds to each harness's own instructions on every turn.

## Sub-features

- `system-prompt-page`: Settings item after Harnesses; delivery per harness; each section once with the harnesses that receive it.
- `system-prompt-sent`: the text a harness actually receives on a turn, with the real harness and model filled in.
- `system-prompt-size`: local baseline per harness with current built-in switches and standard Accio tools; estimated tokens and exact character counts.
- `thread-prompt-size`: last captured request's instructions, recognized project context and exposed tools, saved with the transcript.

## How to get to it (user POV)

- Open `Settings`, then `System prompt` in the sidebar, directly below `Harnesses`.

## Driving it with Playwright

Preconditions: healthy isolated instance and one UI-created profile (first run blocks Settings until then). No account is needed.

- **Open.** Click `Settings`, then `page.locator('.sidebar nav').getByRole('button', { name: 'System prompt', exact: true })`. Require `aria-current="page"` on that item and breadcrumb `System prompt`.
- **Delivery.** In the card headed `How harnesses receive it`, require `Appended to Claude Code's built-in system prompt.` and `Sent as developer instructions, alongside Codex's built-in instructions.`
- **Sections.** Require `Prompt size`, `How harnesses receive it`, `Accio`, `Runtime`, `Inline media`, `UI choices`, `File links`. Each prompt section has one `.prompt-section` per distinct text and a `Sent to` list of harness names.
- **Placeholders.** The Runtime text contains `{harness}` and `{model}`; the page note explains both in `.note code`. Example paths follow the machine's platform (`C:/work/...` on Windows).
- **Proof.** `await capture('system-prompt')`. For `system-prompt-sent`, the unit tests in `apps/worker/src/harnesses/systemPrompt.test.ts` prove the shown text equals the sent text once placeholders are filled in; a live turn needs a signed-in account and is otherwise unverified.
- **Baseline.** Click `Measure baseline` in the relevant `.prompt-baseline`; require `Measure again`, nonzero Accio/tool counts and the token-estimate explanation. No account is needed: the real harness stops at a local capture endpoint before inference. It includes standard Accio tools through an enumeration-only grant; project-specific tools/instructions need a thread.
- **Thread size.** Run `tests/prompt-size.spec.ts` on the chat fixture. Send `Prompt size fixture`, open the composer summary labelled `Prompt size`, require the source breakdown, reload and require the same counts. Counts stay out of `.messages`. The fixture substitutes the harness; `promptBaseline.native.test.ts` checks both installed binaries and switched-off tools, and `codex.native.test.ts` checks real forwarded request counts and resume with scripted inference.

## Gotchas

- `System prompt` also appears as the breadcrumb label; scope the menu click to `.sidebar nav`.
- A section limited to some harnesses, or worded differently per harness, appears as several blocks; that is intended, not duplication.
- Measurements retain counts only. Tokens use a rough four-characters-per-token conversion. Known Codex AGENTS/environment wrappers and Claude project reminders count as context; unknown wrappers, conversation and image payloads are excluded. Deferred tool definitions count only when exposed. The thread stat updates when a turn ends and retains its measurement timestamp.
