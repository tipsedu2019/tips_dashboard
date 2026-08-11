import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../supabase/migrations/20260803140000_notification_content_contracts.sql",
  import.meta.url,
)
const registrationManagementMigrationUrl = new URL(
  "../supabase/migrations/20260806120000_registration_management_google_chat_events.sql",
  import.meta.url,
)
const registrationObservationMigrationUrl = new URL(
  "../supabase/migrations/20260809105000_registration_observation_google_chat.sql",
  import.meta.url,
)
const registryUrl = new URL(
  "../src/features/notifications/notification-content-contract-registry.ts",
  import.meta.url,
)
const fixtureUrl = new URL(
  "./fixtures/notification-content-contracts.json",
  import.meta.url,
)

async function readMigration() {
  const source = await readFile(migrationUrl, "utf8").catch(() => "")
  assert.notEqual(source, "", "notification content contract migration must exist")
  return source
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function functionBlock(source, qualifiedName) {
  const start = source.search(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+${escapeRegex(qualifiedName)}\\b`,
    "i",
  ))
  assert.notEqual(start, -1, `missing ${qualifiedName}`)
  const end = source.indexOf("\n$$;", start)
  assert.notEqual(end, -1, `unterminated ${qualifiedName}`)
  return source.slice(start, end + 4)
}

function embeddedContractFixture(source) {
  const startMarker = "-- notification_content_contract_fixture_begin"
  const endMarker = "-- notification_content_contract_fixture_end"
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, "missing embedded contract fixture start marker")
  assert.notEqual(end, -1, "missing embedded contract fixture end marker")
  const fixtureBlock = source.slice(start + startMarker.length, end)
  const matches = [...fixtureBlock.matchAll(
    /\$notification_contracts\$([\s\S]*?)\$notification_contracts\$/g,
  )]
  assert.ok(matches.length > 0, "embedded contract fixture must use closed dollar-quoted JSON values")
  assert.equal(matches.length, 1, "migration must keep one canonical embedded fixture")
  return JSON.parse(matches[0][1])
}

function embeddedContractExtension(source) {
  const startMarker = "-- notification_content_contract_extension_fixture_begin"
  const endMarker = "-- notification_content_contract_extension_fixture_end"
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, "missing embedded contract extension fixture start marker")
  assert.notEqual(end, -1, "missing embedded contract extension fixture end marker")
  const fixtureBlock = source.slice(start + startMarker.length, end)
  const match = fixtureBlock.match(
    /\$notification_contract_extension\$([\s\S]*?)\$notification_contract_extension\$/,
  )
  assert.ok(match, "embedded contract extension must use one closed dollar-quoted JSON value")
  return JSON.parse(match[1])
}

test("migration creates private five-part contracts and immutable compliance evidence", async () => {
  const migration = await readMigration()

  assert.match(migration.trim(), /^begin;[\s\S]*commit;$/i)
  assert.equal((migration.match(/^begin;$/gim) ?? []).length, 1)
  assert.equal((migration.match(/^commit;$/gim) ?? []).length, 1)
  assert.match(migration, /set\s+local\s+lock_timeout\s*=\s*'5s'/i)
  const deferredContract = migration.indexOf("deferrable initially deferred")
  const constraintFlush = migration.search(/set\s+constraints\s+all\s+immediate\s*;/i)
  const ownershipChange = migration.indexOf(
    "alter table dashboard_private.notification_rule_content_contracts owner to postgres;",
  )
  assert.ok(deferredContract >= 0, "content contract registry FK must stay deferrable for seeding")
  assert.ok(constraintFlush > deferredContract, "deferred contract events must be flushed")
  assert.ok(constraintFlush < ownershipChange, "constraint flush must precede ownership DDL")
  assert.match(
    migration,
    /create\s+table\s+dashboard_private\.notification_rule_content_contracts\s*\([\s\S]+?primary\s+key\s*\(\s*workflow_key\s*,\s*event_key\s*,\s*audience_key\s*,\s*channel_key\s*,\s*rule_variant_key\s*\)/i,
  )
  assert.match(
    migration,
    /create\s+table\s+dashboard_private\.notification_template_compliance_audits\s*\([\s\S]+?primary\s+key\s*\(\s*template_id\s*,\s*contract_version\s*\)/i,
  )
  assert.match(migration, /notification_template_compliance_audits_immutable/i)
  for (const relation of [
    "notification_rule_content_contracts",
    "notification_template_compliance_audits",
  ]) {
    assert.match(
      migration,
      new RegExp(`alter\\s+table\\s+dashboard_private\\.${relation}\\s+enable\\s+row\\s+level\\s+security`, "i"),
    )
    assert.match(
      migration,
      new RegExp(`revoke\\s+all\\s+on\\s+table\\s+dashboard_private\\.${relation}[\\s\\S]+?from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`, "i"),
    )
  }
})

test("embedded SQL contract fixtures stay byte-for-byte equivalent to TypeScript contract inputs", async () => {
  const [migration, extensionMigration, observationMigration, fixture, registry] = await Promise.all([
    readMigration(),
    readFile(registrationManagementMigrationUrl, "utf8"),
    readFile(registrationObservationMigrationUrl, "utf8"),
    readFile(fixtureUrl, "utf8").then(JSON.parse),
    import(registryUrl.href),
  ])
  const extensionEventKeys = new Set([
    "registration.consultation_completed",
    "registration.waiting_transitioned",
    "registration.admission_started",
  ])
  const observationEventKeys = new Set([
    "registration.observation_scheduled",
    "registration.observation_rescheduled",
    "registration.observation_canceled",
    "registration.observation_reminder_due",
    "registration.observation_feedback_due",
    "registration.observation_feedback_submitted",
    "registration.observation_director_reassigned",
  ])
  const baseFixture = {
    ...fixture,
    eventContracts: fixture.eventContracts.filter(({ eventKey }) => (
      !extensionEventKeys.has(eventKey) && !observationEventKeys.has(eventKey)
    )),
  }
  const extensionFixture = fixture.eventContracts.filter(({ eventKey }) => extensionEventKeys.has(eventKey))
  assert.equal(fixture.eventContracts.length, 58)
  assert.equal(
    new Set(registry.listNotificationContentContracts().map(({ eventKey }) => eventKey)).size,
    58,
  )
  assert.deepEqual(embeddedContractFixture(migration), baseFixture)
  assert.deepEqual(embeddedContractExtension(extensionMigration), extensionFixture)

  const variableBlock = functionBlock(
    migration,
    "dashboard_private.notification_content_variable_v1",
  )
  const sqlVariables = new Map(
    [...variableBlock.matchAll(/\('([^']+)','([^']+)','([^']+)'\)/g)]
      .map((match) => [
        match[1],
        { key: match[2], token: match[1], piiClass: match[3] },
      ]),
  )
  const expectedVariables = new Map()
  for (const entry of registry.listNotificationContentContracts()) {
    if (observationEventKeys.has(entry.eventKey)) continue
    for (const variable of entry.contract.availableVariables) {
      expectedVariables.set(variable.token, variable)
    }
  }
  assert.deepEqual(
    [...sqlVariables.entries()].sort(([left], [right]) => left.localeCompare(right)),
    [...expectedVariables.entries()].sort(([left], [right]) => left.localeCompare(right)),
  )

  for (const identity of [
    "registration.observation_scheduled|subject_team|google_chat",
    "registration.observation_rescheduled|subject_team|google_chat",
    "registration.observation_canceled|subject_team|google_chat",
    "registration.observation_reminder_due|subject_team|google_chat",
    "registration.observation_feedback_due|subject_team|google_chat",
    "registration.observation_feedback_submitted|management_team|google_chat",
    "registration.observation_feedback_submitted|track_director|in_app",
    "registration.observation_director_reassigned|management_team|google_chat",
  ]) {
    const [eventKey, audienceKey, channelKey] = identity.split("|")
    assert.match(
      observationMigration,
      new RegExp(`'${escapeRegex(eventKey)}'::text, '${escapeRegex(audienceKey)}'::text, '${escapeRegex(channelKey)}'::text`, "u"),
      `observation seed identity missing: ${identity}`,
    )
  }
})

test("registration management extension is additive and cannot activate runtime or dispatch history", async () => {
  const migration = await readFile(registrationManagementMigrationUrl, "utf8")

  assert.match(migration.trim(), /^begin;[\s\S]*commit;$/i)
  assert.match(migration, /registration\.consultation_completed/i)
  assert.match(migration, /registration\.waiting_transitioned/i)
  assert.match(migration, /registration\.admission_started/i)
  assert.match(migration, /notification_settings_ui_registry/i)
  assert.match(migration, /notification_rule_content_contracts/i)
  assert.match(migration, /notification_templates/i)
  assert.doesNotMatch(migration, /notification_runtime_flags/i)
  assert.doesNotMatch(migration, /notification_(?:events|deliveries|provider_attempts)/i)
})

test("v2 save locks rule and contract revisions and derives template snapshots only from the server contract", async () => {
  const migration = await readMigration()
  const save = functionBlock(migration, "public.save_notification_control_plane_v2")
  const override = functionBlock(
    migration,
    "public.save_notification_control_plane_with_override_v2",
  )

  assert.match(
    save,
    /p_expected_rule_revisions\s+jsonb[\s\S]+?p_expected_contract_versions\s+jsonb/i,
  )
  assert.match(save, /for\s+update\s+of\s+rule_row\s*,\s*contract_row/i)
  assert.match(save, /notification_contract_version_conflict/i)
  assert.match(save, /activation_locked[\s\S]+?v_rule_patch\s*\?\s*'enabled'/i)
  assert.match(save, /notification_template_contract_violations_v1/i)
  assert.match(save, /notification_seed_template_checksum_v1/i)
  assert.match(save, /v_contract_json\s*->\s*'availableVariables'/i)
  assert.match(save, /content_contract_version/i)
  assert.doesNotMatch(save, /p_(?:patch|rule_patch)[\s\S]{0,160}allowed_variables/i)
  assert.match(save, /notification_template_compliance_v1/i)
  assert.match(save, /notification_rule_reconciliation_jobs/i)
  assert.match(save, /notification_request_ledger/i)

  assert.match(
    override,
    /p_expected_rule_revisions\s+jsonb[\s\S]+?p_expected_contract_versions\s+jsonb/i,
  )
  assert.match(override, /public\.save_notification_control_plane_v2\s*\(/i)
  assert.match(override, /revision_conflict_overridden/i)
})

test("content validation blocks unsafe saves while direct imperatives remain auditable warnings", async () => {
  const migration = await readMigration()
  const violations = functionBlock(
    migration,
    "dashboard_private.notification_template_contract_violations_v1",
  )

  for (const contract of [
    "notification_template_title_too_long",
    "notification_template_body_too_long",
    "notification_template_html_forbidden",
    "notification_template_external_url_forbidden",
    "notification_template_braces_malformed",
    "notification_template_variable_unknown",
    "notification_template_required_token_missing",
    "notification_template_optional_line_invalid",
    "notification_template_broadcast_mention_forbidden",
  ]) {
    assert.match(violations, new RegExp(escapeRegex(contract)), contract)
  }
  assert.match(violations, /notification_template_direct_imperative[\s\S]+?'warning'/i)
  assert.match(violations, /다음/)
  assert.match(violations, /deep_link/i)
  assert.match(violations, /remove-link|링크를 제거/i)
})

test("snapshot exposes editable fixed registration content without including customer messages or changing v1", async () => {
  const migration = await readMigration()
  const snapshot = functionBlock(
    migration,
    "dashboard_private.notification_control_plane_snapshot_v1",
  )
  const activationGuard = functionBlock(
    migration,
    "dashboard_private.notification_activation_lock_guard_v1",
  )

  assert.match(migration, /configuration_kind\s+text\s+not\s+null/i)
  assert.match(migration, /activation_locked\s+boolean\s+not\s+null/i)
  assert.match(migration, /fixed_policy_editable_template/i)
  assert.match(migration, /registration\.phone_consultation_ready/i)
  assert.match(migration, /registration\.visit_subject_deselected/i)
  assert.match(migration, /channel_key\s*<>\s*'customer_message'/i)
  assert.match(snapshot, /'configuration_kind'/i)
  assert.match(snapshot, /'activation_locked'/i)
  assert.match(snapshot, /'content_contract'/i)
  assert.match(snapshot, /'template_compliance'/i)
  assert.match(snapshot, /'content_contract_version'/i)
  assert.match(
    activationGuard,
    /old\.enabled\s+is\s+distinct\s+from\s+new\.enabled[\s\S]+?registry\.activation_locked[\s\S]+?notification_activation_locked/i,
  )
  assert.match(
    migration,
    /create\s+trigger\s+notification_rules_activation_lock_guard\s+before\s+update\s+of\s+enabled\s+on\s+dashboard_private\.notification_rules/i,
  )
  assert.doesNotMatch(migration, /drop\s+function[\s\S]+?save_notification_control_plane_v1/i)
  assert.doesNotMatch(migration, /create\s+or\s+replace\s+function\s+public\.save_notification_control_plane_v1/i)
})
