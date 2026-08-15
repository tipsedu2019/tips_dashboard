import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL("../supabase/migrations/20260815121000_registration_teacher_followup_tasks.sql", import.meta.url)
const workspaceUrl = new URL("../src/features/tasks/ops-task-workspace.tsx", import.meta.url)

test("attendance creates one feedback task due 24 hours after the observation", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  assert.match(sql, /create table dashboard_private\.registration_observation_feedback_tasks/i)
  assert.match(sql, /observation_id uuid not null unique/i)
  assert.match(sql, /'청강 피드백 작성 · '/i)
  assert.match(sql, /new\.ends_at \+ interval '24 hours'/i)
  assert.match(sql, /assignee_id[\s\S]*new\.teacher_profile_id/i)
  assert.match(sql, /registration_observation_feedback_required/i)
  assert.match(sql, /feedback_submitted_at[\s\S]*status = 'done'/i)
})

test("enrollment creates an ordinary first-parent-consultation task for the first-session teacher", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  assert.match(sql, /create table dashboard_private\.registration_first_consultation_task_links/i)
  assert.match(sql, /'신규 등록 학부모 첫 상담 · '/i)
  assert.match(sql, /profiles\.teacher_catalog_id = lesson\.teacher_catalog_id/i)
  assert.doesNotMatch(sql, /pg_catalog\.min\(profiles\.id\)/i)
  assert.match(sql, /registration_first_consultation_assignee_required/i)
  assert.match(sql, /'첫 수업 후 학부모님께 문자 또는 전화로 수업 상황을 안내하고, 앞으로 잘 부탁드린다는 인사를 전해주세요\.'/i)
  assert.match(sql, /v_first_lesson_end \+ interval '24 hours'/i)
  assert.match(sql, /new\.status = 'enrolled'[\s\S]*old\.status is distinct from 'enrolled'/i)
})

test("first-parent-consultation task follows first-session schedule and teacher changes", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  assert.match(sql, /create or replace function dashboard_private\.sync_registration_first_consultation_task_v1/i)
  assert.match(sql, /after update of session_date, end_time, teacher_catalog_id on public\.class_lesson_sessions/i)
  assert.match(sql, /registration_first_consultation_assignee_required/i)
  assert.match(sql, /update public\.ops_tasks[\s\S]*assignee_id = v_assignee_id[\s\S]*start_at = v_lesson_end[\s\S]*due_at = v_lesson_end \+ interval '24 hours'/i)
  assert.match(sql, /task\.status in \('requested', 'confirmed', 'in_progress', 'on_hold'\)/i)
})

test("scheduled observation Chat reminders are retired without deleting delivery history", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  assert.match(sql, /registration\.observation_(?:reminder|feedback)_due/i)
  assert.match(sql, /scheduled_google_chat_replaced_by_task/i)
  assert.doesNotMatch(sql, /delete from dashboard_private\.notification_(?:events|deliveries)/i)
})

test("feedback-linked general tasks open the exact feedback page and hide generic completion", async () => {
  const source = await readFile(workspaceUrl, "utf8")
  assert.match(source, /registration_observation_feedback:/)
  assert.match(source, /\/admin\/registration\/observations\/\$\{observationId\}\/feedback/)
  assert.match(source, /피드백 작성/)
  assert.match(source, /getNextTaskStatusAction[\s\S]*isRegistrationObservationFeedbackTask[\s\S]*return null/)
})
