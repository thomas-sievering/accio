import { describe, expect, it } from 'vitest';
import type { IssueView } from '@accio/protocol';
import { issueGroups } from './issueGroups';

const issue = (label: string, title: string, more: Partial<IssueView> = {}): IssueView => ({ ref: label, label, title, blockedBy: [], labels: [], assignees: [], ...more });

describe('issue picker groups', () => {
  it('orders GitHub issues by triage role, blocked last, and drops empty groups', () => {
    const groups = issueGroups({ tracker: { kind: 'github', repository: 'me/app' }, issues: [
      issue('#1', 'Plain'), issue('#2', 'Ready', { status: 'ready-for-agent' }), issue('#3', 'Waiting', { status: 'ready-for-agent', blockedBy: ['#2'] }),
    ] });
    expect(groups.map((g) => [g.name, g.issues.map((i) => i.label)])).toEqual([['Ready for agent', ['#2']], ['Open', ['#1']], ['Blocked', ['#3']]]);
  });

  it('puts issues for humans in their own group and issues an open thread works on last', () => {
    const groups = issueGroups({ tracker: { kind: 'github', repository: 'me/app' }, issues: [
      issue('#1', 'Plain'), issue('#2', 'Ready', { status: 'ready-for-agent' }), issue('#3', 'Taken', { status: 'ready-for-agent' }),
      issue('#4', 'Decide', { status: 'ready-for-human' }), issue('#5', 'Waiting', { blockedBy: ['#3'] }),
    ] }, '', new Set(['#3']));
    expect(groups.map((g) => [g.name, g.issues.map((i) => i.label)])).toEqual([
      ['Ready for agent', ['#2']], ['Open', ['#1']], ['Ready for human', ['#4']], ['Blocked', ['#5']], ['In progress', ['#3']],
    ]);
    const local = issueGroups({ tracker: { kind: 'local', folder: '.scratch' }, issues: [issue('01', 'A', { group: 'relay' }), issue('02', 'B', { group: 'relay' })] }, '', new Set(['01']));
    expect(local.map((g) => [g.name, g.issues.map((i) => i.label)])).toEqual([['relay', ['02']], ['In progress', ['01']]]);
  });

  it('groups local issues by feature with blocked ones last, and filters by every word', () => {
    const list = { tracker: { kind: 'local' as const, folder: '.scratch' }, issues: [
      issue('01', 'Retry handshake', { group: 'relay', blockedBy: ['02'] }), issue('02', 'Chip state', { group: 'relay' }), issue('01', 'Detect tracker', { group: 'picker' }),
    ] };
    expect(issueGroups(list).map((g) => [g.name, g.issues.map((i) => i.title)])).toEqual([['relay', ['Chip state', 'Retry handshake']], ['picker', ['Detect tracker']]]);
    expect(issueGroups(list, 'RETRY hand').flatMap((g) => g.issues.map((i) => i.title))).toEqual(['Retry handshake']);
  });
});
