import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type DrilldownRequest =
  | {
    kind: "student-roster"
    subject: string
    division: string
    axis: "grade" | "school" | "grade_school" | "school_grade"
    key: string
    parentKey: string
    cursorName: string | null
    cursorId: string | null
  }
  | {
    kind: "class-group"
    subject: string
    division: string
    axis: "grade" | "teacher" | "classroom"
    key: string
    cursorName: string | null
    cursorId: string | null
  }
  | {
    kind: "class-roster"
    classId: string
    cursorName: string | null
    cursorId: string | null
  }

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  })
}

function value(input: unknown) {
  return typeof input === "string" ? input.trim() : ""
}

function optionalValue(input: unknown) {
  const result = value(input)
  return result || null
}

function parse(body: unknown): DrilldownRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const input = body as Record<string, unknown>
  const kind = value(input.kind)
  const cursorName = optionalValue(input.cursorName)
  const cursorId = optionalValue(input.cursorId)
  if (Boolean(cursorName) !== Boolean(cursorId)) return null

  if (kind === "student-roster") {
    const axis = value(input.axis)
    const subject = value(input.subject)
    const division = value(input.division)
    const key = value(input.key)
    const parentKey = value(input.parentKey)
    if (!subject || !division || !key || !["grade", "school", "grade_school", "school_grade"].includes(axis)) return null
    if (["grade_school", "school_grade"].includes(axis) && !parentKey) return null
    return { kind, subject, division, axis: axis as "grade" | "school" | "grade_school" | "school_grade", key, parentKey, cursorName, cursorId }
  }

  if (kind === "class-group") {
    const axis = value(input.axis)
    const subject = value(input.subject)
    const division = value(input.division)
    const key = value(input.key)
    if (!subject || !division || !key || !["grade", "teacher", "classroom"].includes(axis)) return null
    return { kind, subject, division, axis: axis as "grade" | "teacher" | "classroom", key, cursorName, cursorId }
  }

  if (kind === "class-roster") {
    const classId = value(input.classId)
    if (!classId) return null
    return { kind, classId, cursorName, cursorId }
  }

  return null
}

function bearer(request: Request) {
  return /^Bearer ([^\s]+)$/iu.exec(request.headers.get("authorization") ?? "")?.[1] ?? ""
}

function environment(name: string) {
  return typeof process.env[name] === "string" ? process.env[name]!.trim() : ""
}

function createActorClient(token: string) {
  const url = environment("NEXT_PUBLIC_SUPABASE_URL") || environment("VITE_SUPABASE_URL")
  const key = environment("NEXT_PUBLIC_SUPABASE_ANON_KEY") || environment("VITE_SUPABASE_ANON_KEY")
  if (!url || !key) throw new Error("dashboard_statistics_unauthorized")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

export async function POST(request: Request) {
  const input = parse(await request.json().catch(() => null))
  const token = bearer(request)
  if (!input) return response({ ok: false, error: "dashboard_statistics_drilldown_request_invalid" }, 400)
  if (!token) return response({ ok: false, error: "dashboard_statistics_unauthorized" }, 401)

  try {
    const actorClient = createActorClient(token)
    const user = await actorClient.auth.getUser(token)
    if (user.error || !user.data.user?.id) return response({ ok: false, error: "dashboard_statistics_unauthorized" }, 401)
    const roleResult = await actorClient.rpc("current_dashboard_role").abortSignal(AbortSignal.timeout(8_000)).retry(false)
    const role = value(roleResult.data)
    if (roleResult.error || !["admin", "staff", "teacher"].includes(role)) {
      return response({ ok: false, error: "dashboard_statistics_forbidden" }, 403)
    }

    const parameters = input.kind === "student-roster"
      ? {
        p_subject: input.subject,
        p_division: input.division,
        p_axis: input.axis,
        p_key: input.key,
        p_parent_key: input.parentKey,
        p_cursor_name: input.cursorName,
        p_cursor_id: input.cursorId,
        p_limit: 30,
      }
      : input.kind === "class-group"
        ? {
          p_subject: input.subject,
          p_division: input.division,
          p_axis: input.axis,
          p_key: input.key,
          p_cursor_name: input.cursorName,
          p_cursor_id: input.cursorId,
          p_limit: 30,
        }
        : {
          p_class_id: input.classId,
          p_cursor_name: input.cursorName,
          p_cursor_id: input.cursorId,
          p_limit: 30,
        }
    const rpcName = input.kind === "student-roster"
      ? "list_dashboard_statistics_student_roster_v1"
      : input.kind === "class-group"
        ? "list_dashboard_statistics_class_group_v1"
        : "list_dashboard_statistics_class_roster_v1"
    const result = await actorClient.rpc(rpcName, parameters).abortSignal(AbortSignal.timeout(8_000)).retry(false)
    if (result.error) return response({ ok: false, error: "dashboard_statistics_drilldown_unavailable" }, 503)
    return response({ ok: true, data: result.data })
  } catch {
    return response({ ok: false, error: "dashboard_statistics_drilldown_unavailable" }, 503)
  }
}
