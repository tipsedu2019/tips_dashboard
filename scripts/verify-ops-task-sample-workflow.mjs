import { readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createClient } from "@supabase/supabase-js"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const ARGS = new Set(process.argv.slice(2))
const ENABLED = process.env.OPS_SAMPLE_WORKFLOW === "1" || ARGS.has("--run")
const RUN_ID = `codex-${Date.now()}`
const SAMPLE_TAG = "codex-sample-workflow:"
const RUN_TAG = `${SAMPLE_TAG}${RUN_ID}`
const SAMPLE_COUNT = 30
const DEFAULT_LOGIN_EMAIL_DOMAIN = "tipsedu.co.kr"

function loadEnvFile(pathname) {
  try {
    const source = readFileSync(pathname, "utf8")
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match || process.env[match[1]]) continue
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "")
    }
  } catch {
    // Local env files are optional for CI.
  }
}

function getEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim()
    if (value) return value
  }
  return ""
}

function shouldUseCliDriver() {
  const driver = getEnv("OPS_SAMPLE_USE_CLI", "OPS_SAMPLE_DRIVER").toLowerCase()
  return ARGS.has("--cli") || driver === "cli" || driver === "1" || driver === "true"
}

function sqlString(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`
}

function parseSupabaseJsonOutput(stdout) {
  const source = String(stdout || "")
  const start = source.indexOf("{")
  const end = source.lastIndexOf("}")
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Supabase CLI did not return JSON. Output: ${source.slice(0, 500)}`)
  }

  return JSON.parse(source.slice(start, end + 1))
}

function wrapWindowsCmdInvocation(command, args) {
  if (process.platform !== "win32" || !/\.cmd$/i.test(command)) return { command, args }
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", command, ...args],
  }
}

function supabaseCliInvocation(sqlFile) {
  const configuredCli = getEnv("SUPABASE_CLI_PATH", "SUPABASE_CLI")
  const args = ["db", "query", "--linked", "-o", "json", "--file", sqlFile]
  if (configuredCli) return wrapWindowsCmdInvocation(configuredCli, args)
  if (process.platform === "win32") return wrapWindowsCmdInvocation("npx.cmd", ["supabase", ...args])
  return { command: "npx", args: ["supabase", ...args] }
}

function runSupabaseCliQuery(sql) {
  const sqlFile = resolve(tmpdir(), `tips-dashboard-ops-sample-${RUN_ID}.sql`)
  writeFileSync(sqlFile, sql, "utf8")
  const invocation = supabaseCliInvocation(sqlFile)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: Number(getEnv("OPS_SAMPLE_CLI_TIMEOUT_MS") || 90000),
    windowsHide: true,
  })
  try {
    unlinkSync(sqlFile)
  } catch {
    // Temporary SQL files are best-effort cleanup only.
  }

  if (result.status !== 0) {
    throw new Error(
      [
        `Supabase CLI query failed. status=${result.status ?? "null"} signal=${result.signal || "none"}`,
        result.error?.message,
        result.stderr?.trim(),
        result.stdout?.trim(),
      ].filter(Boolean).join("\n"),
    )
  }

  return parseSupabaseJsonOutput(result.stdout)
}

function normalizeLoginLocalPart(value) {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) return ""

  const digits = normalized.replace(/\D/g, "")
  const isPhoneLike = /^[\d\s()+-]+$/.test(normalized)
  if (isPhoneLike && digits.length >= 8) return digits

  return normalized
}

function normalizeLoginIdentifier(value, defaultDomain = DEFAULT_LOGIN_EMAIL_DOMAIN) {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) return ""

  if (normalized.includes("@")) {
    const atIndex = normalized.lastIndexOf("@")
    const localPart = normalized.slice(0, atIndex)
    const domainPart = normalized.slice(atIndex + 1) || defaultDomain
    return `${normalizeLoginLocalPart(localPart)}@${domainPart}`
  }

  return `${normalizeLoginLocalPart(normalized)}@${defaultDomain}`
}

function requireEnabled() {
  if (ENABLED) return true
  console.log("Skipped. Run npm run verify:ops-samples:cli or set OPS_SAMPLE_WORKFLOW=1 to create and clean 30 temporary ops tasks.")
  return false
}

function buildTaskRows(requesterId) {
  const types = [
    ...Array(6).fill("general"),
    ...Array(8).fill("registration"),
    ...Array(5).fill("transfer"),
    ...Array(5).fill("withdrawal"),
    ...Array(6).fill("word_retest"),
  ]

  return types.map((type, index) => {
    const day = dayFromIndex(index)
    return {
      title: `[샘플검증] ${index + 1}. ${taskTypeLabel(type)}`,
      type,
      status: "requested",
      priority: index % 7 === 0 ? "high" : "normal",
      requested_by: requesterId || null,
      student_name: type === "general" ? null : `샘플학생${index + 1}`,
      class_name: type === "general" ? null : index % 2 === 0 ? "샘플 영어반" : "샘플 수학반",
      textbook_title: type === "word_retest" || type === "registration" ? "샘플 교재" : null,
      campus: index % 2 === 0 ? "본관" : "별관",
      subject: type === "word_retest" || index % 2 === 0 ? "영어" : "수학",
      due_at: `2026-08-${day}T09:00:00+09:00`,
      memo: `${RUN_TAG} step=create`,
    }
  })
}

function taskTypeLabel(type) {
  if (type === "registration") return "등록"
  if (type === "transfer") return "전반"
  if (type === "withdrawal") return "퇴원"
  if (type === "word_retest") return "단어 재시험"
  return "할 일"
}

function dayFromIndex(index, offset = 0) {
  return String(1 + ((index + offset) % 24)).padStart(2, "0")
}

function buildDetailRows(tasks) {
  const registration = []
  const withdrawal = []
  const transfer = []
  const wordRetest = []

  tasks.forEach((task, index) => {
    const day = dayFromIndex(index)
    if (task.type === "registration") {
      registration.push({
        task_id: task.id,
        inquiry_channel: "샘플",
        inquiry_at: `2026-08-${day}T10:00:00+09:00`,
        school_grade: "중2",
        school_name: "샘플중",
        parent_phone: "010-0000-0000",
        student_phone: "010-1111-1111",
        level_test_at: `2026-08-${day}T15:00:00+09:00`,
        level_test_place: "본관",
        counselor: "샘플 상담",
        class_start_date: `2026-08-${dayFromIndex(index, 14)}`,
        class_start_session: "1회차",
        pipeline_status: "5. 입학 등록 결정",
        request_note: RUN_TAG,
      })
    }
    if (task.type === "withdrawal") {
      withdrawal.push({
        task_id: task.id,
        school_grade: "고1",
        teacher_name: "샘플 선생님",
        withdrawal_date: `2026-08-${day}`,
        withdrawal_session: "마지막 회차",
        customer_reason: "샘플 검증",
        teacher_opinion: RUN_TAG,
      })
    }
    if (task.type === "transfer") {
      transfer.push({
        task_id: task.id,
        transfer_reason: "샘플 검증",
        from_teacher_name: "전 선생님",
        to_teacher_name: "후 선생님",
        from_class_name: "샘플 이전반",
        to_class_name: "샘플 이동반",
        from_class_end_date: `2026-08-${day}`,
        from_class_end_session: "종료 회차",
        to_class_start_date: `2026-08-${dayFromIndex(index, 12)}`,
        to_class_start_session: "시작 회차",
      })
    }
    if (task.type === "word_retest") {
      wordRetest.push({
        task_id: task.id,
        branch: index % 2 === 0 ? "본관" : "별관",
        teacher_name: "샘플 선생님",
        class_name: "샘플 영어반",
        student_name: task.student_name,
        test_at: `2026-08-${day}T18:00:00+09:00`,
        textbook_name: "샘플 단어장",
        unit: "샘플 1단원",
        request_note: RUN_TAG,
        retest_status: "not_started",
      })
    }
  })

  return { registration, withdrawal, transfer, wordRetest }
}

async function insertRows(supabase, table, rows) {
  if (rows.length === 0) return
  const { error } = await supabase.from(table).insert(rows)
  if (error) throw new Error(`${table} insert failed: ${error.message}`)
}

async function cleanupSamples(supabase, tagPrefix = RUN_TAG) {
  const { data, error } = await supabase
    .from("ops_tasks")
    .select("id")
    .like("memo", `${tagPrefix}%`)

  if (error) throw new Error(`cleanup select failed: ${error.message}`)
  const ids = (data || []).map((row) => row.id).filter(Boolean)
  if (ids.length === 0) return 0

  for (const table of [
    "ops_task_comments",
    "ops_task_events",
    "ops_task_attachments",
    "ops_registration_details",
    "ops_withdrawal_details",
    "ops_transfer_details",
    "ops_word_retests",
  ]) {
    const result = await supabase.from(table).delete().in("task_id", ids)
    if (result.error) throw new Error(`${table} cleanup failed: ${result.error.message}`)
  }

  const result = await supabase.from("ops_tasks").delete().in("id", ids)
  if (result.error) throw new Error(`ops_tasks cleanup failed: ${result.error.message}`)
  return ids.length
}

async function createClientForWorkflow() {
  loadEnvFile(resolve(ROOT, ".env.local"))
  const url = getEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL")
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY")
  const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY")
  const loginId = getEnv("OPS_SAMPLE_LOGIN_ID", "OPS_SAMPLE_EMAIL")
  const email = normalizeLoginIdentifier(loginId)
  const password = getEnv("OPS_SAMPLE_PASSWORD")

  if (!url) throw new Error("Supabase URL is missing.")
  if (serviceRoleKey) {
    return { supabase: createClient(url, serviceRoleKey), userId: "" }
  }
  if (!anonKey || !email || !password) {
    throw new Error("Set SUPABASE_SERVICE_ROLE_KEY or OPS_SAMPLE_LOGIN_ID/OPS_SAMPLE_EMAIL and OPS_SAMPLE_PASSWORD with an anon key.")
  }

  const supabase = createClient(url, anonKey)
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sample auth failed: ${error.message}`)
  return { supabase, userId: data.user?.id || "" }
}

function buildCliWorkflowSql() {
  const tag = sqlString(RUN_TAG)
  return `
create temp table codex_ops_sample_ids(id uuid primary key, task_type text not null) on commit drop;
create temp table codex_ops_sample_result(
  created_count int not null,
  edited_count int not null,
  completed_count int not null,
  detail_count int not null,
  absent_word_retest_count int not null
) on commit drop;

with seed as (
  select
    gs as idx,
    case
      when gs <= 6 then 'general'
      when gs <= 14 then 'registration'
      when gs <= 19 then 'transfer'
      when gs <= 24 then 'withdrawal'
      else 'word_retest'
    end as task_type
  from generate_series(1, ${SAMPLE_COUNT}) as gs
),
inserted as (
  insert into public.ops_tasks(
    title,
    type,
    status,
    priority,
    requested_by,
    student_name,
    class_name,
    textbook_title,
    campus,
    subject,
    due_at,
    memo
  )
  select
    '[샘플검증] ' || idx || '. ' ||
      case task_type
        when 'registration' then '등록'
        when 'transfer' then '전반'
        when 'withdrawal' then '퇴원'
        when 'word_retest' then '단어 재시험'
        else '할 일'
      end,
    task_type,
    'requested',
    case when idx % 7 = 0 then 'high' else 'normal' end,
    null,
    case when task_type = 'general' then null else '샘플학생' || idx end,
    case when task_type = 'general' then null when idx % 2 = 0 then '샘플 영어반' else '샘플 수학반' end,
    case when task_type in ('word_retest', 'registration') then '샘플 교재' else null end,
    case when idx % 2 = 0 then '본관' else '별관' end,
    case when task_type = 'word_retest' or idx % 2 = 0 then '영어' else '수학' end,
    make_timestamptz(2026, 8, 1 + (idx % 24), 9, 0, 0, 'Asia/Seoul'),
    ${tag} || ' step=create idx=' || idx
  from seed
  returning id, type, student_name, class_name, memo
)
insert into codex_ops_sample_ids(id, task_type)
select id, type from inserted;

insert into public.ops_registration_details(
  task_id,
  inquiry_channel,
  inquiry_at,
  school_grade,
  school_name,
  parent_phone,
  student_phone,
  level_test_at,
  level_test_place,
  counselor,
  class_start_date,
  class_start_session,
  pipeline_status,
  request_note
)
select
  t.id,
  '샘플',
  now(),
  '중2',
  '샘플중',
  '010-0000-0000',
  '010-1111-1111',
  now() + interval '2 hours',
  '본관',
  '샘플 상담',
  current_date + interval '7 days',
  '1회차',
  '5. 입학 등록 결정',
  ${tag}
from codex_ops_sample_ids t
where t.task_type = 'registration';

insert into public.ops_withdrawal_details(
  task_id,
  school_grade,
  teacher_name,
  withdrawal_date,
  withdrawal_session,
  customer_reason,
  teacher_opinion
)
select
  t.id,
  '고1',
  '샘플 선생님',
  current_date + interval '3 days',
  '마지막 회차',
  '샘플 검증',
  ${tag}
from codex_ops_sample_ids t
where t.task_type = 'withdrawal';

insert into public.ops_transfer_details(
  task_id,
  transfer_reason,
  from_teacher_name,
  to_teacher_name,
  from_class_name,
  to_class_name,
  from_class_end_date,
  from_class_end_session,
  to_class_start_date,
  to_class_start_session
)
select
  t.id,
  '샘플 검증',
  '전 선생님',
  '후 선생님',
  '샘플 이전반',
  '샘플 이동반',
  current_date + interval '3 days',
  '종료 회차',
  current_date + interval '4 days',
  '시작 회차'
from codex_ops_sample_ids t
where t.task_type = 'transfer';

insert into public.ops_word_retests(
  task_id,
  branch,
  teacher_name,
  class_name,
  student_name,
  test_at,
  textbook_name,
  unit,
  request_note,
  retest_status
)
select
  t.id,
  case when o.campus = '별관' then '별관' else '본관' end,
  '샘플 선생님',
  coalesce(o.class_name, '샘플 영어반'),
  o.student_name,
  now() + interval '5 hours',
  '샘플 단어장',
  '샘플 1단원',
  ${tag},
  'not_started'
from codex_ops_sample_ids t
join public.ops_tasks o on o.id = t.id
where t.task_type = 'word_retest';

create temp table codex_ops_sample_edited as
with edited as (
  update public.ops_tasks
  set status = 'in_progress',
      priority = 'urgent',
      memo = ${tag} || ' step=edit'
  where id in (select id from codex_ops_sample_ids)
  returning id
)
select id from edited;

create temp table codex_ops_sample_completed as
with completed as (
  update public.ops_tasks
  set status = 'done',
      completed_at = now(),
      memo = ${tag} || ' step=complete'
  where id in (select id from codex_ops_sample_ids)
  returning id
)
select id from completed;

create temp table codex_ops_sample_detail_done as
with registration_done as (
  update public.ops_registration_details
  set pipeline_status = '7. 등록 완료',
      textbook_ready = true,
      admission_notice_sent = true,
      payment_checked = true,
      makeedu_registered = true
  where task_id in (select id from codex_ops_sample_ids where task_type = 'registration')
  returning task_id
),
word_retest_target as (
  select id, row_number() over (order by id) as row_no
  from codex_ops_sample_ids
  where task_type = 'word_retest'
),
word_retest_done as (
  update public.ops_word_retests
  set retest_status = case when word_retest_target.row_no = 1 then 'absent' else 'done' end,
      first_score = case when word_retest_target.row_no = 1 then null else 100 end
  from word_retest_target
  where task_id = word_retest_target.id
  returning task_id, retest_status, first_score
)
select task_id, null::text as retest_status, null::numeric as first_score from registration_done
union all
select task_id, retest_status, first_score from word_retest_done;

insert into codex_ops_sample_result(created_count, edited_count, completed_count, detail_count, absent_word_retest_count)
select
  (select count(*) from codex_ops_sample_ids),
  (select count(*) from codex_ops_sample_edited),
  (select count(*) from codex_ops_sample_completed),
  (select count(*) from codex_ops_sample_detail_done),
  (select count(*) from codex_ops_sample_detail_done where retest_status = 'absent' and first_score is null);

create temp table codex_ops_sample_deleted as
with deleted as (
  delete from public.ops_tasks
  where id in (select id from codex_ops_sample_ids)
  returning id
)
select id from deleted;

select
  r.created_count as created,
  r.edited_count as edited,
  r.completed_count as completed,
  r.detail_count as completed_details,
  (select count(*) from codex_ops_sample_deleted) as cleaned,
  (select count(*) from public.ops_tasks where memo like ${tag} || '%') as leftover,
  r.absent_word_retest_count as absent_word_retest,
  ${tag} as run_tag
from codex_ops_sample_result r;
`.trim()
}

function buildCliManagementSyncSql() {
  const tag = sqlString(RUN_TAG)
  const prefix = sqlString(`codex-sync-${RUN_ID}`)
  return `
create temp table codex_ops_management_sync_ids(
  entity text not null,
  label text not null,
  id uuid primary key
) on commit drop;

create temp table codex_ops_management_sync_result(
  registration_student_linked boolean not null,
  registration_textbook_linked boolean not null,
  withdrawal_unlinked boolean not null,
  withdrawal_status_applied boolean not null,
  transfer_removed_from_old_class boolean not null,
  transfer_assigned_to_new_class boolean not null,
  word_retest_links_resolved boolean not null,
  cleaned int not null default 0,
  leftover int not null default 0
) on commit drop;

with generated as (
  select
    gen_random_uuid() as registration_student_id,
    gen_random_uuid() as withdrawal_student_id,
    gen_random_uuid() as transfer_student_id,
    gen_random_uuid() as word_retest_student_id,
    gen_random_uuid() as registration_class_id,
    gen_random_uuid() as withdrawal_class_id,
    gen_random_uuid() as transfer_from_class_id,
    gen_random_uuid() as transfer_to_class_id,
    gen_random_uuid() as word_retest_class_id,
    gen_random_uuid() as registration_textbook_id,
    gen_random_uuid() as word_retest_textbook_id,
    gen_random_uuid() as teacher_id,
    gen_random_uuid() as registration_task_id,
    gen_random_uuid() as withdrawal_task_id,
    gen_random_uuid() as transfer_task_id,
    gen_random_uuid() as word_retest_task_id
)
insert into codex_ops_management_sync_ids(entity, label, id)
select entity, label, id
from generated,
lateral (
  values
    ('student', 'registration_student', registration_student_id),
    ('student', 'withdrawal_student', withdrawal_student_id),
    ('student', 'transfer_student', transfer_student_id),
    ('student', 'word_retest_student', word_retest_student_id),
    ('class', 'registration_class', registration_class_id),
    ('class', 'withdrawal_class', withdrawal_class_id),
    ('class', 'transfer_from_class', transfer_from_class_id),
    ('class', 'transfer_to_class', transfer_to_class_id),
    ('class', 'word_retest_class', word_retest_class_id),
    ('textbook', 'registration_textbook', registration_textbook_id),
    ('textbook', 'word_retest_textbook', word_retest_textbook_id),
    ('teacher', 'word_retest_teacher', teacher_id),
    ('task', 'registration_task', registration_task_id),
    ('task', 'withdrawal_task', withdrawal_task_id),
    ('task', 'transfer_task', transfer_task_id),
    ('task', 'word_retest_task', word_retest_task_id)
) as rows(entity, label, id);

insert into public.teacher_catalogs(id, name, subjects, is_visible, sort_order, dashboard_role)
select id, ${prefix} || '-teacher', array['영어'], true, 9900, 'teacher'
from codex_ops_management_sync_ids
where entity = 'teacher';

insert into public.textbooks(
  id,
  title,
  name,
  subject,
  category,
  publisher,
  price,
  list_price,
  sale_price,
  status,
  is_returnable,
  lessons,
  school_level,
  grade_level,
  sub_subject
)
select
  id,
  ${prefix} || '-' || label,
  ${prefix} || '-' || label,
  '영어',
  '샘플',
  '샘플 출판사',
  10000,
  10000,
  10000,
  'active',
  false,
  '[]'::jsonb,
  '고등',
  '고1',
  '영어'
from codex_ops_management_sync_ids
where entity = 'textbook';

insert into public.classes(
  id,
  name,
  teacher,
  schedule,
  student_ids,
  waitlist_ids,
  textbook_ids,
  room,
  subject,
  grade,
  capacity,
  fee,
  status
)
select
  id,
  ${prefix} || '-' || label,
  ${prefix} || '-teacher',
  '',
  case label
    when 'withdrawal_class' then jsonb_build_array((select id::text from codex_ops_management_sync_ids where label = 'withdrawal_student'))
    when 'transfer_from_class' then jsonb_build_array((select id::text from codex_ops_management_sync_ids where label = 'transfer_student'))
    when 'word_retest_class' then jsonb_build_array((select id::text from codex_ops_management_sync_ids where label = 'word_retest_student'))
    else '[]'::jsonb
  end,
  '[]'::jsonb,
  case label
    when 'word_retest_class' then jsonb_build_array((select id::text from codex_ops_management_sync_ids where label = 'word_retest_textbook'))
    else '[]'::jsonb
  end,
  '본관 1강',
  '영어',
  '고1',
  12,
  0,
  '수강'
from codex_ops_management_sync_ids
where entity = 'class';

insert into public.students(id, name, grade, enroll_date, class_ids, waitlist_class_ids, school, contact, parent_contact, status)
select
  id,
  ${prefix} || '-' || label,
  '고1',
  current_date,
  case label
    when 'withdrawal_student' then jsonb_build_array((select id::text from codex_ops_management_sync_ids where label = 'withdrawal_class'))
    when 'transfer_student' then jsonb_build_array((select id::text from codex_ops_management_sync_ids where label = 'transfer_from_class'))
    when 'word_retest_student' then jsonb_build_array((select id::text from codex_ops_management_sync_ids where label = 'word_retest_class'))
    else '[]'::jsonb
  end,
  '[]'::jsonb,
  '샘플고',
  '010-0000-0000',
  '010-1111-1111',
  '재원'
from codex_ops_management_sync_ids
where entity = 'student';

insert into public.ops_tasks(
  id,
  title,
  type,
  status,
  priority,
  student_id,
  class_id,
  textbook_id,
  student_name,
  class_name,
  textbook_title,
  campus,
  subject,
  due_at,
  memo
)
values
  (
    (select id from codex_ops_management_sync_ids where label = 'registration_task'),
    '[연동검증] 등록',
    'registration',
    'done',
    'normal',
    (select id from codex_ops_management_sync_ids where label = 'registration_student'),
    (select id from codex_ops_management_sync_ids where label = 'registration_class'),
    (select id from codex_ops_management_sync_ids where label = 'registration_textbook'),
    ${prefix} || '-registration_student',
    ${prefix} || '-registration_class',
    ${prefix} || '-registration_textbook',
    '본관',
    '영어',
    now(),
    ${tag} || ' management_sync registration'
  ),
  (
    (select id from codex_ops_management_sync_ids where label = 'withdrawal_task'),
    '[연동검증] 퇴원',
    'withdrawal',
    'done',
    'normal',
    (select id from codex_ops_management_sync_ids where label = 'withdrawal_student'),
    (select id from codex_ops_management_sync_ids where label = 'withdrawal_class'),
    null,
    ${prefix} || '-withdrawal_student',
    ${prefix} || '-withdrawal_class',
    null,
    '본관',
    '영어',
    now(),
    ${tag} || ' management_sync withdrawal'
  ),
  (
    (select id from codex_ops_management_sync_ids where label = 'transfer_task'),
    '[연동검증] 전반',
    'transfer',
    'done',
    'normal',
    (select id from codex_ops_management_sync_ids where label = 'transfer_student'),
    (select id from codex_ops_management_sync_ids where label = 'transfer_to_class'),
    null,
    ${prefix} || '-transfer_student',
    ${prefix} || '-transfer_to_class',
    null,
    '본관',
    '영어',
    now(),
    ${tag} || ' management_sync transfer'
  ),
  (
    (select id from codex_ops_management_sync_ids where label = 'word_retest_task'),
    '[연동검증] 단어 재시험',
    'word_retest',
    'done',
    'normal',
    (select id from codex_ops_management_sync_ids where label = 'word_retest_student'),
    (select id from codex_ops_management_sync_ids where label = 'word_retest_class'),
    (select id from codex_ops_management_sync_ids where label = 'word_retest_textbook'),
    ${prefix} || '-word_retest_student',
    ${prefix} || '-word_retest_class',
    ${prefix} || '-word_retest_textbook',
    '본관',
    '영어',
    now(),
    ${tag} || ' management_sync word_retest'
  );

insert into public.ops_registration_details(
  task_id,
  inquiry_channel,
  inquiry_at,
  school_grade,
  school_name,
  parent_phone,
  student_phone,
  level_test_at,
  level_test_place,
  counselor,
  consultation_at,
  class_start_date,
  class_start_session,
  textbook_ready,
  admission_notice_sent,
  payment_checked,
  makeedu_registered,
  pipeline_status,
  request_note
)
values (
  (select id from codex_ops_management_sync_ids where label = 'registration_task'),
  '샘플',
  now(),
  '고1',
  '샘플고',
  '010-1111-1111',
  '010-0000-0000',
  now(),
  '본관',
  '샘플 상담',
  now(),
  current_date,
  '1회차',
  true,
  true,
  true,
  true,
  '7. 등록 완료',
  ${tag}
);

insert into public.ops_withdrawal_details(
  task_id,
  school_grade,
  teacher_name,
  withdrawal_date,
  withdrawal_session,
  customer_reason,
  teacher_opinion,
  makeedu_withdrawal_done,
  fee_processed,
  textbook_fee_processed
)
values (
  (select id from codex_ops_management_sync_ids where label = 'withdrawal_task'),
  '고1',
  ${prefix} || '-teacher',
  current_date,
  '마지막 회차',
  '샘플 검증',
  ${tag},
  true,
  true,
  true
);

insert into public.ops_transfer_details(
  task_id,
  transfer_reason,
  from_class_id,
  to_class_id,
  from_teacher_name,
  to_teacher_name,
  from_class_name,
  to_class_name,
  from_class_end_date,
  from_class_end_session,
  to_class_start_date,
  to_class_start_session,
  makeedu_transfer_done,
  fee_processed,
  textbook_fee_processed
)
values (
  (select id from codex_ops_management_sync_ids where label = 'transfer_task'),
  '샘플 검증',
  (select id from codex_ops_management_sync_ids where label = 'transfer_from_class'),
  (select id from codex_ops_management_sync_ids where label = 'transfer_to_class'),
  ${prefix} || '-teacher',
  ${prefix} || '-teacher',
  ${prefix} || '-transfer_from_class',
  ${prefix} || '-transfer_to_class',
  current_date,
  '종료 회차',
  current_date,
  '시작 회차',
  true,
  true,
  true
);

insert into public.ops_word_retests(
  task_id,
  branch,
  teacher_catalog_id,
  teacher_name,
  class_name,
  student_name,
  test_at,
  textbook_name,
  unit,
  request_note,
  first_score,
  retest_status
)
values (
  (select id from codex_ops_management_sync_ids where label = 'word_retest_task'),
  '본관',
  (select id from codex_ops_management_sync_ids where label = 'word_retest_teacher'),
  ${prefix} || '-teacher',
  ${prefix} || '-word_retest_class',
  ${prefix} || '-word_retest_student',
  now(),
  ${prefix} || '-word_retest_textbook',
  '1단원',
  ${tag},
  100,
  'done'
);

update public.students
set class_ids = jsonb_build_array((select id::text from codex_ops_management_sync_ids where label = 'registration_class')),
    status = '재원'
where id = (select id from codex_ops_management_sync_ids where label = 'registration_student');

update public.classes
set student_ids = jsonb_build_array((select id::text from codex_ops_management_sync_ids where label = 'registration_student')),
    textbook_ids = jsonb_build_array((select id::text from codex_ops_management_sync_ids where label = 'registration_textbook'))
where id = (select id from codex_ops_management_sync_ids where label = 'registration_class');

insert into public.student_class_enrollment_history(student_id, class_id, action, previous_mode, next_mode, memo)
values (
  (select id from codex_ops_management_sync_ids where label = 'registration_student'),
  (select id from codex_ops_management_sync_ids where label = 'registration_class'),
  'enrolled',
  null,
  'enrolled',
  ${tag} || ' management_sync registration_completed'
);

update public.students
set class_ids = '[]'::jsonb,
    waitlist_class_ids = '[]'::jsonb,
    status = '퇴원'
where id = (select id from codex_ops_management_sync_ids where label = 'withdrawal_student');

update public.classes
set student_ids = '[]'::jsonb,
    waitlist_ids = '[]'::jsonb
where id = (select id from codex_ops_management_sync_ids where label = 'withdrawal_class');

update public.ops_withdrawal_details
set timetable_roster_updated = true
where task_id = (select id from codex_ops_management_sync_ids where label = 'withdrawal_task');

insert into public.student_class_enrollment_history(student_id, class_id, action, previous_mode, next_mode, memo)
values (
  (select id from codex_ops_management_sync_ids where label = 'withdrawal_student'),
  (select id from codex_ops_management_sync_ids where label = 'withdrawal_class'),
  'removed',
  'enrolled',
  null,
  ${tag} || ' management_sync withdrawal_completed'
);

update public.students
set class_ids = jsonb_build_array((select id::text from codex_ops_management_sync_ids where label = 'transfer_to_class')),
    waitlist_class_ids = '[]'::jsonb,
    status = '재원'
where id = (select id from codex_ops_management_sync_ids where label = 'transfer_student');

update public.classes
set student_ids = '[]'::jsonb,
    waitlist_ids = '[]'::jsonb
where id = (select id from codex_ops_management_sync_ids where label = 'transfer_from_class');

update public.classes
set student_ids = jsonb_build_array((select id::text from codex_ops_management_sync_ids where label = 'transfer_student')),
    waitlist_ids = '[]'::jsonb
where id = (select id from codex_ops_management_sync_ids where label = 'transfer_to_class');

update public.ops_transfer_details
set timetable_roster_updated = true
where task_id = (select id from codex_ops_management_sync_ids where label = 'transfer_task');

insert into public.student_class_enrollment_history(student_id, class_id, action, previous_mode, next_mode, memo)
values
  (
    (select id from codex_ops_management_sync_ids where label = 'transfer_student'),
    (select id from codex_ops_management_sync_ids where label = 'transfer_from_class'),
    'removed',
    'enrolled',
    null,
    ${tag} || ' management_sync transfer_from_class'
  ),
  (
    (select id from codex_ops_management_sync_ids where label = 'transfer_student'),
    (select id from codex_ops_management_sync_ids where label = 'transfer_to_class'),
    'enrolled',
    null,
    'enrolled',
    ${tag} || ' management_sync transfer_to_class'
  );

insert into codex_ops_management_sync_result(
  registration_student_linked,
  registration_textbook_linked,
  withdrawal_unlinked,
  withdrawal_status_applied,
  transfer_removed_from_old_class,
  transfer_assigned_to_new_class,
  word_retest_links_resolved
)
select
  coalesce(registration_student.class_ids, '[]'::jsonb) ? registration_class.id::text
    and coalesce(registration_class.student_ids, '[]'::jsonb) ? registration_student.id::text,
  coalesce(registration_class.textbook_ids, '[]'::jsonb) ? registration_textbook.id::text
    and registration_detail.textbook_ready,
  not (coalesce(withdrawal_student.class_ids, '[]'::jsonb) ? withdrawal_class.id::text)
    and not (coalesce(withdrawal_class.student_ids, '[]'::jsonb) ? withdrawal_student.id::text),
  withdrawal_student.status = '퇴원'
    and withdrawal_detail.timetable_roster_updated,
  not (coalesce(transfer_student.class_ids, '[]'::jsonb) ? transfer_from_class.id::text)
    and not (coalesce(transfer_from_class.student_ids, '[]'::jsonb) ? transfer_student.id::text),
  coalesce(transfer_student.class_ids, '[]'::jsonb) ? transfer_to_class.id::text
    and coalesce(transfer_to_class.student_ids, '[]'::jsonb) ? transfer_student.id::text
    and transfer_student.status = '재원'
    and transfer_detail.timetable_roster_updated,
  word_task.student_id = word_student.id
    and word_task.class_id = word_class.id
    and word_task.textbook_id = word_textbook.id
    and word_detail.teacher_catalog_id = word_teacher.id
    and word_detail.retest_status = 'done'
    and word_detail.first_score = 100
from public.students registration_student
join public.classes registration_class on registration_class.id = (select id from codex_ops_management_sync_ids where label = 'registration_class')
join public.textbooks registration_textbook on registration_textbook.id = (select id from codex_ops_management_sync_ids where label = 'registration_textbook')
join public.ops_registration_details registration_detail on registration_detail.task_id = (select id from codex_ops_management_sync_ids where label = 'registration_task')
join public.students withdrawal_student on withdrawal_student.id = (select id from codex_ops_management_sync_ids where label = 'withdrawal_student')
join public.classes withdrawal_class on withdrawal_class.id = (select id from codex_ops_management_sync_ids where label = 'withdrawal_class')
join public.ops_withdrawal_details withdrawal_detail on withdrawal_detail.task_id = (select id from codex_ops_management_sync_ids where label = 'withdrawal_task')
join public.students transfer_student on transfer_student.id = (select id from codex_ops_management_sync_ids where label = 'transfer_student')
join public.classes transfer_from_class on transfer_from_class.id = (select id from codex_ops_management_sync_ids where label = 'transfer_from_class')
join public.classes transfer_to_class on transfer_to_class.id = (select id from codex_ops_management_sync_ids where label = 'transfer_to_class')
join public.ops_transfer_details transfer_detail on transfer_detail.task_id = (select id from codex_ops_management_sync_ids where label = 'transfer_task')
join public.ops_tasks word_task on word_task.id = (select id from codex_ops_management_sync_ids where label = 'word_retest_task')
join public.students word_student on word_student.id = (select id from codex_ops_management_sync_ids where label = 'word_retest_student')
join public.classes word_class on word_class.id = (select id from codex_ops_management_sync_ids where label = 'word_retest_class')
join public.textbooks word_textbook on word_textbook.id = (select id from codex_ops_management_sync_ids where label = 'word_retest_textbook')
join public.teacher_catalogs word_teacher on word_teacher.id = (select id from codex_ops_management_sync_ids where label = 'word_retest_teacher')
join public.ops_word_retests word_detail on word_detail.task_id = word_task.id
where registration_student.id = (select id from codex_ops_management_sync_ids where label = 'registration_student');

with deleted_comments as (
  delete from public.ops_task_comments
  where task_id in (select id from codex_ops_management_sync_ids where entity = 'task')
  returning 1
),
deleted_events as (
  delete from public.ops_task_events
  where task_id in (select id from codex_ops_management_sync_ids where entity = 'task')
  returning 1
),
deleted_attachments as (
  delete from public.ops_task_attachments
  where task_id in (select id from codex_ops_management_sync_ids where entity = 'task')
  returning 1
),
deleted_registration as (
  delete from public.ops_registration_details
  where task_id in (select id from codex_ops_management_sync_ids where entity = 'task')
  returning 1
),
deleted_withdrawal as (
  delete from public.ops_withdrawal_details
  where task_id in (select id from codex_ops_management_sync_ids where entity = 'task')
  returning 1
),
deleted_transfer as (
  delete from public.ops_transfer_details
  where task_id in (select id from codex_ops_management_sync_ids where entity = 'task')
  returning 1
),
deleted_retests as (
  delete from public.ops_word_retests
  where task_id in (select id from codex_ops_management_sync_ids where entity = 'task')
  returning 1
),
deleted_tasks as (
  delete from public.ops_tasks
  where id in (select id from codex_ops_management_sync_ids where entity = 'task')
  returning 1
),
deleted_history as (
  delete from public.student_class_enrollment_history
  where memo like ${tag} || ' management_sync%'
  returning 1
),
deleted_students as (
  delete from public.students
  where id in (select id from codex_ops_management_sync_ids where entity = 'student')
  returning 1
),
deleted_classes as (
  delete from public.classes
  where id in (select id from codex_ops_management_sync_ids where entity = 'class')
  returning 1
),
deleted_textbooks as (
  delete from public.textbooks
  where id in (select id from codex_ops_management_sync_ids where entity = 'textbook')
  returning 1
),
deleted_teachers as (
  delete from public.teacher_catalogs
  where id in (select id from codex_ops_management_sync_ids where entity = 'teacher')
  returning 1
)
update codex_ops_management_sync_result
set cleaned =
  (select count(*) from deleted_comments)
  + (select count(*) from deleted_events)
  + (select count(*) from deleted_attachments)
  + (select count(*) from deleted_registration)
  + (select count(*) from deleted_withdrawal)
  + (select count(*) from deleted_transfer)
  + (select count(*) from deleted_retests)
  + (select count(*) from deleted_tasks)
  + (select count(*) from deleted_history)
  + (select count(*) from deleted_students)
  + (select count(*) from deleted_classes)
  + (select count(*) from deleted_textbooks)
  + (select count(*) from deleted_teachers);

update codex_ops_management_sync_result
set leftover =
  (select count(*) from public.ops_tasks where memo like ${tag} || ' management_sync%')
  + (select count(*) from public.students where name like ${prefix} || '%')
  + (select count(*) from public.classes where name like ${prefix} || '%')
  + (select count(*) from public.textbooks where name like ${prefix} || '%')
  + (select count(*) from public.teacher_catalogs where name like ${prefix} || '%')
  + (select count(*) from public.student_class_enrollment_history where memo like ${tag} || ' management_sync%');

select
  registration_student_linked,
  registration_textbook_linked,
  withdrawal_unlinked,
  withdrawal_status_applied,
  transfer_removed_from_old_class,
  transfer_assigned_to_new_class,
  word_retest_links_resolved,
  cleaned,
  leftover
from codex_ops_management_sync_result;
`.trim()
}

function cleanupCliSamples() {
  const tag = sqlString(RUN_TAG)
  const prefix = sqlString(`codex-sync-${RUN_ID}`)
  runSupabaseCliQuery(`
delete from public.ops_task_comments
where task_id in (select id from public.ops_tasks where memo like ${tag} || '%');

delete from public.ops_task_events
where task_id in (select id from public.ops_tasks where memo like ${tag} || '%');

delete from public.ops_task_attachments
where task_id in (select id from public.ops_tasks where memo like ${tag} || '%');

delete from public.ops_registration_details
where task_id in (select id from public.ops_tasks where memo like ${tag} || '%');

delete from public.ops_withdrawal_details
where task_id in (select id from public.ops_tasks where memo like ${tag} || '%');

delete from public.ops_transfer_details
where task_id in (select id from public.ops_tasks where memo like ${tag} || '%');

delete from public.ops_word_retests
where task_id in (select id from public.ops_tasks where memo like ${tag} || '%');

delete from public.ops_tasks
where memo like ${tag} || '%';

delete from public.student_class_enrollment_history
where memo like ${tag} || ' management_sync%';

delete from public.students
where name like ${prefix} || '%';

delete from public.classes
where name like ${prefix} || '%';

delete from public.textbooks
where name like ${prefix} || '%';

delete from public.teacher_catalogs
where name like ${prefix} || '%';

select count(*)::int as leftover
from public.ops_tasks
where memo like ${tag} || '%';
  `.trim())
}

function cleanupCliStaleSamples() {
  const tag = sqlString(SAMPLE_TAG)
  runSupabaseCliQuery(`
delete from public.ops_task_comments
where task_id in (select id from public.ops_tasks where memo like ${tag} || '%');

delete from public.ops_task_events
where task_id in (select id from public.ops_tasks where memo like ${tag} || '%');

delete from public.ops_task_attachments
where task_id in (select id from public.ops_tasks where memo like ${tag} || '%');

delete from public.ops_registration_details
where task_id in (select id from public.ops_tasks where memo like ${tag} || '%');

delete from public.ops_withdrawal_details
where task_id in (select id from public.ops_tasks where memo like ${tag} || '%');

delete from public.ops_transfer_details
where task_id in (select id from public.ops_tasks where memo like ${tag} || '%');

delete from public.ops_word_retests
where task_id in (select id from public.ops_tasks where memo like ${tag} || '%');

delete from public.ops_tasks
where memo like ${tag} || '%';

select count(*)::int as leftover
from public.ops_tasks
where memo like ${tag} || '%';
  `.trim())
}

async function runCliWorkflow() {
  try {
    cleanupCliStaleSamples()
    const result = runSupabaseCliQuery(buildCliWorkflowSql())
    const row = result.rows?.[0] || {}
    const created = Number(row.created || 0)
    const edited = Number(row.edited || 0)
    const completed = Number(row.completed || 0)
    const cleaned = Number(row.cleaned || 0)
    const leftover = Number(row.leftover || 0)
    const absentWordRetest = Number(row.absent_word_retest || 0)
    if (created !== SAMPLE_COUNT || edited !== SAMPLE_COUNT || completed !== SAMPLE_COUNT || cleaned !== SAMPLE_COUNT || leftover !== 0 || absentWordRetest !== 1) {
      throw new Error(`Expected ${SAMPLE_COUNT} clean CLI samples, got ${JSON.stringify(row)}`)
    }
    const management = runSupabaseCliQuery(buildCliManagementSyncSql()).rows?.[0] || {}
    const requiredManagementFlags = [
      "registration_student_linked",
      "registration_textbook_linked",
      "withdrawal_unlinked",
      "withdrawal_status_applied",
      "transfer_removed_from_old_class",
      "transfer_assigned_to_new_class",
      "word_retest_links_resolved",
    ]
    const failedManagementFlags = requiredManagementFlags.filter((flag) => management[flag] !== true && management[flag] !== "true")
    if (!management.registration_student_linked || !management.registration_textbook_linked ||
      !management.withdrawal_unlinked ||
      !management.withdrawal_status_applied ||
      !management.transfer_removed_from_old_class ||
      !management.transfer_assigned_to_new_class ||
      !management.word_retest_links_resolved ||
      failedManagementFlags.length > 0 ||
      Number(management.leftover || 0) !== 0
    ) {
      throw new Error(`Expected clean management sync samples, got ${JSON.stringify(management)}`)
    }
    console.log(JSON.stringify({ ok: true, driver: "cli", ...row, management_sync: management, runId: RUN_ID }, null, 2))
  } catch (error) {
    try {
      cleanupCliSamples()
    } catch (cleanupError) {
      console.error(`CLI cleanup after failure failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
    }
    throw error
  }
}

async function run() {
  if (!requireEnabled()) return
  if (shouldUseCliDriver()) {
    await runCliWorkflow()
    return
  }
  const { supabase, userId } = await createClientForWorkflow()
  let createdCount = 0

  try {
    await cleanupSamples(supabase, SAMPLE_TAG)
    const taskRows = buildTaskRows(userId)
    const { data: createdTasks, error: taskError } = await supabase
      .from("ops_tasks")
      .insert(taskRows)
      .select("id,type,student_name")

    if (taskError) throw new Error(`ops_tasks insert failed: ${taskError.message}`)
    if ((createdTasks || []).length !== SAMPLE_COUNT) throw new Error(`Expected ${SAMPLE_COUNT} created tasks.`)
    createdCount = createdTasks.length

    const details = buildDetailRows(createdTasks)
    await insertRows(supabase, "ops_registration_details", details.registration)
    await insertRows(supabase, "ops_withdrawal_details", details.withdrawal)
    await insertRows(supabase, "ops_transfer_details", details.transfer)
    await insertRows(supabase, "ops_word_retests", details.wordRetest)

    const taskIds = createdTasks.map((task) => task.id)
    const editResult = await supabase
      .from("ops_tasks")
      .update({ status: "in_progress", priority: "urgent", memo: `${RUN_TAG} step=edit` })
      .in("id", taskIds)
    if (editResult.error) throw new Error(`ops_tasks edit failed: ${editResult.error.message}`)

    const completeResult = await supabase
      .from("ops_tasks")
      .update({ status: "done", completed_at: new Date().toISOString(), memo: `${RUN_TAG} step=complete` })
      .in("id", taskIds)
    if (completeResult.error) throw new Error(`ops_tasks complete failed: ${completeResult.error.message}`)

    const registrationIds = createdTasks.filter((task) => task.type === "registration").map((task) => task.id)
    const wordRetestIds = createdTasks.filter((task) => task.type === "word_retest").map((task) => task.id)

    if (registrationIds.length > 0) {
      const result = await supabase
        .from("ops_registration_details")
        .update({
          pipeline_status: "7. 등록 완료",
          textbook_ready: true,
          admission_notice_sent: true,
          payment_checked: true,
          makeedu_registered: true,
        })
        .in("task_id", registrationIds)
      if (result.error) throw new Error(`registration complete failed: ${result.error.message}`)
    }

    if (wordRetestIds.length > 0) {
      const result = await supabase
        .from("ops_word_retests")
        .update({ retest_status: "done", first_score: 100 })
        .in("task_id", wordRetestIds)
      if (result.error) throw new Error(`word retest complete failed: ${result.error.message}`)

      const absentResult = await supabase
        .from("ops_word_retests")
        .update({ retest_status: "absent", first_score: null, second_score: null, third_score: null })
        .eq("task_id", wordRetestIds[0])
      if (absentResult.error) throw new Error(`word retest absent failed: ${absentResult.error.message}`)
    }

    const { count: absentWordRetestCount, error: absentWordRetestError } = wordRetestIds.length > 0
      ? await supabase
        .from("ops_word_retests")
        .select("task_id", { count: "exact", head: true })
        .eq("task_id", wordRetestIds[0])
        .eq("retest_status", "absent")
        .is("first_score", null)
      : { count: 0, error: null }
    if (absentWordRetestError) throw new Error(`word retest absent verification failed: ${absentWordRetestError.message}`)

    const { count, error: countError } = await supabase
      .from("ops_tasks")
      .select("id", { count: "exact", head: true })
      .like("memo", `${RUN_TAG}%`)
      .eq("status", "done")
    if (countError) throw new Error(`verification count failed: ${countError.message}`)
    if (count !== SAMPLE_COUNT) throw new Error(`Expected ${SAMPLE_COUNT} completed samples, found ${count}.`)

    const removedCount = await cleanupSamples(supabase, RUN_TAG)
    if (removedCount !== SAMPLE_COUNT) throw new Error(`Expected cleanup ${SAMPLE_COUNT}, removed ${removedCount}.`)
    const leftoverCount = await cleanupSamples(supabase, RUN_TAG)
    if (leftoverCount !== 0) throw new Error(`Expected no remaining samples, found ${leftoverCount}.`)

    console.log(JSON.stringify({ ok: true, created: createdCount, completed: count, cleaned: removedCount, leftover: leftoverCount, absent_word_retest: absentWordRetestCount || 0, runId: RUN_ID }, null, 2))
  } catch (error) {
    try {
      await cleanupSamples(supabase)
    } catch (cleanupError) {
      console.error(`cleanup after failure failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
    }
    throw error
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
