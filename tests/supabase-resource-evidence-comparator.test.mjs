import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  compareResourceEvidence,
  writeExclusiveJson,
} from "../scripts/compare-supabase-resource-evidence.mjs";
import {
  RESOURCE_EVIDENCE_SECTIONS,
  collectSupabaseResourceEvidence,
  parseResourceEvidenceArguments,
} from "../scripts/collect-supabase-resource-evidence.mjs";

function capture(overrides = {}) {
  return {
    version: 1,
    projectRef: "abcdefghijklmnopqrst",
    clientStartedAt: "2026-08-14T00:00:00.000Z",
    clientEndedAt: "2026-08-14T00:00:10.000Z",
    monotonicDurationMs: 10_000,
    bracket: {
      startedAt: "2026-08-14T00:00:01.000Z",
      endedAt: "2026-08-14T00:00:09.000Z",
    },
    environment: {
      postgresVersion: "17.6",
      databaseStatsReset: "2026-08-01T00:00:00.000Z",
      statementsStatsReset: "2026-08-01T00:00:00.000Z",
      extensions: { pg_stat_statements: "1.11", pg_cron: "1.6", pgcrypto: "1.3" },
    },
    sections: Object.fromEntries(RESOURCE_EVIDENCE_SECTIONS.map((section) => [section.id, { available: true, rows: [] }])),
    ...overrides,
  };
}

test("resource evidence plan exposes IDs, checksums, and budgets but never SQL", async () => {
  const output = [];
  const result = await collectSupabaseResourceEvidence({ argv: ["--mode", "plan"], stdout: (line) => output.push(line) });
  assert.equal(result.mode, "plan");
  assert.match(output.join("\n"), /"database"/u);
  assert.doesNotMatch(output.join("\n"), /pg_stat_activity|select\s+/iu);
  assert.equal(RESOURCE_EVIDENCE_SECTIONS.length, 9);
  assert.ok(RESOURCE_EVIDENCE_SECTIONS.every(({ checksum, maxRows }) => /^[a-f0-9]{64}$/u.test(checksum) && maxRows <= 20));
});

test("collector rejects argv secrets and execute without explicit authority before HTTP", async () => {
  assert.throws(() => parseResourceEvidenceArguments(["--mode", "execute", "--token", "secret"]), /resource_evidence_argv_secret_refused/);
  let calls = 0;
  await assert.rejects(
    collectSupabaseResourceEvidence({ argv: ["--mode", "execute"], env: {}, fetch: async () => { calls += 1; } }),
    /resource_evidence_approval_required/,
  );
  assert.equal(calls, 0);
});

test("collector pins read-only HTTP, brackets captures, and redacts query text from its evidence", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "resource-evidence-collect-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, "capture.json");
  const seen = [];
  let clock = 0;
  const result = await collectSupabaseResourceEvidence({
    argv: ["--mode", "execute", "--authorized", "--request-id", "a1234567", "--output", output],
    env: { SUPABASE_DATABASE_READ_TOKEN: "read-token", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst" },
    now: () => new Date(`2026-08-14T00:00:${clock++ === 0 ? "00" : "10"}.000Z`),
    monotonic: () => clock * 1_000,
    fetch: async (url, init) => {
      seen.push({ url, init });
      if (init.method === "GET") return new Response(JSON.stringify([]), { status: 200 });
      const query = JSON.parse(init.body).query;
      if (query.includes("clock_timestamp")) return new Response(JSON.stringify([{ captured_at: query.includes("end") ? "2026-08-14T00:00:09.000Z" : "2026-08-14T00:00:01.000Z" }]), { status: 201 });
      if (query.includes("server_version")) return new Response(JSON.stringify([{ server_version: "17.6", database_stats_reset: "2026-08-01T00:00:00.000Z", statements_stats_reset: "2026-08-01T00:00:00.000Z", has_pg_stat_statements: true, has_pg_cron: true, has_pgcrypto: true }]), { status: 201 });
      return new Response(JSON.stringify([]), { status: 201 });
    },
  });
  assert.equal(result.projectRef, "abcdefghijklmnopqrst");
  assert.equal(seen.filter(({ init }) => init.method === "POST").length, 10);
  assert.ok(seen.filter(({ init }) => init.method === "POST").every(({ init }) => init.headers.Authorization === "Bearer read-token"));
  const serialized = await readFile(output, "utf8");
  assert.doesNotMatch(serialized, /read-token|select\s+|pg_stat_activity/iu);
});

test("comparator fails closed on malformed time ranges and reset or extension drift", () => {
  const after = capture({ clientStartedAt: "2026-08-14T00:01:00.000Z", clientEndedAt: "2026-08-14T00:01:10.000Z", bracket: { startedAt: "2026-08-14T00:01:01.000Z", endedAt: "2026-08-14T00:01:09.000Z" } });
  assert.equal(compareResourceEvidence(capture(), after).status, "comparable");
  assert.equal(compareResourceEvidence(capture(), { ...after, bracket: { startedAt: "2026-08-14T00:01:11.000Z", endedAt: "2026-08-14T00:01:09.000Z" } }).status, "unknown");
  assert.equal(compareResourceEvidence(capture(), { ...after, environment: { ...after.environment, databaseStatsReset: "2026-08-02T00:00:00.000Z" } }).status, "unknown");
  assert.equal(compareResourceEvidence(capture(), { ...after, environment: { ...after.environment, extensions: { ...after.environment.extensions, pg_cron: "1.7" } } }).status, "unknown");
});

test("exclusive evidence output uses owner-only permissions and never overwrites", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "resource-evidence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, "capture.json");
  await writeExclusiveJson(output, { ok: true });
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), { ok: true });
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  await assert.rejects(writeExclusiveJson(output, { ok: false }), /resource_evidence_output_exists/);
});

test("comparison output is exclusive and rejects incomplete captures", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "resource-evidence-compare-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const before = join(directory, "before.json");
  const after = join(directory, "after.json");
  const output = join(directory, "comparison.json");
  await writeFile(before, JSON.stringify(capture()));
  await writeFile(after, JSON.stringify(capture({ clientStartedAt: "2026-08-14T00:01:00.000Z", clientEndedAt: "2026-08-14T00:01:10.000Z", bracket: { startedAt: "2026-08-14T00:01:01.000Z", endedAt: "2026-08-14T00:01:09.000Z" } })));
  await writeExclusiveJson(output, compareResourceEvidence(JSON.parse(await readFile(before, "utf8")), JSON.parse(await readFile(after, "utf8"))));
  assert.equal(JSON.parse(await readFile(output, "utf8")).status, "comparable");
});
