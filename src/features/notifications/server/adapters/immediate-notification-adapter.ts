import { createHash } from "node:crypto"

import {
  NOTIFICATION_CONNECTION_KEYS,
  type NotificationConnectionKey,
  type NotificationDestinationTeam,
  type NotificationEditableChannelKey,
  type NotificationWorkflowKey,
} from "../../notification-control-plane-types.ts"
import type {
  NotificationRenderContext,
  NotificationRenderInput,
  NotificationResolveInput,
  NotificationRevalidationInput,
  NotificationRevalidationResult,
  NotificationTarget,
  NotificationTargetSet,
  NotificationWorkflowAdapter,
} from "../notification-workflow-adapter.ts"
import type { NotificationPresentationBuilder } from "../presentation/notification-presentation.ts"
import { immediateNotificationProductionDependencies } from "./immediate-notification-source-reader.ts"

type ImmediateNotificationAdapterConfig = Readonly<{
  workflowKey: NotificationWorkflowKey
  sourceTypes: ReadonlyArray<string>
  linkRoot: string
  linkPayloadKey: string
  linkQueryKey: string
  deepLinkBuilder?: (input: NotificationRenderInput) => string | null
  audienceProfileFields: Readonly<Record<string, ReadonlyArray<string>>>
  workflowLabel?: string
  eventLabels: Readonly<Record<string, string>>
  renderFields: Readonly<Record<string, ReadonlyArray<string>>>
  presentationBuilder?: NotificationPresentationBuilder
}>

export type ImmediateNotificationAuthoritativeRevalidationInput = NotificationRevalidationInput & Readonly<{
  workflowKey: NotificationWorkflowKey
}>

export type ImmediateNotificationAdapterDependencies = Readonly<{
  revalidateAuthoritativeSource(
    input: ImmediateNotificationAuthoritativeRevalidationInput,
  ): Promise<NotificationRevalidationResult>
}>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONNECTION_KEY_SET = new Set<string>(NOTIFICATION_CONNECTION_KEYS)
const DESTINATION_TEAM_BY_CONNECTION: Readonly<Record<NotificationConnectionKey, NotificationDestinationTeam>> =
  Object.freeze({
    "google_chat.management": "management",
    "google_chat.executive": "executive",
    "google_chat.english": "english",
    "google_chat.math": "math",
    "google_chat.science": "science",
  })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (!isRecord(value)) throw new Error("notification_payload_schema_unsupported")
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
}

export function hashImmediateNotificationTargets(targets: ReadonlyArray<NotificationTarget>) {
  const serializedTargets = targets.map(canonicalJson).sort()
  return createHash("sha256").update(`[${serializedTargets.join(",")}]`, "utf8").digest("hex")
}

function collectProfileIds(payload: Readonly<Record<string, unknown>>, fields: ReadonlyArray<string>) {
  const ids = new Set<string>()
  for (const field of fields) {
    const value = payload[field]
    const values = Array.isArray(value) ? value : [value]
    for (const candidate of values) {
      if (typeof candidate === "string" && UUID_PATTERN.test(candidate)) ids.add(candidate.toLowerCase())
    }
  }
  return [...ids].sort()
}

function subjectConnectionKey(payload: Readonly<Record<string, unknown>>) {
  if (typeof payload.approval_group !== "string") {
    throw new Error("notification_payload_schema_unsupported")
  }
  const value = payload.approval_group.trim()
  if (value === "math_middle" || value === "math_high") {
    return "google_chat.math"
  }
  if (value === "english") return "google_chat.english"
  if (value === "과학" || value === "science") return "google_chat.science"
  if (value === "unknown") return null
  throw new Error("notification_payload_schema_unsupported")
}

function connectionKeyFor(input: NotificationResolveInput) {
  const configured = String(input.rule.connectionKey || "").trim()
  const expected = input.rule.audienceKey === "subject_team"
    ? subjectConnectionKey(input.payload)
    : input.rule.audienceKey === "management_team"
      ? "google_chat.management"
      : input.rule.audienceKey === "executive_team"
        ? "google_chat.executive"
        : null
  if (configured && configured !== expected) {
    throw new Error("notification_payload_schema_unsupported")
  }
  return expected
}

function audienceTarget(audienceKey: string): NotificationTarget {
  return {
    targetKind: "audience",
    targetKey: `audience:${audienceKey}`,
    targetProfileId: null,
    connectionKey: null,
    targetSnapshot: Object.freeze({ audience_key: audienceKey }),
  }
}

function resolveImmediateTargets(
  config: ImmediateNotificationAdapterConfig,
  input: NotificationResolveInput,
): NotificationTargetSet {
  if (
    input.workflowKey !== config.workflowKey
    || input.payloadSchemaVersion !== 1
    || input.sourceRevision !== null
    || !config.sourceTypes.includes(input.sourceType)
    || !isRecord(input.payload)
  ) {
    throw new Error("notification_payload_schema_unsupported")
  }
  if (!Object.prototype.hasOwnProperty.call(config.audienceProfileFields, input.rule.audienceKey)) {
    throw new Error("notification_payload_schema_unsupported")
  }

  let targets: NotificationTarget[] = []
  if (input.rule.channelKey === "google_chat") {
    const connectionKey = connectionKeyFor(input)
    if (connectionKey) {
      targets = [{
        targetKind: "connection",
        targetKey: `connection:${connectionKey}`,
        targetProfileId: null,
        connectionKey,
        targetSnapshot: Object.freeze({ connection_key: connectionKey }),
      }]
    }
  } else if (input.rule.channelKey === "in_app" || input.rule.channelKey === "web_push") {
    const fields = config.audienceProfileFields[input.rule.audienceKey] || []
    targets = collectProfileIds(input.payload, fields).map((profileId) => ({
      targetKind: "profile",
      targetKey: `profile:${profileId}`,
      targetProfileId: profileId,
      connectionKey: null,
      targetSnapshot: Object.freeze({ profile_id: profileId }),
    }))
  } else {
    throw new Error("notification_payload_schema_unsupported")
  }

  if (targets.length === 0) {
    targets = [audienceTarget(input.rule.audienceKey)]
  }

  targets.sort((left, right) => left.targetKey.localeCompare(right.targetKey))
  return Object.freeze({
    targetGeneration: "0",
    targetSetHash: hashImmediateNotificationTargets(targets),
    targets: Object.freeze(targets),
  })
}

function buildImmediateRenderContext(
  config: ImmediateNotificationAdapterConfig,
  input: NotificationRenderInput,
): NotificationRenderContext {
  const eventLabel = config.eventLabels[input.eventKey]
  if (
    input.workflowKey !== config.workflowKey
    || !config.sourceTypes.includes(input.sourceType)
    || input.sourceRevision !== null
    || !eventLabel
  ) {
    throw new Error("notification_payload_schema_unsupported")
  }
  const context: Record<string, string> = {}
  for (const [contextKey, payloadKeys] of Object.entries(config.renderFields)) {
    for (const payloadKey of payloadKeys) {
      const value = input.payload[payloadKey]
      if (typeof value !== "string" || !value.trim()) continue
      context[contextKey] = value.trim()
      break
    }
  }
  if (config.workflowLabel) {
    context.workflow_label = config.workflowLabel
    context.event_label = eventLabel
    const occurredAt = input.payload.occurred_at
    context.occurred_at = typeof occurredAt === "string" && occurredAt.trim()
      ? occurredAt.trim()
      : input.scheduledFor
    context.deep_link = buildImmediateDeepLink(config, input) ?? config.linkRoot
  }
  if (config.presentationBuilder) {
    const presentation = config.presentationBuilder(presentationInput(input))
    if (!isRecord(presentation)) throw new Error("notification_payload_schema_unsupported")
    for (const [key, value] of Object.entries(presentation)) {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || typeof value !== "string") {
        throw new Error("notification_payload_schema_unsupported")
      }
      if (Object.prototype.hasOwnProperty.call(context, key) && context[key] !== value) {
        throw new Error("notification_payload_schema_unsupported")
      }
      context[key] = value
    }
  }
  return Object.freeze(context)
}

function presentationInput(
  input: NotificationRenderInput,
) {
  const requestedContextKeys = input.requestedContextKeys ?? []
  if (
    !Array.isArray(requestedContextKeys)
    || requestedContextKeys.some((key) => typeof key !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(key))
    || new Set(requestedContextKeys).size !== requestedContextKeys.length
  ) {
    throw new Error("notification_payload_schema_unsupported")
  }
  let contractChannelKey: NotificationEditableChannelKey
  if (input.rule.channelKey === "web_push") contractChannelKey = "in_app"
  else if (input.rule.channelKey === "in_app" || input.rule.channelKey === "google_chat") {
    contractChannelKey = input.rule.channelKey
  } else {
    throw new Error("notification_payload_schema_unsupported")
  }

  let connectionKey: NotificationConnectionKey | null = null
  let destinationTeam: NotificationDestinationTeam | null = null
  if (input.rule.channelKey === "google_chat") {
    if (
      input.target.targetKind !== "connection"
      || !input.target.connectionKey
      || !CONNECTION_KEY_SET.has(input.target.connectionKey)
    ) {
      throw new Error("notification_payload_schema_unsupported")
    }
    connectionKey = input.target.connectionKey as NotificationConnectionKey
    destinationTeam = DESTINATION_TEAM_BY_CONNECTION[connectionKey]
  } else if (input.target.connectionKey !== null) {
    throw new Error("notification_payload_schema_unsupported")
  }

  return Object.freeze({
    workflowKey: input.workflowKey,
    eventKey: input.eventKey,
    ruleVariantKey: input.rule.ruleVariantKey,
    payloadSchemaVersion: input.payloadSchemaVersion,
    payload: input.payload,
    audienceKey: input.rule.audienceKey,
    channelKey: input.rule.channelKey,
    contractIdentity: Object.freeze({
      workflowKey: input.workflowKey,
      eventKey: input.eventKey,
      audienceKey: input.rule.audienceKey,
      channelKey: contractChannelKey,
      ruleVariantKey: input.rule.ruleVariantKey,
    }),
    requestedContextKeys: Object.freeze([...requestedContextKeys]),
    connectionKey,
    destinationTeam,
    scheduledFor: input.scheduledFor,
  })
}

function buildImmediateDeepLink(config: ImmediateNotificationAdapterConfig, input: NotificationRenderInput) {
  if (input.sourceRevision !== null) throw new Error("notification_payload_schema_unsupported")
  if (input.workflowKey !== config.workflowKey || !config.sourceTypes.includes(input.sourceType)) return null
  if (config.deepLinkBuilder) return config.deepLinkBuilder(input)
  const entityId = input.payload[config.linkPayloadKey]
  if (typeof entityId !== "string" || !UUID_PATTERN.test(entityId)) return config.linkRoot
  const query = new URLSearchParams()
  query.set(config.linkQueryKey, entityId)
  return `${config.linkRoot}?${query.toString()}`
}

async function revalidateImmediate(
  config: ImmediateNotificationAdapterConfig,
  dependencies: ImmediateNotificationAdapterDependencies,
  input: NotificationRevalidationInput,
): Promise<NotificationRevalidationResult> {
  if (!config.sourceTypes.includes(input.sourceType)) {
    return { ok: false, status: "failed", reason: "payload_schema_unsupported" }
  }
  if (input.sourceRevision !== null) {
    return { ok: false, status: "failed", reason: "payload_schema_unsupported" }
  }
  if (input.targetGeneration !== "0") {
    return { ok: false, status: "canceled", reason: "recipient_revoked" }
  }
  if (!Number.isFinite(new Date(input.scheduledFor).getTime())) {
    return { ok: false, status: "failed", reason: "schedule_validation_failed" }
  }
  if (
    input.target.targetKind === "profile"
    && (!input.target.targetProfileId || input.target.targetKey !== `profile:${input.target.targetProfileId}`)
  ) {
    return { ok: false, status: "canceled", reason: "recipient_revoked" }
  }
  if (
    input.target.targetKind === "connection"
    && (!input.target.connectionKey || input.target.targetKey !== `connection:${input.target.connectionKey}`)
  ) {
    return { ok: false, status: "canceled", reason: "recipient_revoked" }
  }
  return dependencies.revalidateAuthoritativeSource({
    workflowKey: config.workflowKey,
    ...input,
  })
}

export function createImmediateNotificationAdapter(
  config: ImmediateNotificationAdapterConfig,
  dependencies: ImmediateNotificationAdapterDependencies = immediateNotificationProductionDependencies,
): NotificationWorkflowAdapter {
  const frozenConfig = Object.freeze({
    ...config,
    sourceTypes: Object.freeze([...config.sourceTypes]),
    eventLabels: Object.freeze({ ...config.eventLabels }),
    renderFields: Object.freeze(Object.fromEntries(
      Object.entries(config.renderFields).map(([key, fields]) => [key, Object.freeze([...fields])]),
    )),
  })
  return Object.freeze({
    workflowKey: frozenConfig.workflowKey,
    async resolveTargets(input: NotificationResolveInput) {
      return resolveImmediateTargets(frozenConfig, input)
    },
    async buildRenderContext(input: NotificationRenderInput) {
      return buildImmediateRenderContext(frozenConfig, input)
    },
    async buildDeepLink(input: NotificationRenderInput) {
      return buildImmediateDeepLink(frozenConfig, input)
    },
    async revalidateBeforeSend(input: NotificationRevalidationInput) {
      return revalidateImmediate(frozenConfig, dependencies, input)
    },
  })
}
