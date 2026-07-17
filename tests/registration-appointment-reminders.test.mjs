import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../supabase/migrations/20260716130000_registration_appointment_reminder_producer.sql",
  import.meta.url,
)

async function readProducer() {
  return readFile(migrationUrl, "utf8")
}

function block(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `missing source block: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `missing source block terminator: ${end}`)
  return source.slice(startIndex, endIndex)
}

test("예약 알림 생산자는 공통 런타임을 먼저 닫힌 방식으로 확인하고 최종 마커를 마지막에 만든다", async () => {
  const sql = await readProducer()

  assert.match(sql, /^begin;/i)
  assert.match(sql, /common_notification_control_plane_runtime_version\(\)/)
  assert.match(sql, /registration_notification_common_runtime_(?:missing|mismatch)/)
  assert.match(sql, /create or replace function public\.registration_appointment_reminders_runtime_version\(\)/)
  assert.ok(
    sql.lastIndexOf("registration_appointment_reminders_runtime_version") < sql.lastIndexOf("commit;"),
  )
  assert.equal((sql.match(/^commit;$/gim) ?? []).length, 1)
})

test("예약 알림 규칙은 세 시점과 승인된 셀을 조합한 정확히 9개이며 모두 꺼진 상태로 설치된다", async () => {
  const sql = await readProducer()
  const seed = block(sql, "-- registration_reminder_seed_rows", "-- registration_reminder_seed_complete")

  for (const variant of ["previous_day_at", "same_day_at", "offset_before"]) {
    assert.match(seed, new RegExp(`'${variant}'`))
  }
  assert.match(seed, /'management_team'(?:\s*::text)?,[^\n]*'in_app'/)
  assert.match(seed, /'track_director'(?:\s*::text)?,[^\n]*'in_app'/)
  assert.match(seed, /'management_team'(?:\s*::text)?,[^\n]*'google_chat'/)
  assert.match(seed, /'14:00'/)
  assert.match(seed, /'lead_minutes',\s*60/)
  assert.match(seed, /'Asia\/Seoul'/)
  assert.match(seed, /enabled[\s\S]*false/)
  assert.match(seed, /registration_reminder_seed_count_invalid/)
  assert.match(seed, /\)\s*<>\s*9/)
  assert.doesNotMatch(seed, /insert into dashboard_private\.notification_(?:events|deliveries)/)
})

test("KST 계산기는 달력일 경계와 14시 경계를 호스트 시간대와 무관하게 계산한다", async () => {
  const sql = await readProducer()
  const evaluator = block(
    sql,
    "create or replace function dashboard_private.calculate_registration_reminder_schedule_v1",
    "create or replace function dashboard_private.registration_appointment_reminder_applicable_v1",
  )

  assert.match(evaluator, /at time zone 'Asia\/Seoul'/)
  assert.match(evaluator, /make_interval\(mins\s*=>\s*v_lead_minutes\)/)
  assert.match(evaluator, /previous_day_at[\s\S]*-\s*1/)
  assert.match(evaluator, /same_day_at/)
  assert.match(evaluator, /offset_before/)
  assert.match(evaluator, /scheduled_at_required|schedule_config_invalid/)

  const boundaryCases = [
    "00:00", "00:30", "13:59", "14:00", "14:01", "23:59",
    "2027-01-01", "2028-02-29", "2028-03-01",
  ]
  for (const value of boundaryCases) assert.ok(sql.includes(value), `missing KST proof ${value}`)
})

test("물질화는 안정된 occurrence identity와 엄격한 미래 구간만 사용하고 공통 event/job 쌍을 재사용한다", async () => {
  const sql = await readProducer()
  const materializer = block(
    sql,
    "create or replace function dashboard_private.materialize_registration_appointment_reminders_v1",
    "create or replace function dashboard_private.cancel_registration_appointment_reminders_v1",
  )

  assert.match(materializer, /registration:registration_appointment:/)
  assert.match(materializer, /:source_revision:/)
  assert.match(materializer, /:rule:/)
  assert.match(materializer, /:rule_revision:/)
  assert.match(materializer, /p_now\s*<\s*v_scheduled_for/)
  assert.match(materializer, /v_scheduled_for\s*<\s*v_appointment\.scheduled_at/)
  assert.match(materializer, /dashboard_private\.record_notification_event_v1\(/)
  assert.match(materializer, /'registration\.appointment_reminder_due'/)
  assert.match(materializer, /'registration_reminder_materializer'/)
  assert.match(materializer, /'event_id'/)
  assert.match(materializer, /'fanout_job_id'/)
  assert.match(materializer, /on conflict|notification_events/i)
})

test("오래된 예약 작업 취소는 미시도·선점 전 상태만 바꾸고 전달 중 이후 이력을 보존한다", async () => {
  const sql = await readProducer()
  const canceler = block(
    sql,
    "create or replace function dashboard_private.cancel_registration_appointment_reminders_v1",
    "create or replace function dashboard_private.preview_registration_appointment_reminders_v1",
  )

  assert.match(canceler, /status in \('pending', 'retry_wait'\)/)
  assert.match(canceler, /status = 'claimed'/)
  assert.match(canceler, /cancel_requested_at/)
  assert.match(canceler, /source_revision_changed|source_status_changed/)
  assert.doesNotMatch(canceler, /delivery\.scheduled_for\s*>\s*p_now/)
  assert.doesNotMatch(canceler, /status in \([^)]*'sending'/)
  assert.doesNotMatch(canceler, /delete from dashboard_private\.notification_(?:events|deliveries)/)
})

test("학생명 수정은 모든 활성 예약의 source revision·취소·재물질화·최종 영수증을 한 트랜잭션에 묶는다", async () => {
  const sql = await readProducer()
  const wrapper = block(
    sql,
    "create or replace function dashboard_private.update_registration_case_common_with_reminders_v1_impl",
    "create or replace function public.create_registration_case_with_initial_workflow_v1",
  )

  const globalLock = wrapper.indexOf("notification-control-plane-workflow:registration")
  const taskRead = wrapper.indexOf("select task.student_name")
  assert.ok(globalLock > -1 && globalLock < taskRead)
  assert.match(wrapper, /v_response\s*\?\s*'notificationJobs'/)
  assert.match(wrapper, /v_before_student_name\s+is distinct from\s+v_after_student_name/)
  assert.match(wrapper, /notification_revision\s*=\s*notification_revision\s*\+\s*1/)
  assert.match(wrapper, /cancel_registration_appointment_reminders_v1/)
  assert.match(wrapper, /materialize_registration_appointment_reminders_v1/)
  assert.match(wrapper, /mutation_type = 'update_common'/)
  assert.match(wrapper, /jsonb_set\([\s\S]*'\{notificationJobs\}'/)
  assert.match(
    sql,
    /revoke all on function dashboard_private\.update_registration_case_common_impl\([\s\S]*?from public, anon, authenticated, service_role/,
  )
})

test("미리보기는 권한·양쪽 런타임 마커·적용 가능성·미래 조건을 확인하고 안전한 snake_case만 반환한다", async () => {
  const sql = await readProducer()
  const preview = block(
    sql,
    "create or replace function dashboard_private.preview_registration_appointment_reminders_v1",
    "create or replace function public.preview_registration_appointment_reminders_v1",
  )

  assert.match(preview, /assert_registration_reminder_runtime_v1\(\)/)
  assert.match(preview, /assert_registration_reminder_access_v1\(\)/)
  assert.match(preview, /rule_id/)
  assert.match(preview, /rule_revision/)
  assert.match(preview, /variant_key/)
  assert.match(preview, /scheduled_for/)
  assert.match(preview, /audience_key/)
  assert.match(preview, /channel_key/)
  assert.match(preview, /rule\.enabled/)
  assert.doesNotMatch(preview, /title_template|body_template|target_profile|recipient/)

  const publicPreview = block(
    sql,
    "create or replace function public.preview_registration_appointment_reminders_v1",
    "create or replace function dashboard_private.append_registration_notification_jobs_v1",
  )
  assert.match(publicPreview, /security definer/)
  assert.match(publicPreview, /dashboard_private\.preview_registration_appointment_reminders_v1/)
})

test("예약 mutation 래퍼는 같은 트랜잭션에서 기존 구현 결과와 취소·물질화 작업 참조를 합친다", async () => {
  const sql = await readProducer()

  for (const name of [
    "create_registration_case_with_initial_workflow_v1",
    "save_registration_shared_appointment",
    "cancel_registration_appointment",
    "complete_registration_level_test_attempt",
    "complete_registration_consultation",
    "assign_registration_track_director",
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}\\(`))
  }
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /materialize_registration_appointment_reminders_v1/)
  assert.match(sql, /cancel_registration_appointment_reminders_v1/)
  assert.match(sql, /'job_kind',\s*'fanout'/)
  assert.match(sql, /enqueue_notification_target_reconciliation_job_v1/)
  assert.match(sql, /'job_kind',\s*'target_reconciliation'/)
  assert.match(sql, /write_registration_track_event_v2/)
  assert.doesNotMatch(sql, /write_registration_track_event\([^)]*registration\.director_assigned/s)

  const cancelWrapper = block(
    sql,
    "create or replace function dashboard_private.cancel_registration_appointment_with_reminders_v1_impl",
    "create or replace function dashboard_private.complete_registration_level_test_with_reminders_v1_impl",
  )
  assert.match(cancelWrapper, /'registration:workflow:'\s*\|\|\s*v_task_id::text/)

  const directorWrapper = block(
    sql,
    "create or replace function dashboard_private.assign_registration_track_director_with_reminders_v1_impl",
    "create or replace function public.create_registration_case_with_initial_workflow_v1",
  )
  const initialConsultationLookup = block(
    directorWrapper,
    "select consultation.id, consultation.appointment_id",
    "perform dashboard_private.assert_registration_mutation_access",
  )
  assert.doesNotMatch(initialConsultationLookup, /for update/)
  assert.match(directorWrapper, /appointment\.status = 'scheduled'[\s\S]*for update of appointment/)
  assert.match(directorWrapper, /order by consultation\.track_id, consultation\.id[\s\S]*for update of consultation/)
})

test("recipient generation은 bigint 1에서 시작하고 정규화된 수신자 집합 변화에만 한 번 증가한다", async () => {
  const sql = await readProducer()

  assert.match(sql, /add column if not exists recipient_revision bigint not null default 1/)
  assert.match(sql, /recipient_revision > 0/)
  assert.match(sql, /array_agg\(distinct[\s\S]*order by/)
  assert.match(sql, /notification_target_set_hash_v1/)
  assert.match(sql, /recipient_revision\s*=\s*recipient_revision\s*\+\s*1/)
  assert.match(sql, /previous_target_set_hash/)
  assert.match(sql, /current_target_set_hash/)
  assert.match(sql, /source_event_id/)

  const saveWrapper = block(
    sql,
    "create or replace function dashboard_private.save_registration_shared_appointment_with_reminders_v1_impl",
    "create or replace function dashboard_private.cancel_registration_appointment_with_reminders_v1_impl",
  )
  assert.match(saveWrapper, /v_before_targets/)
  assert.match(saveWrapper, /v_after_targets/)
  assert.match(saveWrapper, /appointment_recipient_set_changed/)
  assert.match(saveWrapper, /enqueue_notification_target_reconciliation_job_v1/)
  assert.match(saveWrapper, /recipient_revision\s*=\s*recipient_revision\s*\+\s*1/)
  assert.match(saveWrapper, /v_jobs\s*:=\s*v_jobs\s*\|\|\s*dashboard_private\.materialize_registration_appointment_reminders_v1/)
})

test("저장 재시도는 최종 알림 작업 영수증을 그대로 반환하고 최신 리비전에 부작용을 만들지 않는다", async () => {
  const sql = await readProducer()
  const saveWrapper = block(
    sql,
    "create or replace function dashboard_private.save_registration_shared_appointment_with_reminders_v1_impl",
    "create or replace function dashboard_private.cancel_registration_appointment_with_reminders_v1_impl",
  )

  assert.match(saveWrapper, /v_response\s*\?\s*'notificationJobs'/)
  assert.match(saveWrapper, /v_persisted_revision\s+is distinct from\s+v_current_revision/)
  assert.match(saveWrapper, /jsonb_set\([\s\S]*'\{notificationJobs\}'/)
  assert.match(saveWrapper, /update dashboard_private\.ops_registration_mutations[\s\S]*mutation_type = 'save_appointment'/)

  const replayGuardIndex = saveWrapper.indexOf("v_response ? 'notificationJobs'")
  const cancelIndex = saveWrapper.indexOf("cancel_registration_appointment_reminders_v1")
  assert.ok(replayGuardIndex > -1 && replayGuardIndex < cancelIndex)
})

test("생성 재시도도 최종 알림 작업 영수증만 반환하고 오래된 예약 리비전에는 부작용을 만들지 않는다", async () => {
  const sql = await readProducer()
  const createWrapper = block(
    sql,
    "create or replace function dashboard_private.create_registration_case_with_reminders_v1_impl",
    "create or replace function dashboard_private.save_registration_shared_appointment_with_reminders_v1_impl",
  )

  assert.match(createWrapper, /v_actor_id\s+uuid\s*:=\s*\(select auth\.uid\(\)\)/)
  assert.match(createWrapper, /v_response\s*\?\s*'notificationJobs'/)
  assert.match(createWrapper, /appointment\.notification_revision[\s\S]*v_expected_revision/)
  assert.match(createWrapper, /not found\s+or\s+v_persisted_revision\s+is distinct from\s+v_expected_revision/)
  assert.match(createWrapper, /jsonb_set\([\s\S]*'\{notificationJobs\}'/)
  assert.match(createWrapper, /if not v_receipt_is_stale then[\s\S]*materialize_registration_appointment_reminders_v1/)
  assert.match(
    createWrapper,
    /update dashboard_private\.ops_registration_mutations[\s\S]*mutation_type = 'create_case_with_initial_workflow_v1'/,
  )

  const replayGuardIndex = createWrapper.indexOf("v_response ? 'notificationJobs'")
  const materializeIndex = createWrapper.indexOf("materialize_registration_appointment_reminders_v1")
  assert.ok(replayGuardIndex > -1 && replayGuardIndex < materializeIndex)
})

test("모든 예약 mutation은 도메인 조회보다 먼저 설정 저장과 같은 registration 전역 잠금을 잡는다", async () => {
  const sql = await readProducer()
  const wrappers = [
    [
      "create or replace function dashboard_private.create_registration_case_with_reminders_v1_impl",
      "create or replace function dashboard_private.save_registration_shared_appointment_with_reminders_v1_impl",
      "create_registration_case_with_initial_workflow_v1_impl",
    ],
    [
      "create or replace function dashboard_private.save_registration_shared_appointment_with_reminders_v1_impl",
      "create or replace function dashboard_private.cancel_registration_appointment_with_reminders_v1_impl",
      "registration_appointment_director_targets_v1",
    ],
    [
      "create or replace function dashboard_private.cancel_registration_appointment_with_reminders_v1_impl",
      "create or replace function dashboard_private.complete_registration_level_test_with_reminders_v1_impl",
      "select appointment.task_id",
    ],
    [
      "create or replace function dashboard_private.complete_registration_level_test_with_reminders_v1_impl",
      "create or replace function dashboard_private.complete_registration_consultation_with_reminders_v1_impl",
      "select level_test.appointment_id",
    ],
    [
      "create or replace function dashboard_private.complete_registration_consultation_with_reminders_v1_impl",
      "create or replace function dashboard_private.assign_registration_track_director_with_reminders_v1_impl",
      "select consultation.appointment_id",
    ],
    [
      "create or replace function dashboard_private.assign_registration_track_director_with_reminders_v1_impl",
      "create or replace function public.create_registration_case_with_initial_workflow_v1",
      "select track.task_id",
    ],
  ]

  for (const [start, end, firstDomainAccess] of wrappers) {
    const wrapper = block(sql, start, end)
    const lockIndex = wrapper.indexOf("notification-control-plane-workflow:registration")
    const domainIndex = wrapper.indexOf(firstDomainAccess)
    assert.ok(lockIndex > -1, `${start}에 registration 전역 잠금이 있어야 한다`)
    assert.ok(domainIndex > -1, `${start}의 첫 도메인 접근을 찾을 수 있어야 한다`)
    assert.ok(lockIndex < domainIndex, `${start}는 도메인 접근 전에 전역 잠금을 잡아야 한다`)
  }
})

test("방문상담 담당 원장이 0명이면 SQL도 adapter와 같은 합성 수신자를 사용한다", async () => {
  const sql = await readProducer()
  const targets = block(
    sql,
    "create or replace function dashboard_private.registration_appointment_director_targets_v1",
    "create or replace function dashboard_private.registration_appointment_director_target_hash_v1",
  )

  assert.match(targets, /'target_kind',\s*'audience'/)
  assert.match(targets, /'target_key',\s*'audience:track_director'/)
  assert.match(targets, /'audience_key',\s*'track_director'/)
  assert.match(targets, /jsonb_build_array/)
})

test("기존 private mutation 구현은 인증 사용자가 새 원자 래퍼를 우회하지 못하도록 모두 닫힌다", async () => {
  const sql = await readProducer()
  for (const signature of [
    "create_registration_case_with_initial_workflow_v1_impl",
    "save_registration_shared_appointment_impl",
    "cancel_registration_appointment_impl",
    "complete_registration_level_test_attempt_impl",
    "complete_registration_consultation_impl",
    "assign_registration_track_director_impl",
  ]) {
    assert.match(
      sql,
      new RegExp(`revoke all on function dashboard_private\\.${signature}\\([\\s\\S]*?from public, anon, authenticated, service_role`),
    )
  }
})

test("예약 이후로 계산된 규칙의 skip 감사는 동일 리비전·규칙·시각에 한 번만 기록된다", async () => {
  const sql = await readProducer()
  const materializer = block(
    sql,
    "create or replace function dashboard_private.materialize_registration_appointment_reminders_v1",
    "create or replace function dashboard_private.cancel_registration_appointment_reminders_v1",
  )

  assert.match(materializer, /not_before_appointment/)
  assert.match(materializer, /where not exists\s*\([\s\S]*notification_audit_logs[\s\S]*v_rule\.id[\s\S]*v_rule\.revision[\s\S]*v_scheduled_for/)
})

test("생산 어댑터 읽기 RPC는 service_role 전용이며 안정 커서와 안전한 스냅샷만 제공한다", async () => {
  const sql = await readProducer()

  for (const signature of [
    "list_registration_notification_sources_v1(jsonb, integer)",
    "get_registration_notification_source_snapshot_v1(uuid)",
    "list_registration_notification_target_items_v1(uuid, jsonb, integer)",
  ]) {
    const escaped = signature.replace(/[()]/g, "\\$&")
    assert.match(sql, new RegExp(`revoke all on function public\\.${escaped}[\\s\\S]*from public, anon, authenticated`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${escaped}[\\s\\S]*to service_role`))
  }

  assert.match(sql, /\(appointment\.scheduled_at, appointment\.id\)/)
  assert.match(sql, /'next_cursor'/)
  assert.match(sql, /'done'/)
  for (const key of [
    "appointment_id",
    "task_id",
    "student_name",
    "kind",
    "scheduled_at",
    "place",
    "status",
    "notification_revision",
    "recipient_revision",
    "track_ids",
    "subjects",
    "participants",
    "director_profile_ids",
    "management_profile_ids",
    "current_rules",
  ]) {
    assert.match(sql, new RegExp(`'${key}'`))
  }

  const targetReader = block(
    sql,
    "create or replace function public.list_registration_notification_target_items_v1",
    "revoke all on function dashboard_private.calculate_registration_reminder_schedule_v1",
  )
  assert.match(targetReader, /appointment\.kind = 'visit_consultation'/)
  assert.match(targetReader, /rule\.audience_key = 'track_director'/)
  assert.match(targetReader, /rule\.channel_key = 'in_app'/)
  assert.match(targetReader, /v_cutoff_at\s+timestamptz\s*:=\s*pg_catalog\.clock_timestamp\(\)/)
  assert.match(targetReader, /'cutoff_at',\s*v_cutoff_at/)
  assert.equal((targetReader.match(/job\.scheduled_for\s*>\s*v_cutoff_at/g) ?? []).length, 3)
  assert.doesNotMatch(targetReader, /job\.scheduled_for\s*>\s*pg_catalog\.now\(\)/)
  assert.doesNotMatch(targetReader, /title_template|body_template|webhook|endpoint|phone/)
})

test("초기 템플릿 변수는 생산 어댑터의 다섯 렌더 키와 정확히 일치한다", async () => {
  const sql = await readProducer()
  const seed = block(sql, "-- registration_reminder_seed_rows", "-- registration_reminder_seed_complete")
  const keys = [
    "student_name",
    "appointment_kind",
    "scheduled_at",
    "place",
    "subjects",
  ]
  for (const key of keys) assert.match(seed, new RegExp(`\\"key\\":\\"${key}\\"`))
  assert.equal((seed.match(/"key":"/g) ?? []).length, 5)
})

test("규칙이 모두 꺼진 수신자 변경은 빈 최종 페이지로 취소·회수를 완료하고 실제 페이지 해시는 계속 검증한다", async () => {
  const sql = await readProducer()
  const apply = block(
    sql,
    "create or replace function public.apply_notification_target_reconciliation_batch_v1",
    "revoke all on function dashboard_private.calculate_registration_reminder_schedule_v1",
  )

  assert.match(apply, /jsonb_array_length\(p_batch -> 'deliveries'\) = 0/)
  assert.match(apply, /and not p_done/)
  assert.match(apply, /notification_target_set_hash_v1\('\[\]'::jsonb\)/)
  assert.match(apply, /group by[\s\S]*event_id[\s\S]*rule_id[\s\S]*rule_revision/)
  assert.match(apply, /notification_target_set_hash_v1\(target_page\.deliveries\)/)
  assert.match(apply, /notification_target_set_hash_mismatch/)
  assert.match(apply, /status = 'canceled'/)
  assert.match(apply, /cancel_requested_at/)
  assert.match(apply, /revoked_at/)
  assert.match(apply, /notification\.read_at is null/)
  assert.match(apply, /dashboard_notification_read_receipts/)
})

test("담당 원장 대상 재계산은 track_director 대시보드 알림만 취소·회수하고 관리팀 Chat은 보존한다", async () => {
  const sql = await readProducer()
  const apply = block(
    sql,
    "create or replace function public.apply_notification_target_reconciliation_batch_v1",
    "create or replace function public.registration_appointment_reminders_runtime_version",
  )

  assert.equal((apply.match(/rule\.audience_key\s*=\s*'track_director'/g) ?? []).length, 3)
  assert.equal((apply.match(/rule\.channel_key\s*=\s*'in_app'/g) ?? []).length, 3)
  assert.match(apply, /source_revision/)
  assert.match(apply, /is distinct from v_job\.source_revision/)
})
