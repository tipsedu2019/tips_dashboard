import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../supabase/migrations/20260726035612_dashboard_conflict_task_producer.sql",
  import.meta.url,
)
const serviceUrl = new URL("../src/features/tasks/ops-task-service.ts", import.meta.url)
const contractUrl = new URL("../src/features/dashboard/conflict-contract.ts", import.meta.url)
const concurrencyUrl = new URL("../scripts/verify-dashboard-conflict-concurrency.mjs", import.meta.url)

async function source(url) {
  return readFile(url, "utf8")
}

function block(input, start, end) {
  const startIndex = input.indexOf(start)
  assert.notEqual(startIndex, -1, `시작 블록이 없습니다: ${start}`)
  const endIndex = input.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `종료 블록이 없습니다: ${end}`)
  return input.slice(startIndex, endIndex)
}

test("충돌 링크 원장은 업무 하나만 영구 연결하고 직접 접근을 모두 닫는다", async () => {
  const sql = await source(migrationUrl)

  assert.match(sql, /set local lock_timeout = '5s'/)
  assert.match(sql, /set local statement_timeout = '120s'/)
  assert.match(sql, /create table if not exists dashboard_private\.dashboard_conflict_task_links/)
  assert.match(sql, /conflict_key text primary key/)
  assert.match(sql, /task_id uuid not null unique references public\.ops_tasks\(id\) on delete restrict/)
  assert.match(sql, /conflict_type text not null check \(conflict_type in \('exam', 'teacher', 'classroom', 'student'\)\)/)
  assert.match(sql, /revoke all on table dashboard_private\.dashboard_conflict_task_links\s+from public, anon, authenticated, service_role/)
  assert.doesNotMatch(sql, /grant (?:select|insert|update|delete).*dashboard_conflict_task_links/i)
})

test("공개 RPC는 인증 사용자에게만 열리고 앱 역할을 공개 함수 내부에서 다시 제한한다", async () => {
  const sql = await source(migrationUrl)

  for (const signature of [
    "list_dashboard_conflict_task_links_v1(jsonb)",
    "create_dashboard_conflict_task_v1(jsonb, uuid)",
  ]) {
    const name = signature.slice(0, signature.indexOf("("))
    assert.match(sql, new RegExp(`create or replace function public\\.${name}\\(`))
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}[\\s\\S]*to authenticated`))
  }
  assert.match(sql, /p_write and coalesce\(v_role, ''\) not in \('admin', 'staff', 'teacher'\)/)
  assert.match(sql, /not p_write and coalesce\(v_role, ''\) not in \('admin', 'staff', 'teacher', 'assistant', 'viewer'\)/)
  assert.doesNotMatch(sql, /grant execute[\s\S]*to anon/)
})

test("모든 충돌 함수는 고정 search_path와 visibility-aware 응답을 사용한다", async () => {
  const sql = await source(migrationUrl)
  const list = block(
    sql,
    "create or replace function public.list_dashboard_conflict_task_links_v1",
    "create or replace function public.create_dashboard_conflict_task_v1",
  )
  const create = block(
    sql,
    "create or replace function dashboard_private.create_dashboard_conflict_task_v1_impl",
    "create or replace function public.list_dashboard_conflict_task_links_v1",
  )

  assert.match(list, /security definer\s+set search_path = ''/)
  assert.match(create, /security definer\s+set search_path = ''/)
  assert.match(sql, /dashboard_conflict_task_visible_v1/)
  assert.match(sql, /'taskId', case when v_can_open then v_link\.task_id::text else '' end/)
  assert.match(sql, /'canOpen', v_can_open/)
  assert.match(list, /dashboard_conflict_duplicate_key/)
})

test("멱등 replay는 원본 재검증과 후보 잠금보다 먼저 실행된다", async () => {
  const sql = await source(migrationUrl)
  const create = block(
    sql,
    "create or replace function dashboard_private.create_dashboard_conflict_task_v1_impl",
    "create or replace function public.list_dashboard_conflict_task_links_v1",
  )

  const replayIndex = create.indexOf("ops_task_request_replay_v2")
  const candidateLockIndex = create.indexOf("dashboard-conflict:")
  const sourceLockIndex = create.indexOf("from public.classes")
  assert.ok(replayIndex >= 0 && replayIndex < candidateLockIndex)
  assert.ok(candidateLockIndex < sourceLockIndex)
  assert.match(create, /'create_dashboard_conflict_task_v1', v_fingerprint/)
  assert.match(create, /'actor', v_actor[\s\S]*'conflictKey', v_key[\s\S]*'conflict', v_conflict/)
  assert.match(create, /order by source_class\.id\s+for update of source_class/)
  assert.match(create, /order by source_event\.id\s+for update of source_event/)
  assert.match(create, /order by source_detail\.id\s+for update of source_detail/)
  assert.match(create, /dashboard_conflict_stale/)
})

test("시험 규칙은 당일 동일 과목만 막고 다음 날 과목에 현재 과목이 섞이면 전날 수업을 허용한다", async () => {
  const sql = await source(migrationUrl)
  const examSubjects = block(
    sql,
    "create or replace function dashboard_private.dashboard_conflict_exam_subjects_for_student_v1",
    "create or replace function dashboard_private.normalize_dashboard_conflict_v1",
  )
  const create = block(
    sql,
    "create or replace function dashboard_private.create_dashboard_conflict_task_v1_impl",
    "create or replace function public.list_dashboard_conflict_task_links_v1",
  )

  assert.doesNotMatch(examSubjects, /v_modern_coverage/)
  assert.match(examSubjects, /if pg_catalog\.cardinality\(v_subjects\) > 0 then[\s\S]*return v_subjects/)
  assert.match(examSubjects, /to_regclass\('public\.academic_exam_days'\)[\s\S]*where day\.exam_date = \$1/)
  assert.match(create, /v_session_date < \(pg_catalog\.now\(\) at time zone 'Asia\/Seoul'\)::date/)
  assert.match(create, /'same-day-subject' and not \(v_subject = any\(v_exam_subjects\)\)/)
  assert.match(create, /'day-before-other-subject' and v_subject = any\(v_exam_subjects\)/)
  assert.match(create, /v_session_date := case[\s\S]*'same-day-subject'[\s\S]*v_exam_date - 1/)
  assert.match(create, /v_due := \(\(v_session_date - 1\)::timestamp \+ time '18:00'\)/)
})

test("UUID, 정확한 겹침 구간, 담당 catalog를 서버가 canonical source에서 다시 계산한다", async () => {
  const sql = await source(migrationUrl)
  const create = block(
    sql,
    "create or replace function dashboard_private.create_dashboard_conflict_task_v1_impl",
    "create or replace function public.list_dashboard_conflict_task_links_v1",
  )

  assert.match(sql, /dashboard_conflict_uuid_array_v1/)
  assert.match(sql, /pg_catalog\.substr\(v_value, 1, 10\)/)
  assert.match(sql, /pg_catalog\.substr\(v_days, v_index, 1\)/)
  assert.doesNotMatch(sql, /pg_catalog\.substring\([^)]*\sfrom\s/i)
  assert.match(sql, /\(pg_catalog\.btrim\(item\.value\)::uuid\)::text/)
  assert.match(create, /greatest\(v_left_slot\.slot_start, v_right_slot\.slot_start\) = v_conflict ->> 'overlapStart'/)
  assert.match(create, /least\(v_left_slot\.slot_end, v_right_slot\.slot_end\) = v_conflict ->> 'overlapEnd'/)
  assert.match(create, /if v_teacher_ids <> v_derived_teacher_ids/)
  assert.match(create, /if v_classroom_ids <> v_derived_classroom_ids/)
  assert.match(create, /dashboard_conflict_student_registered_v1/)
  assert.match(create, /pg_catalog\.btrim\(v_left_slot\.teacher_name\) = pg_catalog\.btrim\(v_right_slot\.teacher_name\)/)
  assert.match(create, /pg_catalog\.btrim\(v_left_slot\.classroom_name\) = pg_catalog\.btrim\(v_right_slot\.classroom_name\)/)
  assert.match(sql, /to_regclass\('public\.academic_exam_days'\)/)
  assert.doesNotMatch(sql, /\n\s*from public\.academic_exam_days/)
  const sessionCheck = block(
    sql,
    "create or replace function dashboard_private.dashboard_conflict_class_has_session_v1",
    "create or replace function dashboard_private.dashboard_conflict_json_array_contains_v1",
  )
  assert.match(sessionCheck, /regexp_matches/)
  assert.doesNotMatch(sessionCheck, /strpos\(coalesce\(p_class ->> 'schedule'/)
})

test("충돌 할 일은 전용 helper로 만들며 알림 원본·전송 경로를 전혀 호출하지 않는다", async () => {
  const sql = await source(migrationUrl)
  const create = block(
    sql,
    "create or replace function dashboard_private.create_dashboard_conflict_task_v1_impl",
    "create or replace function public.list_dashboard_conflict_task_links_v1",
  )

  assert.match(create, /insert_ops_task_from_json_v2/)
  assert.doesNotMatch(create, /create_ops_task_v2/)
  assert.doesNotMatch(create, /record_ops_task_notification_source_v2/)
  assert.doesNotMatch(create, /record_notification_event_v1/)
  assert.doesNotMatch(create, /dispatch|provider|delivery|fanout/i)
  assert.match(create, /'type', 'general'/)
  assert.match(create, /'status', 'requested'/)
  assert.match(create, /'priority', 'high'/)
})

test("검증 체크포인트는 두 source-lock 경계에만 있고 service role 전용이다", async () => {
  const sql = await source(migrationUrl)
  const create = block(
    sql,
    "create or replace function dashboard_private.create_dashboard_conflict_task_v1_impl",
    "create or replace function public.list_dashboard_conflict_task_links_v1",
  )

  assert.match(sql, /phase text not null check \(phase in \('before_source_lock', 'after_source_lock'\)\)/)
  assert.match(create, /checkpoint_wait_v1\([\s\S]*p_request_id, 'before_source_lock', v_class_ids::uuid\[\]/)
  assert.match(create, /checkpoint_wait_v1\([\s\S]*p_request_id, 'after_source_lock', v_class_ids::uuid\[\]/)
  assert.match(sql, /arm_dashboard_conflict_checkpoint_v1\([\s\S]*p_class_ids uuid\[\]/)
  assert.match(sql, /pg_catalog\.left\([\s\S]*pg_catalog\.char_length\('__dashboard_conflict_verify__'\)[\s\S]*= '__dashboard_conflict_verify__'/)
  for (const name of ["arm", "get", "release", "disarm"]) {
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}_dashboard_conflict_checkpoint_v1[\\s\\S]*to service_role`))
    assert.match(sql, new RegExp(`function public\\.${name}_dashboard_conflict_checkpoint_v1[\\s\\S]*auth\\.role\\(\\)\\) <> 'service_role'`))
  }
  assert.match(sql, /if not v_scope_match or v_released is not null then return; end if/)
  assert.match(sql, /pg_advisory_xact_lock\(v_lock_key\)/)
  assert.match(sql, /pg_try_advisory_lock\(v_lock_key\)/)
})

test("연결 업무는 모든 삭제 경로보다 먼저 전용 오류로 보호된다", async () => {
  const sql = await source(migrationUrl)

  assert.match(sql, /before delete on public\.ops_tasks/)
  assert.match(sql, /dashboard_conflict_task_delete_forbidden/)
  assert.match(sql, /dashboard_conflict_task_links link where link\.task_id = old\.id/)
})

test("private helper 권한은 authenticated와 service role에서도 닫힌다", async () => {
  const sql = await source(migrationUrl)
  for (const helper of [
    "dashboard_conflict_exam_subjects_for_student_v1",
    "dashboard_conflict_exam_reference_matches_student_v1",
    "dashboard_conflict_student_registered_v1",
    "dashboard_conflict_class_slots_v1",
    "dashboard_conflict_uuid_array_v1",
  ]) {
    assert.match(
      sql,
      new RegExp(`revoke all on function dashboard_private\\.${helper}[\\s\\S]*from public, anon, authenticated, service_role`),
    )
  }
})

test("클라이언트는 표시 문자열을 제외한 source contract만 RPC에 전달한다", async () => {
  const [service, contract] = await Promise.all([source(serviceUrl), source(contractUrl)])

  assert.match(contract, /export type DashboardConflictRpcInput/)
  assert.match(contract, /projectDashboardConflictRpcInput/)
  assert.doesNotMatch(contract, /projectDashboardConflictRpcInput[\s\S]*title:/)
  assert.match(service, /list_dashboard_conflict_task_links_v1/)
  assert.match(service, /create_dashboard_conflict_task_v1/)
  assert.match(service, /runIdempotentOpsTaskProducerRpc/)
  assert.match(service, /clearOpsTaskWorkspaceDataCache\(\)/)
  assert.doesNotMatch(service, /createDashboardConflictTask[\s\S]{0,1000}createOpsTask\(/)
})

test("동시성 verifier는 명시적 실행·로컬 DB·두 연결·provider-zero 증명을 요구한다", async () => {
  const verifier = await source(concurrencyUrl)

  for (const token of [
    "--run",
    "localhost",
    "127.0.0.1",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "DASHBOARD_CONFLICT_ACTOR_TOKEN_A",
    "DASHBOARD_CONFLICT_ACTOR_TOKEN_B",
    "before_source_lock",
    "after_source_lock",
    "dashboard_conflict_stale",
    "get_dashboard_conflict_notification_counts_v1",
    "cleanup_dashboard_conflict_fixture_v1",
    "p_class_ids",
  ]) {
    assert.ok(verifier.includes(token), `동시성 verifier 누락: ${token}`)
  }
  assert.match(verifier, /Promise\.all/)
  assert.match(verifier, /pollCheckpoint[\s\S]*rightPromise[\s\S]*release_dashboard_conflict_checkpoint_v1/)
  assert.match(verifier, /rightBeforeRelease[\s\S]*reached, false[\s\S]*pollCheckpoint\(serviceClient, requestIds\[1\], "before_source_lock"\)/)
  assert.match(verifier, /cleanup_dashboard_conflict_fixture_v1/)
  assert.match(verifier, /create_dashboard_conflict_task_v1/)
  assert.doesNotMatch(verifier, /\.schema\("dashboard_private"\)/)
  assert.match(verifier, /finally/)
})
