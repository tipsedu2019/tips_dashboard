import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import test from "node:test"
import { fileURLToPath } from "node:url"

const TARGET_MIGRATION =
  "20260805110000_registration_customer_solapi_storage.sql"
const PREVIOUS_MIGRATION =
  "20260805101000_notification_control_plane_template_variable_wire_contract.sql"
const migrationUrl = new URL(
  "../supabase/migrations/" + TARGET_MIGRATION,
  import.meta.url,
)
const migrationsUrl = new URL("../supabase/migrations/", import.meta.url)
const pgTapUrl = new URL(
  "../supabase/tests/registration_customer_solapi_messages_test.sql",
  import.meta.url,
)

const MESSAGE_KINDS = [
  "level_test_booking",
  "visit_consultation_booking",
  "appointment_reminder",
  "waiting_notice",
  "admission_application",
]

const PUBLIC_TABLES = [
  "public.ops_registration_customer_message_previews",
  "public.ops_registration_customer_messages",
]

const PRIVATE_TABLES = [
  "dashboard_private.registration_customer_solapi_template_receipts",
  "dashboard_private.registration_customer_solapi_activation",
]

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeSql(source) {
  return source
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function createTableBlock(source, qualifiedName) {
  const pattern = new RegExp(
    "create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+"
      + escapeRegex(qualifiedName)
      + "\\s*\\(",
    "i",
  )
  const match = pattern.exec(source)
  assert.ok(match, "missing create table " + qualifiedName)
  const end = source.indexOf("\n);", match.index)
  assert.notEqual(end, -1, "unterminated create table " + qualifiedName)
  return source.slice(match.index, end + 3)
}

function assertColumnsInOrder(block, columns, tableName) {
  let cursor = -1
  for (const column of columns) {
    const match = new RegExp(
      "(?:^|\\n)\\s*" + escapeRegex(column) + "\\s+",
      "im",
    ).exec(block.slice(cursor + 1))
    assert.ok(match, tableName + " is missing ordered column " + column)
    cursor += match.index + match[0].length
  }
}

async function readRequired(url, label) {
  const path = fileURLToPath(url)
  assert.equal(existsSync(path), true, label + " must exist")
  return readFile(path, "utf8")
}

test("storage migration is the next forward-only additive registration SOLAPI migration", async () => {
  const filenames = (await readdir(migrationsUrl))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
  const preceding = filenames.filter((name) => name < TARGET_MIGRATION)

  assert.equal(filenames.includes(TARGET_MIGRATION), true)
  assert.equal(preceding.at(-1), PREVIOUS_MIGRATION)

  const olderSources = await Promise.all(
    preceding.map(async (name) => ({
      name,
      source: await readFile(new URL(name, migrationsUrl), "utf8"),
    })),
  )
  for (const { name, source } of olderSources) {
    assert.doesNotMatch(
      source,
      /ops_registration_customer_message|registration_customer_solapi_(?:template_receipts|activation)/i,
      name + " must remain free of the new storage contract",
    )
  }
})

test("storage migration is one bounded inert transaction", async () => {
  const source = await readRequired(migrationUrl, "storage migration")
  const normalized = normalizeSql(source)
  const trimmed = source.trim()
  const namedIdentifiers = [
    ...source.matchAll(
      /\b(?:constraint|create\s+(?:unique\s+)?index|create\s+trigger)\s+([a-z_][a-z0-9_$]*)/gi,
    ),
  ]

  assert.match(trimmed, /^begin;\s*/i)
  assert.match(trimmed, /commit;$/i)
  assert.equal((trimmed.match(/^begin;$/gim) || []).length, 1)
  assert.equal((trimmed.match(/^commit;$/gim) || []).length, 1)
  assert.match(normalized, /set local lock_timeout = '5s'/)
  assert.match(normalized, /set local statement_timeout = '120s'/)
  assert.match(normalized, /create schema if not exists dashboard_private/)

  assert.notEqual(namedIdentifiers.length, 0)
  for (const match of namedIdentifiers) {
    assert.ok(
      Buffer.byteLength(match[1], "utf8") <= 63,
      match[1] + " exceeds PostgreSQL's 63-byte identifier limit",
    )
  }

  assert.doesNotMatch(normalized, /\bdrop\s+(?:table|column|constraint)\b/)
  assert.doesNotMatch(normalized, /\btruncate\b/)
  assert.doesNotMatch(
    normalized,
    /alter table public\.ops_registration_messages/,
  )
  assert.doesNotMatch(
    normalized,
    /(?:https?:\/\/|api\.solapi\.com|send-many|messages\/v4)/,
  )
  assert.doesNotMatch(
    normalized,
    /insert into public\.ops_registration_customer_message(?:_previews|s)\b/,
  )
  assert.doesNotMatch(
    normalized,
    /notification_control_plane_dispatch_registration_enabled/,
  )
})

test("preview storage keeps only source identities, checksums, and masked recipient evidence", async () => {
  const source = await readRequired(migrationUrl, "storage migration")
  const normalized = normalizeSql(source)
  const block = createTableBlock(
    source,
    "public.ops_registration_customer_message_previews",
  )

  assertColumnsInOrder(block, [
    "id",
    "task_id",
    "track_id",
    "appointment_id",
    "message_kind",
    "source_fingerprint",
    "source_revision",
    "recipient_hash",
    "recipient_last4",
    "template_key",
    "template_revision",
    "template_checksum",
    "rendered_variables_checksum",
    "rendered_body_checksum",
    "rendered_buttons_checksum",
    "created_by",
    "created_at",
    "expires_at",
    "consumed_at",
  ], "ops_registration_customer_message_previews")

  for (const column of [
    "source_fingerprint",
    "recipient_hash",
    "template_checksum",
    "rendered_variables_checksum",
    "rendered_body_checksum",
    "rendered_buttons_checksum",
  ]) {
    assert.match(
      normalizeSql(block),
      new RegExp(escapeRegex(column) + "[^,]+\\{64\\}", "i"),
      column + " must be constrained to a 64-character checksum",
    )
  }

  assert.match(normalizeSql(block), /recipient_last4[^,]+\{4\}/)
  assert.match(
    normalizeSql(block),
    /expires_at[^,]+default \(now\(\) \+ '00:15:00'::interval\)|expires_at[^,]+default \(now\(\) \+ interval '15 minutes'\)/,
  )
  assert.match(
    normalized,
    /expires_at = \(created_at \+ '00:15:00'::interval\)|expires_at = \(created_at \+ interval '15 minutes'\)/,
  )
  assert.match(normalized, /message_kind in \('level_test_booking', 'visit_consultation_booking', 'appointment_reminder', 'waiting_notice', 'admission_application'\)/)
  assert.match(normalized, /message_kind in \('level_test_booking', 'visit_consultation_booking', 'appointment_reminder'\)[^;]+appointment_id is not null[^;]+track_id is null/)
  assert.match(normalized, /message_kind = 'waiting_notice'[^;]+track_id is not null[^;]+appointment_id is null/)
  assert.match(normalized, /message_kind = 'admission_application'[^;]+track_id is null[^;]+appointment_id is null/)
  assert.match(normalized, /template_key = message_kind/)

  for (const index of [
    "ops_registration_customer_message_previews_open_expiry_idx",
    "ops_registration_customer_message_previews_actor_expiry_idx",
    "ops_registration_customer_message_previews_task_created_idx",
    "ops_registration_customer_message_previews_appointment_idx",
    "ops_registration_customer_message_previews_track_idx",
  ]) {
    assert.match(normalized, new RegExp("create index " + index))
  }

  assert.doesNotMatch(
    normalizeSql(block),
    /parent_phone|phone_digits|student_name|rendered_body\s+text|rendered_variables\s+jsonb|provider_response/,
  )
})

test("message outbox permanently owns dedupe and a single provider-attempt boundary", async () => {
  const source = await readRequired(migrationUrl, "storage migration")
  const normalized = normalizeSql(source)
  const block = createTableBlock(
    source,
    "public.ops_registration_customer_messages",
  )
  const normalizedBlock = normalizeSql(block)

  assertColumnsInOrder(block, [
    "id",
    "preview_id",
    "task_id",
    "track_id",
    "appointment_id",
    "message_kind",
    "source_fingerprint",
    "source_revision",
    "recipient_hash",
    "recipient_last4",
    "template_key",
    "template_revision",
    "template_checksum",
    "rendered_variables_checksum",
    "rendered_body_checksum",
    "rendered_buttons_checksum",
    "dedupe_key",
    "request_key",
    "status",
    "claim_active",
    "claim_token",
    "claim_owner_id",
    "claim_expires_at",
    "claim_release_reason",
    "dispatch_token",
    "provider_attempt_started_at",
    "provider_attempt_count",
    "provider_message_id",
    "provider_group_id",
    "provider_status_code",
    "provider_status_message",
    "provider_evidence",
    "error_code",
    "confirmed_by",
    "confirmed_at",
    "resolution_source",
    "resolved_by",
    "resolved_at",
    "created_at",
    "updated_at",
  ], "ops_registration_customer_messages")

  assert.match(normalizedBlock, /preview_id uuid not null unique/)
  assert.match(normalizedBlock, /dedupe_key text not null unique/)
  assert.match(normalizedBlock, /request_key text not null unique/)
  assert.match(normalizedBlock, /dispatch_token uuid not null unique/)
  assert.match(
    normalizedBlock,
    /status text not null default 'pending'[^,]+status in \('pending', 'accepted', 'unknown', 'failed_hold'\)/,
  )
  assert.match(
    normalizedBlock,
    /provider_attempt_count integer not null default 0[^,]+provider_attempt_count in \(0, 1\)/,
  )
  assert.match(
    normalized,
    /provider_attempt_count = 0[^;]+provider_attempt_started_at is null[^;]+provider_attempt_count = 1[^;]+provider_attempt_started_at is not null/,
  )
  assert.match(
    normalized,
    /status in \('accepted', 'unknown', 'failed_hold'\)[^;]+provider_attempt_count = 1/,
  )
  assert.match(
    normalized,
    /claim_active[^;]+status = 'pending'[^;]+claim_token is not null[^;]+claim_owner_id is not null[^;]+claim_expires_at is not null/,
  )
  assert.match(normalized, /template_key = message_kind/)
  assert.match(
    normalized,
    /provider_evidence[^;]+providermessageid[^;]+providergroupid[^;]+statuscode[^;]+statusmessage[^;]+observedat[^;]+requestkeymatched/,
  )

  for (const index of [
    "ops_registration_customer_messages_task_kind_created_idx",
    "ops_registration_customer_messages_appointment_idx",
    "ops_registration_customer_messages_track_idx",
    "ops_registration_customer_messages_unresolved_attempt_idx",
    "ops_registration_customer_messages_active_claim_expiry_idx",
    "ops_registration_customer_messages_provider_message_idx",
  ]) {
    assert.match(normalized, new RegExp("create index " + index))
  }

  assert.doesNotMatch(
    normalizedBlock,
    /parent_phone|phone_digits|student_name|rendered_body\s+text|rendered_variables\s+jsonb|provider_response_body|authorization/,
  )
})

test("private template receipts and activation rows are fail-closed", async () => {
  const source = await readRequired(migrationUrl, "storage migration")
  const normalized = normalizeSql(source)
  const receiptBlock = createTableBlock(
    source,
    "dashboard_private.registration_customer_solapi_template_receipts",
  )
  const activationBlock = createTableBlock(
    source,
    "dashboard_private.registration_customer_solapi_activation",
  )

  assertColumnsInOrder(receiptBlock, [
    "message_kind",
    "template_id",
    "pf_id",
    "catalog_checksum",
    "provider_checksum",
    "provider_status",
    "verified_by",
    "verified_at",
  ], "registration_customer_solapi_template_receipts")
  assert.match(normalizeSql(receiptBlock), /provider_status text not null[^,]+provider_status = 'sendable'/)
  assert.match(normalizeSql(receiptBlock), /catalog_checksum = provider_checksum/)
  assert.doesNotMatch(
    normalizeSql(receiptBlock),
    /rendered_body|student_name|recipient_last4|recipient_hash|phone|provider_response/,
  )

  assertColumnsInOrder(activationBlock, [
    "message_kind",
    "mode",
    "verification_task_id",
    "verification_recipient_hash",
    "live_test_message_id",
    "live_test_confirmed_at",
    "updated_by",
    "updated_at",
  ], "registration_customer_solapi_activation")
  assert.match(
    normalizeSql(activationBlock),
    /mode text not null default 'off'[^,]+mode in \('off', 'verification', 'live'\)/,
  )
  assert.match(
    normalized,
    /mode = 'verification'[^;]+verification_task_id is not null[^;]+verification_recipient_hash is not null[^;]+updated_by is not null/,
  )
  assert.match(
    normalized,
    /mode = 'live'[^;]+live_test_message_id is not null[^;]+live_test_confirmed_at is not null[^;]+updated_by is not null/,
  )
  assert.match(
    normalized,
    /insert into dashboard_private\.registration_customer_solapi_activation \(message_kind, mode\) values \('level_test_booking', 'off'\), \('visit_consultation_booking', 'off'\), \('appointment_reminder', 'off'\), \('waiting_notice', 'off'\), \('admission_application', 'off'\) on conflict \(message_kind\) do nothing/,
  )
  assert.doesNotMatch(normalized, /mode\) values[^;]+(?:'verification'|'live')/)
})

test("all four tables are RLS protected with no direct application or service-role access", async () => {
  const source = await readRequired(migrationUrl, "storage migration")
  const normalized = normalizeSql(source)

  for (const table of [...PUBLIC_TABLES, ...PRIVATE_TABLES]) {
    const escaped = escapeRegex(table)
    assert.match(
      normalized,
      new RegExp("alter table " + escaped + " enable row level security"),
    )
    assert.match(
      normalized,
      new RegExp(
        "revoke all on table " + escaped
          + " from public, anon, authenticated, service_role",
      ),
    )
  }

  assert.doesNotMatch(
    normalized,
    /create policy [^;]+ops_registration_customer_message/,
  )
  assert.doesNotMatch(
    normalized,
    /grant (?:select|insert|update|delete|all)[^;]+(?:ops_registration_customer_message|registration_customer_solapi_)/,
  )
  assert.match(
    normalized,
    /create trigger set_updated_at_ops_registration_customer_messages before update on public\.ops_registration_customer_messages for each row execute function public\.set_updated_at\(\)/,
  )
})

test("pgTAP packet exercises storage behavior without production or provider dependencies", async () => {
  const source = await readRequired(pgTapUrl, "registration customer SOLAPI pgTAP packet")
  const normalized = normalizeSql(source)

  assert.match(source.trim(), /^begin;\s*/i)
  assert.match(source.trim(), /rollback;$/i)
  assert.match(normalized, /select plan\(25\)/)
  assert.doesNotMatch(
    normalized,
    /https?:\/\/|api\.solapi\.com|solapi_api_(?:key|secret)|service_role_key|notification_worker|cron/,
  )
  assert.match(
    normalized,
    /aclexplode[^;]+grantee = 0/,
    "PUBLIC table privileges must be checked through the ACL pseudo-role",
  )

  for (const table of [
    "ops_registration_customer_message_previews",
    "ops_registration_customer_messages",
    "registration_customer_solapi_template_receipts",
    "registration_customer_solapi_activation",
  ]) {
    assert.match(normalized, new RegExp(escapeRegex(table)))
  }
  for (const kind of MESSAGE_KINDS) {
    assert.match(normalized, new RegExp(escapeRegex(kind)))
  }
  for (const behavior of [
    "direct table privileges",
    "five activation rows default off",
    "invalid recipient last4",
    "invalid checksum",
    "invalid source shape",
    "invalid provider attempt shape",
    "terminal message cannot keep an active claim",
    "provider evidence rejects unexpected keys",
    "template receipt requires matching sendable checksums",
    "activation verification requires scoped evidence",
    "activation live evidence must be paired",
    "storage migration seeds no preview or outbox rows",
  ]) {
    assert.match(normalized, new RegExp(escapeRegex(behavior)))
  }
})
