import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { personalProbeRuntime, lineBefore } from './helpers/ai-personal-probe-runtime.mjs';

// Uses the canonical nonce-scoped, network-isolated runner target only.
// Basic-info input may overlap; lock serialization and request idempotency remain.
const runtime = await personalProbeRuntime();
const actor = randomUUID(), room = randomUUID();
const classes = [randomUUID(), randomUUID()], teachers = [randomUUID(), randomUUID()];
const keys = [randomUUID(), randomUUID()];
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const roomName = `Nullable race room ${room}`;
const auth = `select set_config('request.jwt.claim.sub',${quote(actor)},true);set local role authenticated;`;
const outcome = index => `
create function pg_temp.assign_room() returns jsonb language plpgsql as $f$
begin
 perform public.update_class_operational_v1(${quote(classes[index])},${json({ room: roomName })},${quote(keys[index])},null);
 return '{"sqlstate":"00000","message":null}'::jsonb;
exception when others then return jsonb_build_object('sqlstate',SQLSTATE,'message',SQLERRM);
end $f$;
${auth}
select 'OUTCOME:'||pg_temp.assign_room()::text;
`;
let result;
try {
  await runtime.query(`begin;
insert into auth.users(id,instance_id,aud,role,email) values(${quote(actor)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated',${quote(`nullable-race-${actor}@test.invalid`)});
insert into public.profiles(id,role,name) values(${quote(actor)},'admin','Synthetic nullable race')
on conflict(id) do update set role='admin';
insert into public.classroom_catalogs(id,name,subjects) values(${quote(room)},${quote(roomName)},array['영어']);
${teachers.map(id => `insert into public.teacher_catalogs(id,name,subjects) values(${quote(id)},${quote(`Nullable race teacher ${id}`)},array['영어']);`).join('\n')}
${auth}
${classes.map((id, index) => `select public.create_class_with_group_memberships_v1(${json({ id, name: `Synthetic nullable race ${index}`, subject: '영어', teacher: `Nullable race teacher ${teachers[index]}`, schedule: '수 17:00-18:00', room: '' })},'{}');`).join('\n')}
commit;`);
  const before = await runtime.query(`select md5(jsonb_build_array(
 (select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from public.classes c where id not in(${classes.map(quote)})),
 (select coalesce(jsonb_agg(to_jsonb(c)-'room'-'updated_at' order by id),'[]') from public.classes c where id in(${classes.map(quote)})),
 (select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.students s),
 (select coalesce(jsonb_agg(to_jsonb(h) order by id),'[]') from public.student_class_enrollment_history h),
 (select count(*) from dashboard_private.notification_events),
 (select count(*) from dashboard_private.notification_deliveries))::text);`);
  const first = runtime.session(30_000), second = runtime.session(30_000);
  try {
    const deadlineAt = Date.now() + 20_000;
    first.write(`begin;set local statement_timeout='20s';${outcome(0)}select 'HELD:'||pg_backend_pid();\n`);
    const firstPid = Number((await lineBefore(first, /^HELD:([1-9][0-9]*)$/mu, deadlineAt))[1]);
    assert.deepEqual(JSON.parse((await lineBefore(first, /^OUTCOME:(.*)$/mu, deadlineAt))[1]), { sqlstate: '00000', message: null });
    second.write(`begin;set local statement_timeout='20s';select 'WRITER:'||pg_backend_pid();${outcome(1)}`);
    const secondPid = Number((await lineBefore(second, /^WRITER:([1-9][0-9]*)$/mu, deadlineAt))[1]);
    assert.equal(await runtime.waitForLock(secondPid, firstPid, { deadlineAt }), true);
    first.end('commit;\n'); runtime.requireComplete(await first.complete);
    assert.deepEqual(JSON.parse((await lineBefore(second, /^OUTCOME:(.*)$/mu, deadlineAt))[1]),
      { sqlstate: '00000', message: null });
    second.end('commit;\n'); runtime.requireComplete(await second.complete);
  } finally { await runtime.closeSessions(first, second); }
  const saved = JSON.parse(await runtime.query(`select jsonb_build_object(
 'firstRoom',(select room from public.classes where id=${quote(classes[0])}),
 'secondRoom',(select room from public.classes where id=${quote(classes[1])}),
 'firstReceipt',(select count(*) from dashboard_private.class_schedule_mutation_receipts where actor_profile_id=${quote(actor)} and request_key=${quote(keys[0])}),
 'secondReceipt',(select count(*) from dashboard_private.class_schedule_mutation_receipts where actor_profile_id=${quote(actor)} and request_key=${quote(keys[1])}),
 'scopeRows',(select count(*) from dashboard_private.class_lesson_input_scopes));`));
  assert.deepEqual(saved, { firstRoom: roomName, secondRoom: roomName, firstReceipt: 1, secondReceipt: 1, scopeRows: 0 });
  for (let index=0;index<classes.length;index+=1) {
    const replay=JSON.parse(await runtime.query(`begin;set local "request.jwt.claim.sub"=${quote(actor)};set local role authenticated;
select public.update_class_operational_v1(${quote(classes[index])},${json({ room: roomName })},${quote(keys[index])},null);
commit;`));
    assert.equal(replay.classRow.id,classes[index]);
    assert.equal(replay.classRow.room,roomName);
  }
  assert.equal(await runtime.query(`select count(*) from dashboard_private.class_schedule_mutation_receipts where actor_profile_id=${quote(actor)} and request_key in(${keys.map(quote)});`),'2');
  const after = await runtime.query(`select md5(jsonb_build_array(
 (select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from public.classes c where id not in(${classes.map(quote)})),
 (select coalesce(jsonb_agg(to_jsonb(c)-'room'-'updated_at' order by id),'[]') from public.classes c where id in(${classes.map(quote)})),
 (select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.students s),
 (select coalesce(jsonb_agg(to_jsonb(h) order by id),'[]') from public.student_class_enrollment_history h),
 (select count(*) from dashboard_private.notification_events),
 (select count(*) from dashboard_private.notification_deliveries))::text);`);
  assert.equal(after, before);
  result = { status: 'passed', lockWaitObserved: true, committedAssignments: 2, rejectedAssignments: 0,
    bothSelectedRoomsPreserved: true, replayedRequests: 2, distinctReceipts: 2, partialReceipts: 0,
    targetNonRoomValuesUnchanged: true,
    unrelatedHistoryAndNoSendUnchanged: true, providerCalls: 0 };
} finally {
  // These are audited operational rows. Preserve their normal delete guards and
  // let the canonical runner destroy its entire owned disposable DB afterward.
  // This also prevents fixture cleanup from masking a failed race assertion.
  const cleanup = await runtime.finish();
  if (result) result.runtimeCleanup = { ...cleanup, fixtureCleanup: 'runner_owned_database_destruction' };
}
console.log(JSON.stringify(result));
