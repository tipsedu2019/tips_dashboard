import { NextResponse } from "next/server"

import { normalizeDashboardRole, normalizeLoginIdentifier } from "@/lib/auth-utils"

import {
  createOpsAutomationSupabaseClient,
  createSupabaseOpsTaskAutomationStore,
  runTriggerAutomation,
} from "../../../../server/ops-task-automation-runner.js"

export const dynamic = "force-dynamic"

type ProfileRow = {
  id?: string
  name?: string
  email?: string
  login_id?: string
  role?: string
}

type TriggerBody = Record<string, unknown>

function text(value: unknown) {
  return String(value || "").trim()
}

function getBearerToken(request: Request) {
  const authHeader = request.headers.get("authorization") || ""
  return authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : ""
}

async function readJsonBody(request: Request): Promise<TriggerBody> {
  try {
    const body = await request.json()
    return body && typeof body === "object" && !Array.isArray(body) ? body as TriggerBody : {}
  } catch {
    return {}
  }
}

function objectBodyValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
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

function buildAutomationEvent(body: TriggerBody, actor: { id: string; label: string }) {
  const trigger = text(body.trigger)
  const sourceType = text(body.sourceType)
  const sourceId = text(body.sourceId)
  if (!trigger || !sourceType || !sourceId) return null

  const task = objectBodyValue(body.task)
  const classItem = objectBodyValue(body.classItem)
  const teacher = objectBodyValue(body.teacher)
  const academicEvent = objectBodyValue(body.academicEvent)

  return {
    trigger,
    sourceType,
    sourceId,
    occurredAt: text(body.occurredAt) || new Date().toISOString(),
    task,
    classItem,
    teacher,
    academicEvent,
    actor,
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
      error: "SUPABASE_SERVICE_ROLE_KEY is required for ops task automations.",
    }, { status: 503 })
  }

  const profile = await loadAuthorizedProfile(client, accessToken)
  if (!profile) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
  }

  const body = await readJsonBody(request)
  const event = buildAutomationEvent(body, { id: profile.id, label: profile.label })
  if (!event) {
    return NextResponse.json({ ok: false, error: "trigger, sourceType, and sourceId are required." }, { status: 400 })
  }

  const store = createSupabaseOpsTaskAutomationStore(client)
  const result = await runTriggerAutomation({ store, event })

  return NextResponse.json({ ok: true, result })
}
