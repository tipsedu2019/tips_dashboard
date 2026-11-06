import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Only disposable local databases. No application HTTP, provider API, remote
// connection string, production account or operating request is accepted.
const args = process.argv.slice(2);
const diagnostic = args[0] === '--diagnostic-container';
let container, nonce, expectedPort;
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
  const project = config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]{12})"/m)?.[1];
  assert.ok(project); assert.ok(config.includes(`[db]\nport = ${expectedPort}\n`));
  container = `supabase_db_${project}`;
}
assert.match(nonce || '', /^[a-f0-9]{32}$/);
const sessions = [], databases = [];
const schema = 'legacy_adoption_probe';
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const id = n => `af061106-0000-4000-8000-${String(n).padStart(12, '0')}`;
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
async function verifyBoundary() {
  const [info] = JSON.parse(await command(['inspect', container]));
  assert.equal(info.State.Running, true); assert.equal(info.HostConfig.NetworkMode === 'host', false);
  assert.ok(!(info.Mounts || []).some(m => m.Type === 'bind'), 'no host files or credentials mounted');
  if (diagnostic) {
    assert.equal(info.Config.Labels['tips.issue'], '241');
    assert.equal(info.Config.Labels['tips.purpose'], 'isolated-diagnostic');
  }
  const networks = Object.keys(info.NetworkSettings.Networks);
  assert.equal(networks.length, 1);
  const [network] = JSON.parse(await command(['network', 'inspect', networks[0]]));
  assert.equal(network.Internal, true); assert.equal(network.EnableIPv6, false);
  for (const [port, bindings] of Object.entries(info.HostConfig.PortBindings || {})) {
    if (diagnostic) assert.equal((bindings || []).length, 0, 'diagnostic has no published port');
    else for (const binding of bindings || []) {
      assert.equal(port, '5432/tcp'); assert.equal(binding.HostIp, '127.0.0.1');
      assert.equal(binding.HostPort, expectedPort);
    }
  }
  const routes = await command(['exec', container, 'cat', '/proc/net/route']);
  assert.ok(!routes.split('\n').slice(1).some(line => line.trim().split(/\s+/)[1] === '00000000'), 'no default external route');
  if (diagnostic) {
    const result = await query('template1', 'show listen_addresses;');
    assert.equal(result, '', 'diagnostic SQL is available through docker exec socket only');
  }
}
function session(database, sql, hold = false) {
  assert.match(database, /^(?:template1|tips241_adoption_[a-f0-9]{12}_[a-z]+)$/);
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

async function prepare(label) {
  const database = `tips241_adoption_${nonce.slice(0, 12)}_${label}`;
  assert.equal(await query('template1', `select count(*) from pg_database where datname=${literal(database)};`), '0', 'never reuse a database from another run');
  await query('template1', `create database ${database} template postgres;`);
  databases.push(database);
  await query(database, seed);
  return database;
}
try {
  await verifyBoundary();
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
      values('${id(30)}','approval_pending','cancel_makeup','영어','english','${id(802)}','${id(4)}','Synthetic legacy adoption','${id(1)}','${id(801)}','${id(1)}','${id(801)}','2050-10-20','2050-10-07T00:00:00Z','2050-10-07T01:00:00Z','Synthetic requested room','[{"startAt":"2050-10-07T09:00:00+09:00","endAt":"2050-10-07T10:00:00+09:00","classroom":"Synthetic requested room"}]');\n`;
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
} finally {
  for (const item of sessions) if (!item.completed && !item.child.stdin.writableEnded) item.child.stdin.end('rollback;\n');
  await Promise.all(sessions.map(item => item.done));
  for (const database of databases.reverse()) {
    await query('template1', `select pg_terminate_backend(pid) from pg_stat_activity where datname=${literal(database)} and pid<>pg_backend_pid();`);
    await query('template1', `drop database ${database};`);
  }
}
console.log(JSON.stringify({ passed: true, scenarios: 3, fixtureSha256: createHash('sha256').update(source).digest('hex'), disposableDatabasesRemoved: databases.length, productionCalls: 0, providerCalls: 0, diagnosticPlatform: diagnostic, elapsedMs: Date.now() - started }));
