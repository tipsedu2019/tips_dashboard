import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  buildDashboardFreeTierParitySql, buildFinalSchemaReconciliation,
  captureDashboardFreeTierCatalog, dashboardFreeTierCatalogFingerprintSql,
  dashboardFreeTierCatalogStatement, normalizeDashboardFreeTierCatalog,
  publishDashboardFreeTierCapture,
} from "../scripts/capture-dashboard-free-tier-catalog.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const paths = { catalog: "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json", baseline: "supabase/test-baselines/dashboard-free-tier-v1.sql", parityTest: "supabase/tests/dashboard_free_tier_catalog_parity_test.sql" };
const manifestPath = "supabase/test-baselines/dashboard-free-tier-v1.manifest.json";
const pointerPath = "supabase/test-baselines/dashboard-free-tier-v1.active.json";
const capturesPath = "supabase/test-baselines/dashboard-free-tier-v1-captures";
const identities = [
  "dashboard_notifications.dashboard_notifications_assistant_makeup_hard_deny",
  "makeup_notification_deliveries.makeup_notification_deliveries_assistant_hard_deny",
  "makeup_notification_settings.makeup_notification_settings_assistant_hard_deny",
  "makeup_request_events.makeup_request_events_assistant_hard_deny",
  "makeup_requests.makeup_requests_assistant_hard_deny",
  "science_consultation_rate_limits.No direct client access",
  "science_consultation_requests.No direct client access",
];
const legacyFingerprint = '{"check": "false", "roles": ["authenticated"], "using": "false", "command": "*"}';
const modeFingerprint = (permissive) => `${legacyFingerprint.slice(0, -1)}, "permissive": ${permissive}}`;
const policy = (permissive) => ({ objectKind: "policy", schema: "public", identity: "makeup_requests.test_deny", fingerprint: modeFingerprint(permissive), replayFingerprint: modeFingerprint(permissive) });

for (const [permissive, mode] of [[false, "restrictive"], [true, "permissive"]]) {
  test(`reconciliation explicitly preserves ${mode} mode`, () => {
    assert.match(buildFinalSchemaReconciliation([policy(permissive)]), new RegExp(`as ${mode} for all to "authenticated" using \\(false\\) with check \\(false\\)`));
  });
}

test("reconciliation and normalization reject absent or nonboolean modes", () => {
  for (const permissive of [undefined, null, "false", 0]) {
    const fingerprint = JSON.stringify({ command: "*", roles: ["authenticated"], using: "false", check: "false", permissive });
    const entry = { ...policy(false), fingerprint, replayFingerprint: fingerprint };
    assert.throws(() => buildFinalSchemaReconciliation([entry]), /contract_drift/);
    assert.throws(() => normalizeDashboardFreeTierCatalog([entry], {}), /contract_drift/);
  }
});

test("new normalization marks v2 while distinct mode hashes feed mode-sensitive parity", () => {
  const restrictive = normalizeDashboardFreeTierCatalog([policy(false)], {})[0];
  const permissive = normalizeDashboardFreeTierCatalog([policy(true)], {})[0];
  assert.equal(restrictive.policyFingerprintVersion, 2);
  assert.equal(JSON.parse(restrictive.replayFingerprint).permissive, false);
  assert.notEqual(restrictive.definitionSha256, permissive.definitionSha256);
  assert.match(dashboardFreeTierCatalogFingerprintSql(restrictive), /'permissive', pol\.polpermissive/);
  assert.notEqual(buildDashboardFreeTierParitySql([restrictive]), buildDashboardFreeTierParitySql([permissive]));
});

test("historical parity stays byte-reproducible and explicit invalid versions fail closed", async () => {
  const catalog = JSON.parse(await readFile(new URL("../supabase/test-baselines/dashboard-free-tier-v1-captures/47838c718a358344/catalog.json", import.meta.url), "utf8"));
  assert.equal(buildDashboardFreeTierParitySql(catalog.catalog), await readFile(new URL("../supabase/test-baselines/dashboard-free-tier-v1-captures/47838c718a358344/parity.sql", import.meta.url), "utf8"));
  for (const version of [null, 1, 3, "2", false]) assert.throws(() => dashboardFreeTierCatalogFingerprintSql({ ...policy(false), policyFingerprintVersion: version }), /contract_drift/);
});

test("normalization rejects invalid explicit versions and preserves v2 hash-only entries", () => {
  for (const version of [null, 1, 3, "2", false]) {
    assert.throws(() => normalizeDashboardFreeTierCatalog([{ ...policy(false), policyFingerprintVersion: version }], {}), /contract_drift/);
    assert.throws(() => buildFinalSchemaReconciliation([{ ...policy(false), policyFingerprintVersion: version }]), /contract_drift/);
  }
  assert.equal(normalizeDashboardFreeTierCatalog([{ objectKind: "policy", schema: "public", identity: "makeup_requests.test_deny", definitionSha256: "a".repeat(64), policyFingerprintVersion: 2 }], {})[0].policyFingerprintVersion, 2);
});

test("empty replay fingerprints cannot bypass required policy mode validation", () => {
  assert.throws(() => buildFinalSchemaReconciliation([{ ...policy(false), replayFingerprint: "" }]), /contract_drift/);
  assert.throws(() => normalizeDashboardFreeTierCatalog([{ ...policy(false), fingerprint: "", definitionSha256: "a".repeat(64) }], {}), /contract_drift/);
});

async function put(root, path, contents) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), contents);
}
async function tempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "tips-policy-mode-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("normal producer retains false through OID normalization and persists v2 without bypassing HTTP guards", async (t) => {
  const root = await tempRoot(t);
  const originMainSha = "a".repeat(40);
  await put(root, "scripts/fixtures/scope.json", JSON.stringify({}));
  await put(root, "scripts/fixtures/supabase-management-read-only-query-contract.json", await readFile(new URL("../scripts/fixtures/supabase-management-read-only-query-contract.json", import.meta.url)));
  await put(root, manifestPath, JSON.stringify({ originMainSha, orderedNewMigrations: [] }));
  const result = await captureDashboardFreeTierCatalog({ root,
    argv: ["--mode", "execute", "--authorized", "--request-id", "policy-mode-test", "--origin-main-sha", originMainSha, "--scope", "scripts/fixtures/scope.json", "--catalog", paths.catalog, "--baseline", paths.baseline, "--parity-test", paths.parityTest],
    env: { SUPABASE_DATABASE_READ_TOKEN: "synthetic-test-only", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", TASK_ORIGIN_MAIN_SHA: originMainSha }, gitOriginMainSha: async () => originMainSha,
    fetch: async (_url, options) => {
      assert.match(JSON.parse(options.body).query, /'permissive', policy\.polpermissive/);
      return new Response(JSON.stringify({ serverMajor: 17, migrationLedger: [], catalog: [
        { ...policy(false), fingerprint: JSON.stringify({ command: "*", roles: ["123"], using: "false", check: "false", permissive: false }) },
        { objectKind: "grant", schema: "public", identity: "makeup_requests.123", fingerprint: JSON.stringify({ acl: ["authenticated=r/postgres"], expanded: [{ grantee: "123", privilege: "SELECT" }] }) },
      ] }), { status: 201 });
    },
  });
  assert.equal(result.catalog[0].policyFingerprintVersion, 2);
  assert.equal(result.catalog[0].definitionSha256, hash(modeFingerprint(false)));
  assert.match(await readFile(join(root, paths.baseline), "utf8"), /as restrictive/);
  assert.match(await readFile(join(root, paths.parityTest), "utf8"), /polpermissive/);
  assert.match(dashboardFreeTierCatalogStatement(), /polpermissive/);
});

async function repairApi() {
  const api = await import("../scripts/repair-dashboard-free-tier-policy-modes.mjs").catch((error) => {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return {};
  });
  assert.equal(typeof api.repairDashboardFreeTierPolicyModes, "function", "offline repair entry point must exist");
  return api;
}

async function repairFixture(t) {
  const root = await tempRoot(t);
  const migration = { fileName: "20260817000000_fixture.sql", status: "final", sha256: hash("-- first migration\n") };
  const later = { fileName: "20260818000000_fixture.sql", status: "final", sha256: hash("-- later migration\n") };
  await put(root, `supabase/migrations/${migration.fileName}`, "-- first migration\n");
  await put(root, `supabase/migrations/${later.fileName}`, "-- later migration\n");
  const catalog = { captureStatus: "reviewed", originMainSha: "a".repeat(40), serverMajor: 17,
    migrationLedgerCount: 0, migrationLedgerMaxVersion: null, migrationLedgerSha256: hash("[]"), migrationLedger: [],
    catalog: [...identities.map((identity) => ({ objectKind: "policy", schema: "public", identity, definitionSha256: hash(legacyFingerprint) })),
      { objectKind: "policy", schema: "public", identity: "worksheets.unrelated", definitionSha256: hash(legacyFingerprint) }],
  };
  const artifacts = { catalog: `${JSON.stringify(catalog, null, 2)}\n`, baseline: "-- original baseline prefix\nselect 1;\n", parity: buildDashboardFreeTierParitySql(catalog.catalog) };
  const manifest = { baselineVersion: "dashboard-free-tier-v1", originMainSha: catalog.originMainSha, baselineSha256: hash(artifacts.baseline), catalogSha256: hash(artifacts.catalog), requiredObjectSignatures: [], orderedNewMigrations: [migration] };
  const captureId = hash(canonical({ ...artifacts, manifest })).slice(0, 16);
  for (const [path, value] of [["catalog.json", artifacts.catalog], ["baseline.sql", artifacts.baseline], ["parity.sql", artifacts.parity], ["manifest.json", `${JSON.stringify(manifest, null, 2)}\n`]]) await put(root, `${capturesPath}/${captureId}/${path}`, value);
  for (const [key, path] of Object.entries(paths)) await put(root, path, artifacts[key === "parityTest" ? "parity" : key]);
  const topManifest = { ...manifest, orderedNewMigrations: [migration, later] };
  await put(root, manifestPath, `${JSON.stringify(topManifest, null, 2)}\n`);
  await put(root, pointerPath, JSON.stringify({ captureSetVersion: 1, captureId, artifactPaths: paths }));
  return { root, catalog, artifacts, manifest: topManifest, captureId };
}

async function snapshot(root) {
  const result = {};
  async function walk(path) {
    for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) await walk(next);
      else result[next] = (await readFile(join(root, next))).toString("hex");
    }
  }
  await walk("");
  return result;
}

function envelope(statement) {
  return { version: 1, transport: "supabase-mcp", statementSha256: hash(statement), result: {
    version: 1, transactionReadOnly: true, serverMajor: 17, capturedAt: "2026-08-31T01:00:00.000+00:00",
    policies: identities.map((identity) => ({ objectKind: "policy", schema: "public", identity, fingerprint: modeFingerprint(false) })),
  } };
}

test("offline fixed statement only exports the seven catalog identities in a read-only bounded transaction", async () => {
  const { dashboardFreeTierPolicyModeStatement } = await repairApi();
  const sql = dashboardFreeTierPolicyModeStatement();
  assert.match(sql, /^begin read only;\nset local statement_timeout = '8s';/);
  assert.match(sql, /rollback;$/);
  assert.match(sql, /'transactionReadOnly'.*transaction_read_only/s);
  assert.match(sql, /'permissive', policy\.polpermissive/);
  for (const identity of identities) assert.ok(sql.includes(`'${identity}'`));
  assert.equal((sql.match(/\('public', '/g) || []).length, 7);
  assert.doesNotMatch(sql, /(?:from|join)\s+(?:public|auth|supabase_migrations)\./i);
  assert.doesNotMatch(sql, /\b(?:insert|update|delete|alter|create|drop|commit|execute|call|pg_sleep)\b/i);
});

test("offline repair publishes a derived content-addressed set and changes exactly seven expectations", async (t) => {
  const api = await repairApi();
  const fixture = await repairFixture(t);
  const before = await snapshot(fixture.root);
  const observed = envelope(api.dashboardFreeTierPolicyModeStatement());
  const result = await api.repairDashboardFreeTierPolicyModes({ root: fixture.root, authorized: true, requestId: "policy-mode-repair-test", expectedCaptureId: fixture.captureId, envelope: observed });
  const pointer = JSON.parse(await readFile(join(fixture.root, pointerPath), "utf8"));
  assert.notEqual(pointer.captureId, fixture.captureId);
  assert.equal(result.captureId, pointer.captureId);
  const base = join(fixture.root, capturesPath, pointer.captureId);
  const baseline = await readFile(join(base, "baseline.sql"), "utf8");
  assert.ok(baseline.startsWith(fixture.artifacts.baseline));
  const suffix = baseline.slice(fixture.artifacts.baseline.length);
  assert.equal((suffix.match(/create policy /g) || []).length, 7);
  assert.equal((suffix.match(/as restrictive/g) || []).length, 7);
  assert.doesNotMatch(suffix, /worksheets|create (?:function|table|role)|grant /);
  const catalogText = await readFile(join(base, "catalog.json"), "utf8");
  const catalog = JSON.parse(catalogText);
  const manifest = JSON.parse(await readFile(join(base, "manifest.json"), "utf8"));
  const parity = await readFile(join(base, "parity.sql"), "utf8");
  assert.equal(pointer.captureId, hash(canonical({ baseline, catalog: catalogText, manifest, parity })).slice(0, 16));
  assert.deepEqual(catalog.catalog.at(-1), fixture.catalog.catalog.at(-1));
  assert.deepEqual(catalog.migrationLedger, fixture.catalog.migrationLedger);
  assert.equal(catalog.originMainSha, fixture.catalog.originMainSha);
  assert.deepEqual(manifest, { ...fixture.manifest, baselineSha256: hash(baseline), catalogSha256: hash(catalogText) });
  for (const entry of catalog.catalog.slice(0, 7)) {
    assert.equal(entry.definitionSha256, hash(modeFingerprint(false)));
    assert.equal(entry.policyFingerprintVersion, 2);
  }
  assert.equal((parity.match(/pol\.polpermissive/g) || []).length, 7);
  assert.equal(catalog.policyModeRepair.sourceCaptureId, fixture.captureId);
  assert.equal(catalog.policyModeRepair.sourceCatalogSha256, hash(fixture.artifacts.catalog));
  assert.equal(catalog.policyModeRepair.statementSha256, observed.statementSha256);
  assert.equal(catalog.policyModeRepair.snapshotSha256, hash(canonical(observed.result)));
  assert.equal(catalog.policyModeRepair.capturedAt, observed.result.capturedAt);
  const after = await snapshot(fixture.root);
  for (const [path, bytes] of Object.entries(before)) if (path.startsWith(capturesPath) || path.startsWith("supabase/migrations")) assert.equal(after[path], bytes, path);
  for (const [key, path] of Object.entries(paths)) assert.equal(await readFile(join(fixture.root, path), "utf8"), { catalog: catalogText, baseline, parityTest: parity }[key]);
  assert.deepEqual(JSON.parse(await readFile(join(fixture.root, manifestPath), "utf8")), manifest);
});

const rejectionCases = [
  ["authorization missing", (options) => { options.authorized = false; }],
  ["request id invalid", (options) => { options.requestId = "secret\ninvalid"; }],
  ["source id mismatch", (options) => { options.expectedCaptureId = "0".repeat(16); }],
  ["source id path escape", (options) => { options.expectedCaptureId = "../bad"; }],
  ["statement hash mismatch", (options) => { options.envelope.statementSha256 = "0".repeat(64); }],
  ["envelope malformed", (options) => { options.envelope = { secret: "do-not-echo-payload" }; }],
  ["unexpected transport", (options) => { options.envelope.transport = "http"; }],
  ["unexpected envelope field", (options) => { options.envelope.query = "do-not-echo-payload"; }],
  ["not read only", (options) => { options.envelope.result.transactionReadOnly = false; }],
  ["wrong server", (options) => { options.envelope.result.serverMajor = 15; }],
  ["invalid observation time", (options) => { options.envelope.result.capturedAt = "not-a-date"; }],
  ["missing target", (options) => { options.envelope.result.policies.pop(); }],
  ["duplicate target", (options) => { options.envelope.result.policies[6] = options.envelope.result.policies[0]; }],
  ["extra target", (options) => { options.envelope.result.policies.push({ ...options.envelope.result.policies[0], identity: "worksheets.unrelated" }); }],
  ["wrong schema", (options) => { options.envelope.result.policies[0].schema = "private"; }],
  ...[["mode true", "permissive", true], ["mode string", "permissive", "false"], ["mode null", "permissive", null], ["mode absent", "permissive", undefined], ["predicate drift", "using", "do-not-echo-payload"], ["check drift", "check", "true"], ["role drift", "roles", ["public"]], ["command drift", "command", "r"], ["extra fingerprint field", "extra", "bad"]].map(([name, key, value]) => [name, (options) => {
    const row = options.envelope.result.policies[0]; const parsed = JSON.parse(row.fingerprint); parsed[key] = value; row.fingerprint = JSON.stringify(parsed);
  }]),
  ["fingerprint malformed", (options) => { options.envelope.result.policies[0].fingerprint = "do-not-echo-payload"; }],
  ...["baseline.sql", "catalog.json", "parity.sql", "manifest.json"].map((file) => [`immutable ${file} tamper`, async (options) => put(options.root, `${capturesPath}/${options.expectedCaptureId}/${file}`, "do-not-echo-payload")]),
  ...Object.values(paths).map((path) => [`canonical ${path} tamper`, async (options) => put(options.root, path, "do-not-echo-payload")]),
  ...[["unfinalized manifest", "status", "candidate"], ["draft manifest", "status", "draft"], ["null hash manifest", "sha256", null], ["migration prefix drift", "sha256", "0".repeat(64)]].map(([name, key, value]) => [name, async (options) => {
    const manifest = JSON.parse(await readFile(join(options.root, manifestPath), "utf8")); manifest.orderedNewMigrations[0][key] = value; await put(options.root, manifestPath, JSON.stringify(manifest));
  }]),
  ["migration bytes tamper", async (options) => put(options.root, "supabase/migrations/20260818000000_fixture.sql", "tamper")],
  ["manifest metadata drift", async (options) => { const manifest = JSON.parse(await readFile(join(options.root, manifestPath), "utf8")); manifest.requiredObjectSignatures = ["drift"]; await put(options.root, manifestPath, JSON.stringify(manifest)); }],
];

for (const [name, mutate] of rejectionCases) test(`repair rejects ${name} without changing any files`, async (t) => {
  const api = await repairApi();
  const fixture = await repairFixture(t);
  const options = { root: fixture.root, authorized: true, requestId: "policy-mode-repair-test", expectedCaptureId: fixture.captureId, envelope: envelope(api.dashboardFreeTierPolicyModeStatement()) };
  await mutate(options);
  const before = await snapshot(fixture.root);
  await assert.rejects(api.repairDashboardFreeTierPolicyModes(options), (error) => /^dashboard_policy_mode_repair_[a-z_]+$/.test(error.message) && !JSON.stringify(error).includes("do-not-echo-payload"));
  assert.deepEqual(await snapshot(fixture.root), before);
});

test("repair publisher failure after a canonical rename restores all artifacts and pointer bytes", async (t) => {
  const api = await repairApi();
  const fixture = await repairFixture(t);
  const before = await snapshot(fixture.root);
  let injected = false;
  await assert.rejects(api.repairDashboardFreeTierPolicyModes({ root: fixture.root, authorized: true, requestId: "policy-mode-repair-test", expectedCaptureId: fixture.captureId, envelope: envelope(api.dashboardFreeTierPolicyModeStatement()),
    publish: (input) => publishDashboardFreeTierCapture({ ...input, renameFile: async (from, to) => {
      if (!injected && to === join(fixture.root, manifestPath)) { injected = true; throw new Error("do-not-echo-payload"); }
      return rename(from, to);
    } }),
  }), /^Error: dashboard_policy_mode_repair_publication_failed$/);
  assert.equal(injected, true);
  const after = await snapshot(fixture.root);
  for (const [path, bytes] of Object.entries(before)) assert.equal(after[path], bytes, path);
  assert.equal(JSON.parse(await readFile(join(fixture.root, pointerPath), "utf8")).captureId, fixture.captureId);
  assert.equal(Object.keys(after).some((path) => /\.stage-|\.tmp-|\.restore-/.test(path)), false);
});

test("repair reports rollback failure distinctly without disclosing underlying errors", async (t) => {
  const api = await repairApi();
  const fixture = await repairFixture(t);
  const pointer = await readFile(join(fixture.root, pointerPath));
  await assert.rejects(api.repairDashboardFreeTierPolicyModes({ root: fixture.root, authorized: true, requestId: "policy-mode-repair-test", expectedCaptureId: fixture.captureId, envelope: envelope(api.dashboardFreeTierPolicyModeStatement()),
    publish: (input) => publishDashboardFreeTierCapture({ ...input, renameFile: async (from, to) => {
      if (to === join(fixture.root, manifestPath) || from.includes(".restore-")) throw new Error("do-not-echo-payload");
      return rename(from, to);
    } }),
  }), /^Error: dashboard_policy_mode_repair_publication_and_rollback_failed$/);
  assert.deepEqual(await readFile(join(fixture.root, pointerPath)), pointer);
});
