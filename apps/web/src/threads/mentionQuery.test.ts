import { describe, expect, it } from 'vitest';
import type { MachineView, ModelView, ThreadView, WorkspaceSkill } from '@accio/protocol';
import { mentionAt, mentionOptions, skillCommandAt, skillOptions } from './mentionQuery';

const model = (id: string, name: string, harnessId = 'claudeCode'): ModelView => ({
  id, name, harnessId, harnessName: '', providerId: harnessId === 'codex' ? 'openai' : 'anthropic', providerName: '', description: '', efforts: [],
});

describe('mentionAt', () => {
  it('finds the @ the caret is in, at the start or after a space', () => {
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionAt('use @So for it', 7)).toEqual({ start: 4, query: 'so' });
  });

  it('ignores an @ inside a word or behind a space', () => {
    expect(mentionAt('mail a@b', 8)).toBeUndefined();
    expect(mentionAt('use @sol now', 12)).toBeUndefined();
  });
});

describe('mentionOptions', () => {
  const state = {
    models: [model('opus', 'Claude Opus 5.5'), model('sonnet', 'Claude Sonnet 5.5'), model('sol', 'GPT-6.1-Sol', 'codex'), model('max', 'GPT-5.1-Codex-Max', 'codex')],
    favorites: [{ harnessId: 'codex', modelId: 'sol' }], usedUp: [],
  };

  it('lists favourites first', () => {
    expect(mentionOptions(state, '').map((o) => o.handle)).toEqual(['sol', 'opus', 'sonnet', 'codex-max']);
  });

  it('matches the start of the handle or of any word', () => {
    expect(mentionOptions(state, 's').map((o) => o.handle)).toEqual(['sol', 'sonnet']);
    expect(mentionOptions(state, 'max').map((o) => o.handle)).toEqual(['codex-max']);
    expect(mentionOptions(state, 'gpt').map((o) => o.handle)).toEqual(['sol', 'codex-max']);
  });
});

describe('machine mentions', () => {
  const machine = (id: string, name: string, connected = true): MachineView => ({
    id, name, connected, thisMachine: false, platform: 'win32', version: '', lastSeen: '', harnesses: [], profileFolders: {},
  });
  const state = { models: [model('opus', 'Claude Opus 5.5')], favorites: [], usedUp: [] };
  const machines = [machine('m1', 'Studio Laptop'), machine('m2', 'Desk', false), machine('m3', 'Opus')];

  it('offers a row per kind while only @ is typed', () => {
    expect(mentionOptions(state, '', machines).map((o) => o.handle)).toEqual(['kind:models', 'kind:machines']);
    expect(mentionOptions(state, '', machines, undefined, 'machines').map((o) => o.handle)).toEqual(['studio-laptop', 'desk']);
  });

  it('lists machines after the models, online before offline, never one a model handle hides', () => {
    expect(mentionOptions(state, 'o', machines).map((o) => o.handle)).toEqual(['opus']);
    expect(mentionOptions(state, 'lap', machines).map((o) => o.handle)).toEqual(['studio-laptop']);
    expect(mentionOptions(undefined, 'st', machines).map((o) => o.handle)).toEqual(['studio-laptop']);
    expect(mentionOptions(undefined, '', [machine('m2', 'Desk', false), machine('m1', 'Studio Laptop')], undefined, 'machines').map((o) => o.handle)).toEqual(['studio-laptop', 'desk']);
  });
});

describe('thread mentions', () => {
  const thread = (n: number, title: string): ThreadView => ({ id: `${n}${n}${n}${n}${n}${n}00-0000-4000-8000-000000000000`, title } as ThreadView);
  const shelves = {
    open: Array.from({ length: 7 }, (_, i) => thread(i, `Open thread ${i}`)),
    working: [thread(7, 'Fix the login redirect')],
    offline: [thread(6, 'Login on the laptop')],
    snoozed: [thread(8, 'Snoozed login cleanup')],
    settled: Array.from({ length: 5 }, (_, i) => thread(9, `Settled ${i}`)),
  };
  const state = { models: [model('opus', 'Claude Opus 5.5')], favorites: [], usedUp: [] };

  it('offers Threads beside Models and lists the recent ones of each group inside it', () => {
    expect(mentionOptions(state, '', [], shelves).map((o) => o.handle)).toEqual(['kind:models', 'kind:threads']);
    const listed = mentionOptions(state, '', [], shelves, 'threads');
    expect(listed.map((o) => 'group' in o && o.group)).toEqual([...Array(5).fill('open'), 'working', 'settled', 'settled', 'settled']);
  });

  it('searches every thread by title once you type, offline and snoozed ones too', () => {
    expect(mentionOptions(state, 'login', [], shelves).map((o) => 'thread' in o && o.thread.title)).toEqual(['Fix the login redirect', 'Login on the laptop', 'Snoozed login cleanup']);
    expect(mentionOptions(state, 'op', [], shelves).map((o) => o.handle).slice(0, 2)).toEqual(['opus', 'open-thread-0-000000']);
    expect(mentionOptions(state, 'op', [], shelves, 'threads').every((o) => 'thread' in o)).toBe(true);
  });
});

describe('skill commands', () => {
  const skill = (name: string, description = '', enabled = true): WorkspaceSkill => ({
    id: `repository:${name}`, name, description, path: `/r/${name}/SKILL.md`, origin: 'repository', enabled, enabledBy: 'project',
  });
  const skills = [skill('tdd', 'Test-driven development'), skill('grill-me', 'A relentless interview'), skill('diagnosing-bugs', 'Diagnosis loop'),
    skill('off', '', false), skill('tdd', 'A duplicate')];

  it('finds the / the caret is in, at the start or after a space, never in a path', () => {
    expect(skillCommandAt('/', 1)).toEqual({ start: 0, query: '' });
    expect(skillCommandAt('then /Gri', 9)).toEqual({ start: 5, query: 'gri' });
    expect(skillCommandAt('open src/app', 12)).toBeUndefined();
    expect(skillCommandAt('/tdd now', 8)).toBeUndefined();
  });

  it('lists the enabled skills once each, by name', () => {
    expect(skillOptions(skills, '').map((o) => o.handle)).toEqual(['diagnosing-bugs', 'grill-me', 'tdd']);
  });

  it('matches the name first, then any word of it, then the description', () => {
    expect(skillOptions(skills, 'd').map((o) => o.handle)).toEqual(['diagnosing-bugs', 'tdd']);
    expect(skillOptions(skills, 'bugs').map((o) => o.handle)).toEqual(['diagnosing-bugs']);
    expect(skillOptions(skills, 'interview').map((o) => o.handle)).toEqual(['grill-me']);
    expect(skillOptions(skills, 'off')).toEqual([]);
  });
});
