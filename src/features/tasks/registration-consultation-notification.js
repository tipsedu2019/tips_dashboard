export const REGISTRATION_ADMIN_CHAT_CLAIM_TYPE =
  "registration_consultation_admin_chat"

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}

export function getAdminChatClaimConflictDecision(status) {
  const normalizedStatus = text(status)

  if (normalizedStatus === "sent") {
    return { ok: true, status: 200, error: "" }
  }

  if (normalizedStatus === "delivery_unknown") {
    return {
      ok: false,
      status: 409,
      error: "Google Chat 전달 여부가 불확실합니다. 관리팀에서 확인하세요.",
    }
  }

  return {
    ok: false,
    status: 409,
    error: "Google Chat 발송 상태를 확인하세요.",
  }
}

export function getAdminChatDeliveryFailurePolicy(kind) {
  if (kind === "pre_send" || kind === "http_non_ok") {
    return {
      releaseClaim: true,
      claimStatus: "",
    }
  }

  return {
    releaseClaim: false,
    claimStatus: "delivery_unknown",
  }
}

export function getConsultationNotificationWarning(payload = {}) {
  if (payload?.ok !== true) return ""
  return text(payload.warning)
}

function registrationVisitNotificationTargetKey(target = {}) {
  return `${text(target.appointmentId)}:${String(Number(target.notificationRevision))}`
}

export function mergeRegistrationVisitNotificationTargets(current = [], incoming = []) {
  const merged = new Map()
  for (const target of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    merged.set(registrationVisitNotificationTargetKey(target), target)
  }
  return Array.from(merged.values())
}

export function reconcileRegistrationVisitNotificationRetryTargets(current = [], attempted = [], failed = []) {
  const attemptedKeys = new Set(
    (Array.isArray(attempted) ? attempted : []).map(registrationVisitNotificationTargetKey),
  )
  const untouched = (Array.isArray(current) ? current : []).filter((target) => (
    !attemptedKeys.has(registrationVisitNotificationTargetKey(target))
  ))
  return mergeRegistrationVisitNotificationTargets(untouched, failed)
}

export function partitionRegistrationVisitNotificationResults(targets = [], results = []) {
  const failedTargets = []
  const warnings = []
  const normalizedTargets = Array.isArray(targets) ? targets : []
  const normalizedResults = Array.isArray(results) ? results : []

  normalizedTargets.forEach((target, index) => {
    const result = normalizedResults[index]
    if (!result || result.status === "rejected" || result.value?.ok === false) {
      failedTargets.push(target)
      return
    }
    const warning = getConsultationNotificationWarning(result.value)
    if (warning) warnings.push(warning)
  })

  return { failedTargets, warnings }
}

export async function dispatchRegistrationVisitNotificationTargets(targets = [], sendTarget) {
  const normalizedTargets = Array.isArray(targets) ? targets : []
  const results = await Promise.allSettled(normalizedTargets.map((target) => sendTarget(target)))
  return partitionRegistrationVisitNotificationResults(normalizedTargets, results)
}

export function getRegistrationVisitNotificationDedupeKey(input = {}) {
  return [
    "registration:visit",
    text(input.appointmentId),
    "revision",
    String(Number(input.notificationRevision)),
    "track",
    text(input.trackId),
    "director",
    text(input.directorProfileId),
  ].join(":")
}

export function getRegistrationVisitAdminChatKey(appointmentId, notificationRevision) {
  return `registration:visit:${text(appointmentId)}:revision:${Number(notificationRevision)}:admin-chat`
}

export function getRegistrationVisitTrackHref(taskId, trackId) {
  return `/admin/registration?taskId=${encodeURIComponent(text(taskId))}&trackId=${encodeURIComponent(text(trackId))}`
}

export function getRegistrationVisitRevisionParticipantTrackIds(events = []) {
  const trackIds = new Set()
  for (const event of Array.isArray(events) ? events : []) {
    const metadata = event?.metadata && typeof event.metadata === "object"
      ? event.metadata
      : {}
    const candidates = [
      event?.trackId,
      ...(Array.isArray(metadata.activeTrackIds) ? metadata.activeTrackIds : []),
      ...(Array.isArray(metadata.canceledTrackIds) ? metadata.canceledTrackIds : []),
    ]
    for (const candidate of candidates) {
      const trackId = text(candidate)
      if (trackId) trackIds.add(trackId)
    }
  }
  return Array.from(trackIds).sort()
}

export function getRegistrationVisitChangeState(input = {}) {
  const changeKind = text(input.changeKind)
  if (changeKind === "appointment_replaced" && input.isOldAppointment) return "replaced"
  if (["appointment_canceled", "appointment_subject_deselected"].includes(changeKind)) return "canceled"
  if (changeKind === "created") return "scheduled"
  return "updated"
}

export function buildRegistrationVisitCanonicalMessage(input = {}) {
  const pairs = Array.isArray(input.subjectDirectorPairs) ? input.subjectDirectorPairs : []
  const stateLabel = {
    scheduled: "예약",
    updated: "예약 변경",
    canceled: "예약 취소",
    replaced: "기존 예약 교체",
  }[text(input.state)] || "예약 변경"
  const subjectLines = pairs.map((pair) => (
    `${text(pair.subject) || "과목"}: ${text(pair.directorName) || "상담 책임자"}`
  ))
  return [
    `[등록] 방문상담 ${stateLabel}`,
    `학생: ${text(input.studentName) || "미정"}`,
    `일시: ${text(input.scheduledAt) || "미정"}`,
    `장소: ${text(input.place) || "미정"}`,
    subjectLines.length > 0 ? `과목·책임자:\n${subjectLines.join("\n")}` : "",
    text(input.reason) ? `사유: ${text(input.reason)}` : "",
    text(input.taskUrl),
  ].filter(Boolean).join("\n")
}

export async function sendRegistrationVisitNotificationTarget(target = {}, sessionToken = "") {
  const appointmentId = text(target.appointmentId)
  if (!appointmentId) throw new Error("방문상담 예약 ID를 확인하세요.")
  const fixtureModule = await import("./registration-track-fixture-runtime").catch(() => null)
  const fixture = fixtureModule?.executeRegistrationSubjectTrackFixtureAction(
    "sendRegistrationVisitNotificationTarget",
    target,
  ) || null
  if (fixture) return fixture
  if (!text(sessionToken)) throw new Error("로그인 세션을 확인하세요.")

  const response = await fetch("/api/registration/consultation-notification", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${text(sessionToken)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ appointmentId }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok !== true) {
    throw new Error(text(payload?.error) || "방문상담 예약 알림을 보내지 못했습니다.")
  }
  return payload
}
