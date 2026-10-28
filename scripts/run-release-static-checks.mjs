// Local static validation only. No DB execution, deployment, installation or gate selection.
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const roots = ['tests/helpers/ai-producer-receipt.test.mjs', 'tests/textbook-taxonomy-final-wire.test.mjs',
  'tests/textbook-work-context.test.mjs', 'tests/ai-agent-local-db-runner.test.mjs',
  'tests/supabase-migration-layout.test.mjs', 'tests/admin-shell.test.mjs',
  'tests/query-surface-budget.test.mjs', 'tests/teacher-planning-auth-boundaries.test.mjs'];

// Same eleven commands/arguments as the reviewed PR193 local runner. Only order changes.
function commands(base, head, squawkPath) {
  const node = process.execPath;
  return [
    ['diff-check', 'git', ['diff', '--check', base, head]],
    ['query-exact-head', node, ['scripts/verify-free-tier-query-contracts.mjs', '--base', base, '--head', head, '--surface', 'all']],
    ['migration-exact-head', node, ['scripts/run-isolated-supabase-db-tests.mjs', '--review-head', '--require-final', '--review-base-sha', base, '--review-head-sha', head]],
    ['migration-layout', node, ['scripts/verify-supabase-migration-layout.mjs']],
    ['domain-sqlstate', node, ['scripts/verify-domain-sqlstate-contract.mjs']],
    ['squawk', squawkPath, ['--no-error-on-unmatched-pattern', '--pg-version', '17',
      'supabase/migrations/20261027005334_teacher_own_request_workflow.sql',
      'supabase/migrations/20261027124217_makeup_subject_director_authority.sql']],
    ['affected-consumers', node, ['--test', '--experimental-strip-types', ...roots]],
    ['notification-catalog-bodies', node, ['--test', '--experimental-strip-types', '--test-name-pattern=^(trusted executor는 fake subprocess transcript로 17단계 command를 실제 조합한다|trusted migration push는 pending 0개면 dry-run과 history만 확인하고 actual을 생략한다)$', 'tests/notification-isolated-db-qa.test.mjs']],
    ['types', node, ['node_modules/typescript/bin/tsc', '--noEmit']],
    ['combined-js-lint', node, ['node_modules/eslint/bin/eslint.js', 'scripts/lib/ai-producer-receipt.mjs', 'tests/helpers/ai-producer-receipt.test.mjs']],
    ['build', node, ['node_modules/next/dist/bin/next', 'build', '--webpack']],
  ].map(([name, command, args]) => ({ name, command, args }));
}

export function executeValidationProcess({ command, args, cwd, env }) {
  return new Promise(resolveResult => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', error;
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', cause => { error = cause.code || 'spawn_error'; });
    // Resolve after close, not exit/error: owned child and its pipes are finished.
    child.on('close', (code, signal) => resolveResult({ code, signal, stdout, stderr, error }));
  });
}

async function git(root, args) {
  return (await exec('git', args, { cwd: root, env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' } })).stdout;
}

async function assertFinalSource(root, expectedHead) {
  if ((await git(root, ['rev-parse', 'HEAD'])).trim() !== expectedHead) throw new Error('release_head_mismatch');
  if ((await git(root, ['status', '--porcelain'])).trim()) throw new Error('release_source_not_clean');
}

async function fingerprint(root) {
  const paths = (await git(root, ['ls-files', '-z'])).split('\0').filter(Boolean).sort();
  return Promise.all(paths.map(async path => ({ path, sha256: hash(await readFile(join(root, path))) })));
}

export async function runReleaseStaticChecks({ root, base, head, output, squawkPath,
  executeProcess = executeValidationProcess }) {
  root = resolve(root);
  output = resolve(output);
  const outputRelative = relative(root, output);
  if (outputRelative === '' || (!outputRelative.startsWith('..' + '/') && !isAbsolute(outputRelative))) {
    throw new Error('release_evidence_must_be_outside_source');
  }
  // A new attempt must not overwrite earlier valid evidence.
  await mkdir(output, { recursive: false, mode: 0o700 });
  const context = { root, base, head, nodePath: process.execPath, nodeVersion: process.version,
    squawkPath, startedAt: new Date().toISOString() };
  const result = { exitCode: 1, context, steps: [], headStable: false, sourceBytesStable: false };
  let before;
  try {
    if (!/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(head)) throw new Error('release_commit_invalid');
    if (!squawkPath || !isAbsolute(squawkPath)) throw new Error('release_existing_squawk_required');
    await assertFinalSource(root, head);
    before = await fingerprint(root);
    context.sourceFingerprint = hash(JSON.stringify(before));
    await writeFile(join(output, 'inputs.json'), JSON.stringify(before, null, 2) + '\n');
    const plan = commands(base, head, squawkPath);
    await writeFile(join(output, 'invocation.json'), JSON.stringify({ context, commands: plan }, null, 2) + '\n');
    const env = { PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
      LANG: 'C', LC_ALL: 'C', NEXT_TELEMETRY_DISABLED: '1', SUPABASE_TELEMETRY_DISABLED: '1' };
    for (const step of plan) {
      await assertFinalSource(root, head);
      const startedAt = new Date().toISOString();
      let child;
      try {
        child = await executeProcess({ ...step, cwd: root, env });
      } catch (error) {
        child = { code: 1, signal: null, stdout: '', stderr: '', error: error.code || 'process_error' };
      }
      const text = (child.stdout || '') + '\n' + (child.stderr || '');
      await writeFile(join(output, step.name + '.log'), text, { mode: 0o600 });
      const exitCode = Number.isInteger(child.code) && child.code >= 0 ? child.code : 1;
      result.steps.push({ ...step, startedAt, finishedAt: new Date().toISOString(), exitCode,
        signal: child.signal || null, ...(child.error ? { error: child.error } : {}), logSha256: hash(text) });
      await writeFile(join(output, 'steps.json'), JSON.stringify(result.steps, null, 2) + '\n');
      if (exitCode !== 0) {
        result.failedStep = step.name;
        result.exitCode = exitCode;
        break;
      }
    }
    if (!result.failedStep) {
      await assertFinalSource(root, head);
      result.exitCode = 0;
    }
  } catch (error) {
    result.failure = error.message;
    result.exitCode = 1;
  } finally {
    // Preserve content identity separately from commit identity; don't discard
    // completed receipts or relabel their original head as a later execution.
    const after = before ? await fingerprint(root).catch(() => null) : null;
    result.sourceBytesStable = Boolean(before && after && JSON.stringify(before) === JSON.stringify(after));
    result.headStable = (await git(root, ['rev-parse', 'HEAD']).catch(() => '')).trim() === head;
    if ((!result.headStable || (before && !result.sourceBytesStable)) && result.exitCode === 0) {
      result.exitCode = 1;
      result.failure = result.headStable ? 'release_source_bytes_changed' : 'release_head_mismatch';
    }
    result.finishedAt = new Date().toISOString();
    await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  }
  return result;
}

async function main(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--root', '--base', '--head', '--output', '--squawk'].includes(argv[i]) || !argv[i + 1] || flags.has(argv[i])) {
      throw new Error('usage: --root <clean repo> --base <sha> --head <sha> --output <new external dir> --squawk <existing absolute path>');
    }
    flags.set(argv[i], argv[i + 1]);
  }
  if (flags.size !== 5) throw new Error('release_arguments_required');
  const result = await runReleaseStaticChecks({ root: flags.get('--root'), base: flags.get('--base'),
    head: flags.get('--head'), output: flags.get('--output'), squawkPath: flags.get('--squawk') });
  console.log(JSON.stringify({ exitCode: result.exitCode, failedStep: result.failedStep,
    failure: result.failure, completed: result.steps.length, headStable: result.headStable,
    sourceBytesStable: result.sourceBytesStable, output: flags.get('--output') }));
  process.exitCode = result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
