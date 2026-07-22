import { createHash } from "node:crypto"
import { lstat, readdir, readFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const defaultRepoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const QUARANTINE_RELATIVE_PATH = join("supabase", "pending-migrations", "notification-cutover")
const ACTIVE_RELATIVE_PATH = join("supabase", "migrations")
const WORKFLOWS_RELATIVE_PATH = join(".github", "workflows")
const REQUIRED_DB_PUSH_WORKFLOW = "supabase-db-push.yml"
// Pin the complete workflow so aliases, multiline expressions, indirection, and
// step reordering cannot expand Supabase secret scope before the verifier exits.
const REQUIRED_DB_PUSH_WORKFLOW_SHA256 = "0c278043f29b67b24035a9fc03f72247739ee59cd89f6b84b846913c568004ca"
const SCIENCE_MIGRATION_FILE = "20260722120000_science_notification_connection.sql"
const SCIENCE_MIGRATION_SHA256 = "ce0ca95663fe2a7dd5ae54ebad6b09ae315dbed548bbc074185230907441dd46"
const PREPARE_ACL_MIGRATION_FILE = "20260722130000_notification_prepare_acl_hardening.sql"
const PREPARE_ACL_MIGRATION_SHA256 = "970d203f816736b05ed56d973d415a75e00e2f659f55f84c7831c60db8c261a3"
const PREPARE_FUNCTION_SIGNATURE =
  "public.prepare_notification_immediate_delivery_v1(text,uuid,uuid,uuid,text,text,text,bigint,uuid,bigint,bigint,timestamptz,jsonb)"
const QUARANTINE_README_SHA256 = "62e387da1575982f154427f5f3ed001ffdb8c9c832744cdb79a45fd3f0ee905f"
const DRAIN_MARKER = "notification_contract_drain_not_complete"
const CLAIM_RECONCILE_BASELINE_FILE = "20260716112000_notification_control_plane_worker_rpc.sql"
const CLAIM_RECONCILE_BASELINE_SHA256 = "4ab9c5f48f018d655c000e1898057df8d13883eaeeee00974cb4760bdb615250"
const CLAIM_RECONCILE_MARKER_IDS = Object.freeze([
  "registration_provider_claim.claim_rpc",
  "registration_provider_claim.reconcile_rpc",
])

const EXPECTED_POLICY = Object.freeze({
  schemaVersion: 1,
  lane: "notification-cutover",
  status: "quarantined",
  executionPolicy: "forbidden_to_apply_directly",
  replacementPolicy: "forward_dated_install_and_separate_activation",
})

const EXPECTED_SQL = Object.freeze([
  ["20260716195000_notification_workflow_legacy_closure.sql", "e9131131f0d9419a4a8fdf5d69a58a1047a41583f98d9ef7b5b376374ee52975"],
  ["20260716195500_notification_worker_schedule.sql", "f9f335e00bb3bba815019dcf5ce73905c8de883db90ec7c99d35ae99d2609696"],
  ["20260716195800_notification_registration_provider_claim.sql", "c682f44b0c851e49b7cec14e703ee7504bdd19b8be2416a49fc8112058826877"],
  ["20260716195900_notification_control_plane_forward_compat.sql", "054914802ac9d0d9475fd18f2b52deb7bfd27552a3b92b7b5331c6d35003ee11"],
  ["20260716196000_notification_shadow_fixture_runner.sql", "ef3ebb3a345bc734343526655fd614f51a8415dbc3a87ce1a60e8e76aa91ebd1"],
  ["20260717145304_notification_shadow_deterministic_evidence.sql", "610c1ce889aa5d7deb29a5d48186976a400774a75e347f600386068af1744833"],
])

const EXPECTED_LEXICAL_SQL = Object.freeze([
  [EXPECTED_SQL[0][0], "487e14d495cd227017a46876813a00f17ac63b2891ca5c7f307292624341d6b3"],
  [EXPECTED_SQL[1][0], "7d5062926dc7cc0f0f5602f58bd717ef2b26e304896b94587feadc4311b7abcd"],
  [EXPECTED_SQL[2][0], "a47121124beffff10de5a42c1a7935b1abe000890b25ecbfc0dad638e1c33b37"],
  [EXPECTED_SQL[3][0], "35c66056658cc2a6a8e776aff2a20f90f66a06d1ba2b73f6e6b47087e673b76c"],
  [EXPECTED_SQL[4][0], "aa8be81d5fec7b5073979720a0b69a20aa3e1827adfba61e98428e7c58296caa"],
  [EXPECTED_SQL[5][0], "593a3d9ab88dab5deb79e33b7eeb3604cf59bec9891c18b5125d73b028e44cda"],
])

const CUTOVER_MARKER_FAMILIES = Object.freeze([
  {
    id: "legacy_closure",
    reserved: [
      ["legacy_closure.contract_table", "dashboard_private.notification_contract_closures"],
      ["legacy_closure.runtime_version", "public.notification_workflow_legacy_closure_version"],
    ],
    activation: [
      ["legacy_closure.drain_error", "'notification_contract_drain_not_complete'"],
    ],
    family: [
      ["legacy_closure.contract_table", "dashboard_private.notification_contract_closures"],
      ["legacy_closure.runtime_version", "public.notification_workflow_legacy_closure_version"],
      ["legacy_closure.drain_error", "'notification_contract_drain_not_complete'"],
      ["legacy_closure.writer_closed", "'legacy_writer_closed'"],
    ],
  },
  {
    id: "worker_schedule",
    reserved: [
      ["worker_schedule.stop_latch", "dashboard_private.notification_worker_stop_latch"],
      ["worker_schedule.watchdog_heartbeats", "dashboard_private.notification_watchdog_heartbeats"],
      ["worker_schedule.manage_rpc", "public.manage_notification_worker_schedule_v1"],
      ["worker_schedule.runtime_version", "public.notification_workflow_adapters_runtime_version"],
    ],
    activation: [
      ["worker_schedule.activate_rpc", "public.activate_notification_dispatch_cutover_v1"],
      ["worker_schedule.activation_guc", "'app.notification_cutover_activation_authorized'"],
    ],
    family: [
      ["worker_schedule.stop_latch", "dashboard_private.notification_worker_stop_latch"],
      ["worker_schedule.watchdog_heartbeats", "dashboard_private.notification_watchdog_heartbeats"],
      ["worker_schedule.manage_rpc", "public.manage_notification_worker_schedule_v1"],
      ["worker_schedule.runtime_version", "public.notification_workflow_adapters_runtime_version"],
      ["worker_schedule.activate_rpc", "public.activate_notification_dispatch_cutover_v1"],
      ["worker_schedule.watchdog_job", "'tips-notification-cutover-watchdog-v1'"],
    ],
  },
  {
    id: "registration_provider_claim",
    reserved: [
      [
        "registration_provider_claim.customer_message_predicate",
        "delivery.channel_key <> 'customer_message'",
      ],
      [
        "registration_provider_claim.specialized_executor_error",
        "'notification_customer_message_specialized_executor_required'",
      ],
    ],
    activation: [],
    family: [
      ["registration_provider_claim.claim_rpc", "public.claim_notification_deliveries_v1"],
      ["registration_provider_claim.reconcile_rpc", "public.reconcile_notification_delivery_v1"],
      [
        "registration_provider_claim.customer_message_predicate",
        "delivery.channel_key <> 'customer_message'",
      ],
      [
        "registration_provider_claim.specialized_executor_error",
        "'notification_customer_message_specialized_executor_required'",
      ],
    ],
  },
  {
    id: "forward_compat",
    reserved: [
      ["forward_compat.runtime_version", "public.notification_control_plane_forward_compat_runtime_version"],
      ["forward_compat.rendered_hash", "dashboard_private.notification_normalized_rendered_hash_v1"],
      ["forward_compat.comparison_key", "dashboard_private.notification_shadow_comparison_key_v1"],
      ["forward_compat.reconcile_shadow", "dashboard_private.reconcile_notification_shadow_intents_v1"],
      ["forward_compat.worker_guard", "public.assert_notification_worker_run_allowed_v1"],
    ],
    activation: [],
    family: [
      ["forward_compat.runtime_version", "public.notification_control_plane_forward_compat_runtime_version"],
      ["forward_compat.rendered_hash", "dashboard_private.notification_normalized_rendered_hash_v1"],
      ["forward_compat.comparison_key", "dashboard_private.notification_shadow_comparison_key_v1"],
      ["forward_compat.reconcile_shadow", "dashboard_private.reconcile_notification_shadow_intents_v1"],
      ["forward_compat.worker_guard", "public.assert_notification_worker_run_allowed_v1"],
    ],
  },
  {
    id: "shadow_fixture",
    reserved: [
      ["shadow_fixture.evidence_table", "dashboard_private.notification_shadow_no_active_rule_evidence"],
      ["shadow_fixture.current_evidence", "dashboard_private.notification_no_active_rule_evidence_current_v1"],
      ["shadow_fixture.record_rpc", "public.record_notification_shadow_fixture_evidence_v1"],
    ],
    activation: [],
    family: [
      ["shadow_fixture.evidence_table", "dashboard_private.notification_shadow_no_active_rule_evidence"],
      ["shadow_fixture.current_evidence", "dashboard_private.notification_no_active_rule_evidence_current_v1"],
      ["shadow_fixture.record_rpc", "public.record_notification_shadow_fixture_evidence_v1"],
      ["shadow_fixture.scope_evidence_v2", "'notification-shadow-scope-evidence-v2'"],
      ["shadow_fixture.natural_traffic", "'natural_traffic_required'"],
    ],
  },
  {
    id: "deterministic_evidence",
    reserved: [
      ["deterministic_evidence.table", "dashboard_private.notification_shadow_deterministic_evidence"],
      ["deterministic_evidence.template_checksum", "dashboard_private.notification_template_checksum_sha256_v1"],
      ["deterministic_evidence.prepare_rpc", "public.prepare_notification_shadow_deterministic_fixture_v1"],
      ["deterministic_evidence.record_rpc", "public.record_notification_shadow_deterministic_evidence_v1"],
      ["deterministic_evidence.replay_rpc", "public.replay_notification_shadow_evidence_v1"],
      ["deterministic_evidence.verify_rpc", "public.verify_notification_shadow_evidence_complete_v1"],
    ],
    activation: [],
    family: [
      ["deterministic_evidence.table", "dashboard_private.notification_shadow_deterministic_evidence"],
      ["deterministic_evidence.template_checksum", "dashboard_private.notification_template_checksum_sha256_v1"],
      ["deterministic_evidence.prepare_rpc", "public.prepare_notification_shadow_deterministic_fixture_v1"],
      ["deterministic_evidence.record_rpc", "public.record_notification_shadow_deterministic_evidence_v1"],
      ["deterministic_evidence.replay_rpc", "public.replay_notification_shadow_evidence_v1"],
      ["deterministic_evidence.verify_rpc", "public.verify_notification_shadow_evidence_complete_v1"],
      [
        "deterministic_evidence.cycle_v3",
        "'notification-shadow-deterministic-cycle-request-v3'",
      ],
    ],
  },
])

const EXPECTED_PGTAP = Object.freeze([
  "notification_workflow_seed_test.sql",
  "notification_worker_schedule_test.sql",
  "notification_shadow_deterministic_evidence_test.sql",
])

const EXPECTED_SUPERSEDED_DEFINITIONS = Object.freeze([
  {
    function: "public.revalidate_immediate_notification_delivery_v1",
    supersededBy: "20260722120000_science_notification_connection.sql",
  },
  {
    function: "public.prepare_notification_immediate_delivery_v1",
    supersededBy: "20260722120000_science_notification_connection.sql",
  },
])

const EXPECTED_MANIFEST_KEYS = Object.freeze([
  ...Object.keys(EXPECTED_POLICY),
  "sqlFiles",
  "pgTapTests",
  "supersededDefinitions",
].sort())

const SCIENCE_SUPERSEDING_CONTRACTS = Object.freeze([
  {
    function: "public.revalidate_immediate_notification_delivery_v1",
    markers: [
      "when 'google_chat.science' then 'science'",
      "v_delivery.audience_key = 'subject_team'",
    ],
  },
  {
    function: "public.prepare_notification_immediate_delivery_v1",
    markers: [
      "from public.ops_registration_subject_tracks track",
      "dashboard_private.is_active_subject_director(",
      "track.subject",
    ],
  },
])

function addError(errors, code, path) {
  errors.push(`${code}: ${path}`)
}

function equalJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

function markerCount(source) {
  return source.split(DRAIN_MARKER).length - 1
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex")
}

function isSqlIdentifierStart(character) {
  return character !== undefined && /[A-Za-z_\u0080-\uFFFF]/.test(character)
}

function isSqlIdentifierPart(character) {
  return character !== undefined && /[A-Za-z0-9_$\u0080-\uFFFF]/.test(character)
}

function isSqlOperatorCharacter(character) {
  return character !== undefined && /[+*/<>=~!@#%^&|`?:-]/.test(character)
}

function sqlNormalizationError(message, offset) {
  return new Error(`${message} at UTF-16 offset ${offset}`)
}

function readSingleQuotedToken(source, start, { backslashEscapes = false } = {}) {
  let index = start + 1
  while (index < source.length) {
    if (backslashEscapes && source[index] === "\\" && index + 1 < source.length) {
      index += 2
      continue
    }
    if (source[index] !== "'") {
      index += 1
      continue
    }
    if (source[index + 1] === "'") {
      index += 2
      continue
    }
    return { end: index + 1, raw: source.slice(start, index + 1) }
  }
  throw sqlNormalizationError("unterminated string literal", start)
}

function decodeStandardStringLiteral(raw) {
  return raw.slice(1, -1).replaceAll("''", "'")
}

function decodeEscapeStringLiteral(raw) {
  const source = raw.slice(1, -1)
  let decoded = ""
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === "'" && source[index + 1] === "'") {
      decoded += "'"
      index += 1
      continue
    }
    if (character !== "\\") {
      decoded += character
      continue
    }

    const escaped = source[index + 1]
    if (escaped === undefined) {
      decoded += "\\"
      continue
    }
    const simpleEscapes = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    }
    if (Object.hasOwn(simpleEscapes, escaped)) {
      decoded += simpleEscapes[escaped]
      index += 1
      continue
    }
    if (/[0-7]/.test(escaped)) {
      const digits = source.slice(index + 1).match(/^[0-7]{1,3}/)?.[0] ?? escaped
      decoded += String.fromCodePoint(Number.parseInt(digits, 8))
      index += digits.length
      continue
    }
    if (escaped === "x") {
      const digits = source.slice(index + 2).match(/^[0-9A-Fa-f]{1,2}/)?.[0]
      if (digits) {
        decoded += String.fromCodePoint(Number.parseInt(digits, 16))
        index += digits.length + 1
        continue
      }
    }
    if (escaped === "u" || escaped === "U") {
      const digitCount = escaped === "u" ? 4 : 8
      const digits = source.slice(index + 2, index + 2 + digitCount)
      if (new RegExp(`^[0-9A-Fa-f]{${digitCount}}$`).test(digits)) {
        const codePoint = Number.parseInt(digits, 16)
        if (codePoint <= 0x10ffff) decoded += String.fromCodePoint(codePoint)
        index += digitCount + 1
        continue
      }
    }
    decoded += escaped
    index += 1
  }
  return decoded
}

function readQuotedIdentifierToken(source, start) {
  let index = start + 1
  let decoded = ""
  while (index < source.length) {
    if (source[index] !== '"') {
      decoded += source[index]
      index += 1
      continue
    }
    if (source[index + 1] === '"') {
      decoded += '"'
      index += 2
      continue
    }
    return { decoded, end: index + 1, raw: source.slice(start, index + 1) }
  }
  throw sqlNormalizationError("unterminated quoted identifier", start)
}

// This is deliberately a narrow lexical fingerprint, not a PostgreSQL parser or
// semantic canonicalizer. It removes outer layout, folds unquoted identifiers,
// and ignores dollar tags while preserving each generic dollar body as opaque
// bytes. Unknown punctuation remains a token; malformed supported forms fail closed.
function tokenizeSql(source) {
  if (typeof source !== "string") throw new TypeError("SQL source must be a string")
  const tokens = []
  let index = 0

  const push = (type, value, markerText, quoted = false) => {
    const token = { type, value }
    if (markerText !== undefined) token.markerText = markerText
    if (quoted) token.quoted = true
    tokens.push(token)
  }

  while (index < source.length) {
    const character = source[index]

    if (/\s/.test(character)) {
      index += 1
      continue
    }

    if (source.startsWith("--", index)) {
      const lineRemainder = source.slice(index + 2)
      const newlineOffset = lineRemainder.search(/[\r\n]/)
      index = newlineOffset === -1 ? source.length : index + 2 + newlineOffset + 1
      continue
    }

    if (source.startsWith("/*", index)) {
      const commentStart = index
      let depth = 1
      index += 2
      while (index < source.length && depth > 0) {
        if (source.startsWith("/*", index)) {
          depth += 1
          index += 2
        } else if (source.startsWith("*/", index)) {
          depth -= 1
          index += 2
        } else {
          index += 1
        }
      }
      if (depth !== 0) throw sqlNormalizationError("unterminated block comment", commentStart)
      continue
    }

    if (/^[uU]&(?=['"])/.test(source.slice(index))) {
      throw sqlNormalizationError("unsupported U& escape form", index)
    }

    const prefixedStringMatch = source.slice(index).match(/^[eEbBxX](?=')/)
    if (prefixedStringMatch) {
      const prefix = prefixedStringMatch[0].toLowerCase()
      const literalStart = index + prefixedStringMatch[0].length
      const literal = readSingleQuotedToken(source, literalStart, {
        backslashEscapes: prefix === "e",
      })
      push(
        "prefixed_string",
        `${prefix}\0${literal.raw}`,
        prefix === "e" ? decodeEscapeStringLiteral(literal.raw) : undefined,
      )
      index = literal.end
      continue
    }

    if (character === "'") {
      const literal = readSingleQuotedToken(source, index)
      push("string", literal.raw, decodeStandardStringLiteral(literal.raw))
      index = literal.end
      continue
    }

    if (character === '"') {
      const identifier = readQuotedIdentifierToken(source, index)
      if (/^[a-z_][a-z0-9_$]*$/.test(identifier.decoded)) {
        push("word", identifier.decoded, undefined, true)
      } else {
        push("quoted_identifier", identifier.decoded)
      }
      index = identifier.end
      continue
    }

    if (character === "$") {
      const delimiterMatch = source
        .slice(index)
        .match(/^\$(?:[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*)?\$/)
      if (delimiterMatch) {
        const delimiterStart = index
        const delimiter = delimiterMatch[0]
        const bodyStart = index + delimiter.length
        const bodyEnd = source.indexOf(delimiter, bodyStart)
        if (bodyEnd === -1) {
          throw sqlNormalizationError("unterminated dollar-quoted body", delimiterStart)
        }
        const body = source.slice(bodyStart, bodyEnd)
        push("dollar_string", body, body)
        index = bodyEnd + delimiter.length
        continue
      }
    }

    if (isSqlIdentifierStart(character)) {
      const wordStart = index
      index += 1
      while (isSqlIdentifierPart(source[index])) index += 1
      push("word", source.slice(wordStart, index).toLowerCase())
      continue
    }

    const numberMatch = source
      .slice(index)
      .match(/^(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/)
    if (numberMatch) {
      push("number", numberMatch[0])
      index += numberMatch[0].length
      continue
    }

    if (isSqlOperatorCharacter(character)) {
      const operatorStart = index
      index += 1
      while (
        isSqlOperatorCharacter(source[index]) &&
        !source.startsWith("--", index) &&
        !source.startsWith("/*", index)
      ) {
        index += 1
      }
      push("operator", source.slice(operatorStart, index))
      continue
    }

    push("symbol", character)
    index += 1
  }

  return tokens
}

function frameSqlTokens(tokens) {
  return tokens
    .map(({ type, value }) => {
      const typeLength = Buffer.byteLength(type, "utf8")
      const valueLength = Buffer.byteLength(value, "utf8")
      return `${typeLength}:${type}${valueLength}:${value}`
    })
    .join("")
}

function normalizedSqlSha256FromTokens(tokens) {
  return sha256(`sql_lex_v1\0${frameSqlTokens(tokens)}`)
}

export function normalizedSqlSha256(source) {
  return normalizedSqlSha256FromTokens(tokenizeSql(source))
}

function containsTokenSequence(tokens, sequence) {
  if (sequence.length === 0 || sequence.length > tokens.length) return false
  for (let start = 0; start <= tokens.length - sequence.length; start += 1) {
    let matched = true
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (
        tokens[start + offset].type !== sequence[offset].type ||
        tokens[start + offset].value !== sequence[offset].value
      ) {
        matched = false
        break
      }
    }
    if (matched) return true
  }
  return false
}

function markerComparableTokens(tokens) {
  const comparable = []
  for (const token of tokens) {
    if (token.markerText === undefined) {
      comparable.push({ type: token.type, value: token.value })
      continue
    }
    const previous = comparable.at(-1)
    if (previous?.type === "marker_text") {
      previous.value += token.markerText
    } else {
      comparable.push({ type: "marker_text", value: token.markerText })
    }
  }
  return comparable
}

function isKeywordToken(token, value) {
  return token?.type === "word" && token.value === value && token.quoted !== true
}

function statementPrefixBefore(tokens, index) {
  let statementStart = index
  while (statementStart > 0) {
    const previous = tokens[statementStart - 1]
    if (previous.type === "symbol" && previous.value === ";") break
    statementStart -= 1
  }
  return tokens.slice(statementStart, index)
}

// Generic string values stay opaque. Only literals in statement-local
// executable command-body positions are tokenized again for marker detection;
// this does not alter sql_lex_v1 or treat ordinary SELECT values as SQL source.
function isExecutableCommandBody(tokens, index) {
  const prefix = statementPrefixBefore(tokens, index)
  const firstWordIndex = prefix.findIndex((token) => token.type === "word")
  if (firstWordIndex === -1) return false
  if (isKeywordToken(prefix[firstWordIndex], "do")) return true
  if (!isKeywordToken(prefix[firstWordIndex], "create")) return false

  let commandKindIndex = firstWordIndex + 1
  if (isKeywordToken(prefix[commandKindIndex], "or")) {
    if (!isKeywordToken(prefix[commandKindIndex + 1], "replace")) return false
    commandKindIndex += 2
  }
  const commandKind = prefix[commandKindIndex]
  if (
    !isKeywordToken(commandKind, "function")
    && !isKeywordToken(commandKind, "procedure")
  ) {
    return false
  }

  return isKeywordToken(prefix.at(-1), "as")
}

function isStaticSqlLiteralToken(token) {
  return token?.markerText !== undefined
    && (token.type === "string"
      || token.type === "prefixed_string"
      || token.type === "dollar_string")
}

function staticExecuteLiteralRun(tokens, index, insideExecutableBody) {
  if (
    !insideExecutableBody
    || !isKeywordToken(tokens[index - 1], "execute")
    || !isStaticSqlLiteralToken(tokens[index])
  ) {
    return null
  }

  let end = index + 1
  while (isStaticSqlLiteralToken(tokens[end])) end += 1
  return {
    end,
    source: tokens.slice(index, end).map((token) => token.markerText).join(""),
  }
}

function executableCommandBodyLiteralRun(tokens, index) {
  if (!isStaticSqlLiteralToken(tokens[index]) || !isExecutableCommandBody(tokens, index)) {
    return null
  }

  let end = index + 1
  while (isStaticSqlLiteralToken(tokens[end])) end += 1
  return {
    end,
    source: tokens.slice(index, end).map((token) => token.markerText).join(""),
  }
}

function expandExecutableMarkerSources(tokens, depth = 0, insideExecutableBody = false) {
  if (depth > 16) {
    throw sqlNormalizationError("executable marker source nesting limit exceeded", 0)
  }

  const expanded = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    const executeLiteralRun = staticExecuteLiteralRun(tokens, index, insideExecutableBody)
    if (executeLiteralRun !== null) {
      expanded.push({ type: "marker_boundary", value: "" })
      expanded.push(
        ...expandExecutableMarkerSources(
          tokenizeSql(executeLiteralRun.source),
          depth + 1,
          false,
        ),
      )
      expanded.push({ type: "marker_boundary", value: "" })
      index = executeLiteralRun.end - 1
      continue
    }

    const commandBodyLiteralRun = executableCommandBodyLiteralRun(tokens, index)
    if (commandBodyLiteralRun === null) {
      expanded.push(token)
      continue
    }

    expanded.push({ type: "marker_boundary", value: "" })
    expanded.push(
      ...expandExecutableMarkerSources(
        tokenizeSql(commandBodyLiteralRun.source),
        depth + 1,
        true,
      ),
    )
    expanded.push({ type: "marker_boundary", value: "" })
    index = commandBodyLiteralRun.end - 1
  }
  return expanded
}

function markerScanTokens(tokens) {
  return markerComparableTokens(expandExecutableMarkerSources(tokens))
}

function isQualifiedIdentifierTokens(tokens) {
  return tokens.length >= 3
    && tokens.length % 2 === 1
    && tokens.every((token, index) =>
      index % 2 === 0
        ? token.type === "word"
        : token.type === "symbol" && token.value === ".")
}

function compileMarkerEntries(entries) {
  return entries.map(([id, source]) => {
    const tokens = markerComparableTokens(tokenizeSql(source))
    const alternatives = [tokens]
    if (isQualifiedIdentifierTokens(tokens)) {
      alternatives.push([tokens.at(-1)])
    }
    return { alternatives, id }
  })
}

function matchingMarkerIds(tokens, markers) {
  return markers
    .filter((marker) => marker.alternatives.some((sequence) =>
      containsTokenSequence(tokens, sequence)))
    .map((marker) => marker.id)
}

const COMPILED_CUTOVER_MARKER_FAMILIES = Object.freeze(
  CUTOVER_MARKER_FAMILIES.map((family) => ({
    id: family.id,
    reserved: compileMarkerEntries(family.reserved),
    activation: compileMarkerEntries(family.activation),
    family: compileMarkerEntries(family.family),
  })),
)

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function functionDefinitionSources(source, functionName) {
  const qualifiedName = functionName
    .split(".")
    .map((part) => escapeRegExp(part))
    .join("\\s*\\.\\s*")
  const targetPattern = new RegExp(
    `\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+${qualifiedName}\\s*\\(`,
    "gi",
  )
  const anyFunctionPattern = /\bcreate\s+(?:or\s+replace\s+)?function\s+/gi
  const allStarts = [...source.matchAll(anyFunctionPattern)].map((match) => match.index)
  return [...source.matchAll(targetPattern)].map((match) => {
    const end = allStarts.find((index) => index > match.index) ?? source.length
    return source.slice(match.index, end)
  })
}

function prepareAclMigrationContractValid(source) {
  const signatureCount = source.split(PREPARE_FUNCTION_SIGNATURE).length - 1
  return source.startsWith("begin;\n")
    && source.endsWith("\ncommit;\n")
    && signatureCount === 2
    && (source.match(/\bset\s+local\s+(?:lock_timeout|statement_timeout|search_path)\b/gi) ?? []).length === 3
    && (source.match(/\balter\s+function\s+public\.prepare_notification_immediate_delivery_v1\s*\(/gi) ?? []).length === 1
    && (source.match(/\brevoke\s+all\s+on\s+function\s+public\.prepare_notification_immediate_delivery_v1\s*\(/gi) ?? []).length === 1
    && (source.match(/\bgrant\s+execute\s+on\s+function\s+public\.prepare_notification_immediate_delivery_v1\s*\(/gi) ?? []).length === 1
    && source.includes(") from public, anon, authenticated, service_role;")
    && source.includes(") to service_role;")
    && source.includes("pg_catalog.to_regprocedure(")
    && source.includes("function_row.prosecdef")
    && source.includes("pg_catalog.pg_get_userbyid(function_row.proowner)")
    && source.includes("pg_catalog.has_function_privilege(")
    && source.includes("pg_catalog.aclexplode(")
    && source.includes("pg_catalog.count(*) = 2")
    && source.includes("acl_row.grantee = v_owner_oid")
    && source.includes("acl_row.grantee = v_service_role_oid")
    && (source.match(/acl_row\.is_grantable\s+is\s+false/gi) ?? []).length === 2
    && source.includes("v_acl_is_exact is not true")
    && !/\bcreate\s+(?:or\s+replace\s+)?function\b|\bdrop\s+function\b/i.test(source)
    && !/\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate)\b/i.test(source)
}

function hasJobBoundary(lines, startIndex, endIndex) {
  return lines
    .slice(startIndex + 1, endIndex)
    .some((line) => /^ {2}(?:[A-Za-z0-9_-]+|"[^"]+"|'[^']+'):\s*(?:#.*)?$/.test(line))
}

async function statKind(path) {
  try {
    return await lstat(path)
  } catch {
    return null
  }
}

async function listDirectory(path) {
  try {
    return await readdir(path)
  } catch {
    return null
  }
}

async function listWorkflowYamlEntries(root) {
  const yamlEntries = []
  const nonRegularEntries = []

  async function visit(path) {
    const entries = await listDirectory(path)
    if (entries === null) return
    for (const entry of entries.sort()) {
      const entryPath = join(path, entry)
      const stat = await statKind(entryPath)
      if (/\.ya?ml$/i.test(entry)) {
        yamlEntries.push({ path: entryPath, stat })
      }
      if (!stat || (!stat.isDirectory() && !stat.isFile())) {
        nonRegularEntries.push(entryPath)
      }
      if (stat?.isDirectory()) {
        await visit(entryPath)
      }
    }
  }

  await visit(root)
  return {
    nonRegularEntries: nonRegularEntries.sort(),
    yamlEntries: yamlEntries.sort((left, right) => left.path.localeCompare(right.path)),
  }
}

export async function validateSupabaseMigrationLayout({ repoRoot = defaultRepoRoot } = {}) {
  const errors = []
  const resolvedRoot = resolve(repoRoot)
  const quarantineDir = join(resolvedRoot, QUARANTINE_RELATIVE_PATH)
  const quarantineTestsDir = join(quarantineDir, "tests")
  const activeDir = join(resolvedRoot, ACTIVE_RELATIVE_PATH)
  const workflowsDir = join(resolvedRoot, WORKFLOWS_RELATIVE_PATH)
  const requiredWorkflowPath = join(workflowsDir, REQUIRED_DB_PUSH_WORKFLOW)
  const manifestPath = join(quarantineDir, "manifest.json")
  const quarantineReadmePath = join(quarantineDir, "README.md")
  const scienceMigrationPath = join(activeDir, SCIENCE_MIGRATION_FILE)
  const prepareAclMigrationPath = join(activeDir, PREPARE_ACL_MIGRATION_FILE)
  let manifest = null

  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  } catch {
    addError(errors, "manifest_json_invalid", relative(resolvedRoot, manifestPath))
  }

  if (manifest !== null) {
    if (!equalJson(Object.keys(manifest).sort(), EXPECTED_MANIFEST_KEYS)) {
      addError(errors, "manifest_top_level_keys_mismatch", relative(resolvedRoot, manifestPath))
    }
    const actualPolicy = Object.fromEntries(Object.keys(EXPECTED_POLICY).map((key) => [key, manifest[key]]))
    if (!equalJson(actualPolicy, EXPECTED_POLICY)) {
      addError(errors, "manifest_policy_mismatch", relative(resolvedRoot, manifestPath))
    }

    const expectedSqlEntries = EXPECTED_SQL.map(([file, sha256]) => ({ file, sha256 }))
    if (!equalJson(manifest.sqlFiles, expectedSqlEntries)) {
      addError(errors, "manifest_sql_entries_mismatch", relative(resolvedRoot, manifestPath))
    }
    if (!equalJson(manifest.pgTapTests, EXPECTED_PGTAP)) {
      addError(errors, "manifest_pgtap_entries_mismatch", relative(resolvedRoot, manifestPath))
    }
    if (!equalJson(manifest.supersededDefinitions, EXPECTED_SUPERSEDED_DEFINITIONS)) {
      addError(errors, "manifest_superseded_definitions_mismatch", relative(resolvedRoot, manifestPath))
    }
  }

  const quarantineStat = await statKind(quarantineDir)
  if (!quarantineStat?.isDirectory()) {
    addError(errors, "quarantine_directory_not_regular", relative(resolvedRoot, quarantineDir))
  }
  const quarantineTestsStat = await statKind(quarantineTestsDir)
  if (!quarantineTestsStat?.isDirectory()) {
    addError(errors, "quarantine_tests_directory_not_regular", relative(resolvedRoot, quarantineTestsDir))
  }

  const expectedTopLevel = ["README.md", "manifest.json", "tests", ...EXPECTED_SQL.map(([file]) => file)].sort()
  const topLevelEntries = await listDirectory(quarantineDir)
  if (!equalJson(topLevelEntries?.sort(), expectedTopLevel)) {
    addError(errors, "quarantine_entry_set_mismatch", relative(resolvedRoot, quarantineDir))
  }
  for (const entry of topLevelEntries ?? []) {
    const entryPath = join(quarantineDir, entry)
    const stat = await statKind(entryPath)
    const isExpectedDirectory = entry === "tests"
    if (!stat || (isExpectedDirectory ? !stat.isDirectory() : !stat.isFile())) {
      addError(errors, "quarantine_entry_not_regular", relative(resolvedRoot, entryPath))
    }
  }

  const testEntries = await listDirectory(quarantineTestsDir)
  if (!equalJson(testEntries?.sort(), [...EXPECTED_PGTAP].sort())) {
    addError(errors, "quarantine_test_entry_set_mismatch", relative(resolvedRoot, quarantineTestsDir))
  }
  for (const entry of testEntries ?? []) {
    const entryPath = join(quarantineTestsDir, entry)
    const stat = await statKind(entryPath)
    if (!stat?.isFile()) {
      addError(errors, "quarantine_test_entry_not_regular", relative(resolvedRoot, entryPath))
    }
  }

  for (const [index, [file, expectedHash]] of EXPECTED_SQL.entries()) {
    const filePath = join(quarantineDir, file)
    const stat = await statKind(filePath)
    if (!stat?.isFile()) continue
    const source = await readFile(filePath)
    const actualHash = sha256(source)
    if (actualHash !== expectedHash) {
      addError(errors, "cutover_sql_hash_mismatch", relative(resolvedRoot, filePath))
    }
    const actualMarkerCount = markerCount(source.toString("utf8"))
    const expectedMarkerCount = index === 0 ? 1 : 0
    if (actualMarkerCount !== expectedMarkerCount) {
      addError(errors, "cutover_drain_marker_cardinality", relative(resolvedRoot, filePath))
    }
  }

  const quarantineReadmeStat = await statKind(quarantineReadmePath)
  if (quarantineReadmeStat?.isFile()) {
    const actualHash = sha256(await readFile(quarantineReadmePath))
    if (actualHash !== QUARANTINE_README_SHA256) {
      addError(errors, "quarantine_readme_hash_mismatch", relative(resolvedRoot, quarantineReadmePath))
    }
  }

  const activeStat = await statKind(activeDir)
  if (!activeStat?.isDirectory()) {
    addError(errors, "active_migration_directory_not_regular", relative(resolvedRoot, activeDir))
  }
  const quarantineTimestamps = new Set(EXPECTED_SQL.map(([file]) => file.slice(0, 14)))
  const quarantineHashes = new Set(EXPECTED_SQL.map(([, hash]) => hash))
  const quarantineLexicalHashes = new Set(EXPECTED_LEXICAL_SQL.map(([, hash]) => hash))
  for (const [file] of EXPECTED_SQL) {
    const activePath = join(activeDir, file)
    if (await statKind(activePath)) {
      addError(errors, "cutover_sql_present_in_active_lane", relative(resolvedRoot, activePath))
    }
  }
  const activeSqlEntries = ((await listDirectory(activeDir)) ?? [])
    .filter((entry) => /\.sql$/i.test(entry))
    .sort()
  for (const entry of activeSqlEntries) {
    const entryPath = join(activeDir, entry)
    const stat = await statKind(entryPath)
    if (!stat?.isFile()) {
      addError(errors, "active_migration_entry_not_regular", relative(resolvedRoot, entryPath))
      continue
    }
    const source = await readFile(entryPath)
    const sourceText = source.toString("utf8")
    const sourceHash = sha256(source)
    const timestamp = entry.match(/^(\d{14})/)?.[1]
    if (timestamp && quarantineTimestamps.has(timestamp)) {
      addError(errors, "cutover_timestamp_reused_in_active_lane", relative(resolvedRoot, entryPath))
    }
    if (quarantineHashes.has(sourceHash)) {
      addError(errors, "cutover_sql_hash_present_in_active_lane", relative(resolvedRoot, entryPath))
    }
    if (markerCount(sourceText) > 0) {
      addError(errors, "drain_marker_present_in_active_lane", relative(resolvedRoot, entryPath))
    }
    let sourceTokens = null
    let sourceMarkerTokens = null
    try {
      sourceTokens = tokenizeSql(sourceText)
      sourceMarkerTokens = markerScanTokens(sourceTokens)
      if (quarantineLexicalHashes.has(normalizedSqlSha256FromTokens(sourceTokens))) {
        addError(
          errors,
          "cutover_sql_semantic_hash_present_in_active_lane",
          relative(resolvedRoot, entryPath),
        )
      }
    } catch {
      addError(
        errors,
        "active_migration_sql_normalization_failed",
        relative(resolvedRoot, entryPath),
      )
    }

    if (sourceTokens !== null && sourceMarkerTokens !== null) {
      const activeRelativePath = relative(resolvedRoot, entryPath)
      const isExactClaimReconcileBaseline = entry === CLAIM_RECONCILE_BASELINE_FILE
        && sourceHash === CLAIM_RECONCILE_BASELINE_SHA256

      for (const family of COMPILED_CUTOVER_MARKER_FAMILIES) {
        const reservedMarkerIds = matchingMarkerIds(sourceMarkerTokens, family.reserved)
        const activationMarkerIds = matchingMarkerIds(sourceMarkerTokens, family.activation)
        const familyMarkerIds = matchingMarkerIds(sourceMarkerTokens, family.family)
        const claimReconcileMatches = CLAIM_RECONCILE_MARKER_IDS.filter((id) =>
          familyMarkerIds.includes(id))

        for (const markerId of reservedMarkerIds) {
          addError(
            errors,
            "cutover_reserved_object_present_in_active_lane",
            `${activeRelativePath}#${markerId}`,
          )
        }
        for (const markerId of activationMarkerIds) {
          addError(
            errors,
            "cutover_activation_marker_present_in_active_lane",
            `${activeRelativePath}#${markerId}`,
          )
        }

        if (claimReconcileMatches.length > 0 && !isExactClaimReconcileBaseline) {
          addError(
            errors,
            "cutover_marker_allowlist_mismatch",
            `${activeRelativePath}#claim_reconcile_rpc`,
          )
        }

        const thresholdMarkerIds = isExactClaimReconcileBaseline
          ? familyMarkerIds.filter((id) => !CLAIM_RECONCILE_MARKER_IDS.includes(id))
          : familyMarkerIds
        if (new Set(thresholdMarkerIds).size >= 2) {
          addError(
            errors,
            "cutover_semantic_marker_threshold_exceeded",
            `${activeRelativePath}#${family.id}`,
          )
        }
      }
    }
    const isExactPrepareAclMigration = entry === PREPARE_ACL_MIGRATION_FILE
      && sourceHash === PREPARE_ACL_MIGRATION_SHA256
      && prepareAclMigrationContractValid(sourceText)
    const isExactScienceMigration = entry === SCIENCE_MIGRATION_FILE
      && sourceHash === SCIENCE_MIGRATION_SHA256
    if (!isExactScienceMigration && !isExactPrepareAclMigration) {
      const normalizedSource = sourceText.toLowerCase()
      for (const contract of SCIENCE_SUPERSEDING_CONTRACTS) {
        const bareFunctionName = contract.function.split(".").at(-1).toLowerCase()
        if (normalizedSource.includes(bareFunctionName)) {
          addError(
            errors,
            "science_final_definition_mismatch",
            `${relative(resolvedRoot, entryPath)}#${contract.function}`,
          )
        }
      }
    }
  }

  const prepareAclMigrationStat = await statKind(prepareAclMigrationPath)
  if (!prepareAclMigrationStat?.isFile()) {
    addError(
      errors,
      "notification_prepare_acl_migration_not_regular",
      relative(resolvedRoot, prepareAclMigrationPath),
    )
  } else {
    const prepareAclMigration = await readFile(prepareAclMigrationPath)
    const prepareAclSource = prepareAclMigration.toString("utf8")
    const prepareAclHashMatches = sha256(prepareAclMigration) === PREPARE_ACL_MIGRATION_SHA256
    if (!prepareAclHashMatches) {
      addError(
        errors,
        "notification_prepare_acl_migration_hash_mismatch",
        relative(resolvedRoot, prepareAclMigrationPath),
      )
    }
    if (!prepareAclHashMatches || !prepareAclMigrationContractValid(prepareAclSource)) {
      addError(
        errors,
        "notification_prepare_acl_migration_contract_mismatch",
        relative(resolvedRoot, prepareAclMigrationPath),
      )
    }
  }

  const scienceMigrationStat = await statKind(scienceMigrationPath)
  if (!scienceMigrationStat?.isFile()) {
    addError(errors, "science_superseding_migration_not_regular", relative(resolvedRoot, scienceMigrationPath))
  } else {
    const scienceMigration = await readFile(scienceMigrationPath)
    const scienceSource = scienceMigration.toString("utf8")
    if (sha256(scienceMigration) !== SCIENCE_MIGRATION_SHA256) {
      addError(errors, "science_superseding_migration_hash_mismatch", relative(resolvedRoot, scienceMigrationPath))
    }
    for (const contract of SCIENCE_SUPERSEDING_CONTRACTS) {
      const definitions = functionDefinitionSources(scienceSource, contract.function)
      const contractPath = `${relative(resolvedRoot, scienceMigrationPath)}#${contract.function}`
      if (definitions.length !== 1) {
        addError(errors, "science_superseded_definition_missing", contractPath)
      } else if (!contract.markers.every((marker) => definitions[0].includes(marker))) {
        addError(errors, "science_superseding_contract_mismatch", contractPath)
      }
    }
  }

  const workflowsStat = await statKind(workflowsDir)
  if (!workflowsStat?.isDirectory()) {
    addError(errors, "workflow_directory_not_regular", relative(resolvedRoot, workflowsDir))
  }
  const requiredWorkflowStat = await statKind(requiredWorkflowPath)
  if (!requiredWorkflowStat?.isFile()) {
    addError(errors, "required_db_push_workflow_not_regular", relative(resolvedRoot, requiredWorkflowPath))
  } else if (sha256(await readFile(requiredWorkflowPath)) !== REQUIRED_DB_PUSH_WORKFLOW_SHA256) {
    const workflowRelativePath = relative(resolvedRoot, requiredWorkflowPath)
    addError(errors, "required_db_push_workflow_hash_mismatch", workflowRelativePath)
    addError(errors, "db_push_workflow_secret_scope_mismatch", workflowRelativePath)
  }
  const { nonRegularEntries: workflowNonRegularEntries, yamlEntries: workflowYamlEntries } =
    await listWorkflowYamlEntries(workflowsDir)
  const workflowRelativeCandidates = workflowYamlEntries.map(({ path }) =>
    relative(workflowsDir, path))
  const workflowSetIsExact = equalJson(workflowRelativeCandidates, [REQUIRED_DB_PUSH_WORKFLOW])
    && workflowYamlEntries[0]?.stat?.isFile()
    && workflowNonRegularEntries.length === 0
  if (!workflowSetIsExact) {
    addError(errors, "workflow_file_set_mismatch", relative(resolvedRoot, workflowsDir))
  }
  const reportedNonRegularWorkflowPaths = new Set()
  for (const { path: workflowPath, stat } of workflowYamlEntries) {
    const workflowRelativeToDirectory = relative(workflowsDir, workflowPath)
    const workflowRelativePath = relative(resolvedRoot, workflowPath)
    if (!stat?.isFile()) {
      addError(errors, "workflow_entry_not_regular", workflowRelativePath)
      reportedNonRegularWorkflowPaths.add(workflowPath)
    }
    if (workflowRelativeToDirectory !== REQUIRED_DB_PUSH_WORKFLOW) {
      addError(errors, "unexpected_workflow_file", workflowRelativePath)
    }
  }
  for (const workflowPath of workflowNonRegularEntries) {
    if (reportedNonRegularWorkflowPaths.has(workflowPath)) continue
    addError(errors, "workflow_entry_not_regular", relative(resolvedRoot, workflowPath))
  }
  const workflowFiles = workflowYamlEntries
    .filter(({ stat }) => stat?.isFile())
    .map(({ path }) => path)
  for (const workflowPath of workflowFiles) {
    const workflow = await readFile(workflowPath, "utf8")
    const workflowRelativePath = relative(resolvedRoot, workflowPath)
    if (
      workflow.includes("supabase/pending-migrations/notification-cutover") ||
      EXPECTED_SQL.some(([file]) => workflow.includes(file))
    ) {
      addError(errors, "db_push_workflow_references_quarantine", workflowRelativePath)
    }

    const lines = workflow.split(/\r?\n/)
    const unfoldedLineContinuations = workflow.replace(/\\\r?\n\s*/g, " ")
    if (
      unfoldedLineContinuations !== workflow &&
      /\bsupabase\s+db\s+push\b/i.test(unfoldedLineContinuations)
    ) {
      addError(errors, "db_push_line_continuation_present", workflowRelativePath)
    }
    if (
      lines.some((line) => {
        const command = line.trim().replace(/^run:\s*/, "")
        return /(?:^|\s)(?:node|bun|deno|bash|sh|zsh)?\s*(?:\.\/)?scripts\/[A-Za-z0-9_./-]+/.test(
          command,
        ) && command !== "node scripts/verify-supabase-migration-layout.mjs"
      })
    ) {
      addError(errors, "db_push_workflow_wrapper_invocation_present", workflowRelativePath)
    }
    if (
      workflow.includes("--workdir") ||
      lines.some((line) => /^\s*working-directory\s*:/.test(line)) ||
      lines.some((line) => /^\s*continue-on-error\s*:\s*true\s*(?:#.*)?$/i.test(line)) ||
      lines.some((line) => /^\s*if\s*:\s*(?:false|\$\{\{\s*false\s*\}\})\s*(?:#.*)?$/i.test(line)) ||
      lines.some((line) => /^(?:cp|mv|rsync)\b/.test(line.trim().replace(/^run:\s*/, "")))
    ) {
      addError(errors, "db_push_workflow_layout_bypass", workflowRelativePath)
    }

    const exactVerifierLines = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /^\s*run:\s*node scripts\/verify-supabase-migration-layout\.mjs\s*$/.test(line))
      .map(({ index }) => index)
    const exactPushLines = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /^\s*run:\s*supabase db push --linked --include-all\s*$/.test(line))
      .map(({ index }) => index)

    if (workflowPath !== requiredWorkflowPath) {
      if (/\bsupabase\s+db\s+push\b/i.test(unfoldedLineContinuations)) {
        addError(errors, "db_push_outside_required_workflow", workflowRelativePath)
      }
      continue
    }

    for (const line of lines) {
      if (!line.includes("supabase db push")) continue
      const command = line.trim().replace(/^run:\s*/, "")
      if (command !== "supabase db push --linked --include-all") {
        addError(errors, "db_push_command_not_exact", workflowRelativePath)
      }
    }
    if (exactVerifierLines.length !== 1) {
      addError(errors, "layout_verifier_command_count_mismatch", workflowRelativePath)
    }
    if (exactPushLines.length !== 1) {
      addError(errors, "db_push_command_count_mismatch", workflowRelativePath)
    }
    if (
      exactVerifierLines.length === 1 &&
      exactPushLines.length === 1 &&
      (
        exactVerifierLines[0] >= exactPushLines[0] ||
        hasJobBoundary(lines, exactVerifierLines[0], exactPushLines[0])
      )
    ) {
      addError(errors, "db_push_without_prior_layout_verifier", workflowRelativePath)
    }
  }

  return errors
}

const isDirectCli = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isDirectCli) {
  const errors = await validateSupabaseMigrationLayout()
  if (errors.length > 0) {
    for (const error of errors) console.error(`Supabase 마이그레이션 레이아웃 오류: ${error}`)
    process.exitCode = 1
  } else {
    console.log("Supabase migration layout verified.")
  }
}
