import { NextResponse } from "next/server"

import { normalizeDashboardRole, normalizeLoginIdentifier } from "@/lib/auth-utils"

import {
  createOpsAutomationSupabaseClient,
  createSupabaseOpsTaskAutomationStore,
  sendGoogleChatChannelTest,
} from "../../../../server/ops-task-automation-runner.js"

export const dynamic = "force-dynamic"

type ProfileRow = {
  id?: string
  name?: string
  email?: string
  login_id?: string
  role?: string
}

function getBearerToken(request: Request) {
  const authHeader = request.headers.get("authorization") || ""
  return authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : ""
}

async function readJsonBody(request: Request) {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

async function loadAuthorizedProfile(client: ReturnType<typeof createOpsAutomationSupabaseClient>, accessToken: string) {
  if (!client || !accessToken) return null
  const { data: userData, error: userError } = await client.auth.getUser(accessToken)
  const user = userData?.user
  if (userError || !user) return null

  const profileById = await client
    .from("profiles")
    .select("id,name,email,role,login_id")
    .eq("id", user.id)
    .maybeSingle()

  let profile = profileById.data as ProfileRow | null
  if (!profile && user.email) {
    const normalizedEmail = normalizeLoginIdentifier(user.email)
    const normalizedLoginId = normalizedEmail.includes("@") ? normalizedEmail.split("@")[0] : normalizedEmail
    const profileByIdentity = await client
      .from("profiles")
      .select("id,name,email,role,login_id")
      .or(`email.eq.${normalizedEmail},login_id.eq.${normalizedLoginId}`)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    profile = profileByIdentity.data as ProfileRow | null
  }

  const role = normalizeDashboardRole(profile?.role)
  if (role !== "admin" && role !== "staff") return null
  return {
    id: profile?.id || user.id,
    label: profile?.name || profile?.email || user.email || "운영자",
    role,
  }
}

export async function POST(request: Request) {
  const accessToken = getBearerToken(request)
  if (!accessToken) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const client = createOpsAutomationSupabaseClient()
  if (!client) {
    return NextResponse.json({
      ok: false,
      error: "SUPABASE_SERVICE_ROLE_KEY is required for Google Chat test sends.",
    }, { status: 503 })
  }

  const profile = await loadAuthorizedProfile(client, accessToken)
  if (!profile) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
  }

  const body = await readJsonBody(request)
  const channelId = typeof body?.channelId === "string" ? body.channelId.trim() : ""
  if (!channelId) {
    return NextResponse.json({ ok: false, error: "channelId is required." }, { status: 400 })
  }

  const store = createSupabaseOpsTaskAutomationStore(client)
  const sendChannelTest = sendGoogleChatChannelTest as (options: {
    store: unknown
    channelId: string
    actorLabel: string
  }) => Promise<{ ok: boolean; errorMessage?: string; status?: string; channelName?: string }>
  const result = await sendChannelTest({
    store,
    channelId,
    actorLabel: profile.label,
  })

  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
