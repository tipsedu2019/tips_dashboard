import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import test from "node:test"
import { fileURLToPath } from "node:url"

const STORAGE_MIGRATION =
  "20260805110000_registration_customer_solapi_storage.sql"
const RPC_MIGRATION =
  "20260805111000_registration_customer_solapi_message_rpc.sql"
const PREVIOUS_MIGRATION =
  "20260805101000_notification_control_plane_template_variable_wire_contract.sql"
const storageMigrationUrl = new URL(
  "../supabase/migrations/" + STORAGE_MIGRATION,
  import.meta.url,
)
const rpcMigrationUrl = new URL(
  "../supabase/migrations/" + RPC_MIGRATION,
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

function functionBlock(source, qualifiedName) {
  const pattern = new RegExp(
    "create\\s+(?:or\\s+replace\\s+)?function\\s+"
      + escapeRegex(qualifiedName)
      + "\\s*\\(",
    "i",
  )
  const match = pattern.exec(source)
  assert.ok(match, "missing create function " + qualifiedName)
  const bodyStart = source.indexOf("as $$", match.index)
  assert.notEqual(bodyStart, -1, "missing function body " + qualifiedName)
  const end = source.indexOf("\n$$;", bodyStart)
  assert.notEqual(end, -1, "unterminated function " + qualifiedName)
  return source.slice(match.index, end + 4)
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
  const preceding = filenames.filter((name) => name < STORAGE_MIGRATION)

  assert.equal(filenames.includes(STORAGE_MIGRATION), true)
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
  const source = await readRequired(storageMigrationUrl, "storage migration")
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
  const source = await readRequired(storageMigrationUrl, "storage migration")
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
  const source = await readRequired(storageMigrationUrl, "storage migration")
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
  const source = await readRequired(storageMigrationUrl, "storage migration")
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
  const source = await readRequired(storageMigrationUrl, "storage migration")
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

test("message RPC migration follows storage and remains additive and provider inert", async () => {
  const filenames = (await readdir(migrationsUrl))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
  const source = await readRequired(rpcMigrationUrl, "message RPC migration")
  const normalized = normalizeSql(source)
  const trimmed = source.trim()

  assert.equal(filenames.includes(RPC_MIGRATION), true)
  assert.equal(
    filenames.filter((name) => name < RPC_MIGRATION).at(-1),
    STORAGE_MIGRATION,
  )
  assert.match(trimmed, /^begin;\s*/i)
  assert.match(trimmed, /commit;$/i)
  assert.equal((trimmed.match(/^begin;$/gim) || []).length, 1)
  assert.equal((trimmed.match(/^commit;$/gim) || []).length, 1)
  assert.match(normalized, /set local lock_timeout = '5s'/)
  assert.match(normalized, /set local statement_timeout = '120s'/)
  assert.doesNotMatch(normalized, /\bdrop\s+(?:table|column|constraint)\b/)
  assert.doesNotMatch(normalized, /\btruncate\b/)
  assert.doesNotMatch(
    normalized,
    /alter table public\.ops_registration_messages|(?:insert|update|delete)[^;]+public\.ops_registration_messages/,
  )
  assert.doesNotMatch(
    normalized,
    /(?:https?:\/\/|api\.solapi\.com|send-many|messages\/v4|authorization)/,
  )
  assert.doesNotMatch(
    normalized,
    /grant (?:select|insert|update|delete|all)[^;]+(?:ops_registration_customer_message|registration_customer_solapi_)/,
  )
})

test("all ten message RPC signatures are service-role-only security definers", async () => {
  const source = await readRequired(rpcMigrationUrl, "message RPC migration")
  const normalized = normalizeSql(source)
  const signatures = [
    ["resolve_registration_customer_message_source_v1", "uuid, text, uuid"],
    ["create_registration_customer_message_preview_v1", "uuid, text, uuid, jsonb"],
    ["claim_registration_customer_message_v1", "uuid, uuid, text, jsonb"],
    ["mark_registration_customer_message_attempt_started_v1", "uuid, uuid, uuid, jsonb"],
    ["release_registration_customer_message_pre_send_claim_v1", "uuid, uuid, text"],
    ["release_registration_customer_message_pre_send_claim_admin_v1", "uuid, uuid, text, text"],
    ["finalize_registration_customer_message_v1", "uuid, uuid, text, jsonb"],
    ["list_registration_customer_messages_v1", "uuid, text, uuid, integer"],
    ["record_registration_customer_message_provider_check_v1", "uuid, uuid, text, jsonb, text"],
    ["reconcile_registration_customer_message_v1", "uuid, uuid, text, jsonb, text, text"],
  ]

  for (const [name, signature] of signatures) {
    const escapedName = escapeRegex(name)
    const escapedSignature = escapeRegex(signature)
    assert.match(
      normalized,
      new RegExp(
        "create (?:or replace )?function public\\." + escapedName
          + "\\([^;]+returns jsonb[^;]+security definer[^;]+set search_path = ''",
      ),
      name + " must be a hardened security definer",
    )
    assert.match(
      normalized,
      new RegExp(
        "alter function public\\." + escapedName + "\\(" + escapedSignature
          + "\\) owner to postgres",
      ),
    )
    assert.match(
      normalized,
      new RegExp(
        "revoke all on function public\\." + escapedName + "\\("
          + escapedSignature
          + "\\) from public, anon, authenticated, service_role",
      ),
    )
    assert.match(
      normalized,
      new RegExp(
        "grant execute on function public\\." + escapedName + "\\("
          + escapedSignature + "\\) to service_role",
      ),
    )
  }

  assert.match(
    normalizeSql(functionBlock(
      source,
      "dashboard_private.registration_customer_message_assert_actor_v1",
    )),
    /from public\.profiles[^;]+profile\.id = p_actor_profile_id/,
  )
  assert.match(
    normalizeSql(functionBlock(
      source,
      "dashboard_private.registration_customer_message_assert_actor_v1",
    )),
    /v_actor_role in \('admin', 'staff'\)/,
  )
  assert.match(
    normalizeSql(functionBlock(
      source,
      "dashboard_private.registration_customer_message_assert_actor_v1",
    )),
    /requested_by = p_actor_profile_id[^;]+assignee_id = p_actor_profile_id[^;]+secondary_assignee_id = p_actor_profile_id/,
  )
  assert.doesNotMatch(normalized, /grant execute[^;]+to authenticated/)

  for (const name of [
    "resolve_registration_customer_message_source_v1",
    "create_registration_customer_message_preview_v1",
    "claim_registration_customer_message_v1",
    "release_registration_customer_message_pre_send_claim_admin_v1",
    "list_registration_customer_messages_v1",
    "record_registration_customer_message_provider_check_v1",
    "reconcile_registration_customer_message_v1",
  ]) {
    assert.match(
      normalizeSql(functionBlock(source, "public." + name)),
      /registration_customer_message_assert_actor_v1/,
      name + " must recheck its supplied actor",
    )
  }

  for (const name of [
    "mark_registration_customer_message_attempt_started_v1",
    "release_registration_customer_message_pre_send_claim_v1",
    "finalize_registration_customer_message_v1",
  ]) {
    const block = normalizeSql(functionBlock(source, "public." + name))
    assert.match(block, /registration_customer_message_assert_actor_v1/)
    assert.match(block, /confirmed_by|claim_owner_id/)
  }
})

test("canonical resolver enforces source authority and exposes a phone only ephemerally", async () => {
  const source = await readRequired(rpcMigrationUrl, "message RPC migration")
  const normalized = normalizeSql(source)
  const normalizedResolver = normalizeSql(functionBlock(
    source,
    "dashboard_private.resolve_registration_customer_message_source_v1_impl",
  ))

  assert.match(normalized, /task\.type = 'registration'/)
  assert.match(normalized, /nullif\(pg_catalog\.btrim\(task\.student_name\), ''\) is not null/)
  assert.match(normalized, /regexp_replace[^;]+parent_phone/)
  assert.match(normalized, /\^01\(0\|1\|\[6-9\]\)\[0-9\]\{7,8\}\$/)
  assert.match(normalized, /appointment\.status = 'scheduled'[^;]+appointment\.scheduled_at > pg_catalog\.(?:now|clock_timestamp)\(\)/)
  assert.match(normalized, /ops_registration_level_tests[^;]+level_test\.status in \('scheduled', 'in_progress'\)/)
  assert.match(normalized, /ops_registration_consultations[^;]+consultation\.mode = 'visit'[^;]+consultation\.status = 'scheduled'/)
  assert.match(normalized, /track\.task_id = appointment\.task_id/)
  assert.match(normalized, /when 'waiting_current_class' then 'current_class'/)
  assert.match(normalized, /when 'waiting_new_class' then 'current_term_opening'/)
  assert.match(normalized, /when 'waiting_next_opening' then 'next_term_opening'/)
  assert.match(normalized, /waiting_detail_class_id/)
  assert.match(normalized, /from public\.classes class/)
  assert.match(normalized, /btrim\(class\.name\)/)
  assert.match(
    normalized,
    /pipeline_status = 'waiting'[^;]+waiting_kind is (?:not )?null[^;]+waiting_source_inconsistent/,
  )
  assert.doesNotMatch(
    normalized,
    /pipeline_status (?:is distinct from|<>|!=) 'waiting'[^;]+waiting_source_inconsistent/,
  )
  assert.match(normalized, /workflow_status = 'enrollment_requested'/)
  assert.match(normalized, /pipeline_status = 'enrollment_decided'/)
  assert.match(normalized, /enrollment\.status = 'planned'[^;]+admission_batch_id is null/)
  assert.match(
    normalized,
    /perform 1 from public\.ops_registration_subject_tracks track where track\.task_id = v_task_id order by track\.id for share/,
  )
  assert.match(
    normalized,
    /perform 1 from public\.ops_registration_enrollments enrollment join public\.ops_registration_subject_tracks track on track\.id = enrollment\.track_id where track\.task_id = v_task_id order by enrollment\.id for share of enrollment/,
  )
  assert.match(
    normalized,
    /perform 1 from public\.ops_registration_level_tests level_test join public\.ops_registration_subject_tracks track on track\.id = level_test\.track_id where level_test\.appointment_id = v_appointment\.id order by level_test\.id, track\.id for share of level_test, track/,
  )
  assert.match(
    normalized,
    /perform 1 from public\.ops_registration_consultations consultation join public\.ops_registration_subject_tracks track on track\.id = consultation\.track_id where consultation\.appointment_id = v_appointment\.id order by consultation\.id, track\.id for share of consultation, track/,
  )
  assert.match(normalized, /admission_notice_sent[^;]+ops_registration_messages[^;]+template_key = 'admission_application'/)
  assert.match(normalized, /'parentphonedigits'/)
  assert.match(normalizedResolver, /set timezone = 'utc'/)

  const writes = [
    ...normalized.matchAll(/(?:insert into|update) public\.ops_registration_customer_message(?:_previews|s)[^;]+/g),
  ].map((match) => match[0]).join(" ")
  assert.doesNotMatch(
    writes,
    /parent_phone|phone_digits|student_name|rendered_body\b|rendered_variables\b|provider_response/,
  )
})

test("preview and claim use strict contracts, current facts, and permanent DB dedupe", async () => {
  const source = await readRequired(rpcMigrationUrl, "message RPC migration")
  const normalized = normalizeSql(source)
  const sourceFactsChecksumBlock = normalizeSql(functionBlock(
    source,
    "dashboard_private.registration_customer_message_source_facts_checksum_v1",
  ))
  const assertCurrentBlock = normalizeSql(functionBlock(
    source,
    "dashboard_private.registration_customer_message_assert_current_v1",
  ))
  const claimBlock = normalizeSql(functionBlock(
    source,
    "public.claim_registration_customer_message_v1",
  ))
  const contractKeys = [
    "parentPhoneDigits",
    "sourceFingerprint",
    "recipientHash",
    "templateKey",
    "templateRevision",
    "templateChecksum",
    "renderedVariablesChecksum",
    "renderedBodyChecksum",
    "renderedButtonsChecksum",
  ]

  assert.match(
    normalized,
    /alter table public\.ops_registration_customer_message_previews add column source_facts_checksum text not null[^;]+\^\[a-f0-9\]\{64\}\$/,
  )
  assert.match(
    normalized,
    /alter table public\.ops_registration_customer_messages add column source_facts_checksum text not null[^;]+\^\[a-f0-9\]\{64\}\$/,
  )
  assert.match(sourceFactsChecksumBlock, /'registration-customer-message-source-facts-v1'/)
  assert.match(sourceFactsChecksumBlock, /p_source - 'parentphonedigits'/)
  assert.match(
    sourceFactsChecksumBlock,
    /p_source \? 'scheduledat'.+extract\(epoch from v_scheduled_at\)/,
  )
  assert.doesNotMatch(sourceFactsChecksumBlock, /recipienthash|templatechecksum|renderedbody|renderedvariables/)
  assert.match(normalized, /p_contract is null[^;]+jsonb_typeof\(p_contract\) (?:=|<>) 'object'/)
  for (const key of contractKeys) {
    assert.match(normalized, new RegExp("'" + key.toLowerCase() + "'"))
  }
  assert.match(normalized, /p_contract - array\[[^;]+\]::text\[\] (?:=|<>) '\{\}'::jsonb/)
  assert.match(normalized, /p_contract ->> 'parentphonedigits'[^;]+parentphonedigits/)
  assert.match(normalized, /insert into public\.ops_registration_customer_message_previews/)
  assert.match(normalized, /source_facts_checksum[^;]+registration_customer_message_source_facts_checksum_v1\(v_source\)/)
  assert.match(normalized, /recipient_last4[^;]+pg_catalog\.right\([^;]+, 4\)/)
  assert.doesNotMatch(normalized, /insert into public\.ops_registration_customer_message_previews[^;]+p_contract\s*[,)]/)

  for (const name of [
    "create_registration_customer_message_preview_v1",
    "claim_registration_customer_message_v1",
    "mark_registration_customer_message_attempt_started_v1",
  ]) {
    assert.match(
      normalizeSql(functionBlock(source, "public." + name)),
      /registration_customer_message_assert_contract_v1/,
    )
  }

  const exactReplayIndex = normalized.indexOf("message.preview_id = p_preview_id")
  const consumedIndex = normalized.indexOf("preview_consumed")
  assert.notEqual(exactReplayIndex, -1, "claim must query the exact replay tuple")
  assert.notEqual(consumedIndex, -1, "claim must reject a consumed preview")
  assert.ok(exactReplayIndex < consumedIndex, "exact replay must precede consumed rejection")
  assert.match(normalized, /preview_id = p_preview_id[^;]+request_key = v_request_key[^;]+confirmed_by = p_actor_profile_id/)
  assert.match(normalized, /request_key_conflict/)
  assert.match(normalized, /for update/)
  assert.match(
    normalized,
    /notification_sha256_hex_v1\([^;]+notification_canonical_json_v1\([^;]+'messagekind'[^;]+'sourceid'[^;]+'sourcefingerprint'[^;]+'recipienthash'/,
  )
  assert.match(normalized, /pg_advisory_xact_lock[^;]+dedupe/)
  assert.match(normalized, /insert into public\.ops_registration_customer_messages/)
  assert.match(claimBlock, /source_facts_checksum[^;]+v_preview\.source_facts_checksum/)
  assert.match(claimBlock, /source_facts_checksum is distinct from dashboard_private\.registration_customer_message_source_facts_checksum_v1\(v_source\)/)
  assert.match(
    assertCurrentBlock,
    /p_message\.source_facts_checksum is distinct from dashboard_private\.registration_customer_message_source_facts_checksum_v1\(v_source\)/,
  )
  assert.match(normalized, /exception when unique_violation/)
  const existingDedupeLockIndex = claimBlock.indexOf("where message.dedupe_key = v_dedupe_key")
  const newClaimSourceLockIndex = claimBlock.indexOf(
    "v_source := dashboard_private.resolve_registration_customer_message_source_v1_impl",
  )
  assert.notEqual(existingDedupeLockIndex, -1, "new claim must lock any existing dedupe row")
  assert.notEqual(newClaimSourceLockIndex, -1, "new claim must re-read the canonical source")
  assert.ok(
    existingDedupeLockIndex < newClaimSourceLockIndex,
    "new claim must use outbox-before-source lock ordering",
  )
  assert.match(
    normalized,
    /registration_customer_message_result_v1\([^;]+false, false, false/,
  )
  assert.match(
    normalized,
    /v_consumed_at := pg_catalog\.clock_timestamp\(\); update public\.ops_registration_customer_message_previews preview set consumed_at = v_consumed_at[^;]+where preview\.id = v_preview\.id[^;]+preview\.consumed_at is null[^;]+preview\.expires_at > v_consumed_at/,
  )
})

test("claim release, attempt marker, and replay recovery never grant a second provider attempt", async () => {
  const source = await readRequired(rpcMigrationUrl, "message RPC migration")
  const normalized = normalizeSql(source)
  const releaseBlock = normalizeSql(functionBlock(
    source,
    "public.release_registration_customer_message_pre_send_claim_v1",
  ))
  const adminReleaseBlock = normalizeSql(functionBlock(
    source,
    "public.release_registration_customer_message_pre_send_claim_admin_v1",
  ))
  const markerBlock = normalizeSql(functionBlock(
    source,
    "public.mark_registration_customer_message_attempt_started_v1",
  ))

  assert.match(
    normalized,
    /status = 'pending'[^;]+provider_attempt_count = 0[^;]+provider_attempt_started_at is null[^;]+claim_active/,
  )
  assert.match(normalized, /claim_release_reason[^;]+pre_send/)
  assert.match(normalized, /claim_expires_at (?:<=|>) pg_catalog\.(?:now|clock_timestamp)\(\)/)
  assert.match(normalized, /registration_customer_message_admin_required/)
  assert.match(markerBlock, /provider_attempt_count = 0[^;]+provider_attempt_started_at is null/)
  assert.match(
    markerBlock,
    /v_attempt_started_at := pg_catalog\.clock_timestamp\(\); update public\.ops_registration_customer_messages message set provider_attempt_count = 1, provider_attempt_started_at = v_attempt_started_at/,
  )
  assert.match(
    markerBlock,
    /update public\.ops_registration_customer_messages message set provider_attempt_count = 1[^;]+where message\.id = v_message\.id[^;]+claim_expires_at > v_attempt_started_at/,
  )
  assert.match(normalized, /'allowed', true/)
  assert.match(normalized, /'allowed', false/)
  assert.match(
    normalized,
    /provider_attempt_count = 1[^;]+status = 'unknown'[^;]+resolution_source = 'marker_recovery'/,
  )
  assert.match(normalized, /claim_active = false[^;]+claim_token = null[^;]+claim_owner_id = null[^;]+claim_expires_at = null/)
  assert.doesNotMatch(releaseBlock, /set (?:(?! where ).)*provider_attempt_count\s*=/)
  assert.doesNotMatch(adminReleaseBlock, /set (?:(?! where ).)*provider_attempt_count\s*=/)
  assert.match(markerBlock, /provider_attempt_count = 1/)
  assert.doesNotMatch(
    normalized,
    /set (?:(?! where ).)*provider_attempt_count = 0/,
  )
})

test("finalize, provider check, reconcile, and history preserve masked permanent outcomes", async () => {
  const source = await readRequired(rpcMigrationUrl, "message RPC migration")
  const normalized = normalizeSql(source)
  const normalizedHistory = normalizeSql(functionBlock(
    source,
    "public.list_registration_customer_messages_v1",
  ))
  const normalizedCheck = normalizeSql(functionBlock(
    source,
    "public.record_registration_customer_message_provider_check_v1",
  ))
  const normalizedProviderEvidence = normalizeSql(functionBlock(
    source,
    "dashboard_private.registration_customer_message_provider_evidence_v1",
  ))
  const normalizedMessageResult = normalizeSql(functionBlock(
    source,
    "dashboard_private.registration_customer_message_result_v1",
  ))
  const normalizedReconcile = normalizeSql(functionBlock(
    source,
    "public.reconcile_registration_customer_message_v1",
  ))

  assert.match(normalized, /p_result not in \('accepted', 'failed_hold', 'unknown'\)/)
  assert.match(normalizedCheck, /p_resolution not in \('accepted', 'failed_hold'\)/)
  const lookupContextIndex = normalizedCheck.indexOf("if p_resolution = 'lookup_context'")
  const terminalResolutionIndex = normalizedCheck.indexOf("if p_resolution not in ('accepted', 'failed_hold')")
  assert.notEqual(lookupContextIndex, -1, "provider check must expose server-only lookup context")
  assert.ok(
    lookupContextIndex < terminalResolutionIndex,
    "server-only context lookup must precede terminal resolution validation",
  )
  assert.match(normalizedCheck, /'requestkey', v_message\.request_key/)
  assert.doesNotMatch(normalizedCheck, /parentphonedigits|recipienthash|claimtoken|dispatchtoken/)
  assert.match(normalizedReconcile, /p_resolution not in \('accepted', 'failed_hold'\)/)
  assert.match(normalized, /jsonb_typeof\(p_provider_evidence\) (?:=|<>) 'object'/)
  assert.match(normalizedProviderEvidence, /set timezone = 'utc'/)
  assert.match(normalizedMessageResult, /set timezone = 'utc'/)
  for (const key of [
    "providerMessageId",
    "providerGroupId",
    "statusCode",
    "statusMessage",
    "observedAt",
    "requestKeyMatched",
  ]) {
    assert.match(normalized, new RegExp("'" + key.toLowerCase() + "'"))
  }
  assert.match(normalized, /dispatch_token = p_dispatch_token[^;]+provider_attempt_count = 1/)
  assert.match(normalizedCheck, /status not in \('pending', 'unknown'\)|status not in \('unknown', 'pending'\)/)
  assert.match(normalizedCheck, /interval '15 minutes'/)
  assert.match(normalized, /requestkeymatched[^;]+true/)
  assert.match(
    normalizedReconcile,
    /registration_customer_message_assert_actor_v1\([^;]+'admin'/,
  )
  assert.match(normalized, /update public\.ops_registration_details[^;]+admission_notice_sent = true/)
  assert.match(normalized, /insert into public\.ops_task_events[^;]+'customer_message_sent'/)
  assert.match(normalized, /not exists[^;]+event_type = 'customer_message_sent'[^;]+field_name/)
  assert.doesNotMatch(
    normalized,
    /insert into public\.ops_task_events[^;]+(?:recipient_hash|parent_phone|providermessageid|rendered_body|provider_evidence)/,
  )
  assert.match(normalizedHistory, /if v_actor_role in \('admin', 'staff'\) then/)
  assert.match(normalizedHistory, /'recipientlast4', message\.recipient_last4/)
  assert.match(normalizedHistory, /else[^;]+jsonb_build_object\([^;]+'messagekind'[^;]+'currentstatus'/)
  assert.doesNotMatch(
    normalizedHistory,
    /jsonb_build_object\([^;]+(?:recipient_hash|template_checksum|provider_evidence|confirmed_by)/,
  )
  assert.doesNotMatch(normalized, /delete from public\.ops_registration_customer_messages/)
  assert.doesNotMatch(normalized, /update public\.ops_registration_customer_messages[^;]+dedupe_key\s*=/)
})

test("pgTAP packet exercises storage behavior without production or provider dependencies", async () => {
  const source = await readRequired(pgTapUrl, "registration customer SOLAPI pgTAP packet")
  const normalized = normalizeSql(source)

  assert.match(source.trim(), /^begin;\s*/i)
  assert.match(source.trim(), /rollback;$/i)
  assert.match(normalized, /select no_plan\(\)/)
  assert.match(normalized, /select \* from finish\(\)/)
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
    "valid level-test source",
    "valid visit source",
    "resolved appointment source is invariant across session time zones",
    "source facts checksum is invariant across session time zones",
    "admission source includes workflow legacy and planned",
    "inconsistent waiting detail",
    "preview contract rejects unexpected keys",
    "expired preview cannot be claimed",
    "exact replay returns the same masked message identity",
    "two previews produce only one permanent dedupe owner",
    "pre-marker exact replay reacquires a new claim token",
    "waiting class-name fact change is stale",
    "level-test participant status or subject fact change is stale",
    "visit participant status or subject fact change is stale",
    "attempt marker authorizes one provider call",
    "pending attempt marker replay closes atomically to unknown",
    "admission track fact change is stale",
    "admission accepted atomically updates compatibility flag",
    "provider evidence rejects raw or unexpected keys",
    "provider evidence canonicalization is invariant across session time zones",
    "finalize replay is invariant across session time zones",
    "provider check resolves an aged unknown",
    "provider check server context returns the private original request key",
    "staff cannot perform admin pre-send release",
    "staff cannot reconcile a provider result",
    "accepted terminal state permanently locks the same dedupe",
    "unknown terminal state keeps the original dedupe row",
    "failed_hold terminal state keeps the original dedupe row",
    "assigned teacher history omits the recipientlast4 key entirely",
  ]) {
    assert.match(normalized, new RegExp(escapeRegex(behavior)))
  }
})
