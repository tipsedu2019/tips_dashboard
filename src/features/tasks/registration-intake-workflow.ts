import type { RegistrationSubject } from "./registration-track-service"
import type { RegistrationIntakeRuntimeState } from "./registration-intake-runtime-probe"
import type { RegistrationRuntimeState } from "./registration-runtime-probe"

// registration-intake-workflow-model:start
export type RegistrationInitialAction =
  | "inquiry"
  | "level_test"
  | "direct_phone"
  | "visit"

export type RegistrationInitialWorkflowDraft = {
  subjectPlans: Partial<Record<RegistrationSubject, RegistrationInitialAction>>
  levelTestScheduledAt: string
  levelTestPlace: string
  visitScheduledAt: string
  visitPlace: string
  directorOverrides: Partial<Record<RegistrationSubject, string>>
}

export type RegistrationInitialWorkflowPayload = {
  subjectPlans: Partial<Record<RegistrationSubject, RegistrationInitialAction>>
  levelTestAppointment: {
    scheduledAt: string
    place: string
    subjects: RegistrationSubject[]
  } | null
  visitAppointment: {
    scheduledAt: string
    place: string
    subjects: RegistrationSubject[]
  } | null
  directorOverrides: Partial<Record<RegistrationSubject, string>>
}

export type RegistrationInitialPersistenceMode =
  | "ready_atomic"
  | "canonical_inquiry"
  | "legacy_inquiry"
  | "blocked_maintenance"
  | "blocked_mismatch"

export type RegistrationWritablePersistenceMode =
  | "ready_atomic"
  | "canonical_inquiry"
  | "legacy_inquiry"

export type RegistrationCreateWriter = "atomic" | "canonical" | "legacy"

export type RegistrationInitialPersistenceProbeResult =
  | {
      mode: RegistrationInitialPersistenceMode
      subjectRuntime: RegistrationRuntimeState
      intakeRuntime: RegistrationIntakeRuntimeState
      error?: never
    }
  | {
      mode: "blocked_indeterminate"
      subjectRuntime?: never
      intakeRuntime?: never
      error: unknown
    }

export type RegistrationCreateCommonInput = {
  studentName: string
  schoolGrade: string
  schoolName: string
  parentPhone: string
  studentPhone: string
  campus: string
  inquiryAt: string
  subjects: RegistrationSubject[]
  requestNote: string
  priority: string
}

export type RegistrationCreateAttempt = {
  fingerprint: string
  requestKey: string
  inquiryAt: string
  persistenceMode: RegistrationWritablePersistenceMode
  writer: RegistrationCreateWriter
  legacyCreateStarted: boolean
  common: RegistrationCreateCommonInput
  normalizedInitialWorkflow: RegistrationInitialWorkflowPayload
}

const SUBJECT_ORDER: RegistrationSubject[] = ["영어", "수학"]
const INITIAL_ACTIONS: RegistrationInitialAction[] = ["inquiry", "level_test", "direct_phone", "visit"]

function orderedSubjects(subjects: RegistrationSubject[]) {
  const selected = new Set(subjects)
  return SUBJECT_ORDER.filter((subject) => selected.has(subject))
}

function isRegistrationInitialAction(value: unknown): value is RegistrationInitialAction {
  return INITIAL_ACTIONS.includes(value as RegistrationInitialAction)
}

function requiresDirector(action: RegistrationInitialAction | undefined) {
  return action === "direct_phone" || action === "visit"
}

function hasExactSubjectPlans(
  subjectPlans: RegistrationInitialWorkflowDraft["subjectPlans"],
  subjects: RegistrationSubject[],
) {
  const expected = orderedSubjects(subjects)
  const actual = Object.keys(subjectPlans)
  return actual.length === expected.length && expected.every((subject) => (
    Object.prototype.hasOwnProperty.call(subjectPlans, subject)
    && isRegistrationInitialAction(subjectPlans[subject])
  ))
}

function trimmed(value: string | undefined) {
  return String(value ?? "").trim()
}

export function resolveRegistrationInitialPersistenceMode(
  subjectRuntime: RegistrationRuntimeState,
  intakeRuntime: RegistrationIntakeRuntimeState,
): RegistrationInitialPersistenceMode {
  if (subjectRuntime.mode === "maintenance") return "blocked_maintenance"

  const intakeReady = intakeRuntime.available === true && intakeRuntime.version === 1
  const intakeMissing = intakeRuntime.available === false && intakeRuntime.version === 0

  if (subjectRuntime.mode === "ready" && subjectRuntime.version === 1) {
    if (intakeReady) return "ready_atomic"
    if (intakeMissing) return "canonical_inquiry"
    return "blocked_mismatch"
  }
  if (subjectRuntime.mode === "legacy" && subjectRuntime.version === 0) {
    return intakeMissing ? "legacy_inquiry" : "blocked_mismatch"
  }
  return "blocked_mismatch"
}

export async function probeRegistrationInitialPersistence(input: {
  probeSubjectRuntime: () => Promise<RegistrationRuntimeState>
  probeIntakeRuntime: () => Promise<RegistrationIntakeRuntimeState>
  timeoutMs?: number
}): Promise<RegistrationInitialPersistenceProbeResult> {
  const timeoutMs = input.timeoutMs ?? 8_000
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error("registration_runtime_probe_timeout")), timeoutMs)
  })

  try {
    const [subjectRuntime, intakeRuntime] = await Promise.race([
      Promise.all([input.probeSubjectRuntime(), input.probeIntakeRuntime()]),
      timeout,
    ])
    return {
      mode: resolveRegistrationInitialPersistenceMode(subjectRuntime, intakeRuntime),
      subjectRuntime,
      intakeRuntime,
    }
  } catch (error) {
    return { mode: "blocked_indeterminate", error }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

function normalizedCreateCommon(input: RegistrationCreateCommonInput): RegistrationCreateCommonInput {
  return {
    studentName: trimmed(input.studentName),
    schoolGrade: trimmed(input.schoolGrade),
    schoolName: trimmed(input.schoolName),
    parentPhone: trimmed(input.parentPhone),
    studentPhone: trimmed(input.studentPhone),
    campus: trimmed(input.campus),
    inquiryAt: trimmed(input.inquiryAt),
    subjects: orderedSubjects(input.subjects),
    requestNote: trimmed(input.requestNote),
    priority: trimmed(input.priority),
  }
}

function createAttemptFingerprint(
  common: RegistrationCreateCommonInput,
  workflow: RegistrationInitialWorkflowPayload,
) {
  return JSON.stringify({ common, workflow })
}

function getRegistrationCreateWriter(
  mode: RegistrationWritablePersistenceMode,
): RegistrationCreateWriter {
  if (mode === "ready_atomic") return "atomic"
  if (mode === "canonical_inquiry") return "canonical"
  return "legacy"
}

export function assertRegistrationCreateAttemptPersistenceMode(
  current: RegistrationCreateAttempt | null,
  freshMode: RegistrationInitialPersistenceProbeResult["mode"],
) {
  if (current && current.persistenceMode !== freshMode) {
    throw new Error("registration_persistence_mode_changed")
  }
}

export function createRegistrationCreateAttempt(
  current: RegistrationCreateAttempt | null,
  commonInput: RegistrationCreateCommonInput,
  normalizedInitialWorkflow: RegistrationInitialWorkflowPayload,
  factories: {
    persistenceMode: RegistrationWritablePersistenceMode
    createRequestKey: () => string
    createInquiryAt: () => string
  },
): RegistrationCreateAttempt {
  const common = normalizedCreateCommon(commonInput)
  const fingerprint = createAttemptFingerprint(common, normalizedInitialWorkflow)
  if (current?.fingerprint === fingerprint) {
    assertRegistrationCreateAttemptPersistenceMode(current, factories.persistenceMode)
    return current
  }

  const inquiryAt = common.inquiryAt || factories.createInquiryAt()
  return {
    fingerprint,
    requestKey: factories.createRequestKey(),
    inquiryAt,
    persistenceMode: factories.persistenceMode,
    writer: getRegistrationCreateWriter(factories.persistenceMode),
    legacyCreateStarted: false,
    common: { ...common, inquiryAt },
    normalizedInitialWorkflow: structuredClone(normalizedInitialWorkflow),
  }
}

export function markRegistrationLegacyCreateStarted(
  attempt: RegistrationCreateAttempt,
): RegistrationCreateAttempt {
  if (attempt.writer !== "legacy") {
    throw new Error("registration_legacy_create_writer_invalid")
  }
  if (attempt.legacyCreateStarted) {
    throw new Error("registration_legacy_create_outcome_unknown")
  }
  return { ...attempt, legacyCreateStarted: true }
}

export function toRegistrationScheduledAtIso(value: string) {
  const raw = trimmed(value)
  const naive = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/)
  if (naive) {
    const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", millisecondText = "0"] = naive
    const year = Number(yearText)
    const month = Number(monthText)
    const day = Number(dayText)
    const hour = Number(hourText)
    const minute = Number(minuteText)
    const second = Number(secondText)
    const millisecond = Number(millisecondText.padEnd(3, "0"))
    const wallClock = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond))
    if (
      wallClock.getUTCFullYear() !== year
      || wallClock.getUTCMonth() !== month - 1
      || wallClock.getUTCDate() !== day
      || wallClock.getUTCHours() !== hour
      || wallClock.getUTCMinutes() !== minute
      || wallClock.getUTCSeconds() !== second
      || wallClock.getUTCMilliseconds() !== millisecond
    ) {
      throw new Error("registration_initial_appointment_datetime_invalid")
    }
    return new Date(wallClock.getTime() - (9 * 60 * 60 * 1_000)).toISOString()
  }

  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(raw)) {
    const instant = new Date(raw)
    if (!Number.isNaN(instant.getTime())) return instant.toISOString()
  }
  throw new Error("registration_initial_appointment_datetime_invalid")
}

export function createRegistrationInitialWorkflowDraft(
  subjects: RegistrationSubject[],
): RegistrationInitialWorkflowDraft {
  const subjectPlans: RegistrationInitialWorkflowDraft["subjectPlans"] = {}
  for (const subject of orderedSubjects(subjects)) subjectPlans[subject] = "inquiry"

  return {
    subjectPlans,
    levelTestScheduledAt: "",
    levelTestPlace: "",
    visitScheduledAt: "",
    visitPlace: "",
    directorOverrides: {},
  }
}

export function getRegistrationInitialWorkflowParticipants(
  draft: RegistrationInitialWorkflowDraft,
  action: RegistrationInitialAction,
) {
  return SUBJECT_ORDER.filter((subject) => draft.subjectPlans[subject] === action)
}

export function reconcileRegistrationInitialWorkflowDraft(
  draft: RegistrationInitialWorkflowDraft,
  subjects: RegistrationSubject[],
): RegistrationInitialWorkflowDraft {
  const subjectPlans: RegistrationInitialWorkflowDraft["subjectPlans"] = {}
  const directorOverrides: RegistrationInitialWorkflowDraft["directorOverrides"] = {}

  for (const subject of orderedSubjects(subjects)) {
    const action = draft.subjectPlans[subject]
    subjectPlans[subject] = isRegistrationInitialAction(action) ? action : "inquiry"
    if (
      isRegistrationInitialAction(action)
      && requiresDirector(action)
      && Object.prototype.hasOwnProperty.call(draft.directorOverrides, subject)
    ) {
      directorOverrides[subject] = draft.directorOverrides[subject]
    }
  }

  const next = { ...draft, subjectPlans, directorOverrides }
  if (getRegistrationInitialWorkflowParticipants(next, "level_test").length === 0) {
    next.levelTestScheduledAt = ""
    next.levelTestPlace = ""
  }
  if (getRegistrationInitialWorkflowParticipants(next, "visit").length === 0) {
    next.visitScheduledAt = ""
    next.visitPlace = ""
  }
  return next
}

export function reconcileRegistrationInitialWorkflowCapabilities(
  draft: RegistrationInitialWorkflowDraft,
  allowedInitialActions: readonly RegistrationInitialAction[],
): RegistrationInitialWorkflowDraft {
  const allowed = new Set(allowedInitialActions)
  const subjectPlans = { ...draft.subjectPlans }
  const directorOverrides = { ...draft.directorOverrides }
  let changed = false

  for (const subject of SUBJECT_ORDER) {
    const action = subjectPlans[subject]
    if (!action || allowed.has(action)) continue
    subjectPlans[subject] = "inquiry"
    if (Object.prototype.hasOwnProperty.call(directorOverrides, subject)) {
      delete directorOverrides[subject]
    }
    changed = true
  }

  const next = { ...draft, subjectPlans, directorOverrides }
  if (getRegistrationInitialWorkflowParticipants(next, "level_test").length === 0) {
    if (next.levelTestScheduledAt || next.levelTestPlace) changed = true
    next.levelTestScheduledAt = ""
    next.levelTestPlace = ""
  }
  if (getRegistrationInitialWorkflowParticipants(next, "visit").length === 0) {
    if (next.visitScheduledAt || next.visitPlace) changed = true
    next.visitScheduledAt = ""
    next.visitPlace = ""
  }

  return changed ? next : draft
}

export function setRegistrationInitialSubjectAction(
  draft: RegistrationInitialWorkflowDraft,
  subject: RegistrationSubject,
  action: RegistrationInitialAction,
) {
  const next = {
    ...draft,
    subjectPlans: { ...draft.subjectPlans, [subject]: action },
    directorOverrides: { ...draft.directorOverrides },
  }
  if (!requiresDirector(action)) delete next.directorOverrides[subject]
  if (action !== "level_test" && getRegistrationInitialWorkflowParticipants(next, "level_test").length === 0) {
    next.levelTestScheduledAt = ""
    next.levelTestPlace = ""
  }
  if (action !== "visit" && getRegistrationInitialWorkflowParticipants(next, "visit").length === 0) {
    next.visitScheduledAt = ""
    next.visitPlace = ""
  }
  return next
}

export function getRegistrationInitialPanelState(draft: RegistrationInitialWorkflowDraft) {
  return {
    levelTest: getRegistrationInitialWorkflowParticipants(draft, "level_test").length > 0,
    consultation: (
      getRegistrationInitialWorkflowParticipants(draft, "direct_phone").length > 0
      || getRegistrationInitialWorkflowParticipants(draft, "visit").length > 0
    ),
  }
}

export function normalizeRegistrationInitialWorkflow(
  draft: RegistrationInitialWorkflowDraft,
  subjects: RegistrationSubject[],
): RegistrationInitialWorkflowPayload {
  if (!hasExactSubjectPlans(draft.subjectPlans, subjects)) {
    throw new Error("registration_initial_subject_plan_invalid")
  }

  const subjectPlans: RegistrationInitialWorkflowPayload["subjectPlans"] = {}
  const directorOverrides: RegistrationInitialWorkflowPayload["directorOverrides"] = {}
  for (const subject of orderedSubjects(subjects)) {
    const action = draft.subjectPlans[subject]
    subjectPlans[subject] = action
    const directorId = trimmed(draft.directorOverrides[subject])
    if (requiresDirector(action) && directorId) directorOverrides[subject] = directorId
  }

  const normalizedDraft = { ...draft, subjectPlans }
  const levelTestSubjects = getRegistrationInitialWorkflowParticipants(normalizedDraft, "level_test")
  const visitSubjects = getRegistrationInitialWorkflowParticipants(normalizedDraft, "visit")

  return {
    subjectPlans,
    levelTestAppointment: levelTestSubjects.length > 0 ? {
      scheduledAt: toRegistrationScheduledAtIso(draft.levelTestScheduledAt),
      place: trimmed(draft.levelTestPlace),
      subjects: levelTestSubjects,
    } : null,
    visitAppointment: visitSubjects.length > 0 ? {
      scheduledAt: toRegistrationScheduledAtIso(draft.visitScheduledAt),
      place: trimmed(draft.visitPlace),
      subjects: visitSubjects,
    } : null,
    directorOverrides,
  }
}

export function getRegistrationInitialWorkflowBlockers(
  draft: RegistrationInitialWorkflowDraft,
  subjects: RegistrationSubject[],
  resolvedDirectorIds: Partial<Record<RegistrationSubject, string>>,
) {
  const blockers: string[] = []
  const selectedSubjects = orderedSubjects(subjects)
  if (!hasExactSubjectPlans(draft.subjectPlans, subjects)) blockers.push("과목별 다음 업무")

  const selectedPlanDraft: RegistrationInitialWorkflowDraft = {
    ...draft,
    subjectPlans: Object.fromEntries(selectedSubjects.flatMap((subject) => {
      const action = draft.subjectPlans[subject]
      return isRegistrationInitialAction(action) ? [[subject, action]] : []
    })),
  }

  if (getRegistrationInitialWorkflowParticipants(selectedPlanDraft, "level_test").length > 0) {
    if (!trimmed(draft.levelTestScheduledAt)) blockers.push("레벨테스트 예약일시")
    if (!trimmed(draft.levelTestPlace)) blockers.push("레벨테스트 장소")
  }

  for (const subject of selectedSubjects) {
    const action = draft.subjectPlans[subject]
    if (action !== "direct_phone" && action !== "visit") continue
    const directorId = trimmed(draft.directorOverrides[subject]) || trimmed(resolvedDirectorIds[subject])
    if (!directorId) blockers.push(`${subject} 상담 책임자`)
  }

  if (getRegistrationInitialWorkflowParticipants(selectedPlanDraft, "visit").length > 0) {
    if (!trimmed(draft.visitScheduledAt)) blockers.push("방문상담 예약일시")
    if (!trimmed(draft.visitPlace)) blockers.push("방문상담실")
  }

  return blockers
}
// registration-intake-workflow-model:end
