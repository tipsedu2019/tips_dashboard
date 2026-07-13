import { readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
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

const SUBJECT_TRACK_SAMPLES = [
  {
    name: "same-day dual level test",
    tracks: [
      { id: "english", subject: "영어", status: "level_test_scheduled" },
      { id: "math", subject: "수학", status: "level_test_scheduled" },
    ],
    appointments: [{ id: "level-test-1", kind: "level_test", trackIds: ["english", "math"], startsAt: "2026-07-14T10:00:00+09:00" }],
  },
  {
    name: "split visit and phone consultation",
    tracks: [
      { id: "english", subject: "영어", status: "visit_consultation_scheduled" },
      { id: "math", subject: "수학", status: "consultation_waiting" },
    ],
  },
  {
    name: "partial registration with later batch",
    tracks: [
      { id: "english", subject: "영어", status: "registered" },
      { id: "math", subject: "수학", status: "enrollment_processing" },
    ],
    batches: [
      { id: "batch-1", revision: 1, status: "completed", trackIds: ["english"] },
      { id: "batch-2", revision: 2, status: "open", trackIds: ["math"] },
    ],
  },
  {
    name: "multiple English classes",
    tracks: [{ id: "english", subject: "영어", status: "enrollment_processing" }],
    enrollments: [
      { trackId: "english", classId: "eng-a" },
      { trackId: "english", classId: "eng-special" },
    ],
  },
]

function getSubjectTrackTabCounts(tracks) {
  const counts = { inquiry: 0, level_test: 0, consulting: 0, waiting: 0, enrollment: 0, closed: 0 }
  for (const track of tracks) {
    const status = String(track.status || "")
    const tab = status === "inquiry" || status === "migration_review"
      ? "inquiry"
      : status.startsWith("level_test_")
        ? "level_test"
        : status.startsWith("consultation_") || status.startsWith("visit_consultation_")
          ? "consulting"
          : status === "waiting"
            ? "waiting"
            : status === "enrollment_decided" || status === "enrollment_processing"
              ? "enrollment"
              : "closed"
    counts[tab] += 1
  }
  return counts
}

function verifySubjectTrackSamples() {
  const byName = Object.fromEntries(SUBJECT_TRACK_SAMPLES.map((sample) => [sample.name, sample]))
  const dual = byName["same-day dual level test"]
  const split = byName["split visit and phone consultation"]
  const partial = byName["partial registration with later batch"]
  const multiple = byName["multiple English classes"]

  const tabCounts = getSubjectTrackTabCounts(dual.tracks)
  if (tabCounts.level_test !== 2) {
    throw new Error("subject-track tab mapping is not independent")
  }
  if (dual.appointments[0].trackIds.join(",") !== "english,math") {
    throw new Error("same-day level-test appointment lost a subject")
  }
  const transitioned = dual.tracks.map((track) => track.id === "english" ? { ...track, status: "consultation_waiting" } : track)
  if (transitioned[0].status !== "consultation_waiting" || transitioned[1].status !== "level_test_scheduled") {
    throw new Error("one subject transition changed its sibling")
  }
  if (split.tracks[0].status !== "visit_consultation_scheduled" || split.tracks[1].status !== "consultation_waiting") {
    throw new Error("split consultation modes were not preserved")
  }
  if (partial.batches[0].revision !== 1 || partial.batches[1].revision !== 2 || partial.batches[1].trackIds[0] !== "math") {
    throw new Error("later subject did not receive a fresh batch revision")
  }
  if (multiple.enrollments.length !== 2 || new Set(multiple.enrollments.map((row) => row.classId)).size !== 2) {
    throw new Error("multiple classes did not remain separate enrollment rows")
  }

  const result = { subjectTrackSamples: SUBJECT_TRACK_SAMPLES.length, network: false }
  console.log(JSON.stringify(result))
  return result
}

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
  const databaseUrl = getEnv("OPS_SAMPLE_DB_URL")
  if (!databaseUrl) throw new Error("CLI verification requires OPS_SAMPLE_DB_URL for the exact disposable local database.")
  if (getEnv("OPS_FIXTURE_DATABASE_SCOPE").toLowerCase() !== "local") {
    throw new Error("CLI verification requires OPS_FIXTURE_DATABASE_SCOPE=local; linked and remote preview targets are not accepted.")
  }
  assertAuthorizedLocalFixtureDatabase(databaseUrl)
  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error("OPS_SAMPLE_DB_URL must be a PostgreSQL URL.")
  const args = ["db", "query", "--db-url", databaseUrl, "-o", "json", "--file", sqlFile]
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

function assertAuthorizedLocalFixtureDatabase(url) {
  const scope = getEnv("OPS_FIXTURE_DATABASE_SCOPE").toLowerCase()
  const disposable = ["1", "true", "yes"].includes(getEnv("OPS_FIXTURE_DISPOSABLE").toLowerCase())
  if (!disposable || scope !== "local") {
    throw new Error("Roster verification is audit-bearing and may run only on an explicitly authorized localhost database. Set OPS_FIXTURE_DISPOSABLE=1 and OPS_FIXTURE_DATABASE_SCOPE=local.")
  }
  const localDatabaseUrl = getEnv("OPS_SAMPLE_DB_URL")
  if (!localDatabaseUrl) {
    throw new Error("Roster verification requires OPS_SAMPLE_DB_URL for the exact disposable localhost database.")
  }
  const allowedHosts = new Set(["127.0.0.1", "localhost", "::1"])
  const target = new URL(url)
  const database = new URL(localDatabaseUrl)
  if (!allowedHosts.has(target.hostname) || !allowedHosts.has(database.hostname)) {
    throw new Error("Remote and production targets are denied; both the Supabase URL and OPS_SAMPLE_DB_URL must use localhost.")
  }
  if (!/^postgres(?:ql)?:$/.test(database.protocol)) {
    throw new Error("OPS_SAMPLE_DB_URL must be a PostgreSQL URL.")
  }
  return "local"
}

function normalizeRosterIds(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].sort()
}

function sortRosterPairs(pairs) {
  return [...pairs].sort((left, right) =>
    `${left.studentId}:${left.classId}`.localeCompare(`${right.studentId}:${right.classId}`),
  )
}

function assertCommittedRosterResponse(committed, { studentId, classId, expectedMode, nextMode }) {
  if (!committed || typeof committed !== "object" || Array.isArray(committed)) {
    throw new Error("Roster RPC did not return a committed object.")
  }
  if (
    String(committed.studentId || "") !== studentId ||
    String(committed.classId || "") !== classId ||
    committed.previousMode !== expectedMode ||
    committed.nextMode !== nextMode ||
    committed.changed !== (expectedMode !== nextMode)
  ) {
    throw new Error(`Roster RPC response mismatch: ${JSON.stringify(committed)}`)
  }
  for (const field of ["studentClassIds", "studentWaitlistClassIds", "classStudentIds", "classWaitlistIds"]) {
    if (!Array.isArray(committed[field]) || JSON.stringify(committed[field]) !== JSON.stringify(normalizeRosterIds(committed[field]))) {
      throw new Error(`Roster RPC ${field} projection is not a sorted array.`)
    }
  }
  return committed
}

async function readRosterProjection(client, studentId, classId) {
  const [studentResult, classResult] = await Promise.all([
    client.from("students").select("id,class_ids,waitlist_class_ids").eq("id", studentId).maybeSingle(),
    client.from("classes").select("id,student_ids,waitlist_ids").eq("id", classId).maybeSingle(),
  ])
  if (studentResult.error) throw new Error(`student roster read failed: ${studentResult.error.message}`)
  if (classResult.error) throw new Error(`class roster read failed: ${classResult.error.message}`)
  if (!studentResult.data || !classResult.data) throw new Error("Roster fixture pair was not found.")
  return {
    studentClassIds: normalizeRosterIds(studentResult.data.class_ids),
    studentWaitlistClassIds: normalizeRosterIds(studentResult.data.waitlist_class_ids),
    classStudentIds: normalizeRosterIds(classResult.data.student_ids),
    classWaitlistIds: normalizeRosterIds(classResult.data.waitlist_ids),
  }
}

function rosterModeFromProjection(projection, studentId, classId) {
  const enrolled = projection.studentClassIds.includes(classId) && projection.classStudentIds.includes(studentId)
  const waitlisted = projection.studentWaitlistClassIds.includes(classId) && projection.classWaitlistIds.includes(studentId)
  const asymmetric =
    projection.studentClassIds.includes(classId) !== projection.classStudentIds.includes(studentId) ||
    projection.studentWaitlistClassIds.includes(classId) !== projection.classWaitlistIds.includes(studentId)
  if (asymmetric || (enrolled && waitlisted)) throw new Error("Roster fixture projection is asymmetric.")
  return enrolled ? "enrolled" : waitlisted ? "waitlist" : "removed"
}

async function verifyRosterProjection(client, { studentId, classId, nextMode }, committed) {
  const projection = await readRosterProjection(client, studentId, classId)
  if (rosterModeFromProjection(projection, studentId, classId) !== nextMode) {
    throw new Error(`Roster projection did not commit ${nextMode}.`)
  }
  for (const field of ["studentClassIds", "studentWaitlistClassIds", "classStudentIds", "classWaitlistIds"]) {
    if (JSON.stringify(projection[field]) !== JSON.stringify(normalizeRosterIds(committed[field]))) {
      throw new Error(`Roster ${field} did not match the committed RPC response.`)
    }
  }
  return projection
}

async function setRosterMode(authenticatedRosterClient, { studentId, classId, expectedMode, nextMode, memo }) {
  const result = await authenticatedRosterClient.rpc("set_student_class_roster_mode", {
    p_student_id: studentId,
    p_class_id: classId,
    p_expected_mode: expectedMode,
    p_next_mode: nextMode,
    p_memo: memo,
  })
  if (result.error) throw new Error(`set_student_class_roster_mode failed: ${result.error.message}`)
  const committed = assertCommittedRosterResponse(result.data, { studentId, classId, expectedMode, nextMode })
  await verifyRosterProjection(authenticatedRosterClient, { studentId, classId, nextMode }, committed)
  return committed
}

async function removeRosterPairs(authenticatedRosterClient, pairs, memo) {
  for (const pair of sortRosterPairs(pairs)) {
    const projection = await readRosterProjection(authenticatedRosterClient, pair.studentId, pair.classId)
    const expectedMode = rosterModeFromProjection(projection, pair.studentId, pair.classId)
    await setRosterMode(authenticatedRosterClient, {
      ...pair,
      expectedMode,
      nextMode: "removed",
      memo,
    })
  }
}

async function archiveAuditFixtures(setupClient, { studentIds, classIds, prefix }) {
  const archivedName = `[ARCHIVED] ${prefix}`
  const studentResult = await setupClient.from("students").update({ name: `${archivedName} student`, status: "퇴원" }).in("id", studentIds)
  if (studentResult.error) throw new Error(`student archive failed: ${studentResult.error.message}`)
  const classResult = await setupClient.from("classes").update({ name: `${archivedName} class`, status: "종강" }).in("id", classIds)
  if (classResult.error) throw new Error(`class archive failed: ${classResult.error.message}`)
  const [activeStudents, activeClasses, history] = await Promise.all([
    setupClient.from("students").select("id", { count: "exact", head: true }).ilike("name", `${prefix}%`),
    setupClient.from("classes").select("id", { count: "exact", head: true }).ilike("name", `${prefix}%`),
    setupClient.from("student_class_enrollment_history").select("id", { count: "exact", head: true }).like("memo", `${RUN_TAG} roster%`),
  ])
  for (const result of [activeStudents, activeClasses, history]) {
    if (result.error) throw new Error(`archive verification failed: ${result.error.message}`)
  }
  return {
    activeFixtureRows: Number(activeStudents.count || 0) + Number(activeClasses.count || 0),
    auditHistoryRetained: Number(history.count || 0),
  }
}

function printAuditFixtureResetInstruction(scope) {
  console.log(`Audit-bearing roster fixtures were archived on the disposable localhost database (${scope}). Cleanup: pnpm dlx supabase@2.109.1 db reset.`)
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
  const databaseScope = assertAuthorizedLocalFixtureDatabase(url)
  if (!anonKey || !email || !password) {
    throw new Error("Ready-mode roster verification requires OPS_SAMPLE_LOGIN_ID/OPS_SAMPLE_EMAIL and OPS_SAMPLE_PASSWORD for an independent authenticated admin/staff client.")
  }

  const authenticatedRosterClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await authenticatedRosterClient.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sample auth failed: ${error.message}`)
  const workflowClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const workflowAuth = await workflowClient.auth.signInWithPassword({ email, password })
  if (workflowAuth.error) throw new Error(`sample workflow auth failed: ${workflowAuth.error.message}`)
  const setupClient = serviceRoleKey
    ? createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  if (!serviceRoleKey) {
    const setupAuth = await setupClient.auth.signInWithPassword({ email, password })
    if (setupAuth.error) throw new Error(`sample setup auth failed: ${setupAuth.error.message}`)
  }
  return { supabase: workflowClient, setupClient, authenticatedRosterClient, userId: data.user?.id || "", databaseScope }
}

async function runReadyModeRosterSample({ setupClient, authenticatedRosterClient, databaseScope }) {
  const prefix = `codex-roster-${RUN_ID}`
  const pairs = ["enrolled", "waitlist", "removed"].map((label) => ({
    label,
    studentId: randomUUID(),
    classId: randomUUID(),
  }))
  const studentIds = pairs.map((pair) => pair.studentId)
  const classIds = pairs.map((pair) => pair.classId)
  let seeded = false
  let rosterPairsReady = false
  let workflowError = null

  try {
    const studentResult = await setupClient.from("students").insert(pairs.map((pair) => ({
      id: pair.studentId,
      name: `${prefix}-${pair.label}-student`,
      grade: "고1",
      enroll_date: "2026-07-13",
      class_ids: [],
      waitlist_class_ids: [],
      school: "검증고",
      contact: "010-0000-0000",
      parent_contact: "010-0000-0000",
      status: "재원",
    })))
    if (studentResult.error) throw new Error(`roster student seed failed: ${studentResult.error.message}`)
    seeded = true
    const classResult = await setupClient.from("classes").insert(pairs.map((pair) => ({
      id: pair.classId,
      name: `${prefix}-${pair.label}-class`,
      teacher: "검증",
      schedule: "",
      student_ids: [],
      waitlist_ids: [],
      textbook_ids: [],
      room: "검증",
      subject: "영어",
      grade: "고1",
      capacity: 12,
      fee: 0,
      status: "수강",
    })))
    if (classResult.error) throw new Error(`roster class seed failed: ${classResult.error.message}`)
    rosterPairsReady = true

    await setRosterMode(authenticatedRosterClient, { ...pairs[0], expectedMode: "removed", nextMode: "enrolled", memo: `${RUN_TAG} roster enrolled` })
    await setRosterMode(authenticatedRosterClient, { ...pairs[1], expectedMode: "removed", nextMode: "waitlist", memo: `${RUN_TAG} roster waitlist` })
    await setRosterMode(authenticatedRosterClient, { ...pairs[2], expectedMode: "removed", nextMode: "enrolled", memo: `${RUN_TAG} roster removed setup` })
    await setRosterMode(authenticatedRosterClient, { ...pairs[2], expectedMode: "enrolled", nextMode: "removed", memo: `${RUN_TAG} roster removed` })
  } catch (error) {
    workflowError = error
  } finally {
    if (rosterPairsReady) {
      try {
        await removeRosterPairs(authenticatedRosterClient, pairs, `${RUN_TAG} roster cleanup`)
      } catch (cleanupError) {
        workflowError = new AggregateError([workflowError, cleanupError].filter(Boolean), "Roster sample or cleanup failed.")
      }
    }
  }

  const archive = seeded
    ? await archiveAuditFixtures(setupClient, { studentIds, classIds, prefix })
    : { activeFixtureRows: 0, auditHistoryRetained: 0 }
  printAuditFixtureResetInstruction(databaseScope)
  if (workflowError) throw workflowError
  if (archive.activeFixtureRows !== 0 || archive.auditHistoryRetained < 4) {
    throw new Error(`Roster audit cleanup mismatch: ${JSON.stringify(archive)}`)
  }
  return archive
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
      makeedu_registered = true,
      makeedu_invoice_sent = true,
      payment_checked = true
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


function cleanupCliSamples() {
  const tag = sqlString(RUN_TAG)
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
  const clients = await createClientForWorkflow()
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
    const management = await runReadyModeRosterSample(clients)
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
  verifySubjectTrackSamples()
  if (!requireEnabled()) return
  if (shouldUseCliDriver()) {
    await runCliWorkflow()
    return
  }
  const clients = await createClientForWorkflow()
  const { supabase, userId } = clients
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
          makeedu_registered: true,
          makeedu_invoice_sent: true,
          payment_checked: true,
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

    const management = await runReadyModeRosterSample(clients)
    console.log(JSON.stringify({ ok: true, created: createdCount, completed: count, cleaned: removedCount, leftover: leftoverCount, absent_word_retest: absentWordRetestCount || 0, management_sync: management, runId: RUN_ID }, null, 2))
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
