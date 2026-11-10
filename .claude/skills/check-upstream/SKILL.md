---
name: check-upstream
description: Review new T3 Code commits and releases since the last check and shortlist what Accio should copy or adapt.
disable-model-invocation: true
---

Accio borrows heavily from T3 Code (`pingdotgg/t3code`, MIT). This skill reviews upstream changes since the **cursor** in [`LAST-CHECKED.md`](LAST-CHECKED.md) and produces a shortlist of **candidates**: upstream changes Accio should copy, adapt or note.

## 1. Fetch

Keep a blobless clone outside the workspace and update it:

```sh
cd ~/.cache && (test -d t3code || git clone -q --filter=blob:none --no-checkout https://github.com/pingdotgg/t3code.git t3code)
git -C ~/.cache/t3code fetch -q origin
```

Read the cursor SHA from `LAST-CHECKED.md`. The range is `<cursor>..origin/main`. Record the new head SHA now; it becomes the next cursor.

Done when you know the range and its commit count.

## 2. Releases first

List stable releases published after the cursor date (`gh release list -R pingdotgg/t3code --exclude-pre-releases`), then read their notes (`gh release view <tag> -R pingdotgg/t3code`). Nightly and Android beta releases add nothing beyond the commits, so leave them out. Release notes give a curated overview. Note their headline features before you read raw commits.

## 3. Triage commits

Upstream merges hundreds of commits a week, so triage on subjects (`git log --format='%h %cs %s' <range>`) and open diffs only for survivors. Subjects follow `type(scope): ...`.

**Drop** areas Accio does not have:
- scopes `mobile`, `marketing`, `gitlab`, `antigravity`, along with any other provider or source-control host besides Claude, Codex, pi and GitHub
- `ci`, `chore`, `release`, dependency bumps, and `test` commits unless they cover a kept area
- paths under `apps/mobile`, `apps/marketing`, `packages/provider-*` (except `provider-core`, `provider-pi`), `packages/source-control-*` (except `core`, `github`), `packages/ssh`, `packages/tailscale`

**Keep**, roughly in this order of interest:
- `feat` of any kept scope: new capabilities are the main reason to run this skill
- harness integration with Claude Agent SDK or Codex app-server: sessions, resume, models, tool wiring, handoff
- thread lifecycle, orchestration, Git actions, PR sync, secrets, MCP tools
- web UI patterns and chat rendering (`web`, `client-runtime`, `shared`)
- `perf` and `fix` commits that address a bug class Accio shares (same SDK, same harness protocol, same UI pattern)

For more than about 150 surviving commits, split them across parallel sub-agents, typically features, server/harness, and web/desktop, plus one for everything else. Write each batch to its own file under `~/.cache/t3code-check/` and name that exact file in the prompt. Also give each sub-agent the clone path, the keep criteria above, and the step 4 output format.

Done when every commit in the range has been kept or dropped, and each kept commit has its diff read.

## 4. Match against Accio

For each kept commit, find the Accio owner (start from the table in `AGENTS.md`) and check whether Accio already does the same thing. Search `docs/plans` and `docs/adr` for earlier T3 references to it as well. A candidate earns its place by one of these:

- **Copy**: self-contained code Accio can take nearly as-is (helpers, parsers, SDK workarounds)
- **Adapt**: a pattern or feature worth rebuilding around Accio's own model (hub relay, deliveries, profiles)
- **Note**: a bug fix or SDK quirk Accio is likely exposed to, worth a check

Link each upstream change at a pinned SHA (`https://github.com/pingdotgg/t3code/commit/<sha>` or `blob/<sha>/<path>`), as the existing plans do.

## 5. Report

Reply with:

1. The range checked (`<old>..<new>`, dates, commit count, stable releases covered).
2. A candidate table, best first: verdict (Copy/Adapt/Note), upstream link, what it does in one line, Accio owner, rough effort.
3. One line on what was dropped in bulk (e.g. "212 mobile, 40 GitLab, ...").

Ask which candidates to act on. Each one picked becomes its own task: a plan under `docs/plans`, an issue, or a direct change. Copied code keeps T3's MIT copyright and license notice.

## 6. Advance the cursor

Update `LAST-CHECKED.md` with the new head SHA, its date, and the latest stable release covered, so the next run starts there. Move the cursor even when no candidates were picked; the triage already happened.
