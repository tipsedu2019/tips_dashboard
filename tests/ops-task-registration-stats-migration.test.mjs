import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  validateBaselineManifest,
  validateManifestMigrations,
} from "../scripts/run-isolated-supabase-db-tests.mjs"

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)))
const baselines = join(root, "supabase/test-baselines")
const manifestPath = join(baselines, "dashboard-free-tier-v1.manifest.json")
const migrationFileName = "20260818083818_optimize_registration_task_stats.sql"
const migrationPath = join(root, "supabase/migrations", migrationFileName)

async function activeCatalog() {
  const pointer = JSON.parse(await readFile(
    join(baselines, "dashboard-free-tier-v1.active.json"),
    "utf8",
  ))
  return JSON.parse(await readFile(
    join(baselines, "dashboard-free-tier-v1-captures", pointer.captureId, "catalog.json"),
    "utf8",
  ))
}

test("canonical isolated manifest covers every migration after the reviewed baseline", async () => {
  const [catalog, manifestSource] = await Promise.all([
    activeCatalog(),
    readFile(manifestPath, "utf8"),
  ])
  const manifest = validateBaselineManifest(JSON.parse(manifestSource))

  await assert.doesNotReject(validateManifestMigrations({
    root,
    manifest,
    baselineVersions: catalog.migrationLedger.map(({ version }) => version),
  }))
})

test("registration task stats migration is final and byte-pinned", async () => {
  const [manifestSource, migration] = await Promise.all([
    readFile(manifestPath, "utf8"),
    readFile(migrationPath),
  ])
  const manifest = validateBaselineManifest(JSON.parse(manifestSource))

  assert.deepEqual(
    manifest.orderedNewMigrations.find(({ fileName }) => fileName === migrationFileName),
    {
      fileName: migrationFileName,
      status: "final",
      sha256: createHash("sha256").update(migration).digest("hex"),
    },
  )
})
