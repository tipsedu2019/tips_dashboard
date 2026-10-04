import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { buildRoomAvailability } from '../src/features/makeup-requests/makeup-request-model.js';
import { setTimeout as delay } from 'node:timers/promises';

// Only the disposable SQL runner's database; never connect to deployed data.
const url = new URL(process.env.TASK_LOCAL_DB_URL || 'https://invalid.invalid');
assert.equal(url.hostname, '127.0.0.1');
assert.match(process.env.TASK_LOCAL_DB_NONCE || '', /^[a-f0-9]{32}$/);
const config = await readFile('supabase/config.toml', 'utf8');
const project = config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]+)"/m)?.[1];
assert.ok(project); assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const fixture = await readFile('supabase/tests/makeup_approval_collision_candidates_test.sql', 'utf8');
const end = fixture.indexOf('create temp table before_counts');
assert.ok(end > 0);
// The wire probe uses fixture setup only; pgTAP is installed in the separate
// test transaction by the Supabase runner and is unnecessary here.
const sql = fixture.slice(0, end).replace('select no_plan();', '') + `
set local role service_role;
select jsonb_build_object('slots',pg_temp.slots(),'scoped',public.get_makeup_approval_collision_context_v1(pg_temp.slots()),
 'full',jsonb_build_object('classes',(select jsonb_agg(to_jsonb(c)) from
   (select id,name,subject,grade,teacher,room,schedule from public.classes)c),
 'requests',(select jsonb_agg(to_jsonb(r)) from
   (select id,status,class_name,makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots from public.makeup_requests
    where status in('approval_pending','manager_pending','makeup_pending','completed'))r),
 'academicEvents',(select jsonb_agg(to_jsonb(e)) from
   (select id,title,note from public.academic_events where note like '%[[TIPS_MAKEUP]]%')e)));
rollback;`;
const child = spawn('docker', ['exec', '-i', `supabase_db_${project}`, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { stdio: ['pipe', 'pipe', 'pipe'] });
const chunks = [], errors = [];
child.stdout.on('data', c => chunks.push(c)); child.stderr.on('data', c => errors.push(c));
const completed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
child.stdin.end(sql);
assert.equal(await completed, 0, Buffer.concat(errors).toString());
const wire = JSON.parse(Buffer.concat(chunks).toString().split('\n').findLast(line => line.startsWith('{')));
const collisions = context => buildRoomAvailability({ ...context, slots: wire.slots }).flatMap(room =>
  room.collisions.map(collision => `${room.name}:${collision.source}:${collision.id}`)).sort();
const before = collisions(wire.full), after = collisions(wire.scoped);
assert.ok(before.length >= 7, 'nonempty producer wire exercises classes, pending, legacy dates, and JS whitespace');
assert.deepEqual(after.filter(c => !c.includes(':regular_class:')), before.filter(c => !c.includes(':regular_class:')), 'request and calendar collision decisions are preserved');
assert.equal(wire.scoped.effectiveSchedule.version, 1);
assert.deepEqual(collisions({ ...wire.full, effectiveSchedule: wire.scoped.effectiveSchedule }), after, 'both consumers use shared effective DB class occupancy');
console.log(JSON.stringify({ status: 'passed', collisions: after.length,
  fullBytes: Buffer.byteLength(JSON.stringify(wire.full)), scopedBytes: Buffer.byteLength(JSON.stringify(wire.scoped)) }));
// Imported by the already registered collision probe, exclusively on Linux CI.
// Never run against production, an arbitrary local DB, or a reused container.
async function probeEffectiveApprovalConcurrency() {
  const url = new URL(process.env.TASK_LOCAL_DB_URL || 'https://invalid.invalid');
  assert.equal(url.hostname, '127.0.0.1');
  assert.match(process.env.TASK_LOCAL_DB_NONCE || '', /^[a-f0-9]{32}$/);
  const config = await readFile('supabase/config.toml', 'utf8');
  const project = config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]+)"/m)?.[1];
  assert.ok(project); assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
  const sessions = [];
  const quote = value => `'${String(value).replaceAll("'", "''")}'`;
  function session(sql, hold = false) {
    const child = spawn('docker', ['exec', '-i', `supabase_db_${project}`, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', 'postgres'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; });
    const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr })); });
    if (hold) child.stdin.write(sql); else child.stdin.end(sql);
    const item = { child, done, output: () => stdout }; sessions.push(item); return item;
  }
  async function query(sql) { const r = await session(sql).done; assert.equal(r.code, 0, r.stderr); return r.stdout.trim(); }
  async function until(check, label) { const end = Date.now() + 15000; while (Date.now() < end) { if (await check()) return; await delay(30); } throw new Error(label); }
  const fixtureSql = await readFile('supabase/tests/makeup_legacy_approval_occupancy_test.sql', 'utf8');
  const fixtures = JSON.parse(fixtureSql.split('$effective_approvals$')[1]);
  const id = n => `ae041004-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const first = fixtures[0];
  let serialized = JSON.stringify(first);
  for (const [from, to] of [[101,107],[201,207],[1010,1070],[1011,1071]]) serialized = serialized.replaceAll(id(from), id(to));
  const other = JSON.parse(serialized); other.n = 7; other.schedule = '금 11:00-12:00';
  fixtures.push(other);
  const auth = name => `begin; set local statement_timeout='20s'; set local application_name=${quote(name)}; set local role service_role; select set_config('request.jwt.claim.sub','${id(901)}',true); select set_config('request.jwt.claim.role','service_role',true);\n`;
  const approve = (fixture, key) => `select public.transition_makeup_request_v2('${fixture.request.id}','approve',${quote(JSON.stringify(fixture.patch))}::jsonb,'approval_pending','${id(key)}');\n`;
  const cancel = (fixture, key) => `select public.transition_makeup_request_v2('${fixture.request.id}','approval_canceled','{"note":"Synthetic race cancellation"}','completed','${id(key)}');\n`;
  const dto = output => JSON.parse(output.split('\n').find(line => line.startsWith('{')));
  let sequence = 0;
  async function race(aSql, bSql, { rollback = false, error = null } = {}) {
    const name = `effective-approval-${++sequence}`;
    const a = session(auth(`${name}-a`) + aSql + '\\echo EFFECTIVE_LOCK_HELD\n', true);
    await until(() => a.output().includes('EFFECTIVE_LOCK_HELD'), 'first approval failed to hold lock');
    const b = session(auth(`${name}-b`) + bSql + 'commit;\n');
    await until(async () => (await query(`select count(*) from pg_stat_activity where application_name='${name}-b' and wait_event_type='Lock';`)) === '1', 'second approval did not wait on lock');
    a.child.stdin.end(rollback ? 'rollback;\n' : 'commit;\n');
    const [one, two] = await Promise.all([a.done, b.done]);
    assert.equal(one.code, 0, one.stderr);
    if (error) { assert.notEqual(two.code, 0); assert.match(two.stderr, error); }
    else assert.equal(two.code, 0, two.stderr);
    return [dto(one.stdout), error ? null : dto(two.stdout)];
  }
  const owned = column => `${column}::text like 'ae041004-0000-4000-8000-%'`;
  const fixtureCountsSql = `select jsonb_build_array(
    (select count(*) from public.makeup_requests where ${owned('id')}),
    (select count(*) from public.classes where ${owned('id')}),
    (select count(*) from public.academic_events where ${owned('id')}),
    (select count(*) from public.teacher_catalogs where ${owned('id')}),
    (select count(*) from public.classroom_catalogs where ${owned('id')}),
    (select count(*) from public.profiles where id='${id(901)}'),
    (select count(*) from auth.users where id='${id(901)}'),
    (select count(*) from dashboard_private.notification_request_ledger where ${owned('request_id')}),
    (select count(*) from dashboard_private.notification_events where payload->>'makeup_request_id' like 'ae041004-0000-4000-8000-%')
  );`;
  const emptyFixtureCounts = JSON.stringify(Array(9).fill(0));
  assert.equal(JSON.stringify(JSON.parse(await query(fixtureCountsSql))), emptyFixtureCounts,
    'fixture namespace must be unused before any committed setup');
  const transientCountsSql = `select jsonb_build_array(
    (select count(*) from public.makeup_requests where ${owned('id')}),
    (select count(*) from public.academic_events where ${owned('id')}),
    (select count(*) from dashboard_private.notification_request_ledger where ${owned('request_id')}),
    (select count(*) from dashboard_private.notification_events where payload->>'makeup_request_id' like 'ae041004-0000-4000-8000-%')
  );`;
  const writerSql = "select to_json(pg_get_functiondef('dashboard_private.notification_makeup_payload_v1(uuid,uuid,text)'::regprocedure));";
  const originalWriter = JSON.parse(await query(writerSql));
  try {
    const sends = await query('select count(*) from dashboard_private.notification_deliveries;');
    const integration = await readFile('supabase/tests/makeup_legacy_approval_occupancy_test.sql', 'utf8');
    const start = integration.indexOf('-- Actual producer -> final reader');
    const end = integration.indexOf('create function pg_temp.effective_approve', start);
    assert.ok(start > 0 && end > start);
    await query(`begin; create function pg_temp.effective_approvals() returns jsonb language sql immutable as $f$ select ${quote(JSON.stringify(fixtures))}::jsonb $f$;\n${integration.slice(start, end)}\ncommit;`);
    const [approved, replay] = await race(approve(first, 2301), approve(first, 2301));
    assert.deepEqual(replay, approved, 'concurrent same-key replay returns identical DTO');
    assert.equal(await query(`select count(*) from public.makeup_request_events where request_id='${first.request.id}' and event_type='approved';`), '1');
    assert.equal(await query(`select count(*) from public.academic_events where id in('${id(1010)}','${id(1011)}');`), '2');
    const [cancelled, cancelReplay] = await race(cancel(first, 2302), cancel(first, 2302));
    assert.deepEqual(cancelReplay, cancelled);
    // Re-open only the synthetic fixture in the disposable DB; the tested RPC
    // cannot approve a cancelled request, so create a fresh pending request.
    await query(`update public.makeup_requests set status='approval_pending' where id='${first.request.id}';`);
    await race(approve(first, 2303), approve(other, 2307), { error: /23P01: makeup_room_collision/ });
    assert.equal(await query(`select status from public.makeup_requests where id='${other.request.id}';`), 'approval_pending');
    assert.equal(await query(`select schedule_plan=${quote(JSON.stringify(other.plan))}::jsonb from public.classes where id='${other.request.class_id}';`), 't');
    await query(auth('effective-release-winner') + cancel(first, 2304) + 'commit;');
    await query(`update public.makeup_requests set status='approval_pending' where id='${first.request.id}';`);
    await race(approve(first, 2401), approve(other, 2407), { rollback: true });
    assert.equal(await query(`select status from public.makeup_requests where id='${first.request.id}';`), 'approval_pending');
    assert.equal(await query(`select status from public.makeup_requests where id='${other.request.id}';`), 'completed');
    await query(auth('effective-final-cancel') + cancel(other, 2408) + 'commit;');
    assert.equal(await query(`select schedule_plan=${quote(JSON.stringify(first.plan))}::jsonb from public.classes where id='${first.request.class_id}';`), 't');
    assert.equal(await query(`select schedule_plan=${quote(JSON.stringify(other.plan))}::jsonb from public.classes where id='${other.request.class_id}';`), 't');
    assert.equal(await query('select count(*) from dashboard_private.notification_deliveries;'), sends);
    console.log(JSON.stringify({ status: 'passed', effectiveApprovalConcurrentScenarios: 4, sqlstate: '23P01', duplicateApprovalEvents: 0, providerCalls: 0 }));
  } finally {
    for (const s of sessions) if (!s.child.stdin.writableEnded) s.child.stdin.end('rollback;\n');
    await Promise.all(sessions.map(s => s.done));
    // Concurrent transactions must commit to exercise locks/replay. Remove only
    // this nonce-owned fixture's workflow rows before later probes share the
    // container, and restore the temporarily replaced writer. Keep class,
    // catalog, and principal prerequisites until container teardown: the
    // existing class DELETE audit trigger cannot reference an already-deleted
    // class. Do not disable that trigger or change its constraint for cleanup.
    await query(`begin;
      delete from dashboard_private.notification_event_fanout_jobs where event_id in
        (select id from dashboard_private.notification_events where payload->>'makeup_request_id' like 'ae041004-0000-4000-8000-%');
      delete from dashboard_private.notification_events where payload->>'makeup_request_id' like 'ae041004-0000-4000-8000-%';
      delete from dashboard_private.notification_request_ledger where ${owned('request_id')};
      delete from public.makeup_requests where ${owned('id')};
      delete from public.academic_events where ${owned('id')};
      ${originalWriter};
      commit;`);
    assert.deepEqual(JSON.parse(await query(transientCountsSql)), [0, 0, 0, 0],
      'committed workflow fixtures cannot leak into later workload/DTO probes');
    assert.equal(JSON.parse(await query(writerSql)), originalWriter, 'baseline payload writer is restored exactly');
    console.log(JSON.stringify({ status: 'passed', effectiveApprovalWorkflowCleanup: true, payloadWriterRestored: true, retainedPrerequisites: 'until disposable container teardown' }));
  }
}

await probeEffectiveApprovalConcurrency();
