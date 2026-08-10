import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const migrationPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260809101000_registration_observation_reads.sql",
);
const reviewFixMigrationPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260809102400_registration_observation_core_review_fixes.sql",
);
const reviewFollowupMigrationPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260809102450_registration_observation_core_review_followup.sql",
);
const pgTapPath = path.join(
  repositoryRoot,
  "supabase/tests/registration_observation_schema_test.sql",
);

async function readMigration() {
  return readFile(migrationPath, "utf8");
}

async function readReviewFixMigration() {
  return readFile(reviewFixMigrationPath, "utf8");
}

async function readReviewFollowupMigration() {
  return readFile(reviewFollowupMigrationPath, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function functionDefinition(sql, qualifiedName) {
  const escapedName = escapeRegExp(qualifiedName);
  const match = sql.match(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+${escapedName}\\s*\\([\\s\\S]*?\\$\\$;`,
      "i",
    ),
  );
  assert.ok(match, `missing function definition: ${qualifiedName}`);
  return match[0];
}

test("read migration is transactional, forward-only, and provider inert", async () => {
  const sql = await readMigration();
  assert.match(sql, /^begin;\s+set local lock_timeout = '5s';/i);
  assert.match(sql, /set local statement_timeout = '120s';/i);
  assert.match(sql, /commit;\s*$/i);
  assert.doesNotMatch(
    sql,
    /\b(?:solapi|google_chat|provider|notification_deliver(?:y|ies)|reminder_jobs|due_jobs|outbox)\b/i,
  );
  assert.doesNotMatch(
    sql,
    /\b(?:insert\s+into|update|delete\s+from)\s+dashboard_private\.registration_observation_runtime_settings\b/i,
  );
});

test("review follow-up replaces only the set-wise private list and preserves blank-alias precedence and ACLs", async () => {
  const sql = await readReviewFollowupMigration();
  assert.match(sql, /^begin;\s+set local lock_timeout = '5s';/i);
  assert.match(sql, /set local statement_timeout = '120s';/i);
  assert.match(sql, /commit;\s*$/i);
  assert.doesNotMatch(
    sql,
    /\b(?:solapi|google_chat|provider|notification_deliver(?:y|ies)|reminder_jobs|due_jobs|outbox)\b/i,
  );
  assert.doesNotMatch(
    sql,
    /\b(?:insert\s+into|update|delete\s+from)\s+dashboard_private\.registration_observation_runtime_settings\b/i,
  );

  const definitions = sql.match(/create\s+or\s+replace\s+function\b/gi) ?? [];
  assert.equal(definitions.length, 1);
  const implementation = functionDefinition(
    sql,
    "dashboard_private.list_registration_observation_sessions_v1_impl",
  );
  assert.match(implementation, /language\s+plpgsql/i);
  assert.match(implementation, /stable/i);
  assert.match(implementation, /security definer/i);
  assert.match(implementation, /set search_path = ''/i);
  assert.match(implementation, /source_sessions\s+as\s+materialized/i);
  assert.equal(
    (implementation.match(/jsonb_array_elements\(v_sessions\)/gi) ?? []).length,
    1,
  );
  assert.match(implementation, /limit\s+240/i);
  assert.match(
    implementation,
    /coalesce\(\s*nullif\(pg_catalog\.btrim\(candidate\.value\s*->>\s*'teacherCatalogId'\),\s*''\),\s*nullif\(pg_catalog\.btrim\(candidate\.value\s*->>\s*'teacher_catalog_id'\),\s*''\)\s*\)\s+as teacher_catalog_text/i,
  );
  assert.match(
    implementation,
    /coalesce\(\s*nullif\(pg_catalog\.btrim\(candidate\.value\s*->>\s*'classroomCatalogId'\),\s*''\),\s*nullif\(pg_catalog\.btrim\(candidate\.value\s*->>\s*'classroom_catalog_id'\),\s*''\)\s*\)\s+as classroom_catalog_text/i,
  );
  assert.match(
    sql,
    /alter function dashboard_private\.list_registration_observation_sessions_v1_impl\(uuid, uuid, date, date\)\s+owner to postgres/i,
  );
  assert.match(
    sql,
    /revoke all on function dashboard_private\.list_registration_observation_sessions_v1_impl\(uuid, uuid, date, date\)\s+from public, anon, authenticated, service_role/i,
  );
  assert.match(
    sql,
    /grant execute on function dashboard_private\.list_registration_observation_sessions_v1_impl\(uuid, uuid, date, date\)\s+to authenticated/i,
  );
  assert.doesNotMatch(sql, /create\s+or\s+replace\s+function\s+public\./i);
});

test("canonical resolver helpers expose the frozen signatures and selected-session contract", async () => {
  const sql = await readMigration();
  for (const [name, returns] of [
    [
      "dashboard_private.assert_registration_observation_manager_access_v1",
      "public.ops_registration_subject_tracks",
    ],
    ["dashboard_private.resolve_registration_observation_session_v1", "jsonb"],
    ["dashboard_private.registration_observation_booking_fact_hash_v1", "text"],
    [
      "dashboard_private.registration_observation_legacy_session_content_hash_v1",
      "text",
    ],
  ]) {
    const definition = functionDefinition(sql, name);
    assert.match(definition, new RegExp(`returns\\s+${escapeRegExp(returns)}\\b`, "i"));
    assert.match(definition, /security definer/i);
    assert.match(definition, /set search_path = ''/i);
  }

  const resolver = functionDefinition(
    sql,
    "dashboard_private.resolve_registration_observation_session_v1",
  );
  assert.match(resolver, /p_session_authority\s+text/i);
  assert.match(resolver, /p_class_lesson_session_id\s+uuid/i);
  assert.match(resolver, /p_legacy_session_key\s+text/i);
  assert.match(resolver, /continuous_class_schedule_runtime_version\(\)\s*<>\s*1/i);
  assert.match(resolver, /schedule_storage_mode\s*=\s*'normalized'/i);
  assert.match(resolver, /schedule_storage_mode\s+in\s*\(\s*'legacy'\s*,\s*'shadow'\s*\)/i);
  assert.match(resolver, /sessionKey[\s\S]*session_key[\s\S]*->>\s*'id'/i);
  assert.match(resolver, /scheduleState[\s\S]*schedule_state[\s\S]*->>\s*'state'/i);
  assert.match(resolver, /when\s+'normal'\s+then\s+'active'/i);
  assert.match(resolver, /registration_observation_session_time_ambiguous/i);
  assert.match(resolver, /at time zone 'Asia\/Seoul'/i);
  assert.match(resolver, /dashboard_private\.notification_profile_is_active_v1/i);
  assert.match(resolver, /classroom\.campus\s+in\s*\(\s*'본관'\s*,\s*'별관'\s*\)/i);
  assert.match(resolver, /elsif\s+p_session_authority\s*=\s*'legacy'\s+then[\s\S]*lower\(teacher\.name\)/i);
  assert.match(resolver, /elsif\s+p_session_authority\s*=\s*'legacy'\s+then[\s\S]*lower\(classroom\.name\)/i);
  assert.match(resolver, /'진도: 미입력'/i);

  const legacyHash = functionDefinition(
    sql,
    "dashboard_private.registration_observation_legacy_session_content_hash_v1",
  );
  assert.match(legacyHash, /v_selected_session/i);
  assert.match(legacyHash, /v_canonical_session_key\s*:=\s*p_session_key/i);
  assert.match(legacyHash, /continuous_class_schedule_content_hash_v1/i);
  assert.match(legacyHash, /'textbooks'[\s\S]*'sessions'[\s\S]*'textbookEntries'/i);
  assert.match(legacyHash, /registration_observation_legacy_session_invalid/i);

  const bookingHash = functionDefinition(
    sql,
    "dashboard_private.registration_observation_booking_fact_hash_v1",
  );
  for (const key of [
    "classId",
    "subject",
    "sessionAuthority",
    "sessionKey",
    "scheduleState",
    "sessionDate",
    "startsAt",
    "endsAt",
    "teacherCatalogId",
    "teacherProfileId",
    "teacherName",
    "classroomCatalogId",
    "classroomName",
    "campus",
  ]) {
    assert.match(bookingHash, new RegExp(`'${key}'`));
  }
  assert.doesNotMatch(bookingHash, /'textbooks'|'progress'|'memo'|'workflowStatus'/i);
});

test("public reads are thin invoker wrappers over guarded bounded definer implementations", async () => {
  const sql = await readMigration();
  const contracts = [
    {
      publicName: "public.list_registration_observation_sessions_v1",
      privateName: "dashboard_private.list_registration_observation_sessions_v1_impl",
      argumentsPattern: /p_track_id\s+uuid[\s\S]*p_class_id\s+uuid[\s\S]*p_date_from\s+date[\s\S]*p_date_to\s+date/i,
    },
    {
      publicName: "public.get_registration_observation_manager_detail_v1",
      privateName: "dashboard_private.get_registration_observation_manager_detail_v1_impl",
      sharedName: "dashboard_private.registration_observation_manager_detail_rows_v1",
      argumentsPattern: /p_track_id\s+uuid[\s\S]*p_attempt_limit\s+integer\s+default\s+20/i,
    },
    {
      publicName: "public.get_registration_observation_manager_attempt_v1",
      privateName: "dashboard_private.get_registration_observation_manager_attempt_v1_impl",
      sharedName: "dashboard_private.registration_observation_manager_attempt_read_v1",
      argumentsPattern: /p_track_id\s+uuid[\s\S]*p_observation_id\s+uuid/i,
    },
  ];

  for (const contract of contracts) {
    const wrapper = functionDefinition(sql, contract.publicName);
    const implementation = functionDefinition(sql, contract.privateName);
    assert.match(wrapper, contract.argumentsPattern);
    assert.match(wrapper, /language sql/i);
    assert.match(wrapper, /stable/i);
    assert.match(wrapper, /security invoker/i);
    assert.match(wrapper, /set search_path = ''/i);
    assert.match(wrapper, new RegExp(escapeRegExp(contract.privateName), "i"));
    assert.match(implementation, /stable/i);
    assert.match(implementation, /security definer/i);
    assert.match(implementation, /set search_path = ''/i);
    const guardedRead = contract.sharedName
      ? functionDefinition(sql, contract.sharedName)
      : implementation;
    assert.match(guardedRead, /stable/i);
    assert.match(guardedRead, /security definer/i);
    assert.match(guardedRead, /set search_path = ''/i);
    assert.match(
      guardedRead,
      /assert_registration_observation_manager_access_v1\s*\(\s*(?:p_track_id|\$1)\s*\)/i,
    );
  }

  const list = functionDefinition(
    sql,
    "dashboard_private.list_registration_observation_sessions_v1_impl",
  );
  assert.match(list, /p_date_from\s*<\s*current_date/i);
  assert.match(list, /p_date_to\s*-\s*p_date_from\s*>\s*120/i);
  assert.match(list, /limit\s+240/i);
  assert.match(
    list,
    /cross\s+join\s+lateral\s*\([\s\S]*count\s*\(\s*\*\s*\)[\s\S]*slot_count[\s\S]*class_schedule_slots[\s\S]*slot_count\s*<>\s*1[\s\S]*session_date\s*\+\s*slot_fact\.start_time[\s\S]*at\s+time\s+zone\s+'Asia\/Seoul'[\s\S]*>\s*pg_catalog\.now\(\)[\s\S]*resolve_registration_observation_session_v1/i,
  );

  const detailImplementation = functionDefinition(
    sql,
    "dashboard_private.get_registration_observation_manager_detail_v1_impl",
  );
  const detail = functionDefinition(
    sql,
    "dashboard_private.registration_observation_manager_detail_rows_v1",
  );
  const limitGuard = functionDefinition(
    sql,
    "dashboard_private.assert_registration_observation_attempt_limit_v1",
  );
  assert.match(detailImplementation, /registration_observation_manager_detail_rows_v1/i);
  assert.doesNotMatch(detailImplementation, /from\s+public\.ops_registration_observations/i);
  assert.match(limitGuard, /p_attempt_limit\s+not between\s+1\s+and\s+50/i);
  assert.match(detail, /assert_registration_observation_attempt_limit_v1\s*\(\s*\$2\s*\)/i);
  assert.match(detail, /limit\s+input\.attempt_limit/i);
  assert.match(detail, /limit\s+100/i);
  assert.match(detail, /decision_kind\s*=\s*'enrollment'/i);
  assert.match(detail, /limit\s+1/i);
  assert.match(
    detail,
    /from\s*\(\s*values\s*\(\s*'scheduled'::text\s*\)[\s\S]*'attended_feedback_pending'[\s\S]*'completed'[\s\S]*'no_show'[\s\S]*'canceled'/i,
  );
  assert.match(
    detail,
    /cross\s+join\s+lateral[\s\S]*observation\.status\s*=\s*status_candidate\.status[\s\S]*order by\s+observation\.created_at\s+desc\s*,\s*observation\.id\s+desc[\s\S]*limit\s+1/i,
  );
  assert.doesNotMatch(detail, /feedback_reason|student_name|parent_contact|school|inquiry/i);

  const attemptImplementation = functionDefinition(
    sql,
    "dashboard_private.get_registration_observation_manager_attempt_v1_impl",
  );
  const attempt = functionDefinition(
    sql,
    "dashboard_private.registration_observation_manager_attempt_read_v1",
  );
  assert.match(attemptImplementation, /registration_observation_manager_attempt_read_v1/i);
  assert.doesNotMatch(attemptImplementation, /from\s+public\.ops_registration_observations/i);
  assert.match(
    attempt,
    /observation\.id\s*=\s*\$2[\s\S]*observation\.track_id\s*=\s*\(\s*input\.track\s*\)\.id/i,
  );
  assert.match(attempt, /limit\s+1/i);
  assert.match(attemptImplementation, /registration_observation_not_found/i);
  assert.doesNotMatch(attempt, /offset\b|count\s*\(|feedback_reason|parent_contact|school|inquiry/i);
});

test("read ACLs are explicit and exclude public, anon, and service role execution", async () => {
  const sql = await readMigration();
  for (const signature of [
    "public.list_registration_observation_sessions_v1(uuid, uuid, date, date)",
    "public.get_registration_observation_manager_detail_v1(uuid, integer)",
    "public.get_registration_observation_manager_attempt_v1(uuid, uuid)",
    "dashboard_private.list_registration_observation_sessions_v1_impl(uuid, uuid, date, date)",
    "dashboard_private.get_registration_observation_manager_detail_v1_impl(uuid, integer)",
    "dashboard_private.get_registration_observation_manager_attempt_v1_impl(uuid, uuid)",
  ]) {
    const escaped = escapeRegExp(signature).replaceAll(" ", "\\s*");
    assert.match(
      sql,
      new RegExp(`revoke all on function\\s+${escaped}\\s+from public, anon, authenticated, service_role`, "i"),
    );
    assert.match(
      sql,
      new RegExp(`grant execute on function\\s+${escaped}\\s+to authenticated`, "i"),
    );
  }

  for (const signature of [
    "dashboard_private.assert_registration_observation_attempt_limit_v1(integer)",
    "dashboard_private.registration_observation_manager_detail_rows_v1(uuid, integer)",
    "dashboard_private.registration_observation_manager_attempt_read_v1(uuid, uuid)",
  ]) {
    const escaped = escapeRegExp(signature).replaceAll(" ", "\\s*");
    assert.match(
      sql,
      new RegExp(`revoke all on function\\s+${escaped}\\s+from public, anon, authenticated, service_role`, "i"),
    );
    assert.doesNotMatch(
      sql,
      new RegExp(`grant execute on function\\s+${escaped}\\s+to authenticated`, "i"),
    );
  }
});

test("summary view appends only bounded observation scalars without a history aggregate", async () => {
  const sql = await readMigration();
  assert.match(
    sql,
    /create\s+index\s+ops_registration_observations_track_created_idx\s+on\s+public\.ops_registration_observations\s*\(\s*track_id\s*,\s*created_at\s+desc\s*,\s*id\s+desc\s*\)/i,
  );
  const view = sql.match(
    /create\s+or\s+replace\s+view\s+public\.ops_registration_subject_track_summaries[\s\S]*?;/i,
  )?.[0];
  assert.ok(view, "missing summary view recreation");
  assert.match(view, /with\s*\(\s*security_invoker\s*=\s*true\s*\)/i);
  for (const column of [
    "observation_attempt_count",
    "observation_current_id",
    "observation_current_status",
    "observation_current_appointment_id",
    "observation_nearest_scheduled_at",
    "observation_nearest_place",
    "observation_notification_revision",
    "observation_revision",
    "observation_feedback_revision",
  ]) {
    assert.match(view, new RegExp(`\\b${column}\\b`, "i"));
  }
  assert.match(
    view,
    /case\s+when\s+observation_manager\.allowed\s+is\s+true\s+then\s+track\.observation_attempt_count\s+else\s+null\s+end\s+as\s+observation_attempt_count/i,
  );
  assert.match(
    view,
    /left\s+join\s+lateral\s*\(\s*select\s+true\s+as\s+allowed[\s\S]*current_dashboard_role\(\)[\s\S]*registration_observation_track_director_profile_id_matches_v1\(\s*track\.id\s*\)[\s\S]*limit\s+1\s*\)\s+observation_manager\s+on\s+true/i,
  );
  assert.equal(
    [...view.matchAll(/case\s+when\s+observation_manager\.allowed\s+is\s+true/gi)].length,
    9,
  );
  assert.match(view, /ops_registration_observations[\s\S]*limit\s+1/i);
  assert.doesNotMatch(view, /count\s*\([^)]*\)[\s\S]*ops_registration_observations/i);
  assert.doesNotMatch(view, /feedback_reason|textbook_snapshot|progress_snapshot/i);
});

test("schema pgTAP freezes canonical, authorization, exact lookup, and 20k index bounds", async () => {
  const sql = await readFile(pgTapPath, "utf8");
  assert.match(sql, /sessionKey\/session_key\/id priority/i);
  assert.match(sql, /selected-session legacy content hash/i);
  assert.match(sql, /registration_observation_date_range_invalid/i);
  assert.match(sql, /registration_observation_attempt_limit_invalid/i);
  assert.match(sql, /exact observation lookup is independent of the recent-attempt limit/i);
  assert.match(sql, /registration_observation_not_found/i);
  assert.match(sql, /generate_series\(1,\s*10000\)/i);
  assert.match(sql, /generate_series\(10001,\s*20000\)/i);
  assert.match(sql, /explain\s*\(analyze,\s*buffers,\s*format json\)/i);
  assert.match(sql, /registration_observation_explain_security_definer_body_as_actor/i);
  assert.match(sql, /EXPLAIN targets are exact production-shared SQL bodies/i);
  assert.match(sql, /registration_observation_manager_attempt_read_v1\(uuid,uuid\)/i);
  assert.match(sql, /registration_observation_manager_detail_rows_v1\(uuid,integer\)/i);
  assert.doesNotMatch(
    sql,
    /'exact-10k'[\s\S]{0,500}select\s+observation\.id\s+from\s+public\.ops_registration_observations/i,
  );
  assert.doesNotMatch(
    sql,
    /'detail-10k'[\s\S]{0,500}select\s+observation\.id\s+from\s+public\.ops_registration_observations/i,
  );
  assert.match(sql, /ops_registration_observations_open_track_key/i);
  assert.match(sql, /ops_registration_observations_pkey/i);
  assert.match(sql, /ops_registration_observations_track_decision_status_idx/i);
  assert.match(sql, /20k latest enrollment scalar uses at most five one-row decision-status index probes/i);
  assert.doesNotMatch(sql, /select\s+no_plan\s*\(/i);
});

test("core review forward fix keeps active-manager, decision-scalar, and set-wise list boundaries", async () => {
  const sql = await readReviewFixMigration();
  assert.match(sql, /^begin;\s+set local lock_timeout = '5s';/i);
  assert.match(sql, /set local statement_timeout = '120s';/i);
  assert.match(sql, /commit;\s*$/i);

  const activeManager = functionDefinition(
    sql,
    "dashboard_private.registration_observation_current_actor_is_active_manager_v1",
  );
  assert.match(activeManager, /security definer/i);
  assert.match(activeManager, /set search_path = ''/i);
  assert.match(activeManager, /auth\.uid\(\)/i);
  assert.match(activeManager, /actor\.role\s+in\s*\(\s*'admin'\s*,\s*'staff'\s*\)/i);
  assert.match(activeManager, /account\.deleted_at\s+is\s+null/i);
  assert.match(activeManager, /account\.banned_until\s+is\s+null[\s\S]*account\.banned_until\s*<=\s*pg_catalog\.now\(\)/i);

  const list = functionDefinition(
    sql,
    "dashboard_private.list_registration_observation_sessions_v1_impl",
  );
  const legacyBranch = list.match(
    /elsif\s+v_class\.schedule_storage_mode\s+in\s*\(\s*'legacy'\s*,\s*'shadow'\s*\)\s+then([\s\S]*?)else\s+raise exception 'registration_observation_session_invalid'/i,
  )?.[1];
  assert.ok(legacyBranch, "missing forward set-wise legacy branch");
  assert.equal(
    [...legacyBranch.matchAll(/jsonb_array_elements\(\s*v_class\.schedule_plan\s*->\s*'(?:sessions|session_list)'/gi)].length,
    0,
    "the selected source array is bound once before set-wise expansion",
  );
  assert.equal(
    [...legacyBranch.matchAll(/jsonb_array_elements\(\s*v_sessions\s*\)/gi)].length,
    1,
    "legacy sessions are expanded once",
  );
  assert.doesNotMatch(
    legacyBranch,
    /resolve_registration_observation_session_v1|registration_observation_legacy_session_content_hash_v1/i,
  );
  assert.match(legacyBranch, /with\s+source_sessions\s+as\s+materialized/i);
  assert.match(legacyBranch, /group\s+by\s+canonical\.session_key\s+having\s+count\(\*\)\s*>\s*1/i);
  assert.match(legacyBranch, /limit\s+240/i);
  assert.match(legacyBranch, /continuous_class_schedule_content_hash_v1/i);
  assert.match(legacyBranch, /registration_observation_booking_fact_hash_v1/i);

  const detail = functionDefinition(
    sql,
    "dashboard_private.get_registration_observation_manager_detail_v1_impl",
  );
  assert.match(detail, /'latestDecisionObservation'/i);
  assert.match(detail, /row_kind\s*=\s*'latest_decision'/i);
  assert.match(sql, /drop policy if exists ops_registration_observations_select/i);
  assert.match(sql, /registration_observation_current_actor_is_active_manager_v1\(\)/i);
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?function\s+public\.list_registration_observation_sessions_v1/i);
});
