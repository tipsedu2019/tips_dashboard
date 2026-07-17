import type { NotificationWorkflowKey } from "../notification-control-plane-types.ts"
import {
  hashNotificationTargets,
  renderNotificationSnapshot,
} from "./notification-worker.ts"
import type {
  NotificationRuleSnapshot,
  NotificationTarget,
  NotificationWorkflowAdapter,
} from "./notification-workflow-adapter.ts"

type TargetGeneration = string & { readonly __targetGeneration: unique symbol }
type OwnerGeneration = string & { readonly __ownerGeneration: unique symbol }

type LegacyProjectionIdentityInput = Readonly<{
  workflowKey: string
  eventId: string
  ruleId: string
  targetProfileId: string
  targetGeneration: string
  legacyOwnerKey: string
  expectedOwnerGeneration: string
  requestId: string
}>

type ValidatedLegacyProjectionIdentity = Readonly<{
  workflowKey: NotificationWorkflowKey
  eventId: string
  ruleId: string
  targetProfileId: string
  targetGeneration: TargetGeneration
  legacyOwnerKey: string
  expectedOwnerGeneration: OwnerGeneration
  requestId: string
}>

type LegacyProjectionContext = Readonly<{
  event: Readonly<{
    eventId: string
    workflowKey: NotificationWorkflowKey
    eventKey: string
    sourceType: string
    sourceId: string
    sourceRevision: string | null
    payloadSchemaVersion: number
    payload: Readonly<Record<string, unknown>>
    occurrenceKey: string
  }>
  rule: Readonly<{
    ruleId: string
    ruleRevision: string
    templateId: string
    audienceKey: string
    channelKey: "in_app"
    connectionKey?: string | null
    ruleVariantKey: string
  }>
  template: Readonly<{
    titleTemplate: string
    bodyTemplate: string
    allowedVariables: ReadonlyArray<Readonly<{
      key: string
      token: string
      piiClass: string
    }>>
    payloadSchemaVersion: number
  }>
  scheduledFor: string
}>

type LegacyProjectionRepository = Readonly<{
  loadContext(input: ValidatedLegacyProjectionIdentity): Promise<LegacyProjectionContext>
  materializeDelivery(input: Readonly<Record<string, unknown>>): Promise<Readonly<{
    deliveryId: string
  }>>
  beginDispatch(input: Readonly<Record<string, unknown>>): Promise<Readonly<{
    claimId: string
    ownerGeneration: string
    dispatchToken: string
  }>>
  commitProjection(input: Readonly<{
    deliveryId: string
    claimId: string
    ownerGeneration: string
    dispatchToken: string
  }>): Promise<Readonly<{ notificationId: string }>>
}>

const IDENTITY_KEYS = [
  "eventId",
  "expectedOwnerGeneration",
  "legacyOwnerKey",
  "requestId",
  "ruleId",
  "targetGeneration",
  "targetProfileId",
  "workflowKey",
] as const

const WORKFLOW_KEYS = new Set<NotificationWorkflowKey>([
  "tasks",
  "word_retests",
  "registration",
  "transfer",
  "withdrawal",
  "makeup_requests",
  "approvals",
])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)$/
const OWNER_KEY_PATTERN = /^[a-z][a-z0-9_.:-]{0,127}$/

function invalidIdentity(): never {
  throw new Error("legacy in-app identity 입력이 유효하지 않습니다.")
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function validateIdentity(value: unknown): ValidatedLegacyProjectionIdentity {
  if (!isPlainRecord(value)) invalidIdentity()
  const keys = Object.keys(value).sort()
  if (keys.length !== IDENTITY_KEYS.length || keys.some((key, index) => key !== IDENTITY_KEYS[index])) {
    invalidIdentity()
  }

  const workflowKey = value.workflowKey
  if (typeof workflowKey !== "string" || !WORKFLOW_KEYS.has(workflowKey as NotificationWorkflowKey)) {
    invalidIdentity()
  }
  for (const key of ["eventId", "ruleId", "targetProfileId", "requestId"] as const) {
    if (typeof value[key] !== "string" || !UUID_PATTERN.test(value[key])) invalidIdentity()
  }
  if (
    typeof value.targetGeneration !== "string" || !DECIMAL_PATTERN.test(value.targetGeneration) ||
    typeof value.expectedOwnerGeneration !== "string" || !DECIMAL_PATTERN.test(value.expectedOwnerGeneration) ||
    typeof value.legacyOwnerKey !== "string" || !OWNER_KEY_PATTERN.test(value.legacyOwnerKey)
  ) {
    invalidIdentity()
  }

  return {
    workflowKey: workflowKey as NotificationWorkflowKey,
    eventId: value.eventId as string,
    ruleId: value.ruleId as string,
    targetProfileId: value.targetProfileId as string,
    targetGeneration: value.targetGeneration as TargetGeneration,
    legacyOwnerKey: value.legacyOwnerKey,
    expectedOwnerGeneration: value.expectedOwnerGeneration as OwnerGeneration,
    requestId: value.requestId as string,
  }
}

function validateContext(
  identity: ValidatedLegacyProjectionIdentity,
  context: LegacyProjectionContext,
) {
  if (
    !context ||
    context.event.eventId !== identity.eventId ||
    context.event.workflowKey !== identity.workflowKey ||
    context.rule.ruleId !== identity.ruleId ||
    context.rule.channelKey !== "in_app" ||
    context.template.payloadSchemaVersion !== context.event.payloadSchemaVersion
  ) {
    invalidIdentity()
  }
}

function ruleSnapshot(context: LegacyProjectionContext): NotificationRuleSnapshot {
  return {
    ruleId: context.rule.ruleId,
    ruleRevision: context.rule.ruleRevision,
    templateId: context.rule.templateId,
    audienceKey: context.rule.audienceKey,
    channelKey: context.rule.channelKey,
    connectionKey: context.rule.connectionKey ?? null,
    ruleVariantKey: context.rule.ruleVariantKey,
  }
}

function exactProfileTarget(
  targets: ReadonlyArray<NotificationTarget>,
  profileId: string,
) {
  const matches = targets.filter((target) => (
    target.targetKind === "profile" &&
    target.targetProfileId === profileId &&
    target.targetKey === `profile:${profileId}`
  ))
  if (matches.length !== 1) invalidIdentity()
  return matches[0]
}

export function createLegacyInAppProjection(input: Readonly<{
  getAdapter: (workflowKey: string) => NotificationWorkflowAdapter | null
  repository: LegacyProjectionRepository
}>) {
  return {
    async project(untrustedIdentity: LegacyProjectionIdentityInput) {
      const identity = validateIdentity(untrustedIdentity)
      const adapter = input.getAdapter(identity.workflowKey)
      if (!adapter || adapter.workflowKey !== identity.workflowKey) invalidIdentity()

      const context = await input.repository.loadContext(identity)
      validateContext(identity, context)
      const rule = ruleSnapshot(context)
      const resolveInput = {
        eventId: context.event.eventId,
        workflowKey: context.event.workflowKey,
        eventKey: context.event.eventKey,
        sourceType: context.event.sourceType,
        sourceId: context.event.sourceId,
        sourceRevision: context.event.sourceRevision,
        payloadSchemaVersion: context.event.payloadSchemaVersion,
        payload: context.event.payload,
        rule,
        scheduledFor: context.scheduledFor,
      }
      const targetSet = await adapter.resolveTargets(resolveInput)
      if (
        targetSet.targetGeneration !== identity.targetGeneration
        || hashNotificationTargets(targetSet.targets) !== targetSet.targetSetHash
      ) {
        invalidIdentity()
      }
      const target = exactProfileTarget(targetSet.targets, identity.targetProfileId)
      const renderInput = {
        ...resolveInput,
        targetGeneration: identity.targetGeneration,
        target,
      }
      const [renderContext, href] = await Promise.all([
        adapter.buildRenderContext(renderInput),
        adapter.buildDeepLink(renderInput),
      ])
      const rendered = renderNotificationSnapshot({
        workflowKey: identity.workflowKey,
        payloadSchemaVersion: context.event.payloadSchemaVersion,
        template: context.template,
        renderContext,
        href,
      })

      const materialized = await input.repository.materializeDelivery({
        workflowKey: identity.workflowKey,
        eventId: identity.eventId,
        occurrenceKey: context.event.occurrenceKey,
        ruleId: identity.ruleId,
        ruleRevision: context.rule.ruleRevision,
        templateId: context.rule.templateId,
        channelKey: "in_app",
        targetProfileId: identity.targetProfileId,
        targetGeneration: identity.targetGeneration,
        target,
        targetSetHash: targetSet.targetSetHash,
        scheduledFor: context.scheduledFor,
        renderedTitle: rendered.renderedTitle,
        renderedBody: rendered.renderedBody,
        href: rendered.href,
        ownerKind: "legacy",
        legacyOwnerKey: identity.legacyOwnerKey,
        expectedOwnerGeneration: identity.expectedOwnerGeneration,
        requestId: identity.requestId,
      })
      if (!UUID_PATTERN.test(materialized.deliveryId)) invalidIdentity()

      const dispatch = await input.repository.beginDispatch({
        workflowKey: identity.workflowKey,
        occurrenceKey: context.event.occurrenceKey,
        ruleId: identity.ruleId,
        channelKey: "in_app",
        targetKey: target.targetKey,
        targetGeneration: identity.targetGeneration,
        legacyOwnerKey: identity.legacyOwnerKey,
        expectedOwnerGeneration: identity.expectedOwnerGeneration,
        requestId: identity.requestId,
        deliveryId: materialized.deliveryId,
      })
      if (
        !UUID_PATTERN.test(dispatch.claimId) ||
        !UUID_PATTERN.test(dispatch.dispatchToken) ||
        !DECIMAL_PATTERN.test(dispatch.ownerGeneration)
      ) {
        invalidIdentity()
      }

      return input.repository.commitProjection({
        deliveryId: materialized.deliveryId,
        claimId: dispatch.claimId,
        ownerGeneration: dispatch.ownerGeneration,
        dispatchToken: dispatch.dispatchToken,
      })
    },
  }
}
