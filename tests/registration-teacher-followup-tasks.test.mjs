import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL("../supabase/migrations/20260815121000_registration_teacher_followup_tasks.sql", import.meta.url)
const legacyFinalizationMigrationUrl = new URL("../supabase/migrations/20260826101200_registration_legacy_first_consultation.sql", import.meta.url)
const retirementMigrationUrl = new URL("../supabase/migrations/20260901110100_registration_teacher_feedback_request_retirement.sql", import.meta.url)
const workspaceUrl = new URL("../src/features/tasks/ops-task-workspace.tsx", import.meta.url)

async function readOptional(url) {
  try {
    return await readFile(url, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return ""
    throw error
  }
}

test("feedback task retirement preserves rows while disabling both task triggers", async () => {
  const sql = await readOptional(retirementMigrationUrl)
  assert.match(sql, /drop trigger if exists sync_registration_observation_feedback_task_v1[\s\S]*on public\.ops_registration_observations/i)
  assert.match(sql, /drop trigger if exists guard_registration_feedback_task_completion_v1[\s\S]*on public\.ops_tasks/i)
  assert.match(sql, /create or replace function dashboard_private\.sync_registration_observation_feedback_task_v1\(\)[\s\S]*return new/i)
  assert.match(sql, /registration_observation_feedback_request_retired/i)
  assert.match(sql, /feature_retired/i)
  assert.match(sql, /update public\.ops_tasks[\s\S]*status = 'canceled'/i)
  assert.match(sql, /insert into public\.ops_task_events/i)
  assert.doesNotMatch(sql, /delete from (?:dashboard_private\.registration_observation_feedback_tasks|public\.ops_tasks|public\.ops_task_events)/i)
})

test("feedback submit and correction RPCs are fail-closed while management decision stays callable", async () => {
  const sql = await readOptional(retirementMigrationUrl)
  assert.match(sql, /registration_observation_feedback_retired/i)
  assert.match(sql, /revoke all on function public\.submit_registration_observation_feedback_v1\([\s\S]*from public, anon, authenticated, service_role/i)
  assert.match(sql, /revoke all on function public\.correct_registration_observation_feedback_v1\([\s\S]*from public, anon, authenticated, service_role/i)
  assert.match(sql, /grant execute on function public\.decide_registration_observation_v1\([\s\S]*to authenticated/i)
  assert.match(sql, /if v_actor_role not in \('admin', 'staff'\) then[\s\S]*registration_observation_not_found/i)
})

test("enrollment creates an ordinary first-parent-consultation task for the first-session teacher", async () => {
  const [originalSql, legacySql] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(legacyFinalizationMigrationUrl, "utf8"),
  ])
  const sql = `${originalSql}\n${legacySql}`
  assert.match(sql, /create table dashboard_private\.registration_first_consultation_task_links/i)
  assert.match(sql, /'신규 등록 학부모 첫 상담 · '/i)
  assert.match(sql, /profiles\.teacher_catalog_id = lesson\.teacher_catalog_id/i)
  assert.doesNotMatch(sql, /pg_catalog\.min\(profiles\.id\)/i)
  assert.match(sql, /registration_first_consultation_assignee_required/i)
  assert.match(sql, /'첫 수업 후 학부모님께 문자 또는 전화로 수업 상황을 안내하고, 앞으로 잘 부탁드린다는 인사를 전해주세요\.'/i)
  assert.match(sql, /v_first_lesson_end \+ interval '24 hours'/i)
  assert.match(sql, /new\.status = 'enrolled'[\s\S]*old\.status is distinct from 'enrolled'/i)
})

test("legacy enrollment resolves one effective weekday slot without inventing a lesson session", async () => {
  const sql = await readFile(legacyFinalizationMigrationUrl, "utf8")
  assert.match(sql, /trigger\.tgrelid = 'public\.ops_registration_enrollments'/i)
  assert.match(sql, /trigger\.tgname = 'create_registration_first_consultation_task_v1'/i)
  assert.match(sql, /trigger\.tgenabled = 'O'/i)
  assert.match(sql, /trigger\.tgtype = 17/i)
  assert.match(sql, /cardinality\(trigger\.tgattr::smallint\[\]\) = 1/i)
  assert.match(sql, /status_attribute\.attnum = any\(trigger\.tgattr::smallint\[\]\)/i)
  assert.match(sql, /trigger\.tgqual is null/i)
  assert.match(sql, /trigger\.tgnargs = 0/i)
  assert.match(sql, /trigger\.tgfoid =[\s\S]*dashboard_private\.create_registration_first_consultation_task_v1/i)
  assert.match(sql, /alter column class_lesson_session_id drop not null/i)
  assert.match(sql, /registration_observation_effective_legacy_slots_v1\([\s\S]*new\.class_id/i)
  assert.match(sql, /v_legacy_slot_count <> 1/i)
  assert.match(sql, /profiles\.teacher_catalog_id = v_teacher_catalog_id/i)
  assert.match(sql, /new\.class_start_date \+ v_first_lesson_end_time/i)
  assert.match(sql, /where link\.enrollment_id = new\.id[\s\S]*for update/i)
  assert.match(sql, /task\.status = 'canceled'[\s\S]*'requested'/i)
  assert.match(sql, /new\.class_start_lesson_session_id[\s\S]*return new;[\s\S]*insert into public\.ops_tasks/i)
  assert.doesNotMatch(sql, /on conflict \(enrollment_id\) do nothing/i)
})

test("first-parent-consultation task follows first-session schedule and teacher changes", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  assert.match(sql, /create or replace function dashboard_private\.sync_registration_first_consultation_task_v1/i)
  assert.match(sql, /after update of session_date, end_time, teacher_catalog_id on public\.class_lesson_sessions/i)
  assert.match(sql, /registration_first_consultation_assignee_required/i)
  assert.match(sql, /update public\.ops_tasks[\s\S]*assignee_id = v_assignee_id[\s\S]*start_at = v_lesson_end[\s\S]*due_at = v_lesson_end \+ interval '24 hours'/i)
  assert.match(sql, /task\.status in \('requested', 'confirmed', 'in_progress', 'on_hold'\)/i)
})

test("feedback-due producer and rule are retired without deleting notification history", async () => {
  const sql = await readOptional(retirementMigrationUrl)
  assert.match(sql, /p_event_key = 'registration\.observation_feedback_due'[\s\S]*return null/i)
  assert.match(sql, /update dashboard_private\.notification_rules[\s\S]*enabled = false[\s\S]*event_key = 'registration\.observation_feedback_due'/i)
  assert.match(sql, /update dashboard_private\.registration_observation_chat_jobs[\s\S]*last_error_code = 'feature_retired'/i)
  assert.match(sql, /update dashboard_private\.notification_event_fanout_jobs/i)
  assert.match(sql, /update dashboard_private\.notification_deliveries/i)
  assert.doesNotMatch(sql, /delete from dashboard_private\.(?:registration_observation_chat_jobs|notification_events|notification_event_fanout_jobs|notification_deliveries|notification_delivery_attempts|notification_audit_logs)/i)
})

test("feedback-linked general tasks expose no marker route or completion override", async () => {
  const source = await readFile(workspaceUrl, "utf8")
  assert.doesNotMatch(source, /registration_observation_feedback:/)
  assert.doesNotMatch(source, /\/admin\/registration\/observations\/\$\{observationId\}\/feedback/)
  assert.doesNotMatch(source, /isRegistrationObservationFeedbackTask/)
})

test("attendance and director decision preserve manual workflow status and revision", async () => {
  const sql = await readOptional(retirementMigrationUrl)
  assert.match(sql, /create or replace function dashboard_private\.record_registration_observation_attendance_v1_impl/i)
  assert.match(sql, /'registration_observation_attendance_recorded'[\s\S]*v_track\.workflow_status[\s\S]*v_track\.workflow_status/i)
  assert.match(sql, /create or replace function dashboard_private\.decide_registration_observation_v1_impl/i)
  assert.match(sql, /when 'attended_feedback_pending' then 'observation_attendance_recorded'/i)
  assert.match(sql, /v_observation\.status not in \('attended_feedback_pending', 'completed', 'no_show'\)/i)
  assert.match(sql, /'workflowRevisionBefore', v_track\.workflow_revision[\s\S]*'workflowRevisionAfter', v_track\.workflow_revision/i)
  assert.doesNotMatch(sql, /set workflow_status = v_target_workflow_status/i)
  assert.doesNotMatch(sql, /set workflow_status = 'observation_feedback_pending'/i)
})

test("attended director-approved observation remains a valid enrollment source without feedback fields", async () => {
  const sql = await readOptional(retirementMigrationUrl)
  assert.match(sql, /create or replace function dashboard_private\.validate_registration_observation_class_start_source_v1/i)
  assert.match(sql, /observation\.status in \('attended_feedback_pending', 'completed'\)/i)
  assert.match(sql, /observation\.attendance = 'attended'/i)
  assert.match(sql, /observation\.decision_kind = 'enrollment'/i)
  assert.doesNotMatch(sql, /observation\.suitability_result = 'fit'/i)
})
