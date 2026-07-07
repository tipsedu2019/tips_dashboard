import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import webpush from "web-push"

export const runtime = "nodejs"

type WebPushBody = {
  recipientProfileId?: unknown
  recipientTeam?: unknown
  title?: unknown
  body?: unknown
  href?: unknown
  metadata?: Record<string, unknown>
}

type PushSubscriptionRow = {
  id: string
  profile_id: string
  endpoint: string
  p256dh: string
  auth: string
}

function text(value: unknown) {
  return String(value || "").trim()
}

async function assertAuthenticated(request: Request) {
  const supabaseUrl = text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  const supabaseAnonKey = text(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)
  const authorization = text(request.headers.get("authorization"))
  const token = authorization.replace(/^Bearer\s+/i, "")

  if (!supabaseUrl || !supabaseAnonKey || !token) {
    return false
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })
  const { data, error } = await client.auth.getUser(token)
  return Boolean(data.user?.id && !error)
}

function getServiceClient() {
  const supabaseUrl = text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  const serviceRoleKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY)
  if (!supabaseUrl || !serviceRoleKey) return null
  return createClient(supabaseUrl, serviceRoleKey)
}

type ServiceClient = NonNullable<ReturnType<typeof getServiceClient>>

function configureWebPush() {
  const publicKey = text(process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
  const privateKey = text(process.env.WEB_PUSH_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY)
  const contact = text(process.env.WEB_PUSH_CONTACT) || "mailto:admin@tipsedu.co.kr"

  if (!publicKey || !privateKey) {
    return false
  }

  webpush.setVapidDetails(contact, publicKey, privateKey)
  return true
}

async function getRecipientProfileIds(client: ServiceClient, recipientProfileId: string, recipientTeam: string) {
  if (recipientProfileId) return [recipientProfileId]
  if (recipientTeam !== "관리팀") return []

  const { data, error } = await client
    .from("profiles")
    .select("id")
    .in("role", ["admin", "staff"])

  if (error) throw error
  return (data || []).map((row: { id?: unknown }) => text(row.id)).filter(Boolean)
}

async function getSubscriptions(client: ServiceClient, profileIds: string[]) {
  if (profileIds.length === 0) return []

  const { data, error } = await client
    .from("dashboard_push_subscriptions")
    .select("id,profile_id,endpoint,p256dh,auth")
    .in("profile_id", profileIds)

  if (error) throw error
  return (data || []) as PushSubscriptionRow[]
}

async function deleteExpiredSubscription(client: ServiceClient, subscriptionId: string) {
  await client.from("dashboard_push_subscriptions").delete().eq("id", subscriptionId)
}

export async function POST(request: Request) {
  const isAuthenticated = await assertAuthenticated(request)
  if (!isAuthenticated) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const client = getServiceClient()
  if (!client) {
    return NextResponse.json({ ok: true, skipped: true, reason: "missing_service_role" })
  }
  if (!configureWebPush()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "missing_vapid_keys" })
  }

  const body = await request.json().catch(() => ({})) as WebPushBody
  const recipientProfileId = text(body.recipientProfileId)
  const recipientTeam = text(body.recipientTeam)
  const title = text(body.title)
  const messageBody = text(body.body)
  const href = text(body.href) || "/admin/makeup-requests"

  if ((!recipientProfileId && !recipientTeam) || !title) {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 })
  }

  const profileIds = await getRecipientProfileIds(client, recipientProfileId, recipientTeam)
  const subscriptions = await getSubscriptions(client, profileIds)
  const payload = JSON.stringify({
    title,
    body: messageBody,
    href,
    icon: "/favicon-window.png",
    badge: "/favicon-window.png",
    tag: text(body.metadata?.dedupeKey) || text(body.metadata?.requestId) || "tips-dashboard",
  })

  let sent = 0
  let failed = 0
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      }, payload)
      sent += 1
    } catch (error) {
      failed += 1
      const statusCode = (error as { statusCode?: number }).statusCode
      if (statusCode === 404 || statusCode === 410) {
        await deleteExpiredSubscription(client, subscription.id)
      }
    }
  }))

  return NextResponse.json({ ok: true, sent, failed, skipped: subscriptions.length === 0 })
}
