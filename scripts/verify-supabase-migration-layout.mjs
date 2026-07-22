import { createHash } from "node:crypto"
import { lstat, readdir, readFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const defaultRepoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const QUARANTINE_RELATIVE_PATH = join("supabase", "pending-migrations", "notification-cutover")
const ACTIVE_RELATIVE_PATH = join("supabase", "migrations")
const WORKFLOWS_RELATIVE_PATH = join(".github", "workflows")
const REQUIRED_DB_PUSH_WORKFLOW = "supabase-db-push.yml"
const REQUIRED_DB_PUSH_WORKFLOW_SHA256 = "e9fe479cf6c90e5a1681532c88b8ce378a72456c801744582cc04bf850b135f1"
const SCIENCE_MIGRATION_FILE = "20260722120000_science_notification_connection.sql"
const SCIENCE_MIGRATION_SHA256 = "ce0ca95663fe2a7dd5ae54ebad6b09ae315dbed548bbc074185230907441dd46"
const QUARANTINE_README_SHA256 = "62e387da1575982f154427f5f3ed001ffdb8c9c832744cdb79a45fd3f0ee905f"
const DRAIN_MARKER = "notification_contract_drain_not_complete"

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

async function listWorkflowFiles(root) {
  const files = []

  async function visit(path) {
    const entries = await listDirectory(path)
    if (entries === null) return
    for (const entry of entries.sort()) {
      const entryPath = join(path, entry)
      const stat = await statKind(entryPath)
      if (stat?.isDirectory()) {
        await visit(entryPath)
      } else if (stat?.isFile() && /\.ya?ml$/i.test(entry)) {
        files.push(entryPath)
      }
    }
  }

  await visit(root)
  return files
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
  for (const [file] of EXPECTED_SQL) {
    const activePath = join(activeDir, file)
    if (await statKind(activePath)) {
      addError(errors, "cutover_sql_present_in_active_lane", relative(resolvedRoot, activePath))
    }
  }
  const activeSqlEntries = ((await listDirectory(activeDir)) ?? [])
    .filter((entry) => /\.sql$/i.test(entry))
    .sort()
  const activeSqlSources = []
  for (const entry of activeSqlEntries) {
    const entryPath = join(activeDir, entry)
    const stat = await statKind(entryPath)
    if (!stat?.isFile()) {
      addError(errors, "active_migration_entry_not_regular", relative(resolvedRoot, entryPath))
      continue
    }
    const source = await readFile(entryPath)
    activeSqlSources.push({ entryPath, source: source.toString("utf8") })
    const timestamp = entry.match(/^(\d{14})/)?.[1]
    if (timestamp && quarantineTimestamps.has(timestamp)) {
      addError(errors, "cutover_timestamp_reused_in_active_lane", relative(resolvedRoot, entryPath))
    }
    if (quarantineHashes.has(sha256(source))) {
      addError(errors, "cutover_sql_hash_present_in_active_lane", relative(resolvedRoot, entryPath))
    }
    if (markerCount(source.toString("utf8")) > 0) {
      addError(errors, "drain_marker_present_in_active_lane", relative(resolvedRoot, entryPath))
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

  for (const contract of SCIENCE_SUPERSEDING_CONTRACTS) {
    let finalDefinition = null
    let finalDefinitionPath = relative(resolvedRoot, activeDir)
    for (const { entryPath, source } of activeSqlSources) {
      for (const definition of functionDefinitionSources(source, contract.function)) {
        finalDefinition = definition
        finalDefinitionPath = relative(resolvedRoot, entryPath)
      }
    }
    if (
      finalDefinition === null ||
      !contract.markers.every((marker) => finalDefinition.includes(marker))
    ) {
      addError(
        errors,
        "science_final_definition_mismatch",
        `${finalDefinitionPath}#${contract.function}`,
      )
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
    addError(errors, "required_db_push_workflow_hash_mismatch", relative(resolvedRoot, requiredWorkflowPath))
  }
  for (const entry of (await listDirectory(workflowsDir)) ?? []) {
    if (!/\.ya?ml$/i.test(entry)) continue
    const entryPath = join(workflowsDir, entry)
    const stat = await statKind(entryPath)
    if (!stat?.isFile()) {
      addError(errors, "workflow_entry_not_regular", relative(resolvedRoot, entryPath))
    }
  }
  const workflowFiles = await listWorkflowFiles(workflowsDir)
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
      if (workflow.includes("supabase db push")) {
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
