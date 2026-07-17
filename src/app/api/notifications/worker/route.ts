import { createHash, timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

import { createNotificationWorker } from "@/features/notifications/server/notification-worker"
import { getNotificationWorkflowAdapter } from "@/features/notifications/server/notification-workflow-registry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const worker = createNotificationWorker({ getAdapter: getNotificationWorkflowAdapter })

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
    return NextResponse.json({ ok: false, error: "notification_worker_unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const counts = await worker.runBatch({
    workerId: "notification-worker-route-v1",
    batchSize: boundedInteger(body.batch_size, 50, 1, 100),
    leaseSeconds: boundedInteger(body.lease_seconds, 60, 30, 300),
  })
  return NextResponse.json({ ok: true, counts })
}
