import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const postdeployUrl = new URL(
  "../supabase/tests/active_registration_workflow_postdeploy_readonly.sql",
  import.meta.url,
);
const automaticReminderWorkerRouteUrl = new URL(
  "../src/app/api/solapi/registration/reminders/worker/route.ts",
  import.meta.url,
);
const automaticReminderSettingsRouteUrl = new URL(
  "../src/app/api/solapi/registration/reminders/settings/route.ts",
  import.meta.url,
);
const notificationWorkerUrl = new URL(
  "../src/features/notifications/server/notification-worker.ts",
  import.meta.url,
);
const boundaryBaseline =
  "20260901111100_registration_management_notification_explicit_v2.sql";

async function migrationEntries() {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  return Promise.all(
    files.map(async (file) => ({
      file,
      sql: await readFile(new URL(file, migrationsDirectory), "utf8"),
    })),
  );
}

async function latestFunctionDefinition(qualifiedName) {
  const marker = `create or replace function ${qualifiedName}`.toLowerCase();
  let latest = null;

  for (const entry of await migrationEntries()) {
    const start = entry.sql.toLowerCase().lastIndexOf(marker);
    if (start < 0) continue;
    const end = entry.sql.indexOf("\n$$;", start);
    assert.notEqual(
      end,
      -1,
      `${entry.file} must terminate ${qualifiedName} with $$;`,
    );
    latest = {
      file: entry.file,
      definition: entry.sql.slice(start, end + 4),
    };
  }

  assert.ok(latest, `missing migration definition for ${qualifiedName}`);
  return latest;
}

function normalizeSql(sql) {
  return sql.trim().replace(/\s+/gu, " ").toLowerCase();
}

function assertExpectedFunctionRejects40001(expectedFunctions, signature) {
  const escapedSignature = signature.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const row = expectedFunctions.match(
    new RegExp(
      `\\(\\s*'[^']+'\\s*,\\s*'${escapedSignature}'::text\\s*,\\s*(true|false)\\s*,\\s*(true|false)\\s*,\\s*(true|false)\\s*\\)`,
      "iu",
    ),
  );

  assert.ok(row, `postdeploy expected_functions must include ${signature}`);
  assert.equal(
    row[3],
    "true",
    `${signature} must reject a final definition containing SQLSTATE 40001`,
  );
}

test("a final migration detaches every synchronous registration notification projection without deleting fact history", async () => {
  const finalEntries = (await migrationEntries()).filter(
    ({ file }) => file > boundaryBaseline,
  );
  const retirement = finalEntries.find(({ sql }) => [
    "registration_observation_google_chat_materializer",
    "registration_observation_google_chat_assignment_materializer",
    "capture_lightweight_registration_booking_alerts",
    "write_registration_phone_queue_event_v1",
    "capture_registration_observation_teacher_change",
    "capture_registration_director_change",
  ].every((trigger) => new RegExp(
    `drop\\s+trigger\\s+if\\s+exists\\s+${trigger}\\s+on\\s+`,
    "iu",
  ).test(sql)));

  assert.ok(
    retirement,
    "a migration after the explicit-v2 boundary must drop the synchronous observation materializer trigger",
  );

  for (const table of [
    "dashboard_private.registration_observation_domain_events",
    "public.ops_task_events",
  ]) {
    const escapedTable = table.replaceAll(".", "\\.");
    assert.doesNotMatch(
      retirement.sql,
      new RegExp(
        `\\b(?:drop\\s+table(?:\\s+if\\s+exists)?|truncate(?:\\s+table)?|delete\\s+from)\\s+${escapedTable}\\b`,
        "iu",
      ),
      `${table} history must be preserved when the synchronous trigger is detached`,
    );
  }
});

test("the final appointment-details implementation is flat, editable, and non-retryable", async () => {
  const latest = await latestFunctionDefinition(
    "dashboard_private.save_registration_appointment_details_impl(",
  );
  const normalized = normalizeSql(latest.definition);

  assert.doesNotMatch(
    latest.definition,
    /\b40001\b/u,
    `${latest.file} is still the active retryable appointment-save definition`,
  );
  assert.ok(
    latest.file > boundaryBaseline,
    "appointment-details save must be redefined by the final boundary migration",
  );
  assert.doesNotMatch(normalized, /assert_registration_track_director_ready/u);
  assert.doesNotMatch(normalized, /appointment_participants_locked/u);
  assert.doesNotMatch(normalized, /\bpipeline_status\b|\bworkflow_status\b/u);
  assert.doesNotMatch(normalized, /notification_?targets|notification_jobs/u);
  assert.match(normalized, /track\.archived_at is null/u);

  const finalMigration = (await migrationEntries()).find(
    ({ file }) => file === latest.file,
  );
  assert.ok(finalMigration);
  assert.match(
    normalizeSql(finalMigration.sql),
    /alter table public\.ops_registration_consultations alter column director_profile_id drop not null/u,
  );
});

test("the final appointment cancel implementation never manufactures SQLSTATE 40001", async () => {
  const latest = await latestFunctionDefinition(
    "dashboard_private.cancel_registration_appointment_impl(",
  );

  assert.doesNotMatch(
    latest.definition,
    /\b40001\b/u,
    `${latest.file} is still the active retryable appointment-cancel definition`,
  );
  assert.ok(
    latest.file > boundaryBaseline,
    "appointment cancel must be redefined by the final boundary migration",
  );
});

test("appointment cancel changes only the appointment and its scheduled child facts", async () => {
  const { definition } = await latestFunctionDefinition(
    "dashboard_private.cancel_registration_appointment_impl(",
  );
  const normalized = normalizeSql(definition);

  for (const table of [
    "ops_registration_appointments",
    "ops_registration_level_tests",
    "ops_registration_consultations",
  ]) {
    assert.match(
      normalized,
      new RegExp(
        `update public\\.${table}\\b[^;]*\\bstatus\\s*=\\s*'canceled'`,
        "u",
      ),
      `cancel must mark ${table} facts canceled`,
    );
  }

  assert.doesNotMatch(normalized, /transition_registration_track_status/u);
  assert.doesNotMatch(normalized, /\bpipeline_status\b/u);
  assert.doesNotMatch(normalized, /\bworkflow_status\b/u);
  assert.doesNotMatch(
    normalized,
    /update\s+public\.ops_registration_subject_tracks\b/u,
  );
  assert.doesNotMatch(
    normalized,
    /insert\s+into\s+public\.ops_registration_consultations\b/u,
    "cancel must not synthesize a replacement phone consultation",
  );
  assert.doesNotMatch(normalized, /notification_?targets/u);
  assert.doesNotMatch(normalized, /recompute_registration_parent/u);
  assert.doesNotMatch(normalized, /assert_registration_track_director_ready/u);
});

test("other active registration fact saves have no process or notification coupling", async () => {
  const expectations = [
    {
      name: "dashboard_private.save_registration_phone_consultation_v1_impl(",
      banned: /assert_registration_track_director_ready|write_registration_track_event|notification_|\bpipeline_status\b|\bworkflow_status\b/u,
    },
    {
      name: "dashboard_private.save_registration_waiting_details_v2_impl(",
      banned: /write_registration_track_event|notification_|recompute_registration_parent|transition_registration_track_status|\bworkflow_status\b/u,
    },
    {
      name: "dashboard_private.save_registration_consultation_details_impl(",
      banned: /write_registration_track_event|notification_|recompute_registration_parent|transition_registration_track_status|\bpipeline_status\b|\bworkflow_status\b/u,
    },
    {
      name: "public.save_registration_consultation_result_v2(",
      banned: /apply_student_class_roster_mode|ops_registration_enrollments|ops_registration_observations|recompute_registration_parent|transition_registration_track_status|notification_/u,
    },
    {
      name: "dashboard_private.save_registration_enrollment_details_impl(",
      banned: /recompute_registration_parent|transition_registration_track_status|notification_|\bpipeline_status\b|\bworkflow_status\b/u,
    },
    {
      name: "dashboard_private.assign_registration_track_director_impl(",
      banned: /registration_director_assignment_terminal|registration_visit_reassign_requires_reschedule|materialize_registration_phone_legacy|recompute_registration_parent|dashboard_notifications|notification_|update\s+public\.ops_registration_(?:appointments|consultations|details)|update\s+public\.ops_tasks/u,
    },
    {
      name: "dashboard_private.save_registration_level_test_result_impl(",
      banned: /write_registration_track_event|cancel_registration_appointment_reminders|notification_events|notification_deliveries|recompute_registration_parent|transition_registration_track_status|\bpipeline_status\b|\bworkflow_status\b/u,
    },
  ];

  for (const expectation of expectations) {
    const latest = await latestFunctionDefinition(expectation.name);
    assert.ok(
      latest.file > boundaryBaseline,
      `${expectation.name} must be redefined by the final boundary migration`,
    );
    assert.doesNotMatch(latest.definition, /\b40001\b/u);
    assert.doesNotMatch(normalizeSql(latest.definition), expectation.banned);
  }

  const levelResult = await latestFunctionDefinition(
    "dashboard_private.save_registration_level_test_result_impl(",
  );
  assert.match(
    normalizeSql(levelResult.definition),
    /dashboard_private\.reconcile_registration_appointment_parent_v1/u,
  );
  const appointmentReconcile = await latestFunctionDefinition(
    "dashboard_private.reconcile_registration_appointment_parent_v1(",
  );
  assert.ok(appointmentReconcile.file > boundaryBaseline);
  assert.doesNotMatch(appointmentReconcile.definition, /\b40001\b/u);
  assert.doesNotMatch(
    normalizeSql(appointmentReconcile.definition),
    /cancel_registration_appointment_reminders|notification_events|notification_deliveries|recompute_registration_parent|\bpipeline_status\b|\bworkflow_status\b/u,
  );
});

test("the explicit visit command is readiness-fenced, source-current, and replayable", async () => {
  const ensure = await latestFunctionDefinition(
    "public.ensure_registration_visit_notification_v1(",
  );
  const sourceCurrent = await latestFunctionDefinition(
    "dashboard_private.registration_visit_notification_source_current_v1(",
  );
  const eventWriter = await latestFunctionDefinition(
    "dashboard_private.write_registration_track_event_v2(",
  );
  const normalized = normalizeSql(ensure.definition);

  assert.ok(ensure.file > boundaryBaseline);
  assert.doesNotMatch(ensure.definition, /\b40001\b/u);
  assert.match(normalized, /p_intent is distinct from 'send_registration_visit_notification'/u);
  assert.match(normalized, /registration_visit_notification_not_ready[^;]*23514/u);
  assert.match(normalized, /notification_request_ledger/u);
  assert.match(normalized, /registration_visit_notification_source_current_v1/u);
  assert.match(normalized, /write_registration_track_event_v2/u);
  assert.match(normalized, /track\.archived_at is null/u);
  assert.doesNotMatch(normalized, /net\.http_|register_notification_external_attempt|notification_deliveries/u);
  assert.ok(
    normalized.indexOf("select ledger.*")
      < normalized.indexOf("registration_visit_notification_refresh_required"),
    "successful command replay must be checked before the optimistic revision conflict",
  );

  assert.doesNotMatch(sourceCurrent.definition, /\b40001\b/u);
  assert.match(normalizeSql(sourceCurrent.definition), /notification_events/u);
  assert.match(normalizeSql(sourceCurrent.definition), /recipient_revision/u);
  assert.match(normalizeSql(sourceCurrent.definition), /director_profile_ids/u);
  assert.doesNotMatch(eventWriter.definition, /\b40001\b/u);
  assert.match(
    normalizeSql(eventWriter.definition),
    /write_registration_track_event_v2_base/u,
  );
  const finalMigration = (await migrationEntries()).find(
    ({ file }) => file === eventWriter.file,
  );
  assert.ok(finalMigration);
  assert.match(normalizeSql(finalMigration.sql), /quote_literal\('23514'\)/u);
  assert.match(normalizeSql(finalMigration.sql), /rename to write_registration_track_event_v2_base/u);

  const dispatchPlan = await latestFunctionDefinition(
    "public.get_registration_visit_legacy_dispatch_plan_v1(",
  );
  const normalizedPlan = normalizeSql(dispatchPlan.definition);
  assert.match(normalizedPlan, /v_actor_id uuid := \(select auth\.uid\(\)\)/u);
  assert.match(normalizedPlan, /p_actor_profile_id is distinct from v_actor_id/u);
  assert.match(normalizedPlan, /registration_access_denied[^;]*42501/u);
});

test("automatic customer reminder producers are retired without touching explicit preview and send APIs", async () => {
  const automaticFunctions = [
    ["dashboard_private.materialize_registration_observation_solapi_events_v1(", /return 0/u],
    ["dashboard_private.sync_registration_customer_reminder_jobs_v1(", /return 0/u],
    ["public.claim_registration_customer_reminder_job_v1(", /return null/u],
    ["public.has_registration_customer_reminder_backlog_v1(", /return false/u],
    ["public.continue_registration_customer_reminder_worker_v1(", /return null/u],
    ["dashboard_private.invoke_registration_customer_reminder_worker_v1(", /select null::bigint/u],
  ];
  for (const [name, expected] of automaticFunctions) {
    const latest = await latestFunctionDefinition(name);
    const normalized = normalizeSql(latest.definition);
    assert.ok(latest.file > boundaryBaseline, `${name} must be retired in the final migration`);
    assert.match(normalized, expected);
    assert.doesNotMatch(normalized, /\b40001\b|net\.http_|(?:insert\s+into|update|delete\s+from|from)\s+(?:dashboard_private\.registration_customer_reminder_jobs|dashboard_private\.registration_observation_solapi_event_consumptions|public\.ops_registration_customer_messages)/u);
  }

  const finalMigration = (await migrationEntries()).find(
    ({ file }) => file === "20260901111200_registration_flat_fact_runtime_finalization.sql",
  );
  assert.ok(finalMigration);
  const normalizedMigration = normalizeSql(finalMigration.sql);
  assert.match(normalizedMigration, /where job\.jobname = 'tips-registration-customer-reminder-v1'[^;]*cron\.unschedule/u);
  assert.match(normalizedMigration, /set enabled = false/u);
  assert.match(normalizedMigration, /where job\.status in \('pending', 'claimed'\)/u);
  assert.match(normalizedMigration, /registration_customer_reminder_schedule_retired[^;]*55000/u);
  for (const [name, expected] of [
    ["dashboard_private.enqueue_lightweight_registration_alerts_v1(", /select 0/u],
    ["public.enqueue_lightweight_registration_booking_alerts_v1(", /return 0/u],
    ["public.enqueue_due_lightweight_registration_reminders_v1(", /'status', 'explicit_only'/u],
    ["public.manage_lightweight_registration_alert_schedule_v1(", /lightweight_registration_alert_schedule_retired[^;]*55000/u],
  ]) {
    const latest = await latestFunctionDefinition(name);
    const normalized = normalizeSql(latest.definition);
    assert.ok(latest.file > boundaryBaseline);
    assert.match(normalized, expected);
    assert.doesNotMatch(normalized, /\b40001\b|net\.http_|insert\s+into\s+dashboard_private\.lightweight_registration_alert_(?:states|deliveries)/u);
  }
  const settings = await latestFunctionDefinition(
    "public.set_registration_customer_reminder_settings_v1(",
  );
  assert.doesNotMatch(settings.definition, /\b40001\b/u);
  assert.match(normalizeSql(settings.definition), /p_enabled is distinct from false/u);
  assert.match(
    normalizeSql(settings.definition),
    /registration_customer_reminder_automatic_delivery_retired[^;]*55000/u,
  );
  assert.match(normalizedMigration, /where job\.jobname = 'tips-lightweight-registration-reminder-v1'[^;]*cron\.unschedule/u);
  assert.match(normalizedMigration, /lightweight_registration_alert_runtime_settings settings set enabled = false/u);
  assert.match(normalizedMigration, /lightweight_registration_alert_deliveries delivery set status = 'failed_hold'/u);
  const observationChatClaim = await latestFunctionDefinition(
    "public.claim_registration_observation_chat_jobs_v1(",
  );
  const observationChatMaterialize = await latestFunctionDefinition(
    "public.materialize_registration_observation_chat_job_v1(",
  );
  assert.doesNotMatch(observationChatClaim.definition, /\b40001\b|(?:from|update|insert\s+into)\s+dashboard_private\.(?:registration_observation_chat_jobs|notification_events)/u);
  assert.match(normalizeSql(observationChatClaim.definition), /return; end/u);
  assert.doesNotMatch(observationChatMaterialize.definition, /\b40001\b|(?:from|update|insert\s+into)\s+dashboard_private\.(?:registration_observation_chat_jobs|notification_events)/u);
  assert.match(
    normalizeSql(observationChatMaterialize.definition),
    /registration_observation_chat_automatic_materialization_retired[^;]*55000/u,
  );
  assert.match(
    normalizedMigration,
    /registration_observation_chat_jobs job set status = 'canceled'[^;]*last_error_code = 'explicit_action_required'/u,
  );
  assert.doesNotMatch(
    normalizedMigration,
    /(?:drop|alter)\s+function\s+public\.(?:create_registration_customer_message_preview_v1|confirm_registration_customer_message_v1)/u,
  );
});

test("production HTTP and generic worker boundaries cannot revive retired registration automation", async () => {
  const [workerRoute, settingsRoute, notificationWorker] = await Promise.all([
    readFile(automaticReminderWorkerRouteUrl, "utf8"),
    readFile(automaticReminderSettingsRouteUrl, "utf8"),
    readFile(notificationWorkerUrl, "utf8"),
  ]);

  for (const route of [workerRoute, settingsRoute]) {
    assert.match(route, /registration_customer_reminder_automatic_delivery_retired/u);
    assert.match(route, /status:\s*410/u);
    assert.doesNotMatch(route, /createProductionRegistrationCustomerReminderRouteHandlers/u);
  }
  assert.match(
    notificationWorker,
    /workflowKey === "registration" \? null : getAdapter\(workflowKey\)/u,
  );
  assert.match(
    notificationWorker,
    /name === "reap_registration_observation_chat_job_leases_v1"[\s\S]*?reaped_count:\s*0,[\s\S]*?failed_count:\s*0/u,
  );
  assert.match(
    notificationWorker,
    /name === "claim_registration_observation_chat_jobs_v1"\) return \[\]/u,
  );
});

test("postdeploy watches the detached materializer boundary and both final appointment definitions", async () => {
  const postdeploy = await readFile(postdeployUrl, "utf8");
  const normalized = normalizeSql(postdeploy);
  const expectedFunctionsMatch = normalized.match(
    /with expected_functions\([^)]+\) as \( values ([\s\S]*?) \), functions as \(/u,
  );
  assert.ok(
    expectedFunctionsMatch,
    "postdeploy expected_functions inventory must remain statically readable",
  );
  const expectedFunctions = expectedFunctionsMatch[1];

  assertExpectedFunctionRejects40001(
    expectedFunctions,
    "dashboard_private.save_registration_appointment_details_impl(uuid,uuid,text,timestamp with time zone,text,uuid[],integer,text)",
  );
  assertExpectedFunctionRejects40001(
    expectedFunctions,
    "dashboard_private.cancel_registration_appointment_impl(uuid,integer,text,text)",
  );

  for (const signature of [
    "dashboard_private.cancel_registration_appointment_with_reminders_v1_impl(uuid,integer,text,text)",
    "dashboard_private.save_registration_phone_consultation_v1_impl(uuid,text)",
    "dashboard_private.save_registration_waiting_details_v2_impl(uuid,text,uuid,text,text)",
    "dashboard_private.save_registration_consultation_details_impl(uuid,text,text,text,text)",
    "public.save_registration_consultation_result_v2(uuid,text,text,text,uuid,integer,text)",
    "dashboard_private.save_registration_enrollment_details_impl(uuid,jsonb,text)",
    "dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)",
    "dashboard_private.assign_registration_track_director_impl(uuid,uuid,text,text,integer,text)",
    "dashboard_private.reconcile_registration_appointment_parent_v1(uuid)",
    "dashboard_private.save_registration_level_test_result_impl(uuid,text,text,text)",
    "dashboard_private.write_registration_track_event_v2(uuid,uuid,text,text,text,text,jsonb,text,text)",
    "public.ensure_registration_visit_notification_v1(uuid,integer,text,text)",
    "public.get_registration_visit_legacy_dispatch_plan_v1(uuid,uuid)",
  ]) {
    assertExpectedFunctionRejects40001(expectedFunctions, signature);
  }

  const materializerFunctionCovered = expectedFunctions.includes(
    "dashboard_private.materialize_registration_observation_chat_from_domain_event_v1()",
  );
  const triggerNames = [
    "registration_observation_google_chat_materializer",
    "registration_observation_google_chat_assignment_materializer",
    "capture_lightweight_registration_booking_alerts",
    "write_registration_phone_queue_event_v1",
    "capture_registration_observation_teacher_change",
    "capture_registration_director_change",
  ];
  const triggerAbsenceCovered = triggerNames.every((triggerName) => {
    const triggerIndex = normalized.indexOf(triggerName);
    const triggerWindow = triggerIndex < 0
      ? ""
      : normalized.slice(Math.max(0, triggerIndex - 700), triggerIndex + 700);
    return triggerWindow.includes("pg_catalog.pg_trigger")
      && /not exists|count\s*\(\s*\*\s*\)\s*=\s*0|is null/u.test(triggerWindow);
  });

  assert.ok(
    materializerFunctionCovered || triggerAbsenceCovered,
    "postdeploy must cover the materializer final definition or prove its trigger is absent",
  );
});
