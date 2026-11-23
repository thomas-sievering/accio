import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { deliveryInProgress, deliveryPhase, deliveryWaitsOn, findMentionedThread, threadHandle, type ThreadView, type ThreadWait, type WaitCondition, type WaitPullRequestState, type WaitThreadState } from '@accio/protocol';
import { UserError } from '../rpc/router.js';
import { now } from '../time.js';
import { accioTool } from '../tools/tools.js';
import type { GhCheck, GhPullRequest } from './ghReplies.js';
import type { ThreadState } from './state.js';
import type { Thread } from './thread.js';

/**
 * GLOSSARY: Wait. The same on every harness: the harness calls wait_for and ends its
 * turn; this machine watches the conditions itself (other threads through relay
 * snapshots, pull requests through gh, timers, and commands it runs) and starts the
 * next turn with what happened. No harness's own background or scheduling feature is used.
 */
const WAIT_FOR_TOOL = 'wait_for';

/** How often a pull request is read while a Wait needs it; failures back off to 15 minutes, as delivery's do. */
const PULL_REQUEST_POLL_MS = 30_000;
/** A pull request with no checks after this long counts as having none. */
const NO_CHECKS_AFTER_MS = 15 * 60_000;
const OUTPUT_TAIL = 2_000;
const MAX_TIMER = 2 ** 31 - 1;

export type WaitHost = {
  /** Every thread this machine knows, other machines' included. */
  threads: () => readonly ThreadView[];
  /** Starts the thread's next turn with `text`, or queues it behind the current one. */
  wake: (threadId: string, text: string) => Promise<void>;
  /** Reads a pull request as the thread's profile, from its working folder. */
  pullRequest: (thread: Thread, ref: string) => Promise<GhPullRequest>;
  /** Where and how a command condition runs. */
  command: (thread: Thread) => Promise<{ cwd: string; env: Record<string, string> }>;
};

const waitForInput = {
  started_threads: z.boolean().optional().describe('Wait for every thread you started with start_thread that has not yet reached thread_state.'),
  threads: z.array(z.string().trim().min(1).max(200)).max(20).optional().describe("Threads to wait for, by handle (such as '@fix-login-redirect-3f2a9c') or id."),
  thread_state: z.enum(['stopped', 'pr_open', 'delivered']).optional().describe('What those threads must reach: "stopped" (no turn left to run; the default), "pr_open" (a pull request is open) or "delivered" (delivered, or its delivery stopped on a person: blocked, a PR waiting for review or merge by hand, or closed). A thread that fails or is interrupted also counts.'),
  pull_requests: z.array(z.string().trim().min(1).max(300)).max(20).optional().describe('Pull requests to wait for: GitHub URLs, or numbers in this repository.'),
  pull_request_state: z.enum(['merged', 'checks_done']).optional().describe('What those pull requests must reach: "checks_done" (every check finished; the default) or "merged" (merged, or closed without merging).'),
  after_minutes: z.number().min(1).max(7 * 24 * 60).optional().describe('Wake after this many minutes. With wake_when "any", this is also a timeout for the rest.'),
  command: z.string().trim().min(1).max(4000).optional().describe("A shell command accio runs in this thread's working folder now; the Wait is met when it exits. Use it instead of a background command, which stops when your turn ends."),
  command_timeout_minutes: z.number().min(1).max(24 * 60).optional().describe('Stop the command after this many minutes (default 60).'),
  wake_when: z.enum(['any', 'all']).optional().describe('Wake when "any" condition is met (the default) or once "all" are.'),
  note: z.string().trim().min(1).max(2000).describe('What to do when you wake, for your next turn.'),
};
export type WaitRequest = z.infer<z.ZodObject<typeof waitForInput>>;

/** The accio tool, bound to this machine's Waits. */
export function waitForTool(set: (threadId: string, request: WaitRequest) => Promise<string>) {
  return accioTool({
    name: WAIT_FOR_TOOL,
    description: 'Wait between turns, without staying in this one, for threads you started, pull requests, a time or a command. '
      + 'accio keeps the Wait and starts your next turn when it is met, telling you what happened. End your turn right after calling it. '
      + 'Use it instead of sleeping, polling or background commands for anything that outlasts this turn: those stop when your turn ends. '
      + 'Calling it again replaces the current Wait. The user can talk to you meanwhile, and can cancel it.',
    input: waitForInput,
    call: (request, { threadId }) => set(threadId, request),
  });
}

/** How a started thread stands against `until`; undefined while it has not got there. */
export function threadReached(view: ThreadView | undefined, until: WaitThreadState): string | undefined {
  // Unknown for now, such as before its machine's snapshot arrives: keep waiting.
  if (!view) return undefined;
  const delivery = view.delivery;
  const pr = delivery?.pullRequest;
  const prNote = pr ? `, PR ${pr.url} ${pr.state}` : '';
  const busy = view.status === 'running' || !!view.queuedMessages?.length || view.goal?.status === 'active'
    // A delivery queued behind a failed or interrupted turn is paused: it runs only once someone resumes the thread.
    || (delivery?.status === 'queued' && view.status !== 'failed' && view.status !== 'interrupted') || delivery?.status === 'running' || !!view.wait;
  // A thread that needs attention wakes every Wait on it, whatever it was waiting for.
  if (!busy && view.status === 'failed') return `failed${prNote}`;
  if (!busy && view.status === 'interrupted') return `was interrupted${prNote}`;
  if (delivery?.status === 'blocked' && !busy) return `delivery is blocked: ${delivery.detail ?? 'see the thread'}${prNote}`;
  if (until === 'pr_open') return pr ? `opened PR ${pr.url} (${pr.state})` : undefined;
  if (until === 'delivered') {
    if (delivery?.status === 'delivered') return `delivered to ${delivery.baseBranch}${prNote}`;
    // A delivery that stopped on a person won't get delivered by itself: a PR prepared for review or
    // waiting on review, or one closed without merging. A failed observation is retried, so it waits.
    const phase = deliveryPhase(view);
    if (busy || !delivery || !phase || phase === 'unavailable' || deliveryInProgress(view)) return undefined;
    if (phase === 'closed') return `PR ${pr!.url} was closed without merging`;
    if (phase === 'superseded') return `has new work since its delivery; deliver it again${prNote}`;
    if (phase === 'waiting') return delivery.mode === 'review' && deliveryWaitsOn(delivery) === 'merge'
      ? `prepared for review${prNote}, ready to merge by hand` : `delivery waits on ${deliveryWaitsOn(delivery)}${prNote}`;
    return undefined;
  }
  if (busy) return undefined;
  return `stopped and is idle${prNote}${delivery ? `, delivery ${delivery.status}` : ''}`;
}

function checkDone(check: GhCheck): boolean {
  if (check.status) return check.status.toUpperCase() === 'COMPLETED';
  return !!check.state && !['PENDING', 'EXPECTED'].includes(check.state.toUpperCase());
}

function checkFailed(check: GhCheck): boolean {
  return ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(String(check.conclusion ?? check.state ?? '').toUpperCase());
}

/** How a pull request stands against `until`; undefined while it has not got there. */
export function pullRequestReached(pr: GhPullRequest, until: WaitPullRequestState, waitedMs: number): string | undefined {
  const state = pr.state.toUpperCase();
  const closed = state === 'MERGED' ? 'was merged' : state === 'CLOSED' ? 'was closed without merging' : undefined;
  if (until === 'merged') return closed;
  const checks = pr.statusCheckRollup ?? [];
  if (checks.length && checks.every(checkDone)) {
    const failed = checks.filter(checkFailed).map(c => c.name ?? c.context ?? 'CI check');
    return failed.length ? `checks finished, ${failed.length} failed: ${failed.join(', ')}` : `checks finished, all ${checks.length} passed`;
  }
  if (closed) return closed;
  if (!checks.length && waitedMs >= NO_CHECKS_AFTER_MS) return `has no checks after ${NO_CHECKS_AFTER_MS / 60_000} minutes`;
  return undefined;
}

/** What a condition waits for, in the words the harness and the Wait bar use. */
function describeCondition(c: WaitCondition): string {
  switch (c.kind) {
    case 'thread': return `thread "${c.title}" (@${threadHandle({ id: c.threadId, title: c.title })}) ${c.until === 'stopped' ? 'to stop' : c.until === 'pr_open' ? 'to open a PR' : 'to be delivered'}`;
    case 'pullRequest': return `PR ${c.ref} ${c.until === 'merged' ? 'to merge' : 'to finish its checks'}`;
    case 'after': return `until ${c.at}`;
    case 'command': return `command \`${c.command}\` to exit`;
  }
}

function waitSatisfied(wait: ThreadWait): boolean {
  return wait.wakeWhen === 'all' ? wait.conditions.every(c => c.metAt) : wait.conditions.some(c => c.metAt);
}

/** The message that starts the turn once a Wait is met. */
export function wakeMessage(wait: ThreadWait): string {
  const met = wait.conditions.filter(c => c.metAt);
  // With "any", a time not reached yet was only the timeout for the rest.
  const unmet = wait.conditions.filter(c => !c.metAt && !(wait.wakeWhen === 'any' && c.kind === 'after'));
  return [
    'Your Wait is met, so accio started this turn.',
    ...met.map(c => `- Waited for ${describeCondition(c)}: ${c.detail ?? 'met'}`),
    ...(unmet.length ? ['Not met yet:', ...unmet.map(c => `- ${describeCondition(c)}`)] : []),
    `Your note: ${wait.note}`,
    'Call wait_for again to keep waiting.',
  ].join('\n');
}

/** What the harness reads each turn while its thread waits, such as when the user talks to it meanwhile. */
export function waitInstructions(wait: ThreadWait | undefined): string | undefined {
  if (!wait) return undefined;
  return [
    `This thread has a Wait: accio starts its next turn when ${wait.wakeWhen === 'all' ? 'all' : 'any'} of these is met.`,
    ...wait.conditions.map(c => `- ${describeCondition(c)}${c.metAt ? ` (met: ${c.detail ?? 'yes'})` : ''}`),
    `Note for that turn: ${wait.note}`,
    `It stays set. Call ${WAIT_FOR_TOOL} again to replace it.`,
  ].join('\n');
}

const PR_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/[1-9]\d*\/?$/i;

/** GLOSSARY: Wait. Watches the Waits of this machine's threads and wakes each thread once its Wait is met. */
export class Waits {
  private clocks = new Map<string, ReturnType<typeof setTimeout>>();
  private polls = new Map<string, ReturnType<typeof setTimeout>>();
  private failures = new Map<string, number>();
  /** Running command conditions, per thread, keyed by `${waitId}:${index}`. */
  private commands = new Map<string, Map<string, ChildProcess>>();
  private firing = new Set<string>();
  private evaluation?: ReturnType<typeof setTimeout>;
  private ready = false;
  private closing = false;

  constructor(private state: ThreadState, private host: WaitHost) {}

  /** wait_for: records the Wait, or says it is already met. */
  async set(threadId: string, request: WaitRequest): Promise<string> {
    const thread = this.state.require(threadId);
    const conditions = this.conditions(thread, request);
    const wait: ThreadWait = { id: randomUUID(), setAt: now(), wakeWhen: request.wake_when ?? 'any', note: request.note, conditions };
    const known = this.host.threads();
    for (const c of conditions) {
      if (c.kind !== 'thread') continue;
      const detail = threadReached(known.find(t => t.id === c.threadId), c.until);
      if (detail) Object.assign(c, { metAt: wait.setAt, detail });
    }
    this.stop(threadId);
    if (waitSatisfied(wait)) {
      if (thread.wait) await this.state.update(threadId, ({ wait: _, ...t }) => t);
      const met = conditions.filter(c => c.metAt).map(c => `- ${describeCondition(c)}: ${c.detail}`);
      return ['Already met, so no Wait was set:', ...met, 'Continue with your note now.'].join('\n');
    }
    await this.state.update(threadId, t => ({ ...t, wait }));
    await this.arm(threadId);
    return [
      `Waiting for ${wait.wakeWhen === 'all' ? 'all' : 'any'} of:`,
      ...conditions.map(c => `- ${describeCondition(c)}${c.metAt ? ` (already met: ${c.detail})` : ''}`),
      'End your turn now. accio starts your next turn when the Wait is met and tells you what happened. The user sees the Wait above the composer and can cancel it.',
    ].join('\n');
  }

  private conditions(thread: Thread, request: WaitRequest): WaitCondition[] {
    const conditions: WaitCondition[] = [];
    const until = request.thread_state ?? 'stopped';
    const known = this.host.threads();
    const ids = new Set<string>();
    const addThread = (view: ThreadView) => {
      if (view.id === thread.id) throw new UserError('A thread cannot wait for itself.');
      if (ids.has(view.id)) return;
      ids.add(view.id);
      conditions.push({ kind: 'thread', threadId: view.id, title: view.title || 'Untitled', until });
    };
    if (request.started_threads) {
      const started = known.filter(t => t.startedBy?.threadId === thread.id && !threadReached(t, until));
      if (!started.length && !request.threads?.length && !request.pull_requests?.length && !request.after_minutes && !request.command)
        throw new UserError(`None of the threads this thread started is still short of "${until}". Nothing to wait for.`);
      started.forEach(addThread);
    }
    const readable = known.filter(t => t.profileId === thread.profileId);
    for (const handle of request.threads ?? []) {
      const view = findMentionedThread(readable, handle);
      if (!view) throw new UserError(`No thread ${handle} in this profile. Use its handle, such as @fix-login-redirect-3f2a9c, or its id.`);
      addThread(view);
    }
    for (const raw of request.pull_requests ?? []) {
      const ref = raw.replace(/^#/, '');
      if (!/^[1-9]\d*$/.test(ref) && !PR_URL.test(ref)) throw new UserError(`${raw} is not a pull request. Give its GitHub URL or its number.`);
      if (/^\d+$/.test(ref) && !thread.checkoutId) throw new UserError(`This thread has no repository, so give PR ${raw} as its GitHub URL.`);
      conditions.push({ kind: 'pullRequest', ref, until: request.pull_request_state ?? 'checks_done' });
    }
    if (request.command) conditions.push({ kind: 'command', command: request.command, timeoutAt: new Date(Date.now() + (request.command_timeout_minutes ?? 60) * 60_000).toISOString() });
    // Last, since with "any" it reads as the timeout for the rest.
    if (request.after_minutes) conditions.push({ kind: 'after', at: new Date(Date.now() + request.after_minutes * 60_000).toISOString() });
    if (!conditions.length) throw new UserError('Give at least one thing to wait for: started_threads, threads, pull_requests, after_minutes or command.');
    return conditions;
  }

  /** Cancels the thread's Wait; no turn starts. */
  async cancel(threadId: string) {
    const thread = this.state.require(threadId);
    if (!thread.wait) throw new UserError('This thread is not waiting.');
    this.stop(threadId);
    await this.state.update(threadId, ({ wait: _, ...t }) => t);
  }

  /** Stops watching a thread that is going away. */
  forget(threadId: string) { this.stop(threadId); }

  /**
   * Once the thread can take turns: picks up stored Waits. A command that was running
   * when accio stopped did not survive it, so its condition is met with that news.
   */
  async resume() {
    if (this.ready || this.closing) return;
    this.ready = true;
    for (const thread of this.state.list) {
      const wait = thread.wait;
      if (!wait) continue;
      const lost = wait.conditions.flatMap((c, i) => c.kind === 'command' && !c.metAt ? [i] : []);
      for (const index of lost) await this.record(thread.id, wait.id, index, 'did not finish: accio stopped while it ran. Run it again if you still need it.');
      await this.arm(thread.id);
    }
    this.evaluateThreads();
  }

  /** Threads changed here or on another machine: check the Waits on them. */
  changed() {
    if (!this.ready || this.closing || this.evaluation) return;
    this.evaluation = setTimeout(() => { this.evaluation = undefined; this.evaluateThreads(); }, 100);
    this.evaluation.unref?.();
  }

  close() {
    this.closing = true;
    clearTimeout(this.evaluation);
    for (const id of new Set([...this.clocks.keys(), ...this.polls.keys(), ...this.commands.keys()])) this.stop(id);
  }

  private evaluateThreads() {
    const known = this.host.threads();
    for (const thread of this.state.list) {
      const wait = thread.wait;
      if (!wait) continue;
      wait.conditions.forEach((c, index) => {
        if (c.kind !== 'thread' || c.metAt) return;
        const detail = threadReached(known.find(t => t.id === c.threadId), c.until);
        if (detail) void this.record(thread.id, wait.id, index, detail).catch(error => console.error('[waits] recording failed', error));
      });
    }
  }

  /** Marks one condition met, then wakes the thread if that completes its Wait. */
  private async record(threadId: string, waitId: string, index: number, detail: string) {
    const current = this.state.get(threadId)?.wait;
    if (current?.id !== waitId || current.conditions[index]?.metAt) return;
    await this.state.update(threadId, t => t.wait?.id !== waitId || t.wait.conditions[index]?.metAt ? t
      : { ...t, wait: { ...t.wait, conditions: t.wait.conditions.map((c, i) => i === index ? { ...c, metAt: now(), detail } : c) } });
    await this.fireIfMet(threadId);
  }

  private async fireIfMet(threadId: string) {
    const wait = this.state.get(threadId)?.wait;
    if (!wait || !waitSatisfied(wait) || !this.ready || this.closing || this.firing.has(threadId)) return;
    this.firing.add(threadId);
    try {
      this.stop(threadId);
      await this.state.update(threadId, t => t.wait?.id === wait.id ? (({ wait: _, ...rest }) => rest)(t) : t);
      await this.host.wake(threadId, wakeMessage(wait));
    } finally { this.firing.delete(threadId); }
  }

  private async arm(threadId: string) {
    const wait = this.state.get(threadId)?.wait;
    if (!wait || this.closing) return;
    this.armClock(threadId, wait);
    if (wait.conditions.some(c => c.kind === 'pullRequest' && !c.metAt)) this.schedulePoll(threadId, 0);
    wait.conditions.forEach((c, index) => { if (c.kind === 'command' && !c.metAt) void this.run(threadId, wait.id, index, c); });
    await this.fireIfMet(threadId);
  }

  /** One timer per thread, for the nearest deadline: an `after` time or a command's timeout. */
  private armClock(threadId: string, wait: ThreadWait) {
    clearTimeout(this.clocks.get(threadId)); this.clocks.delete(threadId);
    const deadlines = wait.conditions.flatMap(c => c.metAt ? [] : c.kind === 'after' ? [Date.parse(c.at)] : c.kind === 'command' ? [Date.parse(c.timeoutAt)] : []);
    if (!deadlines.length) return;
    const delay = Math.min(MAX_TIMER, Math.max(0, Math.min(...deadlines) - Date.now()));
    const timer = setTimeout(() => { this.clocks.delete(threadId); void this.tick(threadId).catch(error => console.error('[waits] timer failed', error)); }, delay);
    timer.unref?.(); this.clocks.set(threadId, timer);
  }

  private async tick(threadId: string) {
    const wait = this.state.get(threadId)?.wait;
    if (!wait) return;
    const at = Date.now();
    for (const [index, c] of wait.conditions.entries()) {
      if (c.metAt) continue;
      if (c.kind === 'after' && Date.parse(c.at) <= at) await this.record(threadId, wait.id, index, 'the time came');
      if (c.kind === 'command' && Date.parse(c.timeoutAt) <= at) this.kill(threadId, `${wait.id}:${index}`, 'timeout');
    }
    const still = this.state.get(threadId)?.wait;
    if (still) this.armClock(threadId, still);
  }

  private schedulePoll(threadId: string, delay: number) {
    clearTimeout(this.polls.get(threadId));
    const timer = setTimeout(() => { this.polls.delete(threadId); void this.poll(threadId).catch(error => console.error('[waits] reading pull requests failed', error)); }, delay);
    timer.unref?.(); this.polls.set(threadId, timer);
  }

  private async poll(threadId: string) {
    const thread = this.state.get(threadId);
    const wait = thread?.wait;
    if (!thread || !wait || this.closing) return;
    let failed = false;
    for (const [index, c] of wait.conditions.entries()) {
      if (c.kind !== 'pullRequest' || c.metAt) continue;
      try {
        const pr = await this.host.pullRequest(thread, c.ref);
        const detail = pullRequestReached(pr, c.until, Date.now() - Date.parse(wait.setAt));
        if (detail) await this.record(threadId, wait.id, index, `${pr.url} ${detail}`);
      } catch (error) {
        failed = true;
        const message = `Could not read it yet: ${(error as Error).message}`;
        await this.state.update(threadId, t => t.wait?.id !== wait.id ? t
          : { ...t, wait: { ...t.wait, conditions: t.wait.conditions.map((x, i) => i === index && !x.metAt ? { ...x, detail: message } : x) } }, { quiet: true });
      }
    }
    const failures = failed ? (this.failures.get(threadId) ?? 0) + 1 : 0;
    this.failures.set(threadId, failures);
    const still = this.state.get(threadId)?.wait;
    if (still?.id === wait.id && still.conditions.some(c => c.kind === 'pullRequest' && !c.metAt))
      this.schedulePoll(threadId, failures ? Math.min(15 * 60_000, PULL_REQUEST_POLL_MS * 2 ** Math.min(failures, 5)) : PULL_REQUEST_POLL_MS);
  }

  /** Runs a command condition as a process accio owns (ADR 0015): its whole tree stops with the Wait. */
  private async run(threadId: string, waitId: string, index: number, c: Extract<WaitCondition, { kind: 'command' }>) {
    const thread = this.state.get(threadId);
    if (!thread) return;
    const key = `${waitId}:${index}`;
    let where: { cwd: string; env: Record<string, string> };
    try { where = await this.host.command(thread); }
    catch (error) { await this.record(threadId, waitId, index, `could not start: ${(error as Error).message}`); return; }
    if (this.state.get(threadId)?.wait?.id !== waitId || this.closing) return;
    const child = spawn(c.command, { cwd: where.cwd, env: where.env, shell: true, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const running = this.commands.get(threadId) ?? new Map<string, ChildProcess>();
    running.set(key, child); this.commands.set(threadId, running);
    let output = '';
    const collect = (data: Buffer) => { output = (output + data.toString()).slice(-OUTPUT_TAIL); };
    child.stdout?.on('data', collect); child.stderr?.on('data', collect);
    let started = true;
    child.once('error', (error) => { started = false; void this.finished(threadId, key, waitId, index, `could not start: ${error.message}`); });
    child.once('close', (code, signal) => {
      if (!started) return;
      const reason = (child as ChildProcess & { accioStop?: string }).accioStop;
      if (reason === 'stop') return;
      const tail = output.trim();
      const minutes = Math.round((Date.parse(c.timeoutAt) - Date.parse(this.state.get(threadId)?.wait?.setAt ?? c.timeoutAt)) / 60_000);
      const how = reason === 'timeout' ? `was stopped after ${minutes} minutes` : `exited with code ${code ?? signal}`;
      void this.finished(threadId, key, waitId, index, tail ? `${how}. Last output:\n${tail}` : how);
    });
  }

  private async finished(threadId: string, key: string, waitId: string, index: number, detail: string) {
    this.commands.get(threadId)?.delete(key);
    await this.record(threadId, waitId, index, detail).catch(error => console.error('[waits] recording failed', error));
  }

  private kill(threadId: string, key: string, reason: 'stop' | 'timeout') {
    const child = this.commands.get(threadId)?.get(key);
    if (!child?.pid || child.exitCode !== null) return;
    (child as ChildProcess & { accioStop?: string }).accioStop = reason;
    if (reason === 'stop') this.commands.get(threadId)?.delete(key);
    if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {});
    else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} }, 1000).unref();
    }
  }

  /** Stops every timer and command of the thread's Wait. */
  private stop(threadId: string) {
    clearTimeout(this.clocks.get(threadId)); this.clocks.delete(threadId);
    clearTimeout(this.polls.get(threadId)); this.polls.delete(threadId);
    this.failures.delete(threadId);
    for (const key of [...this.commands.get(threadId)?.keys() ?? []]) this.kill(threadId, key, 'stop');
    this.commands.delete(threadId);
  }
}
