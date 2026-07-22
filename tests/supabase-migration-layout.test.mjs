import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  appendFile,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test, { after } from "node:test"

import * as migrationLayoutVerifier from "../scripts/verify-supabase-migration-layout.mjs"

const { validateSupabaseMigrationLayout } = migrationLayoutVerifier

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const activeDir = join(repoRoot, "supabase", "migrations")
const quarantineDir = join(repoRoot, "supabase", "pending-migrations", "notification-cutover")
const requiredWorkflowPath = join(repoRoot, ".github", "workflows", "supabase-db-push.yml")
const fixtureRoots = []
const REQUIRED_DB_PUSH_WORKFLOW_SHA256 = "0c278043f29b67b24035a9fc03f72247739ee59cd89f6b84b846913c568004ca"
const PREPARE_ACL_MIGRATION_FILE = "20260722130000_notification_prepare_acl_hardening.sql"
const PREPARE_ACL_MIGRATION_SHA256 = "970d203f816736b05ed56d973d415a75e00e2f659f55f84c7831c60db8c261a3"
const CLAIM_RECONCILE_BASELINE_FILE = "20260716112000_notification_control_plane_worker_rpc.sql"
const CLAIM_RECONCILE_BASELINE_SHA256 = "4ab9c5f48f018d655c000e1898057df8d13883eaeeee00974cb4760bdb615250"

const EXPECTED_SQL = Object.freeze([
  ["20260716195000_notification_workflow_legacy_closure.sql", "e9131131f0d9419a4a8fdf5d69a58a1047a41583f98d9ef7b5b376374ee52975"],
  ["20260716195500_notification_worker_schedule.sql", "f9f335e00bb3bba815019dcf5ce73905c8de883db90ec7c99d35ae99d2609696"],
  ["20260716195800_notification_registration_provider_claim.sql", "c682f44b0c851e49b7cec14e703ee7504bdd19b8be2416a49fc8112058826877"],
  ["20260716195900_notification_control_plane_forward_compat.sql", "054914802ac9d0d9475fd18f2b52deb7bfd27552a3b92b7b5331c6d35003ee11"],
  ["20260716196000_notification_shadow_fixture_runner.sql", "ef3ebb3a345bc734343526655fd614f51a8415dbc3a87ce1a60e8e76aa91ebd1"],
  ["20260717145304_notification_shadow_deterministic_evidence.sql", "610c1ce889aa5d7deb29a5d48186976a400774a75e347f600386068af1744833"],
])

// Intentionally duplicated here instead of importing verifier constants: changing the
// production allowlist must not silently rewrite the regression oracle.
const EXPECTED_LEXICAL_SQL = Object.freeze([
  [EXPECTED_SQL[0][0], "487e14d495cd227017a46876813a00f17ac63b2891ca5c7f307292624341d6b3"],
  [EXPECTED_SQL[1][0], "7d5062926dc7cc0f0f5602f58bd717ef2b26e304896b94587feadc4311b7abcd"],
  [EXPECTED_SQL[2][0], "a47121124beffff10de5a42c1a7935b1abe000890b25ecbfc0dad638e1c33b37"],
  [EXPECTED_SQL[3][0], "35c66056658cc2a6a8e776aff2a20f90f66a06d1ba2b73f6e6b47087e673b76c"],
  [EXPECTED_SQL[4][0], "aa8be81d5fec7b5073979720a0b69a20aa3e1827adfba61e98428e7c58296caa"],
  [EXPECTED_SQL[5][0], "593a3d9ab88dab5deb79e33b7eeb3604cf59bec9891c18b5125d73b028e44cda"],
])

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex")
}

async function createRepoFixture() {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "tips-supabase-migration-layout-"))
  fixtureRoots.push(fixtureRoot)
  await Promise.all([
    cp(join(repoRoot, ".github"), join(fixtureRoot, ".github"), { recursive: true }),
    cp(join(repoRoot, "supabase"), join(fixtureRoot, "supabase"), { recursive: true }),
  ])
  return fixtureRoot
}

function assertIncludesErrorCode(errors, code) {
  assert.ok(
    errors.some((error) => error.includes(code)),
    `expected ${code}, received ${JSON.stringify(errors)}`,
  )
}

function assertIncludesErrorForFile(errors, code, file) {
  assert.ok(
    errors.some((error) => error.includes(code) && error.includes(file)),
    `expected ${code} for ${file}, received ${JSON.stringify(errors)}`,
  )
}

function semanticOnlyMutation(source, index) {
  let mutated = source
    .replace(/\bbegin;/i, `/* semantic copy ${index} /* nested */ boundary */\nBEGIN ;`)
    .replace(/\bcommit;/i, "COMMIT ;")

  if (index === 0) {
    mutated = mutated.replace(
      "dashboard_private.notification_contract_closures",
      '"dashboard_private"."notification_contract_closures"',
    )

    const delimiterMatch = mutated.match(/\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)
    if (delimiterMatch) {
      const openingIndex = delimiterMatch.index
      const opening = delimiterMatch[0]
      const closingIndex = mutated.indexOf(opening, openingIndex + opening.length)
      assert.notEqual(closingIndex, -1, "fixture dollar quote must be balanced")
      mutated = `${mutated.slice(0, openingIndex)}$semantic_copy$${mutated.slice(
        openingIndex + opening.length,
        closingIndex,
      )}$semantic_copy$${mutated.slice(closingIndex + opening.length)}`
    }
  }

  return `${mutated}\n-- trailing semantic-only comment\n`
}

function workflowWithEarlySecretScope({
  workflowEnvLines = [],
  jobEnvLines = [],
  preflightEnvLines = [],
  verifierEnvLines = [],
  beforeVerifierLines = [],
} = {}) {
  return [
    "name: Secret Scope Regression",
    "",
    "on: workflow_dispatch",
    ...workflowEnvLines,
    "",
    "jobs:",
    "  db-push:",
    "    runs-on: ubuntu-latest",
    ...jobEnvLines,
    "    steps:",
    "      - name: Checkout",
    "        uses: actions/checkout@v4",
    "",
    ...beforeVerifierLines,
    ...(beforeVerifierLines.length > 0 ? [""] : []),
    "      - name: Test Supabase migration boundary",
    ...preflightEnvLines,
    "        run: node --test tests/supabase-migration-layout.test.mjs",
    "",
    "      - name: Verify Supabase migration layout",
    ...verifierEnvLines,
    "        run: node scripts/verify-supabase-migration-layout.mjs",
    "",
    "      - name: Push migrations",
    "        env:",
    "          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}",
    "          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}",
    "        run: supabase db push --linked --include-all",
    "",
  ].join("\n")
}

after(async () => {
  await Promise.all(fixtureRoots.map((fixtureRoot) => rm(fixtureRoot, { force: true, recursive: true })))
})

test("cutover SQL은 active lane 밖의 immutable quarantine에만 존재한다", async () => {
  const errors = await validateSupabaseMigrationLayout({ repoRoot })
  assert.deepEqual(errors, [])
  const requiredWorkflow = await readFile(requiredWorkflowPath, "utf8")
  assert.ok(
    requiredWorkflow.includes(
      [
        "      - name: Test Supabase migration boundary",
        "        run: node --test tests/supabase-migration-layout.test.mjs",
        "",
        "      - name: Verify Supabase migration layout",
        "        run: node scripts/verify-supabase-migration-layout.mjs",
      ].join("\n"),
    ),
    "focused boundary test must run secret-free immediately before the verifier",
  )
  assert.ok(
    requiredWorkflow.includes(
      [
        "      - name: Link project",
        "        env:",
        "          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}",
        "          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}",
        '        run: supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"',
      ].join("\n"),
    ),
    "non-interactive link must receive both required secrets only at the link step",
  )
  assert.equal(await sha256(requiredWorkflowPath), REQUIRED_DB_PUSH_WORKFLOW_SHA256)
  assert.equal(
    await sha256(join(activeDir, PREPARE_ACL_MIGRATION_FILE)),
    PREPARE_ACL_MIGRATION_SHA256,
  )
  for (const [file, digest] of EXPECTED_SQL) {
    assert.equal(await sha256(join(quarantineDir, file)), digest)
    await assert.rejects(readFile(join(activeDir, file)))
  }
})

test("quarantine SQL과 manifest 변조를 fail-closed로 거부한다", async () => {
  const hashFixture = await createRepoFixture()
  const hashQuarantineDir = join(hashFixture, "supabase", "pending-migrations", "notification-cutover")
  await appendFile(join(hashQuarantineDir, EXPECTED_SQL[0][0]), "\n")
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: hashFixture }),
    "cutover_sql_hash_mismatch",
  )

  const symlinkFixture = await createRepoFixture()
  const symlinkQuarantineDir = join(symlinkFixture, "supabase", "pending-migrations", "notification-cutover")
  await symlink(EXPECTED_SQL[0][0], join(symlinkQuarantineDir, "unexpected-cutover-link.sql"))
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: symlinkFixture }),
    "quarantine_entry_not_regular",
  )

  const manifestFixture = await createRepoFixture()
  const manifestPath = join(
    manifestFixture,
    "supabase",
    "pending-migrations",
    "notification-cutover",
    "manifest.json",
  )
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  manifest.unexpectedPolicy = "allowed"
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: manifestFixture }),
    "manifest_top_level_keys_mismatch",
  )

  const readmeFixture = await createRepoFixture()
  const readmePath = join(
    readmeFixture,
    "supabase",
    "pending-migrations",
    "notification-cutover",
    "README.md",
  )
  await appendFile(readmePath, "\n직접 적용 가능\n")
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: readmeFixture }),
    "quarantine_readme_hash_mismatch",
  )
})

test("active lane의 이름 변경, hash 복제, timestamp 재사용을 거부한다", async () => {
  const activeFixture = await createRepoFixture()
  const activeQuarantineDir = join(activeFixture, "supabase", "pending-migrations", "notification-cutover")
  const activeMigrationDir = join(activeFixture, "supabase", "migrations")
  await copyFile(join(activeQuarantineDir, EXPECTED_SQL[0][0]), join(activeMigrationDir, EXPECTED_SQL[0][0]))
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: activeFixture }),
    "cutover_sql_present_in_active_lane",
  )

  const renamedFixture = await createRepoFixture()
  const renamedQuarantineDir = join(
    renamedFixture,
    "supabase",
    "pending-migrations",
    "notification-cutover",
  )
  const renamedActiveDir = join(renamedFixture, "supabase", "migrations")
  await copyFile(
    join(renamedQuarantineDir, EXPECTED_SQL[1][0]),
    join(renamedActiveDir, "20990101000000_renamed_cutover.sql"),
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: renamedFixture }),
    "cutover_sql_hash_present_in_active_lane",
  )

  const timestampFixture = await createRepoFixture()
  const timestampActiveDir = join(timestampFixture, "supabase", "migrations")
  await writeFile(
    join(timestampActiveDir, "20260716195800_placeholder.sql"),
    "select 1;\n",
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: timestampFixture }),
    "cutover_timestamp_reused_in_active_lane",
  )
})

test("SQL lexical normalizer의 six-file fingerprint를 독립 상수로 고정한다", async () => {
  assert.equal(typeof migrationLayoutVerifier.normalizedSqlSha256, "function")

  for (const [file, expectedDigest] of EXPECTED_LEXICAL_SQL) {
    const source = await readFile(join(quarantineDir, file), "utf8")
    assert.equal(
      migrationLayoutVerifier.normalizedSqlSha256(source),
      expectedDigest,
      `${file} lexical fingerprint drifted`,
    )
  }

  assert.equal(
    migrationLayoutVerifier.normalizedSqlSha256(
      "SELECT public.lower_name /* layout comment */, $body$ BEGIN RETURN 1; END $body$;",
    ),
    migrationLayoutVerifier.normalizedSqlSha256(
      'select "public"."lower_name", $renamed$ BEGIN RETURN 1; END $renamed$ ;',
    ),
    "outer comments, whitespace, unquoted case, lowercase quoted identifiers, and dollar tags normalize",
  )
  assert.equal(
    migrationLayoutVerifier.normalizedSqlSha256("select $본문$ BEGIN RETURN 1; END $본문$;"),
    migrationLayoutVerifier.normalizedSqlSha256("select $body$ BEGIN RETURN 1; END $body$;"),
    "valid non-ASCII dollar tags normalize like ASCII tags",
  )
  assert.notEqual(
    migrationLayoutVerifier.normalizedSqlSha256("select $body$ BEGIN RETURN 1; END $body$;"),
    migrationLayoutVerifier.normalizedSqlSha256("select $body$ begin return 1; end $body$;"),
    "generic dollar body bytes remain opaque",
  )
  assert.doesNotThrow(() =>
    migrationLayoutVerifier.normalizedSqlSha256("select $$O'Reilly$$::text;"))
  assert.notEqual(
    migrationLayoutVerifier.normalizedSqlSha256("select 'Customer_Message';"),
    migrationLayoutVerifier.normalizedSqlSha256("select 'customer_message';"),
    "string literal case remains semantic",
  )
  for (const [upperPrefix, lowerPrefix, literal] of [
    ["E", "e", "'\\\\n'"],
    ["B", "b", "'1010'"],
    ["X", "x", "'0f'"],
  ]) {
    assert.equal(
      migrationLayoutVerifier.normalizedSqlSha256(`select ${upperPrefix}${literal};`),
      migrationLayoutVerifier.normalizedSqlSha256(`select ${lowerPrefix}${literal};`),
      `${upperPrefix} prefix case normalizes`,
    )
    assert.notEqual(
      migrationLayoutVerifier.normalizedSqlSha256(`select ${upperPrefix}${literal};`),
      migrationLayoutVerifier.normalizedSqlSha256(`select ${upperPrefix} ${literal};`),
      `${upperPrefix} prefix adjacency remains semantic`,
    )
  }
  for (const unsupportedUnicodeEscape of [
    "select U&'notification_cutover';",
    'select U&"notification_contract_closures";',
  ]) {
    assert.throws(
      () => migrationLayoutVerifier.normalizedSqlSha256(unsupportedUnicodeEscape),
      /unsupported U& escape form/,
    )
  }
  assert.doesNotThrow(() =>
    migrationLayoutVerifier.normalizedSqlSha256("select E'\\'';"))
  assert.doesNotThrow(() =>
    migrationLayoutVerifier.normalizedSqlSha256("select E'\\\\\\\\';"))
  assert.throws(
    () => migrationLayoutVerifier.normalizedSqlSha256("select '\\'';"),
    /unterminated string literal/,
    "plain strings do not inherit E-string backslash quote escaping",
  )
  assert.notEqual(
    migrationLayoutVerifier.normalizedSqlSha256('select "CaseSensitive";'),
    migrationLayoutVerifier.normalizedSqlSha256("select casesensitive;"),
    "case-sensitive quoted identifiers remain semantic",
  )
  assert.notEqual(
    migrationLayoutVerifier.normalizedSqlSha256("select 1 <> 2;"),
    migrationLayoutVerifier.normalizedSqlSha256("select 1 < > 2;"),
    "longest-match operator adjacency remains semantic",
  )
  assert.notEqual(
    migrationLayoutVerifier.normalizedSqlSha256("select value !~~* pattern;"),
    migrationLayoutVerifier.normalizedSqlSha256("select value !~ ~* pattern;"),
    "custom PostgreSQL operator runs use longest-match tokenization",
  )
  assert.equal(
    migrationLayoutVerifier.normalizedSqlSha256("select 1 +-- comment\n2;"),
    migrationLayoutVerifier.normalizedSqlSha256("select 1 + 2;"),
    "comment openers terminate an adjacent operator run",
  )
  assert.equal(
    migrationLayoutVerifier.normalizedSqlSha256("select 1; -- comment\rselect 2;"),
    migrationLayoutVerifier.normalizedSqlSha256("select 1; select 2;"),
    "a lone carriage return terminates a line comment",
  )
})

test("six cutover SQL의 comment, whitespace, case, quote, dollar-tag 근접 복제를 lexical hash로 거부한다", async () => {
  const fixtureRoot = await createRepoFixture()
  const fixtureQuarantineDir = join(
    fixtureRoot,
    "supabase",
    "pending-migrations",
    "notification-cutover",
  )
  const fixtureActiveDir = join(fixtureRoot, "supabase", "migrations")
  const copiedFiles = []

  for (const [[sourceFile], index] of EXPECTED_LEXICAL_SQL.map((entry, index) => [entry, index])) {
    const copiedFile = `2099010100000${index}_semantic_copy_${index}.sql`
    const source = await readFile(join(fixtureQuarantineDir, sourceFile), "utf8")
    await writeFile(join(fixtureActiveDir, copiedFile), semanticOnlyMutation(source, index))
    copiedFiles.push(copiedFile)
  }

  const errors = await validateSupabaseMigrationLayout({ repoRoot: fixtureRoot })
  for (const copiedFile of copiedFiles) {
    assertIncludesErrorForFile(
      errors,
      "cutover_sql_semantic_hash_present_in_active_lane",
      copiedFile,
    )
  }
})

test("cutover reserved marker와 activation marker는 substantive mutation 뒤에도 fail-closed다", async () => {
  const fixtureRoot = await createRepoFixture()
  const fixtureQuarantineDir = join(
    fixtureRoot,
    "supabase",
    "pending-migrations",
    "notification-cutover",
  )
  const fixtureActiveDir = join(fixtureRoot, "supabase", "migrations")
  const mutations = [
    [EXPECTED_SQL[0][0], "20990102000000_mutated_legacy_closure.sql", ["notification_contract_drain_not_complete", "notification_contract_drain_incomplete"]],
    [EXPECTED_SQL[1][0], "20990102000001_mutated_worker_schedule.sql", ["notification-worker-route-v1", "notification-worker-route-v2"]],
    [EXPECTED_SQL[2][0], "20990102000002_mutated_provider_operator.sql", ["delivery.channel_key <> 'customer_message'", "not (delivery.channel_key = 'customer_message')"]],
    [EXPECTED_SQL[2][0], "20990102000003_mutated_provider_error.sql", ["notification_customer_message_specialized_executor_required", "notification_customer_message_executor_required"]],
    [EXPECTED_SQL[3][0], "20990102000004_mutated_forward_compat.sql", ["notification_control_plane_forward_compat_runtime_version", "notification_control_plane_forward_compat_runtime_version_v2"]],
    [EXPECTED_SQL[4][0], "20990102000005_mutated_shadow_fixture.sql", ["notification-shadow-scope-evidence-v2", "notification-shadow-scope-evidence-v3"]],
    [EXPECTED_SQL[5][0], "20990102000006_mutated_deterministic_evidence.sql", ["notification-shadow-deterministic-cycle-request-v3", "notification-shadow-deterministic-cycle-request-v4"]],
  ]

  for (const [sourceFile, destinationFile, [before, after]] of mutations) {
    const source = await readFile(join(fixtureQuarantineDir, sourceFile), "utf8")
    assert.ok(source.includes(before), `${sourceFile} must contain mutation target ${before}`)
    await writeFile(join(fixtureActiveDir, destinationFile), source.replaceAll(before, after))
  }

  const errors = await validateSupabaseMigrationLayout({ repoRoot: fixtureRoot })
  for (const [, destinationFile] of mutations) {
    assert.ok(
      errors.some(
        (error) =>
          error.includes(destinationFile) &&
          [
            "cutover_reserved_object_present_in_active_lane",
            "cutover_activation_marker_present_in_active_lane",
            "cutover_semantic_marker_threshold_exceeded",
            "cutover_marker_allowlist_mismatch",
          ].some((code) => error.includes(code)),
      ),
      `expected marker defense for ${destinationFile}, received ${JSON.stringify(errors)}`,
    )
  }
})

test("claim/reconcile baseline marker는 각각 exact path와 raw hash에만 허용한다", async () => {
  assert.equal(
    await sha256(join(activeDir, CLAIM_RECONCILE_BASELINE_FILE)),
    CLAIM_RECONCILE_BASELINE_SHA256,
  )

  const driftFixture = await createRepoFixture()
  await appendFile(
    join(driftFixture, "supabase", "migrations", CLAIM_RECONCILE_BASELINE_FILE),
    "\n-- semantic no-op raw drift\n",
  )
  assertIncludesErrorForFile(
    await validateSupabaseMigrationLayout({ repoRoot: driftFixture }),
    "cutover_marker_allowlist_mismatch",
    CLAIM_RECONCILE_BASELINE_FILE,
  )

  const renameFixture = await createRepoFixture()
  const renamedBaselineFile = "20990103000000_renamed_claim_reconcile_baseline.sql"
  await copyFile(
    join(renameFixture, "supabase", "migrations", CLAIM_RECONCILE_BASELINE_FILE),
    join(renameFixture, "supabase", "migrations", renamedBaselineFile),
  )
  assertIncludesErrorForFile(
    await validateSupabaseMigrationLayout({ repoRoot: renameFixture }),
    "cutover_marker_allowlist_mismatch",
    renamedBaselineFile,
  )

  const splitFixture = await createRepoFixture()
  const splitFile = "20990103000001_split_claim_rpc.sql"
  await writeFile(
    join(splitFixture, "supabase", "migrations", splitFile),
    "select claim_notification_deliveries_v1();\n",
  )
  assertIncludesErrorForFile(
    await validateSupabaseMigrationLayout({ repoRoot: splitFixture }),
    "cutover_marker_allowlist_mismatch",
    splitFile,
  )
})

test("comment-only cutover marker는 무시하고 malformed SQL은 fail-closed다", async () => {
  const commentsFixture = await createRepoFixture()
  await writeFile(
    join(commentsFixture, "supabase", "migrations", "20990104000000_comment_only_markers.sql"),
    `-- dashboard_private.notification_contract_closures
/* public.notification_workflow_legacy_closure_version */
select 'notification-shadow-scope-evidence-v2';
`,
  )
  assert.deepEqual(await validateSupabaseMigrationLayout({ repoRoot: commentsFixture }), [])

  const thresholdFixture = await createRepoFixture()
  const thresholdFile = "20990104000001_family_threshold.sql"
  await writeFile(
    join(thresholdFixture, "supabase", "migrations", thresholdFile),
    "select 'notification-shadow-scope-evidence-v2', 'natural_traffic_required';\n",
  )
  assertIncludesErrorForFile(
    await validateSupabaseMigrationLayout({ repoRoot: thresholdFixture }),
    "cutover_semantic_marker_threshold_exceeded",
    thresholdFile,
  )

  const activationFixture = await createRepoFixture()
  const activationFile = "20990104000002_activation_marker.sql"
  await writeFile(
    join(activationFixture, "supabase", "migrations", activationFile),
    "select 'app.notification_cutover_activation_authorized';\n",
  )
  assertIncludesErrorForFile(
    await validateSupabaseMigrationLayout({ repoRoot: activationFixture }),
    "cutover_activation_marker_present_in_active_lane",
    activationFile,
  )

  const malformedFixture = await createRepoFixture()
  const malformedFiles = [
    ["20990104000003_unterminated_string.sql", "select 'unterminated;\n"],
    ["20990104000004_unterminated_identifier.sql", 'select "unterminated;\n'],
    ["20990104000005_unterminated_comment.sql", "select 1; /* unterminated\n"],
    ["20990104000006_unterminated_dollar.sql", "do $body$ begin null; end;\n"],
    [
      "20990104000007_nested_unsupported_escape.sql",
      "do $body$ begin perform U&'unsupported'; end $body$;\n",
    ],
    [
      "20990104000008_malformed_execute_sql.sql",
      "do $body$ begin execute 'select ''unterminated'; end $body$;\n",
    ],
  ]
  for (const [file, source] of malformedFiles) {
    await writeFile(join(malformedFixture, "supabase", "migrations", file), source)
  }
  const malformedErrors = await validateSupabaseMigrationLayout({ repoRoot: malformedFixture })
  for (const [file] of malformedFiles) {
    assertIncludesErrorForFile(
      malformedErrors,
      "active_migration_sql_normalization_failed",
      file,
    )
  }
})

test("equivalent marker encoding과 unqualified reserved object 우회를 거부한다", async () => {
  const fixtureRoot = await createRepoFixture()
  const fixtureActiveDir = join(fixtureRoot, "supabase", "migrations")
  const encodedMarkers = [
    [
      "20990105000000_escape_activation.sql",
      "select E'app.notification_cutover_activation_authoriz\\x65d';\n",
      "cutover_activation_marker_present_in_active_lane",
    ],
    [
      "20990105000001_dollar_activation.sql",
      "select $$app.notification_cutover_activation_authorized$$;\n",
      "cutover_activation_marker_present_in_active_lane",
    ],
    [
      "20990105000002_concatenated_activation.sql",
      "select 'app.notification_cutover_'\n'activation_authorized';\n",
      "cutover_activation_marker_present_in_active_lane",
    ],
    [
      "20990105000003_unqualified_reserved.sql",
      "set search_path = dashboard_private, public; select * from notification_contract_closures;\n",
      "cutover_reserved_object_present_in_active_lane",
    ],
    [
      "20990105000004_unicode_escape_reserved.sql",
      'select * from dashboard_private.U&"notification_contract_closur\\0065s";\n',
      "active_migration_sql_normalization_failed",
    ],
    [
      "20990105000005_do_activation.sql",
      "do $body$ begin perform public.activate_notification_dispatch_cutover_v1(); end $body$;\n",
      "cutover_activation_marker_present_in_active_lane",
    ],
    [
      "20990105000006_function_activation.sql",
      `create function public.marker_probe()
returns void language plpgsql as $function$
begin
  perform public.activate_notification_dispatch_cutover_v1();
end
$function$;
`,
      "cutover_activation_marker_present_in_active_lane",
    ],
    [
      "20990105000007_procedure_activation.sql",
      `create or replace procedure public.marker_probe_procedure()
language plpgsql
as $procedure$
begin
  perform public.activate_notification_dispatch_cutover_v1();
end
$procedure$;
`,
      "cutover_activation_marker_present_in_active_lane",
    ],
    [
      "20990105000008_do_escape_body_activation.sql",
      "do E'begin perform public.activate_notification_dispatch_cutover_v1(); end';\n",
      "cutover_activation_marker_present_in_active_lane",
    ],
    [
      "20990105000009_function_string_body_activation.sql",
      `create function public.marker_probe_string()
returns void language plpgsql
as 'begin perform public.activate_notification_dispatch_cutover_v1(); end';
`,
      "cutover_activation_marker_present_in_active_lane",
    ],
  ]
  for (const [file, source] of encodedMarkers) {
    await writeFile(join(fixtureActiveDir, file), source)
  }
  const errors = await validateSupabaseMigrationLayout({ repoRoot: fixtureRoot })
  for (const [file, , errorCode] of encodedMarkers) {
    assertIncludesErrorForFile(errors, errorCode, file)
  }

  const opaqueDollarFixture = await createRepoFixture()
  await writeFile(
    join(opaqueDollarFixture, "supabase", "migrations", "20990105000010_opaque_text.sql"),
    `select
  $$O'Reilly$$::text,
  $$dashboard_private.notification_contract_closures$$::text,
  $$begin perform public.activate_notification_dispatch_cutover_v1(); end$$::text,
  E'begin perform public.activate_notification_dispatch_cutover_v1(); end'::text;
`,
  )
  assert.deepEqual(await validateSupabaseMigrationLayout({ repoRoot: opaqueDollarFixture }), [])
})

test("executable dollar body의 static EXECUTE literal marker를 거부한다", async () => {
  const fixtureRoot = await createRepoFixture()
  const fixtureActiveDir = join(fixtureRoot, "supabase", "migrations")
  const executeMarkers = [
    [
      "20990105100000_execute_string_reserved.sql",
      `do $body$
begin
  execute 'create table dashboard_private.notification_contract_closures (id bigint)';
end
$body$;
`,
      "cutover_reserved_object_present_in_active_lane",
    ],
    [
      "20990105100001_execute_dollar_activation.sql",
      `do $body$
begin
  execute $query$select public.activate_notification_dispatch_cutover_v1()$query$;
end
$body$;
`,
      "cutover_activation_marker_present_in_active_lane",
    ],
    [
      "20990105100002_execute_escape_activation.sql",
      `do $body$
begin
  execute E'select public.activate_notification_dispatch_cutover_v1\\x28\\x29';
end
$body$;
`,
      "cutover_activation_marker_present_in_active_lane",
    ],
  ]
  for (const [file, source] of executeMarkers) {
    await writeFile(join(fixtureActiveDir, file), source)
  }

  const errors = await validateSupabaseMigrationLayout({ repoRoot: fixtureRoot })
  for (const [file, , errorCode] of executeMarkers) {
    assertIncludesErrorForFile(errors, errorCode, file)
  }
})

test("non-routine CREATE의 function identifier와 dollar text는 opaque하게 유지한다", async () => {
  const fixtureRoot = await createRepoFixture()
  await writeFile(
    join(fixtureRoot, "supabase", "migrations", "20990105200000_view_dollar_text.sql"),
    `create view public.marker_probe_view("function") as
select $$begin perform public.activate_notification_dispatch_cutover_v1(); end$$::text;
`,
  )

  assert.deepEqual(await validateSupabaseMigrationLayout({ repoRoot: fixtureRoot }), [])
})

test("science superseding migration의 바이트와 contract를 고정한다", async () => {
  const scienceFixture = await createRepoFixture()
  const scienceMigrationPath = join(
    scienceFixture,
    "supabase",
    "migrations",
    "20260722120000_science_notification_connection.sql",
  )
  await appendFile(scienceMigrationPath, "\n-- drift\n")
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: scienceFixture }),
    "science_superseding_migration_hash_mismatch",
  )

  const quotedFixture = await createRepoFixture()
  await writeFile(
    join(quotedFixture, "supabase", "migrations", "20260723100000_quoted_legacy.sql"),
    `CREATE OR REPLACE FUNCTION public."revalidate_immediate_notification_delivery_v1"()
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
`,
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: quotedFixture }),
    "science_final_definition_mismatch",
  )

  const dropFixture = await createRepoFixture()
  await writeFile(
    join(dropFixture, "supabase", "migrations", "20260723100001_drop_legacy.sql"),
    "DROP FUNCTION public.prepare_notification_immediate_delivery_v1;\n",
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: dropFixture }),
    "science_final_definition_mismatch",
  )

  const commentMarkerFixture = await createRepoFixture()
  await writeFile(
    join(commentMarkerFixture, "supabase", "migrations", "20260723100002_comment_markers.sql"),
    `CREATE OR REPLACE FUNCTION public.revalidate_immediate_notification_delivery_v1()
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
-- when 'google_chat.science' then 'science'
-- v_delivery.audience_key = 'subject_team'
`,
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: commentMarkerFixture }),
    "science_final_definition_mismatch",
  )
})

test("prepare ACL migration만 science 이후 protected function 참조로 허용한다", async () => {
  const backdatedFixture = await createRepoFixture()
  const backdatedFile = "20260722115959_backdated_drop_protected_function.sql"
  await writeFile(
    join(backdatedFixture, "supabase", "migrations", backdatedFile),
    "drop function public.prepare_notification_immediate_delivery_v1;\n",
  )
  assertIncludesErrorForFile(
    await validateSupabaseMigrationLayout({ repoRoot: backdatedFixture }),
    "science_final_definition_mismatch",
    backdatedFile,
  )

  const missingFixture = await createRepoFixture()
  await rm(join(missingFixture, "supabase", "migrations", PREPARE_ACL_MIGRATION_FILE))
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: missingFixture }),
    "notification_prepare_acl_migration_not_regular",
  )

  const driftFixture = await createRepoFixture()
  await appendFile(
    join(driftFixture, "supabase", "migrations", PREPARE_ACL_MIGRATION_FILE),
    "\n-- drift\n",
  )
  const driftErrors = await validateSupabaseMigrationLayout({ repoRoot: driftFixture })
  assertIncludesErrorCode(driftErrors, "notification_prepare_acl_migration_hash_mismatch")
  assertIncludesErrorCode(driftErrors, "notification_prepare_acl_migration_contract_mismatch")
  assertIncludesErrorCode(driftErrors, "science_final_definition_mismatch")

  for (const forbiddenStatement of [
    "CREATE FUNCTION public.prepare_notification_immediate_delivery_v1() RETURNS void LANGUAGE sql AS $$ SELECT $$;",
    "CREATE OR REPLACE FUNCTION public.prepare_notification_immediate_delivery_v1() RETURNS void LANGUAGE sql AS $$ SELECT $$;",
    "DROP FUNCTION public.prepare_notification_immediate_delivery_v1();",
    "UPDATE dashboard_private.notification_runtime_flags SET enabled = true;",
  ]) {
    const contentFixture = await createRepoFixture()
    await appendFile(
      join(contentFixture, "supabase", "migrations", PREPARE_ACL_MIGRATION_FILE),
      `\n${forbiddenStatement}\n`,
    )
    const contentErrors = await validateSupabaseMigrationLayout({ repoRoot: contentFixture })
    assertIncludesErrorCode(contentErrors, "notification_prepare_acl_migration_hash_mismatch")
    assertIncludesErrorCode(contentErrors, "notification_prepare_acl_migration_contract_mismatch")
    assertIncludesErrorCode(contentErrors, "science_final_definition_mismatch")
  }

  for (const protectedFunction of [
    "public.prepare_notification_immediate_delivery_v1",
    "public.revalidate_immediate_notification_delivery_v1",
  ]) {
    const laterFixture = await createRepoFixture()
    await writeFile(
      join(laterFixture, "supabase", "migrations", `20260722140000_${protectedFunction.split(".").at(-1)}.sql`),
      `-- ${protectedFunction}\nselect 1;\n`,
    )
    assertIncludesErrorCode(
      await validateSupabaseMigrationLayout({ repoRoot: laterFixture }),
      "science_final_definition_mismatch",
    )
  }

  const renamedFixture = await createRepoFixture()
  await copyFile(
    join(renamedFixture, "supabase", "migrations", PREPARE_ACL_MIGRATION_FILE),
    join(renamedFixture, "supabase", "migrations", "20260722140001_renamed_acl.sql"),
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: renamedFixture }),
    "science_final_definition_mismatch",
  )
})

test("required DB push workflow의 실파일, exact command, 순서를 강제한다", async () => {
  const missingRootFixture = await createRepoFixture()
  await rm(join(missingRootFixture, ".github", "workflows"), { recursive: true })
  const missingRootErrors = await validateSupabaseMigrationLayout({ repoRoot: missingRootFixture })
  assertIncludesErrorCode(missingRootErrors, "workflow_directory_not_regular")
  assertIncludesErrorCode(missingRootErrors, "required_db_push_workflow_not_regular")

  const missingWorkflowFixture = await createRepoFixture()
  await rm(join(missingWorkflowFixture, ".github", "workflows", "supabase-db-push.yml"))
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: missingWorkflowFixture }),
    "required_db_push_workflow_not_regular",
  )

  const symlinkWorkflowFixture = await createRepoFixture()
  const symlinkWorkflowPath = join(
    symlinkWorkflowFixture,
    ".github",
    "workflows",
    "supabase-db-push.yml",
  )
  await rm(symlinkWorkflowPath)
  await symlink("missing-workflow.yml", symlinkWorkflowPath)
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: symlinkWorkflowFixture }),
    "required_db_push_workflow_not_regular",
  )

  const topLevelSymlinkFixture = await createRepoFixture()
  await symlink(
    "supabase-db-push.yml",
    join(topLevelSymlinkFixture, ".github", "workflows", "linked.yml"),
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: topLevelSymlinkFixture }),
    "workflow_entry_not_regular",
  )

  const siblingWorkflowFixture = await createRepoFixture()
  const siblingWorkflowFile = join(siblingWorkflowFixture, ".github", "workflows", "other.yml")
  await writeFile(
    siblingWorkflowFile,
    "name: Harmless sibling\non: workflow_dispatch\njobs: {}\n",
  )
  const siblingWorkflowErrors = await validateSupabaseMigrationLayout({
    repoRoot: siblingWorkflowFixture,
  })
  assertIncludesErrorCode(siblingWorkflowErrors, "workflow_file_set_mismatch")
  assertIncludesErrorForFile(siblingWorkflowErrors, "unexpected_workflow_file", "other.yml")

  const nestedWorkflowFixture = await createRepoFixture()
  const nestedWorkflowDir = join(nestedWorkflowFixture, ".github", "workflows", "nested")
  await mkdir(nestedWorkflowDir)
  await writeFile(
    join(nestedWorkflowDir, "wrapper.yaml"),
    "name: Nested wrapper\non: workflow_dispatch\njobs:\n  push:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node ./scripts/db-wrapper.mjs\n",
  )
  const nestedWorkflowErrors = await validateSupabaseMigrationLayout({
    repoRoot: nestedWorkflowFixture,
  })
  assertIncludesErrorCode(nestedWorkflowErrors, "workflow_file_set_mismatch")
  assertIncludesErrorForFile(
    nestedWorkflowErrors,
    "unexpected_workflow_file",
    "nested/wrapper.yaml",
  )
  assertIncludesErrorForFile(
    nestedWorkflowErrors,
    "db_push_workflow_wrapper_invocation_present",
    "nested/wrapper.yaml",
  )

  const symlinkDirectoryFixture = await createRepoFixture()
  const symlinkTargetDir = join(symlinkDirectoryFixture, ".github", "workflow-link-target")
  await mkdir(symlinkTargetDir)
  await writeFile(
    join(symlinkTargetDir, "hidden.yml"),
    "name: Hidden\non: workflow_dispatch\njobs: {}\n",
  )
  await symlink(
    "../workflow-link-target",
    join(symlinkDirectoryFixture, ".github", "workflows", "nested-link"),
  )
  const symlinkDirectoryErrors = await validateSupabaseMigrationLayout({
    repoRoot: symlinkDirectoryFixture,
  })
  assertIncludesErrorCode(symlinkDirectoryErrors, "workflow_file_set_mismatch")
  assertIncludesErrorForFile(
    symlinkDirectoryErrors,
    "workflow_entry_not_regular",
    "nested-link",
  )

  const workflowFixture = await createRepoFixture()
  const workflowPath = join(workflowFixture, ".github", "workflows", "supabase-db-push.yml")
  const workflow = await readFile(workflowPath, "utf8")
  const verifierLine = /^.*node scripts\/verify-supabase-migration-layout\.mjs.*(?:\n|$)/m
  assert.match(workflow, verifierLine)
  await writeFile(workflowPath, workflow.replace(verifierLine, ""))
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: workflowFixture }),
    "layout_verifier_command_count_mismatch",
  )

  const ignoredVerifierFixture = await createRepoFixture()
  const ignoredVerifierPath = join(
    ignoredVerifierFixture,
    ".github",
    "workflows",
    "supabase-db-push.yml",
  )
  const ignoredVerifierWorkflow = await readFile(ignoredVerifierPath, "utf8")
  await writeFile(
    ignoredVerifierPath,
    ignoredVerifierWorkflow.replace(
      "run: node scripts/verify-supabase-migration-layout.mjs",
      "run: node scripts/verify-supabase-migration-layout.mjs || true",
    ),
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: ignoredVerifierFixture }),
    "layout_verifier_command_count_mismatch",
  )

  const wrapperPushFixture = await createRepoFixture()
  const wrapperPushPath = join(wrapperPushFixture, ".github", "workflows", "supabase-db-push.yml")
  const wrapperPushWorkflow = await readFile(wrapperPushPath, "utf8")
  await writeFile(
    wrapperPushPath,
    wrapperPushWorkflow.replace(
      "run: supabase db push --linked --include-all",
      "run: node ./scripts/db-wrapper.mjs",
    ),
  )
  const wrapperPushErrors = await validateSupabaseMigrationLayout({ repoRoot: wrapperPushFixture })
  assertIncludesErrorCode(wrapperPushErrors, "required_db_push_workflow_hash_mismatch")
  assertIncludesErrorCode(wrapperPushErrors, "db_push_workflow_wrapper_invocation_present")
  assertIncludesErrorCode(wrapperPushErrors, "db_push_command_count_mismatch")

  const continuedPushFixture = await createRepoFixture()
  const continuedPushPath = join(
    continuedPushFixture,
    ".github",
    "workflows",
    "supabase-db-push.yml",
  )
  const continuedPushWorkflow = await readFile(continuedPushPath, "utf8")
  await writeFile(
    continuedPushPath,
    continuedPushWorkflow.replace(
      "run: supabase db push --linked --include-all",
      "run: |\n          supabase db \\\n            push --linked --include-all",
    ),
  )
  const continuedPushErrors = await validateSupabaseMigrationLayout({
    repoRoot: continuedPushFixture,
  })
  assertIncludesErrorCode(continuedPushErrors, "required_db_push_workflow_hash_mismatch")
  assertIncludesErrorCode(continuedPushErrors, "db_push_line_continuation_present")
  assertIncludesErrorCode(continuedPushErrors, "db_push_command_count_mismatch")

  const verifierIfFixture = await createRepoFixture()
  const verifierIfPath = join(verifierIfFixture, ".github", "workflows", "supabase-db-push.yml")
  const verifierIfWorkflow = await readFile(verifierIfPath, "utf8")
  await writeFile(
    verifierIfPath,
    verifierIfWorkflow.replace(
      "      - name: Verify Supabase migration layout\n",
      "      - name: Verify Supabase migration layout\n        if: false\n",
    ),
  )
  const verifierIfErrors = await validateSupabaseMigrationLayout({ repoRoot: verifierIfFixture })
  assertIncludesErrorCode(verifierIfErrors, "required_db_push_workflow_hash_mismatch")
  assertIncludesErrorCode(verifierIfErrors, "db_push_workflow_layout_bypass")

  const continueFixture = await createRepoFixture()
  const continuePath = join(continueFixture, ".github", "workflows", "supabase-db-push.yml")
  const continueWorkflow = await readFile(continuePath, "utf8")
  await writeFile(
    continuePath,
    continueWorkflow.replace(
      "      - name: Verify Supabase migration layout\n",
      "      - name: Verify Supabase migration layout\n        continue-on-error: true\n",
    ),
  )
  const continueErrors = await validateSupabaseMigrationLayout({ repoRoot: continueFixture })
  assertIncludesErrorCode(continueErrors, "required_db_push_workflow_hash_mismatch")
  assertIncludesErrorCode(continueErrors, "db_push_workflow_layout_bypass")

  const workingDirectoryFixture = await createRepoFixture()
  const workingDirectoryPath = join(
    workingDirectoryFixture,
    ".github",
    "workflows",
    "supabase-db-push.yml",
  )
  const workingDirectoryWorkflow = await readFile(workingDirectoryPath, "utf8")
  await writeFile(
    workingDirectoryPath,
    workingDirectoryWorkflow.replace(
      "      - name: Push migrations\n",
      "      - name: Push migrations\n        working-directory: supabase/pending-migrations/notification-cutover\n",
    ),
  )
  const workingDirectoryErrors = await validateSupabaseMigrationLayout({
    repoRoot: workingDirectoryFixture,
  })
  assertIncludesErrorCode(workingDirectoryErrors, "required_db_push_workflow_hash_mismatch")
  assertIncludesErrorCode(workingDirectoryErrors, "db_push_workflow_layout_bypass")

  const otherJobFixture = await createRepoFixture()
  const otherJobPath = join(otherJobFixture, ".github", "workflows", "supabase-db-push.yml")
  const otherJobWorkflow = await readFile(otherJobPath, "utf8")
  await writeFile(
    otherJobPath,
    otherJobWorkflow
      .replace(/^.*node scripts\/verify-supabase-migration-layout\.mjs.*(?:\n|$)/m, "")
      .replace(
        "jobs:\n",
        "jobs:\n  \"layout-only\":\n    runs-on: ubuntu-latest\n    steps:\n      - name: Verify layout\n        run: node scripts/verify-supabase-migration-layout.mjs\n",
      ),
  )
  const otherJobErrors = await validateSupabaseMigrationLayout({ repoRoot: otherJobFixture })
  assertIncludesErrorCode(otherJobErrors, "required_db_push_workflow_hash_mismatch")
  assertIncludesErrorCode(otherJobErrors, "db_push_without_prior_layout_verifier")

  const externalPushFixture = await createRepoFixture()
  await writeFile(
    join(externalPushFixture, ".github", "workflows", "other.yml"),
    "name: Other\non: workflow_dispatch\njobs:\n  push:\n    runs-on: ubuntu-latest\n    steps:\n      - run: supabase db push --linked --include-all\n",
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: externalPushFixture }),
    "db_push_outside_required_workflow",
  )
})

test("required DB push workflow는 verifier 성공 전 Supabase secret scope를 fail-closed로 거부한다", async () => {
  const secretNames = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"]
  const cases = []

  for (const secretName of secretNames) {
    const secretExpression = `\${{ secrets.${secretName} }}`
    cases.push(
      {
        name: `workflow-level ${secretName}`,
        source: workflowWithEarlySecretScope({
          workflowEnvLines: ["env:", `  ${secretName}: ${secretExpression}`],
        }),
      },
      {
        name: `job-level ${secretName}`,
        source: workflowWithEarlySecretScope({
          jobEnvLines: ["    env:", `      ${secretName}: ${secretExpression}`],
        }),
      },
      {
        name: `preflight-step ${secretName}`,
        source: workflowWithEarlySecretScope({
          preflightEnvLines: ["        env:", `          ${secretName}: ${secretExpression}`],
        }),
      },
      {
        name: `verifier-step ${secretName}`,
        source: workflowWithEarlySecretScope({
          verifierEnvLines: ["        env:", `          ${secretName}: ${secretExpression}`],
        }),
      },
    )
  }

  cases.push(
    {
      name: "multiline verifier expression",
      source: workflowWithEarlySecretScope({
        verifierEnvLines: [
          "        env:",
          "          SUPABASE_ACCESS_TOKEN: >-",
          "            ${{ secrets.SUPABASE_ACCESS_TOKEN }}",
        ],
      }),
    },
    {
      name: "YAML alias with bracket secret expression",
      source: workflowWithEarlySecretScope({
        jobEnvLines: [
          "    env: &supabase-secret-env",
          "      SUPABASE_DB_PASSWORD: ${{ secrets['SUPABASE_DB_PASSWORD'] }}",
        ],
        verifierEnvLines: ["        env: *supabase-secret-env"],
      }),
    },
    {
      name: "GITHUB_ENV indirection before verifier",
      source: workflowWithEarlySecretScope({
        beforeVerifierLines: [
          "      - name: Export secret before verifier",
          "        env:",
          "          EARLY_TOKEN: ${{ secrets['SUPABASE_ACCESS_TOKEN'] }}",
          "        shell: bash",
          "        run: |",
          '          echo "SUPABASE_ACCESS_TOKEN=${EARLY_TOKEN}" >> "${GITHUB_ENV}"',
        ],
      }),
    },
    {
      name: "secret validation step reordered before verifier",
      source: workflowWithEarlySecretScope({
        beforeVerifierLines: [
          "      - name: Validate required secrets",
          "        env:",
          "          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}",
          "          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}",
          "        run: test -n \"${SUPABASE_ACCESS_TOKEN}\" && test -n \"${SUPABASE_DB_PASSWORD}\"",
        ],
      }),
    },
  )

  const fixtureRoot = await createRepoFixture()
  const workflowPath = join(fixtureRoot, ".github", "workflows", "supabase-db-push.yml")
  for (const { name, source } of cases) {
    await writeFile(workflowPath, source)
    const errors = await validateSupabaseMigrationLayout({ repoRoot: fixtureRoot })
    assertIncludesErrorCode(errors, "db_push_workflow_secret_scope_mismatch")
    assert.ok(errors.length > 0, `${name} must be rejected`)
  }
})
