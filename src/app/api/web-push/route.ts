import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

const NOTIFICATION_CONTRACT_VERSION = "2"

type WebPushBody = {
  recipientProfileId?: unknown
  recipientTeam?: unknown
  title?: unknown
  body?: unknown
  href?: unknown
  metadata?: Record<string, unknown>
}

function text(value: unknown) {
  return String(value || "").trim()
}

function contractJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "X-Notification-Contract-Version": NOTIFICATION_CONTRACT_VERSION },
  })
}

async function getAuthenticatedUserId(request: Request) {
  const supabaseUrl = text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  const supabaseAnonKey = text(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)
  const authorization = text(request.headers.get("authorization"))
  const token = authorization.replace(/^Bearer\s+/i, "")

  if (!supabaseUrl || !supabaseAnonKey || !token) return ""
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await client.auth.getUser(token)
  return data.user?.id && !error ? data.user.id : ""
}

function getServiceClient() {
  const supabaseUrl = text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  const serviceRoleKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY)
  if (!supabaseUrl || !serviceRoleKey) return null
  return createClient(supabaseUrl, serviceRoleKey)
}

type ServiceClient = NonNullable<ReturnType<typeof getServiceClient>>

async function inspectAndRecordLegacyContract(
  client: ServiceClient,
  actorProfileId: string,
  outcome: "observed" | "rejected",
) {
  const { data: trafficData, error: trafficError } = await client.rpc(
    "record_notification_contract_traffic_v1",
    {
      p_entry_point: "web_push",
      p_contract_kind: "legacy_untranslatable",
      p_outcome: outcome,
      p_actor_profile_id: actorProfileId,
      p_request_id: randomUUID(),
    },
  )
  const traffic = trafficData && typeof trafficData === "object" && !Array.isArray(trafficData)
    ? trafficData as Record<string, unknown>
    : null
  if (trafficError || traffic?.recorded !== true || typeof traffic.closed !== "boolean") {
    throw new Error("notification_contract_telemetry_unavailable")
  }
  return { closed: traffic.closed }
}

export async function POST(request: Request) {
  const actorProfileId = await getAuthenticatedUserId(request)
  if (!actorProfileId) return contractJson({ ok: false, error: "Unauthorized" }, 401)

  const client = getServiceClient()
  if (!client) return contractJson({ ok: false, error: "알림 저장소를 사용할 수 없습니다." }, 503)

  const body = await request.json().catch(() => null) as WebPushBody | null
  const recipientProfileId = text(body?.recipientProfileId)
  const recipientTeam = text(body?.recipientTeam)
  const title = text(body?.title)
  const validLegacyContract = Boolean((recipientProfileId || recipientTeam) && title)

  let closure: { closed: unknown }
  try {
    closure = await inspectAndRecordLegacyContract(
      client,
      actorProfileId,
      validLegacyContract ? "observed" : "rejected",
    )
  } catch {
    return contractJson({ ok: false, error: "알림 계약 계측을 사용할 수 없습니다." }, 503)
  }

  if (closure.closed === true) {
    return contractJson({
      ok: false,
      code: "notification_payload_forbidden",
      contractVersion: NOTIFICATION_CONTRACT_VERSION,
    }, 422)
  }
  if (!validLegacyContract) return contractJson({ ok: false, error: "Invalid request" }, 400)
  // 구형 raw push는 계측만 한다. canonical source event의 고정 route가 동일
  // 업무 알림을 내구성 있는 external-attempt gate 뒤에서 전송한다.
  return contractJson({
    ok: true,
    skipped: true,
    reason: "legacy_payload_observed",
    compatibilityPath: true,
  })
}
