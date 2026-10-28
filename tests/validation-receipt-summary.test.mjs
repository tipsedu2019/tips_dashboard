import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);
const digest = x => createHash('sha256').update(x).digest('hex');
const names = ['diff-check', 'query-exact-head', 'migration-exact-head', 'migration-layout',
  'domain-sqlstate', 'squawk', 'affected-consumers', 'notification-catalog-bodies', 'types', 'combined-js-lint', 'build'];
async function api() {
  const implementation = await import('../scripts/summarize-validation-receipt.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof implementation.summarizeValidationReceipt, 'function', 'read-only receipt summary is missing');
  return implementation;
}

async function fixture(t, legacy = false) {
  const dir = await mkdtemp(join(tmpdir(), 'receipt-summary-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'repo'), receipt = join(dir, 'receipt');
  await mkdir(root); await mkdir(receipt);
  const git = async (...args) => (await exec('git', args, { cwd: root })).stdout.trim();
  await git('init', '-q'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@invalid.test');
  await writeFile(join(root, 'source.mjs'), 'export const source = 1;\n');
  await git('add', '.'); await git('commit', '-qm', 'fixture');
  const head = await git('rev-parse', 'HEAD');
  const inputs = [{ path: 'source.mjs', sha256: digest(await readFile(join(root, 'source.mjs'))) }];
  const context = { root, base: head, head, nodePath: process.execPath, nodeVersion: process.version,
    squawkPath: '/existing/squawk', sourceFingerprint: digest(JSON.stringify(inputs)), startedAt: '2026-10-28T00:00:00.000Z' };
  const commands = names.map(name => ({ name, command: name === 'diff-check' ? 'git' : process.execPath,
    args: name === 'diff-check' ? ['diff', '--check', head, head] : ['fixed-test-option', name] }));
  const steps = commands.map((command, index) => ({ ...command, startedAt: `2026-10-28T00:00:${String(index).padStart(2, '0')}.000Z`,
    finishedAt: `2026-10-28T00:00:${String(index).padStart(2, '0')}.500Z`, exitCode: 0, signal: null,
    logSha256: digest(`synthetic log ${index}\n`) }));
  const invocation = legacy ? { root, base: head, head, commands: commands.map(x => [x.name, x.command, x.args]) } : { context, commands };
  const result = legacy ? steps : { context, steps, exitCode: 0, headStable: true, sourceBytesStable: true, finishedAt: '2026-10-28T00:01:00.000Z' };
  const completion = { root, base: head, head, finalHead: head, clean: true, sourceStable: true,
    inputManifestSha256: digest(JSON.stringify(inputs)), passed: true, finishedAt: '2026-10-28T00:01:00.000Z' };
  const save = async (name, value) => writeFile(join(receipt, name), JSON.stringify(value));
  await save('invocation.json', invocation); await save('inputs.json', inputs); await save('result.json', result);
  if (legacy) await save('completion.json', completion); else await save('steps.json', steps);
  for (let i = 0; i < steps.length; i++) await writeFile(join(receipt, names[i] + '.log'), `synthetic log ${i}\n`);
  const expectedPlan = join(dir, 'expected-plan.json');
  await writeFile(expectedPlan, JSON.stringify({ context, commands }));
  const options = { root, receipt, expectedPlan };
  return { root, receipt, dir, head, inputs, context, commands, steps, invocation, result, completion, save, git, options };
}

async function snapshot(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const records = [];
  for (const item of entries) {
    const path = join(dir, item.name);
    if (item.isDirectory()) records.push(...await snapshot(path));
    else if (item.isFile()) records.push([path, digest(await readFile(path))]);
  }
  return records;
}

for (const legacy of [false, true]) {
  test(`${legacy ? 'legacy' : 'new'} complete records compare without changing any input`, async t => {
    const { summarizeValidationReceipt } = await api(); const f = await fixture(t, legacy);
    const before = await snapshot(f.dir);
    const summary = await summarizeValidationReceipt(f.options);
    assert.equal(summary.outcome, 'matching_records');
    assert.equal(summary.execution.status, 'recorded_complete');
    assert.equal(summary.inputs.matched, 1);
    assert.equal(summary.logs.matched, 11);
    assert.equal(summary.head.status, 'match');
    assert.equal(summary.commandOptions.status, 'match');
    assert.equal(summary.decision, 'human_review_required');
    assert.equal(summary.provenance, 'not_authenticated');
    assert.deepEqual(await snapshot(f.dir), before);
  });
}

test('current changed bytes and a missing recorded file are separate counts', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t);
  await writeFile(join(f.root, 'source.mjs'), 'changed\n');
  let summary = await summarizeValidationReceipt(f.options);
  assert.equal(summary.outcome, 'mismatch'); assert.equal(summary.inputs.changed, 1);
  assert.equal(summary.execution.status, 'recorded_complete');
  await rm(join(f.root, 'source.mjs'));
  summary = await summarizeValidationReceipt(f.options);
  assert.equal(summary.inputs.missing, 1); assert.equal(summary.inputs.changed, 0);
});

test('HEAD changes with identical bytes preserve the input match information', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t);
  await f.git('commit', '--allow-empty', '-qm', 'metadata changed');
  const summary = await summarizeValidationReceipt(f.options);
  assert.equal(summary.head.status, 'mismatch'); assert.equal(summary.inputs.status, 'match');
  assert.equal(summary.execution.status, 'recorded_complete'); assert.equal(summary.outcome, 'mismatch');
});

test('changed current command options differ even if recorded steps are internally consistent', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t);
  f.commands[2].args.push('--unexpected-option');
  await writeFile(f.options.expectedPlan, JSON.stringify({ context: f.context, commands: f.commands }));
  const summary = await summarizeValidationReceipt(f.options);
  assert.equal(summary.commandOptions.status, 'mismatch'); assert.equal(summary.commandOptions.changed, 1);
  assert.equal(summary.execution.status, 'recorded_complete');
});

test('different scheduling keeps same command-option information and requires human review', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t);
  await writeFile(f.options.expectedPlan, JSON.stringify({ context: f.context, commands: [...f.commands].reverse() }));
  const summary = await summarizeValidationReceipt(f.options);
  assert.equal(summary.commandOptions.status, 'match'); assert.equal(summary.commandOrder, 'different');
  assert.equal(summary.decision, 'human_review_required');
});

test('failed steps, partial completion and not-run are not successful records', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t);
  const steps = f.steps.slice(0, 3); steps[2] = { ...steps[2], exitCode: 2 };
  await f.save('steps.json', steps); await f.save('result.json', { ...f.result, steps, exitCode: 2 });
  assert.equal((await summarizeValidationReceipt(f.options)).execution.status, 'failed');
  await f.save('steps.json', f.steps.slice(0, 2)); await rm(join(f.receipt, 'result.json'));
  assert.equal((await summarizeValidationReceipt(f.options)).outcome, 'incomplete');
  await f.save('steps.json', []);
  assert.equal((await summarizeValidationReceipt(f.options)).outcome, 'not_run');
});

test('missing input manifest is explicitly missing and cannot match', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t);
  await rm(join(f.receipt, 'inputs.json'));
  const summary = await summarizeValidationReceipt(f.options);
  assert.equal(summary.inputs.status, 'missing'); assert.equal(summary.outcome, 'missing');
});

test('legacy resume completion is required; interruption metadata alone is not completion', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t, true);
  await rm(join(f.receipt, 'completion.json')); await f.save('interruption.json', { completedCommands: 11 });
  assert.equal((await summarizeValidationReceipt(f.options)).execution.status, 'partial');
  await f.save('completion.json', { ...f.completion, passed: false });
  assert.equal((await summarizeValidationReceipt(f.options)).execution.status, 'failed');
});

test('altered logs, duplicate steps and a missing required command cannot match', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t);
  await writeFile(join(f.receipt, 'build.log'), 'different\n');
  assert.equal((await summarizeValidationReceipt(f.options)).logs.changed, 1);
  await f.save('steps.json', [...f.steps, f.steps[0]]); await f.save('result.json', { ...f.result, steps: [...f.steps, f.steps[0]] });
  assert.equal((await summarizeValidationReceipt(f.options)).outcome, 'invalid');
  await f.save('invocation.json', { ...f.invocation, commands: f.commands.slice(0, 10) });
  assert.equal((await summarizeValidationReceipt(f.options)).outcome, 'invalid');
});

test('untrusted paths and symlinks cannot cause reads outside the source or receipt', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t);
  await writeFile(join(f.dir, 'private.txt'), 'PRIVATE_SENTINEL_DO_NOT_PRINT');
  await f.save('inputs.json', [{ path: '../private.txt', sha256: 'a'.repeat(64) }]);
  let summary = await summarizeValidationReceipt(f.options);
  assert.equal(summary.inputs.blocked, 1); assert.equal(summary.outcome, 'invalid');
  await f.save('inputs.json', f.inputs); await rm(join(f.receipt, 'build.log'));
  await symlink(join(f.dir, 'private.txt'), join(f.receipt, 'build.log'));
  summary = await summarizeValidationReceipt(f.options);
  assert.equal(summary.logs.blocked, 1);
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE_SENTINEL|private\.txt/);
});

test('raw logs, arbitrary error text, arguments and identities are never echoed', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t);
  const secret = 'PRIVATE_STUDENT_AND_TOKEN_SENTINEL';
  await writeFile(join(f.receipt, 'build.log'), secret);
  f.result.failure = secret; f.result.unknown = { student: secret };
  await f.save('result.json', f.result);
  await writeFile(f.options.expectedPlan, JSON.stringify({ context: f.context, commands: f.commands.map(x => ({ ...x, args: [secret] })) }));
  const output = JSON.stringify(await summarizeValidationReceipt(f.options));
  assert.doesNotMatch(output, new RegExp(secret)); assert.doesNotMatch(output, /source\.mjs|build\.log/);
});

test('full database receipts stay unsupported and absence of a current plan stays unverified', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t);
  const summary = await summarizeValidationReceipt({ root: f.root, receipt: f.receipt });
  assert.equal(summary.commandOptions.status, 'not_checked'); assert.equal(summary.outcome, 'incomplete');
  await f.save('invocation.json', { root: f.root, argv: ['--execute', '--authorized'] });
  await f.save('result.json', { exit: 0, value: { status: 'passed' }, sourceStable: true });
  assert.equal((await summarizeValidationReceipt(f.options)).outcome, 'unsupported');
});

test('missing aggregate fingerprint remains incomplete even when individual files match', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t);
  delete f.context.sourceFingerprint;
  await f.save('invocation.json', f.invocation); await f.save('result.json', f.result);
  const summary = await summarizeValidationReceipt(f.options);
  assert.equal(summary.inputs.matched, 1); assert.equal(summary.inputs.manifest, 'not_recorded');
  assert.equal(summary.outcome, 'incomplete');
});

test('reference runtime mismatch is visible even when executable paths and args match', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t);
  await writeFile(f.options.expectedPlan, JSON.stringify({ context: { ...f.context, nodeVersion: 'v99.0.0' }, commands: f.commands }));
  const summary = await summarizeValidationReceipt(f.options);
  assert.equal(summary.commandOptions.status, 'match');
  assert.equal(summary.runtimeEvidence.nodeVersionComparison, 'mismatch');
  assert.equal(summary.outcome, 'mismatch');
});

test('a completion timestamp preceding finished steps is not a complete record', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t);
  await f.save('result.json', { ...f.result, finishedAt: '2026-10-27T00:00:00.000Z' });
  const summary = await summarizeValidationReceipt(f.options);
  assert.equal(summary.execution.status, 'invalid'); assert.equal(summary.outcome, 'invalid');
});

test('overlapping serial steps and a later context start are inconsistent records', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t);
  const steps = f.steps.map(x => ({ ...x })); steps[1].startedAt = steps[0].startedAt;
  await f.save('steps.json', steps); await f.save('result.json', { ...f.result, steps });
  assert.equal((await summarizeValidationReceipt(f.options)).execution.status, 'invalid');
  await f.save('steps.json', f.steps); f.context.startedAt = '2026-10-28T00:00:01.000Z';
  await f.save('invocation.json', f.invocation); await f.save('result.json', f.result);
  assert.equal((await summarizeValidationReceipt(f.options)).execution.status, 'invalid');
});

test('legacy completion flags must be booleans rather than truthy strings', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t, true);
  await f.save('completion.json', { ...f.completion, passed: 'false', clean: 'false', sourceStable: 'false' });
  const summary = await summarizeValidationReceipt(f.options);
  assert.equal(summary.execution.status, 'invalid'); assert.equal(summary.outcome, 'invalid');
});

test('absent step records are missing evidence rather than an explicit not-run record', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t);
  await rm(join(f.receipt, 'steps.json')); await rm(join(f.receipt, 'result.json'));
  const summary = await summarizeValidationReceipt(f.options);
  assert.equal(summary.outcome, 'missing'); assert.equal(summary.execution.status, 'partial');
});

test('a first-runner preflight failure before invocation is recorded as failed without echoing the error', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t);
  await rm(join(f.receipt, 'invocation.json')); await rm(join(f.receipt, 'inputs.json')); await rm(join(f.receipt, 'steps.json'));
  await f.save('result.json', { context: f.context, steps: [], exitCode: 1, failure: 'PRIVATE_ERROR',
    headStable: true, sourceBytesStable: false, finishedAt: '2026-10-28T00:01:00.000Z' });
  const summary = await summarizeValidationReceipt(f.options);
  assert.equal(summary.outcome, 'failed'); assert.equal(summary.execution.finished, 0);
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE_ERROR/);
});

test('a secret shaped like a commit hash is compared but never printed', async t => {
  const { summarizeValidationReceipt } = await api(); const f = await fixture(t);
  const secret = 'a'.repeat(40); f.context.head = secret;
  await f.save('invocation.json', f.invocation); await f.save('result.json', f.result);
  const summary = await summarizeValidationReceipt(f.options);
  assert.equal(summary.head.status, 'mismatch'); assert.doesNotMatch(JSON.stringify(summary), new RegExp(secret));
});
