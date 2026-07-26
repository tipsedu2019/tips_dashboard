#!/usr/bin/env node

import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

import { createClient } from "@supabase/supabase-js"

const RUN = process.argv.includes("--run")
const PROOF_SCOPE = {
  executed: false,
  proof: [
    "same canonical conflict create/create uses two independent authenticated connections",
    "source update wins before_source_lock and create rejects dashboard_conflict_stale",
    "provider-zero: task events, notification events, fanout jobs, and deliveries are counted only for created task UUIDs",
    "only this run's prefix-validated exact UUID fixtures are deleted; disposable localhost reset remains mandatory",
  ],
}

if (!RUN) {
  console.log(JSON.stringify(PROOF_SCOPE, null, 2))
  process.exit(0)
}

function required(name) {
  const value = String(process.env[name] || "").trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function assertDisposableLocalUrl(rawUrl) {
  const url = new URL(rawUrl)
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("Concurrency proof refuses non-local and production hosts")
  }
  if (required("DASHBOARD_CONFLICT_DATABASE_SCOPE") !== "local") {
    throw new Error("DASHBOARD_CONFLICT_DATABASE_SCOPE=local is required")
  }
  if (required("DASHBOARD_CONFLICT_DISPOSABLE") !== "1") {
    throw new Error("DASHBOARD_CONFLICT_DISPOSABLE=1 is required")
  }
  return url.toString().replace(/\/$/, "")
}

function actorIdFromToken(token) {
  const parts = token.split(".")
  if (parts.length !== 3) throw new Error("Actor token is not a JWT")
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
  const actorId = String(payload.sub || "")
  if (!actorId) throw new Error("Actor token has no sub claim")
  return actorId
}

function authenticatedClient(url, anonKey, token) {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

function serviceClientFor(url, serviceRoleKey) {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function makeClass(id, name, teacher, schedule) {
  return {
    id,
    name,
    class_type: "정규",
    subject: "영어",
    grade: "고1",
    teacher,
    schedule,
    room: "동시성 검증실",
    capacity: 12,
    fee: 0,
    status: "수업 진행 중",
    student_ids: [],
    waitlist_ids: [],
    textbook_ids: [],
    lessons: [],
    schedule_plan: {},
  }
}

function conflictInput(classIds, teacher, overlapEnd = "10:30") {
  return {
    type: "teacher",
    occurrenceKind: "weekly",
    classIds,
    studentIds: [],
    examEventIds: [],
    examDetailIds: [],
    teacherCatalogIds: [],
    classroomCatalogIds: [],
    weekday: "월",
    overlapStart: "09:30",
    overlapEnd,
    examDate: "",
    examRule: "",
    _verificationTeacher: teacher,
  }
}

function rpcConflict(input) {
  const source = { ...input }
  delete source._verificationTeacher
  return source
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  if (error) {
    const wrapped = new Error(error.message || name)
    wrapped.code = error.code
    wrapped.details = error.details
    throw wrapped
  }
  return data
}

async function notificationSnapshot(serviceClient, taskIds) {
  const result = await rpc(serviceClient, "get_dashboard_conflict_notification_counts_v1", {
    p_task_ids: taskIds,
  })
  return {
    taskEvents: Number(result?.taskEvents || 0),
    notificationEvents: Number(result?.notificationEvents || 0),
    fanoutJobs: Number(result?.fanoutJobs || 0),
    deliveries: Number(result?.deliveries || 0),
  }
}

async function pollCheckpoint(serviceClient, requestId, phase) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const state = await rpc(serviceClient, "get_dashboard_conflict_checkpoint_v1", {
      p_request_id: requestId,
      p_phase: phase,
    })
    if (state?.reached) return state
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  throw new Error(`Checkpoint was not reached: ${phase}`)
}

const supabaseUrl = assertDisposableLocalUrl(required("SUPABASE_URL"))
const anonKey = required("SUPABASE_ANON_KEY")
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY")
const actorTokenA = required("DASHBOARD_CONFLICT_ACTOR_TOKEN_A")
const actorTokenB = required("DASHBOARD_CONFLICT_ACTOR_TOKEN_B")
const actorIdA = actorIdFromToken(actorTokenA)
const actorIdB = actorIdFromToken(actorTokenB)
assert.notEqual(actorIdA, actorIdB, "two independent actors are required")

const actorClientA = authenticatedClient(supabaseUrl, anonKey, actorTokenA)
const actorClientB = authenticatedClient(supabaseUrl, anonKey, actorTokenB)
const serviceClient = serviceClientFor(supabaseUrl, serviceRoleKey)
const runLabel = `__dashboard_conflict_verify__${randomUUID().slice(0, 8)}`
const classIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
const requestIds = [randomUUID(), randomUUID(), randomUUID()]
const createdTaskIds = new Set()
let fixtureSeeded = false
const fixtureClasses = [
  makeClass(classIds[0], `${runLabel}_A`, runLabel, "월 09:00-11:00"),
  makeClass(classIds[1], `${runLabel}_B`, runLabel, "월 09:30-10:30"),
  makeClass(classIds[2], `${runLabel}_C`, `${runLabel}_race`, "월 09:00-11:00"),
  makeClass(classIds[3], `${runLabel}_D`, `${runLabel}_race`, "월 09:30-10:30"),
]

async function cleanupFixture() {
  if (!fixtureSeeded) return
  await rpc(serviceClient, "cleanup_dashboard_conflict_fixture_v1", {
    p_task_ids: [...createdTaskIds],
    p_class_ids: classIds,
  })
}

let proofError = null
try {
  const { error: seedError } = await serviceClient.from("classes").insert(fixtureClasses)
  if (seedError) throw new Error(`fixture seed failed: ${seedError.message}`)
  fixtureSeeded = true

  const sameConflict = rpcConflict(conflictInput(classIds.slice(0, 2), runLabel))
  const createPhase = "after_source_lock"
  await rpc(serviceClient, "arm_dashboard_conflict_checkpoint_v1", {
    p_request_id: requestIds[0],
    p_phase: createPhase,
    p_class_ids: classIds.slice(0, 2),
  })
  await rpc(serviceClient, "arm_dashboard_conflict_checkpoint_v1", {
    p_request_id: requestIds[1],
    p_phase: "before_source_lock",
    p_class_ids: classIds.slice(0, 2),
  })
  const leftPromise = rpc(actorClientA, "create_dashboard_conflict_task_v1", {
    p_conflict: sameConflict,
    p_request_id: requestIds[0],
  })
  await pollCheckpoint(serviceClient, requestIds[0], createPhase)
  const rightPromise = rpc(actorClientB, "create_dashboard_conflict_task_v1", {
    p_conflict: sameConflict,
    p_request_id: requestIds[1],
  })
  await new Promise((resolve) => setTimeout(resolve, 75))
  const rightBeforeRelease = await rpc(serviceClient, "get_dashboard_conflict_checkpoint_v1", {
    p_request_id: requestIds[1],
    p_phase: "before_source_lock",
  })
  assert.equal(rightBeforeRelease.reached, false, "second create reached source lock while canonical lock was held")
  await rpc(serviceClient, "release_dashboard_conflict_checkpoint_v1", {
    p_request_id: requestIds[0],
    p_phase: createPhase,
  })
  await pollCheckpoint(serviceClient, requestIds[1], "before_source_lock")
  await rpc(serviceClient, "release_dashboard_conflict_checkpoint_v1", {
    p_request_id: requestIds[1],
    p_phase: "before_source_lock",
  })
  const [left, right] = await Promise.all([leftPromise, rightPromise])
  assert.equal(left.linked, true)
  assert.equal(right.linked, true)
  assert.equal([left.alreadyExists, right.alreadyExists].filter(Boolean).length, 1)
  for (const result of [left, right]) {
    if (result.taskId) createdTaskIds.add(result.taskId)
  }
  const { data: matchingTasks, error: matchingError } = await serviceClient
    .from("ops_tasks")
    .select("id,title")
    .ilike("title", `%${runLabel}%`)
  if (matchingError) throw new Error(matchingError.message)
  assert.equal(matchingTasks.length, 1, "create/create must produce one task")
  createdTaskIds.add(matchingTasks[0].id)

  const phase = "before_source_lock"
  await rpc(serviceClient, "arm_dashboard_conflict_checkpoint_v1", {
    p_request_id: requestIds[2],
    p_phase: phase,
    p_class_ids: classIds.slice(2, 4),
  })
  const racingConflict = rpcConflict(conflictInput(classIds.slice(2, 4), `${runLabel}_race`))
  const createPromise = rpc(actorClientA, "create_dashboard_conflict_task_v1", {
    p_conflict: racingConflict,
    p_request_id: requestIds[2],
  })
  await pollCheckpoint(serviceClient, requestIds[2], phase)
  const { error: updateError } = await serviceClient
    .from("classes")
    .update({ schedule: "화 09:30-10:30" })
    .eq("id", classIds[3])
  if (updateError) throw new Error(updateError.message)
  await rpc(serviceClient, "release_dashboard_conflict_checkpoint_v1", {
    p_request_id: requestIds[2],
    p_phase: phase,
  })
  await assert.rejects(createPromise, (error) => {
    assert.equal(error.code, "40001")
    assert.match(error.message, /dashboard_conflict_stale/)
    return true
  })

  const after = await notificationSnapshot(serviceClient, [...createdTaskIds])
  assert.deepEqual(after, {
    taskEvents: 0,
    notificationEvents: 0,
    fanoutJobs: 0,
    deliveries: 0,
  }, "dashboard conflict task creation emitted notification artifacts")
  console.log(JSON.stringify({ ...PROOF_SCOPE, executed: true, sameKey: "one task/link", sourceRace: "dashboard_conflict_stale", providerZero: after }, null, 2))
} catch (error) {
  proofError = error
} finally {
  for (const [requestId, phase] of requestIds.flatMap((requestId) => [
    [requestId, "before_source_lock"],
    [requestId, "after_source_lock"],
  ])) {
    try {
      await rpc(serviceClient, "release_dashboard_conflict_checkpoint_v1", {
        p_request_id: requestId,
        p_phase: phase,
      })
      await rpc(serviceClient, "disarm_dashboard_conflict_checkpoint_v1", {
        p_request_id: requestId,
        p_phase: phase,
      })
    } catch {
      // Best-effort exact checkpoint cleanup on a disposable local database.
    }
  }
  try {
    await cleanupFixture()
  } catch (cleanupError) {
    proofError ||= cleanupError
  }
}

if (proofError) throw proofError
