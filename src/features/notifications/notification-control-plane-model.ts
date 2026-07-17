import type {
  NotificationControlPlaneSnapshot,
  NotificationIssue,
  NotificationResult,
  NotificationRuleDto,
  NotificationScheduleConfig,
  NotificationScheduleKey,
  NotificationWorkflowKey,
} from "./notification-control-plane-types.ts"

export type NotificationRuleDraft = {
  enabled: boolean
  scheduleConfig: NotificationScheduleConfig
  titleTemplate: string
  bodyTemplate: string
}

export type NotificationDraft = {
  workflowKey: NotificationWorkflowKey
  rules: Record<string, NotificationRuleDraft>
}

export type NotificationRulePatch = Partial<
  Pick<
    NotificationRuleDraft,
    "enabled" | "scheduleConfig" | "titleTemplate" | "bodyTemplate"
  >
>

export type NotificationPatch = {
  rules: Record<string, NotificationRulePatch>
}

export type NotificationConflictField =
  `rules.${string}.${"enabled" | "scheduleConfig" | "titleTemplate" | "bodyTemplate"}`

export type NotificationRebaseResult =
  | {
      ok: true
      draft: NotificationDraft
      conflictingFields: NotificationConflictField[]
      overwriteConfirmationRequired: false
      overwriteConfirmed: boolean
    }
  | {
      ok: false
      reason: "revision_conflict"
      draft: NotificationDraft
      conflictingFields: NotificationConflictField[]
      overwriteConfirmationRequired: true
      overwriteConfirmed: false
    }

const EDITABLE_FIELDS = [
  "enabled",
  "scheduleConfig",
  "titleTemplate",
  "bodyTemplate",
] as const

function cloneScheduleConfig(
  value: NotificationScheduleConfig,
): NotificationScheduleConfig {
  if (value === null) return null
  if ("leadMinutes" in value) {
    return {
      anchorKey: value.anchorKey,
      leadMinutes: value.leadMinutes,
      timezone: value.timezone,
    }
  }
  return {
    anchorKey: value.anchorKey,
    localTime: value.localTime,
    timezone: value.timezone,
  }
}

function cloneRuleDraft(rule: NotificationRuleDraft): NotificationRuleDraft {
  return {
    enabled: rule.enabled,
    scheduleConfig: cloneScheduleConfig(rule.scheduleConfig),
    titleTemplate: rule.titleTemplate,
    bodyTemplate: rule.bodyTemplate,
  }
}

function cloneDraft(draft: NotificationDraft): NotificationDraft {
  const rules: Record<string, NotificationRuleDraft> = {}
  for (const [ruleId, rule] of Object.entries(draft.rules)) {
    rules[ruleId] = cloneRuleDraft(rule)
  }
  return { workflowKey: draft.workflowKey, rules }
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left === null || right === null) return false
  if (typeof left !== "object" || typeof right !== "object") return false
  return JSON.stringify(left) === JSON.stringify(right)
}

function createIssue(
  code: NotificationIssue["code"],
  path: string,
  message: string,
): NotificationIssue {
  return { code, path, message }
}

export function createNotificationDraft(
  snapshot: NotificationControlPlaneSnapshot,
): NotificationDraft {
  const rules: Record<string, NotificationRuleDraft> = {}
  for (const rule of snapshot.rules) {
    rules[rule.id] = {
      enabled: rule.enabled,
      scheduleConfig: cloneScheduleConfig(rule.scheduleConfig),
      titleTemplate: rule.template.titleTemplate,
      bodyTemplate: rule.template.bodyTemplate,
    }
  }
  return { workflowKey: snapshot.workflowKey, rules }
}

export function buildNotificationPatch(
  baseDraft: NotificationDraft,
  draft: NotificationDraft,
): NotificationPatch {
  const patch: NotificationPatch = { rules: {} }

  for (const [ruleId, baseRule] of Object.entries(baseDraft.rules)) {
    const nextRule = draft.rules[ruleId]
    if (nextRule === undefined) continue

    const rulePatch: NotificationRulePatch = {}
    if (baseRule.enabled !== nextRule.enabled) {
      rulePatch.enabled = nextRule.enabled
    }
    if (!valuesEqual(baseRule.scheduleConfig, nextRule.scheduleConfig)) {
      rulePatch.scheduleConfig = cloneScheduleConfig(nextRule.scheduleConfig)
    }
    if (baseRule.titleTemplate !== nextRule.titleTemplate) {
      rulePatch.titleTemplate = nextRule.titleTemplate
    }
    if (baseRule.bodyTemplate !== nextRule.bodyTemplate) {
      rulePatch.bodyTemplate = nextRule.bodyTemplate
    }

    if (Object.keys(rulePatch).length > 0) patch.rules[ruleId] = rulePatch
  }

  return patch
}

export function isNotificationDraftDirty(
  baseDraft: NotificationDraft,
  draft: NotificationDraft,
): boolean {
  if (baseDraft.workflowKey !== draft.workflowKey) return true
  const baseRuleIds = Object.keys(baseDraft.rules)
  const draftRuleIds = Object.keys(draft.rules)
  if (baseRuleIds.length !== draftRuleIds.length) return true
  if (baseRuleIds.some((ruleId) => draft.rules[ruleId] === undefined)) return true
  return Object.keys(buildNotificationPatch(baseDraft, draft).rules).length > 0
}

function extractTemplateTokens(template: string): {
  tokens: string[]
  malformed: boolean
} {
  const tokens = Array.from(template.matchAll(/\{([^{}]+)\}/g), (match) => match[1])
  const withoutTokens = template.replace(/\{[^{}]+\}/g, "")
  return {
    tokens,
    malformed: withoutTokens.includes("{") || withoutTokens.includes("}"),
  }
}

function validateTemplate(
  rule: NotificationRuleDto,
  field: "titleTemplate" | "bodyTemplate",
  value: string,
  issues: NotificationIssue[],
) {
  const path = `rules.${rule.id}.${field}`
  const { tokens, malformed } = extractTemplateTokens(value)
  const allowedTokens = new Set(rule.template.allowedVariables.map(({ token }) => token))

  if (malformed) {
    issues.push(
      createIssue(
        "template_content_not_allowed",
        path,
        "Template variables must use balanced braces.",
      ),
    )
  }

  for (const token of tokens) {
    if (!allowedTokens.has(token)) {
      issues.push(
        createIssue(
          "template_token_not_allowed",
          path,
          `Template token {${token}} is not in the server-provided allowlist.`,
        ),
      )
    }
  }

  if (/<[^>]+>/.test(value) || /(?:https?:)?\/\//i.test(value)) {
    issues.push(
      createIssue(
        "template_content_not_allowed",
        path,
        "Raw HTML, provider mentions, and external URLs are not allowed in templates.",
      ),
    )
  }
}

function isScheduleConfigValid(
  scheduleKey: NotificationScheduleKey | null,
  scheduleConfig: NotificationScheduleConfig,
): boolean {
  if (scheduleKey === null) return scheduleConfig === null
  if (
    scheduleConfig === null ||
    typeof scheduleConfig !== "object" ||
    Array.isArray(scheduleConfig) ||
    scheduleConfig.timezone !== "Asia/Seoul"
  ) {
    return false
  }
  if (scheduleConfig.anchorKey.length === 0) return false

  if (scheduleKey === "offset_before") {
    return (
      Object.keys(scheduleConfig).sort().join(",") ===
        "anchorKey,leadMinutes,timezone" &&
      "leadMinutes" in scheduleConfig &&
      Number.isInteger(scheduleConfig.leadMinutes) &&
      scheduleConfig.leadMinutes >= 1 &&
      scheduleConfig.leadMinutes <= 10080
    )
  }

  return (
    Object.keys(scheduleConfig).sort().join(",") === "anchorKey,localTime,timezone" &&
    "localTime" in scheduleConfig &&
    /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(scheduleConfig.localTime)
  )
}

function hasRequiredGoogleChatConnection(
  snapshot: NotificationControlPlaneSnapshot,
  rule: NotificationRuleDto,
): boolean {
  const usableConnectionKeys = (() => {
    if (rule.connectionKey !== null) return [rule.connectionKey]
    if (rule.audienceKey === "management_team") return ["google_chat.management"]
    if (rule.audienceKey === "executive_team") return ["google_chat.executive"]
    if (rule.audienceKey === "subject_team") {
      return ["google_chat.math", "google_chat.english"]
    }
    return []
  })()

  return (
    usableConnectionKeys.length > 0 &&
    usableConnectionKeys.every((connectionKey) =>
      snapshot.connections.some(
        (connection) =>
          connection.connectionKey === connectionKey &&
          (connection.connectionState === "legacy_active" ||
            connection.connectionState === "encrypted_active") &&
          connection.lastErrorCode === null,
      ),
    )
  )
}

export function validateNotificationDraft(
  snapshot: NotificationControlPlaneSnapshot,
  draft: NotificationDraft,
): NotificationResult<NotificationDraft> {
  const issues: NotificationIssue[] = []
  const snapshotRuleIds = new Set(snapshot.rules.map(({ id }) => id))

  if (draft.workflowKey !== snapshot.workflowKey) {
    issues.push(
      createIssue(
        "draft_workflow_mismatch",
        "workflowKey",
        "Draft workflow does not match the loaded snapshot.",
      ),
    )
  }

  for (const ruleId of Object.keys(draft.rules)) {
    if (!snapshotRuleIds.has(ruleId)) {
      issues.push(
        createIssue(
          "draft_rule_unknown",
          `rules.${ruleId}`,
          "Draft contains a rule that is not present in the server snapshot.",
        ),
      )
    }
  }

  for (const rule of snapshot.rules) {
    const ruleDraft = draft.rules[rule.id]
    if (ruleDraft === undefined) {
      issues.push(
        createIssue(
          "draft_rule_missing",
          `rules.${rule.id}`,
          "Draft is missing a rule from the server snapshot.",
        ),
      )
      continue
    }

    if (!isScheduleConfigValid(rule.scheduleKey, ruleDraft.scheduleConfig)) {
      issues.push(
        createIssue(
          "invalid_schedule",
          `rules.${rule.id}.scheduleConfig`,
          "Draft schedule config does not match the rule schedule.",
        ),
      )
    }

    validateTemplate(rule, "titleTemplate", ruleDraft.titleTemplate, issues)
    validateTemplate(rule, "bodyTemplate", ruleDraft.bodyTemplate, issues)

    if (
      rule.channelKey === "google_chat" &&
      !rule.enabled &&
      ruleDraft.enabled &&
      !hasRequiredGoogleChatConnection(snapshot, rule)
    ) {
      issues.push(
        createIssue(
          "google_chat_connection_required",
          `rules.${rule.id}.enabled`,
          "A verified Google Chat connection is required before enabling this rule.",
        ),
      )
    }
  }

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: cloneDraft(draft) }
}

export function rebaseNotificationDraft(
  baseDraft: NotificationDraft,
  localDraft: NotificationDraft,
  remoteDraft: NotificationDraft,
  options: { overwriteConfirmed?: boolean } = {},
): NotificationRebaseResult {
  const rebased = cloneDraft(remoteDraft)
  const conflictingFields: NotificationConflictField[] = []

  for (const [ruleId, baseRule] of Object.entries(baseDraft.rules)) {
    const localRule = localDraft.rules[ruleId]
    const remoteRule = remoteDraft.rules[ruleId]
    if (localRule === undefined || remoteRule === undefined) continue

    for (const field of EDITABLE_FIELDS) {
      const localChanged = !valuesEqual(baseRule[field], localRule[field])
      if (!localChanged) continue

      const remoteChanged = !valuesEqual(baseRule[field], remoteRule[field])
      const valuesConflict = remoteChanged && !valuesEqual(localRule[field], remoteRule[field])
      if (valuesConflict) {
        conflictingFields.push(`rules.${ruleId}.${field}`)
      }

      if (field === "scheduleConfig") {
        rebased.rules[ruleId][field] = cloneScheduleConfig(localRule[field])
      } else if (field === "enabled") {
        rebased.rules[ruleId][field] = localRule[field]
      } else {
        rebased.rules[ruleId][field] = localRule[field]
      }
    }
  }

  const overwriteConfirmed = conflictingFields.length > 0 && options.overwriteConfirmed === true
  if (conflictingFields.length > 0 && !overwriteConfirmed) {
    return {
      ok: false,
      reason: "revision_conflict",
      draft: rebased,
      conflictingFields,
      overwriteConfirmationRequired: true,
      overwriteConfirmed: false,
    }
  }

  return {
    ok: true,
    draft: rebased,
    conflictingFields,
    overwriteConfirmationRequired: false,
    overwriteConfirmed,
  }
}
