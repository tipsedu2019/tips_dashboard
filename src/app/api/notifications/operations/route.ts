import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import {
  normalizeNotificationOperationsMetrics,
  notificationOperationsBlockers,
} from "@/features/notifications/server/notification-operations-metrics"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CONTRACT_VERSION = "2"

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Notification-Contract-Version": CONTRACT_VERSION,
    },
  })
}

function clients(request: Request) {
  const url = text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  const anonKey = text(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)
  const serviceKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY)
  const authorization = text(request.headers.get("authorization"))
  const token = authorization.replace(/^Bearer\s+/i, "")
  if (!url || !anonKey || !serviceKey || !token) return null
  return {
    token,
    actor: createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    }),
    service: createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
  }
}

export async function GET(request: Request) {
  const context = clients(request)
  if (!context) return response({ ok: false, error: "Unauthorized" }, 401)

  const { data: actorData, error: actorError } = await context.actor.auth.getUser(context.token)
  const actorId = actorData.user?.id
  if (actorError || !actorId) return response({ ok: false, error: "Unauthorized" }, 401)
  const { data: profile, error: profileError } = await context.service
    .from("profiles")
    .select("role")
    .eq("id", actorId)
    .maybeSingle()
  const role = text((profile as { role?: unknown } | null)?.role)
  if (profileError || !["admin", "staff"].includes(role)) {
    return response({ ok: false, error: "Forbidden" }, 403)
  }

  const { data, error } = await context.service.rpc("get_notification_operations_metrics_v1")
  if (error) return response({ ok: false, error: "notification_operations_unavailable" }, 503)
  try {
    const metrics = normalizeNotificationOperationsMetrics(data)
    return response({
      ok: true,
      contractVersion: CONTRACT_VERSION,
      metrics,
      blockers: notificationOperationsBlockers(metrics),
    })
  } catch {
    return response({ ok: false, error: "notification_operations_invalid" }, 503)
  }
}
