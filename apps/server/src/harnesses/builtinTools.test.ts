import { expect, it } from 'vitest';
import { BUILTIN_TOOLS, builtinToolsOff, builtinToolViews, setBuiltinTool } from './builtinTools.js';

it('leaves only a shell and file tools on by default, the same on both harnesses', () => {
  const on = (harnessId: string) => builtinToolViews(harnessId).filter((t) => t.on).flatMap((t) => t.tools);
  expect(on('claudeCode')).toEqual(['Bash', 'Read', 'Edit', 'Write']);
  expect(on('codex')).toEqual(['exec_command', 'write_stdin', 'apply_patch', 'view_image', 'request_user_input']);
  expect(builtinToolsOff('codex').flatMap((t) => t.config)).toEqual(['features.multi_agent=false', 'web_search="disabled"', 'features.goals=false']);
  expect(builtinToolsOff('unknown')).toEqual([]);
});

it('stores only switches that differ from the default', () => {
  const overrides = setBuiltinTool('claudeCode', {}, 'web', true);
  expect(overrides).toEqual({ web: true });
  expect(builtinToolsOff('claudeCode', overrides).map((t) => t.id)).not.toContain('web');
  expect(setBuiltinTool('claudeCode', overrides, 'web', false)).toEqual({});
});

it('refuses switching off required or unknown tools, whatever is stored', () => {
  expect(() => setBuiltinTool('claudeCode', {}, 'shell', false)).toThrow('Shell is required');
  expect(() => setBuiltinTool('codex', {}, 'nope', false)).toThrow('No built-in tool nope');
  expect(builtinToolViews('codex', { shell: false }).find((t) => t.id === 'shell')).toMatchObject({ required: true, on: true });
});

it('names every Codex switch that can be turned off', () => {
  for (const tool of BUILTIN_TOOLS.codex!) expect(tool.default === 'required' || !!tool.config?.length).toBe(true);
});
