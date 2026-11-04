import type { BuiltinToolView } from '@accio/protocol';

/**
 * GLOSSARY: Built-in tools. One switch over one or more of a harness's own tools.
 * `config` is what Codex needs to remove them; Claude Code removes them by name.
 */
export type BuiltinTool = {
  id: string; name: string; description: string; tools: string[];
  default: 'required' | 'on' | 'off';
  config?: string[];
};

/** Overrides of the defaults, per harness and switch id, as the hub stores them. */
export type BuiltinToolOverrides = Record<string, Record<string, boolean>>;

/**
 * Measured against Claude Code 2.1.317 and Codex 0.166.0; see docs/plans/harness-tools.md.
 * Re-run those probes when either is upgraded.
 */
export const BUILTIN_TOOLS: Record<string, BuiltinTool[]> = {
  // Minimal by default, as pi.dev: a shell and file reading and editing. Anything more
  // arrives as an accio tool that works the same on every harness, with its own UI.
  claudeCode: [
    { id: 'shell', name: 'Shell', description: 'Runs commands.', tools: ['Bash'], default: 'required' },
    { id: 'files', name: 'Files', description: 'Reads, including images, and edits files.', tools: ['Read', 'Edit', 'Write'], default: 'required' },
    { id: 'search', name: 'Search', description: 'Finds files and text; the shell can too.', tools: ['Glob', 'Grep'], default: 'off' },
    { id: 'powershell', name: 'PowerShell', description: 'A second shell on Windows.', tools: ['PowerShell'], default: 'off' },
    { id: 'skills', name: 'Skill loader', description: 'accio lists skills for every harness to read.', tools: ['Skill'], default: 'off' },
    { id: 'agents', name: 'Sub-agents', description: 'Starts and messages helper agents.', tools: ['Agent', 'ListAgents', 'SendMessage', 'TaskStop'], default: 'off' },
    { id: 'web', name: 'Web', description: 'Searches and fetches web pages.', tools: ['WebSearch', 'WebFetch'], default: 'off' },
    { id: 'notebooks', name: 'Notebooks', description: 'Edits Jupyter notebook cells.', tools: ['NotebookEdit'], default: 'off' },
    { id: 'monitor', name: 'Monitor', description: 'Watches a long-running command.', tools: ['Monitor'], default: 'off' },
    { id: 'cron', name: 'Scheduled prompts', description: 'Never fire: accio closes Claude Code after each turn.', tools: ['CronCreate', 'CronDelete', 'CronList'], default: 'off' },
    { id: 'wakeup', name: 'Loop wake-ups', description: 'Paces /loop, which accio does not run.', tools: ['ScheduleWakeup'], default: 'off' },
    { id: 'worktrees', name: 'Worktree switching', description: 'Conflicts with the worktree accio delivers from.', tools: ['EnterWorktree', 'ExitWorktree'], default: 'off' },
    { id: 'workflow', name: 'Workflows', description: 'Background multi-agent scripts accio cannot show.', tools: ['Workflow'], default: 'off' },
    { id: 'findings', name: 'Review findings', description: 'Draws findings in a UI accio does not have.', tools: ['ReportFindings'], default: 'off' },
    { id: 'push', name: 'Push notifications', description: 'Terminal and phone alerts outside accio.', tools: ['PushNotification'], default: 'off' },
    { id: 'design', name: 'Design sync', description: 'Reads claude.ai design projects.', tools: ['DesignSync'], default: 'off' },
  ],
  codex: [
    { id: 'shell', name: 'Shell', description: 'Runs commands.', tools: ['exec_command', 'write_stdin'], default: 'required' },
    { id: 'files', name: 'Files', description: 'Views images and edits files.', tools: ['apply_patch', 'view_image'], default: 'required' },
    { id: 'input', name: 'Questions', description: 'Plan mode only; Codex has no switch for it.', tools: ['request_user_input'], default: 'required' },
    { id: 'agents', name: 'Sub-agents', description: 'Starts helper agents.', tools: ['tool_search'], default: 'off', config: ['features.multi_agent=false'] },
    { id: 'web', name: 'Web search', description: 'Searches the web.', tools: ['web_search'], default: 'off', config: ['web_search="disabled"'] },
    { id: 'goals', name: 'Goals', description: 'Token-budget goals accio has no UI for yet.', tools: ['get_goal', 'create_goal', 'update_goal'], default: 'off', config: ['features.goals=false'] },
  ],
};

const isOn = (tool: BuiltinTool, overrides: Record<string, boolean> = {}) =>
  tool.default === 'required' || (overrides[tool.id] ?? tool.default === 'on');

export function builtinToolViews(harnessId: string, overrides?: Record<string, boolean>): BuiltinToolView[] {
  return (BUILTIN_TOOLS[harnessId] ?? []).map((tool) => ({
    id: tool.id, name: tool.name, description: tool.description, tools: tool.tools,
    required: tool.default === 'required', defaultOn: tool.default !== 'off', on: isOn(tool, overrides),
  }));
}

/** The switches that are off for a turn on this harness. */
export function builtinToolsOff(harnessId: string, overrides?: Record<string, boolean>): BuiltinTool[] {
  return (BUILTIN_TOOLS[harnessId] ?? []).filter((tool) => !isOn(tool, overrides));
}

/** The overrides after one switch changes; a switch set back to its default is forgotten. */
export function setBuiltinTool(harnessId: string, overrides: Record<string, boolean>, toolId: string, on: boolean): Record<string, boolean> {
  const tool = (BUILTIN_TOOLS[harnessId] ?? []).find((t) => t.id === toolId);
  if (!tool) throw new Error(`No built-in tool ${toolId}`);
  if (tool.default === 'required') throw new Error(`${tool.name} is required`);
  const { [toolId]: _, ...rest } = overrides;
  return on === (tool.default === 'on') ? rest : { ...rest, [toolId]: on };
}
