import assert from "node:assert/strict";
import { validateBaselineManifest } from "../../scripts/run-isolated-supabase-db-tests.mjs";

// These captures belong to this immutable baseline. The ordered migration list
// grows as later work is added; its whole-file digest is not capture provenance.
export function assertTextbookWireManifest(manifest, expectedMigrations) {
  const { orderedNewMigrations, ...baseline } = validateBaselineManifest(manifest);
  assert.deepEqual(baseline, {
    baselineVersion: "dashboard-free-tier-v1",
    originMainSha: "cd6756987963b1102b077fe6d4ccf199787b66c8",
    baselineSha256: "2d8144a9f73559bfee7f3e417e7cf6b3a9d5d6a5d059890b1db7e0c1e674942a",
    catalogSha256: "2e4c512dc82ce947cd643f4ce850e5077005a5eb2faaccd53e2aebdcd4308f7f",
    requiredObjectSignatures: [],
  }, "the captured SQL wires must retain their original baseline identity");
  for (const migration of expectedMigrations) {
    assert.deepEqual(
      orderedNewMigrations.filter((entry) => entry.fileName === migration.fileName),
      [migration],
      `the captured SQL migration must remain final and unique: ${migration.fileName}`,
    );
  }
}
