import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import test from "node:test"

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url)

async function migrationSource() {
  const names = await readdir(migrationsUrl)
  const selected = names.filter((value) => value.includes("_registration_customer_reminder_"))
  assert.ok(selected.some((value) => value.endsWith("_registration_customer_reminder_automation.sql")), "registration customer reminder automation migration must exist")
  const sources = await Promise.all(selected.map((name) => readFile(new URL(name, migrationsUrl), "utf8")))
  return sources.join("\n").toLowerCase().replace(/\s+/gu, " ")
}

test("자동 리마인드 설정은 private singleton이며 기본 OFF·3시간이다", async () => {
  const sql = await migrationSource()

  assert.match(sql, /create table dashboard_private\.registration_customer_reminder_settings/)
  assert.match(sql, /enabled boolean not null default false/)
  assert.match(sql, /lead_hours smallint not null default 3/)
  assert.match(sql, /check \(lead_hours between 1 and 72\)/)
  assert.match(sql, /insert into dashboard_private\.registration_customer_reminder_settings/)
  assert.match(sql, /alter table dashboard_private\.registration_customer_reminder_settings enable row level security/)
  assert.match(sql, /revoke all on table dashboard_private\.registration_customer_reminder_settings from public, anon, authenticated, service_role/)
})

test("설정 조회·변경은 관리자 권한과 revision, live template, cron 준비를 fail closed로 검증한다", async () => {
  const sql = await migrationSource()

  assert.match(sql, /create function public\.get_registration_customer_reminder_settings_v1\(\s*p_actor_profile_id uuid\s*\)/)
  assert.match(sql, /registration_customer_solapi_assert_operator_v1/)
  assert.match(sql, /create function public\.set_registration_customer_reminder_settings_v1\(/)
  assert.match(sql, /registration_customer_solapi_assert_admin_v1/)
  assert.match(sql, /p_expected_revision bigint/)
  assert.match(sql, /registration_customer_reminder_settings_conflict/)
  assert.match(sql, /v_activation\.mode is distinct from 'live'/)
  assert.match(sql, /v_receipt\.catalog_checksum is distinct from p_template_contract ->> 'catalogchecksum'/)
  assert.match(sql, /registration_customer_reminder_schedule_ready_v1\(\)/)
  assert.match(sql, /registration_customer_reminder_not_ready/)
  assert.match(sql, /grant execute on function public\.set_registration_customer_reminder_settings_v1[^;]+to service_role/)
})

test("예약 큐는 appointment 평생 한 행이고 미발송 예약 변경만 재계산한다", async () => {
  const sql = await migrationSource()

  assert.match(sql, /create table dashboard_private\.registration_customer_reminder_jobs/)
  assert.match(sql, /appointment_id uuid primary key/)
  assert.match(sql, /status text not null default 'pending'/)
  assert.match(sql, /status in \('pending', 'claimed', 'dispatching', 'completed', 'canceled'\)/)
  assert.match(sql, /due_at timestamptz not null/)
  assert.match(sql, /appointment\.scheduled_at - pg_catalog\.make_interval\(hours => settings\.lead_hours\)/)
  assert.match(sql, /on conflict \(appointment_id\) do update/)
  assert.match(sql, /where registration_customer_reminder_jobs\.status = 'pending'/)
  assert.match(sql, /appointment\.status = 'scheduled'/)
  assert.match(sql, /appointment\.scheduled_at > pg_catalog\.clock_timestamp\(\)/)
  assert.match(sql, /create index registration_customer_reminder_jobs_task_idx/)
  assert.match(sql, /create index registration_customer_reminder_jobs_message_idx/)
  assert.match(sql, /create index registration_customer_reminder_settings_updated_by_idx/)
  assert.match(sql, /create index ops_registration_customer_messages_scheduled_job_idx/)
})

test("수동·자동 리마인드는 appointment당 합계 1회로 잠긴다", async () => {
  const sql = await migrationSource()

  assert.match(sql, /drop index public\.ops_reg_customer_msg_appointment_once_idx/)
  assert.match(sql, /create unique index ops_reg_customer_msg_appointment_revision_once_idx[^;]+message_kind in \('level_test_booking', 'visit_consultation_booking'\)/)
  assert.match(sql, /create unique index ops_reg_customer_msg_reminder_lifetime_once_idx[^;]+\(appointment_id, message_kind\)[^;]+message_kind = 'appointment_reminder'/)
  assert.match(sql, /delivery_origin text not null default 'manual'/)
  assert.match(sql, /delivery_origin in \('manual', 'scheduled'\)/)
  assert.match(sql, /delivery_origin = 'scheduled'[^;]+preview_id is null[^;]+confirmed_by is null/)
  assert.match(sql, /delivery_origin = 'manual'[^;]+preview_id is not null[^;]+confirmed_by is not null/)
})

test("claim은 SKIP LOCKED 임대이며 marker recovery가 재발송을 차단한다", async () => {
  const sql = await migrationSource()

  assert.match(sql, /create function public\.claim_registration_customer_reminder_job_v1\(\s*\)/)
  assert.match(sql, /for update(?: of job)? skip locked/)
  assert.match(sql, /claim_expires_at = pg_catalog\.clock_timestamp\(\) \+ interval '2 minutes'/)
  assert.match(sql, /message\.provider_attempt_count = 1/)
  assert.match(sql, /message\.status = 'pending'/)
  assert.match(sql, /set status = 'unknown'/)
  assert.match(sql, /resolution_source = 'scheduled_marker_recovery'/)
})

test("begin은 모든 안전 조건을 다시 확인하고 provider 시도 마커와 outbox를 원자 기록한다", async () => {
  const sql = await migrationSource()

  assert.match(sql, /create function public\.begin_registration_customer_reminder_dispatch_v1\(\s*/)
  assert.match(sql, /registration_customer_message_assert_contract_v1\(\s*p_contract,\s*'appointment_reminder'\s*\)/)
  assert.match(sql, /resolve_registration_customer_message_source_v1_impl\(\s*'appointment_reminder',\s*v_job\.appointment_id\s*\)/)
  assert.match(sql, /v_settings\.enabled is not true/)
  assert.match(sql, /v_activation\.mode is distinct from 'live'/)
  assert.match(sql, /insert into public\.ops_registration_customer_messages/)
  assert.match(sql, /'scheduled'/)
  assert.match(sql, /provider_attempt_started_at/)
  assert.match(sql, /provider_attempt_count/)
  assert.match(sql, /values \([^;]+pg_catalog\.clock_timestamp\(\),\s*1,/)
  assert.ok(sql.indexOf("provider_attempt_started_at") < sql.indexOf("return pg_catalog.jsonb_build_object( 'allowed', true"))
})

test("자동 finalize는 provider 결과와 큐 완료를 함께 기록하고 actor를 가장하지 않는다", async () => {
  const sql = await migrationSource()

  const start = sql.indexOf("create function public.finalize_registration_customer_reminder_dispatch_v1")
  const end = sql.indexOf("alter function public.finalize_registration_customer_reminder_dispatch_v1", start)
  const body = sql.slice(start, end)
  assert.ok(start >= 0 && end > start)
  assert.match(body, /registration_customer_message_provider_evidence_v1/)
  assert.match(body, /message\.delivery_origin <> 'scheduled'/)
  assert.match(body, /set status = p_result/)
  assert.match(body, /update dashboard_private\.registration_customer_reminder_jobs/)
  assert.match(body, /status = 'completed'/)
  assert.doesNotMatch(body, /registration_customer_message_assert_actor_v1/)
  assert.match(sql, /scheduled_provider_send/)
  assert.match(sql, /scheduled_marker_recovery/)
  assert.match(sql, /add constraint ops_registration_customer_messages_resolution_source_check/)
})

test("감사 projection은 자동 발송자를 명시하고 수동 profile 이름을 보존한다", async () => {
  const sql = await migrationSource()

  assert.match(sql, /when (?:message|outbox)\.delivery_origin = 'scheduled' then '자동 발송'/)
  assert.match(sql, /left join public\.profiles profile on profile\.id = outbox\.confirmed_by/)
  assert.match(sql, /'deliveryorigin', message\.delivery_origin/)
})

test("Cron은 Vault·HTTPS 고정 host를 검증하고 함수로만 설치하며 migration에서는 자동 설치하지 않는다", async () => {
  const sql = await migrationSource()

  assert.match(sql, /create extension if not exists pg_cron with schema pg_catalog/)
  assert.match(sql, /create extension if not exists pg_net;/)
  assert.match(sql, /vault\.decrypted_secrets/)
  assert.match(sql, /registration_customer_reminder_worker_url/)
  assert.match(sql, /registration_customer_reminder_worker_bearer_secret/)
  assert.match(sql, /https:\/\/tipsdashboard\.vercel\.app\/api\/solapi\/registration\/reminders\/worker/)
  assert.match(sql, /net\.http_post/)
  assert.match(sql, /cron\.schedule\(/)
  assert.match(sql, /cron\.alter_job\(/)
  assert.match(sql, /cron\.unschedule\(/)
  assert.doesNotMatch(sql, /update cron\.job/)
  const commitIndex = sql.lastIndexOf("commit;")
  const managerEnd = sql.lastIndexOf("$$;")
  assert.ok(managerEnd < commitIndex)
  assert.doesNotMatch(sql.slice(managerEnd, commitIndex), /cron\.schedule\(/)
})

test("Vault 비밀키 회전은 service role 전용이며 값이나 URL을 클라이언트가 선택하지 못한다", async () => {
  const sql = await migrationSource()

  assert.match(sql, /create function public\.configure_registration_customer_reminder_worker_secret_v1\(\s*p_secret text\s*\)/)
  assert.match(sql, /\(select auth\.role\(\)\) <> 'service_role'/)
  assert.match(sql, /https:\/\/tipsdashboard\.vercel\.app\/api\/solapi\/registration\/reminders\/worker/)
  assert.match(sql, /vault\.create_secret\(/)
  assert.match(sql, /vault\.update_secret\(/)
  assert.match(sql, /grant execute on function public\.configure_registration_customer_reminder_worker_secret_v1\(text\)\s+to service_role/)
  assert.doesNotMatch(sql, /grant execute on function public\.configure_registration_customer_reminder_worker_secret_v1\(text\)\s+to (?:anon|authenticated)/)
})
