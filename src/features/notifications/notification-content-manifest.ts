import {
  NOTIFICATION_EVENT_KEYS_BY_WORKFLOW,
  type NotificationAudienceKey,
  type NotificationConfigurationKind,
  type NotificationContentContractIdentity,
  type NotificationContentCoverageEntry,
  type NotificationDispatchOwner,
  type NotificationEditableChannelKey,
  type NotificationEnabledState,
  type NotificationEventKey,
  type NotificationScopeState,
  type NotificationWorkflowKey,
} from "./notification-control-plane-types.ts"

type NotificationContentRuleCell = Readonly<{
  audienceKey: NotificationAudienceKey
  channelKey: NotificationEditableChannelKey
  ruleVariantKeys: ReadonlyArray<string>
}>

type NotificationContentRuleGroup = Readonly<{
  workflowKey: NotificationWorkflowKey
  eventKeys: ReadonlyArray<NotificationEventKey>
  cells: ReadonlyArray<NotificationContentRuleCell>
  scopeState: Exclude<NotificationScopeState, "no_rule_event">
  configurationKind: NotificationConfigurationKind
  enabledState: Exclude<NotificationEnabledState, "not_applicable">
  dispatchOwner: NotificationDispatchOwner
}>

const IMMEDIATE = ["immediate"] as const
const REMINDER_VARIANTS = ["previous_day_at", "same_day_at", "offset_before"] as const

const TASK_CELLS = [
  { audienceKey: "requester_profile", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
  { audienceKey: "primary_assignee", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
  { audienceKey: "secondary_assignee", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
  { audienceKey: "management_team", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
  { audienceKey: "management_team", channelKey: "google_chat", ruleVariantKeys: IMMEDIATE },
] as const satisfies ReadonlyArray<NotificationContentRuleCell>

const WORD_RETEST_CELLS = [
  { audienceKey: "requesting_teacher", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
  { audienceKey: "assigned_assistant", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
  { audienceKey: "secondary_assignee", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
  { audienceKey: "management_team", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
  { audienceKey: "management_team", channelKey: "google_chat", ruleVariantKeys: IMMEDIATE },
] as const satisfies ReadonlyArray<NotificationContentRuleCell>

const APPROVAL_CELLS = [
  { audienceKey: "requester_profile", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
  { audienceKey: "approver_profile", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
  { audienceKey: "management_team", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
  { audienceKey: "management_team", channelKey: "google_chat", ruleVariantKeys: IMMEDIATE },
] as const satisfies ReadonlyArray<NotificationContentRuleCell>

const RULE_GROUPS = [
  {
    workflowKey: "tasks",
    eventKeys: NOTIFICATION_EVENT_KEYS_BY_WORKFLOW.tasks,
    cells: TASK_CELLS,
    scopeState: "in_scope",
    configurationKind: "editable_rule",
    enabledState: "disabled",
    dispatchOwner: "none",
  },
  {
    workflowKey: "word_retests",
    eventKeys: NOTIFICATION_EVENT_KEYS_BY_WORKFLOW.word_retests,
    cells: WORD_RETEST_CELLS,
    scopeState: "in_scope",
    configurationKind: "editable_rule",
    enabledState: "disabled",
    dispatchOwner: "none",
  },
  {
    workflowKey: "approvals",
    eventKeys: NOTIFICATION_EVENT_KEYS_BY_WORKFLOW.approvals.filter(
      (eventKey) => eventKey !== "approval.deleted",
    ),
    cells: APPROVAL_CELLS,
    scopeState: "in_scope",
    configurationKind: "editable_rule",
    enabledState: "disabled",
    dispatchOwner: "none",
  },
  {
    workflowKey: "registration",
    eventKeys: [
      "registration.case_created",
      "registration.registration_completed",
      "registration.case_closed",
    ],
    cells: [
      { audienceKey: "management_team", channelKey: "google_chat", ruleVariantKeys: IMMEDIATE },
    ],
    scopeState: "in_scope",
    configurationKind: "editable_rule",
    enabledState: "enabled",
    dispatchOwner: "legacy",
  },
  {
    workflowKey: "transfer",
    eventKeys: ["transfer.submitted", "transfer.completed"],
    cells: [
      { audienceKey: "management_team", channelKey: "google_chat", ruleVariantKeys: IMMEDIATE },
    ],
    scopeState: "in_scope",
    configurationKind: "editable_rule",
    enabledState: "enabled",
    dispatchOwner: "legacy",
  },
  {
    workflowKey: "withdrawal",
    eventKeys: ["withdrawal.submitted", "withdrawal.completed"],
    cells: [
      { audienceKey: "management_team", channelKey: "google_chat", ruleVariantKeys: IMMEDIATE },
    ],
    scopeState: "in_scope",
    configurationKind: "editable_rule",
    enabledState: "enabled",
    dispatchOwner: "legacy",
  },
  {
    workflowKey: "makeup_requests",
    eventKeys: ["makeup.submitted", "makeup.refund_requested"],
    cells: [
      { audienceKey: "approver_profile", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
      { audienceKey: "management_team", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
      { audienceKey: "executive_team", channelKey: "google_chat", ruleVariantKeys: IMMEDIATE },
      { audienceKey: "management_team", channelKey: "google_chat", ruleVariantKeys: IMMEDIATE },
      { audienceKey: "subject_team", channelKey: "google_chat", ruleVariantKeys: IMMEDIATE },
    ],
    scopeState: "in_scope",
    configurationKind: "editable_rule",
    enabledState: "enabled",
    dispatchOwner: "legacy",
  },
  {
    workflowKey: "makeup_requests",
    eventKeys: ["makeup.approved", "makeup.refund_completed", "makeup.approval_canceled"],
    cells: [
      { audienceKey: "requester_profile", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
      { audienceKey: "approver_profile", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
      { audienceKey: "management_team", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
      { audienceKey: "executive_team", channelKey: "google_chat", ruleVariantKeys: IMMEDIATE },
      { audienceKey: "management_team", channelKey: "google_chat", ruleVariantKeys: IMMEDIATE },
      { audienceKey: "subject_team", channelKey: "google_chat", ruleVariantKeys: IMMEDIATE },
    ],
    scopeState: "in_scope",
    configurationKind: "editable_rule",
    enabledState: "enabled",
    dispatchOwner: "legacy",
  },
  {
    workflowKey: "makeup_requests",
    eventKeys: ["makeup.revision_requested", "makeup.rejected"],
    cells: [
      { audienceKey: "requester_profile", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
      { audienceKey: "subject_team", channelKey: "google_chat", ruleVariantKeys: IMMEDIATE },
    ],
    scopeState: "in_scope",
    configurationKind: "editable_rule",
    enabledState: "enabled",
    dispatchOwner: "legacy",
  },
  {
    workflowKey: "registration",
    eventKeys: ["registration.appointment_reminder_due"],
    cells: [
      { audienceKey: "management_team", channelKey: "in_app", ruleVariantKeys: REMINDER_VARIANTS },
      { audienceKey: "track_director", channelKey: "in_app", ruleVariantKeys: REMINDER_VARIANTS },
      { audienceKey: "management_team", channelKey: "google_chat", ruleVariantKeys: REMINDER_VARIANTS },
    ],
    scopeState: "in_scope",
    configurationKind: "editable_rule",
    enabledState: "disabled",
    dispatchOwner: "legacy",
  },
  {
    workflowKey: "registration",
    eventKeys: ["registration.phone_consultation_ready"],
    cells: [
      { audienceKey: "track_director", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
    ],
    scopeState: "in_scope",
    configurationKind: "fixed_policy_editable_template",
    enabledState: "enabled",
    dispatchOwner: "legacy",
  },
  {
    workflowKey: "registration",
    eventKeys: [
      "registration.visit_scheduled",
      "registration.visit_rescheduled",
      "registration.visit_replaced",
      "registration.visit_subject_deselected",
      "registration.visit_canceled",
    ],
    cells: [
      { audienceKey: "track_director", channelKey: "in_app", ruleVariantKeys: IMMEDIATE },
      { audienceKey: "management_team", channelKey: "google_chat", ruleVariantKeys: IMMEDIATE },
    ],
    scopeState: "in_scope",
    configurationKind: "fixed_policy_editable_template",
    enabledState: "enabled",
    dispatchOwner: "legacy",
  },
  {
    workflowKey: "registration",
    eventKeys: ["registration.admission_message_requested"],
    cells: [
      { audienceKey: "applicant_guardian", channelKey: "customer_message", ruleVariantKeys: IMMEDIATE },
    ],
    scopeState: "excluded_channel",
    configurationKind: "not_applicable",
    enabledState: "enabled",
    dispatchOwner: "legacy",
  },
] as const satisfies ReadonlyArray<NotificationContentRuleGroup>

function identityKey(entry: Pick<
  NotificationContentCoverageEntry,
  "workflowKey" | "eventKey" | "audienceKey" | "channelKey" | "ruleVariantKey"
>) {
  return [
    entry.workflowKey,
    entry.eventKey,
    entry.audienceKey ?? "not_applicable",
    entry.channelKey ?? "not_applicable",
    entry.ruleVariantKey ?? "not_applicable",
  ].join("|")
}

function expandRuleGroups() {
  const entries: NotificationContentCoverageEntry[] = []
  for (const group of RULE_GROUPS) {
    for (const eventKey of group.eventKeys) {
      for (const cell of group.cells) {
        for (const ruleVariantKey of cell.ruleVariantKeys) {
          entries.push(Object.freeze({
            workflowKey: group.workflowKey,
            eventKey,
            audienceKey: cell.audienceKey,
            channelKey: cell.channelKey,
            ruleVariantKey,
            scopeState: group.scopeState,
            configurationKind: group.configurationKind,
            enabledState: group.enabledState,
            dispatchOwner: group.dispatchOwner,
          }))
        }
      }
    }
  }
  return entries
}

function buildCoverage() {
  const entries = expandRuleGroups()
  const ruleEventKeys = new Set(entries.map(({ workflowKey, eventKey }) => `${workflowKey}|${eventKey}`))

  for (const [workflowKey, eventKeys] of Object.entries(NOTIFICATION_EVENT_KEYS_BY_WORKFLOW)) {
    for (const eventKey of eventKeys) {
      if (ruleEventKeys.has(`${workflowKey}|${eventKey}`)) continue
      entries.push(Object.freeze({
        workflowKey: workflowKey as NotificationWorkflowKey,
        eventKey,
        audienceKey: null,
        channelKey: null,
        ruleVariantKey: null,
        scopeState: "no_rule_event",
        configurationKind: "not_applicable",
        enabledState: "not_applicable",
        dispatchOwner: "none",
      }))
    }
  }

  entries.sort((left, right) => identityKey(left).localeCompare(identityKey(right)))
  const identities = new Set<string>()
  for (const entry of entries) {
    const key = identityKey(entry)
    if (identities.has(key)) throw new Error("notification_content_manifest_duplicate_identity")
    identities.add(key)
  }
  return Object.freeze(entries)
}

const COVERAGE = buildCoverage()

export function listNotificationContentCoverage(): ReadonlyArray<NotificationContentCoverageEntry> {
  return COVERAGE
}

export function listNotificationContentRuleIdentities(): ReadonlyArray<NotificationContentContractIdentity> {
  return Object.freeze(COVERAGE
    .filter((entry) => entry.scopeState === "in_scope")
    .map((entry) => {
      if (entry.audienceKey === null || entry.channelKey === null || entry.ruleVariantKey === null) {
        throw new Error("notification_content_manifest_in_scope_identity_incomplete")
      }
      return Object.freeze({
        workflowKey: entry.workflowKey,
        eventKey: entry.eventKey,
        audienceKey: entry.audienceKey,
        channelKey: entry.channelKey,
        ruleVariantKey: entry.ruleVariantKey,
      })
    }))
}
