#!/usr/bin/env node

import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

const KNOWN_PRODUCTION_HOSTS = new Set(["slnjqlzzhewblvttiidk.supabase.co"])
const REQUIRED_VALUE_FLAGS = [
  "--url",
  "--anon-key",
  "--service-role-key",
  "--actor-token",
]
const PROOF_SCOPE = [
  "one open word-retest fixture with one fixed parent revision",
  "two independent authenticated clients released from one local barrier",
  "exactly one committed expected time and one 40001 stale writer",
  "unchanged unrelated parent/detail fields and zero source/canonical/job/delivery artifacts",
  "reverse foreign-key cleanup limited to the namespaced fixture",
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
  const suffix = ".supabase.co"
  const projectRef = url.hostname.endsWith(suffix)
    ? url.hostname.slice(0, -suffix.length)
    : ""
  const isLocal = localHosts.has(url.hostname) && ["http:", "https:"].includes(url.protocol)
  const isPreview = url.protocol === "https:"
    && /^[a-z0-9]{20}$/.test(projectRef)
    && !KNOWN_PRODUCTION_HOSTS.has(url.hostname)

  if (KNOWN_PRODUCTION_HOSTS.has(url.hostname)) {
    throw new Error("Production target abort: word-retest concurrency proof is local/preview only")
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Target URL abort: use a credential-free root Supabase URL")
  }
  if (!isLocal && !isPreview) {
    throw new Error("Unrecognized target abort: use localhost or an exact HTTPS Supabase preview project URL")
  }
  return url.toString().replace(/\/$/, "")
}

function decodeJwtSubject(token) {
  const parts = token.split(".")
  if (parts.length !== 3) throw new Error("Actor token is not a JWT")
  let payload
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
  } catch {
    throw new Error("Actor token has an invalid JWT payload")
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("Actor token is missing its actor subject")
  }
  return payload.sub
}

function createAuthenticatedClient(url, anonKey, actorToken) {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${actorToken}` } },
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

async function rpc(client, name, args, label) {
  const { data, error } = await client.rpc(name, args)
  if (error) {
    const failure = new Error(`${label}: ${error.message}`)
    failure.code = error.code
    failure.details = error.details
    throw failure
  }
  return data
}

async function insertOne(client, table, row) {
  const { data, error } = await client.from(table).insert(row).select("*").single()
  if (error) throw new Error(`${table} fixture insert failed: ${error.message}`)
  return data
}

async function readOne(client, table, column, value) {
  const { data, error } = await client.from(table).select("*").eq(column, value).single()
  if (error) throw new Error(`${table} fixture read failed: ${error.message}`)
  return data
}

function withoutKeys(row, keys) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !keys.includes(key)),
  )
}

async function privateRows(client, table, configure = (query) => query) {
  const query = configure(client.schema("dashboard_private").from(table).select("*"))
  const { data, error } = await query
  if (error) throw new Error(`${table} private artifact read failed: ${error.message}`)
  return data || []
}

async function notificationArtifactSnapshot(serviceClient, taskId, requestIds) {
  const { data: sourceRows, error: sourceError } = await serviceClient
    .from("ops_task_events")
    .select("id,request_id")
    .eq("task_id", taskId)
    .in("request_id", requestIds)
  if (sourceError) throw new Error(`notification source read failed: ${sourceError.message}`)

  const canonicalRows = await privateRows(
    serviceClient,
    "notification_events",
    (query) => query.contains("payload", { task_id: taskId }),
  )
  const eventIds = canonicalRows.map((row) => row.id)
  const fanoutRows = eventIds.length
    ? await privateRows(
      serviceClient,
      "notification_event_fanout_jobs",
      (query) => query.in("event_id", eventIds),
    )
    : []
  const deliveryRows = eventIds.length
    ? await privateRows(
      serviceClient,
      "notification_deliveries",
      (query) => query.in("event_id", eventIds),
    )
    : []
  return {
    source: sourceRows?.length || 0,
    canonical: canonicalRows.length,
    jobs: fanoutRows.length,
    deliveries: deliveryRows.length,
    eventIds,
  }
}

async function verifyActor(serviceClient, actorToken) {
  const actorId = decodeJwtSubject(actorToken)
  const { data, error } = await serviceClient
    .from("profiles")
    .select("id,role")
    .eq("id", actorId)
    .single()
  if (error) throw new Error(`Actor profile verification failed: ${error.message}`)
  if (!["admin", "staff"].includes(data.role)) {
    throw new Error(`Actor ${actorId} must have the admin or staff profile role`)
  }
  return actorId
}

async function cleanupFixture(context) {
  const cleanupErrors = []
  const attempt = async (label, operation) => {
    try {
      const { error } = await operation()
      if (error) cleanupErrors.push(new Error(`${label}: ${error.message}`))
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  const canonicalRows = await privateRows(
    context.serviceClient,
    "notification_events",
    (query) => query.contains("payload", { task_id: context.taskId }),
  )
  const eventIds = canonicalRows.map((row) => row.id)
  if (eventIds.length) {
    const deliveryRows = await privateRows(
      context.serviceClient,
      "notification_deliveries",
      (query) => query.in("event_id", eventIds),
    )
    const ownershipRows = await privateRows(
      context.serviceClient,
      "notification_dispatch_ownership_claims",
      (query) => query.in("occurrence_key", canonicalRows.map((row) => row.occurrence_key)),
    )
    if (deliveryRows.length || ownershipRows.length) {
      cleanupErrors.push(new Error(
        `unexpected shared notification artifacts require isolated database disposal: events=${eventIds.join(",")} deliveries=${deliveryRows.map((row) => row.id).join(",")} ownership=${ownershipRows.map((row) => row.id).join(",")}`,
      ))
    } else {
      await attempt("fanout reverse cleanup", () => context.serviceClient
        .schema("dashboard_private")
        .from("notification_event_fanout_jobs")
        .delete()
        .in("event_id", eventIds))
      await attempt("canonical reverse cleanup", () => context.serviceClient
        .schema("dashboard_private")
        .from("notification_events")
        .delete()
        .in("id", eventIds))
    }
  }
  await attempt("source reverse cleanup", () => context.serviceClient
    .from("ops_task_events")
    .delete()
    .eq("task_id", context.taskId))
  await attempt("detail reverse cleanup", () => context.serviceClient
    .from("ops_word_retests")
    .delete()
    .eq("task_id", context.taskId))
  await attempt("parent reverse cleanup", () => context.serviceClient
    .from("ops_tasks")
    .delete()
    .eq("id", context.taskId))
  await attempt("request-ledger reverse cleanup", () => context.serviceClient
    .schema("dashboard_private")
    .from("notification_request_ledger")
    .delete()
    .in("request_id", context.requestIds))

  const { count, error } = await context.serviceClient
    .from("ops_tasks")
    .select("id", { count: "exact", head: true })
    .eq("id", context.taskId)
    .like("memo", `${context.fixtureTag}%`)
  if (error) cleanupErrors.push(new Error(`fixture leftover verification failed: ${error.message}`))
  else if (count !== 0) cleanupErrors.push(new Error("namespaced word-retest fixture was not removed"))
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, "Word-retest concurrency fixture cleanup failed")
  }
}

async function runAuthorizedProof(argv) {
  const url = assertAuthorizedTarget(optionValue(argv, "--url"))
  const anonKey = optionValue(argv, "--anon-key")
  const actorToken = optionValue(argv, "--actor-token")

  // Read and use the service credential only after production-target rejection.
  const serviceRoleKey = optionValue(argv, "--service-role-key")
  const serviceClient = createServiceClient(url, serviceRoleKey)
  const actorId = await verifyActor(serviceClient, actorToken)
  const actorClientA = createAuthenticatedClient(url, anonKey, actorToken)
  const actorClientB = createAuthenticatedClient(url, anonKey, actorToken)

  const namespace = `codex-word-retest-race-${Date.now()}-${randomUUID()}`
  const fixtureTag = `[${namespace}]`
  const taskId = randomUUID()
  const requestIds = [randomUUID(), randomUUID()]
  const context = { serviceClient, fixtureTag, taskId, requestIds }
  let proofError = null
  let report = null

  try {
    const parent = await insertOne(serviceClient, "ops_tasks", {
      id: taskId,
      title: `${fixtureTag} 응시예정일 동시성`,
      type: "word_retest",
      status: "requested",
      priority: "normal",
      requested_by: actorId,
      assignee_id: actorId,
      student_name: `${fixtureTag} 학생`,
      class_name: `${fixtureTag} 수업`,
      campus: "본관",
      subject: "영어",
      due_at: "2026-07-31T10:00:00.000Z",
      memo: `${fixtureTag} parent`,
      created_at: "2026-07-23T00:00:00.000Z",
      updated_at: "2026-07-23T00:00:00.000Z",
    })
    await insertOne(serviceClient, "ops_word_retests", {
      task_id: taskId,
      branch: "본관",
      teacher_name: `${fixtureTag} 선생님`,
      class_name: `${fixtureTag} 수업`,
      student_name: `${fixtureTag} 학생`,
      test_at: "2026-07-24T01:00:00.000Z",
      expected_retest_at: null,
      textbook_name: `${fixtureTag} 교재`,
      unit: "1-10",
      request_note: `${fixtureTag} note`,
      total_question_count: 10,
      cutoff_question_count: 8,
      retest_status: "not_started",
    })

    const beforeParent = await readOne(serviceClient, "ops_tasks", "id", taskId)
    const beforeDetail = await readOne(serviceClient, "ops_word_retests", "task_id", taskId)
    assert.equal(beforeParent.updated_at, parent.updated_at, "fixture must expose one fixed parent revision")
    const beforeArtifacts = await notificationArtifactSnapshot(serviceClient, taskId, requestIds)
    assert.deepEqual(
      withoutKeys(beforeArtifacts, ["eventIds"]),
      { source: 0, canonical: 0, jobs: 0, deliveries: 0 },
      "direct fixture creation must start with zero notification artifacts",
    )

    const expectedValues = [
      "2026-07-24T10:30:00.000Z",
      "2026-07-24T11:00:00.000Z",
    ]
    const barrier = createRaceBarrier(2)
    const results = await Promise.allSettled([
      [actorClientA, expectedValues[0], requestIds[0]],
      [actorClientB, expectedValues[1], requestIds[1]],
    ].map(async ([client, expectedRetestAt, requestId], index) => {
      await barrier()
      return rpc(client, "update_word_retest_expected_at_v1", {
        p_task_id: taskId,
        p_expected_retest_at: expectedRetestAt,
        p_expected_updated_at: beforeParent.updated_at,
        p_request_id: requestId,
      }, `writer-${index + 1}`)
    }))

    const fulfilled = results.filter((result) => result.status === "fulfilled")
    const rejected = results.filter((result) => result.status === "rejected")
    assert.equal(fulfilled.length, 1, "exactly one expected-time writer must commit")
    assert.equal(rejected.length, 1, "exactly one expected-time writer must reject")
    assert.equal(rejected[0].reason.code, "40001", "the loser must be a serialization-style stale write")
    assert.match(rejected[0].reason.message, /stale_write/i, "the loser must identify stale_write")

    const winner = fulfilled[0].value
    const afterParent = await readOne(serviceClient, "ops_tasks", "id", taskId)
    const afterDetail = await readOne(serviceClient, "ops_word_retests", "task_id", taskId)
    assert.equal(winner.taskId, taskId)
    assert.equal(new Date(winner.updatedAt).getTime(), new Date(afterParent.updated_at).getTime())
    assert.notEqual(afterParent.updated_at, beforeParent.updated_at, "the winner must bump the parent revision")
    assert.equal(
      new Date(winner.expectedRetestAt).getTime(),
      new Date(afterDetail.expected_retest_at).getTime(),
      "the committed child value must match the winning response",
    )
    assert.deepEqual(
      withoutKeys(afterParent, ["updated_at"]),
      withoutKeys(beforeParent, ["updated_at"]),
      "the expected-only race must preserve every unrelated parent field",
    )
    assert.deepEqual(
      withoutKeys(afterDetail, ["expected_retest_at", "updated_at"]),
      withoutKeys(beforeDetail, ["expected_retest_at", "updated_at"]),
      "the expected-only race must preserve every unrelated detail field",
    )

    const afterArtifacts = await notificationArtifactSnapshot(serviceClient, taskId, requestIds)
    assert.deepEqual(
      withoutKeys(afterArtifacts, ["eventIds"]),
      { source: 0, canonical: 0, jobs: 0, deliveries: 0 },
      "expected-only concurrent writes must produce zero database notification artifacts",
    )
    report = {
      ok: true,
      scenarioStatus: "executed",
      actorId,
      actorRole: "admin_or_staff_verified",
      namespace,
      taskId,
      winnerExpectedRetestAt: afterDetail.expected_retest_at,
      winnerUpdatedAt: afterParent.updated_at,
      staleWriterCode: rejected[0].reason.code,
      notificationArtifacts: withoutKeys(afterArtifacts, ["eventIds"]),
    }
  } catch (error) {
    proofError = error
  }

  try {
    await cleanupFixture(context)
  } catch (cleanupError) {
    proofError = proofError
      ? new AggregateError([proofError, cleanupError], "Concurrency proof and cleanup failed")
      : cleanupError
  }
  if (proofError) throw proofError
  console.log(JSON.stringify({ ...report, cleaned: true }, null, 2))
}

const argv = process.argv.slice(2)
if (!argv.includes("--run")) {
  console.log("Word-retest expected-time concurrency proof (not executed)")
  console.log(`Required run flags: --run ${REQUIRED_VALUE_FLAGS.join(" ")}`)
  for (const [index, line] of PROOF_SCOPE.entries()) {
    console.log(`${index + 1}. ${line}`)
  }
  process.exitCode = 0
} else {
  await runAuthorizedProof(argv)
}
