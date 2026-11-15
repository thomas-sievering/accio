import { describe, expect, it } from 'vitest';
import type { IssueList, IssueView } from '@accio/protocol';
import { issueFilterGroups, issueGraph, issueLinks } from './issueGraph';

const issue = (label: string, blockedBy: string[] = [], more: Partial<IssueView> = {}): IssueView =>
  ({ ref: label, label, title: `Issue ${label}`, blockedBy, labels: [], assignees: [], ...more });
const github = (...issues: IssueView[]): IssueList => ({ tracker: { kind: 'github', repository: 'o/r' }, issues });
/** Each row as `label lane through/incoming/outgoing`, for a readable picture of the gutter. */
const picture = (list: IssueList, group?: string) => issueGraph(list, group).rows
  .map((r) => `${r.issue.label} @${r.lane} t[${r.through}] i[${r.incoming}] o[${r.outgoing}]`);

describe('issueGraph', () => {
  it('lays a chain on one lane, blockers first, whatever order the tracker lists it in', () => {
    const graph = issueGraph(github(issue('#3', ['#2']), issue('#2', ['#1']), issue('#1')));
    expect(graph.rows.map((r) => r.issue.label)).toEqual(['#1', '#2', '#3']);
    expect(picture(github(issue('#3', ['#2']), issue('#2', ['#1']), issue('#1')))).toEqual([
      '#1 @0 t[] i[] o[0]',
      '#2 @0 t[] i[0] o[0]',
      '#3 @0 t[] i[0] o[]',
    ]);
    expect(graph.lanes).toBe(1);
    expect(graph.rows.map((r) => r.state)).toEqual(['ready', 'blocked', 'blocked']);
  });

  it('forks a diamond into two lanes and joins them at the issue that waits on both', () => {
    const list = github(issue('#1'), issue('#2', ['#1']), issue('#3', ['#1']), issue('#4', ['#2', '#3']));
    expect(picture(list)).toEqual([
      '#1 @0 t[] i[] o[0,1]',
      '#2 @0 t[1] i[0] o[0]',
      // #3's line to #4 joins the one #2 already drew.
      '#3 @1 t[0] i[1] o[0]',
      '#4 @0 t[] i[0] o[]',
    ]);
    expect(issueGraph(list).lanes).toBe(2);
  });

  it('gives an independent issue a free lane with no lines, beside a chain still running', () => {
    const list = github(issue('#1'), issue('#5'), issue('#2', ['#1']), issue('#9'));
    expect(picture(list)).toEqual([
      '#1 @0 t[] i[] o[0]',
      '#2 @0 t[] i[0] o[]',
      '#5 @0 t[] i[] o[]',
      '#9 @0 t[] i[] o[]',
    ]);
    // An issue the chain's next issue also waits on sits on a free lane and joins the chain's line.
    const waiting = github(issue('#1'), issue('#2', ['#1', '#5']), issue('#5'));
    expect(picture(waiting)).toEqual([
      '#1 @0 t[] i[] o[0]',
      '#5 @1 t[0] i[] o[0]',
      '#2 @0 t[] i[0] o[]',
    ]);
  });

  it('narrows to one group and draws no line to blockers outside it, while the row still waits on them', () => {
    const list = github(
      issue('#1', [], { group: '#10 Relay' }),
      issue('#2', ['#1', '#7'], { group: '#10 Relay' }),
      issue('#7', [], { group: '#20 Picker' }),
    );
    expect(issueFilterGroups(list)).toEqual(['#10 Relay', '#20 Picker']);
    const rows = issueGraph(list, '#10 Relay').rows;
    expect(picture(list, '#10 Relay')).toEqual(['#1 @0 t[] i[] o[0]', '#2 @0 t[] i[0] o[]']);
    expect(rows[1]!.issue.blockedBy).toEqual(['#1', '#7']);
    expect(rows[1]!.state).toBe('blocked');
  });

  it('matches local blockers by number within their own feature folder', () => {
    const list: IssueList = { tracker: { kind: 'local', folder: '.scratch' }, issues: [
      issue('02', ['1'], { group: 'relay' }), issue('01', [], { group: 'relay' }), issue('01', [], { group: 'picker', ref: 'picker/01' }),
    ] };
    expect(issueGraph(list).rows.map((r) => `${r.issue.group}/${r.issue.label}@${r.lane}`)).toEqual(['relay/01@0', 'relay/02@0', 'picker/01@0']);
  });

  it('shows claimed issues and survives a cycle without drawing a line upward', () => {
    expect(issueGraph(github(issue('#1', [], { assignees: ['me'] }))).rows[0]!.state).toBe('claimed');
    const rows = issueGraph(github(issue('#1', ['#2']), issue('#2', ['#1']))).rows;
    expect(rows).toHaveLength(2);
    expect(rows.flatMap((r) => [...r.incoming, ...r.outgoing])).toEqual([0, 0]);
  });
});

describe('issueLinks', () => {
  it('lists what an issue waits on and what it blocks, across every group', () => {
    const list = github(
      issue('#1', [], { group: '#10 Relay' }),
      issue('#2', ['#1', '#7'], { group: '#10 Relay' }),
      issue('#3', ['#2'], { group: '#10 Relay' }),
      issue('#7', [], { group: '#20 Picker' }),
    );
    const labels = (links: ReturnType<typeof issueLinks>) => ({ blockedBy: links.blockedBy.map((i) => i.label), blocks: links.blocks.map((i) => i.label) });
    expect(labels(issueLinks(list, '#2'))).toEqual({ blockedBy: ['#1', '#7'], blocks: ['#3'] });
    expect(labels(issueLinks(list, '#7'))).toEqual({ blockedBy: [], blocks: ['#2'] });
    expect(labels(issueLinks(list, '#9'))).toEqual({ blockedBy: [], blocks: [] });
  });

  it('links local issues by number within their own feature folder', () => {
    const list: IssueList = { tracker: { kind: 'local', folder: '.scratch' }, issues: [
      issue('01', [], { group: 'relay', ref: 'relay/01' }), issue('02', ['1'], { group: 'relay', ref: 'relay/02' }), issue('01', [], { group: 'picker', ref: 'picker/01' }),
    ] };
    expect(issueLinks(list, 'relay/02').blockedBy.map((i) => i.ref)).toEqual(['relay/01']);
    expect(issueLinks(list, 'relay/01').blocks.map((i) => i.ref)).toEqual(['relay/02']);
    expect(issueLinks(list, 'picker/01').blocks).toEqual([]);
  });
});
