import { createHash, randomUUID } from "node:crypto"

import type {
  NotificationChannelKey,
  NotificationWorkflowKey,
} from "../notification-control-plane-types.ts"
import type {
  NotificationRenderContext,
  NotificationRuleSnapshot,
  NotificationTarget,
  NotificationWorkflowAdapter,
  RuleReconciliationBatch,
  TargetReconciliationBatch,
} from "./notification-workflow-adapter.ts"
import {
  createGoogleChatProvider,
  type NotificationProviderResult,
} from "./providers/google-chat-provider.ts"
import { createWebPushProvider } from "./providers/web-push-provider.ts"

type JsonRecord = Record<string, unknown>
type NotificationRpc = (name: string, parameters: JsonRecord) => Promise<unknown>

export type NotificationBegunDeliveryContext = Readonly<{
  delivery_id: string
  claim_token: string
  dispatch_token: string
  status: "sending"
  channel_key: "google_chat" | "web_push"
  [key: string]: unknown
}>

export type NotificationProvider = Readonly<{
  send(input: NotificationBegunDeliveryContext): Promise<NotificationProviderResult>
}>

export interface NotificationWorker {
  runBatch(input: { workerId: string; batchSize: number; leaseSeconds: number }): Promise<{
    fanout: number
    ruleReconciliation: number
    targetReconciliation: number
    deliveries: number
    reaped: number
  }>
}

export type NotificationWorkerCounts = Readonly<{
  fanout: number
  ruleReconciliation: number
  targetReconciliation: number
  deliveries: number
  reaped: number
}>

type NotificationWorkerRuntimeInput = Readonly<{
  getAdapter: (workflowKey: string) => NotificationWorkflowAdapter | null
  rpc: NotificationRpc
  getProvider: (channelKey: string) => NotificationProvider | null
  createRunId: () => string
  now?: () => Date
}>

type RenderSnapshotInput = Readonly<{
  workflowKey: string
  payloadSchemaVersion: number
  template: NotificationTemplateSnapshot
  renderContext: NotificationRenderContext
  href: string | null
}>

type NotificationTemplateSnapshot = Readonly<{
  titleTemplate: string
  bodyTemplate: string
  allowedVariables: ReadonlyArray<Readonly<{
    key: string
    token: string
    piiClass: string
  }>>
  payloadSchemaVersion: number
}>

type RenderedNotificationSnapshot = Readonly<{
  renderedTitle: string
  renderedBody: string
  href: string | null
}>

const WORKFLOW_LINK_ROOTS: Readonly<Record<string, string>> = Object.freeze({
  tasks: "/admin/tasks",
  word_retests: "/admin/word-retests",
  registration: "/admin/registration",
  transfer: "/admin/transfer",
  withdrawal: "/admin/withdrawal",
  makeup_requests: "/admin/makeup-requests",
  approvals: "/admin/approvals",
})
const WORKFLOW_KEY_SET = new Set(Object.keys(WORKFLOW_LINK_ROOTS))

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)$/
const SAFE_CODE_PATTERN = /^[a-z0-9_]{1,64}$/
const SAFE_PROVIDER_REFERENCE_PATTERN = /^[A-Za-z0-9._:/-]{1,256}$/
const TOKEN_PATTERN = /\{([^{}]+)\}/g
const HTML_PATTERN = /<\/?[A-Za-z][^>]*>|[<>]/
const MENTION_PATTERN = /(^|[^A-Za-z0-9_])@(all|everyone|here|channel)(?=$|[^A-Za-z0-9_])/iu
const URL_PATTERN = /(?:https?:\/\/|\/\/)[^\s]+/iu
const MAX_TITLE_LENGTH = 200
const MAX_BODY_LENGTH = 4_000
const RETRY_MIN_SECONDS = 30
const RETRY_MAX_SECONDS = 15 * 60

class NotificationRenderValidationError extends Error {
  readonly code = "render_validation_failed"

  constructor() {
    super("알림 렌더 입력이 유효하지 않습니다.")
    this.name = "NotificationRenderValidationError"
  }
}

function renderValidationError(): never {
  throw new NotificationRenderValidationError()
}

function workerEnvelopeError(): never {
  throw Object.assign(new Error("알림 worker DB 응답 형식이 유효하지 않습니다."), {
    code: "worker_envelope_invalid",
  })
}

function isPlainRecord(value: unknown): value is JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function asRecord(value: unknown): JsonRecord {
  return isPlainRecord(value) ? value : {}
}

function asString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null
}

function decimalString(value: unknown): string {
  const normalized = typeof value === "string" ? value : ""
  if (!DECIMAL_PATTERN.test(normalized)) workerEnvelopeError()
  return normalized
}

function positiveDecimalString(value: unknown) {
  const normalized = decimalString(value)
  if (normalized === "0") workerEnvelopeError()
  return normalized
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || !value.trim()) workerEnvelopeError()
  return value
}

function requiredPositiveInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    workerEnvelopeError()
  }
  return value
}

function requiredUuid(value: unknown) {
  const normalized = requiredString(value)
  if (!UUID_PATTERN.test(normalized)) workerEnvelopeError()
  return normalized
}

function requiredWorkflowKey(value: unknown) {
  const normalized = requiredString(value)
  if (!WORKFLOW_KEY_SET.has(normalized)) workerEnvelopeError()
  return normalized as NotificationWorkflowKey
}

function optionalRevision(value: unknown) {
  if (value === null || value === undefined) return null
  return positiveDecimalString(value)
}

function toCount(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return 0
  return Math.trunc(number)
}

function toClaimRows(value: unknown): JsonRecord[] {
  if (!Array.isArray(value) || value.some((entry) => !isPlainRecord(entry))) {
    workerEnvelopeError()
  }
  return value as JsonRecord[]
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) renderValidationError()
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (!isPlainRecord(value)) renderValidationError()
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`
}

export function hashNotificationTargets(targets: ReadonlyArray<Readonly<Record<string, unknown>>>) {
  if (!Array.isArray(targets)) renderValidationError()
  const serializedTargets = targets.map(canonicalJson).sort()
  return createHash("sha256").update(`[${serializedTargets.join(",")}]`, "utf8").digest("hex")
}

function assertSafeRenderedValue(value: string, maxLength: number) {
  if (
    value.length > maxLength ||
    /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
    HTML_PATTERN.test(value) ||
    MENTION_PATTERN.test(value) ||
    URL_PATTERN.test(value)
  ) {
    renderValidationError()
  }
}

function templateTokens(template: string) {
  const result: string[] = []
  let match: RegExpExecArray | null
  TOKEN_PATTERN.lastIndex = 0
  while ((match = TOKEN_PATTERN.exec(template)) !== null) result.push(match[1])
  if (template.replace(TOKEN_PATTERN, "").includes("{") || template.replace(TOKEN_PATTERN, "").includes("}")) {
    renderValidationError()
  }
  return result
}

function validateDeepLink(workflowKey: string, href: string | null) {
  if (href === null) return null
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) {
    renderValidationError()
  }
  const expectedRoot = WORKFLOW_LINK_ROOTS[workflowKey]
  if (!expectedRoot) renderValidationError()
  let parsed: URL
  try {
    parsed = new URL(href, "https://notification.invalid")
  } catch {
    renderValidationError()
  }
  if (
    parsed.origin !== "https://notification.invalid" ||
    (parsed.pathname !== expectedRoot && !parsed.pathname.startsWith(`${expectedRoot}/`))
  ) {
    renderValidationError()
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

export function renderNotificationSnapshot(input: RenderSnapshotInput): RenderedNotificationSnapshot {
  if (!isPlainRecord(input) || !isPlainRecord(input.template) || !isPlainRecord(input.renderContext)) {
    renderValidationError()
  }
  if (
    !Number.isInteger(input.payloadSchemaVersion) ||
    input.payloadSchemaVersion !== input.template.payloadSchemaVersion ||
    !Array.isArray(input.template.allowedVariables) ||
    typeof input.template.titleTemplate !== "string" ||
    typeof input.template.bodyTemplate !== "string"
  ) {
    renderValidationError()
  }

  const variables = new Map<string, string>()
  const tokens = new Map<string, string>()
  for (const definition of input.template.allowedVariables) {
    if (
      !isPlainRecord(definition) ||
      typeof definition.key !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(definition.key) ||
      typeof definition.token !== "string" || !definition.token || /[{}]/.test(definition.token) ||
      variables.has(definition.key) || tokens.has(definition.token)
    ) {
      renderValidationError()
    }
    variables.set(definition.key, definition.token)
    tokens.set(definition.token, definition.key)
  }

  const contextKeys = Object.keys(input.renderContext).sort()
  for (const key of contextKeys) {
    if (!variables.has(key)) renderValidationError()
    const value = input.renderContext[key]
    if (typeof value !== "string") renderValidationError()
    assertSafeRenderedValue(value, MAX_BODY_LENGTH)
  }

  const usedTokens = [
    ...templateTokens(input.template.titleTemplate),
    ...templateTokens(input.template.bodyTemplate),
  ]
  if (usedTokens.some((token) => !tokens.has(token))) renderValidationError()
  if (usedTokens.some((token) => {
    const key = tokens.get(token)
    return !key || typeof input.renderContext[key] !== "string"
  })) renderValidationError()

  const replace = (template: string) => template.replace(TOKEN_PATTERN, (_match, token: string) => {
    const key = tokens.get(token)
    if (!key) renderValidationError()
    const value = input.renderContext[key]
    if (typeof value !== "string") renderValidationError()
    return value
  })
  const renderedTitle = replace(input.template.titleTemplate)
  const renderedBody = replace(input.template.bodyTemplate)
  assertSafeRenderedValue(renderedTitle, MAX_TITLE_LENGTH)
  assertSafeRenderedValue(renderedBody, MAX_BODY_LENGTH)

  return {
    renderedTitle,
    renderedBody,
    href: validateDeepLink(input.workflowKey, input.href),
  }
}

function countsForRpc(counts: NotificationWorkerCounts) {
  return {
    fanout: counts.fanout,
    rule_reconciliation: counts.ruleReconciliation,
    target_reconciliation: counts.targetReconciliation,
    deliveries: counts.deliveries,
    reaped: counts.reaped,
  }
}

function normalizeWorkerErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const candidate = String(error.code || "").toLowerCase()
    if (SAFE_CODE_PATTERN.test(candidate)) return candidate
  }
  return "notification_worker_run_failed"
}

function validateClaimBase(job: JsonRecord) {
  requiredUuid(job.job_id)
  requiredUuid(job.claim_token)
  requiredWorkflowKey(job.workflow_key)
}

function validateFanoutCursor(job: JsonRecord) {
  if (typeof job.last_rule !== "boolean") workerEnvelopeError()
  if (
    (job.cursor !== null && job.cursor !== undefined && typeof job.cursor !== "string") ||
    (job.next_cursor !== null && job.next_cursor !== undefined && typeof job.next_cursor !== "string")
  ) {
    workerEnvelopeError()
  }
  const cursor = nullableString(job.cursor)
  const nextCursor = nullableString(job.next_cursor)
  if (
    (cursor !== null && !/^\d+$/.test(cursor)) ||
    (nextCursor !== null && !/^\d+$/.test(nextCursor)) ||
    (job.last_rule && nextCursor !== null) ||
    (!job.last_rule && nextCursor === null) ||
    (nextCursor !== null && Number(nextCursor) !== Number(cursor ?? "0") + 1)
  ) {
    workerEnvelopeError()
  }
  return { cursor, nextCursor, lastRule: job.last_rule }
}

function validateRuleRevisionMap(value: unknown) {
  if (!isPlainRecord(value)) workerEnvelopeError()
  for (const [ruleId, revision] of Object.entries(value)) {
    requiredUuid(ruleId)
    positiveDecimalString(revision)
  }
}

function validateTargetReconciliationClaim(job: JsonRecord) {
  requiredString(job.source_type)
  requiredString(job.source_id)
  optionalRevision(job.source_revision)
  requiredUuid(job.source_event_id)
  if (job.reconciliation_kind !== "recipient_set_changed") workerEnvelopeError()
  positiveDecimalString(job.target_generation)
  requiredString(job.current_target_set_hash)
  if (job.previous_target_set_hash !== null && job.previous_target_set_hash !== undefined) {
    requiredString(job.previous_target_set_hash)
  }
  const cursor = nullableString(job.cursor)
  if (cursor !== null && cursor.length > 512) workerEnvelopeError()
}

function validateDeliveryClaim(claim: JsonRecord) {
  requiredUuid(claim.delivery_id)
  requiredUuid(claim.claim_token)
  requiredUuid(claim.event_id)
  requiredWorkflowKey(claim.workflow_key)
  requiredString(claim.event_key)
  requiredString(claim.source_type)
  requiredString(claim.source_id)
  optionalRevision(claim.source_revision)
  requiredUuid(claim.rule_id)
  positiveDecimalString(claim.rule_revision)
  decimalString(claim.target_generation)
  requiredString(claim.scheduled_for)
  if (!["in_app", "web_push", "google_chat", "customer_message"].includes(requiredString(claim.channel_key))) {
    workerEnvelopeError()
  }
  targetFromClaim(claim.target)
}

function targetFromClaim(value: unknown): NotificationTarget {
  if (!isPlainRecord(value)) workerEnvelopeError()
  const target = value
  const targetKind = requiredString(target.target_kind)
  const allowedKinds: NotificationTarget["targetKind"][] = [
    "profile",
    "connection",
    "push_subscription",
    "customer_endpoint",
    "audience",
  ]
  if (!allowedKinds.includes(targetKind as NotificationTarget["targetKind"])) workerEnvelopeError()
  const targetProfileId = nullableString(target.target_profile_id)
  if (target.target_profile_id !== null && target.target_profile_id !== undefined && !targetProfileId) {
    workerEnvelopeError()
  }
  if (target.connection_key !== null && target.connection_key !== undefined && typeof target.connection_key !== "string") {
    workerEnvelopeError()
  }
  if (targetProfileId && !UUID_PATTERN.test(targetProfileId)) workerEnvelopeError()
  if (!isPlainRecord(target.target_snapshot)) workerEnvelopeError()
  return {
    targetKind: targetKind as NotificationTarget["targetKind"],
    targetKey: requiredString(target.target_key),
    targetProfileId,
    connectionKey: nullableString(target.connection_key),
    targetSnapshot: target.target_snapshot,
  }
}

function ruleFromClaim(job: JsonRecord): NotificationRuleSnapshot {
  const rule = asRecord(job.rule)
  const channelKey = requiredString(job.channel_key || rule.channel_key)
  if (!["in_app", "web_push", "google_chat", "customer_message"].includes(channelKey)) {
    workerEnvelopeError()
  }
  return {
    ruleId: requiredUuid(job.rule_id || rule.rule_id),
    ruleRevision: positiveDecimalString(job.rule_revision || rule.rule_revision),
    templateId: requiredUuid(job.template_id || rule.template_id),
    audienceKey: requiredString(job.audience_key || rule.audience_key),
    channelKey: channelKey as NotificationChannelKey,
    connectionKey: nullableString(job.connection_key || rule.connection_key),
    ruleVariantKey: requiredString(job.rule_variant_key || rule.rule_variant_key),
  }
}

function templateFromClaim(job: JsonRecord): NotificationTemplateSnapshot {
  const template = asRecord(job.template)
  const allowedVariables = Array.isArray(job.allowed_variables)
    ? job.allowed_variables
    : Array.isArray(template.allowed_variables)
      ? template.allowed_variables
      : workerEnvelopeError()
  if (allowedVariables.some((entry) => !isPlainRecord(entry))) workerEnvelopeError()
  return {
    titleTemplate: requiredString(job.title_template || template.title_template),
    bodyTemplate: requiredString(job.body_template || template.body_template),
    allowedVariables: allowedVariables
      .map((entry) => ({
          key: requiredString(entry.key),
          token: requiredString(entry.token),
          piiClass: requiredString(entry.pii_class || entry.piiClass),
        })),
    payloadSchemaVersion: requiredPositiveInteger(
      job.template_payload_schema_version || template.payload_schema_version,
    ),
  }
}

function eventFromEnvelope(envelope: JsonRecord) {
  const event = asString(envelope.event_id)
    ? envelope
    : asRecord(envelope.event)
  if (!isPlainRecord(event.payload)) workerEnvelopeError()
  return {
    eventId: requiredUuid(event.event_id),
    workflowKey: requiredWorkflowKey(event.workflow_key || envelope.workflow_key),
    eventKey: requiredString(event.event_key),
    sourceType: requiredString(event.source_type),
    sourceId: requiredString(event.source_id),
    sourceRevision: optionalRevision(event.source_revision),
    payloadSchemaVersion: requiredPositiveInteger(event.payload_schema_version),
    payload: event.payload,
    occurrenceKey: requiredString(event.occurrence_key),
    occurredAt: requiredString(event.occurred_at),
  }
}

function safeOutcomeCount(value: unknown) {
  return Math.min(toCount(value), 1_000_000)
}

function validateApplyOutcome(value: JsonRecord, countKeys: ReadonlyArray<string>) {
  if (value.outcome !== "applied" && value.outcome !== "superseded") workerEnvelopeError()
  for (const key of countKeys) {
    if (!Number.isInteger(Number(value[key])) || Number(value[key]) < 0) workerEnvelopeError()
  }
}

function orchestrationNextAttemptAt(now: Date) {
  return new Date(now.getTime() + 5_000).toISOString()
}

function finishParameters(
  kind: string,
  job: JsonRecord,
  disposition: string,
  errorCode: string | null,
  outcomeSummary: JsonRecord = {},
  nextAttemptAt: string | null = null,
) {
  return {
    p_job_kind: kind,
    p_job_id: asString(job.job_id),
    p_claim_token: asString(job.claim_token),
    p_disposition: disposition,
    p_outcome_summary: outcomeSummary,
    p_error_code: errorCode,
    p_next_attempt_at: nextAttemptAt,
  }
}

async function processFanoutJob(
  job: JsonRecord,
  input: NotificationWorkerRuntimeInput,
) {
  validateClaimBase(job)
  const workflowKey = requiredWorkflowKey(job.workflow_key)
  const adapter = input.getAdapter(workflowKey)
  if (!adapter) {
    await input.rpc("finish_notification_orchestration_job_v1", finishParameters(
      "fanout",
      job,
      "failed",
      "payload_schema_unsupported",
    ))
    return
  }

  try {
    const event = eventFromEnvelope(job)
    const cursorState = validateFanoutCursor(job)
    if (!job.rule_id && !asRecord(job.rule).rule_id) {
      if (job.last_rule !== true) workerEnvelopeError()
      await input.rpc("finish_notification_orchestration_job_v1", finishParameters(
        "fanout",
        job,
        "succeeded",
        null,
        { outcome: "no_rules", delivery_count: 0, done: true },
      ))
      return
    }
    const rule = ruleFromClaim(job)
    const resolveInput = {
      eventId: event.eventId,
      workflowKey,
      eventKey: event.eventKey,
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      sourceRevision: event.sourceRevision,
      payloadSchemaVersion: event.payloadSchemaVersion,
      payload: event.payload,
      rule,
      scheduledFor: requiredString(job.scheduled_for),
    }
    const targetSet = await adapter.resolveTargets(resolveInput)
    const template = templateFromClaim(job)
    const computedTargetSetHash = hashNotificationTargets(targetSet.targets)
    if (targetSet.targetSetHash !== computedTargetSetHash) renderValidationError()
    const renderedTargets = []
    for (const target of targetSet.targets) {
      const renderInput = {
        ...resolveInput,
        targetGeneration: targetSet.targetGeneration,
        target,
      }
      const [renderContext, href] = await Promise.all([
        adapter.buildRenderContext(renderInput),
        adapter.buildDeepLink(renderInput),
      ])
      const rendered = renderNotificationSnapshot({
        workflowKey: adapter.workflowKey,
        payloadSchemaVersion: resolveInput.payloadSchemaVersion,
        template,
        renderContext,
        href,
      })
      renderedTargets.push({
        template_id: rule.templateId,
        target_kind: target.targetKind,
        target_key: target.targetKey,
        target_profile_id: target.targetProfileId,
        connection_key: target.connectionKey,
        target_snapshot: target.targetSnapshot,
        rendered_title: rendered.renderedTitle,
        rendered_body: rendered.renderedBody,
        href: rendered.href,
        scheduled_for: resolveInput.scheduledFor,
      })
    }
    const expectedCursor = cursorState.cursor
    const nextCursor = cursorState.nextCursor
    const lastRule = cursorState.lastRule
    const applied = asRecord(await input.rpc(
      "apply_notification_fanout_batch_v1",
      {
        p_job_id: asString(job.job_id),
        p_claim_token: asString(job.claim_token),
        p_expected_cursor: expectedCursor,
        p_rule_id: rule.ruleId,
        p_rule_revision: rule.ruleRevision,
        p_target_generation: decimalString(targetSet.targetGeneration),
        p_target_set_hash: computedTargetSetHash,
        p_batch: { deliveries: renderedTargets },
        p_next_cursor: nextCursor,
        p_done: lastRule,
      },
    ))
    validateApplyOutcome(applied, ["delivery_count"])
    const superseded = applied.outcome === "superseded"
    const completed = lastRule
    const now = (input.now || (() => new Date()))()
    await input.rpc("finish_notification_orchestration_job_v1", finishParameters(
      "fanout",
      job,
      completed ? "succeeded" : "retry",
      null,
      {
        outcome: superseded ? "superseded" : "applied",
        delivery_count: safeOutcomeCount(applied.delivery_count ?? renderedTargets.length),
        done: completed,
      },
      completed ? null : orchestrationNextAttemptAt(now),
    ))
  } catch (error) {
    if (normalizeWorkerErrorCode(error) === "worker_envelope_invalid") throw error
    await input.rpc("finish_notification_orchestration_job_v1", finishParameters(
      "fanout",
      job,
      "failed",
      normalizeWorkerErrorCode(error) === "render_validation_failed"
        ? "render_validation_failed"
        : "payload_schema_unsupported",
    ))
  }
}

function ruleReconciliationInput(job: JsonRecord, batchSize: number) {
  const revisionMap = asRecord(job.rule_revision_map)
  return {
    jobId: asString(job.job_id),
    claimToken: asString(job.claim_token),
    workflowKey: asString(job.workflow_key) as NotificationWorkflowKey,
    ruleRevisionMap: Object.fromEntries(Object.entries(revisionMap).map(([ruleId, revision]) => (
      [ruleId, decimalString(revision)]
    ))),
    cursor: nullableString(job.cursor),
    batchSize,
  }
}

function targetReconciliationInput(job: JsonRecord, batchSize: number) {
  return {
    jobId: asString(job.job_id),
    claimToken: asString(job.claim_token),
    workflowKey: asString(job.workflow_key) as NotificationWorkflowKey,
    sourceType: asString(job.source_type),
    sourceId: asString(job.source_id),
    sourceRevision: nullableString(job.source_revision),
    sourceEventId: asString(job.source_event_id),
    reconciliationKind: "recipient_set_changed" as const,
    targetGeneration: decimalString(job.target_generation),
    previousTargetSetHash: asString(job.previous_target_set_hash),
    currentTargetSetHash: asString(job.current_target_set_hash),
    cursor: nullableString(job.cursor),
    batchSize,
  }
}

async function finishReconciliation(
  kind: "rule_reconciliation" | "target_reconciliation",
  job: JsonRecord,
  applyResult: JsonRecord,
  batchDone: boolean,
  summary: JsonRecord,
  input: NotificationWorkerRuntimeInput,
) {
  const superseded = applyResult.outcome === "superseded"
  const completed = superseded || batchDone
  await input.rpc("finish_notification_orchestration_job_v1", finishParameters(
    kind,
    job,
    completed ? "succeeded" : "retry",
    null,
    {
      outcome: superseded ? "superseded" : "applied",
      ...summary,
      done: completed,
    },
    completed ? null : orchestrationNextAttemptAt((input.now || (() => new Date()))()),
  ))
}

function ruleBatchForRpc(batch: RuleReconciliationBatch) {
  return {
    sources: batch.sources.map((source) => ({
      source_type: source.sourceType,
      source_id: source.sourceId,
      source_revision: source.sourceRevision,
    })),
    occurrences: batch.occurrences.map((occurrence) => ({
      event_key: occurrence.eventKey,
      source_type: occurrence.sourceType,
      source_id: occurrence.sourceId,
      source_revision: occurrence.sourceRevision,
      occurrence_key: occurrence.occurrenceKey,
      occurred_at: occurrence.occurredAt,
      payload_schema_version: occurrence.payloadSchemaVersion,
      payload: occurrence.payload,
      materialized_rule_id: occurrence.materializedRuleId,
      materialized_rule_revision: occurrence.materializedRuleRevision,
      scheduled_for: occurrence.scheduledFor,
    })),
  }
}

async function renderTargetReconciliationBatch(
  job: JsonRecord,
  batch: TargetReconciliationBatch,
  adapter: NotificationWorkflowAdapter,
  rpc: NotificationRpc,
) {
  const expectedGeneration = decimalString(job.target_generation)
  const expectedHash = asString(job.current_target_set_hash)
  const deliveries: JsonRecord[] = []
  for (const item of batch.items) {
    if (
      item.targetSet.targetGeneration !== expectedGeneration ||
      item.targetSet.targetSetHash !== expectedHash ||
      hashNotificationTargets(item.targetSet.targets) !== expectedHash
    ) {
      renderValidationError()
    }
    const snapshot = asRecord(await rpc(
      "get_notification_render_snapshot_v1",
      {
        p_event_id: item.eventId,
        p_rule_id: item.rule.ruleId,
        p_rule_revision: item.rule.ruleRevision,
      },
    ))
    const event = eventFromEnvelope(snapshot)
    const storedRule = ruleFromClaim(snapshot)
    const template = templateFromClaim(snapshot)
    if (
      event.eventId !== item.eventId ||
      event.workflowKey !== requiredWorkflowKey(job.workflow_key) ||
      storedRule.ruleId !== item.rule.ruleId ||
      storedRule.ruleRevision !== item.rule.ruleRevision ||
      storedRule.templateId !== item.rule.templateId
    ) {
      renderValidationError()
    }
    for (const target of item.targetSet.targets) {
      const renderInput = {
        eventId: event.eventId,
        workflowKey: asString(job.workflow_key) as NotificationWorkflowKey,
        eventKey: event.eventKey,
        sourceType: event.sourceType,
        sourceId: event.sourceId,
        sourceRevision: event.sourceRevision,
        payloadSchemaVersion: event.payloadSchemaVersion,
        payload: event.payload,
        rule: storedRule,
        targetGeneration: item.targetSet.targetGeneration,
        target,
        scheduledFor: item.scheduledFor,
      }
      const [renderContext, href] = await Promise.all([
        adapter.buildRenderContext(renderInput),
        adapter.buildDeepLink(renderInput),
      ])
      const rendered = renderNotificationSnapshot({
        workflowKey: adapter.workflowKey,
        payloadSchemaVersion: event.payloadSchemaVersion,
        template,
        renderContext,
        href,
      })
      deliveries.push({
        event_id: event.eventId,
        rule_id: storedRule.ruleId,
        rule_revision: storedRule.ruleRevision,
        template_id: storedRule.templateId,
        target_kind: target.targetKind,
        target_key: target.targetKey,
        target_profile_id: target.targetProfileId,
        connection_key: target.connectionKey,
        target_snapshot: target.targetSnapshot,
        rendered_title: rendered.renderedTitle,
        rendered_body: rendered.renderedBody,
        href: rendered.href,
        scheduled_for: item.scheduledFor,
      })
    }
  }
  return {
    target_generation: expectedGeneration,
    target_set_hash: expectedHash,
    deliveries,
  }
}

async function processReconciliationJob(
  kind: "rule_reconciliation" | "target_reconciliation",
  job: JsonRecord,
  input: NotificationWorkerRuntimeInput,
  batchSize: number,
) {
  validateClaimBase(job)
  const adapter = input.getAdapter(requiredWorkflowKey(job.workflow_key))
  const reconcile = kind === "rule_reconciliation"
    ? adapter?.reconcileScheduledRules
    : adapter?.reconcileTargets
  if (!adapter || !reconcile) {
    await input.rpc("finish_notification_orchestration_job_v1", finishParameters(
      kind,
      job,
      "failed",
      "reconciler_missing",
    ))
    return
  }

  if (kind === "rule_reconciliation") {
    validateRuleRevisionMap(job.rule_revision_map)
    const batch = await adapter.reconcileScheduledRules!(ruleReconciliationInput(job, batchSize))
    const applyResult = asRecord(await input.rpc(
      "apply_notification_rule_reconciliation_batch_v1",
      {
        p_job_id: asString(job.job_id),
        p_claim_token: asString(job.claim_token),
        p_expected_cursor: nullableString(job.cursor),
        p_batch: ruleBatchForRpc(batch),
        p_next_cursor: batch.nextCursor,
        p_done: batch.done,
      },
    ))
    validateApplyOutcome(applyResult, ["processed_count", "canceled_count", "regenerated_count"])
    await finishReconciliation(kind, job, applyResult, batch.done, {
      source_count: safeOutcomeCount(applyResult.processed_count ?? batch.sources.length),
      occurrence_count: safeOutcomeCount(applyResult.regenerated_count ?? batch.occurrences.length),
      canceled_count: safeOutcomeCount(applyResult.canceled_count),
    }, input)
    return
  }

  validateTargetReconciliationClaim(job)
  const batch = await adapter.reconcileTargets!(targetReconciliationInput(job, batchSize))
  const batchForRpc = await renderTargetReconciliationBatch(job, batch, adapter, input.rpc)
  const applyResult = asRecord(await input.rpc(
    "apply_notification_target_reconciliation_batch_v1",
    {
      p_job_id: asString(job.job_id),
      p_claim_token: asString(job.claim_token),
      p_expected_cursor: nullableString(job.cursor),
      p_batch: batchForRpc,
      p_next_cursor: batch.nextCursor,
      p_done: batch.done,
    },
  ))
  validateApplyOutcome(applyResult, ["canceled_count", "delivery_count", "revoked_count"])
  await finishReconciliation(kind, job, applyResult, batch.done, {
    delivery_count: safeOutcomeCount(applyResult.delivery_count ?? batchForRpc.deliveries.length),
    canceled_count: safeOutcomeCount(applyResult.canceled_count),
    revoked_count: safeOutcomeCount(applyResult.revoked_count),
  }, input)
}

function safeRetryAt(now: Date, attemptCount: number) {
  const exponent = Math.min(Math.max(attemptCount, 0), 5)
  const seconds = Math.min(RETRY_MAX_SECONDS, RETRY_MIN_SECONDS * (2 ** exponent))
  return new Date(now.getTime() + seconds * 1_000).toISOString()
}

function normalizeProviderResult(
  providerResult: NotificationProviderResult,
  claim: JsonRecord,
  now: Date,
): NotificationProviderResult {
  const mappings: Readonly<Record<string, Readonly<{
    status: NotificationProviderResult["status"]
    reason: string | null
    errorCode: string | null
    errorSummary: string | null
  }>>> = {
    sent: { status: "sent", reason: null, errorCode: null, errorSummary: null },
    provider_rate_limited: {
      status: "retry_wait",
      reason: "provider_rate_limited",
      errorCode: "provider_rate_limited",
      errorSummary: "provider temporarily rejected the request",
    },
    transient_pre_dispatch_failure: {
      status: "retry_wait",
      reason: "transient_pre_dispatch_failure",
      errorCode: "transient_pre_dispatch_failure",
      errorSummary: "provider temporarily rejected the request",
    },
    provider_definite_rejection: {
      status: "failed",
      reason: "provider_definite_rejection",
      errorCode: "provider_definite_rejection",
      errorSummary: "provider rejected the request",
    },
    connection_missing: {
      status: "failed",
      reason: "connection_missing",
      errorCode: "connection_missing",
      errorSummary: "provider connection unavailable",
    },
    provider_timeout_after_dispatch: {
      status: "delivery_unknown",
      reason: "provider_timeout_after_dispatch",
      errorCode: "provider_timeout",
      errorSummary: "provider result unavailable",
    },
    connection_reset_after_dispatch: {
      status: "delivery_unknown",
      reason: "connection_reset_after_dispatch",
      errorCode: "connection_reset",
      errorSummary: "provider result unavailable",
    },
    provider_ambiguous_response: {
      status: "delivery_unknown",
      reason: "provider_ambiguous_response",
      errorCode: "provider_transport_error",
      errorSummary: "provider result unavailable",
    },
  }
  const mapping = providerResult.status === "sent"
    ? mappings.sent
    : mappings[asString(providerResult.statusReason)] || mappings.provider_ambiguous_response
  const providerMessageId = mapping.status === "sent" &&
    typeof providerResult.providerMessageId === "string" &&
    SAFE_PROVIDER_REFERENCE_PATTERN.test(providerResult.providerMessageId)
    ? providerResult.providerMessageId
    : null
  const providerResponseCode = typeof providerResult.providerResponseCode === "string" &&
    /^\d{3}$/.test(providerResult.providerResponseCode)
    ? providerResult.providerResponseCode
    : null
  return {
    status: mapping.status,
    statusReason: mapping.reason,
    providerMessageId,
    providerResponseCode,
    errorCode: mapping.errorCode,
    errorSummary: mapping.errorSummary,
    nextAttemptAt: mapping.status === "retry_wait"
      ? safeRetryAt(now, toCount(claim.attempt_count))
      : null,
  }
}

async function finalizeDelivery(
  claim: JsonRecord,
  status: NotificationProviderResult["status"] | "canceled",
  statusReason: string | null,
  rpc: NotificationRpc,
  providerResult?: NotificationProviderResult,
) {
  await rpc("finalize_notification_delivery_v1", {
    p_delivery_id: asString(claim.delivery_id),
    p_claim_token: asString(claim.claim_token),
    p_status: status,
    p_status_reason: statusReason,
    p_provider_message_id: providerResult?.providerMessageId ?? null,
    p_provider_response_code: providerResult?.providerResponseCode ?? null,
    p_error_code: providerResult?.errorCode ?? null,
    p_error_summary: providerResult?.errorSummary ?? null,
    p_next_attempt_at: providerResult?.nextAttemptAt ?? null,
  })
}

async function processDelivery(
  claim: JsonRecord,
  input: NotificationWorkerRuntimeInput,
) {
  validateDeliveryClaim(claim)
  const adapter = input.getAdapter(requiredWorkflowKey(claim.workflow_key))
  if (!adapter) {
    await finalizeDelivery(claim, "failed", "payload_schema_unsupported", input.rpc, {
      status: "failed",
      statusReason: "payload_schema_unsupported",
      providerMessageId: null,
      providerResponseCode: null,
      errorCode: "payload_schema_unsupported",
      errorSummary: "workflow adapter unavailable",
      nextAttemptAt: null,
    })
    return
  }

  const revalidation = await adapter.revalidateBeforeSend({
    eventId: asString(claim.event_id),
    deliveryId: asString(claim.delivery_id),
    eventKey: asString(claim.event_key),
    sourceType: asString(claim.source_type),
    sourceId: asString(claim.source_id),
    sourceRevision: nullableString(claim.source_revision),
    ruleId: asString(claim.rule_id),
    ruleRevision: decimalString(claim.rule_revision),
    targetGeneration: decimalString(claim.target_generation),
    scheduledFor: asString(claim.scheduled_for),
    target: targetFromClaim(claim.target),
  })
  if (!revalidation.ok) {
    await finalizeDelivery(claim, revalidation.status, revalidation.reason, input.rpc)
    return
  }

  if (claim.channel_key === "in_app") {
    await input.rpc("commit_notification_in_app_delivery_v1", {
      p_delivery_id: asString(claim.delivery_id),
      p_claim_token: asString(claim.claim_token),
    })
    return
  }

  const begun = asRecord(await input.rpc("begin_notification_delivery_send_v1", {
    p_delivery_id: asString(claim.delivery_id),
    p_claim_token: asString(claim.claim_token),
  }))
  const begunStatus = requiredString(begun.status)
  if (begunStatus !== "sending") {
    if (
      !["failed", "canceled", "skipped"].includes(begunStatus) ||
      typeof begun.status_reason !== "string" || !begun.status_reason
    ) {
      workerEnvelopeError()
    }
    return
  }
  if (
    requiredUuid(begun.delivery_id) !== claim.delivery_id ||
    requiredUuid(begun.claim_token) !== claim.claim_token ||
    !requiredUuid(begun.dispatch_token) ||
    !["google_chat", "web_push"].includes(requiredString(begun.channel_key)) ||
    typeof begun.rendered_title !== "string" ||
    typeof begun.rendered_body !== "string"
  ) {
    workerEnvelopeError()
  }

  const begunChannel = asString(begun.channel_key)
  const provider = input.getProvider(begunChannel)
  if (!provider) {
    await finalizeDelivery(claim, "failed", "connection_missing", input.rpc, {
      status: "failed",
      statusReason: "connection_missing",
      providerMessageId: null,
      providerResponseCode: null,
      errorCode: "connection_missing",
      errorSummary: "provider connection unavailable",
      nextAttemptAt: null,
    })
    return
  }

  let rawResult: NotificationProviderResult
  try {
    rawResult = await provider.send(begun as NotificationBegunDeliveryContext)
  } catch {
    rawResult = {
      status: "delivery_unknown",
      statusReason: "provider_ambiguous_response",
      providerMessageId: null,
      providerResponseCode: null,
      errorCode: "provider_transport_error",
      errorSummary: "provider result unavailable",
      nextAttemptAt: null,
    }
  }
  const normalized = normalizeProviderResult(rawResult, claim, (input.now || (() => new Date()))())
  await finalizeDelivery(
    claim,
    normalized.status,
    normalized.statusReason,
    input.rpc,
    normalized,
  )
}

function validateBatchInput(input: { workerId: string; batchSize: number; leaseSeconds: number }) {
  if (
    !input ||
    typeof input.workerId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.workerId) ||
    !Number.isInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 100 ||
    !Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 5 || input.leaseSeconds > 600
  ) {
    throw Object.assign(new Error("알림 worker 실행 입력이 유효하지 않습니다."), {
      code: "worker_input_invalid",
    })
  }
}

export function createNotificationWorkerRuntime(input: NotificationWorkerRuntimeInput): NotificationWorker {
  return {
    async runBatch(batchInput) {
      validateBatchInput(batchInput)
      const runId = input.createRunId()
      if (!UUID_PATTERN.test(runId)) {
        throw Object.assign(new Error("알림 worker run ID가 유효하지 않습니다."), {
          code: "worker_run_id_invalid",
        })
      }
      const counts = {
        fanout: 0,
        ruleReconciliation: 0,
        targetReconciliation: 0,
        deliveries: 0,
        reaped: 0,
      }
      const heartbeat = (phase: "started" | "succeeded" | "failed", errorCode: string | null) => (
        input.rpc("record_notification_worker_heartbeat_v1", {
          p_worker_id: batchInput.workerId,
          p_run_id: runId,
          p_phase: phase,
          p_counts: countsForRpc(counts),
          p_error_code: errorCode,
        })
      )

      await heartbeat("started", null)
      try {
        const claimParameters = {
          p_worker_id: batchInput.workerId,
          p_batch_size: batchInput.batchSize,
          p_lease_seconds: batchInput.leaseSeconds,
        }
        const fanoutJobs = toClaimRows(await input.rpc(
          "claim_notification_fanout_jobs_v1",
          claimParameters,
        ))
        for (const job of fanoutJobs) {
          counts.fanout += 1
          await processFanoutJob(job, input)
        }

        const ruleJobs = toClaimRows(await input.rpc(
          "claim_notification_rule_reconciliation_jobs_v1",
          claimParameters,
        ))
        for (const job of ruleJobs) {
          counts.ruleReconciliation += 1
          await processReconciliationJob("rule_reconciliation", job, input, batchInput.batchSize)
        }

        const targetJobs = toClaimRows(await input.rpc(
          "claim_notification_target_reconciliation_jobs_v1",
          claimParameters,
        ))
        for (const job of targetJobs) {
          counts.targetReconciliation += 1
          await processReconciliationJob("target_reconciliation", job, input, batchInput.batchSize)
        }

        const reapedValue = await input.rpc("reap_notification_leases_v1", {
          p_worker_id: batchInput.workerId,
          p_batch_size: batchInput.batchSize,
        })
        if (!isPlainRecord(reapedValue) || !Number.isInteger(Number(reapedValue.reaped_count))) {
          workerEnvelopeError()
        }
        const reaped = reapedValue
        counts.reaped = toCount(reaped.reaped_count)

        const deliveries = toClaimRows(await input.rpc(
          "claim_notification_deliveries_v1",
          claimParameters,
        ))
        for (const delivery of deliveries) {
          counts.deliveries += 1
          await processDelivery(delivery, input)
        }

        await heartbeat("succeeded", null)
        return { ...counts }
      } catch (error) {
        await heartbeat("failed", normalizeWorkerErrorCode(error))
        throw error
      }
    },
  }
}

function isAutomatedTestRuntime() {
  return process.env.NODE_ENV === "test" ||
    typeof process.env.NODE_TEST_CONTEXT === "string" ||
    process.argv.includes("--test") ||
    process.execArgv.includes("--test")
}

function environmentValue(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return ""
}

async function createProductionWorkerRuntime(
  getAdapter: (workflowKey: string) => NotificationWorkflowAdapter | null,
) {
  if (isAutomatedTestRuntime()) {
    throw Object.assign(new Error("자동 테스트에서는 production 알림 provider를 구성할 수 없습니다."), {
      code: "production_provider_forbidden_in_test",
    })
  }

  const supabaseUrl = environmentValue("NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL")
  const serviceRoleKey = environmentValue("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) {
    throw Object.assign(new Error("알림 worker 서비스 구성이 없습니다."), {
      code: "worker_service_configuration_missing",
    })
  }

  const [{ createClient }, webPushModule] = await Promise.all([
    import("@supabase/supabase-js"),
    import("web-push"),
  ])
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const googleChatProvider = createGoogleChatProvider({
    fetch: globalThis.fetch.bind(globalThis),
  })
  const publicVapidKey = environmentValue(
    "NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY",
    "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  )
  const privateVapidKey = environmentValue("WEB_PUSH_PRIVATE_KEY", "VAPID_PRIVATE_KEY")
  const vapidContact = environmentValue("WEB_PUSH_CONTACT")
  const webPush = webPushModule.default
  const webPushProvider = publicVapidKey && privateVapidKey && vapidContact
    ? (() => {
        webPush.setVapidDetails(vapidContact, publicVapidKey, privateVapidKey)
        return createWebPushProvider({
          sendNotification: (subscription, payload) => webPush.sendNotification(subscription, payload),
        })
      })()
    : null

  return createNotificationWorkerRuntime({
    getAdapter,
    async rpc(name, parameters) {
      const { data, error } = await serviceClient.rpc(name, parameters)
      if (error) {
        throw Object.assign(new Error("알림 worker RPC가 실패했습니다."), {
          code: "notification_rpc_failed",
        })
      }
      return data
    },
    getProvider(channelKey) {
      if (channelKey === "google_chat") {
        return googleChatProvider as unknown as NotificationProvider
      }
      if (channelKey === "web_push") {
        return webPushProvider as unknown as NotificationProvider | null
      }
      return null
    },
    createRunId: randomUUID,
  })
}

export function createNotificationWorker(input: {
  getAdapter: (workflowKey: string) => NotificationWorkflowAdapter | null
}): NotificationWorker {
  let productionRuntime: Promise<NotificationWorker> | null = null
  return {
    async runBatch(batchInput) {
      productionRuntime ||= createProductionWorkerRuntime(input.getAdapter)
      return (await productionRuntime).runBatch(batchInput)
    },
  }
}
