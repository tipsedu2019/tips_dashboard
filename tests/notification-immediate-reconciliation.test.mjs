import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import test from "node:test"

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url)

async function readMigration() {
  const names = await readdir(migrationsDirectory)
  const name = names.find((candidate) => (
    candidate.endsWith("_notification_immediate_reconciliation_completion.sql")
  ))
  assert.ok(name, "즉시 알림 업무 재계산 완료 마이그레이션이 필요합니다")
  return readFile(new URL(name, migrationsDirectory), "utf8")
}

async function readInsertGuardMigration() {
  const names = await readdir(migrationsDirectory)
  const name = names.find((candidate) => (
    candidate.endsWith("_notification_immediate_reconciliation_insert_guard.sql")
  ))
  assert.ok(name, "즉시형 재계산 삽입 상태 보호 마이그레이션이 필요합니다")
  return readFile(new URL(name, migrationsDirectory), "utf8")
}

test("변경 규칙이 모두 즉시형이면 설정 저장의 재계산 작업을 즉시 완료한다", async () => {
  const sql = await readMigration()

  assert.match(sql, /^begin;/)
  assert.match(sql, /create or replace function dashboard_private\.complete_immediate_notification_rule_reconciliation_v1\(\)/)
  assert.match(sql, /from pg_catalog\.jsonb_object_keys\(new\.rule_revision_map\)/)
  assert.doesNotMatch(sql, /jsonb_object_length/)
  assert.match(sql, /pg_catalog\.bool_and\(rule_row\.delivery_mode = 'immediate'\)/)
  assert.doesNotMatch(sql, /pg_catalog\.coalesce/)
  assert.match(sql, /rule_row\.workflow_key = new\.workflow_key/)
  assert.match(sql, /new\.status := 'succeeded'/)
  assert.match(sql, /new\.next_attempt_at := null/)
  assert.match(sql, /new\.completed_at := pg_catalog\.clock_timestamp\(\)/)
  assert.match(sql, /before insert on dashboard_private\.notification_rule_reconciliation_jobs/)
  assert.match(sql, /where job\.status = 'pending'/)
  assert.match(sql, /update dashboard_private\.notification_rule_reconciliation_jobs job[\s\S]*set status = 'succeeded'/)
  assert.match(sql, /rule_row\.workflow_key = job\.workflow_key/)
  assert.doesNotMatch(sql, /new\.workflow_key\s*<>\s*'registration'/)
  assert.match(sql, /revoke all on function dashboard_private\.complete_immediate_notification_rule_reconciliation_v1\(\)/)
  assert.match(sql, /commit;\s*$/)
})

test("즉시형 자동 완료는 새 pending 작업만 바꾸고 명시된 상태는 보존한다", async () => {
  const sql = await readInsertGuardMigration()

  assert.match(sql, /^begin;/)
  assert.match(sql, /create or replace function dashboard_private\.complete_immediate_notification_rule_reconciliation_v1\(\)/)
  assert.match(sql, /if new\.status = 'pending'/)
  assert.match(sql, /and new\.attempt_count = 0/)
  assert.match(sql, /and new\.claimed_by is null/)
  assert.match(sql, /and new\.claim_token is null/)
  assert.match(sql, /and new\.lease_expires_at is null/)
  assert.match(sql, /and new\.completed_at is null/)
  assert.match(sql, /and v_immediate_only/)
  assert.match(sql, /new\.status := 'succeeded'/)
  assert.match(sql, /revoke all on function dashboard_private\.complete_immediate_notification_rule_reconciliation_v1\(\)/)
  assert.match(sql, /commit;\s*$/)
})
