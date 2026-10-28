// Read-only evidence comparison, never a test runner, skip decision or approval.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const commit = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const names = ['diff-check', 'query-exact-head', 'migration-exact-head', 'migration-layout',
  'domain-sqlstate', 'squawk', 'affected-consumers', 'notification-catalog-bodies',
  'types', 'combined-js-lint', 'build'];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const within = (root, path) => { const part = relative(root, path); return part !== '' && !part.startsWith('../') && !isAbsolute(part); };

async function bytes(path, max = 16 * 1024 * 1024) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max) return { status: 'blocked' };
    return { status: 'ok', value: await readFile(path) };
  } catch (error) {
    return { status: error.code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
}

async function json(path) {
  const source = await bytes(path, 4 * 1024 * 1024);
  if (source.status !== 'ok') return source;
  try { return { status: 'ok', value: JSON.parse(source.value.toString('utf8')) }; }
  catch { return { status: 'invalid' }; }
}

async function git(root, args) {
  // Fixed read-only Git commands only; receipt commands are never executed.
  try { return (await exec('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args],
    { cwd: root, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, maxBuffer: 4 * 1024 * 1024 })).stdout; }
  catch { return null; }
}

function plan(value) {
  if (!Array.isArray(value) || value.length !== 11) return null;
  const rows = value.map(row => Array.isArray(row) ? { name: row[0], command: row[1], args: row[2] } : row);
  if (rows.some(row => !row || !names.includes(row.name) || typeof row.command !== 'string'
    || !row.command || !Array.isArray(row.args) || row.args.some(arg => typeof arg !== 'string'))
    || new Set(rows.map(row => row.name)).size !== 11) return null;
  return rows.map(({ name, command, args }) => ({ name, command, args }));
}

const commandEqual = (a, b) => a.name === b.name && a.command === b.command && equal(a.args, b.args);
function identity(a, b) {
  return ['root', 'base', 'head', 'nodePath', 'nodeVersion', 'squawkPath', 'sourceFingerprint', 'startedAt']
    .every(key => a?.[key] === b?.[key]);
}

function execution(rows, commands, result, completion, legacy, separateSteps, context) {
  const info = { status: 'partial', planned: commands.length, finished: 0, passed: 0, failed: 0 };
  if (!Array.isArray(rows)) return { ...info, status: 'invalid' };
  info.finished = rows.length;
  if (rows.length > commands.length || new Set(rows.map(row => row?.name)).size !== rows.length
    || rows.some((row, i) => !row || !commandEqual(row, commands[i]) || !date(row.startedAt)
      || !date(row.finishedAt) || Date.parse(row.finishedAt) < Date.parse(row.startedAt)
      || !Number.isInteger(row.exitCode) || !sha(row.logSha256)
      || (i > 0 && Date.parse(row.startedAt) < Date.parse(rows[i - 1].finishedAt)))) return { ...info, status: 'invalid' };
  if (!legacy && rows.length && (!date(context?.startedAt)
    || Date.parse(context.startedAt) > Date.parse(rows[0].startedAt))) return { ...info, status: 'invalid' };
  info.passed = rows.filter(row => row.exitCode === 0 && !row.signal && !row.error).length;
  info.failed = rows.length - info.passed;
  if (info.failed || (!legacy && result && (result.exitCode !== 0 || result.failure || result.failedStep))
    || (legacy && completion && completion.passed === false)) return { ...info, status: 'failed' };
  if (!rows.length) return { ...info, status: 'not_run' };
  if (rows.length !== commands.length) return info;
  if (legacy) {
    if (!completion) return info;
    if (completion.passed !== true || completion.clean !== true || completion.sourceStable !== true || !date(completion.finishedAt)
      || completion.finalHead !== completion.head
      || Date.parse(completion.finishedAt) < Date.parse(rows.at(-1).finishedAt)) return { ...info, status: 'invalid' };
  } else {
    if (!result || !separateSteps) return info;
    if (!equal(rows, separateSteps) || result.headStable !== true || result.sourceBytesStable !== true
      || !date(result.finishedAt) || Date.parse(result.finishedAt) < Date.parse(rows.at(-1).finishedAt)) return { ...info, status: 'invalid' };
  }
  return { ...info, status: 'recorded_complete' };
}

async function compareInputs(root, recorded, tracked, fingerprint) {
  const result = { status: 'match', recorded: 0, matched: 0, changed: 0, missing: 0,
    blocked: 0, unreadable: 0, addedTracked: 0, manifest: 'not_recorded' };
  if (recorded.status !== 'ok') return { ...result, status: recorded.status };
  if (!Array.isArray(recorded.value) || !recorded.value.length) return { ...result, status: 'invalid' };
  if (!tracked) return { ...result, status: 'incomplete', recorded: recorded.value.length };
  const seen = new Set();
  for (const row of recorded.value) {
    result.recorded++;
    const path = row?.path;
    if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') || path.includes('\0')
      || path.split('/').some(part => ['..', '.', '.git', '.aws', '.ssh', '.supabase'].includes(part))
      || /(^|\/)\.env(?:\.|$)/.test(path) || seen.has(path) || !sha(row.sha256)) {
      result.blocked++; continue;
    }
    seen.add(path);
    if (!tracked?.has(path)) { result.missing++; continue; }
    const file = join(root, path);
    const actualPath = await realpath(file).catch(() => null);
    if (!actualPath) { result.missing++; continue; }
    if (!within(root, actualPath)) { result.blocked++; continue; }
    const source = await bytes(file);
    if (source.status !== 'ok') { result[source.status === 'blocked' ? 'blocked' : source.status === 'missing' ? 'missing' : 'unreadable']++; continue; }
    if (hash(source.value) === row.sha256) result.matched++; else result.changed++;
  }
  result.addedTracked = tracked ? [...tracked].filter(path => !seen.has(path)).length : 0;
  if (sha(fingerprint)) result.manifest = hash(JSON.stringify(recorded.value)) === fingerprint ? 'match' : 'mismatch';
  else if (fingerprint !== undefined) result.manifest = 'invalid';
  result.status = result.blocked ? 'invalid' : result.changed ? 'mismatch' : result.missing ? 'missing'
    : result.unreadable ? 'incomplete' : result.manifest === 'mismatch' ? 'mismatch'
      : result.manifest === 'invalid' ? 'invalid' : result.manifest === 'not_recorded' ? 'incomplete' : 'match';
  return result;
}

async function compareLogs(receipt, steps) {
  const counts = { status: 'match', matched: 0, changed: 0, missing: 0, blocked: 0, unreadable: 0 };
  for (const step of steps) {
    if (!names.includes(step?.name) || !sha(step.logSha256)) { counts.blocked++; continue; }
    const file = await bytes(join(receipt, step.name + '.log'));
    if (file.status === 'ok') counts[hash(file.value) === step.logSha256 ? 'matched' : 'changed']++;
    else counts[file.status === 'blocked' ? 'blocked' : file.status === 'missing' ? 'missing' : 'unreadable']++;
  }
  counts.status = counts.blocked ? 'invalid' : counts.changed ? 'mismatch' : counts.missing ? 'missing' : counts.unreadable ? 'incomplete' : 'match';
  return counts;
}

export async function summarizeValidationReceipt({ root, receipt, expectedPlan }) {
  const summary = { schemaVersion: 1, purpose: 'read_only_evidence_summary', decision: 'human_review_required',
    provenance: 'not_authenticated', wholeSourceAttestation: 'not_provided', outcome: 'missing', receiptFormat: 'unknown' };
  root = await realpath(root).catch(() => null);
  receipt = await realpath(receipt).catch(() => null);
  if (!root || !receipt) return summary;
  const [inv, input, res, stepFile, comp, expected] = await Promise.all([
    json(join(receipt, 'invocation.json')), json(join(receipt, 'inputs.json')), json(join(receipt, 'result.json')),
    json(join(receipt, 'steps.json')), json(join(receipt, 'completion.json')),
    expectedPlan ? json(resolve(expectedPlan)) : Promise.resolve({ status: 'not_provided' }),
  ]);
  if (inv.status !== 'ok') {
    if (inv.status === 'missing' && res.status === 'ok' && res.value?.context
      && res.value.exitCode === 1 && Array.isArray(res.value.steps) && res.value.steps.length === 0
      && date(res.value.finishedAt)) return { ...summary, receiptFormat: 'static_v1', outcome: 'failed',
      execution: { status: 'failed', planned: 11, finished: 0, passed: 0, failed: 0 } };
    return { ...summary, outcome: inv.status === 'missing' ? 'missing' : 'invalid' };
  }
  if (Array.isArray(inv.value?.argv) && !inv.value.commands) return { ...summary, outcome: 'unsupported', receiptFormat: 'unsupported' };
  const commands = plan(inv.value?.commands);
  if (!commands) return { ...summary, outcome: 'invalid' };
  const legacy = !inv.value.context;
  const context = legacy ? inv.value : inv.value.context;
  summary.receiptFormat = legacy ? 'legacy_static' : 'static_v1';
  const rows = legacy ? (Array.isArray(res.value) ? res.value : [])
    : Array.isArray(res.value?.steps) ? res.value.steps : Array.isArray(stepFile.value) ? stepFile.value : [];
  const stepEvidenceMissing = legacy ? res.status === 'missing' : res.status === 'missing' && stepFile.status === 'missing';
  summary.execution = execution(rows, commands, res.value, comp.value, legacy, stepFile.value, context);
  if (stepEvidenceMissing) summary.execution.status = 'partial';
  if (res.status === 'invalid' || stepFile.status === 'invalid' || comp.status === 'invalid') summary.execution.status = 'invalid';
  if ((!legacy && res.status === 'ok' && !identity(context, res.value?.context))
    || (legacy && comp.status === 'ok' && ['root', 'base', 'head'].some(key => context[key] !== comp.value?.[key]))) {
    summary.execution.status = 'invalid';
  }
  const [currentHead, trackedRaw] = await Promise.all([git(root, ['rev-parse', 'HEAD']), git(root, ['ls-files', '-z'])]);
  const current = currentHead?.trim();
  const tracked = trackedRaw === null ? null : new Set(trackedRaw.split('\0').filter(Boolean));
  // Even a hex-shaped receipt field might contain a secret. Compare, don't echo.
  summary.head = { status: !commit(current) || !commit(context.head) ? 'unknown' : current === context.head ? 'match' : 'mismatch' };
  const expectedContext = expected.value?.context || expected.value;
  summary.base = { status: !commit(context.base) || !commit(expectedContext?.base) ? 'not_checked'
    : context.base === expectedContext.base ? 'match' : 'mismatch' };
  summary.inputs = await compareInputs(root, input, tracked, legacy ? comp.value?.inputManifestSha256 : context.sourceFingerprint);
  summary.logs = await compareLogs(receipt, rows);
  const expectedCommands = plan(expected.value?.commands);
  let changed = 0;
  if (expectedCommands) changed = commands.filter(command => !commandEqual(command, expectedCommands.find(row => row.name === command.name))).length;
  summary.commandOptions = { status: expected.status === 'not_provided' ? 'not_checked' : !expectedCommands ? 'invalid' : changed ? 'mismatch' : 'match', changed };
  summary.commandOrder = !expectedCommands ? 'not_checked' : equal(commands.map(x => x.name), expectedCommands.map(x => x.name)) ? 'same' : 'different';
  const version = value => typeof value === 'string' && /^v\d+\.\d+\.\d+$/.test(value);
  summary.runtimeEvidence = { nodeVersion: version(context.nodeVersion) ? 'recorded' : 'not_recorded',
    nodeVersionComparison: !version(context.nodeVersion) ? 'not_recorded' : !version(expectedContext?.nodeVersion)
      ? 'not_checked' : context.nodeVersion === expectedContext.nodeVersion ? 'match' : 'mismatch',
    environment: 'not_recorded', executableBytes: 'not_checked' };
  const requiredStates = [summary.inputs.status, summary.logs.status, summary.head.status, summary.base.status, summary.commandOptions.status];
  if (summary.execution.status === 'failed') summary.outcome = 'failed';
  else if (summary.execution.status === 'not_run') summary.outcome = 'not_run';
  else if (summary.execution.status === 'invalid' || requiredStates.includes('invalid')) summary.outcome = 'invalid';
  else if (requiredStates.includes('missing') || stepEvidenceMissing) summary.outcome = 'missing';
  else if (requiredStates.includes('mismatch') || summary.inputs.addedTracked > 0
    || summary.runtimeEvidence.nodeVersionComparison === 'mismatch') summary.outcome = 'mismatch';
  else if (summary.execution.status !== 'recorded_complete' || requiredStates.some(state => state !== 'match')) summary.outcome = 'incomplete';
  else summary.outcome = 'matching_records';
  return summary;
}

async function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = { '--root': 'root', '--receipt': 'receipt', '--expected-plan': 'expectedPlan' }[argv[i]];
    if (!key || options[key] || !argv[i + 1]) throw new Error('invalid_arguments');
    options[key] = argv[i + 1];
  }
  if (!options.root || !options.receipt) throw new Error('invalid_arguments');
  console.log(JSON.stringify(await summarizeValidationReceipt(options), null, 2));
  // Exit zero means a summary was produced, never that validation passed.
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    console.log(JSON.stringify({ purpose: 'read_only_evidence_summary', outcome: 'unavailable', decision: 'human_review_required' }));
    process.exitCode = 1;
  });
}
