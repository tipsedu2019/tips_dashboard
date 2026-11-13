// Local, synthetic whole-trigger verification. No DB URLs, host credentials,
// network, image pull, deployment, or remote services are accepted.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = process.argv[2];
assert.ok(process.argv.length === 3 && destination, 'usage: node scripts/verify-issue-234-audit-trigger.mjs OUTPUT.json');
const image = 'postgres:17-alpine';
const container = `tips-234-audit-trigger-${process.pid}-${randomBytes(4).toString('hex')}`;
const sourcePath = 'supabase/migrations/20260814115116_dashboard_audit_diff_format.sql';
const migrationPath = 'supabase/migrations/20261105073151_dashboard_audit_predecessor_index_lookup.sql';
const fixturePath = 'scripts/fixtures/issue-234-audit-trigger.sql';
const bytes = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sha = text => createHash('sha256').update(text).digest('hex');
const source = bytes(sourcePath);
const migration = bytes(migrationPath);
const fixture = bytes(fixturePath);
assert.equal(sha(source), '8fcd458950cee39866dc6be500628f79f4a9ad7a2ae45f54eefe683f79f0871d', 'original trigger migration drift');
assert.equal(sha(migration), 'a1122689f58791337fbc5319d1e5b192bfd640dd96af9367f46924d517ebf069', 'reviewed forward migration drift');
const [setup, scenarios, extra] = fixture.split('-- @section scenarios\n');
assert.ok(setup && scenarios && extra === undefined, 'fixture sections drift');
const originalFunction = source.match(/create or replace function dashboard_private\.log_dashboard_audit_event_v2\(\)[\s\S]*?\n\$\$;/u)?.[0];
assert.ok(originalFunction, 'original trigger definition missing');
const invoke = (args, input, { allowFailure = false, timeout = 120_000 } = {}) => {
  const result = spawnSync('docker', args, { cwd: root, input, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024,
    env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' } });
  assert.equal(result.error, undefined, 'docker execution failed');
  if (!allowFailure) assert.equal(result.status, 0, result.stderr || 'docker failed');
  return result;
};
const psqlArgs = ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', 'postgres'];
const sql = (query, options) => invoke(psqlArgs, query, options);
const value = query => JSON.parse(sql(query).stdout.trim());
const metadataSql = `select jsonb_build_object('bodyMd5',md5(p.prosrc),'metadata',to_jsonb(p)-'prosrc'-'prosqlbody')
 from pg_proc p where p.oid='dashboard_private.log_dashboard_audit_event_v2()'::regprocedure;`;
const claims = `set local request.jwt.claim.sub='a2340000-0000-4000-8000-000000000001';
 set local request.jwt.claims='{"sub":"a2340000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"}}';
 set local role authenticated;`;

class Session {
  constructor() {
    this.stderr = '';
    this.stdout = '';
    this.current = null;
    this.child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=0', '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', 'postgres'],
      { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' } });
    this.child.stderr.setEncoding('utf8'); this.child.stdout.setEncoding('utf8');
    this.child.stderr.on('data', chunk => { this.stderr += chunk; });
    this.child.stdout.on('data', chunk => {
      this.stdout += chunk;
      if (this.current && this.stdout.includes(`${this.current.marker}\n`)) {
        const active = this.current;
        this.current = null; clearTimeout(active.timer);
        const output = this.stdout.slice(0, this.stdout.indexOf(`${active.marker}\n`));
        this.stdout = this.stdout.slice(this.stdout.indexOf(`${active.marker}\n`) + active.marker.length + 1);
        // psql emits stderr before executing the final echo. Give both pipes
        // their event-loop delivery turn before evaluating expected SQLSTATEs.
        setImmediate(() => active.resolve({ output: output.trim(), stderr: this.stderr.slice(active.stderrStart) }));
      }
    });
    this.child.on('error', error => this.current?.reject(error));
    this.child.on('close', code => {
      if (this.current) { clearTimeout(this.current.timer); this.current.reject(new Error(`owned psql session closed:${code}`)); this.current = null; }
    });
  }
  query(query) {
    assert.equal(this.current, null, 'one query per owned session');
    return new Promise((resolve, reject) => {
      const marker = `issue234_end_${randomBytes(8).toString('hex')}`;
      const timer = setTimeout(() => { this.child.kill(); reject(new Error('owned psql query timeout')); }, 20_000);
      this.current = { marker, resolve, reject, timer, stderrStart: this.stderr.length };
      this.child.stdin.write(`${query}\n\\echo ${marker}\n`);
    });
  }
  async ok(query) { const result = await this.query(query); assert.equal(result.stderr, '', result.stderr); return result.output; }
  close() { this.child.stdin.end('rollback;\n\\q\n'); }
}

async function waitForBlock(blockedPid, blockerPid) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const observed = value(`select coalesce((select jsonb_build_object('waitType',wait_event_type,'wait',wait_event,
      'blockedByExpected',${blockerPid}=any(pg_blocking_pids(pid))) from pg_stat_activity where pid=${blockedPid}),'{}'::jsonb);`);
    if (observed.waitType === 'Lock' && observed.blockedByExpected === true) return observed;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('contender was not observed blocked on expected owner');
}

async function concurrency() {
  sql(`truncate public.classes,public.dashboard_audit_logs; alter sequence dashboard_private.dashboard_audit_event_sequence_v2 restart with 1;
    begin;${claims} insert into public.classes values('concurrent','Concurrent','{"n":0}');commit;`);
  const first = new Session(); const second = new Session();
  try {
    const firstPid = Number(await first.ok('select pg_backend_pid();'));
    const secondPid = Number(await second.ok('select pg_backend_pid();'));
    assert.ok(Number.isSafeInteger(firstPid) && Number.isSafeInteger(secondPid) && firstPid !== secondPid);
    await first.ok(`begin;${claims} update public.classes set payload='{"n":1}' where id='concurrent';`);
    const waiting = second.ok(`begin;${claims} update public.classes set payload='{"n":2}' where id='concurrent';commit;`);
    const rowWait = await waitForBlock(secondPid, firstPid);
    await first.ok('commit;'); await waiting;
    await first.ok(`begin;${claims} update public.classes set payload='{"n":999}' where id='concurrent';rollback;`);
    await second.ok(`begin;${claims} update public.classes set payload='{"n":3}' where id='concurrent';commit;`);
    const chain = value(`select jsonb_build_object('events',count(*),'chains',count(distinct audit_chain_id),
      'ordinals',jsonb_agg(chain_ordinal order by event_sequence),'sequences',jsonb_agg(event_sequence order by event_sequence),
      'linked',not exists(select 1 from public.dashboard_audit_logs c left join public.dashboard_audit_logs p on c.predecessor_event_id=p.id
       where c.chain_ordinal>1 and (p.id is null or c.before_hash is distinct from p.after_hash
        or c.predecessor_after_hash is distinct from p.after_hash or c.chain_ordinal<>p.chain_ordinal+1)),
      'finalValue',(select payload->>'n' from public.classes where id='concurrent')) from public.dashboard_audit_logs;`);
    assert.equal(chain.events, 4); assert.equal(chain.chains, 1); assert.deepEqual(chain.ordinals, [1, 2, 3, 4]);
    assert.deepEqual(chain.sequences, [1, 2, 3, 5]); assert.equal(chain.linked, true); assert.equal(chain.finalValue, '3');

    // Two equal synthetic rows have separate tuple locks but the SAME audit
    // entity. Observe advisory waiting explicitly; after one commits, the stale
    // second row must fail continuity rather than fork the chain.
    sql(`truncate public.classes,public.dashboard_audit_logs;
      alter table public.classes disable trigger dashboard_audit_classes;
      insert into public.classes values('duplicate','Equal old row','{"n":0}'),('duplicate','Equal old row','{"n":0}');
      alter table public.classes enable trigger dashboard_audit_classes;`);
    const tids = value(`select jsonb_agg(ctid::text order by ctid) from public.classes;`);
    assert.equal(tids.length, 2); assert.ok(tids.every(tid => /^\(\d+,\d+\)$/u.test(tid)));
    await first.ok(`begin;${claims} update public.classes set payload='{"n":1}' where ctid='${tids[0]}'::tid;`);
    const waitingAdvisory = second.query(`begin;${claims} update public.classes set payload='{"n":1}' where ctid='${tids[1]}'::tid;rollback;`);
    const advisoryWait = await waitForBlock(secondPid, firstPid);
    assert.equal(advisoryWait.wait, 'advisory');
    await first.ok('commit;'); const rejected = await waitingAdvisory;
    assert.match(rejected.stderr, /55000: audit_chain_continuity_invalid/u);
    const duplicate = value(`select jsonb_build_object('events',(select count(*) from public.dashboard_audit_logs),
      'oldRows',count(*) filter(where payload='{"n":0}'),'newRows',count(*) filter(where payload='{"n":1}')) from public.classes;`);
    assert.deepEqual(duplicate, { events: 1, oldRows: 1, newRows: 1 });
    return { sameRow: { rowWait, chain }, sameEntityDifferentRows: { advisoryWait, rejectedSqlstate: '55000', atomic: duplicate } };
  } finally { first.close(); second.close(); }
}

const report = {
  version: 1, scope: 'Whole original audit trigger and reviewed candidate migration in minimal synthetic PostgreSQL17 schema. Not full Supabase migration chain, production auth/RLS, operating writer, or operating data validation.',
  source: { path: sourcePath, sha256: sha(source) }, migration: { path: migrationPath, sha256: sha(migration) },
  fixture: { path: fixturePath, sha256: sha(fixture) }, runner: { path: 'scripts/verify-issue-234-audit-trigger.mjs', sha256: sha(bytes('scripts/verify-issue-234-audit-trigger.mjs')) },
  isolation: { image, pull: 'never', network: 'none', publishedPorts: [], hostBinds: [], resourceScope: 'unique task-owned disposable container', cpus: 2, memoryMiB: 768 },
  syntheticBoundaries: ['small source tables with nullable text IDs; no production FKs/business triggers', 'synthetic current_dashboard_role helper, not production authentication', 'real original migration writer role/owner/RLS/sequence/index/function/trigger DDL', 'no Supabase API/bootstrap/notification/provider connection'],
};
let started = false; let failure; let stage = 'image';
try {
  report.imageId = invoke(['image', 'inspect', '--format', '{{.Id}}', image]).stdout.trim();
  invoke(['run', '--detach', '--rm', '--pull', 'never', '--network', 'none', '--cpus', '2', '--memory', '768m', '--pids-limit', '128',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=512m', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image, 'postgres', '-c', 'listen_addresses=']);
  started = true; stage = 'boundary';
  const state = JSON.parse(invoke(['inspect', container]).stdout)[0];
  assert.equal(state.HostConfig.NetworkMode, 'none'); assert.equal(state.HostConfig.Privileged, false);
  assert.equal(state.HostConfig.Binds?.length || 0, 0); assert.equal(Object.keys(state.HostConfig.PortBindings || {}).length, 0);
  assert.deepEqual(Object.keys(state.NetworkSettings.Networks), ['none']);
  stage = 'readiness'; let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    // The image briefly runs a bootstrap server, stops it, then starts the
    // final server. pg_isready alone can accept that transient first socket.
    const logs = invoke(['logs', container], undefined, { timeout: 5_000 });
    const initialized = `${logs.stdout}\n${logs.stderr}`.includes('PostgreSQL init process complete; ready for start up.');
    if (initialized && invoke(['exec', container, 'pg_isready', '-U', 'postgres'], undefined, { allowFailure: true, timeout: 5_000 }).status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'isolated PostgreSQL not ready');
  report.server = value(`select jsonb_build_object('version',version(),'server_version_num',current_setting('server_version_num'));`);
  assert.equal(Math.floor(Number(report.server.server_version_num) / 10_000), 17);
  stage = 'original_setup'; sql(setup); sql(source); sql(scenarios);
  const originalMeta = value(metadataSql); assert.equal(originalMeta.bodyMd5, 'f7951cd0fc505c7f70adff982d8a5684');
  const immutableObjects = () => value(`select jsonb_build_object(
    'index',pg_get_indexdef('public.dashboard_audit_logs_v2_entity_sequence_idx'::regclass),
    'policies',(select jsonb_agg(to_jsonb(p) order by polname) from pg_policy p where polrelid='public.dashboard_audit_logs'::regclass),
    'sequence',(select to_jsonb(s) from pg_sequence s where seqrelid='dashboard_private.dashboard_audit_event_sequence_v2'::regclass),
    'auditRelation',(select jsonb_build_object('owner',relowner,'acl',relacl,'rls',relrowsecurity,'forceRls',relforcerowsecurity) from pg_class where oid='public.dashboard_audit_logs'::regclass),
    'triggers',(select jsonb_agg(pg_get_triggerdef(oid) order by tgname) from pg_trigger where tgfoid='dashboard_private.log_dashboard_audit_event_v2()'::regprocedure));`);
  const beforeObjects = immutableObjects();
  stage = 'original_whole_trigger'; const originalCases = value('select issue234_fixture.run_cases();');
  stage = 'original_concurrency'; report.originalConcurrency = await concurrency();

  stage = 'candidate_adoption'; sql(migration);
  const candidateMeta = value(metadataSql);
  assert.equal(candidateMeta.bodyMd5, '1a0d2be77da0876869cfa21505419988');
  assert.deepEqual(candidateMeta.metadata, originalMeta.metadata);
  assert.deepEqual(immutableObjects(), beforeObjects);
  report.adoption = { originalBodyMd5: originalMeta.bodyMd5, candidateBodyMd5: candidateMeta.bodyMd5,
    oidPreserved: true, allNonbodyPgProcMetadataPreserved: true, ownerAclSecurityDefinerSearchPathPreserved: true,
    indexPoliciesSequenceRelationAndTriggerDefinitionsPreserved: true, owner: 'dashboard_audit_writer_v2' };
  stage = 'candidate_whole_trigger'; const candidateCases = value('select issue234_fixture.run_cases();');
  assert.deepEqual(candidateCases, originalCases, 'normalized full audit traces and assertions differ');
  report.wholeTrigger = { assertionsPerVersion: candidateCases.assertions, normalizedEventsPerVersion: candidateCases.events.length,
    assertions: candidateCases.labels, normalizedTracesIdentical: true, traceSha256: sha(JSON.stringify(candidateCases.events)),
    finalSequencePerVersion: candidateCases.sequence };
  stage = 'candidate_concurrency'; report.candidateConcurrency = await concurrency();
  assert.deepEqual(report.candidateConcurrency, report.originalConcurrency);

  stage = 'migration_rejections';
  const assertRejectedUnchanged = (label, changeSql, undoSql = '') => {
    if (changeSql) sql(changeSql);
    const snapshotSql = `select coalesce((select jsonb_build_object('body',p.prosrc,'metadata',to_jsonb(p)-'prosrc'-'prosqlbody') from pg_proc p
      where p.oid=to_regprocedure('dashboard_private.log_dashboard_audit_event_v2()')),'null'::jsonb);`;
    const before = value(snapshotSql); const objects = immutableObjects();
    const rejected = sql(migration, { allowFailure: true });
    assert.equal(rejected.status, 3); assert.match(rejected.stderr, /55000: audit_predecessor_lookup_definition_drift/u);
    assert.deepEqual(value(snapshotSql), before); assert.deepEqual(immutableObjects(), objects);
    if (undoSql) sql(undoSql);
    return { label, sqlstate: '55000', atomic: true };
  };
  report.rejections = [assertRejectedUnchanged('exact reapply')];
  // Change only this synthetic function body, maintaining the old declaration.
  const drifted = originalFunction.replace('where entity_table = tg_table_name and entity_id is not distinct from audit_entity_id',
    'where entity_table = tg_table_name and entity_id = audit_entity_id');
  report.rejections.push(assertRejectedUnchanged('different predecessor anchor', drifted, originalFunction));
  report.rejections.push(assertRejectedUnchanged('unrelated body drift', originalFunction.replace('  audit_patch jsonb', '  -- synthetic drift\n  audit_patch jsonb'), originalFunction));
  // Renaming preserves trigger dependencies without CASCADE or dropping tables.
  // Immutable object snapshot must resolve the retained trigger identity by OID.
  const missingBefore = value(metadataSql);
  sql('alter function dashboard_private.log_dashboard_audit_event_v2() rename to issue234_hidden_audit_trigger;');
  const missing = sql(migration, { allowFailure: true });
  assert.equal(missing.status, 3); assert.match(missing.stderr, /55000: audit_predecessor_lookup_definition_drift/u);
  const hidden = value(`select jsonb_build_object('bodyMd5',md5(p.prosrc),'metadata',to_jsonb(p)-'prosrc'-'prosqlbody') from pg_proc p where p.oid='dashboard_private.issue234_hidden_audit_trigger()'::regprocedure;`);
  assert.equal(hidden.bodyMd5, missingBefore.bodyMd5);
  assert.deepEqual({ ...hidden.metadata, proname: missingBefore.metadata.proname }, missingBefore.metadata);
  sql('alter function dashboard_private.issue234_hidden_audit_trigger() rename to log_dashboard_audit_event_v2;');
  report.rejections.push({ label: 'missing exact function signature', sqlstate: '55000', atomic: true });
  assert.equal(sha(bytes(sourcePath)), report.source.sha256); assert.equal(sha(bytes(migrationPath)), report.migration.sha256);
  assert.equal(sha(bytes(fixturePath)), report.fixture.sha256);
  report.result = 'PASS';
} catch (error) {
  failure = error; report.result = 'FAIL'; report.failure = { stage, reason: String(error.message).slice(0, 2000) };
} finally {
  if (started) {
    try { invoke(['stop', container]); report.isolation.cleanedUp = true; }
    catch (error) { failure ??= error; report.result = 'FAIL'; report.isolation.cleanedUp = false; }
  }
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
}
if (failure) throw failure;
console.log(JSON.stringify({ result: report.result, assertionsPerVersion: report.wholeTrigger.assertionsPerVersion,
  concurrentScenariosPerVersion: 2, rejectionCases: report.rejections.length, cleanedUp: report.isolation.cleanedUp, output: destination }));
