import { describe, expect, it } from 'vitest';
import { globRegExp, type TriggerEvent, workflowMayRun } from './workflowTriggers.js';

const pushMain: TriggerEvent[] = [{ name: 'push', branch: 'main' }];
const prToMain: TriggerEvent[] = [{ name: 'push', branch: 'accio/t1' }, { name: 'pull_request', base: 'main' }];
const hub = `
name: Hub image
on:
  push:
    branches: [main]
    paths: [apps/**, packages/**, package.json, .github/workflows/hub.yml]
  pull_request:
    paths: [apps/**, packages/**]
  workflow_dispatch:
`;

describe('workflowMayRun', () => {
  it('excludes a docs-only change from a path-filtered workflow', () => {
    expect(workflowMayRun(hub, pushMain, ['GLOSSARY.md', 'docs/adr/0018-accounts.md'])).toBe(false);
    expect(workflowMayRun(hub, prToMain, ['GLOSSARY.md'])).toBe(false);
  });

  it('runs when any changed file matches a path filter', () => {
    expect(workflowMayRun(hub, pushMain, ['GLOSSARY.md', 'apps/web/src/a.ts'])).toBe(true);
    expect(workflowMayRun(hub, pushMain, ['package.json'])).toBe(true);
    expect(workflowMayRun(hub, prToMain, ['packages/protocol/x.ts'])).toBe(true);
  });

  it('follows branch filters, ignores and tag-only pushes', () => {
    expect(workflowMayRun('on:\n  push:\n    branches: [release/*]\n', pushMain, ['a'])).toBe(false);
    expect(workflowMayRun('on:\n  push:\n    branches: [release/*, main]\n', pushMain, ['a'])).toBe(true);
    expect(workflowMayRun('on:\n  push:\n    branches-ignore: [main]\n', pushMain, ['a'])).toBe(false);
    expect(workflowMayRun('on:\n  push:\n    tags: [v*]\n', pushMain, ['a'])).toBe(false);
    expect(workflowMayRun('on:\n  pull_request:\n    branches: [develop]\n', prToMain, ['a'])).toBe(false);
  });

  it('applies ordered negation and paths-ignore', () => {
    const negated = 'on:\n  push:\n    paths: ["docs/**", "!docs/drafts/**"]\n';
    expect(workflowMayRun(negated, pushMain, ['docs/drafts/a.md'])).toBe(false);
    expect(workflowMayRun(negated, pushMain, ['docs/a.md'])).toBe(true);
    const ignore = 'on:\n  push:\n    paths-ignore: ["**.md", "docs/**"]\n';
    expect(workflowMayRun(ignore, pushMain, ['README.md', 'docs/x.png'])).toBe(false);
    expect(workflowMayRun(ignore, pushMain, ['README.md', 'src/a.ts'])).toBe(true);
  });

  it('runs for unfiltered triggers in every `on` form', () => {
    expect(workflowMayRun('on: push\n', pushMain, ['a'])).toBe(true);
    expect(workflowMayRun('on: [pull_request, push]\n', pushMain, ['a'])).toBe(true);
    expect(workflowMayRun('on:\n  push:\n', pushMain, ['a'])).toBe(true);
    // Only pull requests: a direct push cannot trigger it.
    expect(workflowMayRun('on: pull_request\n', pushMain, ['a'])).toBe(false);
    expect(workflowMayRun('on: [workflow_dispatch, schedule]\n', pushMain, ['a'])).toBe(false);
  });

  it('leans towards running when anything is unclear', () => {
    expect(workflowMayRun('on: merge_group\n', pushMain, ['a'])).toBe(true);
    expect(workflowMayRun('on: [push\n', pushMain, ['a'])).toBe(true);
    expect(workflowMayRun('jobs: {}\n', pushMain, ['a'])).toBe(true);
    expect(workflowMayRun('on:\n  push:\n    paths: { a: 1 }\n', pushMain, ['a'])).toBe(true);
    expect(workflowMayRun('on:\n  push:\n    paths: ["[abc"]\n', pushMain, ['a'])).toBe(true);
    expect(workflowMayRun('on:\n  push:\n    paths: [apps/**]\n', pushMain, [])).toBe(true);
    expect(workflowMayRun('on:\n  push:\n    paths: [apps/**]\n', pushMain, Array.from({ length: 301 }, (_, i) => `docs/${i}.md`))).toBe(true);
  });

  it('matches a pattern naming a parent directory as an include, never as an ignore', () => {
    expect(workflowMayRun('on:\n  push:\n    paths: [apps]\n', pushMain, ['apps/web/a.ts'])).toBe(true);
    expect(workflowMayRun('on:\n  push:\n    paths-ignore: [docs]\n', pushMain, ['docs/a.md'])).toBe(true);
  });
});

describe('globRegExp', () => {
  it('keeps * within a segment and lets ** cross them', () => {
    expect(globRegExp('docs/*').test('docs/a.md')).toBe(true);
    expect(globRegExp('docs/*').test('docs/a/b.md')).toBe(false);
    expect(globRegExp('docs/**').test('docs/a/b.md')).toBe(true);
    expect(globRegExp('**/README.md').test('README.md')).toBe(true);
    expect(globRegExp('**/README.md').test('a/b/README.md')).toBe(true);
    expect(globRegExp('*.md').test('a.mdx')).toBe(false);
    expect(globRegExp('playwright*.config.ts').test('playwright.verify.config.ts')).toBe(true);
    expect(globRegExp('playwright*.config.ts').test('playwrightXconfigXts')).toBe(false);
  });
});
