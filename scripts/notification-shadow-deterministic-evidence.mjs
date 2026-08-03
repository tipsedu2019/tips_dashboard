import {
  normalizedNotificationRenderedHash,
} from "../src/features/notifications/server/legacy-delivery-intent.js"
import { renderNotificationSnapshot } from "../src/features/notifications/server/notification-worker.ts"
import { getNotificationWorkflowAdapter } from "../src/features/notifications/server/notification-workflow-registry.ts"
import { compareNotificationShadowIntents } from "./verify-notification-workflow-cutover.mjs"

const TEMPLATE_CHECKSUM = /^(?:[a-f0-9]{32}|[a-f0-9]{64})$/
const TOKEN_PATTERN = /\{([^{}]+)\}/g
const FETCH_GUARD_KEY = Symbol.for("tips.notificationShadowDeterministicFetchGuard.v1")
const GOOGLE_CHAT_DESTINATIONS = Object.freeze([
  "google_chat.management",
  "google_chat.executive",
  "google_chat.english",
  "google_chat.math",
  "google_chat.science",
])

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null
}

function requiredString(value, code) {
  if (typeof value !== "string" || !value) throw new Error(code)
  return value
}

function templateChecksum(value) {
  const checksum = requiredString(record(value)?.checksum, "notification_shadow_deterministic_plan_invalid")
  if (!TEMPLATE_CHECKSUM.test(checksum)) {
    throw new Error("notification_shadow_deterministic_plan_invalid")
  }
  return checksum
}

function sharedFetchGuard() {
  if (!globalThis[FETCH_GUARD_KEY]) {
    globalThis[FETCH_GUARD_KEY] = {
      depth: 0,
      originalFetch: undefined,
      forbiddenFetch: async () => {
        throw new Error("notification_shadow_deterministic_external_request_forbidden")
      },
    }
  }
  return globalThis[FETCH_GUARD_KEY]
}

async function withExternalRequestsForbidden(callback) {
  const guard = sharedFetchGuard()
  if (guard.depth === 0) guard.originalFetch = globalThis.fetch
  guard.depth += 1
  globalThis.fetch = guard.forbiddenFetch
  try {
    return await callback()
  } finally {
    guard.depth -= 1
    if (guard.depth === 0) {
      globalThis.fetch = guard.originalFetch
      guard.originalFetch = undefined
    } else {
      globalThis.fetch = guard.forbiddenFetch
    }
  }
}

function renderLegacyTemplate(template, context, href) {
  const snapshot = record(template)
  const values = record(context)
  if (!snapshot || !values || !Array.isArray(snapshot.allowedVariables)) {
    throw new Error("notification_shadow_deterministic_plan_invalid")
  }
  const tokenToKey = new Map(snapshot.allowedVariables.map((item) => {
    const variable = record(item)
    return [
      requiredString(variable?.token, "notification_shadow_deterministic_plan_invalid"),
      requiredString(variable?.key, "notification_shadow_deterministic_plan_invalid"),
    ]
  }))
  const render = (source) => requiredString(
    source,
    "notification_shadow_deterministic_plan_invalid",
  ).replace(TOKEN_PATTERN, (_match, token) => {
    const key = tokenToKey.get(token)
    const value = key ? values[key] : null
    if (typeof value !== "string") throw new Error("render_validation_failed")
    return value
  })
  const normalizeBody = (value) => {
    const lines = value.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/g, ""))
    while (lines.length > 0 && lines[0].trim() === "") lines.shift()
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop()
    const normalized = []
    for (const line of lines) {
      if (line.trim() === "" && normalized[normalized.length - 1]?.trim() === "") continue
      normalized.push(line)
    }
    return normalized.join("\n")
  }
  return Object.freeze({
    title: render(snapshot.titleTemplate),
    body: normalizeBody(render(snapshot.bodyTemplate)),
    href: href === null ? null : requiredString(href, "notification_shadow_deterministic_plan_invalid"),
  })
}

function legacyIntents(plan) {
  const fixture = record(plan.fixture)
  const legacy = record(fixture?.legacy)
  if (!legacy || !Array.isArray(legacy.targets) || legacy.targets.length === 0) {
    throw new Error("notification_shadow_deterministic_plan_invalid")
  }
  const rendered = renderLegacyTemplate(legacy.template, legacy.context, legacy.href)
  const checksum = templateChecksum(legacy.template)
  return legacy.targets.map((rawTarget) => {
    const target = record(rawTarget)
    return Object.freeze({
      workflowKey: requiredString(legacy.workflowKey, "notification_shadow_deterministic_plan_invalid"),
      eventKey: requiredString(legacy.eventKey, "notification_shadow_deterministic_plan_invalid"),
      occurrenceKey: requiredString(
        target?.occurrenceKey ?? fixture.occurrenceKey,
        "notification_shadow_deterministic_plan_invalid",
      ),
      audienceKey: requiredString(legacy.audienceKey, "notification_shadow_deterministic_plan_invalid"),
      channelKey: requiredString(legacy.channelKey, "notification_shadow_deterministic_plan_invalid"),
      targetKey: requiredString(target?.targetKey, "notification_shadow_deterministic_plan_invalid"),
      targetGeneration: requiredString(target?.targetGeneration, "notification_shadow_deterministic_plan_invalid"),
      templateChecksum: checksum,
      renderedTitle: rendered.title,
      renderedBody: rendered.body,
      href: rendered.href,
      normalizedRenderedContentHash: normalizedNotificationRenderedHash(rendered),
    })
  })
}

function canonicalSubjectVariants(fixture, canonical) {
  if (fixture.subjectConnectionVariants === undefined) return [null]
  if (
    canonical.rule?.audienceKey !== "subject_team"
    || canonical.rule?.channelKey !== "google_chat"
    || !Array.isArray(fixture.subjectConnectionVariants)
    || fixture.subjectConnectionVariants.length === 0
  ) throw new Error("notification_shadow_deterministic_plan_invalid")
  return fixture.subjectConnectionVariants.map((rawVariant) => {
    const variant = record(rawVariant)
    return Object.freeze({
      approvalGroup: requiredString(
        variant?.approvalGroup,
        "notification_shadow_deterministic_plan_invalid",
      ),
      connectionKey: requiredString(
        variant?.connectionKey,
        "notification_shadow_deterministic_plan_invalid",
      ),
      occurrenceKey: requiredString(
        variant?.occurrenceKey,
        "notification_shadow_deterministic_plan_invalid",
      ),
    })
  })
}

async function canonicalIntents(plan, dependencies) {
  const fixture = record(plan.fixture)
  const canonical = record(fixture?.canonical)
  if (!canonical) throw new Error("notification_shadow_deterministic_plan_invalid")
  const workflowKey = requiredString(canonical.workflowKey, "notification_shadow_deterministic_plan_invalid")
  const adapter = dependencies.getAdapter(workflowKey)
  if (!adapter) throw new Error("notification_shadow_deterministic_adapter_missing")
  const checksum = templateChecksum(canonical.template)
  const intents = []
  for (const variant of canonicalSubjectVariants(fixture, canonical)) {
    const variantInput = variant === null ? canonical : Object.freeze({
      ...canonical,
      payload: Object.freeze({
        ...canonical.payload,
        approval_group: variant.approvalGroup,
      }),
      rule: Object.freeze({
        ...canonical.rule,
        connectionKey: variant.connectionKey,
      }),
    })
    const targetSet = await adapter.resolveTargets(variantInput)
    if (!targetSet || !Array.isArray(targetSet.targets) || targetSet.targets.length === 0) {
      throw new Error("notification_shadow_deterministic_target_missing")
    }
    for (const target of targetSet.targets) {
      const renderInput = Object.freeze({
        ...variantInput,
        targetGeneration: targetSet.targetGeneration,
        target,
      })
      const renderContext = await adapter.buildRenderContext(renderInput)
      const href = await adapter.buildDeepLink(renderInput)
      const rendered = dependencies.renderSnapshot({
        workflowKey,
        payloadSchemaVersion: variantInput.payloadSchemaVersion,
        template: variantInput.template,
        renderContext,
        href,
      })
      intents.push(Object.freeze({
        workflowKey,
        eventKey: requiredString(variantInput.eventKey, "notification_shadow_deterministic_plan_invalid"),
        occurrenceKey: requiredString(
          variant?.occurrenceKey ?? fixture.occurrenceKey,
          "notification_shadow_deterministic_plan_invalid",
        ),
        audienceKey: requiredString(variantInput.rule?.audienceKey, "notification_shadow_deterministic_plan_invalid"),
        channelKey: requiredString(variantInput.rule?.channelKey, "notification_shadow_deterministic_plan_invalid"),
        targetKey: requiredString(target.targetKey, "notification_shadow_deterministic_plan_invalid"),
        targetGeneration: requiredString(targetSet.targetGeneration, "notification_shadow_deterministic_plan_invalid"),
        templateChecksum: checksum,
        renderedTitle: rendered.renderedTitle,
        renderedBody: rendered.renderedBody,
        href: rendered.href,
        normalizedRenderedContentHash: normalizedNotificationRenderedHash({
          title: rendered.renderedTitle,
          body: rendered.renderedBody,
          href: rendered.href,
        }),
      }))
    }
  }
  return intents
}

function intentExactKey(intent) {
  return [
    intent.workflowKey,
    intent.eventKey,
    intent.occurrenceKey,
    intent.audienceKey,
    intent.channelKey,
    intent.targetKey,
    intent.targetGeneration,
  ].join("\u001f")
}

function renderError(callback) {
  try {
    callback()
    return null
  } catch (error) {
    if (!error || typeof error !== "object") return String(error)
    if (typeof error.code === "string" && error.code) return error.code
    if (typeof error.message === "string" && error.message) return error.message
    return "notification_shadow_deterministic_unknown_render_error"
  }
}

function deterministicRenderErrorParity(plan, dependencies) {
  const fixture = record(plan.fixture)
  const canonical = record(fixture?.canonical)
  const legacy = record(fixture?.legacy)
  const template = record(canonical?.template)
  const context = record(legacy?.context)
  if (!canonical || !legacy || !template || !context || !Array.isArray(template.allowedVariables)) {
    throw new Error("notification_shadow_deterministic_plan_invalid")
  }
  const usedToken = [...requiredString(template.titleTemplate, "notification_shadow_deterministic_plan_invalid").matchAll(TOKEN_PATTERN)][0]?.[1]
    ?? [...requiredString(template.bodyTemplate, "notification_shadow_deterministic_plan_invalid").matchAll(TOKEN_PATTERN)][0]?.[1]
  if (!usedToken) return Object.freeze({ missing: "not_applicable", null: "not_applicable" })
  const definition = template.allowedVariables.find((item) => record(item)?.token === usedToken)
  const key = requiredString(record(definition)?.key, "notification_shadow_deterministic_plan_invalid")
  const missing = { ...context }
  delete missing[key]
  const nullValue = { ...context, [key]: null }
  const check = (renderContext) => {
    const canonicalError = renderError(() => dependencies.renderSnapshot({
      workflowKey: canonical.workflowKey,
      payloadSchemaVersion: canonical.payloadSchemaVersion,
      template,
      renderContext,
      href: legacy.href,
    }))
    const legacyError = renderError(() => renderLegacyTemplate(template, renderContext, legacy.href))
    if (canonicalError !== legacyError || canonicalError !== "render_validation_failed") {
      throw new Error(`notification_shadow_deterministic_error_parity_mismatch:${plan.scopeKey}`)
    }
    return canonicalError
  }
  return Object.freeze({ missing: check(missing), null: check(nullValue) })
}

function contentParityEvidence(plan, canonical, legacy, dependencies) {
  const canonicalByKey = new Map(canonical.map((intent) => [intentExactKey(intent), intent]))
  let exact = canonical.length === legacy.length
  for (const legacyIntent of legacy) {
    const canonicalIntent = canonicalByKey.get(intentExactKey(legacyIntent))
    if (
      !canonicalIntent ||
      canonicalIntent.renderedTitle !== legacyIntent.renderedTitle ||
      canonicalIntent.renderedBody !== legacyIntent.renderedBody ||
      canonicalIntent.href !== legacyIntent.href ||
      canonicalIntent.normalizedRenderedContentHash !== legacyIntent.normalizedRenderedContentHash
    ) exact = false
  }
  if (!exact) throw new Error(`notification_shadow_deterministic_exact_content_mismatch:${plan.scopeKey}`)
  const googleChatDestinations = Object.fromEntries(GOOGLE_CHAT_DESTINATIONS.map((destination) => [
    destination,
    canonical.filter((intent) => (
      intent.channelKey === "google_chat" && intent.targetKey === `connection:${destination}`
    )).length,
  ]))
  return Object.freeze({
    exact,
    errorParity: deterministicRenderErrorParity(plan, dependencies),
    googleChatDestinations: Object.freeze(googleChatDestinations),
  })
}

export async function evaluateNotificationShadowDeterministicPlan(plan, input = {}) {
  if (
    !record(plan)
    || plan.schemaVersion !== 1
    || plan.evidenceKind !== "deterministic_no_delivery"
    || typeof plan.scopeKey !== "string"
  ) throw new Error("notification_shadow_deterministic_plan_invalid")

  const dependencies = Object.freeze({
    getAdapter: input.getAdapter ?? getNotificationWorkflowAdapter,
    renderSnapshot: input.renderSnapshot ?? renderNotificationSnapshot,
    compareIntents: input.compareIntents ?? compareNotificationShadowIntents,
  })
  return withExternalRequestsForbidden(async () => {
    const legacy = legacyIntents(plan)
    const canonical = await canonicalIntents(plan, dependencies)
    const comparison = dependencies.compareIntents(legacy, canonical)
    if (!comparison.matched) {
      throw new Error(`notification_shadow_deterministic_mismatch:${plan.scopeKey}`)
    }
    return Object.freeze({
      schemaVersion: 1,
      canonicalIntents: Object.freeze(canonical),
      legacyIntents: Object.freeze(legacy),
      contentParity: contentParityEvidence(plan, canonical, legacy, dependencies),
    })
  })
}
