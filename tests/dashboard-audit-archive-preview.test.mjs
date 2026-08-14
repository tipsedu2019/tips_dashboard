import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseAuditArchivePreviewArguments, previewDashboardAuditArchive } from "../scripts/preview-dashboard-audit-archive.mjs";

test("archive preview requires as-of, explicit execution authority, and rejects argv secrets", () => {
  assert.throws(() => parseAuditArchivePreviewArguments(["--mode", "plan"]), /audit_archive_preview_as_of_invalid/);
  assert.throws(() => parseAuditArchivePreviewArguments(["--mode", "execute", "--as-of", "2026-08-14T00:00:00Z", "--token", "secret"]), /audit_archive_preview_argv_secret_refused/);
  assert.throws(() => parseAuditArchivePreviewArguments(["--mode", "execute", "--as-of", "2026-08-14T00:00:00Z"]), /audit_archive_preview_approval_required/);
});

test("plan is non-destructive and does not expose query text", async () => {
  const output = []; const result = await previewDashboardAuditArchive({ argv: ["--mode", "plan", "--as-of", "2026-08-14T00:00:00Z"], stdout: (line) => output.push(line) });
  assert.equal(result.deleteAuthorized, false); assert.equal(result.archiveVerified, false); assert.doesNotMatch(output.join("\n"), /select\s+|dashboard_audit_logs/iu);
});

test("missing global changed_at index ends as bounded candidate-only evidence without aggregation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "audit-preview-")); t.after(() => rm(directory, { recursive: true, force: true })); const output = join(directory, "preview.json"); let calls = 0;
  const result = await previewDashboardAuditArchive({ argv: ["--mode", "execute", "--authorized", "--request-id", "a1234567", "--as-of", "2026-08-14T00:00:00Z", "--output", output], env: { SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", SUPABASE_DATABASE_READ_TOKEN: "read" }, fetch: async () => { calls += 1; return new Response(JSON.stringify([]), { status: 201 }); } });
  assert.equal(calls, 1); assert.deepEqual(result.months, []); assert.equal(result.errorCode, "bounded_index_required"); assert.equal(JSON.parse(await readFile(output, "utf8")).deleteAuthorized, false);
});

test("preview source never includes archive export or delete execution", async () => {
  const source = await readFile(new URL("../scripts/preview-dashboard-audit-archive.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /delete\s+from|copy\s+public\.dashboard_audit_logs|archive_verified\s*:\s*true|delete_authorized\s*:\s*true/iu);
});
