import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lineBefore } from './ai-personal-probe-runtime.mjs';

/** Two actual connections to the caller-owned disposable DB; no URL or provider fallback. */
export async function verifyPresetLockScope(runtime) {
  const [actor,teacher,room,source,target,item,slot,unrelated]=Array.from({length:8},()=>randomUUID());
  const literal=v=>`'${String(v).replaceAll("'","''")}'`;
  const json=v=>`${literal(JSON.stringify(v))}::jsonb`;
  const auth=`select set_config('request.jwt.claim.sub',${literal(actor)},true);set local role authenticated;`;
  const request={source:{kind:'plan',planId:source},target:{kind:'plan',planId:target},mode:'copy',itemIds:[item],onConflict:'reject'};
  const opRequest={...request,target:{kind:'operational'}};
  const evidence=[];
  const lastJson=async sql=>JSON.parse((await runtime.query(sql)).split(/\r?\n/u).at(-1));
  async function checkScope(name,hold,body,shouldWait) {
    const first=runtime.session(20_000),second=runtime.session(20_000),deadlineAt=Date.now()+12_000;
    try {
      first.write(`begin;set local statement_timeout='15s';${hold}select 'HELD:'||pg_backend_pid();\n`);
      const blocker=Number((await lineBefore(first,/^HELD:([1-9][0-9]*)$/mu,deadlineAt))[1]);
      second.write(`begin;set local statement_timeout='15s';select 'WRITER:'||pg_backend_pid();${auth}${body}select 'DONE';\n`);
      const writer=Number((await lineBefore(second,/^WRITER:([1-9][0-9]*)$/mu,deadlineAt))[1]);
      if(shouldWait) {
        assert.equal(await runtime.waitForLock(writer,blocker,{deadlineAt}),true);
        first.end('rollback;\n');runtime.requireComplete(await first.complete);
        await lineBefore(second,/^DONE$/mu,deadlineAt);
      } else {
        await lineBefore(second,/^DONE$/mu,deadlineAt);
        assert.equal(await runtime.query(`select state='idle in transaction' from pg_stat_activity where pid=${blocker};`),'t','unrelated row holder is still holding its transaction when copy finishes');
        first.end('rollback;\n');runtime.requireComplete(await first.complete);
      }
      second.end('commit;\n');runtime.requireComplete(await second.complete);
      evidence.push({name,waitObserved:shouldWait,completedBeforeUnrelatedHolderReleased:!shouldWait});
    } finally {await runtime.closeSessions(first,second);}
  }
  try {
    await runtime.query(`begin;
insert into auth.users(id,instance_id,aud,role,email) values(${literal(actor)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated',${literal(actor+'@test.invalid')});
insert into public.profiles(id,role,name) values(${literal(actor)},'admin','Synthetic preset lock actor') on conflict(id) do update set role='admin';
insert into public.teacher_catalogs(id,name,subjects) values(${literal(teacher)},${literal(teacher)},array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values(${literal(room)},${literal(room)},array['영어']);
insert into public.classes(id,name,subject,status) values(${literal(unrelated)},'Synthetic unrelated class','영어','개강 준비');
insert into public.timetable_plans(id,name,created_by) values(${literal(source)},'Synthetic source',${literal(actor)}),(${literal(target)},'Synthetic target',${literal(actor)});
insert into public.timetable_plan_items(id,plan_id,name,subject) values(${literal(item)},${literal(source)},'Synthetic placement','영어');
insert into public.timetable_plan_slots(id,plan_id,item_id,weekday,start_minute,end_minute,teacher_catalog_id,classroom_catalog_id,teacher_name,classroom_name)
values(${literal(slot)},${literal(source)},${literal(item)},2,600,660,${literal(teacher)},${literal(room)},${literal(teacher)},${literal(room)});
commit;`);
    const preview=await lastJson(`begin;${auth}select public.preview_timetable_plan_transfer_v1(${json(request)});commit;`);
    const command={request,previewFingerprint:preview.fingerprint,requestKey:randomUUID()};
    await checkScope('unrelated operating row does not delay plan copy',`select id from public.classes where id=${literal(unrelated)} for update;`,
      `select public.commit_timetable_plan_transfer_v1(${json(command)});`,false);
    await checkScope('operational target retains operating row lock',`select id from public.classes where id=${literal(unrelated)} for update;`,
      `select public.preview_timetable_plan_transfer_v1(${json(opRequest)});`,true);
    await checkScope('source plan lock still serializes preview',`select id from public.timetable_plans where id=${literal(source)} for update;`,
      `select public.preview_timetable_plan_transfer_v1(${json(request)});`,true);
    await checkScope('common resource lock remains in force','select dashboard_private.lock_timetable_operating_resources_v1();',
      `select public.preview_timetable_plan_transfer_v1(${json(request)});`,true);
    assert.equal(await runtime.query(`select count(*) from public.timetable_plan_slots where plan_id=${literal(target)};`),'1');
    const replay=await lastJson(`begin;${auth}select public.commit_timetable_plan_transfer_v1(${json(command)});commit;`);
    assert.equal(replay.createdSlots.length,1);
    assert.equal(await runtime.query(`select count(*) from public.timetable_plan_slots where plan_id=${literal(target)};`),'1');
    return {status:'passed',evidence,replayedWithoutDuplicate:true,emptyClassFixtureRemovedWithDisposableDatabase:true};
  } finally {
    await runtime.query(`begin;
delete from dashboard_private.timetable_plan_mutation_receipts where actor_id=${literal(actor)};
delete from dashboard_private.timetable_plan_transfers where actor_id=${literal(actor)};
delete from public.timetable_plans where id in(${literal(source)},${literal(target)});
-- The current class DELETE audit trigger references its deleted row. Leave this
-- empty, unlinked preparing sentinel for the runner's whole disposable-DB cleanup
-- rather than disabling a trigger or modifying that unrelated production policy.
delete from public.teacher_catalogs where id=${literal(teacher)};
delete from public.classroom_catalogs where id=${literal(room)};
delete from auth.users where id=${literal(actor)};
commit;`);
    assert.equal(await runtime.query(`select count(*) from public.timetable_plans where id in(${literal(source)},${literal(target)});`),'0');
    assert.equal(await runtime.query(`select status='개강 준비' and coalesce(schedule,'')='' and not exists(select 1 from public.class_schedule_slots where class_id=${literal(unrelated)}) and not exists(select 1 from public.class_lesson_sessions where class_id=${literal(unrelated)}) from public.classes where id=${literal(unrelated)};`),'t');
  }
}
