import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

// SQL-only integration probe; the isolated runner supplies and destroys this DB.
const url = new URL(process.env.TASK_LOCAL_DB_URL || "https://invalid.invalid");
assert.equal(url.hostname, "127.0.0.1");
assert.match(process.env.TASK_LOCAL_DB_NONCE || "", /^[a-f0-9]{32}$/);
const config = await readFile("supabase/config.toml", "utf8");
const project = config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]+)"/m)?.[1];
assert.ok(project);
assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const container = `supabase_db_${project}`;
const id = n => `99870000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin = id(1), staff = id(2);
const sqlText = value => `'${String(value).replaceAll("'", "''")}'`;
const sessions = [];

function session(sql, hold = false) {
  const child = spawn("docker", ["exec", "-i", container, "psql", "-XqAt",
    "--set", "ON_ERROR_STOP=1", "--set", "VERBOSITY=verbose", "-U", "postgres", "-d", "postgres"],
  { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
  if (hold) child.stdin.write(sql);
  else child.stdin.end(sql);
  const value = { child, done, output: () => stdout };
  sessions.push(value);
  return value;
}
async function query(sql) {
  const result = await session(sql).done;
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim();
}
function response(output) {
  const line = output.split("\n").findLast(line => line.startsWith("{"));
  assert.ok(line, `missing JSON response: ${output}`);
  return JSON.parse(line);
}
async function until(check, label) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(`checkpoint timed out: ${label}`);
}
function transaction(actor, name, role = "authenticated") {
  return `begin; set local statement_timeout='25s'; set local application_name=${sqlText(name)};
    select set_config('request.jwt.claims',${sqlText(JSON.stringify({ sub: actor, role }))},true);
    select set_config('request.jwt.claim.sub',${sqlText(actor)},true);
    select set_config('request.jwt.claim.role',${sqlText(role)},true);
    set local role ${role};\n`;
}
const previewSql = track => `select public.get_registration_management_notification_preview_v1('${track}',7);`;
function confirmSql(track, key, preview) {
  return `select public.ensure_registration_workflow_notification_v4('${track}',7,${sqlText(key)},
    'send_registration_management_notification',${sqlText(preview.previewChecksum)},${sqlText(preview.recoverySourceEventId)}::uuid);\n`;
}
function beginSql(item, key) {
  return `select public.begin_legacy_notification_dispatch_v1('registration',${sqlText(item.occurrenceKey)},
    ${sqlText(item.ruleId)}::uuid,${sqlText(item.channelKey)},${sqlText(item.targetKey)},${Number(item.targetGeneration)},
    'registration_core_legacy_bridge_v1',0,'${key}');\n`;
}
function enqueueTargetSql(fixture) {
  return `select jsonb_build_object('jobId',dashboard_private.enqueue_notification_target_reconciliation_job_v1(
    'registration','ops_task_event',${sqlText(fixture.source)},7,${sqlText(fixture.item.eventId)}::uuid,
    'recipient_set_changed',1,null,repeat('b',64)));\n`;
}
async function race(firstSql, secondSql, label) {
  const first = session(firstSql + "\\echo RECOVERY_HELD\n", true);
  await until(() => first.output().includes("RECOVERY_HELD"), `${label}: first transaction holds locks`);
  const second = session(secondSql + "commit;\n");
  await until(async () => (await query(`select count(*) from pg_stat_activity
    where application_name=${sqlText(label)} and wait_event_type='Lock';`)) === "1", `${label}: contender waits on a real database lock`);
  first.child.stdin.end("commit;\n");
  const [a, b] = await Promise.all([first.done, second.done]);
  assert.equal(a.code, 0, a.stderr);
  return [response(a.stdout), b];
}
const fixtures = [];
try {
  await query(`

-- Explicit scope ownership matches the installed production contract.
insert into dashboard_private.notification_runtime_flags(flag_key,enabled)
values('notification_control_plane_dispatch_registration_enabled',false) on conflict(flag_key) do nothing;
insert into dashboard_private.notification_cutover_owners(scope_key,workflow_key,dispatch_flag_key,owner_kind)
values('registration','registration','notification_control_plane_dispatch_registration_enabled','legacy')
on conflict(scope_key) do update set owner_kind='legacy';

    insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
    values('${admin}','authenticated','authenticated','recovery-admin@example.invalid','{}','{}'),
      ('${staff}','authenticated','authenticated','recovery-staff@example.invalid','{}','{}');
    update public.profiles set role=case when id='${admin}' then 'admin' else 'staff' end,
      name=case when id='${admin}' then '이전 관리자' else '현재 관리자' end where id in('${admin}','${staff}');
    ${[1, 2, 3, 4, 5, 6].map(n => `
    insert into public.ops_tasks(id,title,type,status,priority,requested_by,student_name)
      values('${id(100+n)}','복구 동시성 ${n}','registration','requested','normal','${admin}','합성 학생 ${n}');
    insert into public.ops_registration_details(task_id,school_grade,inquiry_at,request_note)
      values('${id(100+n)}','중2','2026-09-08 18:30+09','격리 DB 복구 검증');
    insert into public.ops_registration_subject_tracks(id,task_id,subject,pipeline_status,director_profile_id,
      director_assignment_source,director_assigned_at,migration_review_required,workflow_status,workflow_revision,
      workflow_status_entered_at,observation_return_workflow_status,observation_attempt_count)
      values('${id(110+n)}','${id(100+n)}','영어','consultation_waiting','${admin}',
      'manual',now(),false,'consultation_requested',7,now(),null,0);`).join("\n")}
    do $fixture$ declare v_rule uuid; begin
      select id into v_rule from dashboard_private.notification_rules where scope_key='global'
        and workflow_key='registration' and event_key='registration.case_created' and channel_key='google_chat'
        and audience_key='management_team' and rule_variant_key='immediate';
      if v_rule is null then
        v_rule:='${id(801)}';
        insert into dashboard_private.notification_rules(id,scope_key,workflow_key,event_key,channel_key,audience_key,
          rule_variant_key,delivery_mode,schedule_key,schedule_config,enabled,active_template_id,revision,
          created_by,created_actor_kind,updated_by,updated_actor_kind)
        values(v_rule,'global','registration','registration.case_created','google_chat','management_team',
          'immediate','immediate',null,null,true,'${id(802)}',1,null,'system',null,'system');
        insert into dashboard_private.notification_templates(id,rule_id,version,title_template,body_template,
          allowed_variables,payload_schema_version,checksum,created_by,created_actor_kind)
        values('${id(802)}',v_rule,1,'[등록] {student_name}',E'[학생] {student_name}\\n[상태] {current_status}',
          '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"current_status","token":"현재상태","pii_class":"none"}]',
          1,repeat('a',64),null,'system');
      else update dashboard_private.notification_rules set enabled=true where id=v_rule; end if;
    end $fixture$;
    insert into public.google_chat_webhook_settings(channel,webhook_url,connection_state)
      values('admin','https://chat.googleapis.com/v1/spaces/fixture/messages?key=fixture&token=fixture','legacy_active')
      on conflict(channel) do update set webhook_url=excluded.webhook_url,webhook_url_ciphertext=null,
      connection_state='legacy_active',revision=public.google_chat_webhook_settings.revision+1;
  `);
  for (let n = 1; n <= 6; n++) {
    const track = id(110+n), task = id(100+n);
    const old = response(await query(transaction(admin, `seed-${n}`) +
      `select public.ensure_registration_workflow_notification_v2('${track}',7,'${id(900+n)}','send_registration_management_notification'); commit;`));
    assert.equal(old.sourceEventIds?.length, 1);
    const source = old.sourceEventIds[0];
    const plan = response(await query(transaction(admin, `plan-${n}`, "service_role") +
      `select public.get_registration_core_legacy_dispatch_plan_v1('${source}','${admin}'); commit;`));
    assert.equal(plan.items?.length, 1);
    const immutable = await query(`select jsonb_build_object('raw',to_jsonb(s),'events',
      (select jsonb_agg(to_jsonb(e) order by e.id) from dashboard_private.notification_events e where e.source_id=s.id::text))
      from public.ops_task_events s where s.id='${source}';`);
    fixtures.push({ track, task, source, item: plan.items[0], immutable });
  }
  const targetReplayJob = response(await query(transaction(admin, "target-seed", "service_role") +
    enqueueTargetSql(fixtures[5]) + "commit;"));
  assert.match(targetReplayJob.jobId, /^[0-9a-f-]{36}$/);
  await query(`update dashboard_private.notification_rules set revision=revision+1 where scope_key='global'
    and workflow_key='registration' and event_key='registration.case_created' and channel_key='google_chat'
    and audience_key='management_team' and rule_variant_key='immediate';`);
  for (const f of fixtures) {
    f.adminPreview = response(await query(transaction(admin, "preview-admin") + previewSql(f.track) + "commit;"));
    f.staffPreview = response(await query(transaction(staff, "preview-staff") + previewSql(f.track) + "commit;"));
    assert.equal(f.staffPreview.recoveryAvailable, true);
    assert.equal(f.staffPreview.recoverySourceEventId, f.source);
    assert.equal(f.staffPreview.canSend, true);
    assert.equal(f.staffPreview.sourceActorId, staff, "recovery renders the confirming manager");
  }

  const [one, two, three, four] = fixtures;
  const [differentResult, differentLoser] = await race(
    transaction(staff, "different-a") + confirmSql(one.track, id(911), one.staffPreview),
    transaction(admin, "different-b") + confirmSql(one.track, id(912), one.adminPreview), "different-b");
  assert.equal(differentResult.recovered, true);
  assert.notEqual(differentLoser.code, 0);
  assert.match(differentLoser.stderr, /23514:/);

  const [original, replay] = await race(
    transaction(staff, "replay-a") + confirmSql(two.track, id(921), two.staffPreview),
    transaction(staff, "replay-b") + confirmSql(two.track, id(921), two.staffPreview), "replay-b");
  assert.equal(replay.code, 0, replay.stderr);
  assert.deepEqual(original, response(replay.stdout));

  const [recoveryFirst, lateClaim] = await race(
    transaction(staff, "recover-before-claim") + confirmSql(three.track, id(931), three.staffPreview),
    transaction(admin, "old-claim-b", "service_role") + beginSql(three.item, id(932)), "old-claim-b");
  assert.equal(recoveryFirst.recovered, true);
  assert.notEqual(lateClaim.code, 0);
  assert.match(lateClaim.stderr, /23514:/);

  const [claimFirst, blockedRecovery] = await race(
    transaction(admin, "claim-before-recover", "service_role") + beginSql(four.item, id(941)),
    transaction(staff, "recovery-b") + confirmSql(four.track, id(942), four.staffPreview), "recovery-b");
  assert.equal(claimFirst.acquired, true);
  assert.notEqual(blockedRecovery.code, 0);
  assert.match(blockedRecovery.stderr, /23514:/);

  // Claim the actual fanout row through its public worker RPC before recovery.
  // Moving only this fixture's due time makes the one-item worker batch bounded.
  const [five, six] = fixtures.slice(4);
  await query(`update dashboard_private.notification_event_fanout_jobs
    set next_attempt_at='1900-01-01T00:00:00Z' where event_id=${sqlText(five.item.eventId)}::uuid;`);
  const [fanoutClaim, fanoutBlockedRecovery] = await race(
    transaction(admin, "fanout-before-recover", "service_role") +
      "select public.claim_notification_fanout_jobs_v1('recovery-probe',1,60);\n",
    transaction(staff, "fanout-recovery-b") + confirmSql(five.track, id(951), five.staffPreview), "fanout-recovery-b");
  assert.equal(fanoutClaim.event_id, five.item.eventId, "the real worker claims exactly the selected old event");
  assert.notEqual(fanoutBlockedRecovery.code, 0);
  assert.match(fanoutBlockedRecovery.stderr, /23514: registration_management_notification_recovery_(?:changed|not_allowed)/);
  assert.equal(await query(`select count(*) from dashboard_private.notification_deliveries where event_id=${sqlText(five.item.eventId)}::uuid;`), "0");

  // Hold the queue row without the source advisory lock, then let the real
  // duplicate enqueue RPC reach its FOR UPDATE replay path. Recovery must still
  // acquire the source lock and finish; source->row ordering would deadlock.
  const queueOwner = session(transaction(staff, "queue-replay-recovery-a") +
    `reset role; select id from dashboard_private.notification_target_reconciliation_jobs
      where id=${sqlText(targetReplayJob.jobId)}::uuid for update;
      set local role authenticated;\n\\echo QUEUE_ROW_HELD\n`, true);
  await until(() => queueOwner.output().includes("QUEUE_ROW_HELD"), "queue replay: recovery connection holds the existing queue row");
  const queueReplay = session(transaction(admin, "queue-replay-b", "service_role") + enqueueTargetSql(six) + "commit;\n");
  await until(async () => (await query("select count(*) from pg_stat_activity where application_name='queue-replay-b' and wait_event_type='Lock';")) === "1", "queue replay: duplicate enqueue waits on the existing row");
  queueOwner.child.stdin.end(confirmSql(six.track, id(961), six.staffPreview) + "commit;\n");
  const [queueRecoveryResult, queueReplayResult] = await Promise.all([queueOwner.done, queueReplay.done]);
  assert.equal(queueRecoveryResult.code, 0, queueRecoveryResult.stderr);
  assert.equal(queueReplayResult.code, 0, queueReplayResult.stderr);
  assert.equal(response(queueRecoveryResult.stdout).recovered, true);
  assert.equal(response(queueReplayResult.stdout).jobId, targetReplayJob.jobId, "duplicate enqueue reuses the original terminal queue row");
  assert.equal(await query(`select status from dashboard_private.notification_target_reconciliation_jobs where id=${sqlText(targetReplayJob.jobId)}::uuid;`), "succeeded");

  for (let index = 0; index < fixtures.length; index++) {
    const f = fixtures[index];
    const replaced = [0, 1, 2, 5].includes(index);
    assert.equal(await query(`select jsonb_build_object('raw',to_jsonb(s),'events',
      (select jsonb_agg(to_jsonb(e) order by e.id) from dashboard_private.notification_events e where e.source_id=s.id::text))
      from public.ops_task_events s where s.id='${f.source}';`), f.immutable, "historical source snapshots stay immutable");
    assert.equal(await query(`select count(*) from public.ops_task_events where task_id='${f.task}'
      and dashboard_private.try_registration_event_jsonb_object(after_value)->>'event_type'='registration_management_notification_requested';`),
    replaced ? "2" : "1", "at most one replacement is committed");
    assert.equal(await query(`select dashboard_private.registration_management_notification_source_current_v2('${f.source}',null);`), replaced ? "f" : "t");
    if (replaced) assert.equal(await query(`select count(*) from dashboard_private.notification_dispatch_ownership_claims
      where workflow_key='registration' and occurrence_key=${sqlText(f.item.occurrenceKey)};`), "0");
  }
  assert.equal(await query(`select count(*) from dashboard_private.notification_audit_logs
    where entity_kind='notification_external_attempt' and action='external_attempt_registered';`), "0");
  console.log(JSON.stringify({ status: "passed", scenarios: 6, observedDatabaseLockWaits: 6,
    staleSqlstate: "23514", replacements: 4, concurrentReplayReceipts: 1, historicalSnapshotsPreserved: 6,
    queueClaimBlocksRecovery: true, duplicateQueueReplayDeadlocks: 0, providerCalls: 0 }));
} finally {
  for (const item of sessions) if (!item.child.stdin.writableEnded) item.child.stdin.end("rollback;\n");
  await Promise.all(sessions.map(item => item.done));
}
