import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  appendFile,
  chmod,
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
const isolatedRunnerUrl = new URL("../scripts/run-isolated-supabase-db-tests.mjs", import.meta.url)
const activeDir = join(repoRoot, "supabase", "migrations")
const quarantineDir = join(repoRoot, "supabase", "pending-migrations", "notification-cutover")
const requiredWorkflowPath = join(repoRoot, ".github", "workflows", "supabase-db-push.yml")
const fixtureRoots = []
const REQUIRED_DB_PUSH_WORKFLOW_SHA256 = "fcf365e8305c6995ceaec22f49b6d8be2d27d07f667f686159f485e083ad0067"
const POSTDEPLOY_READONLY_SQL_SHA256 =
  "f1259e7c299163de88dc2e865e489df7dd6ef3f2bc21c93cfe0e12f3ebc115be"
const FOCUSED_PGTAP_PATH =
  "supabase/tests/registration_level_test_result_parent_reconciliation_test.sql"
const LINKED_MIGRATION_LEDGER_PATH = "\${RUNNER_TEMP}/supabase-migration-list.txt"
const PINNED_SUPABASE_CLI_VERSION = "2.115.0"
const PINNED_SUPABASE_CLI_ARCHIVE_SHA256 =
  "ff099608ce758b625532ef03a61f4c9520b995e94ff6cd5480dc0428cad64cb3"
const PREPARE_ACL_MIGRATION_FILE = "20260722130000_notification_prepare_acl_hardening.sql"
const PREPARE_ACL_MIGRATION_SHA256 = "970d203f816736b05ed56d973d415a75e00e2f659f55f84c7831c60db8c261a3"
const CLAIM_RECONCILE_BASELINE_FILE = "20260716112000_notification_control_plane_worker_rpc.sql"
const CLAIM_RECONCILE_BASELINE_SHA256 = "4ab9c5f48f018d655c000e1898057df8d13883eaeeee00974cb4760bdb615250"
const PROCESSING_READINESS_PROBE_FILE =
  "20260806133000_registration_notification_processing_readiness.sql"
const PROCESSING_READINESS_PROBE_SHA256 =
  "4e6fcbafb63d48bcd547cecb19d050148776554fed1a56f58903039e61a569d8"
const ADAPTER_FORWARD_INSTALL_FILE = "20260812002019_notification_adapters_forward_install.sql"
const ADAPTER_FORWARD_INSTALL_SHA256 =
  "f0c22f18906d8a9bcaf2dbbdb682d4458682565ea756bb7e515c18aaeed3243a"
const WORKER_PRODUCTION_SCHEDULE_FILE =
  "20260812195130_notification_worker_production_schedule.sql"
const WORKER_PRODUCTION_SCHEDULE_SHA256 =
  "7b902a798422d6003c3f2bcd0ef5bf3c7f1b86597c92316601b17b810db48c94"
const REMOTE_HISTORY_ALIGNED_SQL = Object.freeze([
  ["20260730161538_notification_google_chat_connection_catalog.sql", "a3f72d4ec2a410796d5796019649859d5a329d5bec0e3e83f48242272dd88dda"],
  ["20260731011040_notification_transfer_withdrawal_deep_links.sql", "ed5dfb81c2cb5d1bc6dca5c38de62745c02d88b5a4b858ec57e8f0d2c6afb5ab"],
  ["20260731011229_notification_owner_aware_delivery_summary.sql", "eb06042e4e70e05d4fc745053dccc52ac01fa253928f3f04fa442f5ec9704b54"],
  ["20260807030434_registration_korean_template_renderer.sql", "53e0d49c96c9ea38418e082370755a071ab75d3d44fe7b12c6240eb44fd6945e"],
  ["20260807111442_registration_management_google_chat_dispatch.sql", "e367278104df0fad8d74e17cafd7eb0fd24baa90e32efb1cdec18e0cb8ac6b5b"],
  ["20260807125038_registration_customer_message_preview_target_rpc.sql", "3cb54293dbef73b0eccbc92e14bda2e7f51d2c51e0a55d927daa8192ce720f37"],
  ["20260808044202_registration_level_test_summary_consultation_chat.sql", "06f57db749b84e41d4647ce44d231633a1ad2f54da9b2149cd93bd33349990bb"],
  ["20260808050410_registration_director_retry_circuit_breaker.sql", "068349ad45c5c230a45c789d70fab3ce7b1c19e69ea6f958c68f921941048004"],
  ["20260808124315_registration_customer_message_subject_admission_details.sql", "c75e570cb032c5d4d7ec266b2128d103618a0490e293255aab6f688d71574ef0"],
  ["20260811142055_science_consultation_requests.sql", "340b7d2c8d53ade12c7a2f9df98669218826d56a8b6e02f920e897788378d547"],
  ["20260811142152_science_consultation_requests_deny_policy.sql", "e5abe58f49fe926eb3e35a4471cd9adb49c052f0d677453ffd0f48d80a88c491"],
  ["20260811142353_science_consultation_rate_limits.sql", "aa177ab5d3151d7f2fa55883f7efc8526999828ee5cbd210693f5ddafc09fc30"],
  ["20260819122006_registration_notion_style_editing.sql", "ff294e4d901d25d0c866b1045f6abedb5245172799c09d7d622de269a75a22ed"],
  ["20260819122911_registration_enrollment_external_correction.sql", "ef1885dfe3c8b964e4ca8994a9836ebc43220307c73fa315dface239aa0ce848"],
  ["20260819151002_registration_admission_preview_status_compatibility.sql", "c292103602b495efe7b6c49c3e92f7b92ebd264cf52d2d781871a3542c306eeb"],
  ["20260819152417_registration_admission_preview_active_resolver_status_compatibility.sql", "0f2653938f2f5726e7c4ed6c494fa8862230f8cd588208667cd9d9595cb98bd9"],
])
const OBSOLETE_REMOTE_HISTORY_SQL = Object.freeze([
  "20260730143000_notification_google_chat_connection_catalog.sql",
  "20260730143100_notification_transfer_withdrawal_deep_links.sql",
  "20260730143200_notification_owner_aware_delivery_summary.sql",
  "20260807025103_registration_korean_template_renderer.sql",
  "20260807110530_registration_management_google_chat_dispatch.sql",
  "20260807125500_registration_customer_message_preview_target_rpc.sql",
  "20260808043659_registration_level_test_summary_consultation_chat.sql",
  "20260808051000_registration_director_retry_circuit_breaker.sql",
  "20260808120425_registration_customer_message_subject_admission_details.sql",
  "20260819121351_registration_notion_style_editing.sql",
  "20260819122735_registration_enrollment_external_correction.sql",
  "20260819150944_registration_admission_preview_status_compatibility.sql",
  "20260819152328_registration_admission_preview_active_resolver_status_compatibility.sql",
])

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
  await mkdir(join(fixtureRoot, "scripts"), { recursive: true })
  await copyFile(
    join(repoRoot, "scripts", "verify-supabase-postdeploy-contract.mjs"),
    join(fixtureRoot, "scripts", "verify-supabase-postdeploy-contract.mjs"),
  )
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

function workflowWithTransactionalPreflight({
  staticJobEnvLines = [],
  transactionalNeeds = "db-preflight",
  transactionalSecretEnvLines = [
    "          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}",
    "          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}",
  ],
  linkSecretEnvLines = [
    "          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}",
    "          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}",
  ],
  builderCommand = `node scripts/build-supabase-transactional-preflight.mjs --output "\${RUNNER_TEMP}/supabase-transactional-preflight.sql" --migration-ledger "${LINKED_MIGRATION_LEDGER_PATH}" --forward-migrations supabase/migrations --focused-test ${FOCUSED_PGTAP_PATH} --rollback`,
  pgTapCommand = 'supabase test db --linked "${RUNNER_TEMP}/supabase-transactional-preflight.sql"',
  pushNeeds = "db-transactional-preflight",
} = {}) {
  const secretValidation = [
    "      - name: Validate required secrets",
    "        env:",
    ...transactionalSecretEnvLines,
    "        shell: bash",
    "        run: test -n \"${SUPABASE_ACCESS_TOKEN}\" && test -n \"${SUPABASE_DB_PASSWORD}\"",
    "",
  ]

  return [
    "name: Supabase migration preflight",
    "",
    "on: workflow_dispatch",
    "",
    "jobs:",
    "  db-preflight:",
    "    runs-on: ubuntu-latest",
    ...staticJobEnvLines,
    "    steps:",
    "      - name: Checkout",
    "        uses: actions/checkout@v4",
    "",
    "      - name: Test Supabase migration boundary",
    "        run: node --test tests/supabase-migration-layout.test.mjs",
    "",
    "      - name: Verify Supabase migration layout",
    "        run: node scripts/verify-supabase-migration-layout.mjs",
    "",
    "      - name: Verify domain SQLSTATE contract",
    "        run: node scripts/verify-domain-sqlstate-contract.mjs",
    "",
    "  db-transactional-preflight:",
    "    runs-on: ubuntu-latest",
    ...(transactionalNeeds ? [`    needs: ${transactionalNeeds}`] : []),
    "    steps:",
    "      - name: Checkout",
    "        uses: actions/checkout@v4",
    "",
    "      - name: Setup Supabase CLI",
    "        shell: bash",
    "        run: |",
    "          set -euo pipefail",
    `          version="${PINNED_SUPABASE_CLI_VERSION}"`,
    "          archive=\"supabase_${version}_linux_amd64.tar.gz\"",
    "          archive_path=\"${RUNNER_TEMP}/${archive}\"",
    "          curl --fail --location --silent --show-error --retry 5 --retry-all-errors --retry-delay 2 --output \"${archive_path}\" \"https://github.com/supabase/cli/releases/download/v${version}/${archive}\"",
    `          echo "${PINNED_SUPABASE_CLI_ARCHIVE_SHA256}  \${archive_path}" | sha256sum --check --strict`,
    "          mkdir -p \"${RUNNER_TEMP}/supabase-cli\"",
    "          tar -xzf \"${archive_path}\" -C \"${RUNNER_TEMP}/supabase-cli\"",
    "          echo \"${RUNNER_TEMP}/supabase-cli\" >> \"${GITHUB_PATH}\"",
    "",
    ...secretValidation,
    "      - name: Resolve Supabase project ref",
    "        run: project_ref=\"$(sed -n 's/^project_id = \\\"(.*)\\\"$/\\1/p' supabase/config.toml | head -n 1)\" && test -n \"${project_ref}\" && echo \"SUPABASE_PROJECT_REF=${project_ref}\" >> \"${GITHUB_ENV}\"",
    "",
    "      - name: Link project",
    "        env:",
    ...linkSecretEnvLines,
    '        run: supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"',
    "",
    "      - name: Capture linked migration ledger",
    `        run: supabase migration list --linked > "${LINKED_MIGRATION_LEDGER_PATH}"`,
    "",
    "      - name: Build transactional pgTAP input",
    `        run: ${builderCommand}`,
    "",
    "      - name: Run transactional focused pgTAP",
    `        run: ${pgTapCommand}`,
    "",
    "  db-push:",
    "    runs-on: ubuntu-latest",
    ...(pushNeeds ? [`    needs: ${pushNeeds}`] : []),
    "    steps:",
    "      - name: Checkout",
    "        uses: actions/checkout@v4",
    "",
    "      - name: Validate required secrets",
    "        env:",
    "          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}",
    "          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}",
    "        shell: bash",
    "        run: test -n \"${SUPABASE_ACCESS_TOKEN}\" && test -n \"${SUPABASE_DB_PASSWORD}\"",
    "",
    "      - name: Resolve Supabase project ref",
    "        run: project_ref=\"$(sed -n 's/^project_id = \\\"(.*)\\\"$/\\1/p' supabase/config.toml | head -n 1)\" && test -n \"${project_ref}\" && echo \"SUPABASE_PROJECT_REF=${project_ref}\" >> \"${GITHUB_ENV}\"",
    "",
    "      - name: Link project",
    "        env:",
    "          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}",
    "          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}",
    '        run: supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"',
    "",
    "      - name: Push migrations",
    "        env:",
    "          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}",
    "          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}",
    "        run: supabase db push --linked --include-all",
    "",
  ].join("\n")
}

async function validateWorkflowFixture(source) {
  const fixtureRoot = await createRepoFixture()
  await writeFile(join(fixtureRoot, ".github", "workflows", "supabase-db-push.yml"), source)
  return validateSupabaseMigrationLayout({ repoRoot: fixtureRoot })
}

after(async () => {
  await Promise.all(fixtureRoots.map((fixtureRoot) => rm(fixtureRoot, { force: true, recursive: true })))
})

test("원격 이력과 정렬한 migration identity와 바이트를 독립 상수로 고정한다", async () => {
  for (const [file, expectedHash] of REMOTE_HISTORY_ALIGNED_SQL) {
    let actualHash
    try {
      actualHash = await sha256(join(activeDir, file))
    } catch (error) {
      assert.fail(`expected remote-history-aligned migration ${file}: ${error.code ?? error.message}`)
    }
    assert.equal(actualHash, expectedHash, file)
  }

  for (const file of OBSOLETE_REMOTE_HISTORY_SQL) {
    await assert.rejects(
      readFile(join(activeDir, file)),
      (error) => error?.code === "ENOENT",
      `obsolete local timestamp must stay absent: ${file}`,
    )
  }
})

test("원격 이력 정렬 migration의 누락·변조·구 timestamp 재등장을 거부한다", async () => {
  const alignedFile = "20260819122006_registration_notion_style_editing.sql"
  const obsoleteFile = "20260819121351_registration_notion_style_editing.sql"
  assert.ok(
    REMOTE_HISTORY_ALIGNED_SQL.some(([file]) => file === alignedFile),
    `missing task-specific aligned fixture identity: ${alignedFile}`,
  )
  assert.ok(
    OBSOLETE_REMOTE_HISTORY_SQL.includes(obsoleteFile),
    `missing task-specific obsolete fixture identity: ${obsoleteFile}`,
  )

  const missingFixture = await createRepoFixture()
  await rm(join(missingFixture, "supabase", "migrations", alignedFile), { force: true })
  assertIncludesErrorForFile(
    await validateSupabaseMigrationLayout({ repoRoot: missingFixture }),
    "remote_history_aligned_migration_not_regular",
    alignedFile,
  )

  const hashFixture = await createRepoFixture()
  await appendFile(join(hashFixture, "supabase", "migrations", alignedFile), "\n")
  assertIncludesErrorForFile(
    await validateSupabaseMigrationLayout({ repoRoot: hashFixture }),
    "remote_history_aligned_migration_hash_mismatch",
    alignedFile,
  )

  const obsoleteFixture = await createRepoFixture()
  await copyFile(
    join(obsoleteFixture, "supabase", "migrations", alignedFile),
    join(obsoleteFixture, "supabase", "migrations", obsoleteFile),
  )
  assertIncludesErrorForFile(
    await validateSupabaseMigrationLayout({ repoRoot: obsoleteFixture }),
    "remote_history_obsolete_timestamp_present",
    obsoleteFile,
  )
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
        "      - name: Test transactional safety contracts",
        "        run: node --test tests/retryable-sqlstate-contract.test.mjs tests/supabase-transactional-preflight-builder.test.mjs",
        "",
        "      - name: Test Supabase post-push receipt",
        "        run: node --test tests/supabase-postdeploy-contract.test.mjs",
        "",
        "      - name: Verify Supabase migration layout",
        "        run: node scripts/verify-supabase-migration-layout.mjs",
        "",
        "      - name: Verify domain SQLSTATE contract",
        "        run: node scripts/verify-domain-sqlstate-contract.mjs",
      ].join("\n"),
    ),
    "static migration safety contracts must run secret-free before linked DB work",
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

test("required DB push workflow pins the reviewed Supabase CLI release", async () => {
  const requiredWorkflow = await readFile(requiredWorkflowPath, "utf8")
  const pinnedVersions = [...requiredWorkflow.matchAll(/^\s+version="([^"]+)"$/gm)]
    .map((match) => match[1])
  const pinnedChecksums = [...requiredWorkflow.matchAll(
    /^\s+echo "([0-9a-f]{64})  \$\{archive_path\}" \| sha256sum --check --strict$/gm,
  )].map((match) => match[1])

  assert.deepEqual(pinnedVersions, [PINNED_SUPABASE_CLI_VERSION, PINNED_SUPABASE_CLI_VERSION])
  assert.deepEqual(pinnedChecksums, [
    PINNED_SUPABASE_CLI_ARCHIVE_SHA256,
    PINNED_SUPABASE_CLI_ARCHIVE_SHA256,
  ])
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
  assert.equal(
    migrationLayoutVerifier.normalizedSqlSha256("select U&'\\FFFF';"),
    migrationLayoutVerifier.normalizedSqlSha256("select '\uFFFF';"),
    "default U& string escapes normalize to their semantic string value",
  )
  assert.throws(
    () => migrationLayoutVerifier.normalizedSqlSha256('select U&"notification_contract_closures";'),
    /unsupported U& escape form/,
  )
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

test("등록 처리 준비도 probe는 읽기 전용 원문과 exact path에만 허용한다", async () => {
  assert.equal(
    await sha256(join(activeDir, PROCESSING_READINESS_PROBE_FILE)),
    PROCESSING_READINESS_PROBE_SHA256,
  )

  const driftFixture = await createRepoFixture()
  await appendFile(
    join(driftFixture, "supabase", "migrations", PROCESSING_READINESS_PROBE_FILE),
    "\n-- semantic no-op raw drift\n",
  )
  assertIncludesErrorForFile(
    await validateSupabaseMigrationLayout({ repoRoot: driftFixture }),
    "cutover_reserved_object_present_in_active_lane",
    PROCESSING_READINESS_PROBE_FILE,
  )

  const renameFixture = await createRepoFixture()
  const renamedProbeFile = "20990103000002_renamed_registration_processing_readiness.sql"
  await copyFile(
    join(renameFixture, "supabase", "migrations", PROCESSING_READINESS_PROBE_FILE),
    join(renameFixture, "supabase", "migrations", renamedProbeFile),
  )
  assertIncludesErrorForFile(
    await validateSupabaseMigrationLayout({ repoRoot: renameFixture }),
    "cutover_reserved_object_present_in_active_lane",
    renamedProbeFile,
  )
})

test("adapter forward marker는 생성 migration의 exact path, byte hash, passive contract에만 허용한다", async () => {
  // Break caught: a broad marker exception lets a drifted migration or copied
  // quarantine source bypass the active-lane cutover boundary.
  assert.equal(
    await sha256(join(activeDir, ADAPTER_FORWARD_INSTALL_FILE)),
    ADAPTER_FORWARD_INSTALL_SHA256,
  )
  assert.deepEqual(await validateSupabaseMigrationLayout({ repoRoot }), [])

  const driftFixture = await createRepoFixture()
  await appendFile(
    join(driftFixture, "supabase", "migrations", ADAPTER_FORWARD_INSTALL_FILE),
    "\n-- raw forward migration drift\n",
  )
  assertIncludesErrorForFile(
    await validateSupabaseMigrationLayout({ repoRoot: driftFixture }),
    "cutover_reserved_object_present_in_active_lane",
    ADAPTER_FORWARD_INSTALL_FILE,
  )

  const tokenFixture = await createRepoFixture()
  const tokenPath = join(tokenFixture, "supabase", "migrations", ADAPTER_FORWARD_INSTALL_FILE)
  const tokenSource = await readFile(tokenPath, "utf8")
  await writeFile(
    tokenPath,
    tokenSource.replace(
      "notification_dispatch_scope_for_event_v1",
      "notification_dispatch_scope_for_event_v2",
    ),
  )
  assertIncludesErrorForFile(
    await validateSupabaseMigrationLayout({ repoRoot: tokenFixture }),
    "cutover_reserved_object_present_in_active_lane",
    ADAPTER_FORWARD_INSTALL_FILE,
  )

  const copiedQuarantineFixture = await createRepoFixture()
  const copiedFile = "20990103000003_copied_quarantine_worker.sql"
  await copyFile(
    join(copiedQuarantineFixture, "supabase", "pending-migrations", "notification-cutover", EXPECTED_SQL[1][0]),
    join(copiedQuarantineFixture, "supabase", "migrations", copiedFile),
  )
  assertIncludesErrorForFile(
    await validateSupabaseMigrationLayout({ repoRoot: copiedQuarantineFixture }),
    "cutover_reserved_object_present_in_active_lane",
    copiedFile,
  )
})

test("worker schedule marker는 current-schema exact migration에만 허용한다", async () => {
  assert.equal(
    await sha256(join(activeDir, WORKER_PRODUCTION_SCHEDULE_FILE)),
    WORKER_PRODUCTION_SCHEDULE_SHA256,
  )
  assert.deepEqual(await validateSupabaseMigrationLayout({ repoRoot }), [])

  const driftFixture = await createRepoFixture()
  await appendFile(
    join(driftFixture, "supabase", "migrations", WORKER_PRODUCTION_SCHEDULE_FILE),
    "\n-- worker schedule drift\n",
  )
  assertIncludesErrorForFile(
    await validateSupabaseMigrationLayout({ repoRoot: driftFixture }),
    "cutover_reserved_object_present_in_active_lane",
    WORKER_PRODUCTION_SCHEDULE_FILE,
  )

  const activationFixture = await createRepoFixture()
  const activationPath = join(
    activationFixture,
    "supabase",
    "migrations",
    WORKER_PRODUCTION_SCHEDULE_FILE,
  )
  await appendFile(
    activationPath,
    "\nselect public.activate_notification_dispatch_cutover_v1('registration','registration', '{}'::jsonb, gen_random_uuid());\n",
  )
  assertIncludesErrorForFile(
    await validateSupabaseMigrationLayout({ repoRoot: activationFixture }),
    "cutover_activation_marker_present_in_active_lane",
    WORKER_PRODUCTION_SCHEDULE_FILE,
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
      "do $body$ begin perform U&'\\12G4'; end $body$;\n",
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

test("required workflows reject mutable GitHub action references", async () => {
  const fixtureRoot = await createRepoFixture()
  const workflowNames = [
    "free-tier-guardrails.yml",
    "supabase-db-push.yml",
    "supabase-sql-review.yml",
  ]

  for (const workflowName of workflowNames) {
    const workflowPath = join(fixtureRoot, ".github", "workflows", workflowName)
    const source = await readFile(workflowPath, "utf8")
    assert.match(source, /actions\/checkout@/)
    assert.match(source, /actions\/setup-node@/)
    await writeFile(
      workflowPath,
      source
        .replaceAll(/actions\/checkout@[^\s#]+/g, "actions/checkout@v4")
        .replaceAll(/actions\/setup-node@[^\s#]+/g, "actions/setup-node@v4"),
    )
  }

  const errors = await validateSupabaseMigrationLayout({ repoRoot: fixtureRoot })
  for (const workflowName of workflowNames) {
    for (const actionName of ["actions/checkout", "actions/setup-node"]) {
      assert.ok(
        errors.some(
          (error) => error.includes("workflow_action_ref_not_approved")
            && error.includes(workflowName)
            && error.includes(actionName),
        ),
        `expected immutable ${actionName} enforcement for ${workflowName}, received ${JSON.stringify(errors)}`,
      )
    }
  }
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

  const mutatedGuardrailFixture = await createRepoFixture()
  await appendFile(
    join(mutatedGuardrailFixture, ".github", "workflows", "free-tier-guardrails.yml"),
    "\n# unreviewed workflow mutation\n",
  )
  assertIncludesErrorForFile(
    await validateSupabaseMigrationLayout({ repoRoot: mutatedGuardrailFixture }),
    "allowed_workflow_hash_mismatch",
    "free-tier-guardrails.yml",
  )

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

test("required SQL review workflow의 실파일과 바이트를 fail-closed로 고정한다", async () => {
  const missingWorkflowFixture = await createRepoFixture()
  await rm(join(missingWorkflowFixture, ".github", "workflows", "supabase-sql-review.yml"))
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: missingWorkflowFixture }),
    "required_sql_review_workflow_not_regular",
  )

  const mutatedWorkflowFixture = await createRepoFixture()
  await appendFile(
    join(mutatedWorkflowFixture, ".github", "workflows", "supabase-sql-review.yml"),
    "\n# unreviewed SQL review workflow mutation\n",
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: mutatedWorkflowFixture }),
    "required_sql_review_workflow_hash_mismatch",
  )
})

test("SQL review workflow는 PR base/head SHA로 immutable-final boundary를 호출한다", async () => {
  const workflow = await readFile(
    join(repoRoot, ".github", "workflows", "supabase-sql-review.yml"),
    "utf8",
  )
  assert.match(workflow, /      - name: Verify immutable final migrations\n/u)
  assert.match(workflow, /          BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}\n/u)
  assert.match(workflow, /          HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}\n/u)
  assert.match(
    workflow,
    /node scripts\/run-isolated-supabase-db-tests\.mjs \\\n\s+--review-head --require-final \\\n\s+--review-base-sha "\$\{BASE_SHA\}" --review-head-sha "\$\{HEAD_SHA\}"/u,
  )
  assert.match(
    workflow,
    /--test supabase\/tests\/notification_contract_drain_evidence_schema_repair_test\.sql/u,
  )
  assert.doesNotMatch(workflow, /secrets\./u)
})

test("immutable-final boundary는 Git history 부재를 argument-array 호출에서 fail-closed한다", async () => {
  const { validateImmutableFinalMigrationHistory } = await import(isolatedRunnerUrl.href)
  const baseSha = "a".repeat(40)
  const headSha = "b".repeat(40)
  let invocation
  await assert.rejects(
    validateImmutableFinalMigrationHistory({
      root: repoRoot,
      baseSha,
      headSha,
      executeGit: async (candidate) => {
        invocation = candidate
        return { code: 128, stdout: "", stderr: "fixture history unavailable" }
      },
    }),
    /isolated_supabase_db_review_history_unavailable/,
  )
  assert.equal(invocation.command, "git")
  assert.deepEqual(invocation.args, ["merge-base", baseSha, headSha])
  assert.equal(invocation.cwd, repoRoot)
})

test("SQL review workflow는 migration diff 실패를 no-change로 통과시키지 않는다", async (t) => {
  const workflow = await readFile(
    join(repoRoot, ".github", "workflows", "supabase-sql-review.yml"),
    "utf8",
  )
  const stepStart = workflow.indexOf("      - name: Lint changed migrations with Squawk\n")
  assert.notEqual(stepStart, -1, "SQL review migration lint step must exist")
  const runMatch = workflow.slice(stepStart).match(/^        run: \|\n((?: {10}.*(?:\n|$))*)/m)
  assert.ok(runMatch, "SQL review migration lint step must contain a bash script")
  const script = runMatch[1].replace(/^ {10}/gm, "")

  const tempRoot = await mkdtemp(join(tmpdir(), "tips-sql-review-diff-failure-"))
  t.after(() => rm(tempRoot, { recursive: true, force: true }))
  const binDir = join(tempRoot, "bin")
  await mkdir(binDir)
  const gitPath = spawnSync("which", ["git"], { encoding: "utf8" })
  assert.equal(gitPath.status, 0, gitPath.stderr)
  await writeFile(
    join(binDir, "git"),
    `#!/usr/bin/env bash\nif [[ "$1" == "diff" ]]; then\n  echo "forced migration diff failure" >&2\n  exit 73\nfi\nexec ${JSON.stringify(gitPath.stdout.trim())} "$@"\n`,
  )
  await chmod(join(binDir, "git"), 0o755)

  const scriptWithSuccessfulEmptyMapfile = `mapfile() { migration_files=(); return 0; }\n${script}`
  const result = spawnSync("bash", ["-c", scriptWithSuccessfulEmptyMapfile], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      BASE_SHA: "HEAD",
      HEAD_SHA: "HEAD",
      PATH: `${binDir}:${process.env.PATH}`,
      RUNNER_TEMP: tempRoot,
    },
  })
  assert.notEqual(result.status, 0, "migration diff failure must fail the workflow step")
  assert.match(result.stderr, /forced migration diff failure/)
  assert.doesNotMatch(result.stdout, /No added or modified Supabase migrations to lint\./)
})

test("SQL review workflow는 migration rename destination을 Squawk에 전달한다", async (t) => {
  const workflow = await readFile(
    join(repoRoot, ".github", "workflows", "supabase-sql-review.yml"),
    "utf8",
  )
  const stepStart = workflow.indexOf("      - name: Lint changed migrations with Squawk\n")
  assert.notEqual(stepStart, -1, "SQL review migration lint step must exist")
  const runMatch = workflow.slice(stepStart).match(/^        run: \|\n((?: {10}.*(?:\n|$))*)/m)
  assert.ok(runMatch, "SQL review migration lint step must contain a bash script")
  const script = runMatch[1].replace(/^ {10}/gm, "")

  const tempRoot = await mkdtemp(join(tmpdir(), "tips-sql-review-rename-"))
  t.after(() => rm(tempRoot, { recursive: true, force: true }))
  const repository = join(tempRoot, "repository")
  const migrations = join(repository, "supabase", "migrations")
  await mkdir(migrations, { recursive: true })
  const original = "supabase/migrations/20260824000000_unfinalized_name.sql"
  const renamed = "supabase/migrations/20260824000001_unfinalized_renamed.sql"
  await writeFile(join(repository, original), "select 1;\n")
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git(["init", "--quiet"])
  git(["add", "."])
  git(["-c", "user.name=Codex Test", "-c", "user.email=codex@example.invalid", "commit", "--quiet", "-m", "base"])
  const baseSha = git(["rev-parse", "HEAD"])
  git(["mv", original, renamed])
  git(["-c", "user.name=Codex Test", "-c", "user.email=codex@example.invalid", "commit", "--quiet", "-m", "rename"])
  const headSha = git(["rev-parse", "HEAD"])

  const squawkArgs = join(tempRoot, "squawk-args")
  const squawkPath = join(tempRoot, "squawk")
  await writeFile(
    squawkPath,
    "#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\0' \"$@\" > \"${SQUAWK_ARGS_FILE}\"\n",
  )
  await chmod(squawkPath, 0o755)
  const portableMapfile = "mapfile() { migration_files=(); while IFS= read -r -d '' migration_file; do migration_files+=(\"${migration_file}\"); done; }\n"
  const result = spawnSync("bash", ["-c", `${portableMapfile}${script}`], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      BASE_SHA: baseSha,
      HEAD_SHA: headSha,
      RUNNER_TEMP: tempRoot,
      SQUAWK_ARGS_FILE: squawkArgs,
    },
  })
  assert.equal(result.status, 0, result.stderr)
  const args = (await readFile(squawkArgs, "utf8")).split("\0").filter(Boolean)
  assert.deepEqual(args, ["--pg-version", "17", renamed])
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

test("required DB push workflow의 static preflight는 layout·verifier·SQLSTATE contract를 secret 없이 실행한다", async () => {
  const cases = [
    {
      name: "layout test is missing",
      source: workflowWithTransactionalPreflight().replace(
        "        run: node --test tests/supabase-migration-layout.test.mjs",
        "        run: node --test tests/other-layout.test.mjs",
      ),
      code: "db_push_workflow_static_preflight_layout_test_missing",
    },
    {
      name: "layout verifier is missing",
      source: workflowWithTransactionalPreflight().replace(
        "        run: node scripts/verify-supabase-migration-layout.mjs",
        "        run: node scripts/verify-other-layout.mjs",
      ),
      code: "db_push_workflow_static_preflight_layout_verifier_missing",
    },
    {
      name: "domain SQLSTATE verifier is missing",
      source: workflowWithTransactionalPreflight().replace(
        "        run: node scripts/verify-domain-sqlstate-contract.mjs",
        "        run: node scripts/verify-other-contract.mjs",
      ),
      code: "db_push_workflow_static_preflight_domain_sqlstate_contract_missing",
    },
    {
      name: "static job exposes a Supabase secret",
      source: workflowWithTransactionalPreflight({
        staticJobEnvLines: [
          "    env:",
          "      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}",
        ],
      }),
      code: "db_push_workflow_static_preflight_secret_scope_mismatch",
    },
  ]

  for (const { name, source, code } of cases) {
    const errors = await validateWorkflowFixture(source)
    assertIncludesErrorCode(errors, code)
    assert.ok(errors.length > 0, `${name} must be rejected`)
  }
})

test("required DB push workflow의 transactional preflight는 static preflight 뒤에 pinned CLI·link·단일 SQL builder·focused pgTAP을 실행한다", async () => {
  const defaultWorkflow = workflowWithTransactionalPreflight()
  const defaultBuilderCommand = defaultWorkflow.match(
    /^        run: (node scripts\/build-supabase-transactional-preflight[^\n]+)$/m,
  )[1]
  const cases = [
    {
      name: "transactional preflight does not depend on static preflight",
      source: workflowWithTransactionalPreflight({ transactionalNeeds: null }),
      code: "db_push_workflow_transactional_preflight_dependency_missing",
    },
    {
      name: "Supabase CLI version is not pinned",
      source: defaultWorkflow.replace(`version="${PINNED_SUPABASE_CLI_VERSION}"`, 'version="latest"'),
      code: "db_push_workflow_transactional_preflight_cli_pin_mismatch",
    },
    {
      name: "Supabase CLI archive checksum is not pinned",
      source: defaultWorkflow.replace(PINNED_SUPABASE_CLI_ARCHIVE_SHA256, "0".repeat(64)),
      code: "db_push_workflow_transactional_preflight_cli_pin_mismatch",
    },
    {
      name: "transactional preflight validates without Supabase secrets",
      source: workflowWithTransactionalPreflight({ transactionalSecretEnvLines: [] }),
      code: "db_push_workflow_transactional_preflight_secret_scope_mismatch",
    },
    {
      name: "transactional link does not receive Supabase secrets",
      source: workflowWithTransactionalPreflight({ linkSecretEnvLines: [] }),
      code: "db_push_workflow_transactional_preflight_link_secret_scope_mismatch",
    },
    {
      name: "forward migration input marker drifts",
      source: workflowWithTransactionalPreflight({
        builderCommand: `node scripts/build-supabase-transactional-preflight.mjs --output "\${RUNNER_TEMP}/supabase-transactional-preflight.sql" --migration-ledger "${LINKED_MIGRATION_LEDGER_PATH}" --forward-migrations supabase/pending-migrations --focused-test ${FOCUSED_PGTAP_PATH} --rollback`,
      }),
      code: "db_push_workflow_transactional_preflight_forward_migrations_mismatch",
    },
    {
      name: "linked migration ledger capture is skipped",
      source: workflowWithTransactionalPreflight().replace(
        `        run: supabase migration list --linked > "${LINKED_MIGRATION_LEDGER_PATH}"`,
        "        run: echo migration ledger skipped",
      ),
      code: "db_push_workflow_transactional_preflight_migration_ledger_missing",
    },
    {
      name: "builder does not consume linked migration ledger",
      source: workflowWithTransactionalPreflight({
        builderCommand: `node scripts/build-supabase-transactional-preflight.mjs --output "\${RUNNER_TEMP}/supabase-transactional-preflight.sql" --migration-ledger "\${LINKED_MIGRATION_LEDGER_PATH}" --forward-migrations supabase/migrations --focused-test ${FOCUSED_PGTAP_PATH} --rollback`,
      }),
      code: "db_push_workflow_transactional_preflight_migration_ledger_marker_mismatch",
    },
    {
      name: "builder does not require rollback envelope",
      source: workflowWithTransactionalPreflight({
        builderCommand: `node scripts/build-supabase-transactional-preflight.mjs --output "\${RUNNER_TEMP}/supabase-transactional-preflight.sql" --migration-ledger "${LINKED_MIGRATION_LEDGER_PATH}" --forward-migrations supabase/migrations --focused-test ${FOCUSED_PGTAP_PATH}`,
      }),
      code: "db_push_workflow_transactional_preflight_rollback_marker_missing",
    },
    {
      name: "builder script is skipped",
      source: workflowWithTransactionalPreflight({ builderCommand: "echo builder skipped" }),
      code: "db_push_workflow_transactional_preflight_builder_missing",
    },
    {
      name: "focused pgTAP path drifts in builder",
      source: workflowWithTransactionalPreflight({
        builderCommand: `node scripts/build-supabase-transactional-preflight.mjs --output "\${RUNNER_TEMP}/supabase-transactional-preflight.sql" --migration-ledger "${LINKED_MIGRATION_LEDGER_PATH}" --forward-migrations supabase/migrations --focused-test supabase/tests/other_test.sql --rollback`,
      }),
      code: "db_push_workflow_transactional_preflight_focus_path_mismatch",
    },
    {
      name: "focused pgTAP command is skipped",
      source: workflowWithTransactionalPreflight({ pgTapCommand: "echo pgTAP skipped" }),
      code: "db_push_workflow_transactional_preflight_pgtap_missing",
    },
    {
      name: "linked writer does not depend on transactional preflight",
      source: workflowWithTransactionalPreflight({ pushNeeds: null }),
      code: "db_push_workflow_push_dependency_missing",
    },
  ]

  for (const { name, source, code } of cases) {
    const errors = await validateWorkflowFixture(source)
    assertIncludesErrorCode(errors, code)
    assert.ok(errors.length > 0, `${name} must be rejected`)
  }

  const reordered = defaultWorkflow
    .replace(
      [
        "      - name: Build transactional pgTAP input",
        `        run: ${defaultBuilderCommand}`,
        "",
        "      - name: Run transactional focused pgTAP",
        '        run: supabase test db --linked "${RUNNER_TEMP}/supabase-transactional-preflight.sql"',
      ].join("\n"),
      [
        "      - name: Run transactional focused pgTAP",
        '        run: supabase test db --linked "${RUNNER_TEMP}/supabase-transactional-preflight.sql"',
        "",
        "      - name: Build transactional pgTAP input",
        `        run: ${defaultBuilderCommand}`,
      ].join("\n"),
    )
  const reorderedErrors = await validateWorkflowFixture(reordered)
  assertIncludesErrorCode(
    reorderedErrors,
    "db_push_workflow_transactional_preflight_order_mismatch",
  )
})

test("post-push receipt는 고정 read-only SQL과 fresh ledger·query·verifier 순서를 요구한다", async () => {
  const postdeploySqlPath = join(
    repoRoot,
    "supabase",
    "tests",
    "active_registration_workflow_postdeploy_readonly.sql",
  )
  const postdeployVerifierPath = join(
    repoRoot,
    "scripts",
    "verify-supabase-postdeploy-contract.mjs",
  )
  const [sqlExists, verifierExists] = await Promise.all([
    readFile(postdeploySqlPath, "utf8").then(() => true, () => false),
    readFile(postdeployVerifierPath, "utf8").then(() => true, () => false),
  ])
  assert.equal(sqlExists, true, "post-push catalog receipt SQL must exist")
  assert.equal(verifierExists, true, "post-push receipt verifier must exist")

  const [workflow, sql] = await Promise.all([
    readFile(requiredWorkflowPath, "utf8"),
    readFile(postdeploySqlPath, "utf8"),
  ])
  const pushIndex = workflow.indexOf("run: supabase db push --linked --include-all")
  const ledgerIndex = workflow.indexOf(
    'run: supabase migration list --linked > "${RUNNER_TEMP}/supabase-postdeploy-migration-list.txt"',
  )
  const queryIndex = workflow.indexOf(
    "run: supabase db query --linked --output json --file supabase/tests/active_registration_workflow_postdeploy_readonly.sql > \"${RUNNER_TEMP}/active-registration-workflow-postdeploy.json\"",
  )
  const verifierIndex = workflow.indexOf(
    'run: node scripts/verify-supabase-postdeploy-contract.mjs --migration-ledger "${RUNNER_TEMP}/supabase-postdeploy-migration-list.txt" --query-receipt "${RUNNER_TEMP}/active-registration-workflow-postdeploy.json"',
  )
  assert.ok(pushIndex < ledgerIndex && ledgerIndex < queryIndex && queryIndex < verifierIndex)
  assert.match(sql, /^begin transaction read only;$/imu)
  assert.match(sql, /^set local statement_timeout = '5s';$/imu)
  assert.match(sql, /^set local lock_timeout = '1s';$/imu)
  assert.match(sql, /\) as contract_ok;\s*rollback;\s*$/isu)
  assert.doesNotMatch(sql, /\b(?:insert|update|delete|merge|truncate|alter|drop|create|grant|revoke|cron\.|net\.)\b/iu)
})

test("postdeploy search_path predicate treats NULL proconfig as a contract failure", async () => {
  const sql = await readFile(
    join(
      repoRoot,
      "supabase",
      "tests",
      "active_registration_workflow_postdeploy_readonly.sql",
    ),
    "utf8",
  )

  assert.match(
    sql,
    /\(\s*pg_catalog\.cardinality\(proconfig\) = 1\s*and proconfig\[1\] in \('search_path=', 'search_path=""'\)\s*\) is distinct from true/iu,
    "NULL proconfig must fail the exact empty-search-path boundary",
  )
})

test("layout verifier pins every semantic predicate in the fixed postdeploy catalog query", async () => {
  const sqlPath = join(
    repoRoot,
    "supabase",
    "tests",
    "active_registration_workflow_postdeploy_readonly.sql",
  )
  const source = await readFile(sqlPath, "utf8")
  assert.equal(await sha256(sqlPath), POSTDEPLOY_READONLY_SQL_SHA256)
  const requiredPredicates = [
    ["public signature", "public.set_registration_workflow_status_v1(uuid,text,integer,text)"],
    ["private signature", "dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)"],
    ["delegation", "dashboard_private.set_registration_workflow_status_v1_impl%"],
    ["security modes", "is_private and not prosecdef"],
    ["owner", "pg_catalog.pg_get_userbyid(proowner) <> 'postgres'"],
    ["ACL", "'authenticated'"],
    ["denied roles", "'service_role'::name"],
    ["40001 predicate", "definition like '%40001%'"],
    ["23514 predicate", "definition not like '%23514%'"],
  ]

  for (const [name, predicate] of requiredPredicates) {
    const fixtureRoot = await createRepoFixture()
    const fixturePath = join(
      fixtureRoot,
      "supabase",
      "tests",
      "active_registration_workflow_postdeploy_readonly.sql",
    )
    await writeFile(fixturePath, source.replace(predicate, `removed_${name.replaceAll(" ", "_")}`))
    assertIncludesErrorCode(
      await validateSupabaseMigrationLayout({ repoRoot: fixtureRoot }),
      "postdeploy_contract_sql_hash_mismatch",
    )
  }
})

test("layout verifier는 post-push 영수증 누락·순서·시크릿 scope·미승인 artifact를 fail-closed한다", async () => {
  const cases = [
    {
      name: "ledger capture is missing",
      mutate: (workflow) => workflow.replace(
        'run: supabase migration list --linked > "${RUNNER_TEMP}/supabase-postdeploy-migration-list.txt"',
        "run: echo ledger skipped",
      ),
      code: "db_push_workflow_postdeploy_ledger_missing",
    },
    {
      name: "query runs before fresh ledger capture",
      mutate: (workflow) => workflow
        .replace(
          "      - name: Capture post-push linked migration ledger\n        env:\n          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}\n          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}\n        run: supabase migration list --linked > \"${RUNNER_TEMP}/supabase-postdeploy-migration-list.txt\"\n\n      - name: Capture active registration workflow contract",
          "      - name: Capture active registration workflow contract",
        )
        .replace(
          '        run: supabase db query --linked --output json --file supabase/tests/active_registration_workflow_postdeploy_readonly.sql > "${RUNNER_TEMP}/active-registration-workflow-postdeploy.json"',
          '        run: supabase db query --linked --output json --file supabase/tests/active_registration_workflow_postdeploy_readonly.sql > "${RUNNER_TEMP}/active-registration-workflow-postdeploy.json"\n\n      - name: Capture post-push linked migration ledger\n        env:\n          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}\n          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}\n        run: supabase migration list --linked > "${RUNNER_TEMP}/supabase-postdeploy-migration-list.txt"',
        ),
      code: "db_push_workflow_postdeploy_order_mismatch",
    },
    {
      name: "ledger capture runs before migration push",
      mutate: (workflow) => workflow.replace(
        "      - name: Push migrations\n        env:\n          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}\n          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}\n        run: supabase db push --linked --include-all\n\n      - name: Capture post-push linked migration ledger\n        env:\n          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}\n          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}\n        run: supabase migration list --linked > \"${RUNNER_TEMP}/supabase-postdeploy-migration-list.txt\"",
        "      - name: Capture post-push linked migration ledger\n        env:\n          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}\n          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}\n        run: supabase migration list --linked > \"${RUNNER_TEMP}/supabase-postdeploy-migration-list.txt\"\n\n      - name: Push migrations\n        env:\n          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}\n          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}\n        run: supabase db push --linked --include-all",
      ),
      code: "db_push_workflow_postdeploy_order_mismatch",
    },
    {
      name: "verifier receives a Supabase secret",
      mutate: (workflow) => workflow.replace(
        "      - name: Verify post-push receipt\n",
        "      - name: Verify post-push receipt\n        env:\n          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}\n",
      ),
      code: "db_push_workflow_postdeploy_verifier_secret_scope_mismatch",
    },
  ]

  for (const { name, mutate, code } of cases) {
    const fixtureRoot = await createRepoFixture()
    const workflowPath = join(fixtureRoot, ".github", "workflows", "supabase-db-push.yml")
    await writeFile(workflowPath, mutate(await readFile(workflowPath, "utf8")))
    const errors = await validateSupabaseMigrationLayout({ repoRoot: fixtureRoot })
    assertIncludesErrorCode(errors, code)
    assert.ok(errors.length > 0, `${name} must be rejected`)
  }

  const artifactFixture = await createRepoFixture()
  await mkdir(join(artifactFixture, "scripts"), { recursive: true })
  await writeFile(
    join(artifactFixture, "scripts", "verify-supabase-postdeploy-unapproved.mjs"),
    "export {}\n",
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: artifactFixture }),
    "postdeploy_contract_artifact_unapproved",
  )
})
