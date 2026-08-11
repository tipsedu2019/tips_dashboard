import {
  NOTIFICATION_CONNECTION_KEYS,
  type NotificationConnectionKey,
} from "./notification-google-chat-catalog.ts"

export type DbBigInt = string

export const NOTIFICATION_WORKFLOW_OPTIONS = [
  { key: "tasks", label: "할 일" },
  { key: "word_retests", label: "영어 단어 재시험" },
  { key: "registration", label: "등록" },
  { key: "transfer", label: "전반" },
  { key: "withdrawal", label: "퇴원" },
  { key: "makeup_requests", label: "휴보강" },
  { key: "approvals", label: "전자결재" },
] as const

export type NotificationWorkflowKey = (typeof NOTIFICATION_WORKFLOW_OPTIONS)[number]["key"]

export const NOTIFICATION_EVENT_KEYS_BY_WORKFLOW = {
  tasks: [
    "task.created",
    "task.assignee_changed",
    "task.due_changed",
    "task.status_changed",
    "task.completed",
    "task.canceled",
    "task.reopened",
    "task.comment_added",
  ],
  word_retests: [
    "word_retest.created",
    "word_retest.assigned",
    "word_retest.schedule_changed",
    "word_retest.started",
    "word_retest.result_reported",
    "word_retest.absent_reported",
    "word_retest.revision_requested",
    "word_retest.retry_created",
    "word_retest.completed",
    "word_retest.canceled",
  ],
  registration: [
    "registration.case_created",
    "registration.inquiry_routed",
    "registration.director_assigned",
    "registration.phone_consultation_ready",
    "registration.level_test_scheduled",
    "registration.level_test_rescheduled",
    "registration.level_test_started",
    "registration.level_test_completed",
    "registration.level_test_absent",
    "registration.level_test_canceled",
    "registration.visit_scheduled",
    "registration.visit_rescheduled",
    "registration.visit_replaced",
    "registration.visit_subject_deselected",
    "registration.visit_canceled",
    "registration.consultation_completed",
    "registration.waiting_transitioned",
    "registration.enrollment_decided",
    "registration.admission_started",
    "registration.admission_advanced",
    "registration.admission_canceled",
    "registration.registration_completed",
    "registration.case_closed",
    "registration.track_reopened",
    "registration.admission_message_requested",
    "registration.admission_message_accepted",
    "registration.admission_message_failed",
    "registration.admission_message_unknown",
    "registration.admission_message_reconciled",
    "registration.admission_message_retry_released",
    "registration.appointment_reminder_due",
    "registration.observation_scheduled",
    "registration.observation_rescheduled",
    "registration.observation_canceled",
    "registration.observation_reminder_due",
    "registration.observation_feedback_due",
    "registration.observation_feedback_submitted",
    "registration.observation_director_reassigned",
  ],
  transfer: [
    "transfer.submitted",
    "transfer.processing_started",
    "transfer.details_changed",
    "transfer.completed",
    "transfer.canceled",
    "transfer.reopened",
  ],
  withdrawal: [
    "withdrawal.submitted",
    "withdrawal.processing_started",
    "withdrawal.details_changed",
    "withdrawal.completed",
    "withdrawal.canceled",
    "withdrawal.reopened",
  ],
  makeup_requests: [
    "makeup.submitted",
    "makeup.approved",
    "makeup.revision_requested",
    "makeup.rejected",
    "makeup.refund_requested",
    "makeup.refund_completed",
    "makeup.approval_canceled",
    "makeup.deleted",
  ],
  approvals: [
    "approval.created",
    "approval.submitted",
    "approval.review_started",
    "approval.approver_changed",
    "approval.approved",
    "approval.returned",
    "approval.canceled",
    "approval.resubmitted",
    "approval.comment_added",
    "approval.deleted",
  ],
} as const satisfies Record<NotificationWorkflowKey, readonly string[]>

export type NotificationEventKey =
  (typeof NOTIFICATION_EVENT_KEYS_BY_WORKFLOW)[NotificationWorkflowKey][number]

export const NOTIFICATION_AUDIENCE_KEYS = [
  "requester_profile",
  "primary_assignee",
  "secondary_assignee",
  "management_team",
  "requesting_teacher",
  "assigned_assistant",
  "registration_requester",
  "track_director",
  "subject_team",
  "applicant_guardian",
  "approver_profile",
  "executive_team",
] as const

export type NotificationAudienceKey = (typeof NOTIFICATION_AUDIENCE_KEYS)[number]

export const NOTIFICATION_CHANNEL_KEYS = [
  "in_app",
  "web_push",
  "google_chat",
  "customer_message",
] as const

export type NotificationChannelKey = (typeof NOTIFICATION_CHANNEL_KEYS)[number]

export const NOTIFICATION_EDITABLE_CHANNEL_KEYS = [
  "in_app",
  "google_chat",
  "customer_message",
] as const

export type NotificationEditableChannelKey =
  (typeof NOTIFICATION_EDITABLE_CHANNEL_KEYS)[number]

export { NOTIFICATION_CONNECTION_KEYS }
export type { NotificationConnectionKey }

export const NOTIFICATION_CONNECTION_STATES = [
  "legacy_active",
  "encrypted_active",
  "disconnected",
] as const

export type NotificationConnectionState = (typeof NOTIFICATION_CONNECTION_STATES)[number]

export const NOTIFICATION_CONNECTION_RESULT_CODE_PATTERN =
  /^(?:accepted|configuration_error|provider_rejected|transport_error|http_[1-5]\d{2})$/

export const NOTIFICATION_SCHEDULE_KEYS = [
  "previous_day_at",
  "same_day_at",
  "offset_before",
] as const

export type NotificationScheduleKey = (typeof NOTIFICATION_SCHEDULE_KEYS)[number]
export type NotificationDeliveryMode = "immediate" | "scheduled"

export type NotificationWallClockScheduleConfig = Readonly<{
  anchorKey: string
  localTime: string
  timezone: "Asia/Seoul"
}>

export type NotificationOffsetScheduleConfig = Readonly<{
  anchorKey: string
  leadMinutes: number
  timezone: "Asia/Seoul"
}>

export type NotificationScheduleConfig =
  | NotificationWallClockScheduleConfig
  | NotificationOffsetScheduleConfig
  | null

export type NotificationTemplateVariableDto = Readonly<{
  key: string
  token: string
  piiClass: string
}>

export type NotificationScopeState =
  | "in_scope"
  | "excluded_channel"
  | "no_rule_event"

export type NotificationConfigurationKind =
  | "editable_rule"
  | "fixed_policy_editable_template"
  | "not_applicable"

export type NotificationEnabledState =
  | "enabled"
  | "disabled"
  | "not_applicable"

export type NotificationDispatchOwner =
  | "canonical"
  | "legacy"
  | "none"

export type NotificationTemplateCompliance =
  | "conformant"
  | "legacy_custom_nonconformant"

export type NotificationDestinationTeam =
  | "management"
  | "executive"
  | "english"
  | "math"
  | "science"

export type NotificationFieldPresenceRule = Readonly<{
  required: boolean
  nullBehavior: "reject" | "omit" | "display"
  nullDisplay: string | null
  emptyArrayBehavior: "reject" | "allow" | "omit"
}>

export type NotificationMustHaveFact =
  | "target"
  | "event"
  | "current_state"
  | "before_after"
  | "result"
  | "progress_actor"
  | "schedule"
  | "location"

export type NotificationContentContract = Readonly<{
  contractVersion: string
  availableVariables: ReadonlyArray<NotificationTemplateVariableDto>
  requiredTokens: ReadonlyArray<string>
  optionalLineTokens: ReadonlyArray<string>
  mustHaveFacts: ReadonlyArray<NotificationMustHaveFact>
  supportedPayloadVersions: ReadonlyArray<number>
  destinationPolicy: Readonly<{
    allowedConnectionKeys: ReadonlyArray<NotificationConnectionKey>
    subjectScoped: boolean
  }>
  freeTextVisibility: Readonly<Record<string, "show" | "omit">>
  freeTextPriority: ReadonlyArray<string>
  fieldPresence: Readonly<Record<string, NotificationFieldPresenceRule>>
}>

export type NotificationContentContractIdentity = Readonly<{
  workflowKey: NotificationWorkflowKey
  eventKey: NotificationEventKey
  audienceKey: NotificationAudienceKey
  channelKey: NotificationEditableChannelKey
  ruleVariantKey: string
}>

export type NotificationContentContractEntry = NotificationContentContractIdentity & Readonly<{
  contract: NotificationContentContract
}>

export type NotificationContentCoverageEntry = Readonly<{
  workflowKey: NotificationWorkflowKey
  eventKey: NotificationEventKey
  audienceKey: NotificationAudienceKey | null
  channelKey: NotificationEditableChannelKey | null
  ruleVariantKey: string | null
  scopeState: NotificationScopeState
  configurationKind: NotificationConfigurationKind
  enabledState: NotificationEnabledState
  dispatchOwner: NotificationDispatchOwner
}>

export type NotificationTemplateDto = Readonly<{
  id: string
  ruleId: string
  version: DbBigInt
  titleTemplate: string
  bodyTemplate: string
  allowedVariables: ReadonlyArray<NotificationTemplateVariableDto>
  payloadSchemaVersion: number
  contentContractVersion: string | null
  checksum: string | null
}>

export type NotificationRuleDto = Readonly<{
  id: string
  workflowKey: NotificationWorkflowKey
  eventKey: NotificationEventKey
  eventLabel: string | null
  groupLabel: string | null
  triggerDescription: string | null
  sortOrder: number | null
  audienceKey: NotificationAudienceKey
  audienceLabel: string | null
  channelKey: NotificationEditableChannelKey
  channelLabel: string | null
  connectionKey: NotificationConnectionKey | null
  ruleVariantKey: "immediate" | NotificationScheduleKey
  deliveryMode: NotificationDeliveryMode
  scheduleKey: NotificationScheduleKey | null
  scheduleConfig: NotificationScheduleConfig
  enabled: boolean
  configurationKind: Exclude<NotificationConfigurationKind, "not_applicable">
  activationLocked: boolean
  contentContract: NotificationContentContract
  templateCompliance: NotificationTemplateCompliance
  activeTemplateId: string
  revision: DbBigInt
  updatedAt: string | null
  template: NotificationTemplateDto
}>

export type NotificationConnectionDto = Readonly<{
  connectionKey: NotificationConnectionKey
  connectionState: NotificationConnectionState
  revision: DbBigInt
  configured: boolean
  webhookUrlMask: string | null
  lastVerifiedAt: string | null
  lastErrorCode: string | null
  editable: boolean
}>

export type NotificationDeliverySummaryDto = Readonly<{
  pendingCount: number
  sentCount: number
  failedCount: number
  unknownCount: number
  latestDeliveryAt: string | null
}>

export type NotificationControlPlaneSnapshot = Readonly<{
  scopeKey: "global"
  workflowKey: NotificationWorkflowKey
  rules: ReadonlyArray<NotificationRuleDto>
  connections: ReadonlyArray<NotificationConnectionDto>
  deliverySummary: NotificationDeliverySummaryDto
  loadedAt: string | null
}>

export type NotificationRevisionMap = Readonly<Record<string, DbBigInt>>

export type NotificationIssueCode =
  | "invalid_snapshot"
  | "invalid_field"
  | "invalid_revision"
  | "duplicate_identity"
  | "unknown_workflow"
  | "unknown_event"
  | "event_workflow_mismatch"
  | "unknown_audience"
  | "unknown_channel"
  | "unknown_connection"
  | "unknown_connection_state"
  | "independent_web_push_rule"
  | "impossible_rule_cell"
  | "invalid_schedule"
  | "invalid_template_relation"
  | "unsafe_connection_payload"
  | "draft_workflow_mismatch"
  | "draft_rule_missing"
  | "draft_rule_unknown"
  | "template_token_not_allowed"
  | "template_required_token_missing"
  | "template_optional_line_invalid"
  | "template_content_not_allowed"
  | "google_chat_connection_required"

export type NotificationIssue = Readonly<{
  code: NotificationIssueCode
  path: string
  message: string
}>

export type NotificationTemplateWarningCode =
  | "template_title_over_60_graphemes"
  | "template_direct_imperative"

export type NotificationTemplateWarning = Readonly<{
  code: NotificationTemplateWarningCode
  path: string
  message: string
}>

export type NotificationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ReadonlyArray<NotificationIssue> }

const WORKFLOW_KEY_SET = new Set<string>(NOTIFICATION_WORKFLOW_OPTIONS.map(({ key }) => key))
const AUDIENCE_KEY_SET = new Set<string>(NOTIFICATION_AUDIENCE_KEYS)
const CHANNEL_KEY_SET = new Set<string>(NOTIFICATION_CHANNEL_KEYS)
const EDITABLE_CHANNEL_KEY_SET = new Set<string>(NOTIFICATION_EDITABLE_CHANNEL_KEYS)
const CONNECTION_KEY_SET = new Set<string>(NOTIFICATION_CONNECTION_KEYS)
const CONNECTION_STATE_SET = new Set<string>(NOTIFICATION_CONNECTION_STATES)
const SCHEDULE_KEY_SET = new Set<string>(NOTIFICATION_SCHEDULE_KEYS)
const RULE_CONFIGURATION_KIND_SET = new Set<string>([
  "editable_rule",
  "fixed_policy_editable_template",
])
const TEMPLATE_COMPLIANCE_SET = new Set<string>([
  "conformant",
  "legacy_custom_nonconformant",
])
const MUST_HAVE_FACT_SET = new Set<string>([
  "target",
  "event",
  "current_state",
  "before_after",
  "result",
  "progress_actor",
  "schedule",
  "location",
])
const NULL_BEHAVIOR_SET = new Set<string>(["reject", "omit", "display"])
const EMPTY_ARRAY_BEHAVIOR_SET = new Set<string>(["reject", "allow", "omit"])
const DECIMAL_BIGINT_PATTERN = /^(0|[1-9]\d*)$/
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export const NOTIFICATION_AUDIENCES_BY_WORKFLOW = {
  tasks: ["requester_profile", "primary_assignee", "secondary_assignee", "management_team"],
  word_retests: [
    "requesting_teacher",
    "assigned_assistant",
    "secondary_assignee",
    "management_team",
  ],
  registration: [
    "registration_requester",
    "track_director",
    "management_team",
    "subject_team",
    "applicant_guardian",
  ],
  transfer: ["requester_profile", "management_team"],
  withdrawal: ["requester_profile", "management_team"],
  makeup_requests: [
    "requester_profile",
    "approver_profile",
    "management_team",
    "executive_team",
    "subject_team",
  ],
  approvals: ["requester_profile", "approver_profile", "management_team"],
} as const satisfies Record<NotificationWorkflowKey, readonly NotificationAudienceKey[]>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function addIssue(
  issues: NotificationIssue[],
  code: NotificationIssueCode,
  path: string,
  message: string,
) {
  issues.push({ code, path, message })
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: NotificationIssue[],
): string | null {
  const value = record[key]
  if (typeof value !== "string" || value.length === 0) {
    addIssue(issues, "invalid_field", `${path}.${key}`, "A non-empty string is required.")
    return null
  }
  return value
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: NotificationIssue[],
): string | null {
  const value = record[key]
  if (value === undefined || value === null) return null
  if (typeof value !== "string") {
    addIssue(issues, "invalid_field", `${path}.${key}`, "A string or null is required.")
    return null
  }
  return value
}

function requiredBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: NotificationIssue[],
): boolean | null {
  const value = record[key]
  if (typeof value !== "boolean") {
    addIssue(issues, "invalid_field", `${path}.${key}`, "A boolean is required.")
    return null
  }
  return value
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  fallback: boolean,
  path: string,
  issues: NotificationIssue[],
): boolean {
  const value = record[key]
  if (value === undefined) return fallback
  if (typeof value !== "boolean") {
    addIssue(issues, "invalid_field", `${path}.${key}`, "A boolean is required.")
    return fallback
  }
  return value
}

function requiredNonNegativeInteger(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: NotificationIssue[],
): number | null {
  const value = record[key]
  if (!Number.isInteger(value) || (value as number) < 0) {
    addIssue(issues, "invalid_field", `${path}.${key}`, "A non-negative integer is required.")
    return null
  }
  return value as number
}

function optionalInteger(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: NotificationIssue[],
): number | null {
  const value = record[key]
  if (value === undefined || value === null) return null
  if (!Number.isInteger(value)) {
    addIssue(issues, "invalid_field", `${path}.${key}`, "An integer or null is required.")
    return null
  }
  return value as number
}

function requiredDecimalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: NotificationIssue[],
): DbBigInt | null {
  const value = record[key]
  if (typeof value !== "string" || !DECIMAL_BIGINT_PATTERN.test(value)) {
    addIssue(
      issues,
      "invalid_revision",
      `${path}.${key}`,
      "Database bigint values must be non-negative decimal strings.",
    )
    return null
  }
  return value
}

function requiredContractVersion(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: NotificationIssue[],
): string | null {
  const value = requiredString(record, key, path, issues)
  if (value !== null && !/^[1-9]\d*$/.test(value)) {
    addIssue(issues, "invalid_field", `${path}.${key}`, "Contract versions must be positive decimal strings.")
    return null
  }
  return value
}

function stringArray(
  value: unknown,
  path: string,
  issues: NotificationIssue[],
): string[] | null {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0) ||
    new Set(value).size !== value.length
  ) {
    addIssue(issues, "invalid_field", path, "A unique array of non-empty strings is required.")
    return null
  }
  return [...value] as string[]
}

function parseContentContract(
  input: unknown,
  path: string,
  issues: NotificationIssue[],
): NotificationContentContract | null {
  if (!isRecord(input)) {
    addIssue(issues, "invalid_field", path, "Content contract must be an object.")
    return null
  }

  const startIssueCount = issues.length
  const contractVersion = requiredContractVersion(input, "contractVersion", path, issues)
  const requiredTokens = stringArray(input.requiredTokens, `${path}.requiredTokens`, issues)
  const optionalLineTokens = stringArray(
    input.optionalLineTokens,
    `${path}.optionalLineTokens`,
    issues,
  )
  const mustHaveFactValues = stringArray(input.mustHaveFacts, `${path}.mustHaveFacts`, issues)
  const freeTextPriority = stringArray(
    input.freeTextPriority,
    `${path}.freeTextPriority`,
    issues,
  )

  const availableVariables: NotificationTemplateVariableDto[] = []
  if (!Array.isArray(input.availableVariables)) {
    addIssue(
      issues,
      "invalid_field",
      `${path}.availableVariables`,
      "Available variables must be an array.",
    )
  } else {
    input.availableVariables.forEach((variable, index) => {
      const variablePath = `${path}.availableVariables[${index}]`
      if (!isRecord(variable)) {
        addIssue(issues, "invalid_field", variablePath, "Variable must be an object.")
        return
      }
      const key = requiredString(variable, "key", variablePath, issues)
      const token = requiredString(variable, "token", variablePath, issues)
      const piiClass = requiredString(variable, "piiClass", variablePath, issues)
      if (key !== null && token !== null && piiClass !== null) {
        availableVariables.push({ key, token, piiClass })
      }
    })
  }
  if (
    new Set(availableVariables.map(({ key }) => key)).size !== availableVariables.length ||
    new Set(availableVariables.map(({ token }) => token)).size !== availableVariables.length
  ) {
    addIssue(
      issues,
      "duplicate_identity",
      `${path}.availableVariables`,
      "Variable keys and labels must be unique.",
    )
  }

  const supportedPayloadVersions: number[] = []
  if (
    !Array.isArray(input.supportedPayloadVersions) ||
    input.supportedPayloadVersions.some((version) => !Number.isInteger(version) || version < 1)
  ) {
    addIssue(
      issues,
      "invalid_field",
      `${path}.supportedPayloadVersions`,
      "Supported payload versions must be positive integers.",
    )
  } else {
    supportedPayloadVersions.push(...input.supportedPayloadVersions as number[])
  }

  let destinationPolicy: NotificationContentContract["destinationPolicy"] | null = null
  if (!isRecord(input.destinationPolicy)) {
    addIssue(issues, "invalid_field", `${path}.destinationPolicy`, "Destination policy is required.")
  } else {
    const allowedConnectionKeysValue = stringArray(
      input.destinationPolicy.allowedConnectionKeys,
      `${path}.destinationPolicy.allowedConnectionKeys`,
      issues,
    )
    const subjectScoped = input.destinationPolicy.subjectScoped
    if (typeof subjectScoped !== "boolean") {
      addIssue(
        issues,
        "invalid_field",
        `${path}.destinationPolicy.subjectScoped`,
        "Subject scope must be boolean.",
      )
    }
    if (
      allowedConnectionKeysValue !== null &&
      allowedConnectionKeysValue.some((key) => !CONNECTION_KEY_SET.has(key))
    ) {
      addIssue(
        issues,
        "unknown_connection",
        `${path}.destinationPolicy.allowedConnectionKeys`,
        "Destination policy contains an unknown connection.",
      )
    } else if (allowedConnectionKeysValue !== null && typeof subjectScoped === "boolean") {
      destinationPolicy = {
        allowedConnectionKeys: allowedConnectionKeysValue as NotificationConnectionKey[],
        subjectScoped,
      }
    }
  }

  const freeTextVisibility: Record<string, "show" | "omit"> = {}
  if (!isRecord(input.freeTextVisibility)) {
    addIssue(
      issues,
      "invalid_field",
      `${path}.freeTextVisibility`,
      "Free-text visibility must be an object.",
    )
  } else {
    for (const [key, value] of Object.entries(input.freeTextVisibility)) {
      if (value !== "show" && value !== "omit") {
        addIssue(
          issues,
          "invalid_field",
          `${path}.freeTextVisibility.${key}`,
          "Free-text visibility must be show or omit.",
        )
      } else {
        freeTextVisibility[key] = value
      }
    }
  }

  const fieldPresence: Record<string, NotificationFieldPresenceRule> = {}
  if (!isRecord(input.fieldPresence)) {
    addIssue(issues, "invalid_field", `${path}.fieldPresence`, "Field presence must be an object.")
  } else {
    for (const [key, value] of Object.entries(input.fieldPresence)) {
      const fieldPath = `${path}.fieldPresence.${key}`
      if (
        !isRecord(value) ||
        typeof value.required !== "boolean" ||
        typeof value.nullBehavior !== "string" ||
        !NULL_BEHAVIOR_SET.has(value.nullBehavior) ||
        (value.nullDisplay !== null && typeof value.nullDisplay !== "string") ||
        typeof value.emptyArrayBehavior !== "string" ||
        !EMPTY_ARRAY_BEHAVIOR_SET.has(value.emptyArrayBehavior)
      ) {
        addIssue(issues, "invalid_field", fieldPath, "Field presence rule is invalid.")
        continue
      }
      fieldPresence[key] = {
        required: value.required,
        nullBehavior: value.nullBehavior as NotificationFieldPresenceRule["nullBehavior"],
        nullDisplay: value.nullDisplay,
        emptyArrayBehavior: value.emptyArrayBehavior as NotificationFieldPresenceRule["emptyArrayBehavior"],
      }
    }
  }

  if (mustHaveFactValues?.some((fact) => !MUST_HAVE_FACT_SET.has(fact))) {
    addIssue(issues, "invalid_field", `${path}.mustHaveFacts`, "Content contract contains an unknown fact.")
  }
  const availableTokens = new Set(availableVariables.map(({ token }) => token))
  if (requiredTokens?.some((token) => !availableTokens.has(token))) {
    addIssue(issues, "invalid_field", `${path}.requiredTokens`, "A required variable is unavailable.")
  }
  if (optionalLineTokens?.some((token) => !availableTokens.has(token))) {
    addIssue(issues, "invalid_field", `${path}.optionalLineTokens`, "An optional-line variable is unavailable.")
  }

  if (
    issues.length !== startIssueCount ||
    contractVersion === null ||
    requiredTokens === null ||
    optionalLineTokens === null ||
    mustHaveFactValues === null ||
    destinationPolicy === null ||
    freeTextPriority === null
  ) {
    return null
  }

  return {
    contractVersion,
    availableVariables,
    requiredTokens,
    optionalLineTokens,
    mustHaveFacts: mustHaveFactValues as NotificationMustHaveFact[],
    supportedPayloadVersions,
    destinationPolicy,
    freeTextVisibility,
    freeTextPriority,
    fieldPresence,
  }
}

function parseTemplateCompliance(
  input: unknown,
  contractVersion: string | null,
  path: string,
  issues: NotificationIssue[],
): NotificationTemplateCompliance | null {
  if (!isRecord(input)) {
    addIssue(issues, "invalid_field", path, "Template compliance must be an object.")
    return null
  }
  const parsedContractVersion = requiredContractVersion(input, "contract_version", path, issues)
  const compliance = requiredString(input, "compliance", path, issues)
  if (!Array.isArray(input.violations)) {
    addIssue(issues, "invalid_field", `${path}.violations`, "Compliance violations must be an array.")
  }
  if (parsedContractVersion !== null && contractVersion !== null && parsedContractVersion !== contractVersion) {
    addIssue(issues, "invalid_field", `${path}.contract_version`, "Compliance contract version is stale.")
  }
  if (compliance === null || !TEMPLATE_COMPLIANCE_SET.has(compliance)) {
    addIssue(issues, "invalid_field", `${path}.compliance`, "Unknown template compliance state.")
    return null
  }
  return compliance as NotificationTemplateCompliance
}

function isWorkflowKey(value: string | null): value is NotificationWorkflowKey {
  return value !== null && WORKFLOW_KEY_SET.has(value)
}

function isAudienceKey(value: string | null): value is NotificationAudienceKey {
  return value !== null && AUDIENCE_KEY_SET.has(value)
}

function isConnectionKey(value: string | null): value is NotificationConnectionKey {
  return value !== null && CONNECTION_KEY_SET.has(value)
}

function deriveConnectionKey(
  audienceKey: NotificationAudienceKey,
): NotificationConnectionKey | null {
  if (audienceKey === "management_team") return "google_chat.management"
  if (audienceKey === "executive_team") return "google_chat.executive"
  return null
}

export function isNotificationRuleCellAllowed(input: {
  workflowKey: NotificationWorkflowKey
  audienceKey: NotificationAudienceKey
  channelKey: NotificationEditableChannelKey
}): boolean {
  const workflowAudiences = NOTIFICATION_AUDIENCES_BY_WORKFLOW[input.workflowKey]
  if (!(workflowAudiences as readonly string[]).includes(input.audienceKey)) return false

  if (input.channelKey === "customer_message") {
    return input.workflowKey === "registration" && input.audienceKey === "applicant_guardian"
  }

  if (input.channelKey === "google_chat") {
    return ["management_team", "executive_team", "subject_team"].includes(input.audienceKey)
  }

  return input.audienceKey !== "applicant_guardian"
}

function parseScheduleConfig(
  deliveryMode: string | null,
  scheduleKeyValue: unknown,
  scheduleConfigValue: unknown,
  path: string,
  issues: NotificationIssue[],
): {
  scheduleKey: NotificationScheduleKey | null
  scheduleConfig: NotificationScheduleConfig
  ruleVariantKey: "immediate" | NotificationScheduleKey
} | null {
  if (deliveryMode === "immediate") {
    if (scheduleKeyValue !== null || scheduleConfigValue !== null) {
      addIssue(issues, "invalid_schedule", path, "Immediate rules cannot carry schedule data.")
      return null
    }
    return { scheduleKey: null, scheduleConfig: null, ruleVariantKey: "immediate" }
  }

  if (deliveryMode !== "scheduled") {
    addIssue(issues, "invalid_schedule", `${path}.delivery_mode`, "Unknown delivery mode.")
    return null
  }

  if (typeof scheduleKeyValue !== "string" || !SCHEDULE_KEY_SET.has(scheduleKeyValue)) {
    addIssue(issues, "invalid_schedule", `${path}.schedule_key`, "Unknown schedule key.")
    return null
  }
  const scheduleKey = scheduleKeyValue as NotificationScheduleKey

  if (!isRecord(scheduleConfigValue)) {
    addIssue(issues, "invalid_schedule", `${path}.schedule_config`, "Schedule config is required.")
    return null
  }

  const anchorKey = scheduleConfigValue.anchor_key
  const timezone = scheduleConfigValue.timezone
  if (typeof anchorKey !== "string" || anchorKey.length === 0 || timezone !== "Asia/Seoul") {
    addIssue(
      issues,
      "invalid_schedule",
      `${path}.schedule_config`,
      "Schedule config requires an anchor and Asia/Seoul timezone.",
    )
    return null
  }

  if (scheduleKey === "offset_before") {
    const leadMinutes = scheduleConfigValue.lead_minutes
    if (!Number.isInteger(leadMinutes) || (leadMinutes as number) < 0) {
      addIssue(
        issues,
        "invalid_schedule",
        `${path}.schedule_config.lead_minutes`,
        "Lead minutes must be a non-negative integer.",
      )
      return null
    }
    return {
      scheduleKey,
      scheduleConfig: { anchorKey, leadMinutes: leadMinutes as number, timezone },
      ruleVariantKey: scheduleKey,
    }
  }

  const localTime = scheduleConfigValue.local_time
  if (typeof localTime !== "string" || !LOCAL_TIME_PATTERN.test(localTime)) {
    addIssue(
      issues,
      "invalid_schedule",
      `${path}.schedule_config.local_time`,
      "Local time must use HH:mm.",
    )
    return null
  }
  return {
    scheduleKey,
    scheduleConfig: { anchorKey, localTime, timezone },
    ruleVariantKey: scheduleKey,
  }
}

function parseTemplate(
  input: unknown,
  ruleId: string | null,
  activeTemplateId: string | null,
  path: string,
  issues: NotificationIssue[],
): NotificationTemplateDto | null {
  if (!isRecord(input)) {
    addIssue(issues, "invalid_field", path, "Template must be an object.")
    return null
  }

  const startIssueCount = issues.length
  const id = requiredString(input, "id", path, issues)
  const templateRuleId = requiredString(input, "rule_id", path, issues)
  const version = requiredDecimalString(input, "version", path, issues)
  const titleTemplate = requiredString(input, "title_template", path, issues)
  const bodyTemplate = requiredString(input, "body_template", path, issues)
  const payloadSchemaVersion = requiredNonNegativeInteger(
    input,
    "payload_schema_version",
    path,
    issues,
  )
  const contentContractVersion = optionalString(
    input,
    "content_contract_version",
    path,
    issues,
  )
  const checksum = optionalString(input, "checksum", path, issues)

  if (
    contentContractVersion !== null &&
    !/^[1-9]\d*$/.test(contentContractVersion)
  ) {
    addIssue(
      issues,
      "invalid_field",
      `${path}.content_contract_version`,
      "Content contract version must be a positive decimal string or null.",
    )
  }

  const variablesValue = input.allowed_variables
  const allowedVariables: NotificationTemplateVariableDto[] = []
  if (!Array.isArray(variablesValue)) {
    addIssue(
      issues,
      "invalid_field",
      `${path}.allowed_variables`,
      "Allowed variables must be an array.",
    )
  } else {
    variablesValue.forEach((variable, index) => {
      const variablePath = `${path}.allowed_variables[${index}]`
      if (!isRecord(variable)) {
        addIssue(issues, "invalid_field", variablePath, "Variable must be an object.")
        return
      }
      const key = requiredString(variable, "key", variablePath, issues)
      const token = requiredString(variable, "token", variablePath, issues)
      const piiClass = requiredString(variable, "pii_class", variablePath, issues)
      if (key !== null && token !== null && piiClass !== null) {
        allowedVariables.push({ key, token, piiClass })
      }
    })
  }

  if (
    (ruleId !== null && templateRuleId !== null && templateRuleId !== ruleId) ||
    (activeTemplateId !== null && id !== null && id !== activeTemplateId)
  ) {
    addIssue(
      issues,
      "invalid_template_relation",
      path,
      "The active template must belong to the current rule.",
    )
  }

  if (
    issues.length !== startIssueCount ||
    id === null ||
    templateRuleId === null ||
    version === null ||
    titleTemplate === null ||
    bodyTemplate === null ||
    payloadSchemaVersion === null
  ) {
    return null
  }

  return {
    id,
    ruleId: templateRuleId,
    version,
    titleTemplate,
    bodyTemplate,
    allowedVariables,
    payloadSchemaVersion,
    contentContractVersion,
    checksum,
  }
}

function parseRule(
  input: unknown,
  snapshotWorkflowKey: NotificationWorkflowKey | null,
  index: number,
  issues: NotificationIssue[],
): NotificationRuleDto | null {
  const path = `rules[${index}]`
  if (!isRecord(input)) {
    addIssue(issues, "invalid_field", path, "Rule must be an object.")
    return null
  }

  const startIssueCount = issues.length
  const id = requiredString(input, "id", path, issues)
  const workflowValue = requiredString(input, "workflow_key", path, issues)
  const eventValue = requiredString(input, "event_key", path, issues)
  const audienceValue = requiredString(input, "audience_key", path, issues)
  const channelValue = requiredString(input, "channel_key", path, issues)
  const ruleVariantValue = requiredString(input, "rule_variant_key", path, issues)
  const deliveryModeValue = requiredString(input, "delivery_mode", path, issues)
  const enabled = requiredBoolean(input, "enabled", path, issues)
  const configurationKindValue = requiredString(input, "configuration_kind", path, issues)
  const activationLocked = requiredBoolean(input, "activation_locked", path, issues)
  const activeTemplateId = requiredString(input, "active_template_id", path, issues)
  const revision = requiredDecimalString(input, "revision", path, issues)

  let configurationKind: Exclude<NotificationConfigurationKind, "not_applicable"> | null = null
  if (
    configurationKindValue === null ||
    !RULE_CONFIGURATION_KIND_SET.has(configurationKindValue)
  ) {
    addIssue(
      issues,
      "invalid_field",
      `${path}.configuration_kind`,
      "Unknown notification configuration kind.",
    )
  } else {
    configurationKind = configurationKindValue as Exclude<
      NotificationConfigurationKind,
      "not_applicable"
    >
  }

  let workflowKey: NotificationWorkflowKey | null = null
  if (!isWorkflowKey(workflowValue)) {
    addIssue(issues, "unknown_workflow", `${path}.workflow_key`, "Unknown workflow key.")
  } else {
    workflowKey = workflowValue
    if (snapshotWorkflowKey !== null && workflowKey !== snapshotWorkflowKey) {
      addIssue(
        issues,
        "event_workflow_mismatch",
        `${path}.workflow_key`,
        "Rule workflow does not match the snapshot workflow.",
      )
    }
  }

  let eventKey: NotificationEventKey | null = null
  if (workflowKey !== null && eventValue !== null) {
    const workflowEvents = NOTIFICATION_EVENT_KEYS_BY_WORKFLOW[workflowKey] as readonly string[]
    if (!workflowEvents.includes(eventValue)) {
      const existsInAnotherWorkflow = Object.values(NOTIFICATION_EVENT_KEYS_BY_WORKFLOW).some(
        (events) => (events as readonly string[]).includes(eventValue),
      )
      addIssue(
        issues,
        existsInAnotherWorkflow ? "event_workflow_mismatch" : "unknown_event",
        `${path}.event_key`,
        existsInAnotherWorkflow
          ? "Event key does not belong to the rule workflow."
          : "Unknown event key.",
      )
    } else {
      eventKey = eventValue as NotificationEventKey
    }
  }

  let audienceKey: NotificationAudienceKey | null = null
  if (!isAudienceKey(audienceValue)) {
    addIssue(issues, "unknown_audience", `${path}.audience_key`, "Unknown audience key.")
  } else {
    audienceKey = audienceValue
  }

  let channelKey: NotificationEditableChannelKey | null = null
  if (channelValue === "web_push") {
    addIssue(
      issues,
      "independent_web_push_rule",
      `${path}.channel_key`,
      "Web Push is derived from in-app delivery and cannot be an independent rule.",
    )
  } else if (channelValue === null || !CHANNEL_KEY_SET.has(channelValue)) {
    addIssue(issues, "unknown_channel", `${path}.channel_key`, "Unknown channel key.")
  } else if (!EDITABLE_CHANNEL_KEY_SET.has(channelValue)) {
    addIssue(issues, "unknown_channel", `${path}.channel_key`, "Channel is not editable.")
  } else {
    channelKey = channelValue as NotificationEditableChannelKey
  }

  if (
    workflowKey !== null &&
    audienceKey !== null &&
    channelKey !== null &&
    !isNotificationRuleCellAllowed({ workflowKey, audienceKey, channelKey })
  ) {
    addIssue(
      issues,
      "impossible_rule_cell",
      path,
      "Audience and channel are not valid for this workflow.",
    )
  }

  const schedule = parseScheduleConfig(
    deliveryModeValue,
    input.schedule_key,
    input.schedule_config,
    path,
    issues,
  )
  if (schedule !== null && ruleVariantValue !== schedule.ruleVariantKey) {
    addIssue(
      issues,
      "invalid_schedule",
      `${path}.rule_variant_key`,
      "Rule variant must match the delivery schedule.",
    )
  }

  let connectionKey: NotificationConnectionKey | null = null
  const connectionValue = input.connection_key
  if (connectionValue !== undefined && connectionValue !== null) {
    if (typeof connectionValue !== "string" || !isConnectionKey(connectionValue)) {
      addIssue(issues, "unknown_connection", `${path}.connection_key`, "Unknown connection key.")
    } else {
      connectionKey = connectionValue
    }
  } else if (audienceKey !== null && channelKey === "google_chat") {
    connectionKey = deriveConnectionKey(audienceKey)
  }

  if (channelKey !== null && audienceKey !== null && connectionKey !== null) {
    const connectionMatchesCell =
      channelKey === "google_chat" &&
      ((audienceKey === "management_team" && connectionKey === "google_chat.management") ||
        (audienceKey === "executive_team" && connectionKey === "google_chat.executive") ||
        (audienceKey === "subject_team" &&
          (connectionKey === "google_chat.math" ||
            connectionKey === "google_chat.english" ||
            connectionKey === "google_chat.science")))

    if (!connectionMatchesCell) {
      addIssue(
        issues,
        "impossible_rule_cell",
        `${path}.connection_key`,
        "Connection key does not belong to the rule channel and audience.",
      )
    }
  }

  const contentContract = parseContentContract(
    input.content_contract,
    `${path}.content_contract`,
    issues,
  )
  const templateCompliance = parseTemplateCompliance(
    input.template_compliance,
    contentContract?.contractVersion ?? null,
    `${path}.template_compliance`,
    issues,
  )
  const template = parseTemplate(input.template, id, activeTemplateId, `${path}.template`, issues)

  if (configurationKind === "fixed_policy_editable_template" && activationLocked !== true) {
    addIssue(
      issues,
      "invalid_field",
      `${path}.activation_locked`,
      "Fixed delivery policies must remain activation locked.",
    )
  }

  const eventLabel = optionalString(input, "event_label", path, issues)
  const groupLabel = optionalString(input, "group_label", path, issues)
  const triggerDescription = optionalString(input, "trigger_description", path, issues)
  const sortOrder = optionalInteger(input, "sort_order", path, issues)
  const audienceLabel = optionalString(input, "audience_label", path, issues)
  const channelLabel = optionalString(input, "channel_label", path, issues)
  const updatedAt = optionalString(input, "updated_at", path, issues)

  if (
    issues.length !== startIssueCount ||
    id === null ||
    workflowKey === null ||
    eventKey === null ||
    audienceKey === null ||
    channelKey === null ||
    schedule === null ||
    enabled === null ||
    configurationKind === null ||
    activationLocked === null ||
    contentContract === null ||
    templateCompliance === null ||
    activeTemplateId === null ||
    revision === null ||
    template === null
  ) {
    return null
  }

  return {
    id,
    workflowKey,
    eventKey,
    eventLabel,
    groupLabel,
    triggerDescription,
    sortOrder,
    audienceKey,
    audienceLabel,
    channelKey,
    channelLabel,
    connectionKey,
    ruleVariantKey: schedule.ruleVariantKey,
    deliveryMode: deliveryModeValue as NotificationDeliveryMode,
    scheduleKey: schedule.scheduleKey,
    scheduleConfig: schedule.scheduleConfig,
    enabled,
    configurationKind,
    activationLocked,
    contentContract,
    templateCompliance,
    activeTemplateId,
    revision,
    updatedAt,
    template,
  }
}

function parseConnection(
  input: unknown,
  index: number,
  issues: NotificationIssue[],
): NotificationConnectionDto | null {
  const path = `connections[${index}]`
  if (!isRecord(input)) {
    addIssue(issues, "invalid_field", path, "Connection must be an object.")
    return null
  }

  if ("webhook_url" in input || "webhook_url_ciphertext" in input) {
    addIssue(
      issues,
      "unsafe_connection_payload",
      path,
      "Connection DTOs must never include plaintext or ciphertext secrets.",
    )
  }

  const startIssueCount = issues.length
  const connectionValue = requiredString(input, "connection_key", path, issues)
  const stateValue = requiredString(input, "connection_state", path, issues)
  const revision = requiredDecimalString(input, "revision", path, issues)
  const webhookUrlMask = optionalString(input, "webhook_url_mask", path, issues)
  const lastVerifiedAt = optionalString(input, "last_verified_at", path, issues)
  const lastErrorCode = optionalString(input, "last_error_code", path, issues)
  const editable = optionalBoolean(input, "editable", false, path, issues)

  let connectionKey: NotificationConnectionKey | null = null
  if (!isConnectionKey(connectionValue)) {
    addIssue(issues, "unknown_connection", `${path}.connection_key`, "Unknown connection key.")
  } else {
    connectionKey = connectionValue
  }

  let connectionState: NotificationConnectionState | null = null
  if (stateValue === null || !CONNECTION_STATE_SET.has(stateValue)) {
    addIssue(
      issues,
      "unknown_connection_state",
      `${path}.connection_state`,
      "Unknown connection state.",
    )
  } else {
    connectionState = stateValue as NotificationConnectionState
  }
  if (
    lastErrorCode !== null &&
    !NOTIFICATION_CONNECTION_RESULT_CODE_PATTERN.test(lastErrorCode)
  ) {
    addIssue(
      issues,
      "invalid_field",
      `${path}.last_error_code`,
      "Unknown connection result code.",
    )
  }

  if (
    issues.length !== startIssueCount ||
    connectionKey === null ||
    connectionState === null ||
    revision === null
  ) {
    return null
  }

  return {
    connectionKey,
    connectionState,
    revision,
    configured: connectionState !== "disconnected",
    webhookUrlMask,
    lastVerifiedAt,
    lastErrorCode,
    editable,
  }
}

function parseDeliverySummary(
  input: unknown,
  issues: NotificationIssue[],
): NotificationDeliverySummaryDto | null {
  const path = "delivery_summary"
  if (!isRecord(input)) {
    addIssue(issues, "invalid_field", path, "Delivery summary must be an object.")
    return null
  }

  const startIssueCount = issues.length
  const pendingCount = requiredNonNegativeInteger(input, "pending_count", path, issues)
  const sentCount = requiredNonNegativeInteger(input, "sent_count", path, issues)
  const failedCount = requiredNonNegativeInteger(input, "failed_count", path, issues)
  const unknownCount = requiredNonNegativeInteger(input, "unknown_count", path, issues)
  const latestDeliveryAt = optionalString(input, "latest_delivery_at", path, issues)

  if (
    issues.length !== startIssueCount ||
    pendingCount === null ||
    sentCount === null ||
    failedCount === null ||
    unknownCount === null
  ) {
    return null
  }

  return { pendingCount, sentCount, failedCount, unknownCount, latestDeliveryAt }
}

export function parseNotificationControlPlaneSnapshot(
  input: unknown,
): NotificationResult<NotificationControlPlaneSnapshot> {
  const issues: NotificationIssue[] = []
  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [{ code: "invalid_snapshot", path: "$", message: "Snapshot must be an object." }],
    }
  }

  const scopeValue = requiredString(input, "scope_key", "$", issues)
  if (scopeValue !== null && scopeValue !== "global") {
    addIssue(issues, "invalid_field", "scope_key", "Only the global settings scope is supported.")
  }

  const workflowValue = requiredString(input, "workflow_key", "$", issues)
  let workflowKey: NotificationWorkflowKey | null = null
  if (!isWorkflowKey(workflowValue)) {
    addIssue(issues, "unknown_workflow", "workflow_key", "Unknown workflow key.")
  } else {
    workflowKey = workflowValue
  }

  const rules: NotificationRuleDto[] = []
  const ruleIds = new Set<string>()
  const templateIds = new Set<string>()
  if (!Array.isArray(input.rules)) {
    addIssue(issues, "invalid_field", "rules", "Rules must be an array.")
  } else {
    input.rules.forEach((rule, index) => {
      const parsed = parseRule(rule, workflowKey, index, issues)
      if (parsed === null) return
      if (ruleIds.has(parsed.id)) {
        addIssue(
          issues,
          "duplicate_identity",
          `rules[${index}].id`,
          "Rule IDs must be unique within a snapshot.",
        )
        return
      }
      if (templateIds.has(parsed.template.id)) {
        addIssue(
          issues,
          "duplicate_identity",
          `rules[${index}].template.id`,
          "Template IDs must be unique within a snapshot.",
        )
        return
      }
      ruleIds.add(parsed.id)
      templateIds.add(parsed.template.id)
      rules.push(parsed)
    })
  }

  const connections: NotificationConnectionDto[] = []
  const connectionKeys = new Set<NotificationConnectionKey>()
  if (!Array.isArray(input.connections)) {
    addIssue(issues, "invalid_field", "connections", "Connections must be an array.")
  } else {
    input.connections.forEach((connection, index) => {
      const parsed = parseConnection(connection, index, issues)
      if (parsed === null) return
      if (connectionKeys.has(parsed.connectionKey)) {
        addIssue(
          issues,
          "duplicate_identity",
          `connections[${index}].connection_key`,
          "Connection keys must be unique within a snapshot.",
        )
        return
      }
      connectionKeys.add(parsed.connectionKey)
      connections.push(parsed)
    })
  }

  const deliverySummary = parseDeliverySummary(input.delivery_summary, issues)
  const loadedAt = optionalString(input, "loaded_at", "$", issues)

  if (
    issues.length > 0 ||
    scopeValue !== "global" ||
    workflowKey === null ||
    deliverySummary === null
  ) {
    return { ok: false, issues }
  }

  return {
    ok: true,
    value: {
      scopeKey: "global",
      workflowKey,
      rules,
      connections,
      deliverySummary,
      loadedAt,
    },
  }
}
