import { createHash } from "node:crypto"
import { constants as fileConstants } from "node:fs"
import { lstat, open, readdir, realpath } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const FIXTURE_SQL_RELATIVE_PATH =
  "supabase/tests/fixtures/notification_content_local_qa_fixture.sql"
const MAX_FIXTURE_SQL_BYTES = 4 * 1024 * 1024
const MAX_PGTAP_SQL_BYTES = 8 * 1024 * 1024
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const FIXTURE_EMAIL = "notification-content-local-qa@runtime.invalid"
const FIXTURE_NAMESPACE = "notification-content-local-qa-v1"
const CONFIGURATION_IDENTITY_SHA256 =
  "2b09a1c44db7beb0c67b7bce13baf931e7c91677d423cdb0247acd7a1d50a178"
const RULE_GROUPS_JSON_TAG = "$notification_content_local_qa_rule_groups$"
const RULE_GROUPS_JSON_BEGIN = "notification_content_local_qa_rule_groups_json_begin"
const RULE_GROUPS_JSON_END = "notification_content_local_qa_rule_groups_json_end"

export const NOTIFICATION_CONTENT_LOCAL_QA_PGTAP_FILES = Object.freeze([
  "supabase/tests/notification_control_plane_schema_test.sql",
  "supabase/tests/notification_adapters_forward_install_test.sql",
  "supabase/tests/notification_content_contract_test.sql",
  "supabase/tests/notification_delivery_pending_schedule_test.sql",
  "supabase/tests/notification_makeup_single_writer_test.sql",
  "supabase/tests/notification_control_plane_runtime_test.sql",
  "supabase/tests/notification_ops_task_adapters_test.sql",
  "supabase/tests/notification_registration_handoffs_test.sql",
  "supabase/tests/notification_transfer_withdrawal_adapters_test.sql",
  "supabase/tests/notification_makeup_adapter_test.sql",
  "supabase/tests/notification_approval_adapter_test.sql",
  "supabase/tests/notification_system_template_vnext_test.sql",
  "supabase/tests/notification_worker_production_schedule_test.sql",
])

export const NOTIFICATION_CONTENT_LOCAL_QA_EXPECTED_COUNTS = deepFreeze({
  authUsers: 1,
  profiles: 1,
  workflows: 7,
  eventKeys: 51,
  settingsRegistry: 188,
  rules: 189,
  historicalTemplates: 189,
  vNextTemplates: 188,
  templates: 377,
  contentContracts: 188,
  complianceAudits: 188,
  legacySettings: 42,
  importMetadata: 42,
  runtimeFlags: 12,
  reminderApplicability: 4,
  operationalRows: 0,
})

const EXPECTED_CONFIGURATION_IDENTITY = deepFreeze({
  count: 188,
  sha256: CONFIGURATION_IDENTITY_SHA256,
  byWorkflow: {
    approvals: 36,
    makeup_requests: 32,
    registration: 26,
    tasks: 40,
    transfer: 2,
    withdrawal: 2,
    word_retests: 50,
  },
  ruleByWorkflow: {
    approvals: 36,
    makeup_requests: 32,
    registration: 27,
    tasks: 40,
    transfer: 2,
    withdrawal: 2,
    word_retests: 50,
  },
})

const FIXTURE_IDENTITY_BASE = deepFreeze({
  namespace: FIXTURE_NAMESPACE,
  actor: {
    userId: "31500000-0000-4000-8000-000000000001",
    profileId: "31500000-0000-4000-8000-000000000001",
    email: FIXTURE_EMAIL,
  },
  roundTrip: {
    workflowKey: "tasks",
    eventKey: "task.created",
    audienceKey: "requester_profile",
    channelKey: "in_app",
    ruleVariantKey: "immediate",
    ruleId: "08c5fd0c-36bb-5798-869a-1f9ff46a902a",
    activeTemplateId: "222914cb-f640-55b9-862c-0343f547480d",
    vNextTemplateId: "c54c781a-9bcf-5aee-8f2c-91e63516828b",
    requestIds: [
      "31500000-0000-4000-8000-000000000101",
      "31500000-0000-4000-8000-000000000102",
      "31500000-0000-4000-8000-000000000103",
    ],
  },
})

const REQUIRED_FIXTURE_MARKERS = Object.freeze([
  "notification_content_local_qa_preflight_begin",
  "notification_content_local_qa_install_begin",
  "notification_content_local_qa_rule_groups_begin",
  RULE_GROUPS_JSON_BEGIN,
  RULE_GROUPS_JSON_END,
  "notification_content_local_qa_verify_begin",
  "notification_content_local_qa_fixture",
])

const OPERATIONAL_RELATIONS = Object.freeze([
  "public.approval_comments",
  "public.approval_events",
  "public.approval_requests",
  "public.approval_templates",
  "public.classes",
  "public.dashboard_notification_read_receipts",
  "public.dashboard_notifications",
  "public.dashboard_push_subscriptions",
  "public.google_chat_webhook_settings",
  "public.makeup_notification_deliveries",
  "public.makeup_request_events",
  "public.makeup_requests",
  "public.ops_task_attachments",
  "public.ops_task_comments",
  "public.ops_task_events",
  "public.ops_tasks",
  "public.students",
  "dashboard_private.notification_audit_logs",
  "dashboard_private.notification_contract_deployment_receipts",
  "dashboard_private.notification_contract_route_outcomes",
  "dashboard_private.notification_contract_traffic",
  "dashboard_private.notification_deliveries",
  "dashboard_private.notification_dispatch_ownership_claims",
  "dashboard_private.notification_event_fanout_jobs",
  "dashboard_private.notification_events",
  "dashboard_private.notification_makeup_legacy_imports",
  "dashboard_private.notification_makeup_reconcile_audits",
  "dashboard_private.notification_makeup_retention_observations",
  "dashboard_private.notification_makeup_retention_snapshots",
  "dashboard_private.notification_request_ledger",
  "dashboard_private.notification_rule_reconciliation_jobs",
  "dashboard_private.notification_target_reconciliation_jobs",
  "dashboard_private.notification_worker_heartbeats",
])

const FORBIDDEN_SOURCE_PATTERNS = Object.freeze([
  /https?:\/\//iu,
  /\bwww\./iu,
  /\bsupabase\.co\b/iu,
  /\bchat\.googleapis\.com\b/iu,
  /\b(?:sbp|sb_secret|sb_publishable)_[A-Za-z0-9_-]+/u,
  /\b(?:AIza|ya29\.)[A-Za-z0-9._-]+/u,
  /\b01(?:0|1|6|7|8|9)[- ]?\d{3,4}[- ]?\d{4}\b/u,
  /\b(?:net\.http_|http_(?:get|post|put|delete)|dblink(?:_[a-z_]+)?|cron\.schedule|lo_(?:import|export)|pg_read_(?:binary_)?file|pg_write_file|pg_ls_dir|pg_stat_file)\s*\(/iu,
  /(?:^|;)\s*copy\b/imu,
  /\bvacuum\b[\s\S]*?\bprogram\b/iu,
  /^\s*\\/mu,
])

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function sameFileSnapshot(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
}

function fileRefused() {
  throw new Error("notification_local_db_fixture_file_refused")
}

function sourceRefused() {
  throw new Error("notification_local_db_fixture_source_refused")
}

function assertRepositoryRelativePath(relativePath) {
  if (
    typeof relativePath !== "string"
    || relativePath.length === 0
    || relativePath.startsWith("/")
    || relativePath.includes("\\")
    || relativePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    fileRefused()
  }
}

async function assertTrustedPathSegments(relativePath) {
  const rootStat = await lstat(ROOT, { bigint: true })
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fileRefused()

  let current = ROOT
  const segments = relativePath.split("/")
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment)
    const segmentStat = await lstat(current, { bigint: true })
    if (!segmentStat.isDirectory() || segmentStat.isSymbolicLink()) fileRefused()
  }
}

async function readTrustedRepositoryFile(relativePath, maximumBytes) {
  assertRepositoryRelativePath(relativePath)

  let fileHandle
  try {
    await assertTrustedPathSegments(relativePath)
    const expectedPath = join(ROOT, ...relativePath.split("/"))
    const expectedRoot = await realpath(ROOT)
    const expectedRealPath = join(expectedRoot, ...relativePath.split("/"))
    const entryStat = await lstat(expectedPath, { bigint: true })
    if (
      !entryStat.isFile()
      || entryStat.isSymbolicLink()
      || entryStat.size <= 0n
      || entryStat.size > BigInt(maximumBytes)
      || await realpath(expectedPath) !== expectedRealPath
    ) {
      fileRefused()
    }

    fileHandle = await open(
      expectedPath,
      fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
    )
    const openedStat = await fileHandle.stat({ bigint: true })
    if (!openedStat.isFile() || !sameFileSnapshot(entryStat, openedStat)) fileRefused()

    const contents = await fileHandle.readFile()
    const afterReadStat = await fileHandle.stat({ bigint: true })
    if (
      BigInt(contents.byteLength) !== openedStat.size
      || !sameFileSnapshot(openedStat, afterReadStat)
      || await realpath(expectedPath) !== expectedRealPath
    ) {
      fileRefused()
    }

    return Object.freeze({
      absolutePath: expectedPath,
      relativePath,
      contents,
      sha256: sha256(contents),
    })
  } catch (error) {
    if (error?.message === "notification_local_db_fixture_file_refused") throw error
    fileRefused()
  } finally {
    await fileHandle?.close().catch(() => {})
  }
}

function decodeUtf8(contents) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(contents)
  } catch {
    sourceRefused()
  }
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

function mutationPattern(relation) {
  const [schemaName, relationName] = relation.split(".")
  const escapedRelation = `"?${escapeRegularExpression(schemaName)}"?`
    + `\\s*\\.\\s*"?${escapeRegularExpression(relationName)}"?`
  return new RegExp(
    `(?:\\binsert\\s+into|\\bmerge\\s+into|\\bupdate|\\bdelete\\s+from|\\btruncate(?:\\s+table)?)`
      + `\\s+(?:only\\s+)?${escapedRelation}(?![a-z0-9_"])`,
    "iu",
  )
}

function isPlainJsonObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainJsonObject(value)) return false
  const actualKeys = Object.keys(value).sort()
  const sortedExpectedKeys = [...expectedKeys].sort()
  return actualKeys.length === sortedExpectedKeys.length
    && actualKeys.every((key, index) => key === sortedExpectedKeys[index])
}

function isUniqueStringArray(value, maximumLength = 100) {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= maximumLength
    && value.every((entry) => (
      typeof entry === "string"
      && /^[a-z][a-z0-9_.]*$/u.test(entry)
      && entry.length <= 128
    ))
    && new Set(value).size === value.length
}

function extractRuleGroupsManifest(value) {
  const tag = escapeRegularExpression(RULE_GROUPS_JSON_TAG)
  const pattern = new RegExp(
    `^[ \\t]*--[ \\t]+${RULE_GROUPS_JSON_BEGIN}[ \\t]*\\n`
      + `[ \\t]*${tag}[ \\t]*\\n`
      + "(?<json>\\{[\\s\\S]*?\\})\\n"
      + `[ \\t]*${tag}::jsonb[ \\t]*\\n`
      + `^[ \\t]*--[ \\t]+${RULE_GROUPS_JSON_END}[ \\t]*$`,
    "gmu",
  )
  const matches = [...value.matchAll(pattern)]
  if (
    matches.length !== 1
    || value.split(RULE_GROUPS_JSON_BEGIN).length !== 2
    || value.split(RULE_GROUPS_JSON_END).length !== 2
    || value.split(RULE_GROUPS_JSON_TAG).length !== 3
  ) {
    sourceRefused()
  }

  try {
    const parsed = JSON.parse(matches[0].groups.json)
    if (!hasExactKeys(parsed, ["ruleGroups", "noRuleEvents"])) sourceRefused()
    return parsed
  } catch (error) {
    if (error?.message === "notification_local_db_fixture_source_refused") throw error
    sourceRefused()
  }
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

function incrementCount(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1
}

function matchesExpectedCountMap(actual, expected) {
  const expectedKeys = Object.keys(expected).sort()
  const actualKeys = Object.keys(actual).sort()
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => (
      key === expectedKeys[index]
      && actual[key] === expected[key]
    ))
}

function reviewRuleGroupsManifest(manifest) {
  if (
    !Array.isArray(manifest.ruleGroups)
    || manifest.ruleGroups.length === 0
    || manifest.ruleGroups.length > 100
    || !Array.isArray(manifest.noRuleEvents)
    || manifest.noRuleEvents.length > 1_000
  ) {
    sourceRefused()
  }

  const allowedScopeStates = new Set(["excluded_channel", "in_scope"])
  const allowedConfigurationKinds = new Set([
    "editable_rule",
    "fixed_policy_editable_template",
    "not_applicable",
  ])
  const allowedEnabledStates = new Set(["disabled", "enabled"])
  const allowedDispatchOwners = new Set(["canonical", "legacy", "none"])
  const allEntries = []

  for (const group of manifest.ruleGroups) {
    if (
      !hasExactKeys(group, [
        "workflowKey",
        "eventKeys",
        "cells",
        "scopeState",
        "configurationKind",
        "enabledState",
        "dispatchOwner",
      ])
      || !isUniqueStringArray([group.workflowKey], 1)
      || !isUniqueStringArray(group.eventKeys)
      || !Array.isArray(group.cells)
      || group.cells.length === 0
      || group.cells.length > 100
      || !allowedScopeStates.has(group.scopeState)
      || !allowedConfigurationKinds.has(group.configurationKind)
      || !allowedEnabledStates.has(group.enabledState)
      || !allowedDispatchOwners.has(group.dispatchOwner)
    ) {
      sourceRefused()
    }

    for (const cell of group.cells) {
      if (
        !hasExactKeys(cell, ["audienceKey", "channelKey", "ruleVariantKeys"])
        || !isUniqueStringArray([cell.audienceKey], 1)
        || !isUniqueStringArray([cell.channelKey], 1)
        || !isUniqueStringArray(cell.ruleVariantKeys, 20)
        || !["customer_message", "google_chat", "in_app"].includes(cell.channelKey)
        || (group.scopeState === "excluded_channel") !== (cell.channelKey === "customer_message")
        || (group.scopeState === "excluded_channel") !== (group.configurationKind === "not_applicable")
      ) {
        sourceRefused()
      }

      for (const eventKey of group.eventKeys) {
        for (const ruleVariantKey of cell.ruleVariantKeys) {
          allEntries.push({
            workflowKey: group.workflowKey,
            eventKey,
            audienceKey: cell.audienceKey,
            channelKey: cell.channelKey,
            ruleVariantKey,
            scopeState: group.scopeState,
          })
          if (allEntries.length > 1_000) sourceRefused()
        }
      }
    }
  }

  const allIdentityKeys = allEntries.map(identityKey)
  if (
    allEntries.length !== NOTIFICATION_CONTENT_LOCAL_QA_EXPECTED_COUNTS.rules
    || new Set(allIdentityKeys).size !== allIdentityKeys.length
  ) {
    sourceRefused()
  }

  const configuredEntries = allEntries.filter((entry) => entry.scopeState === "in_scope")
  const configuredIdentityKeys = configuredEntries.map(identityKey).sort()
  const byWorkflow = {}
  const ruleByWorkflow = {}
  for (const entry of configuredEntries) incrementCount(byWorkflow, entry.workflowKey)
  for (const entry of allEntries) incrementCount(ruleByWorkflow, entry.workflowKey)

  const configurationIdentity = {
    count: configuredEntries.length,
    sha256: sha256(configuredIdentityKeys.join("\n")),
    byWorkflow,
    ruleByWorkflow,
  }
  const workflowCount = new Set(configuredEntries.map((entry) => entry.workflowKey)).size
  const eventKeyCount = new Set(configuredEntries.map((entry) => entry.eventKey)).size
  const roundTripIdentity = identityKey(FIXTURE_IDENTITY_BASE.roundTrip)

  if (
    configurationIdentity.count !== EXPECTED_CONFIGURATION_IDENTITY.count
    || configurationIdentity.sha256 !== EXPECTED_CONFIGURATION_IDENTITY.sha256
    || !matchesExpectedCountMap(byWorkflow, EXPECTED_CONFIGURATION_IDENTITY.byWorkflow)
    || !matchesExpectedCountMap(ruleByWorkflow, EXPECTED_CONFIGURATION_IDENTITY.ruleByWorkflow)
    || workflowCount !== NOTIFICATION_CONTENT_LOCAL_QA_EXPECTED_COUNTS.workflows
    || eventKeyCount !== NOTIFICATION_CONTENT_LOCAL_QA_EXPECTED_COUNTS.eventKeys
    || !configuredIdentityKeys.includes(roundTripIdentity)
  ) {
    sourceRefused()
  }

  const ruleEventKeys = new Set(allEntries.map((entry) => `${entry.workflowKey}|${entry.eventKey}`))
  const noRuleEventKeys = new Set()
  for (const event of manifest.noRuleEvents) {
    if (
      !hasExactKeys(event, ["workflowKey", "eventKey"])
      || !isUniqueStringArray([event.workflowKey], 1)
      || !isUniqueStringArray([event.eventKey], 1)
      || !(event.workflowKey in EXPECTED_CONFIGURATION_IDENTITY.byWorkflow)
    ) {
      sourceRefused()
    }
    const key = `${event.workflowKey}|${event.eventKey}`
    if (ruleEventKeys.has(key) || noRuleEventKeys.has(key)) sourceRefused()
    noRuleEventKeys.add(key)
  }

  return deepFreeze(configurationIdentity)
}

function reviewNotificationContentLocalQaFixtureSql(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || Buffer.byteLength(value, "utf8") > MAX_FIXTURE_SQL_BYTES
    || value.includes("\0")
    || value.includes("\r")
    || value.charCodeAt(0) === 0xfeff
    || !/^begin;\n/u.test(value)
    || !/\ncommit;\s*$/u.test(value)
  ) {
    sourceRefused()
  }

  for (const marker of REQUIRED_FIXTURE_MARKERS) {
    if (!value.includes(marker)) sourceRefused()
  }
  if (!value.includes(FIXTURE_EMAIL)) sourceRefused()

  const emails = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu) ?? []
  if (emails.some((email) => email.toLowerCase() !== FIXTURE_EMAIL)) sourceRefused()
  for (const pattern of FORBIDDEN_SOURCE_PATTERNS) {
    if (pattern.test(value)) sourceRefused()
  }
  for (const relation of OPERATIONAL_RELATIONS) {
    if (mutationPattern(relation).test(value)) sourceRefused()
  }

  if (
    /\b(?:gen_random_uuid|uuid_generate_v4|random_uuid)\s*\(/iu.test(value)
    || /update\s+dashboard_private\s*\.\s*notification_runtime_flags[\s\S]{0,500}?set\s+enabled\s*=\s*true/iu.test(value)
    || /\(\s*'notification_control_plane_[^']+'\s*,\s*true\b/iu.test(value)
  ) {
    sourceRefused()
  }

  return reviewRuleGroupsManifest(extractRuleGroupsManifest(value))
}

export function assertNotificationContentLocalQaFixtureSql(value) {
  reviewNotificationContentLocalQaFixtureSql(value)
  return true
}

async function loadFixtureSql() {
  const file = await readTrustedRepositoryFile(
    FIXTURE_SQL_RELATIVE_PATH,
    MAX_FIXTURE_SQL_BYTES,
  )
  const sql = decodeUtf8(file.contents)
  const configurationIdentity = reviewNotificationContentLocalQaFixtureSql(sql)
  return deepFreeze({
    fixture: {
      absolutePath: file.absolutePath,
      relativePath: file.relativePath,
      sha256: file.sha256,
      sql,
    },
    configurationIdentity,
  })
}

async function assertExactPgTapNamespace() {
  const directoryRelativePath = "supabase/tests"
  const directoryPath = join(ROOT, ...directoryRelativePath.split("/"))

  try {
    await assertTrustedPathSegments(`${directoryRelativePath}/namespace.guard`)
    const expectedRoot = await realpath(ROOT)
    const expectedDirectoryPath = join(expectedRoot, ...directoryRelativePath.split("/"))
    const beforeStat = await lstat(directoryPath, { bigint: true })
    if (
      !beforeStat.isDirectory()
      || beforeStat.isSymbolicLink()
      || await realpath(directoryPath) !== expectedDirectoryPath
    ) {
      fileRefused()
    }

    const entries = await readdir(directoryPath, { withFileTypes: true })
    const afterStat = await lstat(directoryPath, { bigint: true })
    if (
      !sameFileSnapshot(beforeStat, afterStat)
      || await realpath(directoryPath) !== expectedDirectoryPath
    ) {
      fileRefused()
    }

    const directPgTapFiles = entries
      .filter((entry) => /^notification_[a-z0-9_]+_test\.sql$/u.test(entry.name))
      .map((entry) => {
        if (!entry.isFile() || entry.isSymbolicLink()) fileRefused()
        return `${directoryRelativePath}/${entry.name}`
      })
      .sort()
    const expectedPgTapFiles = [...NOTIFICATION_CONTENT_LOCAL_QA_PGTAP_FILES].sort()
    if (
      directPgTapFiles.length !== expectedPgTapFiles.length
      || directPgTapFiles.some((entry, index) => entry !== expectedPgTapFiles[index])
    ) {
      fileRefused()
    }
  } catch (error) {
    if (error?.message === "notification_local_db_fixture_file_refused") throw error
    fileRefused()
  }
}

function assertPgTapSource(value) {
  const finishMatches = value.match(
    /\bselect\s+\*\s+from\s+finish\s*\(\s*\)\s*;/giu,
  ) ?? []
  if (
    value.length === 0
    || value.includes("\0")
    || value.includes("\r")
    || value.charCodeAt(0) === 0xfeff
    || !/^begin\s*;/iu.test(value)
    || finishMatches.length !== 1
    || !/\nrollback\s*;\s*$/iu.test(value)
    || /\bcommit\s*;/iu.test(value)
    || /pending-migrations|quarantine/iu.test(value)
  ) {
    fileRefused()
  }
}

async function loadPgTapContract() {
  if (
    NOTIFICATION_CONTENT_LOCAL_QA_PGTAP_FILES.length !== 13
    || new Set(NOTIFICATION_CONTENT_LOCAL_QA_PGTAP_FILES).size !== 13
  ) {
    fileRefused()
  }
  await assertExactPgTapNamespace()

  const files = []
  for (const relativePath of NOTIFICATION_CONTENT_LOCAL_QA_PGTAP_FILES) {
    if (!/^supabase\/tests\/notification_[a-z0-9_]+_test\.sql$/u.test(relativePath)) {
      fileRefused()
    }
    const file = await readTrustedRepositoryFile(relativePath, MAX_PGTAP_SQL_BYTES)
    assertPgTapSource(decodeUtf8(file.contents))
    files.push(Object.freeze({
      absolutePath: file.absolutePath,
      relativePath: file.relativePath,
      sha256: file.sha256,
    }))
  }
  await assertExactPgTapNamespace()

  const aggregate = files.map((file) => `${file.relativePath}:${file.sha256}`).join("\n") + "\n"
  const digest = sha256(aggregate)
  if (!SHA256_PATTERN.test(digest)) fileRefused()
  return deepFreeze({
    fileCount: files.length,
    files,
    sha256: digest,
  })
}

export async function loadNotificationContentLocalQaContract() {
  const [fixtureContract, pgTap] = await Promise.all([
    loadFixtureSql(),
    loadPgTapContract(),
  ])
  const { fixture, configurationIdentity } = fixtureContract

  return deepFreeze({
    fixture,
    manifest: {
      version: 1,
      sqlSha256: fixture.sha256,
      identities: {
        ...FIXTURE_IDENTITY_BASE,
        configuration: configurationIdentity,
      },
      expectedCounts: NOTIFICATION_CONTENT_LOCAL_QA_EXPECTED_COUNTS,
    },
    pgTap,
  })
}
