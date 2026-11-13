import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Only disposable local databases. No application HTTP, provider API, remote
// connection string, production account or operating request is accepted.
const args = process.argv.slice(2);
if (args[0] === '--self-test-boundary') { assert.equal(args.length,1); boundaryRegression(); process.exit(0); }
const diagnostic = args[0] === '--diagnostic-container';
let container, nonce, expectedPort, project;
if (diagnostic) {
  assert.equal(args.length, 4);
  assert.equal(args[1], 'tips241-legacy-pg17-diag');
  assert.equal(args[2], '--nonce');
  container = args[1]; nonce = args[3];
} else {
  assert.equal(args.length, 0);
  const url = new URL(process.env.TASK_LOCAL_DB_URL || 'https://invalid.invalid');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/postgres');
  assert.ok(url.port); expectedPort = url.port;
  nonce = process.env.TASK_LOCAL_DB_NONCE;
  const config = await readFile('supabase/config.toml', 'utf8');
  project = config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]{12})"/m)?.[1];
  assert.ok(project); assert.ok(config.includes(`[db]\nport = ${expectedPort}\n`));
  container = `supabase_db_${project}`;
}
assert.match(nonce || '', /^[a-f0-9]{32}$/);
const sessions = [], namespaces = [];
let schema = 'legacy_adoption_probe', fixturePrefix = 'af061106-0000-4000-8000';
let fixtureClass = 'Synthetic legacy adoption', fixtureRoom = 'Synthetic requested room';
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const id = n => `${fixturePrefix}-${String(n).padStart(12, '0')}`;
const started = Date.now();

function spawnProcess(command, commandArgs, input) {
  const child = spawn(command, commandArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => stdout += chunk);
  child.stderr.on('data', chunk => stderr += chunk);
  child.stdin.on('error', () => {});
  const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  }).finally(() => clearTimeout(timer));
  const item = { child, done, output: () => stdout, completed: null };
  done.then(value => item.completed = value, error => item.completed = { code: -1, stderr: String(error) });
  if (input !== undefined) child.stdin.end(input);
  return item;
}
async function command(commandArgs) {
  const result = await spawnProcess('docker', commandArgs, '').done;
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
}
// Requested bindings can inherit a network default. Only actual publication
// must be a loopback address; concrete unpublished maps are safe for docker exec.
// This does not use or attest the runner's separate owned loopback relay.
function validateBoundary(target, info, network, routes) {
  const object = x => Boolean(x && typeof x === 'object' && !Array.isArray(x));
  const expectedNetwork = target.diagnostic ? 'tips241-legacy-pg17-diag-net' : `${target.project}_internal`;
  assert.match(info.Id || '', /^[a-f0-9]{64}$/);
  assert.equal(info.Name, `/${target.container}`); assert.equal(info.State?.Running, true);
  assert.ok(Array.isArray(info.Mounts) && !info.Mounts.some(m => m.Type === 'bind'), 'no host mounts');
  assert.match(network.Id || '', /^[a-f0-9]{64}$/); assert.equal(network.Name, expectedNetwork);
  assert.equal(network.Driver, 'bridge'); assert.equal(network.Internal, true); assert.equal(network.EnableIPv6, false);
  assert.deepEqual(Object.keys(info.NetworkSettings?.Networks || {}), [expectedNetwork]);
  assert.equal(info.NetworkSettings.Networks[expectedNetwork].NetworkID, network.Id);
  assert.ok([network.Id,expectedNetwork].includes(info.HostConfig.NetworkMode));
  assert.deepEqual(Object.keys(network.Containers || {}), [info.Id]);
  assert.equal(network.Containers[info.Id].Name, target.container);
  if (target.diagnostic) {
    for (const labels of [info.Config?.Labels, network.Labels]) {
      assert.equal(labels?.['tips.issue'], '241'); assert.equal(labels?.['tips.purpose'], 'isolated-diagnostic');
    }
  } else {
    assert.equal(network.Labels?.['tips.isolated-db-qa'], target.project);
    assert.equal(network.Options?.['com.docker.network.bridge.host_binding_ipv4'], '127.0.0.1');
  }
  const requested = info.HostConfig.PortBindings, published = info.NetworkSettings.Ports;
  assert.ok(object(requested) && object(published), 'concrete requested and published maps required');
  if (target.diagnostic) assert.deepEqual(Object.keys(requested), []);
  else {
    assert.deepEqual(Object.keys(requested), ['5432/tcp']);
    assert.ok(Array.isArray(requested['5432/tcp']) && requested['5432/tcp'].length > 0);
    for (const binding of requested['5432/tcp']) {
      assert.ok(object(binding) && ['', '127.0.0.1', '::1'].includes(binding.HostIp));
      assert.equal(binding.HostPort, target.expectedPort);
    }
  }
  assert.ok(Object.keys(published).length === 0 || Object.keys(published).join('|') === '5432/tcp');
  if (Object.hasOwn(published, '5432/tcp')) {
    const actual = published['5432/tcp'];
    assert.ok(actual === null || Array.isArray(actual), 'unknown publication is not concrete absence');
    for (const binding of actual || []) {
      assert.equal(target.diagnostic, false, 'diagnostic has no published port');
      assert.ok(object(binding) && ['127.0.0.1', '::1'].includes(binding.HostIp));
      assert.equal(binding.HostPort, target.expectedPort);
    }
  }
  const lines = String(routes).trim().split(/\r?\n/);
  assert.match(lines[0] || '', /^Iface\s+Destination\s+Gateway\s+Flags\b/); assert.ok(lines.length > 1);
  for (const line of lines.slice(1)) {
    const [iface, destination, gateway, flags] = line.trim().split(/\s+/);
    assert.ok(iface && /^[a-f0-9]{8}$/i.test(destination || '') && /^[a-f0-9]{8}$/i.test(gateway || '') && /^[a-f0-9]{4}$/i.test(flags || ''));
    assert.ok(destination !== '00000000' || !(parseInt(flags,16) & 1), 'no active external default route');
  }
}
function boundaryRegression() {
  const target = {diagnostic:false,project:'tips_supabase_db_qa_123456789abc',container:'supabase_db_tips_supabase_db_qa_123456789abc',expectedPort:'55432'};
  const dbId = 'a'.repeat(64), netId = 'b'.repeat(64), netName = `${target.project}_internal`;
  const base = {target,info:{Id:dbId,Name:`/${target.container}`,State:{Running:true},Mounts:[],HostConfig:{NetworkMode:netId,PortBindings:{'5432/tcp':[{HostIp:'',HostPort:'55432'}]}},NetworkSettings:{Networks:{[netName]:{NetworkID:netId}},Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'55432'}]}}},network:{Id:netId,Name:netName,Driver:'bridge',Internal:true,EnableIPv6:false,Labels:{'tips.isolated-db-qa':target.project},Options:{'com.docker.network.bridge.host_binding_ipv4':'127.0.0.1'},Containers:{[dbId]:{Name:target.container}}},routes:'Iface Destination Gateway Flags\neth0 000012AC 00000000 0001\n'};
  const check = v => validateBoundary(v.target,v.info,v.network,v.routes);
  const positives = [v=>{},v=>{v.info.NetworkSettings.Ports={};},v=>{v.info.NetworkSettings.Ports={'5432/tcp':null};},v=>{v.info.NetworkSettings.Ports={'5432/tcp':[]};},v=>{v.info.NetworkSettings.Ports['5432/tcp'][0].HostIp='::1';},v=>{v.info.HostConfig.PortBindings['5432/tcp'][0].HostIp='127.0.0.1';},v=>{v.info.HostConfig.Binds=['synthetic_db_volume:/var/lib/postgresql/data:rw'];v.info.Mounts=[{Type:'volume',Name:'synthetic_db_volume',Destination:'/var/lib/postgresql/data'}];}];
  for (const mutate of positives) {const v=structuredClone(base);mutate(v);assert.doesNotThrow(()=>check(v));}
  const negatives = [
    v=>{v.network.Options={};},v=>{v.network.Options['com.docker.network.bridge.host_binding_ipv4']='0.0.0.0';},
    v=>{v.network.Internal=false;},v=>{v.network.Driver='host';},v=>{v.network.EnableIPv6=true;},v=>{v.network.Labels={};},
    v=>{v.network.Id='c'.repeat(64);},v=>{v.network.Name='foreign';},v=>{v.network.Containers={};},v=>{v.info.Name='/foreign';},
    v=>{v.info.HostConfig.NetworkMode='host';},v=>{v.info.NetworkSettings.Networks.other={NetworkID:'c'.repeat(64)};},
    v=>{v.info.HostConfig.Binds=['/host:/data'];v.info.Mounts=[{Type:'bind',Source:'/host',Destination:'/data'}];},
    v=>{v.info.HostConfig.PortBindings={};},v=>{v.info.HostConfig.PortBindings['5432/tcp']=[];},
    v=>{v.info.HostConfig.PortBindings['5432/tcp'][0].HostIp='0.0.0.0';},v=>{v.info.HostConfig.PortBindings['5432/tcp'][0].HostPort='5432';},
    v=>{v.info.HostConfig.PortBindings['3000/tcp']=[];},v=>{v.info.NetworkSettings.Ports['5432/tcp'][0].HostIp='0.0.0.0';},
    v=>{v.info.NetworkSettings.Ports['5432/tcp'][0].HostIp='';},v=>{v.info.NetworkSettings.Ports['5432/tcp'][0].HostPort='5432';},
    v=>{v.info.NetworkSettings.Ports['3000/tcp']=null;},v=>{delete v.info.NetworkSettings.Ports;},v=>{v.info.NetworkSettings.Ports=null;},
    v=>{v.info.NetworkSettings.Ports={'5432/tcp':undefined};},v=>{v.info.NetworkSettings.Ports={'5432/tcp':{}};},
    v=>{v.info.NetworkSettings.Ports={'5432/tcp':[null]};},v=>{v.routes='';},v=>{v.routes+='eth0 00000000 010012AC 0003\n';}
  ];
  for (const mutate of negatives) {const v=structuredClone(base);mutate(v);assert.throws(()=>check(v));}
  console.log(JSON.stringify({boundaryRegression:true,accepted:positives.length,rejected:negatives.length,relayAttested:false}));
}
async function verifyBoundary() {
  const descriptors = JSON.parse(await command(['inspect', container])); assert.equal(descriptors.length,1);
  const info = descriptors[0];
  const names = Object.keys(info.NetworkSettings?.Networks || {}); assert.equal(names.length,1);
  const descriptorsNetwork = JSON.parse(await command(['network','inspect',names[0]])); assert.equal(descriptorsNetwork.length,1);
  const routes = await command(['exec', container, 'cat', '/proc/net/route']);
  validateBoundary({diagnostic,project,container,expectedPort},info,descriptorsNetwork[0],routes);
  if (diagnostic) assert.equal(await query('postgres','show listen_addresses;'),'', 'diagnostic SQL uses docker exec socket only');
}
function session(database, sql, hold = false) {
  assert.equal(database, 'postgres');
  const item = spawnProcess('docker', ['exec', '-i', container, 'psql', '-XqAt', '--set', 'ON_ERROR_STOP=1', '--set', 'VERBOSITY=verbose', '-U', 'postgres', '-d', database]);
  sessions.push(item);
  const preamble = "set timezone='UTC';set search_path=public,extensions;set statement_timeout='20s';\n";
  if (hold) item.child.stdin.write(preamble + sql); else item.child.stdin.end(preamble + sql);
  return item;
}
async function query(database, sql) {
  const result = await session(database, sql).done;
  assert.equal(result.code, 0, result.stderr); assert.equal(result.signal, null);
  return result.stdout.trim();
}
async function until(check, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(30);
  }
  throw Error(`checkpoint timeout: ${label}`);
}
async function held(item, marker) {
  await until(() => {
    if (item.output().includes(marker)) return true;
    if (item.completed) throw Error(`session ended before ${marker}: ${item.completed.stderr}`);
    return false;
  }, marker);
}
async function blocked(database, waiterName, holderName) {
  await until(async () => (await query(database, `select count(*) from pg_stat_activity w join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid)) where w.datname=current_database() and h.datname=current_database() and w.application_name=${literal(waiterName)} and h.application_name=${literal(holderName)} and w.wait_event_type='Lock';`)) === '1', `${waiterName} demonstrably blocked by ${holderName}`);
}
async function release(item) {
  item.child.stdin.end('commit;\n');
  const result = await item.done; assert.equal(result.code, 0, result.stderr);
}
function actor(name) {
  return `begin;set local application_name=${literal(name)};set local role service_role;select ${schema}.actor(801,'service_role');\n`;
}
const approve = key => `select ${schema}.approve(${key});\n`;
function locked(name) {
  return `begin;set local application_name=${literal(name)};select dashboard_private.lock_timetable_operating_resources_v1();\n`;
}
async function counts(database) {
  return JSON.parse(await query(database, `select jsonb_build_object('events',(select count(*) from public.makeup_request_events where request_id='${id(3)}'),'calendar',(select count(*) from public.academic_events),'deliveries',(select count(*) from dashboard_private.notification_deliveries),'status',(select status from public.makeup_requests where id='${id(3)}'),'planOriginal',(select schedule_plan=${schema}.plan() from public.classes where id='${id(4)}'));`));
}

// Extract only independent fixture definitions and setup; pgTAP assertions are
// not copied or silently skipped. Layout changes fail loudly for review.
const source = await readFile('supabase/tests/makeup_legacy_pair_adoption_test.sql', 'utf8');
const prefixStart = source.indexOf('create function pg_temp.sid(');
const prefixEnd = source.indexOf('select is(', prefixStart);
const seedStart = source.indexOf('-- Final writer integration;');
const seedEnd = source.indexOf('select pg_temp.actor(801);', seedStart);
assert.ok(prefixStart >= 0 && prefixEnd > prefixStart && seedStart > prefixEnd && seedEnd > seedStart);
let seed = source.slice(prefixStart, prefixEnd) + source.slice(seedStart, seedEnd);
seed = seed.replaceAll('pg_temp.', `${schema}.`)
  .replace('create temp table initial_request', `create table ${schema}.initial_request`)
  .replace('create temp table before_counts', `create table ${schema}.before_counts`)
  .replaceAll('from initial_request', `from ${schema}.initial_request`);
const patchStart = seed.indexOf("select set_config('test.legacy_adoption_patch',");
const patchEnd = seed.indexOf(`create function ${schema}.patch()`, patchStart);
assert.ok(patchStart > 0 && patchEnd > patchStart);
let patchSql = seed.slice(patchStart, patchEnd).trim();
assert.ok(patchSql.endsWith('::text,true);'));
patchSql = patchSql.replace("select set_config('test.legacy_adoption_patch',", `create table ${schema}.patch_data as select `).slice(0, -'::text,true);'.length) + ' as value;\n';
seed = seed.slice(0, patchStart) + patchSql + seed.slice(patchEnd);
const patchAccessor = "select current_setting('test.legacy_adoption_patch')::jsonb";
assert.equal(seed.split(patchAccessor).length, 2);
seed = seed.replace(patchAccessor, `select value from ${schema}.patch_data`);
seed = `begin;create schema ${schema};\n` + seed + `\ngrant usage on schema ${schema} to authenticated,service_role;grant execute on all functions in schema ${schema} to authenticated,service_role;grant select on all tables in schema ${schema} to authenticated,service_role;commit;\n`;
assert.ok(!/select (?:is|ok|throws_ok|lives_ok|no_plan)\(/.test(seed));

// Each case owns a fresh identity namespace in the already isolated database.
// Audit predecessors are selected by entity table/id; all writes to these
// fresh entities consistently use UTC. No shared scheduler/config is changed.
async function prepare(label) {
  assert.ok(['replay','generation','competitor'].includes(label));
  const hash = createHash('sha256').update(`${nonce}:${label}`).digest('hex');
  fixturePrefix = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}`;
  schema = `legacy_adoption_${nonce.slice(0,12)}_${label}`;
  const suffix = `${nonce.slice(0,12)} ${label}`;
  fixtureClass = `Synthetic legacy adoption ${suffix}`;
  fixtureRoom = `Synthetic requested room ${suffix}`;
  const database = 'postgres', pattern = literal(fixturePrefix + '-%');
  assert.equal(await query(database, `select count(*) from pg_namespace where nspname=${literal(schema)};`), '0');
  assert.deepEqual(JSON.parse(await query(database, `select jsonb_build_array(
    (select count(*) from public.makeup_requests where id::text like ${pattern}),
    (select count(*) from public.classes where id::text like ${pattern}),
    (select count(*) from auth.users where id::text like ${pattern}),
    (select count(*) from public.academic_events where id::text like ${pattern}),
    (select count(*) from public.teacher_catalogs where id::text like ${pattern}),
    (select count(*) from public.classroom_catalogs where id::text like ${pattern}),
    (select count(*) from dashboard_private.notification_request_ledger where request_id::text like ${pattern}));`)), Array(7).fill(0), 'never reuse another fixture namespace');
  const caseSeed = seed.replaceAll('legacy_adoption_probe',schema)
    .replaceAll('af061106-0000-4000-8000',fixturePrefix)
    .replaceAll('Synthetic legacy adoption',fixtureClass)
    .replaceAll('Synthetic requested room',fixtureRoom)
    .replaceAll('Synthetic requested teacher',`Synthetic requested teacher ${suffix}`)
    .replaceAll('legacy-adoption-',`legacy-adoption-${nonce.slice(0,12)}-${label}-`);
  namespaces.push({schema,prefix:fixturePrefix});
  await query(database, caseSeed);
  return database;
}
async function cleanupFixtures() {
  for (const owned of namespaces) {
    const pattern = literal(owned.prefix + '-%');
    await query('postgres', `begin;
      delete from dashboard_private.notification_event_fanout_jobs where event_id in
        (select id from dashboard_private.notification_events where payload->>'makeup_request_id' like ${pattern});
      delete from dashboard_private.notification_events where payload->>'makeup_request_id' like ${pattern};
      delete from dashboard_private.notification_request_ledger where request_id::text like ${pattern};
      delete from public.makeup_requests where id::text like ${pattern};
      delete from public.academic_events where id::text like ${pattern};
      delete from dashboard_private.makeup_subject_directors_v1 where profile_id::text like ${pattern};
      drop schema if exists ${owned.schema} cascade;
      commit;`);
    assert.deepEqual(JSON.parse(await query('postgres', `select jsonb_build_array(
      (select count(*) from public.makeup_requests where id::text like ${pattern}),
      (select count(*) from public.academic_events where id::text like ${pattern}),
      (select count(*) from dashboard_private.notification_request_ledger where request_id::text like ${pattern}),
      (select count(*) from dashboard_private.notification_events where payload->>'makeup_request_id' like ${pattern}),
      (select count(*) from dashboard_private.makeup_subject_directors_v1 where profile_id::text like ${pattern}));`)),[0,0,0,0,0]);
  }
  // Audited class/catalog/principal prerequisites remain until this disposable
  // container is removed, matching the existing effective-approval probe.
}
let bystander;
try {
  boundaryRegression();
  await verifyBoundary();
  bystander = session('postgres', `set application_name='adoption-bystander-${nonce.slice(0,12)}';select pg_backend_pid();\n\\echo BYSTANDER_READY\n`, true);
  await held(bystander, 'BYSTANDER_READY');
  {
    const database = await prepare('replay'), before = await counts(database);
    const first = session(database, actor('adoption-replay-first') + approve(310) + '\\echo APPROVAL_HELD\n', true);
    await held(first, 'APPROVAL_HELD');
    const second = session(database, actor('adoption-replay-second') + approve(310) + 'commit;');
    await blocked(database, 'adoption-replay-second', 'adoption-replay-first');
    await release(first);
    const secondResult = await second.done; assert.equal(secondResult.code, 0, secondResult.stderr);
    const after = await counts(database);
    assert.equal(after.status, 'completed'); assert.equal(after.events, before.events + 1);
    assert.equal(after.calendar, before.calendar + 2); assert.equal(after.deliveries, before.deliveries);
    assert.equal(await query(database, `select jsonb_array_length(schedule_plan->'sessions') from public.classes where id='${id(4)}';`), '2');
    assert.equal(await query(database, `select schedule_plan=${schema}.expected((select value from ${schema}.initial_request)) from public.classes where id='${id(4)}';`), 't');
    console.log(JSON.stringify({ scenario: 'same-key-replay-race', passed: true, observedLockWait: true, approvedEvents: 1, calendarEffects: 2, appendedRows: 0 }));
  }
  {
    const database = await prepare('generation'), before = await counts(database);
    const edit = session(database, locked('adoption-request-edit') + `update public.makeup_requests set reason='Synthetic concurrent edit' where id='${id(3)}';\n\\echo EDIT_HELD\n`, true);
    await held(edit, 'EDIT_HELD');
    const approval = session(database, actor('adoption-generation-waiter') + approve(311) + 'commit;');
    await blocked(database, 'adoption-generation-waiter', 'adoption-request-edit');
    await release(edit);
    const result = await approval.done; assert.notEqual(result.code, 0); assert.match(result.stderr, /P0001: makeup_legacy_pair_stale/);
    const after = await counts(database);
    assert.equal(after.status, 'approval_pending'); assert.equal(after.planOriginal, true);
    assert.equal(after.events, before.events); assert.equal(after.calendar, before.calendar); assert.equal(after.deliveries, before.deliveries);
    assert.equal(await query(database, `select to_jsonb(r)->>'updated_at' is distinct from (select value->>'updated_at' from ${schema}.initial_request) from public.makeup_requests r where id='${id(3)}';`), 't');
    console.log(JSON.stringify({ scenario: 'request-generation-changed-during-lock-wait', passed: true, observedLockWait: true, sqlstate: 'P0001', error: 'makeup_legacy_pair_stale', effects: 0 }));
  }
  {
    const database = await prepare('competitor'), before = await counts(database);
    const insert = `insert into public.makeup_requests(id,status,request_kind,subject,approval_group,requester_id,class_id,class_name,teacher_catalog_id,teacher_profile_id,approver_teacher_catalog_id,approver_profile_id,cancel_date,makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots)
      values('${id(30)}','approval_pending','cancel_makeup','영어','english','${id(802)}','${id(4)}',${literal(fixtureClass)},'${id(1)}','${id(801)}','${id(1)}','${id(801)}','2050-10-20','2050-10-07T00:00:00Z','2050-10-07T01:00:00Z',${literal(fixtureRoom)},${literal(JSON.stringify([{startAt:'2050-10-07T09:00:00+09:00',endAt:'2050-10-07T10:00:00+09:00',classroom:fixtureRoom}]))});\n`;
    const creator = session(database, locked('adoption-competitor-create') + insert + '\\echo COMPETITOR_HELD\n', true);
    await held(creator, 'COMPETITOR_HELD');
    const approval = session(database, actor('adoption-competitor-waiter') + approve(312) + 'commit;');
    await blocked(database, 'adoption-competitor-waiter', 'adoption-competitor-create');
    await release(creator);
    const result = await approval.done; assert.notEqual(result.code, 0); assert.match(result.stderr, /P0001: makeup_legacy_pair_invalid/);
    const after = await counts(database);
    assert.equal(after.status, 'approval_pending'); assert.equal(after.planOriginal, true);
    assert.equal(after.events, before.events); assert.equal(after.calendar, before.calendar); assert.equal(after.deliveries, before.deliveries);
    assert.equal(await query(database, `select count(*) from public.makeup_requests where id='${id(30)}' and status='approval_pending';`), '1');
    console.log(JSON.stringify({ scenario: 'competing-request-created-during-lock-wait', passed: true, observedLockWait: true, sqlstate: 'P0001', error: 'makeup_legacy_pair_invalid', effects: 0, competitorOverlapsRequestedSlot: false }));
  }
  assert.equal(await query('postgres', `select count(*) from pg_stat_activity where application_name='adoption-bystander-${nonce.slice(0,12)}' and backend_type='client backend';`),'1','ordinary source database connection remains alive throughout all races');
  console.log(JSON.stringify({scenario:'unrelated-connection-preserved',passed:true,databaseClones:0,backendTerminations:0}));
} finally {
  for (const item of sessions) if (!item.completed && !item.child.stdin.writableEnded) item.child.stdin.end('rollback;\n');
  await Promise.all(sessions.map(item => item.done));
  await cleanupFixtures();
}
console.log(JSON.stringify({ passed: true, scenarios: 3, fixtureSha256: createHash('sha256').update(source).digest('hex'), workflowNamespacesCleaned: namespaces.length, retainedPrerequisites: 'until disposable container teardown', databaseClones:0, backendTerminations:0, productionCalls: 0, providerCalls: 0, diagnosticPlatform: diagnostic, elapsedMs: Date.now() - started }));
