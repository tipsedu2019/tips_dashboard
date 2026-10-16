import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20261013084134_registration_enrollment_guarded_save.sql", import.meta.url);
const source = await readFile(migrationUrl, "utf8");
const body = source.slice(source.indexOf("create function dashboard_private.save_registration_enrollment_details_guarded_v2_impl"),
  source.indexOf("alter function dashboard_private.save_registration_enrollment_details_guarded_v2_impl"));

test("guarded save checks authorization then locks the request task track and enrollments before freshness and DML", () => {
  const access = body.indexOf("assert_registration_mutation_access");
  const key = body.indexOf("pg_advisory_xact_lock");
  const task = body.indexOf("perform 1 from public.ops_tasks task");
  const track = body.indexOf("select track.* into v_track");
  const receipt = body.indexOf("from dashboard_private.ops_registration_mutations mutation");
  const replay = body.indexOf("return v_response;");
  const enrollment = body.indexOf("perform 1 from public.ops_registration_enrollments enrollment");
  const freshness = body.indexOf("registration_enrollment_details_refresh_required");
  const canonical = body.indexOf("save_registration_enrollment_rows_canonical_v1");
  assert.ok(access < key && key < task && task < track && track < receipt && receipt < replay
    && replay < enrollment && enrollment < freshness && freshness < canonical);
  assert.match(body, /assert_registration_actor_is_active_manager_v1[\s\S]*assert_registration_actor_is_active_manager_v1/);
  assert.match(body, /registration_enrollment_details_refresh_required' using errcode = '23514'/);
  assert.match(body, /registration_mutation_request_conflict' using errcode = '22023'/);
  assert.equal((body.match(/insert into dashboard_private\.ops_registration_mutations/g) || []).length, 1);
  assert.doesNotMatch(body, /40001|retry|set_registration_workflow_status_v1_impl\s*\(/);
  assert.match(body, /public\.ops_tasks task[\s\S]*?for no key update;/);
  assert.match(body, /select track\.\* into v_track[\s\S]*?for update;/);
  assert.match(source, /for no key update of task;/);
  assert.equal((source.match(/for no key update(?: of task)?;/g) || []).length, 3);
});

test("current snapshot excludes canceled or released rows and keeps the legacy multi-textbook representation", () => {
  const snapshot = source.slice(source.indexOf("create function dashboard_private.registration_enrollment_save_snapshot_v2"), source.indexOf("alter function dashboard_private.registration_enrollment_save_snapshot_v2"));
  for (const predicate of ["enrollment.status = 'planned'", "enrollment.admission_batch_id is null",
    "enrollment.student_id is null", "not enrollment.roster_active", "enrollment.roster_released_at is null",
    "enrollment.roster_release_reason is null", "enrollment.roster_release_source_task_id is null",
    "enrollment.roster_release_kind is null"]) assert.ok(snapshot.includes(predicate));
  assert.match(snapshot, /enrollment\.textbook_ids[\s\S]*array\[enrollment\.textbook_id\]/);
  assert.match(snapshot, /enrollment\.admission_batch_id is not null or enrollment\.roster_active/);
  assert.match(snapshot, /coalesce\(track\.enrollment_detail_rows, '\[\]'::jsonb\)/);
});

test("only complete unexternalized plans advance once and status writes preserve historical ownership and no-send boundaries", () => {
  assert.match(body, /if not v_externalized and not v_track\.migration_review_required/);
  assert.match(body, /jsonb_array_length\(v_saved_rows\) > 0/);
  assert.match(body, /classStartDate[\s\S]*classStartSessionKey[\s\S]*classStartSession/);
  const targets = body.slice(body.indexOf("and v_track.workflow_status in ("), body.indexOf("and not exists (", body.indexOf("and v_track.workflow_status in (")));
  for (const status of ["inquiry", "consultation_requested", "consultation_completed", "observation_requested", "waiting_current_class"]) assert.ok(targets.includes(`'${status}'`));
  for (const status of ["registered", "not_registered", "inquiry_only", "payment_in_progress", "enrollment_requested"]) assert.equal(targets.includes(`'${status}'`), false);
  assert.match(body, /workflow_status = 'enrollment_requested',\s+observation_return_workflow_status = null,\s+workflow_revision = track\.workflow_revision \+ 1/);
  assert.doesNotMatch(body, /(?:insert into|update|delete from) public\.(?:students|classes|ops_registration_admission_batches|ops_registration_observations|ops_registration_appointments)\b/);
  assert.doesNotMatch(body, /record_notification_event|notification_dispatch|customer_message|google_chat|http\./);
  assert.equal((body.match(/write_registration_track_event_v2\(/g) || []).length, 1);
});

test("compatibility lock patches match the final installed source anchors while observation target keeps paired history metadata", async () => {
  const finalFacts = await readFile(new URL("../supabase/migrations/20260901111200_registration_flat_fact_runtime_finalization.sql", import.meta.url), "utf8");
  const finalSetter = await readFile(new URL("../supabase/migrations/20260901110200_registration_status_property_decoupling.sql", import.meta.url), "utf8");
  const rowsWrapper = await readFile(new URL("../supabase/migrations/20260809104000_registration_observation_enrollment_source.sql", import.meta.url), "utf8");
  assert.ok(finalFacts.includes("  select track.id, track.task_id\n  into v_track"));
  assert.ok(finalFacts.includes("  perform pg_catalog.pg_advisory_xact_lock(\n    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)\n  );\n  select\n    mutation.task_id,"));
  assert.ok(rowsWrapper.includes("  select\n    mutation.task_id,"));
  assert.ok(finalSetter.includes("    'consultation_completed',\n    'waiting_current_class',"));
  assert.ok(finalSetter.includes("  v_status_changed := v_track.workflow_status is distinct from v_workflow_status;"));
  assert.match(source, /observation\.status = 'scheduled'\s+and observation\.decision_kind is null/);
  assert.match(source, /appointment\.status = 'scheduled'/);
  assert.match(source, /registration_observation_booking_required' using errcode = '23514'/);
  assert.match(source, /observation_return_workflow_status = case[\s\S]*else null end/);
  assert.match(source, /revoke all on function public\.save_registration_enrollment_details_guarded_v2[\s\S]*from public, anon, authenticated, service_role/);
});

test("draft pgTAP covers final installed definitions and exact SQLSTATEs without being used as runtime proof", async () => {
  const sql = await readFile(new URL("../supabase/tests/registration_enrollment_guarded_save_test.sql", import.meta.url), "utf8");
  assert.match(sql, /pg_get_functiondef/);
  for (const state of ["23514", "22023", "42501"]) assert.ok(sql.includes(`'${state}'`));
  for (const boundary of ["registration_enrollment_details_refresh_required", "registration_mutation_request_conflict", "registration_observation_booking_required"]) assert.ok(sql.includes(boundary));
  assert.match(sql, /select \* from finish\(\);\s*rollback;/);
});

test("synthetic fixture establishes trigger authentication before domain seeds and flushes before clearing it", async () => {
  const sql = await readFile(new URL("../supabase/tests/registration_enrollment_guarded_save_test.sql", import.meta.url), "utf8");
  const bootstrap = sql.indexOf("insert into auth.users");
  const profiles = sql.indexOf("insert into public.profiles");
  const setupActor = sql.indexOf("select pg_temp.registration_guard_actor(1);", profiles);
  const domainSetup = sql.indexOf("update public.profiles set teacher_catalog_id");
  assert.ok(sql.indexOf("select pg_temp.registration_guard_actor(null);") < bootstrap);
  assert.ok(bootstrap < profiles && profiles < setupActor && setupActor < domainSetup);
  const seedEnd = sql.indexOf("create temporary table registration_guard_results");
  const seeds = sql.slice(domainSetup, seedEnd);
  for (const statement of seeds.matchAll(/^(?:insert into|update|delete from) public\.[a-z_]+/gmu)) {
    const preceding = sql.slice(0, domainSetup + statement.index);
    const actors = [...preceding.matchAll(/^select pg_temp\.registration_guard_actor\((\d+|null)\);/gmu)];
    assert.equal(actors.at(-1)?.[1], "1", `${statement[0]} must have the fixture manager actor`);
  }
  assert.match(seeds, /'42501', 'registration_access_denied', 'historical enrollment seed rejects a missing JWT actor'/);
  assert.match(seeds, /'42501', 'registration_manager_write_access_denied', 'historical enrollment seed rejects an unknown JWT account'/);
  assert.match(seeds, /'42501', 'registration_manager_write_access_denied', 'forged admin metadata/);
  assert.match(seeds, /savepoint registration_guard_fixture_checks;\s*set constraints all immediate;\s*rollback to savepoint registration_guard_fixture_checks;\s*release savepoint registration_guard_fixture_checks;/);
  assert.match(sql, /set_config\('request.jwt.claim.role',\s*case when p_number is null then '' else 'authenticated' end, true\)/);
  assert.match(sql, /set_config\('app.class_schedule_mutation', '', true\)/);
  assert.match(sql, /reset role;\s*select pg_temp.registration_guard_actor\(7\);\s*update public.profiles set role = 'admin'/);
  const flush = sql.lastIndexOf("set constraints all immediate;");
  const noSend = sql.lastIndexOf("'detail saves and observation status edits never send");
  const clear = sql.lastIndexOf("select pg_temp.registration_guard_actor(null);");
  assert.ok(flush < noSend && noSend < clear && clear < sql.indexOf("select * from finish();"));
  assert.match(sql.slice(sql.lastIndexOf("reset role;"), flush), /select pg_temp.registration_guard_actor\(1\);/);
  assert.doesNotMatch(sql, /session_replication_role|disable\s+trigger|disable\s+row\s+level\s+security|alter\s+role|grant\s+.*\bon\s+public\./iu);
});
