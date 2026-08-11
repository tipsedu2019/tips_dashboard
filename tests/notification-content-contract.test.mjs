import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const registryUrl = new URL(
  "../src/features/notifications/notification-content-contract-registry.ts",
  import.meta.url,
)
const fixtureUrl = new URL("./fixtures/notification-content-contracts.json", import.meta.url)
const goldenFixtureUrl = new URL("./fixtures/notification-content-golden.json", import.meta.url)

const OBSERVATION_IDENTITIES = Object.freeze([
  "registration|registration.observation_scheduled|subject_team|google_chat|immediate",
  "registration|registration.observation_rescheduled|subject_team|google_chat|immediate",
  "registration|registration.observation_canceled|subject_team|google_chat|immediate",
  "registration|registration.observation_reminder_due|subject_team|google_chat|immediate",
  "registration|registration.observation_feedback_due|subject_team|google_chat|immediate",
  "registration|registration.observation_feedback_submitted|management_team|google_chat|immediate",
  "registration|registration.observation_feedback_submitted|track_director|in_app|immediate",
  "registration|registration.observation_director_reassigned|management_team|google_chat|immediate",
])

const OBSERVATION_DESTINATIONS = new Map([
  ["registration.observation_scheduled|subject_team|google_chat", {
    allowedConnectionKeys: ["google_chat.english", "google_chat.math", "google_chat.science"],
    subjectScoped: true,
  }],
  ["registration.observation_rescheduled|subject_team|google_chat", {
    allowedConnectionKeys: ["google_chat.english", "google_chat.math", "google_chat.science"],
    subjectScoped: true,
  }],
  ["registration.observation_canceled|subject_team|google_chat", {
    allowedConnectionKeys: ["google_chat.english", "google_chat.math", "google_chat.science"],
    subjectScoped: true,
  }],
  ["registration.observation_reminder_due|subject_team|google_chat", {
    allowedConnectionKeys: ["google_chat.english", "google_chat.math", "google_chat.science"],
    subjectScoped: true,
  }],
  ["registration.observation_feedback_due|subject_team|google_chat", {
    allowedConnectionKeys: ["google_chat.english", "google_chat.math", "google_chat.science"],
    subjectScoped: true,
  }],
  ["registration.observation_feedback_submitted|management_team|google_chat", {
    allowedConnectionKeys: ["google_chat.management"],
    subjectScoped: false,
  }],
  ["registration.observation_feedback_submitted|track_director|in_app", {
    allowedConnectionKeys: [],
    subjectScoped: false,
  }],
  ["registration.observation_director_reassigned|management_team|google_chat", {
    allowedConnectionKeys: ["google_chat.management"],
    subjectScoped: false,
  }],
])

async function loadRegistry() {
  const registry = await import(registryUrl.href).catch(() => null)
  assert.ok(registry, "notification content contract registry must exist")
  return registry
}

async function readFixture() {
  return JSON.parse(await readFile(fixtureUrl, "utf8"))
}

function eventContractMap(entries) {
  return new Map(entries.map((entry) => [entry.eventKey, entry]))
}

function identityKey(entry) {
  return [
    entry.workflowKey,
    entry.eventKey,
    entry.audienceKey,
    entry.channelKey,
    entry.ruleVariantKey,
  ].join("|")
}

function renderGoldenTemplate(template, values) {
  return template.replace(/\{([^{}]+)\}/gu, (_, token) => {
    assert.ok(Object.hasOwn(values, token), `golden values are missing ${token}`)
    return values[token]
  })
}

test("58 approved event meanings resolve one consistent semantic contract across every rule identity", async () => {
  const [registry, fixture] = await Promise.all([loadRegistry(), readFixture()])
  const expectedByEvent = eventContractMap(fixture.eventContracts)
  const entries = registry.listNotificationContentContracts()
  const actualEvents = new Set(entries.map((entry) => entry.eventKey))

  assert.equal(expectedByEvent.size, 58)
  assert.equal(actualEvents.size, 58)
  assert.deepEqual([...actualEvents].sort(), [...expectedByEvent.keys()].sort())

  for (const entry of entries) {
    const expected = expectedByEvent.get(entry.eventKey)
    assert.ok(expected, `unexpected contract event: ${entry.eventKey}`)
    assert.equal(entry.contract.contractVersion, fixture.contractVersion)
    assert.deepEqual(entry.contract.requiredTokens, expected.requiredTokens)
    assert.deepEqual(entry.contract.optionalLineTokens, expected.optionalLineTokens ?? [])
    assert.deepEqual(entry.contract.mustHaveFacts, expected.mustHaveFacts ?? ["target", "event"])
    assert.deepEqual(entry.contract.supportedPayloadVersions, expected.supportedPayloadVersions ?? [1])
    assert.deepEqual(entry.contract.freeTextVisibility, expected.freeTextVisibility ?? {})
    assert.deepEqual(entry.contract.freeTextPriority, expected.freeTextPriority ?? [])

    const availableTokens = entry.contract.availableVariables.map(({ token }) => token)
    for (const token of [...entry.contract.requiredTokens, ...entry.contract.optionalLineTokens]) {
      assert.ok(availableTokens.includes(token), `${entry.eventKey} is missing ${token}`)
    }
  }
})

test("eight observation content identities keep exact destination, golden, and private-link boundaries", async () => {
  const [registry, golden] = await Promise.all([
    loadRegistry(),
    readFile(goldenFixtureUrl, "utf8").then(JSON.parse),
  ])
  const contracts = new Map(registry.listNotificationContentContracts().map((entry) => [
    identityKey(entry),
    entry.contract,
  ]))
  assert.ok(Array.isArray(golden.observationGoldenCards))
  assert.equal(golden.observationGoldenCards.length, 8)
  const goldenCards = new Map(golden.observationGoldenCards.map((entry) => [identityKey(entry), entry]))
  const forbiddenVariableKeys = new Set([
    "phone",
    "school",
    "inquiry",
    "suitability",
    "feedback_result",
    "feedback_reason",
    "url",
    "uuid",
  ])

  assert.deepEqual(
    [...contracts.keys()].filter((key) => key.includes("|registration.observation_")).sort(),
    [...OBSERVATION_IDENTITIES].sort(),
  )
  assert.deepEqual([...goldenCards.keys()].sort(), [...OBSERVATION_IDENTITIES].sort())

  for (const identity of OBSERVATION_IDENTITIES) {
    const contract = contracts.get(identity)
    const card = goldenCards.get(identity)
    assert.ok(contract, `missing contract ${identity}`)
    assert.ok(card, `missing golden ${identity}`)
    const [, eventKey, audienceKey, channelKey] = identity.split("|")
    const destination = OBSERVATION_DESTINATIONS.get(`${eventKey}|${audienceKey}|${channelKey}`)
    assert.ok(destination, `missing destination expectation ${identity}`)
    assert.equal(contract.contractVersion, "1")
    assert.deepEqual(contract.supportedPayloadVersions, [3])
    assert.deepEqual(contract.destinationPolicy.allowedConnectionKeys, destination.allowedConnectionKeys)
    assert.equal(contract.destinationPolicy.subjectScoped, destination.subjectScoped)
    assert.equal(contract.availableVariables.some(({ key }) => forbiddenVariableKeys.has(key)), false)
    assert.equal(Array.isArray(contract.requiredTokens), true)
    assert.equal(Array.isArray(contract.optionalLineTokens), true)
    assert.equal(Array.isArray(contract.mustHaveFacts), true)
    assert.equal(typeof contract.freeTextVisibility, "object")
    assert.equal(Array.isArray(contract.freeTextPriority), true)
    assert.equal(typeof contract.fieldPresence, "object")
    assert.equal(renderGoldenTemplate(card.titleTemplate, card.templateValues), card.expectedTitle)
    assert.equal(renderGoldenTemplate(card.bodyTemplate, card.templateValues), card.expectedBody)
    assert.doesNotMatch(`${card.expectedTitle}\n${card.expectedBody}`, /(?:https?:\/\/|\/admin\/|[0-9a-f]{8}-[0-9a-f-]{27,}|\+?\d{2,3}[ -]?\d{3,4}[ -]?\d{4}|[\u0000-\u0009\u000b-\u001f\u007f\u200e\u200f\u061c])/iu)
    assert.match(card.privateDeepLink, /^\/admin\/registration(?:\?|\/observations\/)/u)
    if (eventKey === "registration.observation_feedback_due") {
      assert.equal(card.buttonLabel, "피드백 입력")
    } else if (channelKey === "google_chat") {
      assert.equal(card.buttonLabel, "청강 상세 보기")
    } else {
      assert.equal(card.buttonLabel, null)
    }
  }
})

test("registry lookup uses the complete five-part identity and fails closed for an unknown variant", async () => {
  const registry = await loadRegistry()
  const entry = registry.listNotificationContentContracts()[0]
  assert.ok(entry)

  assert.deepEqual(
    registry.getNotificationContentContract({
      workflowKey: entry.workflowKey,
      eventKey: entry.eventKey,
      audienceKey: entry.audienceKey,
      channelKey: entry.channelKey,
      ruleVariantKey: entry.ruleVariantKey,
    }),
    entry.contract,
  )
  assert.equal(
    registry.getNotificationContentContract({
      workflowKey: entry.workflowKey,
      eventKey: entry.eventKey,
      audienceKey: entry.audienceKey,
      channelKey: entry.channelKey,
      ruleVariantKey: "unknown_variant",
    }),
    null,
  )
})

test("field presence distinguishes missing data, displayable nulls, rejected nulls, and an explicit empty subject list", async () => {
  const registry = await loadRegistry()
  const contracts = registry.listNotificationContentContracts()
  const contractFor = (eventKey) => {
    const entry = contracts.find((candidate) => candidate.eventKey === eventKey)
    assert.ok(entry, `missing ${eventKey}`)
    return entry.contract
  }

  assert.deepEqual(contractFor("task.assignee_changed").fieldPresence.before_assignee, {
    required: true,
    nullBehavior: "display",
    nullDisplay: "미배정",
    emptyArrayBehavior: "reject",
  })
  assert.deepEqual(contractFor("task.due_changed").fieldPresence.before_schedule, {
    required: true,
    nullBehavior: "display",
    nullDisplay: "일정 없음",
    emptyArrayBehavior: "reject",
  })
  assert.deepEqual(contractFor("approval.submitted").fieldPresence.progress_actor, {
    required: true,
    nullBehavior: "display",
    nullDisplay: "결재자 지정 대기",
    emptyArrayBehavior: "reject",
  })
  assert.deepEqual(contractFor("registration.visit_subject_deselected").fieldPresence.other_active_subjects, {
    required: true,
    nullBehavior: "reject",
    nullDisplay: null,
    emptyArrayBehavior: "allow",
  })
  assert.deepEqual(contractFor("registration.visit_subject_deselected").fieldPresence.student_name, {
    required: true,
    nullBehavior: "reject",
    nullDisplay: null,
    emptyArrayBehavior: "reject",
  })
})

test("registry construction rejects malformed identities, variables, destinations, and payload versions", async () => {
  const registry = await loadRegistry()
  const source = registry.listNotificationContentContracts()
  const first = structuredClone(source[0])

  assert.throws(
    () => registry.createNotificationContentContractRegistry([first, structuredClone(first)]),
    /notification_content_duplicate_identity/,
  )

  const duplicateKey = structuredClone(first)
  duplicateKey.contract.availableVariables.push({
    ...duplicateKey.contract.availableVariables[0],
    token: "중복되지않은토큰",
  })
  assert.throws(
    () => registry.createNotificationContentContractRegistry([duplicateKey]),
    /notification_content_duplicate_variable_key/,
  )

  const duplicateToken = structuredClone(first)
  duplicateToken.contract.availableVariables.push({
    key: "unique_key",
    token: duplicateToken.contract.availableVariables[0].token,
    piiClass: "none",
  })
  assert.throws(
    () => registry.createNotificationContentContractRegistry([duplicateToken]),
    /notification_content_duplicate_variable_token/,
  )

  const emptyRequired = structuredClone(first)
  emptyRequired.contract.requiredTokens[0] = ""
  assert.throws(
    () => registry.createNotificationContentContractRegistry([emptyRequired]),
    /notification_content_required_token_empty/,
  )

  const missingRequired = structuredClone(first)
  const requiredToken = missingRequired.contract.requiredTokens[0]
  missingRequired.contract.availableVariables = missingRequired.contract.availableVariables
    .filter(({ token }) => token !== requiredToken)
  assert.throws(
    () => registry.createNotificationContentContractRegistry([missingRequired]),
    /notification_content_required_token_unavailable/,
  )

  const invalidOptionalLine = structuredClone(first)
  const optionalToken = invalidOptionalLine.contract.optionalLineTokens[0]
  assert.ok(optionalToken, "fixture must contain an optional line token")
  invalidOptionalLine.contract.availableVariables = invalidOptionalLine.contract.availableVariables
    .map((variable) => variable.token === optionalToken ? { ...variable, key: "not_a_line_slot" } : variable)
  assert.throws(
    () => registry.createNotificationContentContractRegistry([invalidOptionalLine]),
    /notification_content_optional_token_not_line_slot/,
  )

  const unsupportedPayload = structuredClone(first)
  unsupportedPayload.contract.supportedPayloadVersions = [0]
  assert.throws(
    () => registry.createNotificationContentContractRegistry([unsupportedPayload]),
    /notification_content_payload_version_invalid/,
  )

  const unknownConnection = structuredClone(first)
  unknownConnection.contract.destinationPolicy.allowedConnectionKeys = ["google_chat.unknown"]
  assert.throws(
    () => registry.createNotificationContentContractRegistry([unknownConnection]),
    /notification_content_connection_unknown/,
  )
})
