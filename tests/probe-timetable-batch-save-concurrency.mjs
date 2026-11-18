import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { createAiAgentProbeRuntime } from '../scripts/lib/ai-agent-probe-runtime.mjs';
import { personalProbeRuntime, lineBefore } from './helpers/ai-personal-probe-runtime.mjs';

// The shared runtime refuses all targets except the nonce-scoped disposable
// loopback DB whose port and project match the isolated runner's local config.
// No RPC fallback, Docker pull, provider call, key or permission change exists.
if (process.argv.includes('--self-test-timeout')) {
    await createAiAgentProbeRuntime({ assert, spawn, randomUUID }).selfTestBounds();
} else {
    const runtime = await personalProbeRuntime();
    const actor = randomUUID(), teacher = randomUUID(), room = randomUUID();
    const plans = [randomUUID(), randomUUID()];
    const items = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const slots = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const requestKeys = ['batch-race-' + randomUUID(), 'batch-replay-' + randomUUID()];
    const literal = value => `'${String(value).replaceAll("'", "''")}'`;
    const json = value => `${literal(JSON.stringify(value))}::jsonb`;
    const auth = `select set_config('request.jwt.claim.sub',${literal(actor)},true);set local role authenticated;`;
    const digest = value => createHash('sha256').update(value).digest('hex');
    const evidence = [];
    let complete, cleanup;

    function item(plan, id) {
        return {
            id, planId: plan, name: 'Synthetic concurrent batch lesson', subject: '영어',
            subjectAreaKey: null, grade: '중2', capacity: 12, tuition: 100000,
            defaultTeacherId: teacher, defaultClassroomId: room, durationMinutes: 60, pendingSlots: [],
        };
    }
    function save(plan, index, revision, startMinute, endMinute) {
        return {
            operation: 'save', expectedItemRevision: revision, item: item(plan, items[index]),
            slots: [{ id: slots[index], itemId: items[index], planId: plan, weekday: 1,
                startMinute, endMinute, teacherId: teacher, classroomId: room, sourceSlotId: null }],
        };
    }
    function command(plan, version, edits, requestKey) {
        return {
            operation: 'save_batch', planId: plan, expectedMetaRevision: version.metaRevision,
            expectedChangeSequence: version.changeSequence, expectedShadowFingerprint: version.shadowFingerprint,
            requestKey, edits,
        };
    }
    async function lastJson(sql) {
        const output = await runtime.query(sql);
        return JSON.parse(output.split(/\r?\n/u).at(-1));
    }
    async function state(plan) {
        return lastJson(`select jsonb_build_object(
 'plan',(select to_jsonb(p) from public.timetable_plans p where id=${literal(plan)}),
 'items',(select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') from public.timetable_plan_items i where plan_id=${literal(plan)}),
 'slots',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.timetable_plan_slots s where plan_id=${literal(plan)}),
 'signal',(select to_jsonb(s) from public.timetable_invalidation_signals s where plan_id=${literal(plan)}),
 'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by request_key),'[]') from dashboard_private.timetable_plan_mutation_receipts r
  where actor_id=${literal(actor)} and operation='item.save_batch'));`);
    }
    async function historyHash() {
        // Comparing whole rows protects existing nonempty operational/history
        // fixtures created by the ordered-chain runner. Only a hash is emitted.
        return runtime.query(`select md5(jsonb_build_object(
 'classes',(select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from public.classes c),
 'slots',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.class_schedule_slots s),
 'sessions',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.class_lesson_sessions s),
 'students',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.students s),
 'staff',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.profiles p where id<>${literal(actor)}),
 'history',(select coalesce(jsonb_agg(to_jsonb(h) order by id),'[]') from public.student_class_enrollment_history h),
 'events',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from dashboard_private.notification_events e),
 'deliveries',(select coalesce(jsonb_agg(to_jsonb(d) order by id),'[]') from dashboard_private.notification_deliveries d),
 'operatingSignal',(select to_jsonb(s) from public.timetable_invalidation_signals s where id='operating'))::text);`);
    }
    function invoke(body) {
        // This invoker helper catches the real server failure in a subtransaction,
        // keeping the loser session alive for an explicit commit and state check.
        return `create function pg_temp.batch_outcome() returns jsonb language plpgsql as $$
declare result jsonb;
begin
 result:=public.mutate_timetable_plan_item_v1(${json(body)});
 return jsonb_build_object('sqlstate','00000','message',null,'result',result);
exception when others then
 return jsonb_build_object('sqlstate',SQLSTATE,'message',SQLERRM,'result',null);
end $$;
${auth}
select 'OUTCOME:'||pg_temp.batch_outcome()::text;\n`;
    }
    async function race(name, firstBody, secondBody, expectedState, expectedMessage) {
        const first = runtime.session(30_000), second = runtime.session(30_000);
        const deadlineAt = Date.now() + 15_000;
        try {
            first.write(`begin;set local statement_timeout='20s';${invoke(firstBody)}select 'HELD:'||pg_backend_pid();\n`);
            const blockerPid = Number((await lineBefore(first, /^HELD:([1-9][0-9]*)$/mu, deadlineAt))[1]);
            // stdout chunks need not end at a record boundary. A complete JSON
            // line is required; buffer-end alone is not a completed response.
            const original = JSON.parse((await lineBefore(first, /^OUTCOME:([^\r\n]*)\r?\n/mu, deadlineAt))[1]);
            assert.equal(original.sqlstate, '00000', 'first batch must succeed before holding its lock');
            assert.equal(original.message, null);
            second.write(`begin;set local statement_timeout='20s';select 'WRITER:'||pg_backend_pid();${invoke(secondBody)}`);
            const writerPid = Number((await lineBefore(second, /^WRITER:([1-9][0-9]*)$/mu, deadlineAt))[1]);
            assert.equal(await runtime.waitForLock(writerPid, blockerPid, { deadlineAt }), true,
                'the second actual RPC must be observed waiting on the first backend');
            first.end('commit;\n');
            runtime.requireComplete(await first.complete);
            const waited = JSON.parse((await lineBefore(second, /^OUTCOME:([^\r\n]*)\r?\n/mu, deadlineAt))[1]);
            assert.equal(waited.sqlstate, expectedState, 'waited batch exact SQLSTATE');
            assert.equal(waited.message, expectedMessage, 'waited batch exact domain message');
            second.end('commit;\n');
            runtime.requireComplete(await second.complete);
            return { name, original, waited, lockWaitObserved: true,
                blockingPidMembershipObserved: true, firstCommittedBeforeSecond: true,
                backendPairSha256: digest(`${blockerPid}:${writerPid}`) };
        } finally {
            await runtime.closeSessions(first, second);
        }
    }
    function assertTwoItemCommit(snapshot, plan, index, requestKey) {
        assert.equal(snapshot.plan.id, plan);
        assert.equal(snapshot.plan.meta_revision, 0);
        assert.equal(snapshot.plan.change_sequence, 1);
        assert.equal(snapshot.signal.change_sequence, 1);
        assert.equal(snapshot.items.length, 2, 'losing create/delete leaves no partial final set');
        assert.deepEqual(new Set(snapshot.items.map(row => row.id)), new Set(items.slice(index, index + 2)));
        assert.ok(snapshot.items.every(row => row.revision === 2));
        const byItem = new Map(snapshot.slots.map(row => [row.item_id, row]));
        assert.equal(byItem.get(items[index]).start_minute, 660);
        assert.equal(byItem.get(items[index]).end_minute, 720);
        assert.equal(byItem.get(items[index + 1]).start_minute, 600);
        assert.equal(byItem.get(items[index + 1]).end_minute, 660);
        assert.equal(snapshot.receipts.filter(row => row.request_key === requestKey).length, 1);
    }

    try {
        await runtime.query(`begin;
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values(${literal(actor)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
 ${literal(`batch-concurrency-${actor}@test.invalid`)},'{}','{}');
insert into public.profiles(id,role,name) values(${literal(actor)},'admin','Synthetic concurrent batch admin')
on conflict(id) do update set role='admin';
insert into public.teacher_catalogs(id,name,subjects)
values(${literal(teacher)},${literal(`Synthetic batch race teacher ${teacher}`)},array['영어']);
insert into public.classroom_catalogs(id,name,subjects)
values(${literal(room)},${literal(`Synthetic batch race room ${room}`)},array['영어']);
insert into public.timetable_plans(id,name,created_by) values
(${literal(plans[0])},'Synthetic different-command race',${literal(actor)}),
(${literal(plans[1])},'Synthetic identical-command replay',${literal(actor)});
${items.slice(0, 4).map((id, index) => {
            const plan = plans[Math.floor(index / 2)], start = index % 2 === 0 ? 600 : 660;
            return `insert into public.timetable_plan_items(id,plan_id,name,subject,grade,capacity,tuition,default_teacher_id,default_classroom_id,duration_minutes)
values(${literal(id)},${literal(plan)},'Synthetic concurrent batch lesson','영어','중2',12,100000,${literal(teacher)},${literal(room)},60);
insert into public.timetable_plan_slots(id,plan_id,item_id,weekday,start_minute,end_minute,teacher_catalog_id,classroom_catalog_id,teacher_name,classroom_name)
values(${literal(slots[index])},${literal(plan)},${literal(id)},1,${start},${start + 60},${literal(teacher)},${literal(room)},
${literal(`Synthetic batch race teacher ${teacher}`)},${literal(`Synthetic batch race room ${room}`)});`;
        }).join('\n')}
commit;`);
        // Catalog fixture setup legitimately updates the operating signal. The
        // draft-only invariant starts after the complete seed has committed.
        const before = await historyHash();
        const versions = await Promise.all(plans.map(plan => lastJson(`begin;${auth}
select public.get_timetable_plan_revision_v1(${literal(plan)});commit;`)));
        assert.ok(versions.every(version => version.metaRevision === 0 && version.changeSequence === 0));
        const firstBody = command(plans[0], versions[0], [save(plans[0], 0, 1, 660, 720), save(plans[0], 1, 1, 600, 660)], requestKeys[0]);
        const loserKey = 'batch-loser-' + randomUUID();
        const secondBody = command(plans[0], versions[0], [save(plans[0], 0, 1, 780, 840),
            { operation: 'delete', itemId: items[1], expectedItemRevision: 1 },
            save(plans[0], 4, null, 600, 660)], loserKey);
        const conflict = await race('same_baseline_different_commands', firstBody, secondBody, 'P0001', 'timetable_stale');
        assert.equal(conflict.waited.result, null, 'stale batch returns no commit acknowledgement');
        const committed = await state(plans[0]);
        assertTwoItemCommit(committed, plans[0], 0, requestKeys[0]);
        assert.equal(committed.receipts.some(row => row.request_key === loserKey), false, 'loser creates no receipt');
        assert.equal(await runtime.query(`select count(*) from public.timetable_plan_items where id=${literal(items[4])};`), '0',
            'losing create never commits outside its plan');
        assert.deepEqual(await state(plans[0]), committed, 'post-race reads do not change the atomic state');
        evidence.push({ name: conflict.name, lockWaitObserved: conflict.lockWaitObserved,
            blockingPidMembershipObserved: conflict.blockingPidMembershipObserved,
            firstCommittedBeforeSecond: conflict.firstCommittedBeforeSecond, backendPairSha256: conflict.backendPairSha256,
            committedBatches: 1, rejectedBatches: 1, loserSqlstate: conflict.waited.sqlstate,
            loserMessage: conflict.waited.message, partialItems: 0, changeSequence: 1, receipts: 1 });

        const replayBody = command(plans[1], versions[1], [save(plans[1], 2, 1, 660, 720), save(plans[1], 3, 1, 600, 660)], requestKeys[1]);
        const replay = await race('same_body_and_request_key', replayBody, replayBody, '00000', null);
        assert.deepEqual(replay.waited.result, replay.original.result, 'concurrent duplicate returns the exact immutable receipt');
        const replayState = await state(plans[1]);
        assertTwoItemCommit(replayState, plans[1], 2, requestKeys[1]);
        assert.equal(replayState.receipts.length, 2, 'both independent scenarios create exactly one receipt each');
        evidence.push({ name: replay.name, lockWaitObserved: replay.lockWaitObserved,
            blockingPidMembershipObserved: replay.blockingPidMembershipObserved,
            firstCommittedBeforeSecond: replay.firstCommittedBeforeSecond, backendPairSha256: replay.backendPairSha256,
            identicalReceipt: true, changeSequence: 1, perItemRevision: 2, receipts: 1 });
        assert.equal(await historyHash(), before, 'atomic draft races preserve all operational/history/no-send rows');
        complete = { status: 'passed', scenarios: 2, actualRpcCalls: 4, probes: evidence,
            noSendRowsUnchanged: true, providerCalls: 0, fixtureTarget: 'owned_disposable_loopback_database' };
    } finally {
        try {
            // Delete only this process's randomly identified synthetic fixtures;
            // the runner also destroys its entire nonce-scoped database afterward.
            await runtime.query(`begin;
delete from dashboard_private.timetable_plan_mutation_receipts where actor_id=${literal(actor)} and operation='item.save_batch';
delete from public.timetable_plans where id in(${plans.map(literal).join(',')});
delete from public.teacher_catalogs where id=${literal(teacher)};
delete from public.classroom_catalogs where id=${literal(room)};
delete from auth.users where id=${literal(actor)};
commit;
select jsonb_build_object('plans',(select count(*) from public.timetable_plans where id in(${plans.map(literal).join(',')})),
 'items',(select count(*) from public.timetable_plan_items where id in(${items.map(literal).join(',')})),
 'receipts',(select count(*) from dashboard_private.timetable_plan_mutation_receipts where actor_id=${literal(actor)}));`);
            cleanup = await lastJson(`select jsonb_build_object('plans',(select count(*) from public.timetable_plans where id in(${plans.map(literal).join(',')})),
 'items',(select count(*) from public.timetable_plan_items where id in(${items.map(literal).join(',')})),
 'receipts',(select count(*) from dashboard_private.timetable_plan_mutation_receipts where actor_id=${literal(actor)}));`);
            assert.deepEqual(cleanup, { plans: 0, items: 0, receipts: 0 });
        } finally {
            const processCleanup = await runtime.finish();
            if (complete) complete.runtimeCleanup = { ...processCleanup, syntheticFixturesRemoved: true };
        }
    }
    console.log(JSON.stringify(complete));
}
