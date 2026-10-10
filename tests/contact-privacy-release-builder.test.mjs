import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { buildContactPrivacyRelease, contactReleaseInputs } from "../scripts/build-contact-privacy-release.mjs"
import { stripMigrationTransaction } from "../scripts/build-supabase-transactional-preflight.mjs"

const hash = (value) => createHash("sha256").update(value).digest("hex")
const repoRoot = fileURLToPath(new URL("..", import.meta.url))
const builderPath = join(repoRoot, "scripts/build-contact-privacy-release.mjs")
const input = (index) => index < 2
  ? `-- NATIVE_${index}_NEVER_ATOMIC\nselect ${index};\n`
  : `begin;\n-- SYNTHETIC_SECTION_${index}\nselect ${index};\ncommit;\n`

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), "tips-contact-release-builder-"))
  context.after(() => rm(root, { recursive: true, force: true }))
  const sources = contactReleaseInputs.map((_, index) => input(index))
  for (const [index, path] of contactReleaseInputs.entries()) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), sources[index])
  }
  const manifest = {
    sourceCommit: "a".repeat(40), sourceTree: "b".repeat(40), projectRef: "slnjqlzzhewblvttiidk",
    inputs: contactReleaseInputs.map((path, index) => ({ path, sha256: hash(sources[index]) })),
  }
  const build = (value = manifest) => buildContactPrivacyRelease({ repoRoot: root, manifest: value })
  const replaceReviewedInput = async (index, source) => {
    sources[index] = source
    await writeFile(join(root, contactReleaseInputs[index]), source)
    manifest.inputs[index].sha256 = hash(source)
  }
  return { root, sources, manifest, build, replaceReviewedInput }
}

test("release assembler puts exactly six installers and activation inside one envelope while excluding native PR96 and recovery", async (context) => {
  const f = await fixture(context)
  const result = await f.build()
  assert.equal((result.atomicSql.match(/^begin;$/gm) ?? []).length, 1)
  assert.equal((result.atomicSql.match(/^commit;$/gm) ?? []).length, 1)
  assert.match(result.atomicSql, /pg_try_advisory_xact_lock\(20261009,160000\)/u)
  assert.doesNotMatch(result.atomicSql, /NATIVE_[01]_NEVER_ATOMIC|SYNTHETIC_SECTION_(?:9|10)/u)
  for (let index = 2; index <= 8; index += 1) assert.ok(result.atomicSql.includes(stripMigrationTransaction(f.sources[index])))
  assert.equal(result.recoverySql, f.sources[9])
  assert.equal(result.masterNullificationSql, f.sources[10])
  assert.deepEqual(result.receipt.inputs, f.manifest.inputs)
  assert.equal(result.receipt.sourceCommit, f.manifest.sourceCommit)
  assert.equal(result.receipt.sourceTree, f.manifest.sourceTree)
  assert.equal(result.receipt.operatingExecution, false)
  assert.equal(result.receipt.outputs[0].sha256, hash(result.atomicSql))
  assert.equal(result.receipt.outputs[1].sha256, hash(result.recoverySql))
  assert.equal(result.receipt.outputs[2].sha256, hash(result.masterNullificationSql))
  assert.equal(result.receipt.executionOrder[6], "separately_approved_master_phone_nullification")
  assert.equal(result.receipt.masterNullificationScope.registrationParentPhone, "preserved")
  assert.equal(result.receipt.masterNullificationScope.historicalPurge, false)
  assert.equal(result.receipt.masterNullificationScope.irreversible, true)
  assert.equal(result.receipt.executionOrder[1], "native_cli_2.115.0_pr96_pair_skip_vault")
})

test("release assembler rejects another project, absent commit, missing inputs and reordered paths before emitting", async (context) => {
  const f = await fixture(context)
  for (const [mutate, message] of [
    [(m) => { m.projectRef = "other-project" }, "contact_release_project_mismatch"],
    [(m) => { delete m.sourceCommit }, "contact_release_commit_missing"],
    [(m) => { m.inputs.pop() }, "contact_release_input_count_mismatch"],
    [(m) => { [m.inputs[0], m.inputs[1]] = [m.inputs[1], m.inputs[0]] }, "contact_release_input_order_or_pin_invalid"],
    [(m) => { m.inputs[2].path = "../outside.sql" }, "contact_release_input_order_or_pin_invalid"],
    [(m) => { m.inputs[2].sha256 = "not-a-hash" }, "contact_release_input_order_or_pin_invalid"],
  ]) {
    const manifest = structuredClone(f.manifest)
    mutate(manifest)
    await assert.rejects(f.build(manifest), { message })
  }
})

test("native pair, privacy, activation and recovery bytes all remain covered by independent input pins", async (context) => {
  const f = await fixture(context)
  for (const index of [0, 1, 2, 8, 9, 10]) {
    const path = join(f.root, contactReleaseInputs[index])
    await writeFile(path, `${f.sources[index]}-- unreviewed drift\n`)
    await assert.rejects(f.build(), { message: "contact_release_input_hash_mismatch" })
    await writeFile(path, f.sources[index])
  }
})

test("reviewed SQL still cannot add nested transaction controls or top-level psql escapes", async (context) => {
  const f = await fixture(context)
  for (const escaped of ["BEGIN;", "START TRANSACTION;", "COMMIT;", "ROLLBACK;", "PREPARE TRANSACTION 'escaped';",
    "\\i outside.sql", "\\gexec", "\\copy private FROM stdin"]) {
    await f.replaceReviewedInput(2, `begin;\nselect 1;\n${escaped}\ncommit;\n`)
    await assert.rejects(f.build(), { message: "transactional_preflight_migration_escape_forbidden" })
  }
})

test("release SQL requires the exact outer transaction even when its new bytes are pinned", async (context) => {
  const f = await fixture(context)
  assert.equal(stripMigrationTransaction("select 1;\n"), "select 1;", "one-argument shared parser keeps its existing non-envelope semantics")
  for (const source of ["select 1;\n", "begin;\nselect 1;\n", "select 1;\ncommit;\n"]) {
    await f.replaceReviewedInput(2, source)
    await assert.rejects(f.build(), { message: "transactional_preflight_outer_transaction_required" })
  }
})

test("shared parser preserves quoted and tagged dollar body text including apparent transaction and psql lines", async (context) => {
  const f = await fixture(context)
  const body = "create function public.synthetic_body() returns text language plpgsql as $fn$\nbegin\n  return $literal$\nbegin;\n\\gexec\ncommit;\n$literal$;\nend;\n$fn$;\nselect E'\\\\gexec begin; commit;';"
  const source = `begin;\n${body}\ncommit;\n`
  assert.equal(stripMigrationTransaction(source), body)
  await f.replaceReviewedInput(2, source)
  const result = await f.build()
  assert.ok(result.atomicSql.includes(body))
})

test("actual prepared input bodies survive atomic assembly byte-for-byte without running SQL", async () => {
  const sources = await Promise.all(contactReleaseInputs.map((path) => readFile(join(repoRoot, path), "utf8")))
  const manifest = { sourceCommit: "a".repeat(40), sourceTree: "b".repeat(40), projectRef: "slnjqlzzhewblvttiidk",
    inputs: contactReleaseInputs.map((path, index) => ({ path, sha256: hash(sources[index]) })) }
  const result = await buildContactPrivacyRelease({ repoRoot, manifest })
  for (let index = 2; index <= 8; index += 1) assert.ok(result.atomicSql.includes(stripMigrationTransaction(sources[index])))
  assert.equal(result.recoverySql, sources[9])
  assert.equal(result.masterNullificationSql, sources[10])
  assert.doesNotMatch(result.atomicSql, /create unique index concurrently|drop index concurrently/iu)
  assert.equal(result.receipt.operatingExecution, false)
})

test("CLI is emit-only and refuses replacing an existing frozen output", async (context) => {
  const f = await fixture(context)
  const manifestPath = join(f.root, "manifest.json")
  const output = join(f.root, "prepared")
  await writeFile(manifestPath, JSON.stringify(f.manifest))
  const run = () => spawnSync(process.execPath, [builderPath, "--manifest", manifestPath, "--output", output], {
    cwd: f.root, env: { PATH: dirname(process.execPath), LANG: "C", TZ: "UTC" }, encoding: "utf8", timeout: 5_000, maxBuffer: 128_000,
  })
  const first = run()
  assert.equal(first.status, 0, first.stderr)
  const receipt = JSON.parse(first.stdout)
  const sqlPath = join(output, "registration-contact-privacy-atomic.sql")
  const sql = await readFile(sqlPath, "utf8")
  assert.equal(receipt.outputs[0].sha256, hash(sql))
  assert.equal(receipt.operatingExecution, false)
  assert.equal(await readFile(join(output, "student-contact-master-nullification.sql"), "utf8"), f.sources[10])
  const replay = run()
  assert.equal(replay.status, 1)
  assert.match(replay.stderr, /EEXIST/u)
  assert.equal(await readFile(sqlPath, "utf8"), sql)
})
