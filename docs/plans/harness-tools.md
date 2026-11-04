# Built-in tools: minimal harnesses, unified accio tools

Claude Code and Codex each bring their own tools. Some cannot work inside accio, some fight what accio already owns, and every one costs context on every request. Like [pi](https://pi.dev), accio starts each harness with only a shell and file reading and editing. Every other capability is added one at a time as an **accio tool**: one definition served to both harnesses over MCP (ADR 0011), with its own UI and status in accio. Settings → Harnesses still lets you switch a built-in back on.

## Method

Measured on 2026-11-04 against the versions in `pnpm-lock.yaml`, without any account:

- **Claude Code 2.1.317** (Agent SDK 0.3.317). Started with accio's options (`bypassPermissions`, `settingSources: ['user', 'project', 'local']`), a throwaway `CLAUDE_CONFIG_DIR` and `ANTHROPIC_BASE_URL` pointed at a local stub that recorded the request's `tools` and answered 400. The `system/init` message lists the same names.
- **Codex 0.166.0**. `codex exec` with accio's provider settings pointed at a local Responses stub, once with defaults and once per switch below.

## Claude Code: 26 tools, about 82 KB of definitions

| Tool | Size | Default | Notes |
| --- | ---: | --- | --- |
| Bash | 3.7 KB | Required | The shell. |
| Read, Edit, Write | 3.5 KB | Required | Read also shows images to the model. |
| Glob, Grep | 4.0 KB | Off | The shell finds files and text too. |
| PowerShell | 9.6 KB | Off | A second shell on Windows. |
| Skill | 1.8 KB | Off | accio lists each skill's SKILL.md path for every harness to read (ADR 0012). |
| Agent, ListAgents, SendMessage, TaskStop | 12.9 KB | Off | Sub-agents. A future accio tool, shown in accio. |
| WebFetch, WebSearch | 1.9 KB | Off | A future accio tool. |
| NotebookEdit | 1.6 KB | Off | Only matters for Jupyter projects. |
| Monitor | 7.6 KB | Off | Waits on a long command inside a turn. |
| CronCreate, CronDelete, CronList | 4.4 KB | Off | Session-scoped jobs that fire only while the Claude process stays open. accio closes it after each turn, so a job never runs. |
| ScheduleWakeup | 4.9 KB | Off | Paces `/loop`, which accio does not run. |
| EnterWorktree, ExitWorktree | 6.5 KB | Off | accio owns each thread's worktree and delivers from it (ADR 0015). |
| Workflow | 5.4 KB | Off | Background multi-agent scripts accio cannot show. |
| ReportFindings | 2.2 KB | Off | Renders review findings in Claude's own host UI. |
| PushNotification | 1.8 KB | Off | Terminal and Remote Control push. Neither exists in accio. |
| DesignSync | 10.4 KB | Off | Reads claude.ai design projects. |

On by default: 4 tools, about 7 KB, down from 82 KB. With Anthropic's own endpoint, Claude Code defers some tools behind ToolSearch, so the real saving is smaller.

**Switch:** `disallowedTools` on `query()`. The tool is removed from the model's context and from internal calls. The probe confirmed it disappears from `system/init`. Unknown names are ignored, so a list survives tools being renamed or removed.

## Codex: 10 tools, about 10 KB of definitions

| Tool | Size | Default | Switch | Notes |
| --- | ---: | --- | --- | --- |
| exec_command, write_stdin | 3.4 KB | Required | — | The shell. |
| apply_patch, view_image | 1.4 KB | Required | — | Editing, and images, which Claude's Read covers. |
| request_user_input | 1.4 KB | Required | — | Plan mode only; no switch removes it. |
| tool_search (sub-agents) | 0.8 KB | Off | `features.multi_agent=false` | accio drops Codex sub-agent items from the transcript. |
| web_search | 0.1 KB | Off | `web_search="disabled"` | A future accio tool. |
| get_goal, create_goal, update_goal | 3.2 KB | Off | `features.goals=false` | Until accio has a unified goal with its own status bar. |

`disabled_tools` at the top level does not remove built-in tools. It only works per MCP server (`mcp_servers.<id>.disabled_tools`).

## T3 Code

T3 Code (pingdotgg/t3code at `8b44f42b`) leaves both toolsets alone by default:

- **Claude:** passes `tools: { type: 'preset', preset: 'claude_code' }` and no `disallowedTools`. A read-only sandbox narrows this to Read, Glob and Grep. `canUseTool` routes AskUserQuestion and ExitPlanMode to its UI.
- **Codex:** turns `tools.update_plan.enabled` on and disables only its own `t3_thread_wait` MCP tool. Its managed ChatGPT runtime passes `features.multi_agent=false` and `features.multi_agent_v2=false`.
- **Settings:** none for tools; only a free-text launch-arguments field per provider.

## Design

- **Shared setting** (ADR 0004). The hub stores only what you changed from accio's default, per harness, so new defaults apply until you override them.
- **Per turn.** The machine reads the setting when a turn starts. Claude gets `disallowedTools`; Codex gets the config switches when app-server starts.
- **Required tools** (shell and file reading and editing) show as Required and cannot be switched off.
- **Unified accio tools.** A new capability is one accio tool for both harnesses, with its own UI or status. Its built-in counterparts stay off. T3 Code does this for `/goal`: one goal record and banner, fed by Codex's `thread/goal/*` API and by parsing Claude Code's own `/goal` replies.
- **Goal (first unified tool).** `/goal <objective>` stores the goal on the thread (`apps/server/src/goals/goal.ts`). Each turn's instructions carry it, and the `finish_goal` accio tool is listed only while it is active. accio starts the next turn itself after a completed one, pausing on stop, failure, a blocked report, or a turn that used no tools (the stall guard). There is no turn limit: Claude Code's own `/goal` has none either (a separate check model judges each turn from the transcript and pauses only on errors, timeouts, rate or usage limits), and Codex only stops at a token budget you set. The Goal bar above the composer shows it. Neither harness's own goal feature is used, so Codex goals stay off and `/goal` never reaches Claude Code as typed.
- **Catalogue in code** (`apps/server/src/harnesses/builtinTools.ts`). Re-run the probes above when the Agent SDK or Codex is upgraded.
