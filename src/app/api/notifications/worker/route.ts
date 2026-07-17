import { createHash, timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

import { createNotificationWorker } from "@/features/notifications/server/notification-worker"
import { getNotificationWorkflowAdapter } from "@/features/notifications/server/notification-workflow-registry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const worker = createNotificationWorker({ getAdapter: getNotificationWorkflowAdapter })
const NOTIFICATION_CONTRACT_VERSION = "2"

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "X-Notification-Contract-Version": NOTIFICATION_CONTRACT_VERSION },
  })
}

function serviceClient() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim()
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function secureTextEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left, "utf8").digest()
  const rightDigest = createHash("sha256").update(right, "utf8").digest()
  return timingSafeEqual(leftDigest, rightDigest)
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : fallback
}

export async function POST(request: Request) {
  const workerSecret = String(process.env.NOTIFICATION_WORKER_SECRET || "").trim()
  const authorization = request.headers.get("authorization") || ""
  const authorized = Boolean(workerSecret) && secureTextEqual(authorization, `Bearer ${workerSecret}`)
  if (!authorized) {
    return NextResponse.json({ ok: false, error: "notification_worker_unauthorized" }, {
      status: 401,
      headers: { "X-Notification-Contract-Version": NOTIFICATION_CONTRACT_VERSION },
    })
  }

  const client = serviceClient()
  if (!client) return response({ ok: false, error: "notification_worker_unavailable" }, 503)
  const { data: runtimeGate, error: runtimeGateError } = await client.rpc(
    "assert_notification_worker_run_allowed_v1",
    { p_worker_id: "notification-worker-route-v1" },
  )
  const gate = runtimeGate as { allowed?: unknown } | null
  if (runtimeGateError || gate?.allowed !== true) {
    return response({ ok: false, error: "notification_worker_stopped" }, 423)
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  if (Object.keys(body).some((key) => !["batch_size", "lease_seconds"].includes(key))) {
    return response({ ok: false, error: "notification_worker_request_invalid" }, 400)
  }
  const counts = await worker.runBatch({
    workerId: "notification-worker-route-v1",
    batchSize: boundedInteger(body.batch_size, 50, 1, 100),
    leaseSeconds: boundedInteger(body.lease_seconds, 60, 30, 300),
  })
  return response({ ok: true, counts, contractVersion: NOTIFICATION_CONTRACT_VERSION })
}
