// Synthetic diagnostic only. Never accepts a database URL or accesses a host DB.
// No product migration/function/permission is changed. Uses a cached local image.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const image = 'postgres:17-alpine';
const container = `tips-234-audit-${process.pid}`;
const destination = process.argv[2];
assert.ok(destination && process.argv.length === 3, 'usage: node scripts/diagnose-issue-234-audit-predecessor.mjs OUTPUT.json');
const run = (args, input) => {
  const result = spawnSync('docker', args, { cwd: root, input, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.error, undefined, 'docker execution failed');
  assert.equal(result.status, 0, result.stderr || 'docker failed');
  return result.stdout.trim();
};
const sql = (input) => run(['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], input);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourcePath = 'supabase/migrations/20260814115116_dashboard_audit_diff_format.sql';
const source = readFileSync(new URL(`../${sourcePath}`, import.meta.url), 'utf8');
const semanticsPath = 'scripts/fixtures/issue-234-audit-predecessor-semantics.sql';
const semantics = readFileSync(new URL(`../${semanticsPath}`, import.meta.url), 'utf8');
// Extract the real predecessor statement and index; do not silently test a copy
// whose predicate/index has drifted from the reviewed source.
const originalMatch = source.match(/    select \* into audit_predecessor\n([\s\S]*?order by event_sequence desc limit 1);/u);
assert.ok(originalMatch, 'predecessor statement source drift');
const originalQuery = `select *\n${originalMatch[1]}`
  .replace('public.dashboard_audit_logs', 'audit_plan.rows')
  .replace('tg_table_name', '$1').replace('audit_entity_id', '$2');
assert.equal((originalQuery.match(/entity_id is not distinct from \$2/gu) || []).length, 1);
const candidateQuery = originalQuery.replace('entity_id is not distinct from $2', 'entity_id = $2');
const nullQuery = originalQuery.replace('entity_id is not distinct from $2', 'entity_id is null');
const indexMatch = source.match(/create index if not exists dashboard_audit_logs_v2_entity_sequence_idx[\s\S]*?;/u);
assert.ok(indexMatch, 'predecessor index source drift');
const indexDDL = indexMatch[0].replace('public.dashboard_audit_logs', 'audit_plan.rows');
const report = {
  scope: 'Synthetic predecessor SELECT only; not production or full trigger/writer/RLS/concurrency validation.',
  source: { path: sourcePath, sha256: digest(source), originalQuery, candidateQuery, nullQuery, indexDDL },
  semanticFixture: { path: semanticsPath, sha256: digest(semantics) },
  isolation: { image, pull: 'never', network: 'none', publishedPorts: [], hostBinds: [], cpus: 2, memoryMiB: 768, tmpfsMiB: 512 },
  design: { rows: [20_000, 200_000], repetitions: 5, modes: ['force_custom_plan', 'force_generic_plan'], warmupPerVariant: 1,
    distribution: '80% classes /20% other table; 10% full_v1 excluded; 1000 ID buckets, one NULL, one empty, 100 collapsed to hot; all changed_at equal; unique non-null event_sequence for v2. Heap has synthetic 256-character payload.',
    timing: 'Alternating original/candidate order per pair, sequential, warm cache; milliseconds are observations, not pass thresholds.' },
  cases: [],
};
let started = false;
let failure;
let stage = 'image';
try {
  report.imageId = run(['image', 'inspect', '--format', '{{.Id}}', image]);
  run(['run', '--detach', '--rm', '--pull', 'never', '--network', 'none', '--cpus', '2', '--memory', '768m', '--pids-limit', '128',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=512m', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image]);
  started = true;
  stage = 'database_readiness';
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const probe = spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { encoding: 'utf8', timeout: 5_000 });
    if (probe.status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'isolated database not ready');
  report.server = JSON.parse(sql(`select json_build_object('version',version(),'server_version_num',current_setting('server_version_num'),
    'work_mem',current_setting('work_mem'),'shared_buffers',current_setting('shared_buffers'),
    'random_page_cost',current_setting('random_page_cost'),'seq_page_cost',current_setting('seq_page_cost'),
    'max_parallel_workers_per_gather',current_setting('max_parallel_workers_per_gather'),'jit',current_setting('jit'));`));
  assert.equal(Math.floor(Number(report.server.server_version_num) / 10_000), 17);
  stage = 'semantic_fixture';
  report.semanticFixture.output = JSON.parse(sql(semantics));
  assert.equal(report.semanticFixture.output.status, 'pass');
  stage = 'plan_schema';
  sql(`create schema audit_plan;
    create table audit_plan.rows (
      id uuid primary key, entity_table text not null, entity_id text, event_sequence bigint,
      record_format text not null, action text not null, audit_chain_id uuid, chain_ordinal bigint,
      after_hash text, changed_at timestamptz not null, synthetic_payload text);
    ${indexDDL}`);
  for (const size of report.design.rows) {
    stage = `fixture_${size}`;
    sql(`truncate audit_plan.rows;
      insert into audit_plan.rows
      select md5(g::text)::uuid, case when ((g-1)/1000)%5 < 4 then 'classes' else 'other_table' end,
        case when g%1000=0 then null when g%1000=1 then '' when g%1000 between 2 and 101 then 'hot' else 'entity-'||(g%1000)::text end,
        case when ((g-1)/1000)%10=0 then null else g end,
        case when ((g-1)/1000)%10=0 then 'full_v1' when g%2=0 then 'diff_v2' else 'full_v2' end,
        case when g%2=0 then 'UPDATE' else 'INSERT' end,md5('chain-'||(g%1000)::text)::uuid,g,md5('hash-'||g::text),timestamptz '2020-01-01 00:00:00+00',repeat(md5(g::text),8)
      from generate_series(1,${size}) g;
      vacuum analyze audit_plan.rows;`);
    const actualDistribution = JSON.parse(sql(`select json_build_object('total',count(*),'classes',count(*) filter(where entity_table='classes'),
      'v2Classes',count(*) filter(where entity_table='classes' and record_format in('full_v2','diff_v2')),
      'nullIds',count(*) filter(where entity_id is null),'emptyIds',count(*) filter(where entity_id=''),
      'hotIds',count(*) filter(where entity_id='hot'),'tableBytes',pg_relation_size('audit_plan.rows'),
      'indexBytes',pg_relation_size('audit_plan.dashboard_audit_logs_v2_entity_sequence_idx')) from audit_plan.rows;`));
    for (const mode of report.design.modes) for (const [label, literal] of [['nonnull', "'entity-500'"], ['null', 'NULL'], ['empty', "''"], ['absent', "'absent-id'"]]) {
      stage = `measure_${size}_${mode}_${label}`;
      const selectedCandidate = label === 'null' ? nullQuery : candidateQuery;
      const originalExecute = `execute original('classes',${literal})`;
      const candidateExecute = label === 'null' ? "execute candidate('classes')" : `execute candidate('classes',${literal})`;
      const lines = [`set statement_timeout='30s'; set plan_cache_mode=${mode};`,
        `prepare original(text,text) as ${originalQuery};`,
        `prepare candidate(${label === 'null' ? 'text' : 'text,text'}) as ${selectedCandidate};`,
        `do $warmup$ begin execute '${originalExecute.replaceAll("'", "''")}'; execute '${candidateExecute.replaceAll("'", "''")}'; end $warmup$;`];
      const order = [];
      for (let repeat = 0; repeat < report.design.repetitions; repeat += 1) for (const variant of repeat % 2 === 0 ? ['original','candidate'] : ['candidate','original']) {
        order.push(variant);
        lines.push(`explain (analyze,buffers,format json) ${variant === 'original' ? originalExecute : candidateExecute};`);
      }
      // Each EXPLAIN is a complete JSON array. Split only between adjacent arrays.
      const plans = sql(lines.join('\n')).split(/\n(?=\[\n)/u).map(text => JSON.parse(text)[0]);
      assert.equal(plans.length, order.length);
      const entry = { rows: size, mode, label, distribution: actualDistribution, original: [], candidate: [] };
      plans.forEach((plan, index) => entry[order[index]].push(plan));
      const indexes = (node) => [node, ...(node.Plans || []).flatMap(indexes)].filter(n => n['Index Name']);
      for (const variant of ['original', 'candidate']) {
        const plansForVariant = entry[variant];
        const first = plansForVariant[0];
        const expectedRows = label === 'absent' ? 0 : 1;
        for (const plan of plansForVariant) assert.equal(plan.Plan['Actual Rows'], expectedRows, `${label} result count`);
        // Stable structural regression, not a machine-dependent latency assertion.
        for (const plan of entry.candidate) assert.ok(indexes(plan.Plan).some(n => (n['Index Cond'] || '').includes('entity_id')), 'candidate lacks entity index condition');
        entry[variant] = { executionMs: plansForVariant.map(p => p['Execution Time']), planningMs: plansForVariant.map(p => p['Planning Time']),
          sharedHitBlocks: plansForVariant.map(p => p.Plan['Shared Hit Blocks']), sharedReadBlocks: plansForVariant.map(p => p.Plan['Shared Read Blocks']),
          firstPlan: first };
      }
      report.cases.push(entry);
      console.error(`measured rows=${size} mode=${mode} case=${label}`);
    }
  }
  report.result = 'PASS';
} catch (error) {
  failure = error;
  report.result = 'FAIL';
  report.failure = { stage, reason: 'diagnostic_execution_or_assertion_failed' };
} finally {
  if (started) {
    try { run(['stop', container]); report.isolation.cleanedUp = true; }
    catch (error) { failure ??= error; report.result = 'FAIL'; report.isolation.cleanedUp = false; }
  }
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
}
if (failure) throw failure;
console.log(JSON.stringify({ result: report.result, cases: report.cases.length, planExecutions: report.cases.length * report.design.repetitions * 2,
  semanticAssertions: report.semanticFixture.output.assertions, output: destination, cleanedUp: report.isolation.cleanedUp }));
