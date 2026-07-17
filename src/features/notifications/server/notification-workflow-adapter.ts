import type {
  NotificationChannelKey,
  NotificationWorkflowKey,
} from "../notification-control-plane-types.ts"

export type DbBigInt = string

export type NotificationTarget = Readonly<{
  targetKind: "profile" | "connection" | "push_subscription" | "customer_endpoint" | "audience"
  targetKey: string
  targetProfileId: string | null
  connectionKey: string | null
  targetSnapshot: Readonly<Record<string, unknown>>
}>

export type NotificationTargetSet = Readonly<{
  targetGeneration: DbBigInt
  targetSetHash: string
  targets: ReadonlyArray<NotificationTarget>
}>

export type NotificationRuleSnapshot = Readonly<{
  ruleId: string
  ruleRevision: DbBigInt
  templateId: string
  audienceKey: string
  channelKey: NotificationChannelKey
  connectionKey?: string | null
  ruleVariantKey: string
}>

export type NotificationResolveInput = Readonly<{
  eventId: string
  workflowKey: NotificationWorkflowKey
  eventKey: string
  sourceType: string
  sourceId: string
  sourceRevision: DbBigInt | null
  payloadSchemaVersion: number
  payload: Readonly<Record<string, unknown>>
  rule: NotificationRuleSnapshot
  scheduledFor: string
}>

export type NotificationRenderInput = Readonly<{
  eventId: string
  workflowKey: NotificationWorkflowKey
  eventKey: string
  sourceType: string
  sourceId: string
  sourceRevision: DbBigInt | null
  payloadSchemaVersion: number
  payload: Readonly<Record<string, unknown>>
  rule: NotificationRuleSnapshot
  targetGeneration: DbBigInt
  target: NotificationTarget
  scheduledFor: string
}>

export type NotificationRenderContext = Readonly<Record<string, string>>

export type NotificationRevalidationInput = Readonly<{
  eventId: string
  deliveryId: string
  eventKey: string
  sourceType: string
  sourceId: string
  sourceRevision: DbBigInt | null
  ruleId: string
  ruleRevision: DbBigInt
  targetGeneration: DbBigInt
  scheduledFor: string
  target: NotificationTarget
}>

export type NotificationRevalidationResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false
      status: "canceled"
      reason:
        | "source_status_changed"
        | "source_schedule_changed"
        | "source_revision_changed"
        | "rule_revision_changed"
        | "recipient_revoked"
    }>
  | Readonly<{
      ok: false
      status: "failed"
      reason:
        | "retry_window_closed"
        | "schedule_validation_failed"
        | "payload_schema_unsupported"
        | "render_validation_failed"
    }>

export type ScheduledOccurrenceDraft = Readonly<{
  eventKey: string
  sourceType: string
  sourceId: string
  sourceRevision: DbBigInt | null
  occurrenceKey: string
  occurredAt: string
  payloadSchemaVersion: number
  payload: Readonly<Record<string, unknown>>
  materializedRuleId: string
  materializedRuleRevision: DbBigInt
  scheduledFor: string
}>

export type RuleReconciliationInput = Readonly<{
  jobId: string
  claimToken: string
  workflowKey: NotificationWorkflowKey
  ruleRevisionMap: Readonly<Record<string, DbBigInt>>
  cursor: string | null
  batchSize: number
}>

export type RuleReconciliationBatch = Readonly<{
  sources: ReadonlyArray<Readonly<{
    sourceType: string
    sourceId: string
    sourceRevision: DbBigInt | null
  }>>
  occurrences: ReadonlyArray<ScheduledOccurrenceDraft>
  nextCursor: string | null
  done: boolean
}>

export type TargetReconciliationInput = Readonly<{
  jobId: string
  claimToken: string
  sourceEventId: string
  workflowKey: NotificationWorkflowKey
  sourceType: string
  sourceId: string
  sourceRevision: DbBigInt | null
  reconciliationKind: "recipient_set_changed"
  targetGeneration: DbBigInt
  previousTargetSetHash: string
  currentTargetSetHash: string
  cursor: string | null
  batchSize: number
}>

export type TargetReconciliationBatch = Readonly<{
  sourceRevision: DbBigInt | null
  targetGeneration: DbBigInt
  targetSetHash: string
  items: ReadonlyArray<Readonly<{
    eventId: string
    rule: NotificationRuleSnapshot
    scheduledFor: string
    targetSet: NotificationTargetSet
  }>>
  nextCursor: string | null
  done: boolean
}>

export interface NotificationWorkflowAdapter {
  workflowKey: NotificationWorkflowKey
  resolveTargets(input: NotificationResolveInput): Promise<NotificationTargetSet>
  buildRenderContext(input: NotificationRenderInput): Promise<NotificationRenderContext>
  buildDeepLink(input: NotificationRenderInput): Promise<string | null>
  revalidateBeforeSend(input: NotificationRevalidationInput): Promise<NotificationRevalidationResult>
  reconcileScheduledRules?(input: RuleReconciliationInput): Promise<RuleReconciliationBatch>
  reconcileTargets?(input: TargetReconciliationInput): Promise<TargetReconciliationBatch>
}
