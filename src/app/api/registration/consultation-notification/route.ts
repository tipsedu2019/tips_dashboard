import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import { isAllowedGoogleChatWebhookUrl } from "@/features/notifications/server/notification-connection-crypto"
import { readLegacyGoogleChatWebhookUrl } from "@/features/notifications/server/legacy-google-chat-connection"

import {
  REGISTRATION_ADMIN_CHAT_CLAIM_TYPE,
  buildRegistrationVisitCanonicalMessage,
  getAdminChatClaimConflictDecision,
  getAdminChatDeliveryFailurePolicy,
  getRegistrationVisitAdminChatKey,
  getRegistrationVisitChangeState,
  getRegistrationVisitNotificationDedupeKey,
  getRegistrationVisitRevisionParticipantTrackIds,
  getRegistrationVisitTrackHref,
} from "@/features/tasks/registration-consultation-notification"

export const runtime = "nodejs"

type Row = Record<string, unknown>
type CanonicalTrackEvent = {
  trackId: string
  subject: string
  reason: string
  changeKind: string
  metadata: Row
  isOldReplacement: boolean
}

const GOOGLE_CHAT_TIMEOUT_MS = 8_000
const DEFAULT_TASK_ORIGIN = "https://tipsedu.co.kr"
const VISIT_NOTIFICATION_CHANGE_KINDS = new Set([
  "created",
  "appointment_updated",
  "appointment_subject_deselected",
  "appointment_canceled",
  "appointment_replaced",
])

function text(value: unknown) {
  return String(value || "").trim()
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseJsonRecord(value: unknown): Row | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Row
  if (typeof value !== "string") return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : null
  } catch {
    return null
  }
}

function getSupabaseUrl() {
  return text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL)
}

function getAuthenticatedClient(token: string) {
  const supabaseUrl = getSupabaseUrl()
  const anonKey = text(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)
  if (!supabaseUrl || !anonKey || !token) return null
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

function getServiceClient() {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY)
  if (!supabaseUrl || !serviceRoleKey) return null
  return createClient(supabaseUrl, serviceRoleKey)
}

type ServiceClient = NonNullable<ReturnType<typeof getServiceClient>>

async function getAuthenticatedContext(request: Request) {
  const authorization = text(request.headers.get("authorization"))
  const token = authorization.replace(/^Bearer\s+/i, "")
  const client = getAuthenticatedClient(token)
  const serviceClient = getServiceClient()
  if (!client || !token) return { user: null, role: "", client: null, serviceClient }

  const { data, error } = await client.auth.getUser(token)
  const user = data.user || null
  if (!user?.id || error) return { user: null, role: "", client: null, serviceClient }

  let role = ""
  if (serviceClient) {
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()
    role = text((profile as Row | null)?.role)
  }
  return { user, role, client, serviceClient }
}

async function probeRegistrationNotificationRuntime(
  client: NonNullable<ReturnType<typeof getAuthenticatedClient>>,
) {
  const { data, error } = await client.rpc("registration_subject_tracks_runtime_version")
  if (error || data !== 1) return { mode: "maintenance" as const, version: 0 as const }
  return { mode: "ready" as const, version: 1 as const }
}

function formatReservationDate(value: string) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(timestamp))
}

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
}

function configuredTaskOrigin(value: unknown) {
  const candidate = text(value)
  if (!candidate) return ""
  try {
    const url = new URL(candidate)
    if (url.protocol === "https:") return url.origin
    if (url.protocol === "http:" && isLocalHostname(url.hostname)) return url.origin
    return ""
  } catch {
    return ""
  }
}

function getTrustedTaskOrigin(request: Request) {
  for (const configuredOrigin of [process.env.NEXT_PUBLIC_SITE_URL, process.env.NEXT_PUBLIC_AUTH_REDIRECT_ORIGIN]) {
    const origin = configuredTaskOrigin(configuredOrigin)
    if (origin) return origin
  }
  try {
    const requestUrl = new URL(request.url)
    if (["http:", "https:"].includes(requestUrl.protocol) && isLocalHostname(requestUrl.hostname)) return requestUrl.origin
  } catch {
    // Fall through to the fixed public origin.
  }
  return DEFAULT_TASK_ORIGIN
}

function eventMatchesAppointmentRevision(
  metadata: Row,
  appointmentId: string,
  notificationRevision: number,
) {
  const directMatch = text(metadata.appointmentId) === appointmentId
    && numberValue(metadata.notificationRevision) === notificationRevision
  const oldReplacementMatch = text(metadata.oldAppointmentId) === appointmentId
    && numberValue(metadata.oldNotificationRevision) === notificationRevision
  const newReplacementMatch = text(metadata.newAppointmentId) === appointmentId
    && numberValue(metadata.notificationRevision) === notificationRevision
  return { matches: directMatch || oldReplacementMatch || newReplacementMatch, isOldReplacement: oldReplacementMatch }
}

function parseCanonicalTrackEvent(
  row: Row,
  appointmentId: string,
  notificationRevision: number,
): CanonicalTrackEvent | null {
  const payload = parseJsonRecord(row.after_value)
  if (!payload || numberValue(payload.version) !== 1) return null
  const metadata = parseJsonRecord(payload.metadata) || {}
  const match = eventMatchesAppointmentRevision(metadata, appointmentId, notificationRevision)
  const trackId = text(payload.trackId)
  const changeKind = text(metadata.changeKind)
  if (!match.matches || !trackId || !VISIT_NOTIFICATION_CHANGE_KINDS.has(changeKind)) return null
  return {
    trackId,
    subject: text(payload.subject),
    reason: text(payload.reason),
    changeKind,
    metadata,
    isOldReplacement: match.isOldReplacement,
  }
}

function isUniqueViolation(error: unknown) {
  return text((error as Row | null)?.code) === "23505"
}

function isGoogleChatWebhookUrl(value: string) {
  return isAllowedGoogleChatWebhookUrl(value)
}

async function getAdminWebhookUrl(serviceClient: ServiceClient) {
  return readLegacyGoogleChatWebhookUrl({
    legacyEnvironmentUrl: text(process.env.GOOGLE_CHAT_WEBHOOK_ADMIN),
    async loadRow() {
      const { data, error } = await serviceClient
        .from("google_chat_webhook_settings")
        .select("webhook_url,connection_state")
        .eq("channel", "admin")
        .maybeSingle()
      if (error) throw error
      const row = data as Row | null
      return {
        found: row !== null,
        connectionState: row ? text(row.connection_state) : null,
        webhookUrl: row ? text(row.webhook_url) : null,
      }
    },
  })
}

async function releaseAdminChatClaim(serviceClient: ServiceClient, adminChatDedupeKey: string) {
  const { error } = await serviceClient
    .from("dashboard_notifications")
    .delete()
    .eq("dedupe_key", adminChatDedupeKey)
  return error ? text(error.message) || "Admin Google Chat claim release failed" : ""
}

async function updateAdminChatClaimStatus(
  serviceClient: ServiceClient,
  adminChatDedupeKey: string,
  status: string,
  metadata: Row,
) {
  const { error } = await serviceClient
    .from("dashboard_notifications")
    .update({
      title: status === "delivery_unknown"
        ? "방문상담 Google Chat 전달 여부 확인 필요"
        : "방문상담 Google Chat 상태 확인 필요",
      metadata: { ...metadata, status },
    })
    .eq("dedupe_key", adminChatDedupeKey)
  return error ? text(error.message) || "Admin Google Chat claim update failed" : ""
}

function responsePayload(
  appointmentId: string,
  notificationRevision: number,
  notifiedTrackIds: string[],
  warning = "",
) {
  return {
    ok: true,
    warning,
    appointmentId,
    notificationRevision,
    notifiedTrackIds,
  }
}

export async function POST(request: Request) {
  const { user, role, client, serviceClient } = await getAuthenticatedContext(request)
  if (!user?.id) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  if (!serviceClient) return NextResponse.json({ ok: false, error: "Missing service role" }, { status: 500 })
  if (!(role === "admin" || role === "staff")) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
  }
  if (!client) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  const runtimeState = await probeRegistrationNotificationRuntime(client).catch(() => ({
    mode: "maintenance" as const,
    version: 0 as const,
  }))
  if (runtimeState.mode !== "ready" || runtimeState.version !== 1) {
    return NextResponse.json({
      ok: false,
      code: "REGISTRATION_MIGRATION_IN_PROGRESS",
      error: "데이터 전환 중입니다. 잠시 후 다시 시도해 주세요.",
    }, { status: 503 })
  }

  const body = await request.json().catch(() => ({}))
  const appointmentId = text(body.appointmentId)
  if (!appointmentId) {
    return NextResponse.json({ ok: false, error: "appointmentId is required" }, { status: 400 })
  }

  const { data: appointment, error: appointmentError } = await serviceClient
    .from("ops_registration_appointments")
    .select("id,task_id,kind,scheduled_at,place,status,notification_revision")
    .eq("id", appointmentId)
    .maybeSingle()
  if (appointmentError) return NextResponse.json({ ok: false, error: appointmentError.message }, { status: 500 })
  if (!appointment) return NextResponse.json({ ok: false, error: "Visit appointment not found" }, { status: 404 })
  if (text(appointment.kind) !== "visit_consultation") {
    return NextResponse.json({ ok: false, error: "Appointment is not a visit consultation" }, { status: 409 })
  }

  const taskId = text(appointment.task_id)
  const notificationRevision = numberValue(appointment.notification_revision)
  if (!taskId || notificationRevision < 1) {
    return NextResponse.json({ ok: false, error: "Appointment revision is invalid" }, { status: 409 })
  }

  const { data: task, error: taskError } = await serviceClient
    .from("ops_tasks")
    .select("id,title,type,student_name")
    .eq("id", taskId)
    .maybeSingle()
  if (taskError) return NextResponse.json({ ok: false, error: taskError.message }, { status: 500 })
  if (!task || text(task.type) !== "registration") {
    return NextResponse.json({ ok: false, error: "Registration task mismatch" }, { status: 409 })
  }

  const { data: consultationRows, error: consultationError } = await serviceClient
    .from("ops_registration_consultations")
    .select("id,track_id,appointment_id,mode,status,director_profile_id")
    .eq("appointment_id", appointmentId)
    .eq("mode", "visit")
  if (consultationError) return NextResponse.json({ ok: false, error: consultationError.message }, { status: 500 })
  const consultations = (consultationRows || []) as Row[]
  if (consultations.length === 0) {
    return NextResponse.json({ ok: false, error: "Visit consultation rows not found" }, { status: 409 })
  }

  const trackIds = Array.from(new Set(consultations.map((row) => text(row.track_id)).filter(Boolean)))
  const { data: trackRows, error: trackError } = await serviceClient
    .from("ops_registration_subject_tracks")
    .select("id,task_id,subject,director_profile_id")
    .in("id", trackIds)
  if (trackError) return NextResponse.json({ ok: false, error: trackError.message }, { status: 500 })
  const tracks = (trackRows || []) as Row[]
  if (tracks.length !== trackIds.length || tracks.some((track) => text(track.task_id) !== taskId)) {
    return NextResponse.json({ ok: false, error: "Visit consultation crosses registration tasks" }, { status: 409 })
  }

  const directorIds = Array.from(new Set(consultations.map((row) => text(row.director_profile_id)).filter(Boolean)))
  if (directorIds.length === 0 || consultations.some((row) => !text(row.director_profile_id))) {
    return NextResponse.json({ ok: false, error: "Visit consultation director is missing" }, { status: 409 })
  }
  const { data: profileRows, error: profileError } = await serviceClient
    .from("profiles")
    .select("id,name,email,login_id,role")
    .in("id", directorIds)
  if (profileError) return NextResponse.json({ ok: false, error: profileError.message }, { status: 500 })
  const profiles = (profileRows || []) as Row[]
  if (profiles.length !== directorIds.length || profiles.some((profile) => text(profile.role) !== "admin")) {
    return NextResponse.json({ ok: false, error: "Visit consultation director is invalid" }, { status: 409 })
  }

  const { data: eventRows, error: eventError } = await serviceClient
    .from("ops_task_events")
    .select("id,field_name,after_value,created_at")
    .eq("task_id", taskId)
    .eq("event_type", "registration_track_event")
  if (eventError) return NextResponse.json({ ok: false, error: eventError.message }, { status: 500 })
  const canonicalEvents = ((eventRows || []) as Row[])
    .map((row) => parseCanonicalTrackEvent(row, appointmentId, notificationRevision))
    .filter((event): event is CanonicalTrackEvent => Boolean(event))
  if (canonicalEvents.length === 0) {
    return NextResponse.json({ ok: false, error: "Appointment revision event mismatch" }, { status: 409 })
  }

  const appointmentStatus = text(appointment.status)
  const hasCancellationRevision = canonicalEvents.some((event) => (
    event.isOldReplacement || ["appointment_canceled", "appointment_subject_deselected"].includes(event.changeKind)
  ))
  if (appointmentStatus !== "scheduled" && !hasCancellationRevision) {
    return NextResponse.json({ ok: false, error: "Appointment terminal event mismatch" }, { status: 409 })
  }

  const revisionParticipantTrackIds = new Set(
    getRegistrationVisitRevisionParticipantTrackIds(canonicalEvents),
  )
  const notifiedTrackIds = trackIds.filter((trackId) => revisionParticipantTrackIds.has(trackId))
  if (notifiedTrackIds.length === 0) {
    return NextResponse.json({ ok: false, error: "Appointment revision changed no attached tracks" }, { status: 409 })
  }

  const trackById = new Map(tracks.map((track) => [text(track.id), track]))
  const profileById = new Map(profiles.map((profile) => [text(profile.id), profile]))
  const consultationByTrackId = new Map(consultations.map((consultation) => [text(consultation.track_id), consultation]))
  const eventByTrackId = new Map(canonicalEvents.map((event) => [event.trackId, event]))
  const subjectDirectorPairs = notifiedTrackIds.map((trackId) => {
    const track = trackById.get(trackId) || {}
    const consultation = consultationByTrackId.get(trackId) || {}
    const director = profileById.get(text(consultation.director_profile_id)) || {}
    return {
      trackId,
      subject: text(track.subject),
      directorProfileId: text(consultation.director_profile_id),
      directorName: text(director.name) || text(director.email) || text(director.login_id) || "상담 책임자",
    }
  })
  const scheduledAt = formatReservationDate(text(appointment.scheduled_at))
  const place = text(appointment.place)
  const oldReplacement = canonicalEvents.some((event) => event.isOldReplacement)
  const summaryChangeKind = oldReplacement
    ? "appointment_replaced"
    : appointmentStatus === "canceled"
      ? "appointment_canceled"
      : canonicalEvents.some((event) => event.changeKind === "created")
        ? "created"
        : "appointment_updated"
  const summaryState = getRegistrationVisitChangeState({ changeKind: summaryChangeKind, isOldAppointment: oldReplacement })
  const reason = canonicalEvents.map((event) => event.reason).find(Boolean) || ""
  const firstTrackId = notifiedTrackIds[0]
  const taskHref = getRegistrationVisitTrackHref(taskId, firstTrackId)
  const taskUrl = new URL(taskHref, getTrustedTaskOrigin(request)).toString()
  const adminMessage = buildRegistrationVisitCanonicalMessage({
    state: summaryState,
    studentName: text(task.student_name) || text(task.title),
    scheduledAt,
    place,
    subjectDirectorPairs,
    reason,
    taskUrl,
  })

  for (const trackId of notifiedTrackIds) {
    const pair = subjectDirectorPairs.find((item) => item.trackId === trackId)
    const event = eventByTrackId.get(trackId) || canonicalEvents[0]
    if (!pair || !event) {
      return NextResponse.json({ ok: false, error: "Canonical visit participant is missing" }, { status: 409 })
    }
    const state = getRegistrationVisitChangeState({
      changeKind: event.changeKind,
      isOldAppointment: event.isOldReplacement,
    })
    const href = getRegistrationVisitTrackHref(taskId, trackId)
    const bodyText = buildRegistrationVisitCanonicalMessage({
      state,
      studentName: text(task.student_name) || text(task.title),
      scheduledAt,
      place,
      subjectDirectorPairs,
      reason: event.reason || reason,
      taskUrl: new URL(href, getTrustedTaskOrigin(request)).toString(),
    })
    const title = state === "canceled" || state === "replaced"
      ? `[${pair.subject}] 방문상담 예약이 ${state === "replaced" ? "교체" : "취소"}되었습니다.`
      : `[${pair.subject}] 방문상담 예약이 ${state === "scheduled" ? "배정" : "변경"}되었습니다.`
    const dedupeKey = getRegistrationVisitNotificationDedupeKey({
      appointmentId,
      notificationRevision,
      trackId,
      directorProfileId: pair.directorProfileId,
    })
    const { error: notificationError } = await serviceClient
      .from("dashboard_notifications")
      .upsert({
        recipient_profile_id: pair.directorProfileId,
        actor_profile_id: user.id,
        type: "registration_consultation",
        title,
        body: bodyText,
        href,
        dedupe_key: dedupeKey,
        metadata: { appointmentId, notificationRevision, taskId, trackId, state },
      }, { onConflict: "dedupe_key", ignoreDuplicates: true })
    if (notificationError) {
      return NextResponse.json({ ok: false, error: notificationError.message }, { status: 500 })
    }
  }

  const adminChatDedupeKey = getRegistrationVisitAdminChatKey(appointmentId, notificationRevision)
  const { data: existingChatEvents, error: eventLookupError } = await serviceClient
    .from("ops_task_events")
    .select("id")
    .eq("task_id", taskId)
    .eq("event_type", "notification_sent")
    .eq("field_name", "admin_google_chat")
    .eq("after_value", adminChatDedupeKey)
    .limit(1)
  if (eventLookupError) return NextResponse.json({ ok: false, error: eventLookupError.message }, { status: 500 })
  if ((existingChatEvents || []).length > 0) {
    return NextResponse.json(responsePayload(appointmentId, notificationRevision, notifiedTrackIds))
  }

  const { error: adminChatClaimError } = await serviceClient
    .from("dashboard_notifications")
    .insert({
      recipient_team: "관리팀",
      actor_profile_id: user.id,
      type: REGISTRATION_ADMIN_CHAT_CLAIM_TYPE,
      title: "방문상담 Google Chat 발송 중",
      body: adminMessage,
      href: taskHref,
      dedupe_key: adminChatDedupeKey,
      metadata: { appointmentId, notificationRevision, taskId, channel: "admin", status: "sending" },
    })
  if (adminChatClaimError) {
    if (isUniqueViolation(adminChatClaimError)) {
      const { data: existingClaim, error: existingClaimError } = await serviceClient
        .from("dashboard_notifications")
        .select("metadata")
        .eq("dedupe_key", adminChatDedupeKey)
        .maybeSingle()
      if (existingClaimError) return NextResponse.json({ ok: false, error: existingClaimError.message }, { status: 500 })
      const existingMetadata = ((existingClaim as Row | null)?.metadata || {}) as Row
      const conflictDecision = getAdminChatClaimConflictDecision(text(existingMetadata.status))
      if (conflictDecision.ok) {
        return NextResponse.json(responsePayload(appointmentId, notificationRevision, notifiedTrackIds))
      }
      return NextResponse.json({ ok: false, error: conflictDecision.error }, { status: conflictDecision.status })
    }
    return NextResponse.json({ ok: false, error: adminChatClaimError.message }, { status: 500 })
  }

  let webhookUrl = ""
  try {
    webhookUrl = await getAdminWebhookUrl(serviceClient)
  } catch (error) {
    const releaseError = await releaseAdminChatClaim(serviceClient, adminChatDedupeKey)
    if (releaseError) return NextResponse.json({ ok: false, error: `Webhook lookup failed; claim release failed: ${releaseError}` }, { status: 500 })
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Webhook lookup failed" }, { status: 500 })
  }
  if (!webhookUrl) {
    const releaseError = await releaseAdminChatClaim(serviceClient, adminChatDedupeKey)
    if (releaseError) return NextResponse.json({ ok: false, error: `Admin Google Chat webhook is not configured; claim release failed: ${releaseError}` }, { status: 500 })
    return NextResponse.json({ ok: false, error: "Admin Google Chat webhook is not configured" }, { status: 503 })
  }
  if (!isGoogleChatWebhookUrl(webhookUrl)) {
    const releaseError = await releaseAdminChatClaim(serviceClient, adminChatDedupeKey)
    if (releaseError) return NextResponse.json({ ok: false, error: `Invalid Admin Google Chat webhook URL; claim release failed: ${releaseError}` }, { status: 500 })
    return NextResponse.json({ ok: false, error: "Invalid Admin Google Chat webhook URL" }, { status: 502 })
  }

  const controller = new AbortController()
  const responseTimeout = setTimeout(() => controller.abort(), GOOGLE_CHAT_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: adminMessage }),
      signal: controller.signal,
    })
  } catch (error) {
    const timedOut = controller.signal.aborted
    const failureKind = timedOut ? "timeout" : "network"
    const deliveryPolicy = getAdminChatDeliveryFailurePolicy(failureKind)
    const claimUpdateError = await updateAdminChatClaimStatus(serviceClient, adminChatDedupeKey, deliveryPolicy.claimStatus, {
      appointmentId,
      notificationRevision,
      taskId,
      channel: "admin",
      status: "delivery_unknown",
      failureKind,
      failedAt: new Date().toISOString(),
    })
    const deliveryError = timedOut
      ? "Admin Google Chat request timed out; 전달 여부를 관리팀에서 확인하세요."
      : `${error instanceof Error ? error.message : "Admin Google Chat request failed"}; 전달 여부를 관리팀에서 확인하세요.`
    return NextResponse.json({ ok: false, error: claimUpdateError ? `${deliveryError} Claim status update failed: ${claimUpdateError}` : deliveryError }, { status: timedOut ? 504 : 502 })
  } finally {
    clearTimeout(responseTimeout)
  }

  if (!response.ok) {
    const errorMessage = await response.text().catch(() => "Admin Google Chat request failed")
    const deliveryPolicy = getAdminChatDeliveryFailurePolicy("http_non_ok")
    const releaseError = deliveryPolicy.releaseClaim
      ? await releaseAdminChatClaim(serviceClient, adminChatDedupeKey)
      : ""
    if (releaseError) return NextResponse.json({ ok: false, error: `${errorMessage}; claim release failed: ${releaseError}` }, { status: 500 })
    return NextResponse.json({ ok: false, error: errorMessage }, { status: 502 })
  }

  const deliveryWarnings: string[] = []
  const { error: claimUpdateError } = await serviceClient
    .from("dashboard_notifications")
    .update({
      title: "방문상담 Google Chat 발송 완료",
      metadata: { appointmentId, notificationRevision, taskId, channel: "admin", status: "sent", sentAt: new Date().toISOString() },
    })
    .eq("dedupe_key", adminChatDedupeKey)
  if (claimUpdateError) {
    console.error("방문상담 Google Chat claim 완료 기록 실패", claimUpdateError)
    deliveryWarnings.push("Google Chat claim 완료 기록을 확인하세요.")
  }

  const { error: eventInsertError } = await serviceClient
    .from("ops_task_events")
    .insert({
      task_id: taskId,
      actor_id: user.id,
      event_type: "notification_sent",
      field_name: "admin_google_chat",
      after_value: adminChatDedupeKey,
    })
  if (eventInsertError) {
    console.error("방문상담 Google Chat 감사 이력 저장 실패", eventInsertError)
    deliveryWarnings.push("Google Chat 감사 이력을 확인하세요.")
  }

  return NextResponse.json(responsePayload(
    appointmentId,
    notificationRevision,
    notifiedTrackIds,
    deliveryWarnings.join(" "),
  ))
}
