import { expect, it } from 'vitest';
import { PLACEHOLDERS, systemPromptText, systemPromptView } from './systemPrompt.js';

const HARNESSES = [{ id: 'claudeCode', name: 'Claude Code' }, { id: 'codex', name: 'Codex' }];

it('lists each section once, grouped by the harnesses that get the same text', () => {
  const view = systemPromptView(HARNESSES, 'linux');
  expect(view.sections.map((s) => s.id)).toEqual(['accio', 'runtime', 'media', 'files']);
  // Placeholders stand in for the harness and model, so every section is shared.
  for (const s of view.sections) expect(s.variants.map((v) => v.harnessIds)).toEqual([['claudeCode', 'codex']]);
});

it('says how each harness receives it', () => {
  const [claude, codex] = systemPromptView(HARNESSES).harnesses;
  expect(claude).toMatchObject({ id: 'claudeCode', name: 'Claude Code', delivery: expect.stringMatching(/Appended/) });
  expect(codex).toMatchObject({ id: 'codex', name: 'Codex', delivery: expect.stringMatching(/developer instructions/) });
});

it('shows the text each harness receives once its placeholders are filled in', () => {
  const view = systemPromptView(HARNESSES, 'win32');
  expect(view.sections.find((s) => s.id === 'runtime')!.variants[0]!.text).toContain(`through the ${PLACEHOLDERS.harness} harness, as ${PLACEHOLDERS.model}.`);
  for (const { id, name } of HARNESSES) {
    const shown = view.sections.map((s) => `# ${s.title}\n\n${s.variants.find((v) => v.harnessIds.includes(id))!.text}`).join('\n\n');
    expect(shown.replaceAll(PLACEHOLDERS.harness, name).replaceAll(PLACEHOLDERS.model, 'opus')).toBe(systemPromptText({ harnessId: id, model: 'opus', platform: 'win32' }));
  }
});

it('names the harness and the model it runs as', () => {
  expect(systemPromptText({ harnessId: 'claudeCode', model: 'opus', modelName: 'Claude Opus' }))
    .toContain("In case you're asked: you are running in Accio through the Claude Code harness, as Claude Opus (model id: opus). No need to mention this otherwise.");
  expect(systemPromptText({ harnessId: 'codex', model: 'gpt-5.5', modelName: 'gpt-5.5' })).toContain('through the Codex harness, as gpt-5.5.');
  expect(systemPromptText({ harnessId: 'codex' })).toContain('through the Codex harness. No need');
});

it('uses example paths for the machine it runs on', () => {
  expect(systemPromptText({ harnessId: 'claudeCode', platform: 'win32' })).toContain('![Chart](C:/work/chart.png)');
  expect(systemPromptText({ harnessId: 'claudeCode', platform: 'darwin' })).toContain('![Chart](/home/me/work/chart.png)');
});

it('joins sections under their titles', () => {
  expect(systemPromptText({ harnessId: 'codex', platform: 'linux' })).toMatch(/^# Accio\n\n[\s\S]*\n\n# Runtime\n\n[\s\S]*\n\n# Inline media\n\n[\s\S]*\n\n# File links\n\n/);
});
