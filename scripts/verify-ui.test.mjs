import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, plan, runPlan } from './verify-ui.mjs';

test('requires an explicit browser scope and preserves grep as one argument', () => {
  assert.throws(() => parseArgs([]), /Select the browser files/);
  assert.throws(() => parseArgs(['--project=unknown', 'delivery.spec.ts']), /Choose project/);
  assert.throws(() => parseArgs(['../delivery.spec.ts']), /Unknown argument/);
  const options = parseArgs(['tests/delivery.spec.ts', '--skip-build', '--grep', 'CI wait|Ship menu']);
  const steps = plan(options, 'pnpm.cjs');
  assert.deepEqual(steps.map(step => step.name), ['typecheck', 'web-unit', 'browser']);
  assert.deepEqual(steps[2].args.slice(-2), ['--grep', 'CI wait|Ship menu']);
  assert.equal(steps[2].args.includes('tests/delivery.spec.ts'), true);
  assert.equal(steps[2].args.includes('--retries=0'), true);
  const native = plan(options, 'C:/pnpm-native.exe', 'evidence');
  assert.equal(native[0].command, 'C:/pnpm-native.exe');
  assert.deepEqual(native[0].args, ['typecheck']);
  assert.equal(native[2].args.includes(`--output=${join(process.cwd(), 'evidence', 'browser')}`), true);
});

test('preserves stdout, stderr and failure code, and stops before later stages', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'verify-ui-'));
  try {
    const code = await runPlan([
      { name: 'failure', command: process.execPath, args: ['-e', 'console.log("stdout evidence"); console.error("stderr evidence"); process.exit(7)'] },
      { name: 'must-not-run', command: process.execPath, args: ['-e', 'process.exit(0)'] },
    ], { directory, print() {} });
    assert.equal(code, 7);
    const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.steps.length, 1);
    assert.equal(report.steps[0].exitCode, 7);
    const log = await readFile(report.steps[0].logPath, 'utf8');
    assert.match(log, /stdout evidence/);
    assert.match(log, /stderr evidence/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('reports a launch error as failure rather than a passing check', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'verify-ui-'));
  try {
    const code = await runPlan([{ name: 'missing', command: join(directory, 'missing-program'), args: [] }], { directory, print() {} });
    assert.equal(code, 1);
    assert.match(await readFile(join(directory, 'missing.log'), 'utf8'), /ENOENT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('completes all successful stages and records the selected scope', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'verify-ui-'));
  try {
    const step = { command: process.execPath, args: ['-e', 'console.log("passed")'] };
    assert.equal(await runPlan([{ ...step, name: 'one' }, { ...step, name: 'two' }], { directory, report: { selection: 'delivery' }, print() {} }), 0);
    const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
    assert.equal(report.status, 'passed');
    assert.equal(report.selection, 'delivery');
    assert.equal(report.steps.length, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
