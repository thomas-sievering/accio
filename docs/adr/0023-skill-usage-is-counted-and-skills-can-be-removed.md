---
status: proposed
---

# Skill usage is counted, and skills can be removed where they live

Proposed on 2026-11-18.

Each turn already records which skills it saw loaded: the `Skill` tool, a read of a `SKILL.md`, or a plain `cat` of one, stored on the transcript item as `loadedSkills`. Until now that only marked a skill Loaded in the open thread. Now Accio counts it. For each skill it keeps how often it was used, when it was last used, in which projects, and who started it:

- **Picked by the model**: a load the turn observed without a `/name` from you.
- **Called by you**: a message that named the skill with `/`, recorded when it is sent.

Threads stay on the machine that runs them, so each machine counts from its own transcripts and sends the totals to the hub. Settings shows the sum. The first count reads the transcripts that already exist, so usage starts from the history, not from zero. Detection stays conservative: a skill the model uses without a clean read, such as one it only greps, is not counted. A missed use is better than a false one.

Removing a skill depends on where it lives:

- **A project's or home's skill files** are code. **Remove** starts a thread in that repository that deletes the skill's folder, including a `.claude` copy of an `.agents` skill, and ships the change like any other (ADR 0015).
- **A library skill** belongs to someone else's repository. **Uninstall** hides it from the library and from every level, and can be undone. Removing a whole source stays as it is.
- **A harness skill** can't be removed. Off at Everywhere is as far as it goes (ADR 0022).

Settings → Skills gets a **Cleanup** view. It collects skills worth acting on:

- never used, or not used for 30 days, with what their descriptions cost each turn while they're Auto
- Auto skills only ever called by you, and Slash skills used often
- duplicates, overridden skills and conflicts
- sources with an update waiting

Several rows can take one action together: Slash, Off, Uninstall or Remove.

## Considered Options

- **Count on the hub as turns finish**: one place to read from, but no history for threads from before this change, and an offline machine's turns would be lost until it reconnects.
- **Ask the harness which skills it invoked**: exact for Claude's `Skill` tool, but Codex and skills read as files report nothing, so the counts wouldn't compare across harnesses.
- **Delete repository skill files directly from Settings**: quicker, but it changes a repository outside any thread, with no commit, review or delivery.
