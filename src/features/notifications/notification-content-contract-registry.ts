import {
  NOTIFICATION_CONNECTION_KEYS,
  type NotificationConnectionKey,
  type NotificationContentContract,
  type NotificationContentContractEntry,
  type NotificationContentContractIdentity,
  type NotificationFieldPresenceRule,
  type NotificationMustHaveFact,
  type NotificationTemplateVariableDto,
} from "./notification-control-plane-types.ts"
import {
  freezeNotificationContentContract,
  notificationContentIdentityKey,
} from "./notification-content-contract.ts"
import {
  listNotificationContentCoverage,
  listNotificationContentRuleIdentities,
} from "./notification-content-manifest.ts"

type EventContractSpec = Readonly<{
  requiredTokens: ReadonlyArray<string>
  optionalLineTokens: ReadonlyArray<string>
  mustHaveFacts: ReadonlyArray<NotificationMustHaveFact>
  supportedPayloadVersions: ReadonlyArray<number>
  freeTextVisibility: Readonly<Record<string, "show" | "omit">>
  freeTextPriority: ReadonlyArray<string>
  fieldPresenceOverrides: Readonly<Record<string, NotificationFieldPresenceRule>>
}>

const CONTRACT_VERSION = "1"
const DEFAULT_FACTS = ["target", "event"] as const satisfies ReadonlyArray<NotificationMustHaveFact>

function variable(key: string, piiClass = "none") {
  return Object.freeze({ key, piiClass })
}

const VARIABLE_BY_TOKEN = Object.freeze({
  업무: variable("task_title"),
  현재상태: variable("current_status"),
  현재담당: variable("current_assignee", "staff_name"),
  기존담당: variable("before_assignee", "staff_name"),
  새담당: variable("after_assignee", "staff_name"),
  기존일정: variable("before_schedule", "schedule"),
  새일정: variable("after_schedule", "schedule"),
  기존상태: variable("before_status"),
  새상태: variable("after_status"),
  완료상태: variable("completion_status"),
  취소상태: variable("cancellation_status"),
  댓글작성자: variable("comment_author", "staff_name"),
  댓글미리보기: variable("comment_preview", "free_text"),
  학생: variable("student_name", "student_name"),
  수업: variable("class_name", "class_name"),
  시험범위: variable("test_scope"),
  시험일: variable("test_date", "schedule"),
  기존시험일: variable("before_test_date", "schedule"),
  새시험일: variable("after_test_date", "schedule"),
  시작상태: variable("start_status"),
  점수: variable("score"),
  통과기준: variable("pass_threshold"),
  판정: variable("result"),
  현재결과: variable("current_result"),
  요청주체: variable("request_actor", "staff_name"),
  이전결과: variable("previous_result"),
  후속일정: variable("followup_schedule", "schedule"),
  최종결과: variable("final_result"),
  학년: variable("grade"),
  과목: variable("subjects"),
  문의시각: variable("inquiry_at", "schedule"),
  등록과목: variable("registered_subjects"),
  등록수업: variable("registered_classes", "class_name"),
  종료상태: variable("close_status"),
  상담종류: variable("appointment_kind"),
  일정: variable("scheduled_at", "schedule"),
  장소: variable("place", "location"),
  진행주체: variable("progress_actor", "staff_name"),
  새장소: variable("after_place", "location"),
  기존예약: variable("before_appointment", "schedule"),
  새예약: variable("after_appointment", "schedule"),
  제외과목: variable("deselected_subjects"),
  남은과목: variable("other_active_subjects"),
  유지일정: variable("retained_schedule", "schedule"),
  유지장소: variable("retained_place", "location"),
  취소일정: variable("canceled_schedule", "schedule"),
  취소장소: variable("canceled_place", "location"),
  기존반: variable("before_class", "class_name"),
  이동반: variable("after_class", "class_name"),
  적용일: variable("effective_date", "schedule"),
  신청자: variable("requester_name", "staff_name"),
  기존반종료일: variable("before_class_end_date", "schedule"),
  새반시작일: variable("after_class_start_date", "schedule"),
  제외일: variable("withdrawal_date", "schedule"),
  제외회차: variable("withdrawal_round"),
  담당선생님: variable("teacher_name", "staff_name"),
  휴강일: variable("cancellation_date", "schedule"),
  보강일정: variable("makeup_schedule", "schedule"),
  대상일정: variable("target_schedule", "schedule"),
  승인주체: variable("approval_actor", "staff_name"),
  처리시각: variable("processed_at", "schedule"),
  처리주체: variable("processing_actor", "staff_name"),
  반려주체: variable("return_actor", "staff_name"),
  문서: variable("document_title"),
  작성자: variable("author_name", "staff_name"),
  대상기간: variable("target_period", "schedule"),
  검토주체: variable("reviewer_name", "staff_name"),
  기존결재자: variable("before_approver", "staff_name"),
  새결재자: variable("after_approver", "staff_name"),
  취소주체: variable("cancel_actor", "staff_name"),
  재상신자: variable("resubmitter_name", "staff_name"),
  메모정보: variable("memo_line", "free_text"),
  진행정보: variable("progress_line"),
  사유정보: variable("reason_line", "free_text"),
  첨부정보: variable("attachment_line"),
} satisfies Record<string, Readonly<{ key: string; piiClass: string }>>)

function spec(
  requiredTokens: ReadonlyArray<string>,
  options: Partial<Omit<EventContractSpec, "requiredTokens">> = {},
): EventContractSpec {
  return Object.freeze({
    requiredTokens: Object.freeze([...requiredTokens]),
    optionalLineTokens: Object.freeze([...(options.optionalLineTokens ?? [])]),
    mustHaveFacts: Object.freeze([...(options.mustHaveFacts ?? DEFAULT_FACTS)]),
    supportedPayloadVersions: Object.freeze([...(options.supportedPayloadVersions ?? [1])]),
    freeTextVisibility: Object.freeze({ ...(options.freeTextVisibility ?? {}) }),
    freeTextPriority: Object.freeze([...(options.freeTextPriority ?? [])]),
    fieldPresenceOverrides: Object.freeze({ ...(options.fieldPresenceOverrides ?? {}) }),
  })
}

const DISPLAY_UNASSIGNED: NotificationFieldPresenceRule = Object.freeze({
  required: true,
  nullBehavior: "display",
  nullDisplay: "미배정",
  emptyArrayBehavior: "reject",
})
const DISPLAY_NO_SCHEDULE: NotificationFieldPresenceRule = Object.freeze({
  required: true,
  nullBehavior: "display",
  nullDisplay: "일정 없음",
  emptyArrayBehavior: "reject",
})
const DISPLAY_APPROVER_PENDING: NotificationFieldPresenceRule = Object.freeze({
  required: true,
  nullBehavior: "display",
  nullDisplay: "결재자 지정 대기",
  emptyArrayBehavior: "reject",
})

const EVENT_SPECS = Object.freeze({
  "task.created": spec(["업무", "현재상태", "현재담당"], {
    optionalLineTokens: ["메모정보", "진행정보"],
    mustHaveFacts: ["target", "event", "current_state"],
    fieldPresenceOverrides: { current_assignee: DISPLAY_UNASSIGNED },
  }),
  "task.assignee_changed": spec(["업무", "기존담당", "새담당"], {
    optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "before_after"],
    fieldPresenceOverrides: { before_assignee: DISPLAY_UNASSIGNED, after_assignee: DISPLAY_UNASSIGNED },
  }),
  "task.due_changed": spec(["업무", "기존일정", "새일정"], {
    optionalLineTokens: ["진행정보"],
    mustHaveFacts: ["target", "event", "before_after", "schedule"],
    fieldPresenceOverrides: { before_schedule: DISPLAY_NO_SCHEDULE, after_schedule: DISPLAY_NO_SCHEDULE },
  }),
  "task.status_changed": spec(["업무", "기존상태", "새상태"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "before_after"] }),
  "task.completed": spec(["업무", "완료상태"], { optionalLineTokens: ["메모정보"], mustHaveFacts: ["target", "event", "current_state"] }),
  "task.canceled": spec(["업무", "취소상태"], { optionalLineTokens: ["사유정보", "메모정보"], mustHaveFacts: ["target", "event", "current_state"], freeTextVisibility: { reason: "show", memo: "show" }, freeTextPriority: ["reason", "memo"] }),
  "task.reopened": spec(["업무", "기존상태", "새상태"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "before_after"] }),
  "task.comment_added": spec(["업무", "댓글작성자", "댓글미리보기"], { optionalLineTokens: ["첨부정보", "진행정보"], freeTextVisibility: { comment_preview: "show", attachment_summary: "show" }, freeTextPriority: ["comment_preview", "attachment_summary"] }),

  "word_retest.created": spec(["학생", "수업", "시험범위", "시험일"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "schedule"] }),
  "word_retest.assigned": spec(["학생", "기존담당", "새담당"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "before_after"], fieldPresenceOverrides: { before_assignee: DISPLAY_UNASSIGNED, after_assignee: DISPLAY_UNASSIGNED } }),
  "word_retest.schedule_changed": spec(["학생", "기존시험일", "새시험일"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "before_after", "schedule"], fieldPresenceOverrides: { before_test_date: DISPLAY_NO_SCHEDULE, after_test_date: DISPLAY_NO_SCHEDULE } }),
  "word_retest.started": spec(["학생", "수업", "시험범위", "시작상태"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "current_state"] }),
  "word_retest.result_reported": spec(["학생", "점수", "통과기준", "판정"], { optionalLineTokens: ["메모정보"], mustHaveFacts: ["target", "event", "result"] }),
  "word_retest.absent_reported": spec(["학생", "시험일", "판정"], { optionalLineTokens: ["사유정보", "메모정보"], mustHaveFacts: ["target", "event", "result", "schedule"], freeTextVisibility: { reason: "show", memo: "show" }, freeTextPriority: ["reason", "memo"] }),
  "word_retest.revision_requested": spec(["학생", "현재결과", "요청주체"], { optionalLineTokens: ["사유정보", "진행정보"], mustHaveFacts: ["target", "event", "result", "progress_actor"], freeTextVisibility: { reason: "show" }, freeTextPriority: ["reason"] }),
  "word_retest.retry_created": spec(["학생", "이전결과", "후속일정"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "result", "schedule"] }),
  "word_retest.completed": spec(["학생", "최종결과"], { optionalLineTokens: ["메모정보"], mustHaveFacts: ["target", "event", "result"] }),
  "word_retest.canceled": spec(["학생", "취소상태"], { optionalLineTokens: ["사유정보"], mustHaveFacts: ["target", "event", "current_state"], freeTextVisibility: { reason: "show" }, freeTextPriority: ["reason"] }),

  "registration.case_created": spec(["학생", "학년", "과목", "문의시각"], { optionalLineTokens: ["메모정보", "진행정보"], mustHaveFacts: ["target", "event", "schedule"] }),
  "registration.consultation_completed": spec(["학생", "과목", "현재상태"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "current_state"], supportedPayloadVersions: [2] }),
  "registration.waiting_transitioned": spec(["학생", "과목", "현재상태"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "current_state"], supportedPayloadVersions: [2] }),
  "registration.admission_started": spec(["학생", "과목", "현재상태"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "current_state"], supportedPayloadVersions: [2] }),
  "registration.registration_completed": spec(["학생", "등록과목", "등록수업", "완료상태"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "current_state"] }),
  "registration.case_closed": spec(["학생", "과목", "종료상태"], { optionalLineTokens: ["사유정보", "메모정보"], mustHaveFacts: ["target", "event", "current_state"], freeTextVisibility: { reason: "show", memo: "show" }, freeTextPriority: ["reason", "memo"] }),
  "registration.appointment_reminder_due": spec(["상담종류", "학생", "과목", "일정", "장소"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "schedule", "location"], supportedPayloadVersions: [2] }),
  "registration.phone_consultation_ready": spec(["학생", "과목", "진행주체"], { optionalLineTokens: ["메모정보"], mustHaveFacts: ["target", "event", "progress_actor"], supportedPayloadVersions: [2], fieldPresenceOverrides: { progress_actor: { required: true, nullBehavior: "display", nullDisplay: "담당자 지정 대기", emptyArrayBehavior: "reject" } } }),
  "registration.visit_scheduled": spec(["학생", "과목", "새일정", "새장소"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "schedule", "location"], supportedPayloadVersions: [2] }),
  "registration.visit_rescheduled": spec(["학생", "과목", "기존일정", "새일정", "새장소"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "before_after", "schedule", "location"], supportedPayloadVersions: [2] }),
  "registration.visit_replaced": spec(["학생", "과목", "기존예약", "새예약", "새장소"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "before_after", "schedule", "location"], supportedPayloadVersions: [2] }),
  "registration.visit_subject_deselected": spec(["학생", "제외과목", "남은과목", "유지일정", "유지장소"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "before_after", "schedule", "location"], supportedPayloadVersions: [2], fieldPresenceOverrides: { other_active_subjects: { required: true, nullBehavior: "reject", nullDisplay: null, emptyArrayBehavior: "allow" } } }),
  "registration.visit_canceled": spec(["학생", "과목", "취소일정", "취소장소"], { optionalLineTokens: ["사유정보", "진행정보"], mustHaveFacts: ["target", "event", "schedule", "location"], supportedPayloadVersions: [2], freeTextVisibility: { reason: "show" }, freeTextPriority: ["reason"] }),

  "transfer.submitted": spec(["학생", "기존반", "이동반", "적용일", "신청자"], { optionalLineTokens: ["사유정보", "메모정보", "진행정보"], mustHaveFacts: ["target", "event", "before_after", "schedule"], freeTextVisibility: { reason: "show", memo: "show" }, freeTextPriority: ["reason", "memo"] }),
  "transfer.completed": spec(["학생", "기존반", "이동반", "기존반종료일", "새반시작일"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "before_after", "schedule"] }),
  "withdrawal.submitted": spec(["학생", "과목", "수업", "제외일", "제외회차", "신청자"], { optionalLineTokens: ["사유정보", "메모정보", "진행정보"], mustHaveFacts: ["target", "event", "schedule"], freeTextVisibility: { reason: "show", memo: "show" }, freeTextPriority: ["reason", "memo"] }),
  "withdrawal.completed": spec(["학생", "과목", "수업", "제외일", "제외회차"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "schedule"] }),

  "makeup.submitted": spec(["수업", "과목", "담당선생님", "휴강일", "보강일정", "장소", "진행주체"], { optionalLineTokens: ["사유정보", "메모정보"], mustHaveFacts: ["target", "event", "schedule", "location", "progress_actor"], freeTextVisibility: { reason: "show", memo: "show" }, freeTextPriority: ["reason", "memo"] }),
  "makeup.refund_requested": spec(["수업", "과목", "대상일정", "현재상태"], { optionalLineTokens: ["사유정보", "진행정보"], mustHaveFacts: ["target", "event", "current_state", "schedule"], freeTextVisibility: { reason: "show" }, freeTextPriority: ["reason"] }),
  "makeup.approved": spec(["수업", "과목", "휴강일", "보강일정", "장소", "승인주체"], { optionalLineTokens: ["메모정보"], mustHaveFacts: ["target", "event", "schedule", "location", "progress_actor"], freeTextVisibility: { memo: "show" }, freeTextPriority: ["memo"] }),
  "makeup.refund_completed": spec(["수업", "과목", "현재상태", "처리시각"], { optionalLineTokens: ["메모정보"], mustHaveFacts: ["target", "event", "current_state", "schedule"] }),
  "makeup.approval_canceled": spec(["수업", "과목", "현재상태", "처리시각", "처리주체"], { optionalLineTokens: ["사유정보", "메모정보"], mustHaveFacts: ["target", "event", "current_state", "progress_actor", "schedule"], freeTextVisibility: { reason: "show", memo: "show" }, freeTextPriority: ["reason", "memo"] }),
  "makeup.revision_requested": spec(["수업", "과목", "요청주체", "현재상태"], { optionalLineTokens: ["사유정보", "진행정보"], mustHaveFacts: ["target", "event", "current_state", "progress_actor"], freeTextVisibility: { reason: "show" }, freeTextPriority: ["reason"] }),
  "makeup.rejected": spec(["수업", "과목", "반려주체", "현재상태"], { optionalLineTokens: ["사유정보", "메모정보"], mustHaveFacts: ["target", "event", "current_state", "progress_actor"], freeTextVisibility: { reason: "show", memo: "show" }, freeTextPriority: ["reason", "memo"] }),

  "approval.created": spec(["문서", "작성자", "대상기간", "현재상태"], { optionalLineTokens: ["첨부정보", "메모정보"], mustHaveFacts: ["target", "event", "current_state"] }),
  "approval.submitted": spec(["문서", "작성자", "대상기간", "진행주체"], { optionalLineTokens: ["첨부정보"], mustHaveFacts: ["target", "event", "progress_actor"], fieldPresenceOverrides: { progress_actor: DISPLAY_APPROVER_PENDING } }),
  "approval.review_started": spec(["문서", "검토주체", "현재상태"], { optionalLineTokens: ["메모정보"], mustHaveFacts: ["target", "event", "current_state", "progress_actor"] }),
  "approval.approver_changed": spec(["문서", "기존결재자", "새결재자"], { optionalLineTokens: ["진행정보"], mustHaveFacts: ["target", "event", "before_after"], fieldPresenceOverrides: { before_approver: DISPLAY_APPROVER_PENDING, after_approver: DISPLAY_APPROVER_PENDING } }),
  "approval.approved": spec(["문서", "승인주체", "현재상태", "처리시각"], { optionalLineTokens: ["메모정보"], mustHaveFacts: ["target", "event", "current_state", "progress_actor", "schedule"] }),
  "approval.returned": spec(["문서", "반려주체", "현재상태"], { optionalLineTokens: ["사유정보", "메모정보"], mustHaveFacts: ["target", "event", "current_state", "progress_actor"], freeTextVisibility: { reason: "show", memo: "show" }, freeTextPriority: ["reason", "memo"] }),
  "approval.canceled": spec(["문서", "취소주체", "현재상태"], { optionalLineTokens: ["사유정보", "메모정보"], mustHaveFacts: ["target", "event", "current_state", "progress_actor"], freeTextVisibility: { reason: "show", memo: "show" }, freeTextPriority: ["reason", "memo"] }),
  "approval.resubmitted": spec(["문서", "재상신자", "진행주체"], { optionalLineTokens: ["첨부정보"], mustHaveFacts: ["target", "event", "progress_actor"] }),
  "approval.comment_added": spec(["문서", "댓글작성자", "댓글미리보기"], { optionalLineTokens: ["첨부정보", "진행정보"], freeTextVisibility: { comment_preview: "show", attachment_summary: "show" }, freeTextPriority: ["comment_preview", "attachment_summary"] }),
} satisfies Record<string, EventContractSpec>)

function defaultFieldPresence(required: boolean): NotificationFieldPresenceRule {
  return Object.freeze({
    required,
    nullBehavior: required ? "reject" : "omit",
    nullDisplay: null,
    emptyArrayBehavior: required ? "reject" : "omit",
  })
}

function variablesFor(specification: EventContractSpec): ReadonlyArray<NotificationTemplateVariableDto> {
  const variables: NotificationTemplateVariableDto[] = []
  for (const token of [...specification.requiredTokens, ...specification.optionalLineTokens]) {
    const definition = VARIABLE_BY_TOKEN[token as keyof typeof VARIABLE_BY_TOKEN]
    if (!definition) throw new Error(`notification_content_variable_unknown:${token}`)
    variables.push(Object.freeze({ key: definition.key, token, piiClass: definition.piiClass }))
  }
  return Object.freeze(variables)
}

function allowedConnectionsFor(identity: NotificationContentContractIdentity) {
  if (identity.channelKey !== "google_chat") return [] as const
  if (identity.audienceKey === "management_team") return ["google_chat.management"] as const
  if (identity.audienceKey === "executive_team") return ["google_chat.executive"] as const
  if (identity.audienceKey === "subject_team") {
    return ["google_chat.english", "google_chat.math", "google_chat.science"] as const
  }
  throw new Error("notification_content_google_chat_audience_unsupported")
}

function buildContract(identity: NotificationContentContractIdentity): NotificationContentContract {
  const specification = EVENT_SPECS[identity.eventKey as keyof typeof EVENT_SPECS]
  if (!specification) throw new Error(`notification_content_event_contract_missing:${identity.eventKey}`)
  const variables = variablesFor(specification)
  const required = new Set(specification.requiredTokens)
  const fieldPresence = Object.fromEntries(variables.map((definition) => [
    definition.key,
    specification.fieldPresenceOverrides[definition.key]
      ?? defaultFieldPresence(required.has(definition.token)),
  ]))

  return freezeNotificationContentContract({
    contractVersion: CONTRACT_VERSION,
    availableVariables: variables,
    requiredTokens: specification.requiredTokens,
    optionalLineTokens: specification.optionalLineTokens,
    mustHaveFacts: specification.mustHaveFacts,
    supportedPayloadVersions: specification.supportedPayloadVersions,
    destinationPolicy: {
      allowedConnectionKeys: allowedConnectionsFor(identity),
      subjectScoped: identity.audienceKey === "subject_team",
    },
    freeTextVisibility: specification.freeTextVisibility,
    freeTextPriority: specification.freeTextPriority,
    fieldPresence,
  })
}

function assertRegistryEntries(entries: ReadonlyArray<NotificationContentContractEntry>) {
  const identityKeys = new Set<string>()
  const connectionKeys = new Set<string>(NOTIFICATION_CONNECTION_KEYS)

  for (const entry of entries) {
    const identity = notificationContentIdentityKey(entry)
    if (identityKeys.has(identity)) throw new Error("notification_content_duplicate_identity")
    identityKeys.add(identity)

    if (!entry.contract.contractVersion.trim()) {
      throw new Error("notification_content_contract_version_empty")
    }
    const variableKeys = new Set<string>()
    const variableTokens = new Set<string>()
    const variableByToken = new Map<string, NotificationTemplateVariableDto>()
    for (const definition of entry.contract.availableVariables) {
      if (variableKeys.has(definition.key)) throw new Error("notification_content_duplicate_variable_key")
      if (variableTokens.has(definition.token)) throw new Error("notification_content_duplicate_variable_token")
      variableKeys.add(definition.key)
      variableTokens.add(definition.token)
      variableByToken.set(definition.token, definition)
    }
    for (const token of entry.contract.requiredTokens) {
      if (!token.trim()) throw new Error("notification_content_required_token_empty")
      if (!variableByToken.has(token)) throw new Error("notification_content_required_token_unavailable")
    }
    const requiredTokens = new Set(entry.contract.requiredTokens)
    for (const token of entry.contract.optionalLineTokens) {
      const definition = variableByToken.get(token)
      if (!definition) throw new Error("notification_content_optional_token_unavailable")
      if (requiredTokens.has(token) || !definition.key.endsWith("_line")) {
        throw new Error("notification_content_optional_token_not_line_slot")
      }
    }
    for (const version of entry.contract.supportedPayloadVersions) {
      if (!Number.isInteger(version) || version <= 0) {
        throw new Error("notification_content_payload_version_invalid")
      }
    }
    for (const connectionKey of entry.contract.destinationPolicy.allowedConnectionKeys) {
      if (!connectionKeys.has(connectionKey)) throw new Error("notification_content_connection_unknown")
    }
    if (entry.contract.freeTextPriority.length > 2) {
      throw new Error("notification_content_free_text_priority_too_long")
    }
  }
}

export function createNotificationContentContractRegistry(
  sourceEntries: ReadonlyArray<NotificationContentContractEntry>,
) {
  assertRegistryEntries(sourceEntries)
  const entries = Object.freeze(sourceEntries.map((entry) => Object.freeze({
    workflowKey: entry.workflowKey,
    eventKey: entry.eventKey,
    audienceKey: entry.audienceKey,
    channelKey: entry.channelKey,
    ruleVariantKey: entry.ruleVariantKey,
    contract: freezeNotificationContentContract(entry.contract),
  })))
  const byIdentity = new Map(entries.map((entry) => [notificationContentIdentityKey(entry), entry.contract]))
  return Object.freeze({
    get(identity: NotificationContentContractIdentity) {
      return byIdentity.get(notificationContentIdentityKey(identity)) ?? null
    },
    list() {
      return entries
    },
  })
}

const DEFAULT_REGISTRY = createNotificationContentContractRegistry(
  listNotificationContentRuleIdentities().map((identity) => ({
    ...identity,
    contract: buildContract(identity),
  })),
)

const configuredEvents = new Set(DEFAULT_REGISTRY.list().map(({ eventKey }) => eventKey))
const specifiedEvents = new Set(Object.keys(EVENT_SPECS))
if (
  configuredEvents.size !== specifiedEvents.size
  || [...configuredEvents].some((eventKey) => !specifiedEvents.has(eventKey))
) {
  throw new Error("notification_content_event_contract_coverage_mismatch")
}

export function getNotificationContentContract(
  input: NotificationContentContractIdentity,
): NotificationContentContract | null {
  return DEFAULT_REGISTRY.get(input)
}

export function listNotificationContentContracts(): ReadonlyArray<NotificationContentContractEntry> {
  return DEFAULT_REGISTRY.list()
}

export { listNotificationContentCoverage }

export type { NotificationConnectionKey }
