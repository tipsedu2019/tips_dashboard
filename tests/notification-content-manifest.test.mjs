import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const typesUrl = new URL(
  "../src/features/notifications/notification-control-plane-types.ts",
  import.meta.url,
)
const manifestUrl = new URL(
  "../src/features/notifications/notification-content-manifest.ts",
  import.meta.url,
)
const fixtureUrl = new URL("./fixtures/notification-content-coverage-manifest.json", import.meta.url)
const settingsSeedUrl = new URL(
  "../supabase/migrations/20260716112500_notification_workflow_settings_seed.sql",
  import.meta.url,
)
const reminderSeedUrl = new URL(
  "../supabase/migrations/20260716130000_registration_appointment_reminder_producer.sql",
  import.meta.url,
)
const registrationFixedSeedUrl = new URL(
  "../supabase/migrations/20260716194000_notification_registration_handoffs.sql",
  import.meta.url,
)

async function loadManifest() {
  const manifest = await import(manifestUrl.href).catch(() => null)
  assert.ok(manifest, "notification content coverage manifest must exist")
  return manifest
}

function identityKey(entry) {
  return [
    entry.workflowKey,
    entry.eventKey,
    entry.audienceKey ?? "not_applicable",
    entry.channelKey ?? "not_applicable",
    entry.ruleVariantKey ?? "not_applicable",
  ].join("|")
}

function expandFixture(fixture) {
  const entries = []
  for (const group of fixture.ruleGroups) {
    for (const eventKey of group.eventKeys) {
      for (const cell of group.cells) {
        for (const ruleVariantKey of cell.ruleVariantKeys) {
          entries.push({
            workflowKey: group.workflowKey,
            eventKey,
            audienceKey: cell.audienceKey,
            channelKey: cell.channelKey,
            ruleVariantKey,
            scopeState: group.scopeState,
            configurationKind: group.configurationKind,
            enabledState: group.enabledState,
            dispatchOwner: group.dispatchOwner,
          })
        }
      }
    }
  }
  for (const event of fixture.noRuleEvents) {
    entries.push({
      workflowKey: event.workflowKey,
      eventKey: event.eventKey,
      audienceKey: null,
      channelKey: null,
      ruleVariantKey: null,
      scopeState: "no_rule_event",
      configurationKind: "not_applicable",
      enabledState: "not_applicable",
      dispatchOwner: "none",
    })
  }
  return entries.sort((left, right) => identityKey(left).localeCompare(identityKey(right)))
}

function sqlBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing SQL marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing SQL marker: ${endMarker}`)
  return source.slice(start, end)
}

function extractSeedIdentityKeys(settingsSeed, reminderSeed, registrationFixedSeed) {
  const identities = new Set()

  const baseEvents = [...sqlBetween(settingsSeed, "event_catalog(\n", "),\ncell_catalog(")
    .matchAll(/^\s*\('([^']+)', '([^']+)', '[^']*', '[^']*', '[^']*', \d+, '([^']+)'\),?$/gm)]
    .map((match) => ({ workflowKey: match[1], eventKey: match[2], cellSet: match[3] }))
  const baseCells = [...sqlBetween(settingsSeed, "cell_catalog(\n", "),\nfixed_registry")
    .matchAll(/^\s*\('([^']+)', '([^']+)', '[^']*', '(in_app|google_chat)', '[^']*', \d+\),?$/gm)]
    .map((match) => ({ cellSet: match[1], audienceKey: match[2], channelKey: match[3] }))
  for (const event of baseEvents) {
    for (const cell of baseCells.filter((candidate) => candidate.cellSet === event.cellSet)) {
      identities.add([
        event.workflowKey,
        event.eventKey,
        cell.audienceKey,
        cell.channelKey,
        "immediate",
      ].join("|"))
    }
  }

  const makeupEvents = [...sqlBetween(settingsSeed, "makeup_event_catalog(\n", "),\nmakeup_cell_sources(")
    .matchAll(/^\s*\('[^']+', '(makeup\.[^']+)', '[^']*', '[^']*', \d+, '([^']+)'\),?$/gm)]
    .map((match) => ({ eventKey: match[1], eventFamily: match[2] }))
  const makeupCells = [...sqlBetween(settingsSeed, "makeup_cell_sources(\n", "),\nmakeup_registry_candidates")
    .matchAll(/^\s*\('([^']+)', '[^']+', '([^']+)', '[^']*', '(in_app|google_chat)', '[^']*', \d+\),?$/gm)]
    .map((match) => ({ eventFamily: match[1], audienceKey: match[2], channelKey: match[3] }))
  for (const event of makeupEvents) {
    for (const cell of makeupCells.filter((candidate) => candidate.eventFamily === event.eventFamily)) {
      identities.add([
        "makeup_requests",
        event.eventKey,
        cell.audienceKey,
        cell.channelKey,
        "immediate",
      ].join("|"))
    }
  }

  const reminderVariants = [...sqlBetween(reminderSeed, "variant_catalog(\n", "),\ncell_catalog(")
    .matchAll(/^\s*'([a-z_]+)'::text,$/gm)]
    .map((match) => match[1])
  const reminderCells = [...sqlBetween(reminderSeed, "cell_catalog(\n", "),\nseed as (")
    .matchAll(/^\s*\('([^']+)'::text, '[^']+'::text, '(in_app|google_chat)'::text, '[^']+'::text, \d+\),?$/gm)]
    .map((match) => ({ audienceKey: match[1], channelKey: match[2] }))
  for (const ruleVariantKey of reminderVariants) {
    for (const cell of reminderCells) {
      identities.add([
        "registration",
        "registration.appointment_reminder_due",
        cell.audienceKey,
        cell.channelKey,
        ruleVariantKey,
      ].join("|"))
    }
  }

  const fixedRuleBlock = sqlBetween(
    registrationFixedSeed,
    "insert into registration_notification_fixed_rules(",
    "insert into dashboard_private.notification_rules(",
  )
  for (const match of fixedRuleBlock.matchAll(
    /^\s*'(registration\.[^']+\|[^']+\|(?:in_app|google_chat|customer_message))',$/gm,
  )) {
    const [eventKey, audienceKey, channelKey] = match[1].split("|")
    identities.add(["registration", eventKey, audienceKey, channelKey, "immediate"].join("|"))
  }

  return [...identities].sort()
}

test("coverage manifest matches the approved fixture and assigns exactly one value on every independent axis", async () => {
  const [manifest, fixture] = await Promise.all([
    loadManifest(),
    readFile(fixtureUrl, "utf8").then(JSON.parse),
  ])
  const expected = expandFixture(fixture)
  const actual = [...manifest.listNotificationContentCoverage()]
    .sort((left, right) => identityKey(left).localeCompare(identityKey(right)))

  assert.deepEqual(actual, expected)
  assert.equal(new Set(actual.map(identityKey)).size, actual.length)
  for (const entry of actual) {
    assert.ok(["in_scope", "excluded_channel", "no_rule_event"].includes(entry.scopeState))
    assert.ok(["editable_rule", "fixed_policy_editable_template", "not_applicable"].includes(entry.configurationKind))
    assert.ok(["enabled", "disabled", "not_applicable"].includes(entry.enabledState))
    assert.ok(["canonical", "legacy", "none"].includes(entry.dispatchOwner))
    if (entry.scopeState === "no_rule_event") {
      assert.equal(entry.audienceKey, null)
      assert.equal(entry.channelKey, null)
      assert.equal(entry.ruleVariantKey, null)
    } else {
      assert.equal(typeof entry.audienceKey, "string")
      assert.equal(typeof entry.channelKey, "string")
      assert.equal(typeof entry.ruleVariantKey, "string")
    }
  }
})

test("manifest and the actual rule seeds match bidirectionally without a hardcoded identity count", async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"))
  const expectedRuleKeys = expandFixture(fixture)
    .filter(({ scopeState }) => scopeState !== "no_rule_event")
    .map(identityKey)
    .sort()
  const actualRuleKeys = extractSeedIdentityKeys(
    await readFile(settingsSeedUrl, "utf8"),
    await readFile(reminderSeedUrl, "utf8"),
    await readFile(registrationFixedSeedUrl, "utf8"),
  )

  assert.deepEqual(actualRuleKeys, expectedRuleKeys)
})

test("every declared event is either covered by one or more real rule identities or explicitly classified as no-rule", async () => {
  const [types, manifest] = await Promise.all([import(typesUrl.href), loadManifest()])
  const coverage = manifest.listNotificationContentCoverage()
  const declaredEvents = Object.entries(types.NOTIFICATION_EVENT_KEYS_BY_WORKFLOW)
    .flatMap(([workflowKey, eventKeys]) => eventKeys.map((eventKey) => ({ workflowKey, eventKey })))

  for (const event of declaredEvents) {
    const matches = coverage.filter((entry) => (
      entry.workflowKey === event.workflowKey && entry.eventKey === event.eventKey
    ))
    assert.ok(matches.length > 0, `unclassified event: ${event.workflowKey}/${event.eventKey}`)
    const noRule = matches.filter(({ scopeState }) => scopeState === "no_rule_event")
    assert.ok(
      noRule.length === 0 || (matches.length === 1 && noRule.length === 1),
      `mixed rule/no-rule coverage: ${event.workflowKey}/${event.eventKey}`,
    )
  }

  const declaredKeys = new Set(declaredEvents.map(({ workflowKey, eventKey }) => `${workflowKey}|${eventKey}`))
  for (const entry of coverage) {
    assert.ok(declaredKeys.has(`${entry.workflowKey}|${entry.eventKey}`), `fixture-only event: ${entry.eventKey}`)
  }
})
