import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);
const modulePath = new URL('../scripts/run-release-static-checks.mjs', import.meta.url);
async function runner() {
  const api = await import(modulePath).catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof api.runReleaseStaticChecks, 'function', 'release preflight runner is missing');
  return api;
}

async function fixture(t, contents = 'export const value = 2;\n') {
  const sandbox = await mkdtemp(join(tmpdir(), 'release-preflight-test-'));
  const root = join(sandbox, 'repo');
  await mkdir(root);
  const git = async (...args) => (await exec('git', args, { cwd: root })).stdout.trim();
  await git('init', '-q');
  await git('config', 'user.name', 'Local Fixture');
  await git('config', 'user.email', 'fixture@invalid.test');
  await writeFile(join(root, 'source.mjs'), 'export const value = 1;\n');
  await git('add', '.');
  await git('commit', '-qm', 'base');
  const base = await git('rev-parse', 'HEAD');
  await writeFile(join(root, 'source.mjs'), contents);
  await git('add', '.');
  await git('commit', '-qm', 'candidate');
  const head = await git('rev-parse', 'HEAD');
  const output = join(sandbox, 'evidence');
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { root, base, head, output, git };
}

const success = () => ({ code: 0, signal: null, stdout: 'ok\n', stderr: '' });
const schedule = ['diff-check', 'query-exact-head', 'migration-exact-head', 'migration-layout',
  'domain-sqlstate', 'squawk', 'affected-consumers', 'notification-catalog-bodies',
  'types', 'combined-js-lint', 'build'];

test('all eleven unchanged checks run once with preflight first and build last', async t => {
  const { runReleaseStaticChecks } = await runner();
  const f = await fixture(t);
  process.env.RELEASE_PRIVATE_ENV_PROBE = 'dummy-not-a-credential';
  t.after(() => { delete process.env.RELEASE_PRIVATE_ENV_PROBE; });
  const seen = [];
  const result = await runReleaseStaticChecks({ ...f, squawkPath: '/existing/squawk',
    executeProcess: async step => { seen.push(step); return success(); } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.sourceBytesStable, true);
  assert.equal(result.headStable, true);
  assert.deepEqual(seen.map(x => x.name), schedule);
  assert.equal(new Set(seen.map(x => x.name)).size, 11);
  const byName = Object.fromEntries(seen.map(x => [x.name, [x.command, ...x.args]]));
  assert.deepEqual(byName['diff-check'], ['git', 'diff', '--check', f.base, f.head]);
  assert.deepEqual(byName['query-exact-head'], [process.execPath, 'scripts/verify-free-tier-query-contracts.mjs', '--base', f.base, '--head', f.head, '--surface', 'all']);
  assert.deepEqual(byName['migration-exact-head'], [process.execPath, 'scripts/run-isolated-supabase-db-tests.mjs', '--review-head', '--require-final', '--review-base-sha', f.base, '--review-head-sha', f.head]);
  assert.deepEqual(byName['migration-layout'], [process.execPath, 'scripts/verify-supabase-migration-layout.mjs']);
  assert.deepEqual(byName['domain-sqlstate'], [process.execPath, 'scripts/verify-domain-sqlstate-contract.mjs']);
  assert.deepEqual(byName.squawk, ['/existing/squawk', '--no-error-on-unmatched-pattern', '--pg-version', '17', 'supabase/migrations/20261027005334_teacher_own_request_workflow.sql', 'supabase/migrations/20261027124217_makeup_subject_director_authority.sql']);
  assert.deepEqual(byName['affected-consumers'], [process.execPath, '--test', '--experimental-strip-types', 'tests/helpers/ai-producer-receipt.test.mjs', 'tests/textbook-taxonomy-final-wire.test.mjs', 'tests/textbook-work-context.test.mjs', 'tests/ai-agent-local-db-runner.test.mjs', 'tests/supabase-migration-layout.test.mjs', 'tests/admin-shell.test.mjs', 'tests/query-surface-budget.test.mjs', 'tests/teacher-planning-auth-boundaries.test.mjs']);
  assert.deepEqual(byName['notification-catalog-bodies'], [process.execPath, '--test', '--experimental-strip-types', '--test-name-pattern=^(trusted executor는 fake subprocess transcript로 17단계 command를 실제 조합한다|trusted migration push는 pending 0개면 dry-run과 history만 확인하고 actual을 생략한다)$', 'tests/notification-isolated-db-qa.test.mjs']);
  assert.deepEqual(byName.types, [process.execPath, 'node_modules/typescript/bin/tsc', '--noEmit']);
  assert.deepEqual(byName['combined-js-lint'], [process.execPath, 'node_modules/eslint/bin/eslint.js', 'scripts/lib/ai-producer-receipt.mjs', 'tests/helpers/ai-producer-receipt.test.mjs']);
  assert.deepEqual(byName.build, [process.execPath, 'node_modules/next/dist/bin/next', 'build', '--webpack']);
  const receipt = JSON.parse(await readFile(join(f.output, 'result.json'), 'utf8'));
  assert.equal(receipt.steps.length, 11);
  assert.equal(receipt.steps.every(x => x.exitCode === 0 && x.logSha256.length === 64), true);
  assert.equal(seen.every(x => x.env.SUPABASE_ACCESS_TOKEN === undefined), true);
  assert.equal(seen.every(x => x.env.NEXT_TELEMETRY_DISABLED === '1'), true);
  assert.equal(seen.every(x => x.env.SUPABASE_TELEMETRY_DISABLED === '1'), true);
  assert.equal(seen.every(x => x.env.RELEASE_PRIVATE_ENV_PROBE === undefined), true);
});

test('real committed EOF failure stops before any other validation command', async t => {
  const { runReleaseStaticChecks, executeValidationProcess } = await runner();
  const f = await fixture(t, 'export const value = 2;\n\n');
  const seen = [];
  const result = await runReleaseStaticChecks({ ...f, squawkPath: '/existing/squawk', executeProcess: async step => {
    seen.push(step.name);
    assert.equal(step.name, 'diff-check');
    return executeValidationProcess(step);
  } });
  assert.deepEqual(seen, ['diff-check']);
  assert.equal(result.exitCode, 2);
  assert.equal(result.failedStep, 'diff-check');
  assert.match(await readFile(join(f.output, 'diff-check.log'), 'utf8'), /new blank line at EOF/);
  assert.equal(result.sourceBytesStable, true);
});

for (const invalid of ['wrong-head', 'dirty-source']) {
  test(`${invalid} rejects before any validation process starts`, async t => {
    const { runReleaseStaticChecks } = await runner();
    const f = await fixture(t);
    if (invalid === 'wrong-head') f.head = f.base;
    else await writeFile(join(f.root, 'source.mjs'), 'changed without a commit\n');
    let calls = 0;
    const result = await runReleaseStaticChecks({ ...f, squawkPath: '/existing/squawk', executeProcess: async () => { calls++; return success(); } });
    assert.equal(result.exitCode, 1);
    assert.equal(calls, 0);
    assert.equal(result.steps.length, 0);
    assert.equal(result.failure, invalid === 'wrong-head' ? 'release_head_mismatch' : 'release_source_not_clean');
  });
}

test('a failed cheap gate preserves earlier passed receipts and stops expensive checks', async t => {
  const { runReleaseStaticChecks } = await runner();
  const f = await fixture(t);
  const seen = [];
  const result = await runReleaseStaticChecks({ ...f, squawkPath: '/existing/squawk', executeProcess: async step => {
    seen.push(step.name);
    return step.name === 'migration-exact-head' ? { ...success(), code: 7 } : success();
  } });
  assert.deepEqual(seen, ['diff-check', 'query-exact-head', 'migration-exact-head']);
  assert.equal(result.exitCode, 7);
  assert.deepEqual(result.steps.map(x => x.exitCode), [0, 0, 7]);
  assert.equal(result.sourceBytesStable, true);
  assert.match(await readFile(join(f.output, 'query-exact-head.log'), 'utf8'), /ok/);
});

test('source drift after a command stops before the next command and preserves its context', async t => {
  const { runReleaseStaticChecks } = await runner();
  const f = await fixture(t);
  let calls = 0;
  const result = await runReleaseStaticChecks({ ...f, squawkPath: '/existing/squawk', executeProcess: async () => {
    calls++;
    await writeFile(join(f.root, 'source.mjs'), 'drift\n');
    return success();
  } });
  assert.equal(calls, 1);
  assert.equal(result.exitCode, 1);
  assert.equal(result.failure, 'release_source_not_clean');
  assert.equal(result.sourceBytesStable, false);
  assert.equal(result.steps[0].exitCode, 0);
  assert.equal(result.context.head, f.head);
});

test('same-byte HEAD drift is reported separately without erasing completed evidence', async t => {
  const { runReleaseStaticChecks } = await runner();
  const f = await fixture(t);
  let calls = 0;
  const result = await runReleaseStaticChecks({ ...f, squawkPath: '/existing/squawk', executeProcess: async () => {
    calls++;
    await f.git('commit', '--allow-empty', '-qm', 'metadata changed during the run');
    return success();
  } });
  assert.equal(calls, 1);
  assert.equal(result.exitCode, 1);
  assert.equal(result.headStable, false);
  assert.equal(result.sourceBytesStable, true);
  assert.equal(result.steps[0].exitCode, 0);
  assert.equal(result.context.head, f.head);
});

test('a subprocess exception records failure, keeps evidence and never starts later steps', async t => {
  const { runReleaseStaticChecks } = await runner();
  const f = await fixture(t);
  let calls = 0;
  const result = await runReleaseStaticChecks({ ...f, squawkPath: '/existing/squawk', executeProcess: async () => {
    calls++;
    throw Object.assign(new Error('dummy spawn failed'), { code: 'ENOENT' });
  } });
  assert.equal(result.exitCode, 1);
  assert.equal(calls, 1);
  assert.equal(result.steps[0].error, 'ENOENT');
  assert.equal(result.sourceBytesStable, true);
  assert.equal(JSON.parse(await readFile(join(f.output, 'result.json'), 'utf8')).exitCode, 1);
});

test('existing evidence is never overwritten by a new attempt', async t => {
  const { runReleaseStaticChecks } = await runner();
  const f = await fixture(t);
  await mkdir(f.output);
  await writeFile(join(f.output, 'result.json'), 'previous valid evidence\n');
  let calls = 0;
  await assert.rejects(runReleaseStaticChecks({ ...f, squawkPath: '/existing/squawk', executeProcess: async () => { calls++; return success(); } }), { code: 'EEXIST' });
  assert.equal(calls, 0);
  assert.equal(await readFile(join(f.output, 'result.json'), 'utf8'), 'previous valid evidence\n');
});

test('a real missing executable settles after close and reports failure without hanging', async () => {
  const { executeValidationProcess } = await runner();
  const result = await executeValidationProcess({ command: '/missing/local-validation-executable', args: [],
    cwd: tmpdir(), env: { PATH: '/usr/bin:/bin' } });
  assert.equal(result.error, 'ENOENT');
  assert.notEqual(result.code, 0);
  assert.equal(result.stdout, '');
});

test('a real terminated child drains its pipes and cannot be reported as success', async () => {
  const { executeValidationProcess } = await runner();
  const result = await executeValidationProcess({ command: process.execPath,
    args: ['-e', 'process.stdout.write("owned-child-output"); process.kill(process.pid, "SIGTERM")'],
    cwd: tmpdir(), env: { PATH: '/usr/bin:/bin' } });
  assert.equal(result.signal, 'SIGTERM');
  assert.equal(result.code, null);
  assert.equal(result.stdout, 'owned-child-output');
});
