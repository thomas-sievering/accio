# Threads hand off between harnesses with history from their own transcript

A thread can change harness, such as from Claude Code to Codex, by choosing another provider's model in the picker. Until now a thread kept the harness it started with, because it stored one harness session and every turn resumed it. A Claude Code session means nothing to Codex.

A thread now keeps one session per harness it has used. On a change of harness the thread records a pending handoff. The next turn on the new harness either starts a fresh session or resumes the one it left. Its prompt is preceded by the conversation that harness has not seen, taken from accio's own transcript:

- A harness the thread has never run on receives the whole thread so far.
- A harness the thread ran on before resumes its own session and receives only what happened after it was left (from the last transcript item it saw).

The history is rendered as plain text: user and assistant messages, tool rows with their summaries and short outputs, and error notices. It fits a fixed character budget. The first and last user message and the last assistant message are kept first; the rest are filled in newest first, and the note says how many items were left out. Any turn on a thread that has handed off can read the whole transcript, in pages, through the `read_thread` accio tool.

The pending handoff is cleared only once the new harness reports its session, so a turn that fails before the harness takes the prompt sends the same history again on retry.

This follows T3 Code's provider switch (`ProviderSwitchService`, `ContextHandoffService`, `handoffBudget`), which keeps a native thread per provider and replays recorded history as either a full summary or a delta since that provider last saw the thread.

## Considered Options

- **Keep one harness per thread**: simple, but a profile with Claude and ChatGPT accounts cannot move a conversation between them, and running out of one allowance strands the thread.
- **Translate one harness's native session into the other's format**: Codex and Claude Code store tool calls, reasoning and encrypted content differently, and neither accepts the other's; the result would break with each harness release.
- **Inject history natively where the harness allows it** (Codex's `thread/inject_items`): cleaner for Codex, but Claude Code has no equivalent. Prepending text works for both and can be added per harness later.

## Consequences

The new harness sees a trimmed text version of the thread, without the other harness's tool state, reasoning or attached images. Long threads lose detail unless the agent reads it with `read_thread`. The handoff costs input tokens on the first turn after each switch. Switching back to a harness resumes its old session, whose own record of the files may be out of date. The prompt says what changed since.
