import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import {
  applyMakeupRequestToSchedulePlan,
  buildMakeupCalendarDrafts,
  buildRoomAvailability,
  extractMakeupCalendarMeta,
  hasMakeupPart,
  normalizeMakeupSlots,
} from "@/features/makeup-requests/makeup-request-model.js"
import { buildAcademicEventMutationPayload } from "@/features/operations/academic-event-utils.js"
import { attemptMakeupApprovalReplay } from "@/features/makeup-requests/makeup-approval-replay.js"

export const runtime = "nodejs"

type JsonRecord = Record<string, unknown>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}

function completedApprovalResponse(data: unknown) {
  if (!isRecord(data) || !isRecord(data.request) || !UUID.test(text(data.sourceEventId))) {
    throw new Error("makeup_approval_result_invalid")
  }
  return response({ ok: true, request: data.request, sourceEventId: data.sourceEventId })
}

function supabaseUrl() {
  return text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL)
}

function authenticatedClient(token: string) {
  const url = supabaseUrl()
  const key = text(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)
  if (!url || !key || !token) return null
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

function serviceClient() {
  const url = supabaseUrl()
  const key = text(process.env.SUPABASE_SERVICE_ROLE_KEY)
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function readOne(client: SupabaseClient, table: string, id: string) {
  const { data, error } = await client.from(table).select("*").eq("id", id).single()
  if (error) throw error
  if (!isRecord(data)) throw new Error("makeup_approval_source_invalid")
  return data
}

async function readRows(client: SupabaseClient, table: string) {
  const pageSize = 1000
  const rows: JsonRecord[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error
    const page = asArray(data).filter(isRecord)
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

function isRefundApproval(events: JsonRecord[]) {
  let latestRefundAt = ""
  let latestSubmitOrApproveAt = ""
  for (const event of events) {
    const eventType = text(event.event_type)
    const createdAt = text(event.created_at)
    if (eventType === "refund_requested" && createdAt > latestRefundAt) {
      latestRefundAt = createdAt
    }
    if (["submitted", "resubmitted", "approved"].includes(eventType) && createdAt > latestSubmitOrApproveAt) {
      latestSubmitOrApproveAt = createdAt
    }
  }
  return Boolean(latestRefundAt && latestRefundAt > latestSubmitOrApproveAt)
}

function prepareAcademicEvent(draft: JsonRecord) {
  const mutation = buildAcademicEventMutationPayload(draft, [])
  if (!mutation.isValid || !mutation.payload) {
    throw new Error("makeup_calendar_effects_invalid")
  }
  const payload = mutation.payload as unknown as JsonRecord
  return {
    id: text(payload.id) || crypto.randomUUID(),
    title: text(payload.title),
    date: text(payload.start || payload.start_date || payload.date),
    type: text(payload.type),
    grade: text(payload.grade) || "all",
    note: text(payload.note),
  }
}

function buildApprovalEffects(requestRow: JsonRecord, classRow: JsonRecord) {
  const schedulePlanBefore = isRecord(classRow.schedule_plan) ? classRow.schedule_plan : {}
  const schedulePlanAfter = applyMakeupRequestToSchedulePlan(
    schedulePlanBefore,
    classRow,
    requestRow,
  )
  const calendarDrafts = buildMakeupCalendarDrafts(requestRow)
  const calendarEvents = calendarDrafts.map((draft) => (
    prepareAcademicEvent(draft)
  ))
  const makeupAcademicEventIds: string[] = []
  let cancelAcademicEventId = ""
  for (const [index, event] of calendarEvents.entries()) {
    const draft = calendarDrafts[index]
    const meta = extractMakeupCalendarMeta(text(draft?.note))
    if (meta?.kind === "cancel") cancelAcademicEventId = event.id
    if (meta?.kind === "makeup") makeupAcademicEventIds.push(event.id)
  }
  return {
    schedule_plan_before: schedulePlanBefore,
    schedule_plan_after: schedulePlanAfter,
    cancel_academic_event_id: cancelAcademicEventId,
    makeup_academic_event_id: makeupAcademicEventIds[0] || "",
    makeup_academic_event_ids: makeupAcademicEventIds,
    calendar_events: calendarEvents,
  }
}

function assertCurrentSource(requestRow: JsonRecord, classRow: JsonRecord) {
  if (
    text(requestRow.class_id) !== text(classRow.id)
    || text(requestRow.class_name) !== text(classRow.name)
    || text(requestRow.subject) !== text(classRow.subject)
  ) {
    throw new Error("makeup_request_source_changed")
  }
}

function assertNoRoomCollision(
  requestRow: JsonRecord,
  classes: JsonRecord[],
  requests: JsonRecord[],
  academicEvents: JsonRecord[],
  classrooms: JsonRecord[],
) {
  if (!hasMakeupPart(requestRow)) return
  const slots = normalizeMakeupSlots(requestRow, text(requestRow.makeup_classroom))
  const availability = buildRoomAvailability({
    classrooms,
    classes,
    requests,
    academicEvents,
    slots,
    currentRequestId: text(requestRow.id),
    subject: text(requestRow.subject),
  })
  for (const slot of slots) {
    const room = text(slot.classroom || requestRow.makeup_classroom)
    const target = availability.find((item) => item.name === room)
    if (target && target.collisions.length > 0) {
      throw new Error("makeup_room_collision")
    }
  }
}

export async function POST(request: Request) {
  const authorization = text(request.headers.get("authorization"))
  const token = authorization.replace(/^Bearer\s+/i, "")
  const actorClient = authenticatedClient(token)
  const serverClient = serviceClient()
  if (!actorClient || !token) return response({ ok: false, error: "인증이 필요합니다." }, 401)
  if (!serverClient) return response({ ok: false, error: "휴보강 승인 저장소를 사용할 수 없습니다." }, 503)

  const { data: actor, error: actorError } = await actorClient.auth.getUser(token)
  if (actorError || !actor.user?.id) return response({ ok: false, error: "인증이 필요합니다." }, 401)

  const body = await request.json().catch(() => null)
  if (
    !isRecord(body)
    || Object.keys(body).some((key) => !["requestId", "note", "expectedStatus", "mutationRequestId"].includes(key))
  ) return response({ ok: false, error: "승인 요청 형식이 올바르지 않습니다." }, 400)

  const requestId = text(body.requestId)
  const expectedStatus = text(body.expectedStatus)
  const mutationRequestId = text(body.mutationRequestId)
  const note = text(body.note)
  if (
    !UUID.test(requestId)
    || !UUID.test(mutationRequestId)
    || expectedStatus !== "approval_pending"
    || note.length > 4000
  ) return response({ ok: false, error: "승인 요청 형식이 올바르지 않습니다." }, 400)

  try {
    const replay = await attemptMakeupApprovalReplay({
      client: serverClient,
      requestId,
      actorProfileId: actor.user.id,
      finalNote: note,
      expectedStatus,
      mutationRequestId,
    })
    if (replay.kind === "completed") return completedApprovalResponse(replay.data)

    const requestRow = await readOne(serverClient, "makeup_requests", requestId)
    if (text(requestRow.approver_profile_id) !== actor.user.id) {
      return response({ ok: false, error: "결재 승인 권한이 없습니다." }, 403)
    }
    const classId = text(requestRow.class_id)
    if (!UUID.test(classId)) throw new Error("makeup_request_source_changed")

    const [classRow, eventRows] = await Promise.all([
      readOne(serverClient, "classes", classId),
      serverClient
        .from("makeup_request_events")
        .select("event_type,created_at")
        .eq("request_id", requestId)
        .then(({ data, error }) => {
          if (error) throw error
          return asArray(data).filter(isRecord)
        }),
    ])
    assertCurrentSource(requestRow, classRow)

    const patch: JsonRecord = {
      actor_profile_id: actor.user.id,
      final_note: note,
    }
    if (!isRefundApproval(eventRows)) {
      const [classes, requests, academicEvents, classrooms] = await Promise.all([
        readRows(serverClient, "classes"),
        readRows(serverClient, "makeup_requests"),
        readRows(serverClient, "academic_events"),
        readRows(serverClient, "classroom_catalogs"),
      ])
      assertNoRoomCollision(requestRow, classes, requests, academicEvents, classrooms)
      Object.assign(patch, buildApprovalEffects(requestRow, classRow))
    }

    const { data, error } = await serverClient.rpc("transition_makeup_request_v2", {
      p_makeup_request_id: requestId,
      p_command: "approve",
      p_patch: patch,
      p_expected_status: expectedStatus,
      p_request_id: mutationRequestId,
    })
    if (error) throw error
    return completedApprovalResponse(data)
  } catch (error) {
    const code = text((error as { code?: unknown })?.code)
    const message = text((error as { message?: unknown })?.message)
    const status = code === "42501" ? 403 : code === "40001" ? 409 : code === "P0002" ? 404 : 503
    const userMessage = message === "makeup_room_collision"
      ? "보강 강의실 충돌이 있어 승인하지 못했습니다."
      : message === "makeup_request_source_changed"
        ? "신청 후 수업 정보가 변경되어 다시 확인해야 합니다."
        : "휴보강 승인을 완료하지 못했습니다."
    return response({ ok: false, error: userMessage }, status)
  }
}
