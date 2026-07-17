#!/usr/bin/env node

import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

const PLANNED_SCENARIOS = [
  "student identity: two admins materialize one normalized student",
  "appointment revision: two admins produce one notification source revision and one job set",
  "batch start versus enrollment row cancellation has one winner",
  "batch start versus generic roster claim on the same student/class has one owner",
  "batch completion versus generic roster update on another class preserves both relationships",
  "two registration cases racing for one student/class claim have one winner",
  "invoice/payment repeats preserve the first audit timestamps",
  "message claim versus identity edit and two message claims never send twice",
  "message finalizer acceptance versus failed-hold reconciliation preserves accepted precedence",
  "consultation ownership reassignment defeats the former director completion",
  "withdrawal versus batch/wait materialization: deterministic checkpoints prove both SQL lock orders",
  "withdrawal final invariant leaves no withdrawn student with a live roster claim",
]

const PROVIDER_API_PATHS = [
  "/api/google-chat",
  "/api/web-push",
  "/api/solapi",
]

const REQUIRED_VALUE_FLAGS = [
  "--url",
  "--anon-key",
  "--service-role-key",
  "--admin-token",
  "--second-admin-token",
]

const RUNTIME_LIMITATIONS = [
  "Runtime proof remains pending until this unapplied migration is installed on an authorized local or preview database.",
]

const cleanupTablesInReverseForeignKeyOrder = [
  "ops_registration_messages",
  "ops_registration_consultations",
  "ops_registration_level_tests",
  "ops_registration_enrollments",
  "ops_registration_admission_batches",
  "ops_registration_appointments",
  "ops_registration_subject_tracks",
  "ops_registration_details",
  "ops_withdrawal_details",
  "ops_task_events",
  "ops_task_comments",
  "ops_task_attachments",
  "ops_tasks",
  "student_class_enrollment_history",
  "students",
  "classes",
  "textbooks",
]

function optionValue(argv, flag) {
  const index = argv.indexOf(flag)
  if (index === -1 || !argv[index + 1] || argv[index + 1].startsWith("--")) {
    throw new Error(`Missing required ${flag}`)
  }
  return argv[index + 1]
}

function assertAuthorizedTarget(rawUrl) {
  const url = new URL(rawUrl)
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])
  const knownProductionHosts = new Set(["slnjqlzzhewblvttiidk.supabase.co"])
  const supabaseHostSuffix = ".supabase.co"
  const projectRef = url.hostname.endsWith(supabaseHostSuffix)
    ? url.hostname.slice(0, -supabaseHostSuffix.length)
    : ""
  const isLocalTarget = localHosts.has(url.hostname)
    && ["http:", "https:"].includes(url.protocol)
  const isSupabasePreviewTarget = url.protocol === "https:"
    && url.hostname.endsWith(".supabase.co")
    && /^[a-z0-9]{20}$/.test(projectRef)
    && !knownProductionHosts.has(url.hostname)
  if (knownProductionHosts.has(url.hostname)) {
    throw new Error("Production target abort: concurrency verification is local/preview only")
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Target URL abort: use a credential-free root Supabase URL")
  }
  if (!isLocalTarget && !isSupabasePreviewTarget) {
    throw new Error("Unrecognized target abort: use localhost or an exact HTTPS Supabase preview project URL")
  }
  return url.toString().replace(/\/$/, "")
}

function decodeJwtSubject(token) {
  const parts = token.split(".")
  if (parts.length !== 3) throw new Error("Admin token is not a JWT")
  let payload
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
  } catch {
    throw new Error("Admin token has an invalid JWT payload")
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("Admin token is missing its actor subject")
  }
  return payload.sub
}

function createAuthenticatedClient(url, anonKey, accessToken) {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

function createServiceClient(url, serviceRoleKey) {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

function createRaceBarrier(parties) {
  let arrivals = 0
  let release
  const ready = new Promise((resolve) => { release = resolve })
  return async function waitAtBarrier() {
    arrivals += 1
    if (arrivals === parties) release()
    await ready
  }
}

async function raceCalls(calls) {
  const barrier = createRaceBarrier(calls.length)
  return Promise.allSettled(calls.map(async (call) => {
    await barrier()
    return call()
  }))
}

function fulfilled(results) {
  return results.filter((result) => result.status === "fulfilled").map((result) => result.value)
}

function rejected(results) {
  return results.filter((result) => result.status === "rejected")
}

function assertExactlyOneWinner(results, label) {
  assert.equal(fulfilled(results).length, 1, `${label}: expected one committed winner`)
  assert.equal(rejected(results).length, results.length - 1, `${label}: expected all other requests to reject`)
  return fulfilled(results)[0]
}

function assertProviderZero(context, stage) {
  assert.equal(
    context.providerCallLedger.length,
    0,
    `${stage}: provider calls must remain zero (${PROVIDER_API_PATHS.join(", ")})`,
  )
}

function requestKey(fixture, lane) {
  return `${fixture.namespacePrefix}:${lane}:${randomUUID()}`
}

function checkpointKey(checkpoint) {
  return `${checkpoint.operationKind}:${checkpoint.taskId}:${checkpoint.studentId}`
}

async function rpc(client, name, args, label = name) {
  const { data, error } = await client.rpc(name, args)
  if (error) {
    const failure = new Error(`${label} failed: ${error.message}`)
    failure.code = error.code
    failure.details = error.details
    throw failure
  }
  return data
}

async function armRegistrationVerificationCheckpoint(context, checkpoint) {
  const result = await rpc(context.serviceRoleSetupClient, "arm_registration_verification_checkpoint", {
    p_operation_kind: checkpoint.operationKind,
    p_task_id: checkpoint.taskId,
    p_student_id: checkpoint.studentId,
  })
  assert.equal(result.status, "armed")
  context.fixture.checkpoints.set(checkpointKey(checkpoint), { ...checkpoint, released: false })
  return result
}

async function waitForRegistrationVerificationCheckpoint(context, checkpoint) {
  const result = await rpc(context.serviceRoleSetupClient, "wait_registration_verification_checkpoint_reached", {
    p_operation_kind: checkpoint.operationKind,
    p_task_id: checkpoint.taskId,
    p_student_id: checkpoint.studentId,
  })
  assert.equal(result.status, "reached")
  return result
}

async function releaseRegistrationVerificationCheckpoint(context, checkpoint) {
  const result = await rpc(context.serviceRoleSetupClient, "release_registration_verification_checkpoint", {
    p_operation_kind: checkpoint.operationKind,
    p_task_id: checkpoint.taskId,
    p_student_id: checkpoint.studentId,
  })
  assert.equal(result.status, "released")
  const active = context.fixture.checkpoints.get(checkpointKey(checkpoint))
  if (active) active.released = true
  return result
}

async function disarmRegistrationVerificationCheckpoint(context, checkpoint) {
  const result = await rpc(context.serviceRoleSetupClient, "disarm_registration_verification_checkpoint", {
    p_operation_kind: checkpoint.operationKind,
    p_task_id: checkpoint.taskId,
    p_student_id: checkpoint.studentId,
  })
  assert.ok(["disarmed", "missing"].includes(result.status))
  context.fixture.checkpoints.delete(checkpointKey(checkpoint))
  return result
}

async function insert(serviceRoleSetupClient, fixture, table, rows, registryKey) {
  const list = Array.isArray(rows) ? rows : [rows]
  const { data, error } = await serviceRoleSetupClient.from(table).insert(list).select("*")
  if (error) throw new Error(`${table} fixture insert failed: ${error.message}`)
  if (registryKey) {
    for (const row of data || list) {
      if (row.id) fixture.ids[registryKey].add(row.id)
    }
  }
  return data || []
}

async function selectRows(client, table, select = "*") {
  const { data, error } = await client.from(table).select(select)
  if (error) throw new Error(`${table} fixture select failed: ${error.message}`)
  return data || []
}

function createFixtureNamespace(actorIds) {
  const runId = `${Date.now()}-${randomUUID()}`
  const namespacePrefix = `codex-registration-race-${runId}`
  return {
    runId,
    namespacePrefix,
    fixtureTag: `[${namespacePrefix}]`,
    actorIds,
    ids: Object.fromEntries([
      "tasks", "tracks", "appointments", "attempts", "consultations", "batches",
      "enrollments", "messages", "students", "classes", "textbooks", "withdrawals",
    ].map((key) => [key, new Set()])),
    rosterPairs: new Map(),
    checkpoints: new Map(),
  }
}

function rememberRosterPair(fixture, studentId, classId) {
  fixture.rosterPairs.set(`${studentId}:${classId}`, { studentId, classId })
}

async function assertDistinctAdminActors(serviceRoleSetupClient, adminToken, secondAdminToken) {
  const actorIds = [decodeJwtSubject(adminToken), decodeJwtSubject(secondAdminToken)]
  assert.notEqual(actorIds[0], actorIds[1], "The two admin tokens must belong to distinct actors")
  const { data, error } = await serviceRoleSetupClient
    .from("profiles")
    .select("id,role")
    .in("id", actorIds)
  if (error) throw new Error(`Admin profile verification failed: ${error.message}`)
  assert.equal(data?.length, 2, "Both token subjects must have profiles")
  for (const actorId of actorIds) {
    const profile = data.find((row) => row.id === actorId)
    assert.equal(profile?.role, "admin", `Actor ${actorId} must be an admin`)
  }
  const { data: directors, error: directorError } = await serviceRoleSetupClient
    .from("teacher_catalogs")
    .select("profile_id,is_visible")
    .in("profile_id", actorIds)
    .eq("is_visible", true)
  if (directorError) throw new Error(`Director catalog verification failed: ${directorError.message}`)
  for (const actorId of actorIds) {
    assert.ok(
      directors?.some((row) => row.profile_id === actorId),
      `Actor ${actorId} must be an active director before running ownership races`,
    )
  }
  return actorIds
}

async function seedStudent(context, suffix, overrides = {}) {
  const id = randomUUID()
  const student = {
    id,
    name: `${context.fixture.fixtureTag} ${suffix}`,
    grade: "고1",
    enroll_date: "2026-07-13",
    class_ids: [],
    waitlist_class_ids: [],
    school: "검증고",
    contact: `010-8${String(context.fixture.ids.students.size).padStart(3, "0")}-0000`,
    parent_contact: `010-9${String(context.fixture.ids.students.size).padStart(3, "0")}-0000`,
    status: "재원",
    ...overrides,
  }
  await insert(context.serviceRoleSetupClient, context.fixture, "students", student, "students")
  return student
}

async function seedClass(context, suffix, overrides = {}) {
  const id = randomUUID()
  const classRow = {
    id,
    name: `${context.fixture.fixtureTag} ${suffix}`,
    teacher: "동시성 검증",
    schedule: "",
    schedule_plan: {
      sessions: [{ date: "2026-08-01", sessionNumber: 1, scheduleState: "active" }],
    },
    student_ids: [],
    waitlist_ids: [],
    textbook_ids: [],
    room: "본관 검증실",
    subject: "영어",
    grade: "고1",
    capacity: 30,
    fee: 0,
    status: "수강",
    ...overrides,
  }
  await insert(context.serviceRoleSetupClient, context.fixture, "classes", classRow, "classes")
  return classRow
}

async function seedRegistrationCase(context, suffix, options = {}) {
  const subjects = options.subjects || ["영어"]
  const linkedStudent = options.student || null
  const taskId = randomUUID()
  const task = {
    id: taskId,
    title: `${context.fixture.fixtureTag} ${suffix}`,
    type: "registration",
    status: "in_progress",
    priority: "normal",
    requested_by: context.fixture.actorIds[0],
    assignee_id: context.fixture.actorIds[0],
    secondary_assignee_id: context.fixture.actorIds[1],
    student_id: linkedStudent?.id || options.studentId || null,
    student_name: linkedStudent?.name || options.studentName || `${context.fixture.fixtureTag} ${suffix} 학생`,
    campus: "본관",
    subject: subjects.join(", "),
    due_at: new Date().toISOString(),
    memo: `${context.fixture.fixtureTag} ${suffix}`,
  }
  await insert(context.serviceRoleSetupClient, context.fixture, "ops_tasks", task, "tasks")
  await insert(context.serviceRoleSetupClient, context.fixture, "ops_registration_details", {
    task_id: taskId,
    inquiry_at: "2026-07-13T09:00:00+09:00",
    school_grade: "고1",
    school_name: linkedStudent?.school || "검증고",
    parent_phone: linkedStudent?.parent_contact || options.parentPhone || "010-9000-0000",
    student_phone: linkedStudent?.contact || options.studentPhone || "010-8000-0000",
    pipeline_status: options.legacyStatus || "0. 등록 문의",
    request_note: context.fixture.fixtureTag,
    admission_notice_sent: options.admissionNoticeSent || false,
    common_revision: options.commonRevision || 1,
  })
  const tracks = []
  for (const subject of subjects) {
    const directorProfileId = options.directorProfileIdsBySubject?.[subject]
      || options.directorProfileId
      || null
    const track = {
      id: randomUUID(),
      task_id: taskId,
      subject,
      pipeline_status: options.trackStatus || "inquiry",
      director_profile_id: directorProfileId,
      director_assignment_source: directorProfileId ? "manual" : null,
      director_assigned_at: directorProfileId ? new Date().toISOString() : null,
      waiting_kind: options.waitingKind || null,
    }
    await insert(context.serviceRoleSetupClient, context.fixture, "ops_registration_subject_tracks", track, "tracks")
    tracks.push(track)
  }
  return { task, tracks }
}

async function seedPlannedEnrollment(context, trackId, classId, overrides = {}) {
  const enrollment = {
    id: randomUUID(),
    track_id: trackId,
    class_id: classId,
    status: "planned",
    makeedu_registered: false,
    roster_active: false,
    class_start_date: "2026-08-01",
    class_start_session_key: "2026-08-01:1",
    class_start_session: "1회차",
    sort_order: 0,
    ...overrides,
  }
  await insert(context.serviceRoleSetupClient, context.fixture, "ops_registration_enrollments", enrollment, "enrollments")
  return enrollment
}

async function setRosterMode(context, client, { studentId, classId, expectedMode, nextMode, lane }) {
  const result = await rpc(client, "set_student_class_roster_mode", {
    p_student_id: studentId,
    p_class_id: classId,
    p_expected_mode: expectedMode,
    p_next_mode: nextMode,
    p_memo: `${context.fixture.fixtureTag} ${lane}`,
  }, lane)
  rememberRosterPair(context.fixture, studentId, classId)
  assert.equal(result.studentId, studentId)
  assert.equal(result.classId, classId)
  assert.equal(result.previousMode, expectedMode)
  assert.equal(result.nextMode, nextMode)
  return result
}

async function startBatch(context, client, registration, enrollment, lane) {
  const response = await rpc(client, "start_registration_admission_batch", {
    p_task_id: registration.task.id,
    p_track_ids: [registration.tracks[0].id],
    p_enrollment_ids: [enrollment.id],
    p_request_key: requestKey(context.fixture, lane),
  }, lane)
  if (response.batch?.id) context.fixture.ids.batches.add(response.batch.id)
  return response
}

async function readOne(client, table, id, select = "*") {
  const { data, error } = await client.from(table).select(select).eq("id", id).single()
  if (error) throw new Error(`${table} ${id} read failed: ${error.message}`)
  return data
}

async function runStudentIdentityRace(context) {
  const classA = await seedClass(context, "identity-a")
  const classB = await seedClass(context, "identity-b")
  const studentName = `${context.fixture.fixtureTag} 동일  학생`
  const caseA = await seedRegistrationCase(context, "identity-a", { studentName, parentPhone: "010-9111-0001" })
  const caseB = await seedRegistrationCase(context, "identity-b", { studentName: studentName.replace("  ", " "), parentPhone: "01091110001" })
  const results = await raceCalls([
    () => rpc(context.adminClient, "route_registration_inquiry", {
      p_track_id: caseA.tracks[0].id, p_destination: "waiting", p_waiting_kind: "current_class",
      p_class_id: classA.id, p_request_key: requestKey(context.fixture, "identity-a"),
    }),
    () => rpc(context.secondAdminClient, "route_registration_inquiry", {
      p_track_id: caseB.tracks[0].id, p_destination: "waiting", p_waiting_kind: "current_class",
      p_class_id: classB.id, p_request_key: requestKey(context.fixture, "identity-b"),
    }),
  ])
  assert.equal(fulfilled(results).length, 2, "identity materialization must let unrelated class waits commit")
  const tasks = await Promise.all([
    readOne(context.serviceRoleSetupClient, "ops_tasks", caseA.task.id, "id,student_id"),
    readOne(context.serviceRoleSetupClient, "ops_tasks", caseB.task.id, "id,student_id"),
  ])
  assert.ok(tasks[0].student_id)
  assert.equal(tasks[0].student_id, tasks[1].student_id, "normalized identity must materialize once")
  context.fixture.ids.students.add(tasks[0].student_id)
  rememberRosterPair(context.fixture, tasks[0].student_id, classA.id)
  rememberRosterPair(context.fixture, tasks[0].student_id, classB.id)
  return { scenarioStatus: "executed", studentId: tasks[0].student_id }
}

async function runAppointmentRevisionRace(context) {
  assertProviderZero(context, "appointment revision race start")
  const registration = await seedRegistrationCase(context, "appointment", {
    subjects: ["영어", "수학"],
    directorProfileIdsBySubject: {
      영어: context.fixture.actorIds[0],
      수학: context.fixture.actorIds[1],
    },
  })
  const create = await rpc(context.adminClient, "save_registration_shared_appointment", {
    p_appointment_id: null,
    p_task_id: registration.task.id,
    p_kind: "visit_consultation",
    p_scheduled_at: "2026-08-01T09:00:00+09:00",
    p_place: "본관 검증실",
    p_track_ids: registration.tracks.map((track) => track.id),
    p_replace_remaining: false,
    p_expected_notification_revision: null,
    p_request_key: requestKey(context.fixture, "appointment-create"),
  })
  const appointmentId = create.appointmentId
  assert.ok(appointmentId, "appointment create must return its id")
  context.fixture.ids.appointments.add(appointmentId)
  const createdConsultations = await selectRows(context.serviceRoleSetupClient, "ops_registration_consultations", "id,track_id,status")
  for (const consultation of createdConsultations.filter((row) => registration.tracks.some((track) => track.id === row.track_id))) {
    context.fixture.ids.consultations.add(consultation.id)
  }
  const edits = await raceCalls([
    () => rpc(context.adminClient, "save_registration_shared_appointment", {
      p_appointment_id: appointmentId, p_task_id: registration.task.id, p_kind: "visit_consultation",
      p_scheduled_at: "2026-08-02T09:00:00+09:00", p_place: "본관 A",
      p_track_ids: [registration.tracks[0].id], p_replace_remaining: false,
      p_expected_notification_revision: 1, p_request_key: requestKey(context.fixture, "appointment-edit-a"),
    }),
    () => rpc(context.secondAdminClient, "save_registration_shared_appointment", {
      p_appointment_id: appointmentId, p_task_id: registration.task.id, p_kind: "visit_consultation",
      p_scheduled_at: "2026-08-03T09:00:00+09:00", p_place: "본관 B",
      p_track_ids: [registration.tracks[1].id], p_replace_remaining: false,
      p_expected_notification_revision: 1, p_request_key: requestKey(context.fixture, "appointment-edit-b"),
    }),
  ])
  const winner = assertExactlyOneWinner(edits, "appointment revision")
  assert.ok(Array.isArray(winner.notificationJobs), "appointment winner must return notificationJobs")
  const targetReconciliationJobs = winner.notificationJobs.filter((job) => job.job_kind === "target_reconciliation")
  assert.equal(targetReconciliationJobs.length, 1, "the winning participant edit must enqueue one target reconciliation job")
  assert.equal(new Set(winner.notificationJobs.map((job) => job.job_id)).size, winner.notificationJobs.length, "the winning job set must not contain duplicates")
  for (const job of winner.notificationJobs) {
    assert.ok(job.job_id, "the winning notification job must expose its id")
    const { data: jobStatus, error: jobStatusError } = await context.adminClient.rpc(
      "get_notification_orchestration_job_status_v1",
      { p_job_kind: job.job_kind, p_job_id: job.job_id },
    )
    if (jobStatusError) throw new Error(`notification job verification failed: ${jobStatusError.message}`)
    assert.equal(jobStatus.job_id, job.job_id)
    assert.equal(jobStatus.job_kind, job.job_kind)
  }
  const appointment = await readOne(context.serviceRoleSetupClient, "ops_registration_appointments", appointmentId)
  assert.equal(appointment.notification_revision, 2)
  const { data: notificationSource, error: notificationSourceError } = await context.serviceRoleSetupClient.rpc(
    "get_registration_notification_source_snapshot_v1",
    { p_appointment_id: appointmentId },
  )
  if (notificationSourceError) throw new Error(`notification source verification failed: ${notificationSourceError.message}`)
  assert.equal(notificationSource.appointment_id, appointmentId)
  assert.equal(notificationSource.notification_revision, 2)
  assert.equal(notificationSource.recipient_revision, "2")
  assert.equal(notificationSource.track_ids.length, 1, "only the committed participant set may remain current")
  const finalConsultations = await selectRows(context.serviceRoleSetupClient, "ops_registration_consultations", "id,track_id,status")
  for (const consultation of finalConsultations.filter((row) => registration.tracks.some((track) => track.id === row.track_id))) {
    context.fixture.ids.consultations.add(consultation.id)
  }
  assertProviderZero(context, "appointment revision race")
  return {
    scenarioStatus: "executed",
    appointmentId,
    notificationSourceRevision: notificationSource.notification_revision,
    notificationJobIds: winner.notificationJobs.map((job) => job.job_id),
    providerCalls: context.providerCallLedger.length,
  }
}

async function runAttemptAndBatchCancellationRace(context) {
  const attemptCase = await seedRegistrationCase(context, "attempt-start")
  const createdAppointment = await rpc(context.adminClient, "save_registration_shared_appointment", {
    p_appointment_id: null,
    p_task_id: attemptCase.task.id,
    p_kind: "level_test",
    p_scheduled_at: "2026-08-04T09:00:00+09:00",
    p_place: "본관 검증실",
    p_track_ids: [attemptCase.tracks[0].id],
    p_replace_remaining: false,
    p_expected_notification_revision: null,
    p_request_key: requestKey(context.fixture, "attempt-appointment-create"),
  })
  assert.ok(createdAppointment.appointmentId)
  context.fixture.ids.appointments.add(createdAppointment.appointmentId)
  const { data: attemptRows, error: attemptReadError } = await context.serviceRoleSetupClient
    .from("ops_registration_level_tests")
    .select("id,track_id,status")
    .eq("track_id", attemptCase.tracks[0].id)
    .eq("status", "scheduled")
  if (attemptReadError) throw new Error(`scheduled attempt read failed: ${attemptReadError.message}`)
  assert.equal(attemptRows.length, 1)
  const attemptId = attemptRows[0].id
  context.fixture.ids.attempts.add(attemptId)
  assert.ok(attemptId)
  const starts = await raceCalls([
    () => rpc(context.adminClient, "start_registration_level_test_attempt", {
      p_attempt_id: attemptId, p_request_key: requestKey(context.fixture, "attempt-a"),
    }),
    () => rpc(context.secondAdminClient, "start_registration_level_test_attempt", {
      p_attempt_id: attemptId, p_request_key: requestKey(context.fixture, "attempt-b"),
    }),
  ])
  assertExactlyOneWinner(starts, "level-test attempt start")
  const attempt = await readOne(context.serviceRoleSetupClient, "ops_registration_level_tests", attemptId)
  assert.equal(attempt.status, "in_progress")

  const student = await seedStudent(context, "batch-cancel")
  const classRow = await seedClass(context, "batch-cancel")
  const registration = await seedRegistrationCase(context, "batch-cancel", {
    student, trackStatus: "enrollment_decided", legacyStatus: "5. 입학 등록 결정", admissionNoticeSent: true,
  })
  const enrollment = await seedPlannedEnrollment(context, registration.tracks[0].id, classRow.id)
  const races = await raceCalls([
    () => startBatch(context, context.adminClient, registration, enrollment, "batch-cancel-start"),
    () => rpc(context.secondAdminClient, "cancel_registration_enrollment", {
      p_enrollment_id: enrollment.id, p_destination: null, p_waiting_kind: null, p_class_id: null,
      p_reason: "동시 취소 검증", p_request_key: requestKey(context.fixture, "batch-cancel-row"),
    }),
  ])
  assertExactlyOneWinner(races, "batch start versus row cancellation")
  const row = await readOne(context.serviceRoleSetupClient, "ops_registration_enrollments", enrollment.id)
  assert.ok(row.status === "canceled" || (row.status === "planned" && row.admission_batch_id && row.roster_active))
  if (row.roster_active) rememberRosterPair(context.fixture, student.id, classRow.id)
  return { scenarioStatus: "executed", attemptId }
}

async function runSamePairRosterBatchRace(context) {
  const student = await seedStudent(context, "same-pair")
  const classRow = await seedClass(context, "same-pair")
  const registration = await seedRegistrationCase(context, "same-pair", {
    student, trackStatus: "enrollment_decided", legacyStatus: "5. 입학 등록 결정", admissionNoticeSent: true,
  })
  const enrollment = await seedPlannedEnrollment(context, registration.tracks[0].id, classRow.id)
  const races = await raceCalls([
    () => startBatch(context, context.adminClient, registration, enrollment, "same-pair-batch"),
    () => setRosterMode(context, context.secondAdminClient, {
      studentId: student.id, classId: classRow.id, expectedMode: "removed", nextMode: "enrolled", lane: "same-pair-roster",
    }),
  ])
  assertExactlyOneWinner(races, "same-pair roster versus batch")
  rememberRosterPair(context.fixture, student.id, classRow.id)
  const row = await readOne(context.serviceRoleSetupClient, "ops_registration_enrollments", enrollment.id)
  const studentState = await readOne(context.serviceRoleSetupClient, "students", student.id, "id,class_ids")
  assert.equal(Boolean(row.roster_active) || studentState.class_ids.includes(classRow.id), true)
  return { scenarioStatus: "executed" }
}

async function prepareDraftBatch(context, suffix) {
  const student = await seedStudent(context, suffix)
  const classRow = await seedClass(context, suffix)
  const registration = await seedRegistrationCase(context, suffix, {
    student, trackStatus: "enrollment_decided", legacyStatus: "5. 입학 등록 결정", admissionNoticeSent: true,
  })
  const enrollment = await seedPlannedEnrollment(context, registration.tracks[0].id, classRow.id, {
    class_start_date: "2026-08-01",
    class_start_session_key: "2026-08-01:1",
    class_start_session: "1회차",
  })
  const started = await startBatch(context, context.adminClient, registration, enrollment, `${suffix}-start`)
  const batchId = started.batch.id
  rememberRosterPair(context.fixture, student.id, classRow.id)
  await rpc(context.adminClient, "set_registration_enrollment_makeedu", {
    p_enrollment_id: enrollment.id,
    p_makeedu_registered: true,
    p_request_key: requestKey(context.fixture, `${suffix}-makeedu`),
  })
  return { student, classRow, registration, enrollment, batchId }
}

async function advanceBatchToPaid(context, batchId, suffix) {
  await rpc(context.adminClient, "advance_registration_admission_batch", {
    p_batch_id: batchId, p_action: "invoice_sent", p_request_key: requestKey(context.fixture, `${suffix}-invoice`),
  })
  await rpc(context.adminClient, "advance_registration_admission_batch", {
    p_batch_id: batchId, p_action: "payment_confirmed", p_request_key: requestKey(context.fixture, `${suffix}-payment`),
  })
}

async function runUnrelatedRosterBatchRace(context) {
  const prepared = await prepareDraftBatch(context, "unrelated")
  const otherClass = await seedClass(context, "unrelated-other")
  await advanceBatchToPaid(context, prepared.batchId, "unrelated")
  const races = await raceCalls([
    () => rpc(context.adminClient, "complete_registration_admission_batch", {
      p_batch_id: prepared.batchId, p_request_key: requestKey(context.fixture, "unrelated-complete"),
    }),
    () => setRosterMode(context, context.secondAdminClient, {
      studentId: prepared.student.id, classId: otherClass.id, expectedMode: "removed", nextMode: "waitlist", lane: "unrelated-roster",
    }),
  ])
  assert.equal(fulfilled(races).length, 2, "unrelated roster and batch completion must both commit")
  rememberRosterPair(context.fixture, prepared.student.id, otherClass.id)
  const student = await readOne(context.serviceRoleSetupClient, "students", prepared.student.id, "id,class_ids,waitlist_class_ids")
  assert.ok(student.class_ids.includes(prepared.classRow.id))
  assert.ok(student.waitlist_class_ids.includes(otherClass.id))
  const { data: history, error: historyError } = await context.serviceRoleSetupClient
    .from("student_class_enrollment_history")
    .select("class_id,action")
    .eq("student_id", prepared.student.id)
    .in("class_id", [prepared.classRow.id, otherClass.id])
  if (historyError) throw new Error(`unrelated roster history read failed: ${historyError.message}`)
  assert.equal(history.filter((row) => row.class_id === prepared.classRow.id && row.action === "enrolled").length, 1)
  assert.equal(history.filter((row) => row.class_id === otherClass.id && row.action === "waitlist").length, 1)
  return { scenarioStatus: "executed" }
}

async function runTwoCaseClaimRace(context) {
  const student = await seedStudent(context, "two-case")
  const classRow = await seedClass(context, "two-case")
  const cases = await Promise.all(["a", "b"].map((suffix) => seedRegistrationCase(context, `two-case-${suffix}`, {
    student, trackStatus: "enrollment_decided", legacyStatus: "5. 입학 등록 결정", admissionNoticeSent: true,
  })))
  const rows = await Promise.all(cases.map((registration) => seedPlannedEnrollment(context, registration.tracks[0].id, classRow.id)))
  const races = await raceCalls([
    () => startBatch(context, context.adminClient, cases[0], rows[0], "two-case-a"),
    () => startBatch(context, context.secondAdminClient, cases[1], rows[1], "two-case-b"),
  ])
  assertExactlyOneWinner(races, "two-case student/class claim")
  rememberRosterPair(context.fixture, student.id, classRow.id)
  const { data, error } = await context.serviceRoleSetupClient
    .from("ops_registration_enrollments")
    .select("id")
    .eq("student_id", student.id)
    .eq("class_id", classRow.id)
    .eq("roster_active", true)
  if (error) throw new Error(`two-case claim read failed: ${error.message}`)
  assert.equal(data.length, 1)
  const { data: batches, error: batchError } = await context.serviceRoleSetupClient
    .from("ops_registration_admission_batches")
    .select("id,status")
    .in("task_id", cases.map((registration) => registration.task.id))
    .not("status", "in", "(completed,canceled)")
  if (batchError) throw new Error(`two-case batch read failed: ${batchError.message}`)
  assert.equal(batches.length, 1, "the losing case must roll its batch insert back")
  return { scenarioStatus: "executed" }
}

async function runInvoicePaymentReplayRace(context) {
  const prepared = await prepareDraftBatch(context, "finance")
  const invoice = await raceCalls([
    () => rpc(context.adminClient, "advance_registration_admission_batch", {
      p_batch_id: prepared.batchId, p_action: "invoice_sent", p_request_key: requestKey(context.fixture, "invoice-a"),
    }),
    () => rpc(context.secondAdminClient, "advance_registration_admission_batch", {
      p_batch_id: prepared.batchId, p_action: "invoice_sent", p_request_key: requestKey(context.fixture, "invoice-b"),
    }),
  ])
  assert.equal(fulfilled(invoice).length, 2, "invoice repeats must return canonical state")
  const afterInvoice = await readOne(context.serviceRoleSetupClient, "ops_registration_admission_batches", prepared.batchId)
  assert.ok(afterInvoice.invoice_sent_at)
  const payment = await raceCalls([
    () => rpc(context.adminClient, "advance_registration_admission_batch", {
      p_batch_id: prepared.batchId, p_action: "payment_confirmed", p_request_key: requestKey(context.fixture, "payment-a"),
    }),
    () => rpc(context.secondAdminClient, "advance_registration_admission_batch", {
      p_batch_id: prepared.batchId, p_action: "payment_confirmed", p_request_key: requestKey(context.fixture, "payment-b"),
    }),
  ])
  assert.equal(fulfilled(payment).length, 2, "payment repeats must return canonical state")
  const paid = await readOne(context.serviceRoleSetupClient, "ops_registration_admission_batches", prepared.batchId)
  assert.equal(paid.invoice_sent_at, afterInvoice.invoice_sent_at)
  assert.ok(paid.payment_confirmed_at)
  assert.equal(new Set(fulfilled(invoice).map((result) => result.batch?.invoiceSentAt)).size, 1)
  assert.equal(new Set(fulfilled(payment).map((result) => result.batch?.paymentConfirmedAt)).size, 1)
  return { scenarioStatus: "executed", batchId: prepared.batchId }
}

async function seedMessageEligibleCase(context, suffix) {
  return seedRegistrationCase(context, suffix, {
    trackStatus: "enrollment_decided",
    legacyStatus: "5. 입학 등록 결정",
    parentPhone: "010-9555-0000",
  })
}

async function runMessageRaces(context) {
  const identityCase = await seedMessageEligibleCase(context, "message-identity")
  const identityMessageKey = `${context.fixture.namespacePrefix}:message-identity`
  const identityRace = await raceCalls([
    () => rpc(context.adminClient, "claim_registration_admission_message", {
      p_task_id: identityCase.task.id, p_message_request_key: identityMessageKey,
    }),
    () => rpc(context.secondAdminClient, "update_registration_case_common", {
      p_task_id: identityCase.task.id,
      p_student_name: `${context.fixture.fixtureTag} message identity updated`,
      p_school_grade: "고1", p_school_name: "검증고", p_parent_phone: "010-9555-0001",
      p_student_phone: "010-8555-0001", p_campus: "본관", p_inquiry_at: "2026-07-13T09:00:00+09:00",
      p_request_note: context.fixture.fixtureTag, p_priority: "normal", p_expected_common_revision: 1,
      p_request_key: requestKey(context.fixture, "message-identity-edit"),
    }),
  ])
  assert.ok(fulfilled(identityRace).length >= 1, "claim versus identity edit must have a committed winner")
  const { data: identityMessages, error: identityMessageError } = await context.serviceRoleSetupClient
    .from("ops_registration_messages")
    .select("id,status,claim_active")
    .eq("task_id", identityCase.task.id)
  if (identityMessageError) throw new Error(`identity-race message read failed: ${identityMessageError.message}`)
  assert.equal(identityMessages.length, 1, "identity edit race must preserve exactly one message claim")
  assert.equal(
    fulfilled(identityRace).filter((result) => result?.shouldSend === true).length,
    1,
    "claim versus identity edit must authorize only one send",
  )
  for (const message of identityMessages) context.fixture.ids.messages.add(message.id)

  const claimCase = await seedMessageEligibleCase(context, "message-double-claim")
  const claims = await raceCalls([
    () => rpc(context.adminClient, "claim_registration_admission_message", {
      p_task_id: claimCase.task.id, p_message_request_key: `${context.fixture.namespacePrefix}:message-a`,
    }),
    () => rpc(context.secondAdminClient, "claim_registration_admission_message", {
      p_task_id: claimCase.task.id, p_message_request_key: `${context.fixture.namespacePrefix}:message-b`,
    }),
  ])
  assert.equal(fulfilled(claims).length, 2)
  assert.equal(fulfilled(claims).filter((result) => result.shouldSend).length, 1, "only one claim may send")
  const messageId = fulfilled(claims)[0].messageId
  context.fixture.ids.messages.add(messageId)
  await rpc(context.serviceRoleFinalizerClient, "finalize_registration_admission_message", {
    p_message_id: messageId,
    p_result: "unknown",
    p_provider_result: { providerStatusCode: "timeout", errorMessage: "fixture unknown" },
  }, "service-role message unknown finalizer")
  const finalRace = await raceCalls([
    () => rpc(context.serviceRoleFinalizerClient, "finalize_registration_admission_message", {
      p_message_id: messageId,
      p_result: "accepted",
      p_provider_result: { providerMessageId: `${context.fixture.namespacePrefix}:provider`, providerStatusCode: "202" },
    }, "service-role message accepted finalizer"),
    () => rpc(context.secondAdminClient, "reconcile_registration_admission_message", {
      p_message_id: messageId,
      p_resolution: "failed",
      p_provider_evidence: { lookupRequestKey: fulfilled(claims)[0].messageRequestKey, observedState: "failed", observedStatusCode: "500" },
      p_reason: "동시성 검증 실패 보류",
      p_request_key: requestKey(context.fixture, "message-failed-hold"),
    }),
  ])
  assert.ok(fulfilled(finalRace).length >= 1)
  const message = await readOne(context.serviceRoleSetupClient, "ops_registration_messages", messageId)
  assert.equal(message.status, "accepted", "accepted finalizer must prevail over unreleased failed hold")
  assert.equal(message.claim_active, true)
  const { data: activeMessages, error } = await context.serviceRoleSetupClient
    .from("ops_registration_messages")
    .select("id")
    .eq("task_id", claimCase.task.id)
    .eq("claim_active", true)
  if (error) throw new Error(`active message read failed: ${error.message}`)
  assert.equal(activeMessages.length, 1)
  return { scenarioStatus: "executed", shouldSendCount: 1 }
}

async function runDirectorReassignmentRace(context) {
  const registration = await seedRegistrationCase(context, "director", {
    trackStatus: "consultation_waiting", legacyStatus: "2. 상담 예약",
    directorProfileId: context.fixture.actorIds[0],
  })
  const consultation = {
    id: randomUUID(), track_id: registration.tracks[0].id, appointment_id: null,
    mode: "phone", status: "waiting", director_profile_id: context.fixture.actorIds[0],
  }
  await insert(context.serviceRoleSetupClient, context.fixture, "ops_registration_consultations", consultation, "consultations")
  let releaseFormerDirector
  const formerDirectorMayContinue = new Promise((resolve) => { releaseFormerDirector = resolve })
  const formerDirectorCompletion = (async () => {
    await formerDirectorMayContinue
    return rpc(context.adminClient, "complete_registration_consultation", {
      p_consultation_id: consultation.id, p_outcome: "not_registered", p_waiting_kind: null, p_class_id: null,
      p_request_key: requestKey(context.fixture, "director-old-complete"),
    })
  })()
  await rpc(context.secondAdminClient, "assign_registration_track_director", {
    p_track_id: registration.tracks[0].id,
    p_director_profile_id: context.fixture.actorIds[1],
    p_assignment_source: "manual",
    p_rule_key: null,
    p_expected_common_revision: 1,
    p_request_key: requestKey(context.fixture, "director-reassign"),
  })
  releaseFormerDirector()
  await assert.rejects(formerDirectorCompletion, /registration_access_denied|failed/)
  const track = await readOne(context.serviceRoleSetupClient, "ops_registration_subject_tracks", registration.tracks[0].id)
  const row = await readOne(context.serviceRoleSetupClient, "ops_registration_consultations", consultation.id)
  assert.equal(track.director_profile_id, context.fixture.actorIds[1])
  assert.equal(row.director_profile_id, context.fixture.actorIds[1])
  assert.equal(row.status, "waiting")
  return { scenarioStatus: "executed" }
}

async function seedWithdrawal(context, suffix, student, sourceClass) {
  await setRosterMode(context, context.adminClient, {
    studentId: student.id, classId: sourceClass.id, expectedMode: "removed", nextMode: "enrolled", lane: `${suffix}-source-roster`,
  })
  const taskId = randomUUID()
  await insert(context.serviceRoleSetupClient, context.fixture, "ops_tasks", {
    id: taskId,
    title: `${context.fixture.fixtureTag} ${suffix} 퇴원`,
    type: "withdrawal", status: "in_progress", priority: "normal",
    requested_by: context.fixture.actorIds[0], assignee_id: context.fixture.actorIds[0],
    student_id: student.id, class_id: sourceClass.id,
    student_name: student.name, class_name: sourceClass.name, campus: "본관", subject: "영어",
    memo: `${context.fixture.fixtureTag} ${suffix} withdrawal`,
  }, "withdrawals")
  context.fixture.ids.tasks.add(taskId)
  await insert(context.serviceRoleSetupClient, context.fixture, "ops_withdrawal_details", {
    task_id: taskId, school_grade: "고1", teacher_name: "동시성 검증",
    withdrawal_date: "2026-08-01", withdrawal_session: "1회차",
    customer_reason: "검증", teacher_opinion: context.fixture.fixtureTag,
    timetable_roster_updated: false, makeedu_withdrawal_done: true,
    fee_processed: true, textbook_fee_processed: true,
  })
  return taskId
}

function assertRejectedWithDatabaseError(result, expectedError, label) {
  assert.equal(result.status, "rejected", `${label}: expected rejection`)
  assert.match(result.reason?.message || "", new RegExp(`\\b${expectedError}\\b`), `${label}: wrong database error`)
}

async function readWithdrawalRaceState(context, { student, withdrawalTaskId, registration, enrollment }) {
  const [state, withdrawalTask, withdrawalChecklistResult, track] = await Promise.all([
    readOne(context.serviceRoleSetupClient, "students", student.id, "id,status,class_ids,waitlist_class_ids"),
    readOne(context.serviceRoleSetupClient, "ops_tasks", withdrawalTaskId, "id,status"),
    context.serviceRoleSetupClient
      .from("ops_withdrawal_details")
      .select("task_id,timetable_roster_updated")
      .eq("task_id", withdrawalTaskId)
      .single(),
    readOne(context.serviceRoleSetupClient, "ops_registration_subject_tracks", registration.tracks[0].id, "id,pipeline_status,waiting_kind"),
  ])
  if (withdrawalChecklistResult.error) {
    throw new Error(`withdrawal checklist read failed: ${withdrawalChecklistResult.error.message}`)
  }
  const { data: liveClaims, error: liveClaimError } = await context.serviceRoleSetupClient
    .from("ops_registration_enrollments")
    .select("id,status,roster_active,student_id,admission_batch_id")
    .eq("student_id", student.id)
    .eq("roster_active", true)
  if (liveClaimError) throw new Error(`withdrawal live claim read failed: ${liveClaimError.message}`)
  const { count: withdrawalEventCount, error: withdrawalEventError } = await context.serviceRoleSetupClient
    .from("ops_task_events")
    .select("id", { count: "exact", head: true })
    .eq("task_id", withdrawalTaskId)
  if (withdrawalEventError) throw new Error(`withdrawal event read failed: ${withdrawalEventError.message}`)
  const { count: registrationEventCount, error: registrationEventError } = await context.serviceRoleSetupClient
    .from("ops_task_events")
    .select("id", { count: "exact", head: true })
    .eq("task_id", registration.task.id)
  if (registrationEventError) throw new Error(`registration event read failed: ${registrationEventError.message}`)
  const { count: batchCount, error: batchError } = await context.serviceRoleSetupClient
    .from("ops_registration_admission_batches")
    .select("id", { count: "exact", head: true })
    .eq("task_id", registration.task.id)
  if (batchError) throw new Error(`withdrawal batch read failed: ${batchError.message}`)
  const enrollmentState = enrollment
    ? await readOne(
      context.serviceRoleSetupClient,
      "ops_registration_enrollments",
      enrollment.id,
      "id,status,roster_active,student_id,admission_batch_id",
    )
    : null
  return {
    state,
    withdrawalTask,
    withdrawalChecklist: withdrawalChecklistResult.data,
    track,
    liveClaims,
    withdrawalEventCount,
    registrationEventCount,
    batchCount,
    enrollmentState,
  }
}

async function runOrderedWithdrawalRace(context, kind, lockOrder) {
  const suffix = `withdrawal-${kind}-${lockOrder}`
  const student = await seedStudent(context, suffix)
  const sourceClass = await seedClass(context, `${suffix}-source`)
  const destinationClass = await seedClass(context, `${suffix}-destination`)
  const withdrawalTaskId = await seedWithdrawal(context, suffix, student, sourceClass)
  const registration = await seedRegistrationCase(context, suffix, {
    student,
    trackStatus: kind === "batch" ? "enrollment_decided" : "inquiry",
    legacyStatus: kind === "batch" ? "5. 입학 등록 결정" : "0. 등록 문의",
    admissionNoticeSent: kind === "batch",
  })
  const enrollment = kind === "batch"
    ? await seedPlannedEnrollment(context, registration.tracks[0].id, destinationClass.id)
    : null
  const lifecycle = () => kind === "batch"
    ? startBatch(context, context.secondAdminClient, registration, enrollment, `${suffix}-batch`)
    : rpc(context.secondAdminClient, "route_registration_inquiry", {
      p_track_id: registration.tracks[0].id, p_destination: "waiting", p_waiting_kind: "current_class",
      p_class_id: destinationClass.id, p_request_key: requestKey(context.fixture, `${suffix}-wait`),
    })
  const withdrawal = () => rpc(context.adminClient, "complete_ops_withdrawal_roster_transition", {
    p_task_id: withdrawalTaskId, p_request_key: requestKey(context.fixture, `${suffix}-withdrawal`),
  })
  const checkpoint = lockOrder === "withdrawal_first"
    ? {
      operationKind: "withdrawal_before_status_flip",
      taskId: withdrawalTaskId,
      studentId: student.id,
    }
    : {
      operationKind: kind === "batch"
        ? "admission_batch_before_first_claim"
        : "current_class_wait_before_materialization",
      taskId: registration.task.id,
      studentId: student.id,
    }
  let competingCheckpoint = null
  let firstPromise
  let competingPromise
  let results
  const armedCheckpoints = [checkpoint]
  await armRegistrationVerificationCheckpoint(context, checkpoint)
  try {
    firstPromise = lockOrder === "withdrawal_first" ? withdrawal() : lifecycle()
    await waitForRegistrationVerificationCheckpoint(context, checkpoint)
    if (lockOrder === "lifecycle_first") {
      competingCheckpoint = {
        operationKind: "withdrawal_after_parent_snapshot",
        taskId: withdrawalTaskId,
        studentId: student.id,
      }
      await armRegistrationVerificationCheckpoint(context, competingCheckpoint)
      armedCheckpoints.push(competingCheckpoint)
      competingPromise = withdrawal()
      await waitForRegistrationVerificationCheckpoint(context, competingCheckpoint)
      await releaseRegistrationVerificationCheckpoint(context, competingCheckpoint)
    } else {
      competingPromise = lifecycle()
    }
    await releaseRegistrationVerificationCheckpoint(context, checkpoint)
    results = await Promise.allSettled([firstPromise, competingPromise])
  } finally {
    for (const armedCheckpoint of [...armedCheckpoints].reverse()) {
      const active = context.fixture.checkpoints.get(checkpointKey(armedCheckpoint))
      if (active && !active.released) {
        await releaseRegistrationVerificationCheckpoint(context, armedCheckpoint).catch(() => {})
      }
    }
    if (firstPromise || competingPromise) {
      await Promise.allSettled([firstPromise, competingPromise].filter(Boolean))
    }
    for (const armedCheckpoint of [...armedCheckpoints].reverse()) {
      await disarmRegistrationVerificationCheckpoint(context, armedCheckpoint).catch(() => {})
    }
  }
  assert.equal(results.length, 2)
  assert.equal(results[0].status, "fulfilled", `${kind} ${lockOrder}: lock holder must commit`)
  const expectedLoserError = lockOrder === "withdrawal_first"
    ? "registration_student_reactivation_required"
    : "registration_workflow_retry_required"
  assertRejectedWithDatabaseError(results[1], expectedLoserError, `${kind} ${lockOrder}`)
  rememberRosterPair(context.fixture, student.id, sourceClass.id)
  rememberRosterPair(context.fixture, student.id, destinationClass.id)
  const raceState = await readWithdrawalRaceState(context, {
    student, withdrawalTaskId, registration, enrollment,
  })
  if (lockOrder === "withdrawal_first") {
    assert.equal(raceState.state.status, "퇴원")
    assert.deepEqual(raceState.state.class_ids, [])
    assert.deepEqual(raceState.state.waitlist_class_ids, [])
    assert.equal(raceState.liveClaims.length, 0)
    assert.equal(raceState.withdrawalTask.status, "done")
    assert.equal(raceState.withdrawalChecklist.timetable_roster_updated, true)
    assert.ok(raceState.withdrawalEventCount > 0)
    assert.equal(raceState.registrationEventCount, 0)
    assert.equal(raceState.batchCount, 0)
    assert.equal(raceState.track.pipeline_status, kind === "batch" ? "enrollment_decided" : "inquiry")
    assert.equal(raceState.track.waiting_kind, null)
    if (raceState.enrollmentState) {
      assert.equal(raceState.enrollmentState.status, "planned")
      assert.equal(raceState.enrollmentState.roster_active, false)
      assert.equal(raceState.enrollmentState.student_id, null)
      assert.equal(raceState.enrollmentState.admission_batch_id, null)
    }
  } else {
    assert.notEqual(raceState.state.status, "퇴원")
    assert.equal(raceState.withdrawalTask.status, "in_progress")
    assert.equal(raceState.withdrawalChecklist.timetable_roster_updated, false)
    assert.equal(raceState.withdrawalEventCount, 0)
    assert.ok(raceState.registrationEventCount > 0)
    assert.equal(raceState.liveClaims.length, 1)
    assert.equal(raceState.liveClaims[0].student_id, student.id)
    assert.equal(raceState.liveClaims[0].status, kind === "batch" ? "planned" : "waitlisted")
    assert.equal(raceState.batchCount, kind === "batch" ? 1 : 0)
    assert.equal(raceState.track.pipeline_status, kind === "batch" ? "enrollment_processing" : "waiting")
    assert.equal(raceState.track.waiting_kind, kind === "wait" ? "current_class" : null)
    if (raceState.enrollmentState) {
      assert.equal(raceState.enrollmentState.status, "planned")
      assert.equal(raceState.enrollmentState.roster_active, true)
      assert.equal(raceState.enrollmentState.student_id, student.id)
      assert.ok(raceState.enrollmentState.admission_batch_id)
    }
  }
  return {
    kind,
    lockOrder,
    expectedLoserError,
    observedWinner: lockOrder === "withdrawal_first" ? "withdrawal" : kind,
    studentStatus: raceState.state.status,
    proofScope: "deterministic_internal_checkpoint_race",
    internalLockOrderProven: true,
  }
}

async function runWithdrawalLifecycleRaces(context) {
  const cases = []
  for (const kind of ["batch", "wait"]) {
    for (const lockOrder of ["withdrawal_first", "lifecycle_first"]) {
      cases.push(await runOrderedWithdrawalRace(context, kind, lockOrder))
    }
  }
  const studentIds = [...context.fixture.ids.students]
  const { data: withdrawn, error: studentError } = await context.serviceRoleSetupClient
    .from("students")
    .select("id,class_ids,waitlist_class_ids")
    .in("id", studentIds)
    .eq("status", "퇴원")
  if (studentError) throw new Error(`withdrawal invariant student read failed: ${studentError.message}`)
  for (const student of withdrawn || []) {
    assert.equal(student.class_ids.length, 0)
    assert.equal(student.waitlist_class_ids.length, 0)
    const { count, error } = await context.serviceRoleSetupClient
      .from("ops_registration_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("student_id", student.id)
      .eq("roster_active", true)
    if (error) throw new Error(`withdrawal invariant claim read failed: ${error.message}`)
    assert.equal(count, 0, "withdrawn student cannot retain a live registration claim")
  }
  return {
    scenarioStatus: "executed",
    proofScope: "deterministic_internal_checkpoint_race",
    internalLockOrderProven: true,
    lockOrders: cases.length,
    deterministicRaceCases: cases,
  }
}

async function currentRosterMode(serviceRoleSetupClient, { studentId, classId }) {
  const [student, classRow] = await Promise.all([
    readOne(serviceRoleSetupClient, "students", studentId, "id,status,class_ids,waitlist_class_ids"),
    readOne(serviceRoleSetupClient, "classes", classId, "id,student_ids,waitlist_ids"),
  ])
  const enrolled = student.class_ids.includes(classId) && classRow.student_ids.includes(studentId)
  const waitlist = student.waitlist_class_ids.includes(classId) && classRow.waitlist_ids.includes(studentId)
  if (enrolled && !waitlist) return "enrolled"
  if (waitlist && !enrolled) return "waitlist"
  if (!enrolled && !waitlist) return "removed"
  throw new Error(`Cleanup found asymmetric roster pair ${studentId}:${classId}`)
}

async function cleanupFixtureNamespace(context) {
  const cleanupErrors = []
  for (const checkpoint of [...context.fixture.checkpoints.values()]) {
    try {
      if (!checkpoint.released) {
        await releaseRegistrationVerificationCheckpoint(context, checkpoint)
      }
    } catch (error) {
      cleanupErrors.push(error)
    }
    try {
      await disarmRegistrationVerificationCheckpoint(context, checkpoint)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  for (const taskId of context.fixture.ids.tasks) {
    const result = await context.serviceRoleSetupClient
      .from("dashboard_notifications")
      .delete()
      .like("dedupe_key", `registration:${taskId}:%`)
    if (result.error) cleanupErrors.push(new Error(`dashboard notification cleanup failed: ${result.error.message}`))
  }

  const registryForTable = {
    ops_registration_messages: "messages",
    ops_registration_consultations: "consultations",
    ops_registration_level_tests: "attempts",
    ops_registration_enrollments: "enrollments",
    ops_registration_admission_batches: "batches",
    ops_registration_appointments: "appointments",
    ops_registration_subject_tracks: "tracks",
    ops_tasks: "tasks",
    students: "students",
    classes: "classes",
    textbooks: "textbooks",
  }
  const taskScopedTables = cleanupTablesInReverseForeignKeyOrder.slice(
    0,
    cleanupTablesInReverseForeignKeyOrder.indexOf("ops_tasks") + 1,
  )
  for (const table of taskScopedTables) {
    try {
      let query = context.serviceRoleSetupClient.from(table).delete()
      if (["ops_registration_details", "ops_withdrawal_details", "ops_task_events", "ops_task_comments", "ops_task_attachments"].includes(table)) {
        const ids = [...context.fixture.ids.tasks]
        if (ids.length === 0) continue
        query = query.in("task_id", ids)
      } else if (table === "student_class_enrollment_history") {
        const studentIds = [...context.fixture.ids.students]
        if (studentIds.length === 0) continue
        query = query.in("student_id", studentIds)
      } else {
        const registry = registryForTable[table]
        const ids = registry ? [...context.fixture.ids[registry]] : []
        if (ids.length === 0) continue
        query = query.in("id", ids)
      }
      const { error } = await query
      if (error) cleanupErrors.push(new Error(`${table} reverse cleanup failed: ${error.message}`))
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  // Registration task deletion removes active claim rows first. The generic
  // authenticated gateway can then remove the four canonical projections
  // without a service-role client impersonating a human roster operation.
  for (const pair of [...context.fixture.rosterPairs.values()].sort((a, b) =>
    `${a.studentId}:${a.classId}`.localeCompare(`${b.studentId}:${b.classId}`))) {
    try {
      const mode = await currentRosterMode(context.serviceRoleSetupClient, pair)
      if (mode !== "removed") {
        const student = await readOne(context.serviceRoleSetupClient, "students", pair.studentId, "id,status")
        if (student.status !== "퇴원") {
          await setRosterMode(context, context.adminClient, {
            ...pair, expectedMode: mode, nextMode: "removed", lane: "reverse-cleanup",
          })
        }
      }
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  for (const table of cleanupTablesInReverseForeignKeyOrder.slice(
    cleanupTablesInReverseForeignKeyOrder.indexOf("student_class_enrollment_history"),
  )) {
    try {
      let query = context.serviceRoleSetupClient.from(table).delete()
      if (table === "student_class_enrollment_history") {
        const studentIds = [...context.fixture.ids.students]
        if (studentIds.length === 0) continue
        query = query.in("student_id", studentIds)
      } else {
        const registry = registryForTable[table]
        const ids = registry ? [...context.fixture.ids[registry]] : []
        if (ids.length === 0) continue
        query = query.in("id", ids)
      }
      const { error } = await query
      if (error) cleanupErrors.push(new Error(`${table} reverse cleanup failed: ${error.message}`))
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  const { count, error } = await context.serviceRoleSetupClient
    .from("ops_tasks")
    .select("id", { count: "exact", head: true })
    .like("memo", `${context.fixture.fixtureTag}%`)
  if (error) cleanupErrors.push(new Error(`fixture leftover verification failed: ${error.message}`))
  else if (count !== 0) cleanupErrors.push(new Error(`fixture cleanup left ${count} namespaced tasks`))
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Registration concurrency fixture cleanup failed")
}

async function executeAuthorizedScenarios(context) {
  const reports = []
  const scenarios = [
    ["student identity", runStudentIdentityRace],
    ["appointment revision", runAppointmentRevisionRace],
    ["attempt and batch cancellation", runAttemptAndBatchCancellationRace],
    ["same-pair roster and batch", runSamePairRosterBatchRace],
    ["unrelated roster and batch completion", runUnrelatedRosterBatchRace],
    ["two-case claim", runTwoCaseClaimRace],
    ["invoice/payment replay", runInvoicePaymentReplayRace],
    ["message races", runMessageRaces],
    ["director reassignment", runDirectorReassignmentRace],
    ["withdrawal lifecycle", runWithdrawalLifecycleRaces],
  ]
  for (const [name, runScenario] of scenarios) {
    const report = await runScenario(context)
    assert.equal(report?.scenarioStatus, "executed", `${name} did not report verified execution`)
    reports.push({ name, ...report })
  }
  return reports
}

async function runAuthorizedManifest(argv) {
  const rawUrl = optionValue(argv, "--url")
  const url = assertAuthorizedTarget(rawUrl)
  const anonKey = optionValue(argv, "--anon-key")
  const adminToken = optionValue(argv, "--admin-token")
  const secondAdminToken = optionValue(argv, "--second-admin-token")
  if (adminToken === secondAdminToken) {
    throw new Error("The two admin tokens must belong to distinct actors")
  }

  // Deliberately read and use the service credential only after production detection.
  const serviceRoleKey = optionValue(argv, "--service-role-key")
  const serviceRoleSetupClient = createServiceClient(url, serviceRoleKey)
  const serviceRoleFinalizerClient = createServiceClient(url, serviceRoleKey)
  const actorIds = await assertDistinctAdminActors(serviceRoleSetupClient, adminToken, secondAdminToken)
  const adminClient = createAuthenticatedClient(url, anonKey, adminToken)
  const secondAdminClient = createAuthenticatedClient(url, anonKey, secondAdminToken)
  const fixture = createFixtureNamespace(actorIds)
  const context = {
    url,
    adminClient,
    secondAdminClient,
    serviceRoleSetupClient,
    serviceRoleFinalizerClient,
    fixture,
    providerCallLedger: [],
  }
  let scenarioError = null
  let reports = []
  try {
    reports = await executeAuthorizedScenarios(context)
  } catch (error) {
    scenarioError = error
  }
  try {
    await cleanupFixtureNamespace(context)
  } catch (cleanupError) {
    scenarioError = scenarioError
      ? new AggregateError([scenarioError, cleanupError], "Concurrency verification and cleanup failed")
      : cleanupError
  }
  if (scenarioError) throw scenarioError
  assertProviderZero(context, "authorized concurrency manifest")
  console.log(JSON.stringify({
    ok: true,
    scenarioStatus: "executed",
    actorsReady: actorIds.length,
    namespacePrefix: fixture.namespacePrefix,
    reports,
    providerCalls: context.providerCallLedger.length,
    limitations: RUNTIME_LIMITATIONS,
    cleaned: true,
  }, null, 2))
}

const argv = process.argv.slice(2)
const options = { run: argv.includes("--run") }

if (!options.run) {
  console.log("Registration subject-track concurrency dry run (network-free)")
  console.log(`Required run flags: --run ${REQUIRED_VALUE_FLAGS.join(" ")}`)
  for (const [index, scenario] of PLANNED_SCENARIOS.entries()) {
    console.log(`${index + 1}. ${scenario}`)
  }
  console.log(`Limitation: ${RUNTIME_LIMITATIONS[0]}`)
  process.exitCode = 0
} else {
  await runAuthorizedManifest(argv)
}
