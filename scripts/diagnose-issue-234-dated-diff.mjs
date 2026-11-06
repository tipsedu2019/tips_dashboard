// Diagnostic-only stage measurements. Never accepts DB URLs, credentials,
// product migration mutations, remote services, downloads, or image pulls.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputPath = process.argv[2];
const verifySourceOnly = outputPath === '--verify-source';
assert.ok(process.argv.length === 3 && outputPath, 'usage: node scripts/diagnose-issue-234-dated-diff.mjs OUTPUT.json | --verify-source');
const fixturePath = 'scripts/fixtures/issue-234-dated-diff.sql';
const runnerPath = 'scripts/diagnose-issue-234-dated-diff.mjs';
const sourcePaths = [
  'supabase/migrations/20261013193200_timetable_shared_validation_workset.sql',
  'supabase/migrations/20261103170744_timetable_validation_per_date_inputs.sql',
  'supabase/migrations/20261106015549_timetable_dated_diff_projection_reuse.sql',
];
const expectedSourceHashes = [
  'f5df6c1d0494ff8f0d5ad75251e1b3592ee5a14b7a532eb43534413976886559',
  'e45ca46ee41fafd1cedce8c6bef74c1c14133f2f2534deb9a49e99ab2970d4e4',
  '133044663cec2aa4b3f1bc4ae2dab7bcafb4a57c45d7b7d574baf834639f7ea6',
];
const image = 'postgres:17-alpine';
const ownershipToken = randomBytes(16).toString('hex');
const ownershipLabel = 'org.tipsedu.issue234.dated-diff';
const container = `tips-234-dated-diff-${process.pid}-${ownershipToken.slice(0, 8)}`;
const environment = { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' };
const bytes = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sha = text => createHash('sha256').update(text).digest('hex');
const fixture = bytes(fixturePath);
const sources = sourcePaths.map(path => ({ path, sha256: sha(bytes(path)) }));
// These line spans are meaningful only within the two SHA-pinned files. Every
// baseline region used by evaluate() is compared before Docker is invoked.
function fixtureRegion(name) {
  const lines = fixture.split('\n');
  const starts = lines.flatMap((line, index) => line.trim() === `-- @source ${name}` ? [index] : []);
  const ends = lines.flatMap((line, index) => line.trim() === `-- @end-source ${name}` ? [index] : []);
  assert.equal(starts.length, 1, `expected one fixture source start: ${name}`);
  assert.equal(ends.length, 1, `expected one fixture source end: ${name}`);
  assert.ok(ends[0] > starts[0], `invalid source region: ${name}`);
  return `${lines.slice(starts[0] + 1, ends[0]).join('\n')}\n`;
}
function verifyProvenance() {
  sources.forEach((entry, index) => assert.equal(entry.sha256, expectedSourceHashes[index], `pinned source drift: ${entry.path}`));
  const specifications = [
    ['row_type', 0, 8, 12], ['workset_values', 0, 50, 55],
    ['old_prepare', 1, 83, 99], ['new_prepare', 1, 100, 116],
    ['eligibility', 1, 121, 126], ['dated_original', 1, 132, 142],
    ['weekday_diff', 1, 143, 148], ['affected_original', 1, 156, 173],
  ];
  const regions = specifications.map(([name, sourceIndex, firstLine, lastLine]) => {
    const expected = `${bytes(sourcePaths[sourceIndex]).split('\n').slice(firstLine - 1, lastLine).join('\n')}\n`;
    const actual = fixtureRegion(name).replaceAll('issue234_dated_diff.', 'dashboard_private.');
    assert.equal(actual, expected, `fixture baseline source drift: ${name}`);
    return { name, sourcePath: sourcePaths[sourceIndex], firstLine, lastLine, originalSha256: sha(expected), fixtureSha256: sha(fixtureRegion(name)) };
  });
  const migration = bytes(sourcePaths[2]);
  const anchorParts = migration.split('$anchor$'); const replacementParts = migration.split('$replacement$');
  assert.equal(anchorParts.length, 3); assert.equal(replacementParts.length, 3);
  const anchor = anchorParts[1]; const replacement = replacementParts[1];
  const original = fixtureRegion('dated_original');
  assert.equal(original.split(anchor).length, 2, 'dated diff anchor must occur exactly once');
  const candidate = original.replace(anchor, replacement);
  assert.equal(fixtureRegion('dated_projection_reuse'), candidate, 'candidate differs from exact migration replacement');
  const newSemantics = fixture.split('create table issue234_dated_diff.semantic_cases')[1].split('create function issue234_dated_diff.semantic_checks()')[0];
  assert.equal(sha(newSemantics.replaceAll('issue234_dated_diff.', 'issue234_validator_phases.')), 'ab26917afb9bccc0f151b14229b8ce5fedea9015ead2b181b588a795fd462736', '20 pinned semantic inputs must be preserved');
  return { status: 'pass', transformation: 'baseline namespace only; exact migration anchor/replacement only in dated_diff; original enumeration unchanged', regions,
    candidateSha256: sha(candidate), migrationPath: sourcePaths[2], reusedSemanticCases: 20 };

}
const runnerHash = sha(bytes(runnerPath));
const variants = ['original', 'projection_reuse'];
const planCacheModes = ['force_custom_plan', 'force_generic_plan'];
const configurations = planCacheModes.flatMap(planCacheMode => [84].flatMap(classCount => ['close_history', 'dated_equal_weekly_change']
  .map(distribution => ({ planCacheMode, classCount, sourceRows: classCount * 128, distribution }))));
const repetitions = 5;
const settings = `set statement_timeout='30s';set lock_timeout='3s';set timezone='Asia/Seoul';set datestyle='ISO, MDY';set work_mem='4MB';set jit=off;`;
const docker = (args, input, allowFailure = false) => {
  const result = spawnSync('docker', args, { cwd: root, input, encoding: 'utf8', timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024, env: environment });
  assert.equal(result.error, undefined, 'docker invocation failed or timed out');
  if (!allowFailure) assert.equal(result.status, 0, result.stderr || 'docker failed');
  return result;
};
const psql = ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', 'postgres'];
const sql = query => docker(psql, `${settings}\n${query}`).stdout.trim();
const json = query => JSON.parse(sql(query));

function verifyMigrationBoundary() {
  const db = 'issue234_migration';
  docker(['exec', container, 'createdb', '-U', 'postgres', db]);
  const args = [...psql.slice(0, -1), db];
  const query = statement => docker(args, `${settings}\n${statement}`).stdout.trim();
  const definitionParts = bytes(sourcePaths[1]).split('$definition$');
  assert.equal(definitionParts.length, 3);
  const baselineDefinition = definitionParts[1];
  const baselineBody = baselineDefinition.split('$f$')[1];
  assert.equal(createHash('md5').update(baselineBody).digest('hex'), 'f43f5adf0c9ed1ed6b195de6940bb639');
  const types = bytes(sourcePaths[0]).split('\n').slice(7, 13).join('\n');
  query(`create schema dashboard_private;\n${types}\n${baselineDefinition}
    create role issue234_metadata_owner nologin;create role issue234_metadata_caller nologin;
    alter function dashboard_private.validate_timetable_operating_reference_v1() owner to issue234_metadata_owner;
    revoke all on function dashboard_private.validate_timetable_operating_reference_v1() from public;
    grant execute on function dashboard_private.validate_timetable_operating_reference_v1() to issue234_metadata_caller;`);
  const snapshot = () => JSON.parse(query(`select coalesce((select jsonb_build_object('metadata',to_jsonb(p)-'prosrc','bodyMd5',md5(p.prosrc))
    from pg_catalog.pg_proc p where p.oid=to_regprocedure('dashboard_private.validate_timetable_operating_reference_v1()')),'null'::jsonb);`));
  const before = snapshot();
  assert.equal(before.bodyMd5, 'f43f5adf0c9ed1ed6b195de6940bb639');
  query(bytes(sourcePaths[2]));
  const after = snapshot();
  assert.equal(after.bodyMd5, '5f577a02f6ee20daf14284c62e4ded05');
  assert.deepEqual(after.metadata, before.metadata, 'migration altered nonbody pg_proc metadata');
  const rejections = [];
  const rejectAtomically = label => {
    const prior = snapshot();
    const result = docker(args, `${settings}\n${bytes(sourcePaths[2])}`, true);
    assert.notEqual(result.status, 0, `${label} was not rejected`);
    assert.match(result.stderr, /55000/u, `${label} SQLSTATE mismatch`);
    assert.match(result.stderr, /timetable_dated_diff_projection_definition_drift/u);
    assert.deepEqual(snapshot(), prior, `${label} rejection changed target definition/metadata`);
    rejections.push({ label, sqlstate: '55000', targetUnchanged: true });
  };
  rejectAtomically('reapply');
  const drifted = baselineDefinition.replace('declare skip_unchanged_days', '-- deliberate isolated body drift\ndeclare skip_unchanged_days');
  assert.notEqual(drifted, baselineDefinition);
  query(drifted);
  rejectAtomically('body_drift');
  query('drop function dashboard_private.validate_timetable_operating_reference_v1();');
  rejectAtomically('missing_target');
  return { scope: 'Exact final baseline function body and actual forward migration in a separate empty diagnostic database. No operational tables, helper closure, auth/RLS, writer or full validator invocation.',
    before, after, nonbodyMetadataUnchanged: true, includesOidOwnerAclAndProsqlbody: true, rejections };
}

// Keep each case's warmups and measured pairs in ONE PostgreSQL backend.
// Streaming complete JSON lines also makes sample progress visible while a case
// runs, without sending synthetic input rows to the console.
function batch(query, onResult) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', psql, { cwd: root, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    let pending = ''; let stderr = ''; let size = 0; let failure; const rows = [];
    const timer = setTimeout(() => { failure = new Error('owned diagnostic case exceeded 120s'); child.kill('SIGTERM'); }, 120_000);
    const consume = line => {
      if (!line.trim()) return;
      try { const row = JSON.parse(line); rows.push(row); onResult?.(row); }
      catch (error) { failure = error; child.kill('SIGTERM'); }
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > 32 * 1024 * 1024) { failure = new Error('diagnostic output exceeded bound'); child.kill('SIGTERM'); return; }
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) { consume(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16_384); });
    child.on('error', error => { failure = error; });
    child.on('close', code => {
      clearTimeout(timer);
      if (pending.trim()) consume(pending);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`owned diagnostic SQL failed (${code}): ${stderr}`));
      else resolve(rows);
    });
    child.stdin.end(`${settings}\n${query}`);
  });
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  assert.ok(sorted.length > 0 && sorted.every(value => Number.isFinite(value) && value >= 0));
  return { values, median: sorted[Math.floor(sorted.length / 2)], minimum: sorted[0], maximum: sorted.at(-1) };
}

const report = {
  version: 1,
  startedAt: new Date().toISOString(),
  nodeVersion: process.version,
  scope: 'Synthetic bounded measurement of the approved dated-diff raw-text projection reuse candidate. Only the migration dated-diff SELECT differs. No actual reader, complete validator invocation, writer, auth/RLS, or Supabase migration-chain performance measurement.',
  sources, fixture: { path: fixturePath, sha256: sha(fixture) }, runner: { path: runnerPath, sha256: runnerHash },
  isolation: { image, pull: 'never', network: 'none', publishedPorts: [], hostBinds: [], privileged: false, cpus: 2, memoryMiB: 768, tmpfsMiB: 512 },
  design: { configurations, variants, repetitions, warmupPerVariant: 1,
    pairing: 'AB/BA alternating, sequential, single backend per case; warmups are not measured samples',
    plannerModes: 'forced custom and forced generic are distinct inputs; no mixed auto-plan samples or combined averages',
    inputFetch: 'synthetic JSON fixture fetch, not the actual operating reader',
    plans: 'none; EXPLAIN, PREPARE and large array SQL literals are excluded after the prior diagnostic OOM',
    timings: 'observations only; no machine-dependent latency pass threshold; direct phase timings only; no EXPLAIN',
    resultOrder: 'record encountered and sorted date hashes separately; a changed encounter order is never silently treated as exact equivalence' },
  candidateApproval: 'Approved local dated-diff candidate comparison; no production deployment authorization. Complete validator behavior requires its separate regression suite.',
  cases: [],
};
if (verifySourceOnly) {
  console.log(JSON.stringify({ result: 'SOURCE_VERIFIED_NO_RUNTIME', provenance: verifyProvenance(),
    sources: report.sources, fixture: report.fixture, runner: report.runner }));
  process.exit(0);
}
let runAttempted = false; let failure; let stage = 'source_provenance';
try {
  report.provenance = verifyProvenance();
  stage = 'local_docker_endpoint';
  const endpoint = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).stdout.trim();
  assert.ok(endpoint.startsWith('unix:///') && !endpoint.includes('\n'), 'only a local Unix Docker endpoint is allowed');
  report.isolation.endpointType = 'local_unix_socket';
  stage = 'cached_image';
  const inspectedImage = JSON.parse(docker(['image', 'inspect', image]).stdout)[0];
  report.imageId = inspectedImage.Id;
  report.imageMetadata = { os: inspectedImage.Os, architecture: inspectedImage.Architecture, repoDigests: inspectedImage.RepoDigests };
  report.dockerVersion = docker(['version', '--format', '{{.Server.Version}}']).stdout.trim();
  assert.match(report.imageId, /^sha256:[a-f0-9]{64}$/u);
  // Run the inspected image ID, so another local tag change cannot change input.
  // Record ownership before invoking Docker: a CLI error can have an uncertain
  // daemon-side outcome, which must still enter the owned-container cleanup.
  report.isolation.ownership = { container, label: ownershipLabel, token: ownershipToken, imageId: report.imageId };
  runAttempted = true;
  docker(['run', '--detach', '--rm', '--pull', 'never', '--network', 'none', '--cpus', '2', '--memory', '768m', '--pids-limit', '128',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=512m', '--name', container, '--label', `${ownershipLabel}=${ownershipToken}`,
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', report.imageId,
    'postgres', '-c', 'listen_addresses=']);
  stage = 'isolation_boundary';
  const state = JSON.parse(docker(['inspect', container]).stdout)[0];
  assert.equal(state.Config.Labels[ownershipLabel], ownershipToken);
  assert.equal(state.Config.Image, report.imageId); assert.equal(state.HostConfig.NetworkMode, 'none');
  assert.equal(state.HostConfig.Privileged, false); assert.equal(state.HostConfig.Binds?.length || 0, 0);
  assert.equal(Object.keys(state.HostConfig.PortBindings || {}).length, 0);
  assert.deepEqual(Object.keys(state.NetworkSettings.Networks), ['none']);
  stage = 'final_server_readiness'; let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logs = docker(['logs', container]);
    if (`${logs.stdout}\n${logs.stderr}`.includes('PostgreSQL init process complete; ready for start up.')
      && docker(['exec', container, 'pg_isready', '-U', 'postgres'], undefined, true).status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'final isolated PostgreSQL server did not become ready');
  report.server = json(`select jsonb_build_object('version',version(),'serverVersionNum',current_setting('server_version_num'),
    'workMem',current_setting('work_mem'),'sharedBuffers',current_setting('shared_buffers'),'jit',current_setting('jit'),
    'planCacheMode',current_setting('plan_cache_mode'),'maxParallelWorkersPerGather',current_setting('max_parallel_workers_per_gather'),
    'randomPageCost',current_setting('random_page_cost'),'seqPageCost',current_setting('seq_page_cost'),
    'timeZone',current_setting('TimeZone'),'dateStyle',current_setting('DateStyle'),'asOfDate',current_date);`);
  assert.equal(Math.floor(Number(report.server.serverVersionNum) / 10_000), 17);
  stage = 'exact_migration_boundary'; report.migrationBoundary = verifyMigrationBoundary();
  stage = 'fixture_install'; sql(fixture);
  stage = 'new_semantic_checks'; report.semantics = [];
  for (const planCacheMode of planCacheModes) {
    const result = json(`set plan_cache_mode='${planCacheMode}';select issue234_dated_diff.semantic_checks();`);
    report.semantics.push({ planCacheMode, result });
    assert.equal(result.status, 'pass');
    assert.equal(result.planCacheMode, planCacheMode);
    assert.equal(result.expectedOutcomesPass, true);
    assert.equal(result.sortedAndCounterParity, true);
    assert.equal(result.encounterOrderEqualInAllCases, true, 'candidate exact encounter order drift');
  }
  for (const config of configurations) {
    stage = `case_${config.planCacheMode}_${config.classCount}_${config.distribution}`;
    console.error(`starting ${stage}`);
    const commands = [`set plan_cache_mode='${config.planCacheMode}';`,
      `select jsonb_build_object('kind','settings','data',jsonb_build_object('planCacheMode',current_setting('plan_cache_mode'),'workMem',current_setting('work_mem'),'jit',current_setting('jit')));`,
      `select jsonb_build_object('kind','seed','data',issue234_dated_diff.seed_case(${config.classCount},'${config.distribution}'));`,
      `do $warm$ begin perform issue234_dated_diff.sample('original');perform issue234_dated_diff.sample('projection_reuse');end $warm$;`];
    const expectedSamples = [];
    for (let pair = 0; pair < repetitions; pair += 1) {
      for (const variant of pair % 2 === 0 ? variants : [...variants].reverse()) {
        expectedSamples.push({ pair, variant });
        commands.push(`select jsonb_build_object('kind','sample','pair',${pair},'variant','${variant}','data',issue234_dated_diff.sample('${variant}'));`);
      }
    }
    report.activeCase = { config, completedResults: [] };
    const results = await batch(commands.join('\n'), row => {
      report.activeCase.completedResults.push(row);
      if (row.kind === 'sample') console.error(`completed ${config.planCacheMode}/${config.classCount}/${config.distribution} pair=${row.pair + 1}/${repetitions} variant=${row.variant}`);
    });
    const actualSettings = results.filter(row => row.kind === 'settings'); assert.equal(actualSettings.length, 1);
    assert.deepEqual(actualSettings[0].data, { planCacheMode: config.planCacheMode, workMem: '4MB', jit: 'off' });
    const seed = results.filter(row => row.kind === 'seed'); assert.equal(seed.length, 1);
    const samples = results.filter(row => row.kind === 'sample');
    assert.deepEqual(samples.map(({ pair, variant }) => ({ pair, variant })), expectedSamples);
    const phaseNames = Object.keys(samples[0].data.phaseMs).sort();
    assert.deepEqual(phaseNames, ['input_fetch', 'old_prepare', 'new_prepare', 'eligibility', 'dated_diff', 'weekday_diff', 'affected_enumeration'].sort());
    for (const sample of samples) {
      assert.equal(sample.data.sqlstate, '00000');
      assert.equal(sample.data.planCacheMode, config.planCacheMode);
      assert.deepEqual(Object.keys(sample.data.phaseMs).sort(), phaseNames);
      assert.ok(Object.values(sample.data.phaseMs).every(ms => Number.isFinite(ms) && ms >= 0));
      assert.equal(typeof sample.data.output.sortedHash, 'string');
      assert.equal(typeof sample.data.output.encounterHash, 'string');
      assert.ok(Array.isArray(sample.data.output.sortedDates) && Array.isArray(sample.data.output.encounterDates));
    }
    const pairs = [];
    for (let pair = 0; pair < repetitions; pair += 1) {
      const original = samples.find(row => row.pair === pair && row.variant === 'original').data;
      const candidate = samples.find(row => row.pair === pair && row.variant === 'projection_reuse').data;
      assert.equal(candidate.output.sortedHash, original.output.sortedHash, 'affected-date result-set drift');
      assert.deepEqual(candidate.output.sortedDates, original.output.sortedDates, 'affected-date exact sorted result drift');
      assert.deepEqual(candidate.output.changedDatedDates, original.output.changedDatedDates, 'changed dated-date result drift');
      assert.deepEqual(candidate.output.changedWeekdays, original.output.changedWeekdays, 'changed weekday result drift');
      assert.deepEqual(candidate.output.encounterDates, original.output.encounterDates, 'candidate exact encounter order drift');
      assert.deepEqual(candidate.counters, original.counters, 'phase semantic row-count drift');
      pairs.push({ pair, sortedHashEqual: true, encounterHashEqual: candidate.output.encounterHash === original.output.encounterHash,
        sortedDatesEqual: true, encounterDatesEqual: isDeepStrictEqual(candidate.output.encounterDates, original.output.encounterDates),
        datedDiffDeltaMs: candidate.phaseMs.dated_diff - original.phaseMs.dated_diff,
        totalMeasuredPhaseDeltaMs: Object.values(candidate.phaseMs).reduce((sum, value) => sum + value, 0)
          - Object.values(original.phaseMs).reduce((sum, value) => sum + value, 0),
        enumerationDeltaMs: candidate.phaseMs.affected_enumeration - original.phaseMs.affected_enumeration });
    }
    const timing = Object.fromEntries(variants.map(variant => [variant, Object.fromEntries(phaseNames.map(phase => [phase,
      summarize(samples.filter(row => row.variant === variant).map(row => row.data.phaseMs[phase]))]))]));
    const totalMeasuredPhaseMs = Object.fromEntries(variants.map(variant => [variant,
      summarize(samples.filter(row => row.variant === variant).map(row => Object.values(row.data.phaseMs).reduce((sum, value) => sum + value, 0)))]));
    report.cases.push({ config, settings: actualSettings[0].data, seed: seed[0].data, samples, pairs, timing, totalMeasuredPhaseMs,
      sortedResultsEqual: true, encounterOrderEqualInAllPairs: pairs.every(pair => pair.encounterDatesEqual) });
    delete report.activeCase;
    writeFileSync(outputPath, `${JSON.stringify({ ...report, result: 'IN_PROGRESS', stage }, null, 2)}\n`);
  }
  for (const entry of sources) assert.equal(sha(bytes(entry.path)), entry.sha256, 'source changed during measurement');
  assert.equal(sha(bytes(fixturePath)), report.fixture.sha256, 'fixture changed during measurement');
  assert.equal(sha(bytes(runnerPath)), runnerHash, 'runner changed during measurement');
  report.semanticSetAndErrorAssertions = 'pass';
  report.candidateDisposition = report.cases.every(entry => entry.encounterOrderEqualInAllPairs)
    && report.semantics.every(entry => entry.result.encounterOrderEqualInAllCases)
    ? 'no_observed_order_drift' : 'order_drift';
  report.result = 'COMPLETE';
} catch (error) {
  failure = error; report.result = 'FAIL'; report.failure = { stage, reason: String(error.message).slice(0, 2000) };
  if (runAttempted) {
    try {
      const state = docker(['inspect', '--format', '{{json .State}}', container], undefined, true);
      const logs = docker(['logs', '--tail', '40', container], undefined, true);
      report.failureRuntime = { state: state.status === 0 ? JSON.parse(state.stdout) : 'unavailable',
        logs: `${logs.stdout}\n${logs.stderr}`.slice(-16_384) };
    } catch (diagnosticError) { report.failureRuntime = { unavailable: String(diagnosticError.message).slice(0, 1000) }; }
  }
} finally {
  if (runAttempted) {
    try {
      const inspected = docker(['inspect', container], undefined, true);
      if (inspected.status !== 0) {
        assert.match(inspected.stderr, /No such (?:object|container):/u, 'cleanup inspection failed with an uncertain outcome');
        report.isolation.cleanup = 'confirmed_absent';
      } else {
        const owned = JSON.parse(inspected.stdout)[0];
        assert.equal(owned.Name, `/${container}`, 'cleanup name identity mismatch');
        assert.equal(owned.Config.Image, report.imageId, 'cleanup image identity mismatch');
        assert.equal(owned.Config.Labels?.[ownershipLabel], ownershipToken, 'cleanup ownership label mismatch');
        assert.match(owned.Id, /^[a-f0-9]{64}$/u, 'cleanup container ID missing');
        // Remove only the verified task-owned ID, including a running backend
        // left behind by an interrupted docker-exec or docker-run client.
        docker(['rm', '--force', owned.Id]);
        const after = docker(['inspect', owned.Id], undefined, true);
        assert.notEqual(after.status, 0, 'owned diagnostic container still exists after cleanup');
        assert.match(after.stderr, /No such (?:object|container):/u, 'post-cleanup state is uncertain');
        report.isolation.cleanup = 'owned_container_removed_and_absence_confirmed';
      }
      report.isolation.cleanedUp = true;
    } catch (error) {
      failure ??= error; report.result = 'FAIL'; report.isolation.cleanedUp = false;
      report.isolation.cleanup = 'failed_or_uncertain';
      report.isolation.cleanupError = String(error.message).slice(0, 2000);
    }
  }
  report.finishedAt = new Date().toISOString();
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}
if (failure) throw failure;
console.log(JSON.stringify({ result: report.result, candidateDisposition: report.candidateDisposition,
  semanticSetAndErrorAssertions: report.semanticSetAndErrorAssertions, cases: report.cases.length, measuredSamples: report.cases.length * repetitions * 2,
  planRequests: 0, planExecutions: 0,
  cleanedUp: report.isolation.cleanedUp, output: outputPath }));
