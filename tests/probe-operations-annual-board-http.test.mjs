import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertAnnualContract, assertAnnualRoleContract, buildFixtureSql, HTTP_ACTORS, HTTP_CASES, HTTP_DETAIL_ID, HTTP_SCHOOL_ID,
  HTTP_YEAR, ownedSidecarId, signSyntheticJwt, validateDockerBoundary, validateLocalTarget, validateSidecarBoundary } from "./probe-operations-annual-board-http.mjs";

const project = "tips_supabase_db_qa_abcdef012345";
const localEnv = { TASK_LOCAL_DB_URL: "postgresql://postgres:synthetic-only@127.0.0.1:55555/postgres", TASK_LOCAL_DB_NONCE: "0123456789abcdef0123456789abcdef" };
const config = `project_id = "${project}"\n[api]\nport = 55554\n[db]\nport = 55555\nmajor_version = 17\n[studio]\nenabled = false\n`;
const route = "Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\neth0 000011AC 00000000 0001 0 0 0 0000FFFF 0 0 0\n";
function boundary() {
  const target = validateLocalTarget(localEnv, config);
  const network = { Id: "a".repeat(64), Name: `${project}_internal`, Internal: true, Driver: "bridge", EnableIPv6: false,
    Labels: { "tips.isolated-db-qa": project }, Options: { "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1" },
    Containers: { ["b".repeat(64)]: { Name: `supabase_db_${project}` } } };
  const db = { Id: "b".repeat(64), Name: `/supabase_db_${project}`, State: { Running: true },
    HostConfig: { NetworkMode: network.Id, PortBindings: { "5432/tcp": [{ HostIp: "", HostPort: "55555" }] } },
    NetworkSettings: { Networks: { [network.Name]: { NetworkID: network.Id, IPAddress: "172.18.0.2" } },
      Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55555" }] } } };
  return { target, db, network };
}

test("HTTP probe import is inert and execution without isolated authorization fails before Docker", () => {
  const result = spawnSync(process.execPath, [new URL("probe-operations-annual-board-http.mjs", import.meta.url).pathname],
    { env: { PATH: "/nonexistent", TASK_LOCAL_DB_URL: "", TASK_LOCAL_DB_NONCE: "" }, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim(), "annual_http_local_target_required");
});

test("staged symlink entrypoint executes the authorization guard rather than silently exiting zero", async t => {
  const directory = await mkdtemp(join(tmpdir(), "annual-http-entrypoint-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = join(directory, "probe.mjs");
  await symlink(new URL("probe-operations-annual-board-http.mjs", import.meta.url).pathname, entry);
  const result = spawnSync(process.execPath, [entry], { env: { PATH: "/nonexistent", TASK_LOCAL_DB_URL: "", TASK_LOCAL_DB_NONCE: "" }, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim(), "annual_http_local_target_required");
});

test("HTTP probe accepts only the official runner's nonce, loopback DB and exact temporary config", () => {
  assert.equal(validateLocalTarget(localEnv, config).container, `supabase_db_${project}`);
  for (const url of [
    "postgresql://postgres:private-canary@example.invalid:55555/postgres",
    "postgresql://postgres:private-canary@localhost:55555/postgres",
    "postgresql://postgres:private-canary@127.0.0.1:55555/production",
    "postgresql://authenticator:private-canary@127.0.0.1:55555/postgres",
    "postgresql://postgres@127.0.0.1:55555/postgres",
    "postgresql://postgres:private-canary@127.0.0.1:55555/postgres?host=example.invalid",
    "https://postgres:private-canary@127.0.0.1:55555/postgres",
  ]) {
    assert.throws(() => validateLocalTarget({ ...localEnv, TASK_LOCAL_DB_URL: url }, config), error => {
      assert.equal(error.message, "annual_http_local_target_required");
      assert.ok(!error.message.includes("private-canary"));
      return true;
    });
  }
  for (const nonce of ["", "a".repeat(31), "a".repeat(33), "x".repeat(32)]) {
    assert.throws(() => validateLocalTarget({ ...localEnv, TASK_LOCAL_DB_NONCE: nonce }, config), /annual_http_nonce_required/u);
  }
  for (const changed of [config.replace(project, "slnjqlzzhewblvttiidk"), config.replace("port = 55555", "port = 55556"), `${config}\nproject_id = "${project}"\n`]) {
    assert.throws(() => validateLocalTarget(localEnv, changed), /annual_http_config_target_mismatch/u);
  }
});

test("HTTP probe rejects external, unlabeled or dual-network DB containers and host exposure", () => {
  const { target, db, network } = boundary();
  assert.deepEqual(validateDockerBoundary(target, db, network, route), { networkId: network.Id, dbIp: "172.18.0.2" });
  for (const changed of [{ Internal: false }, { Driver: "host" }, { EnableIPv6: true }, { Labels: {} }, { Name: "bridge" }, { Options: {} }]) {
    assert.throws(() => validateDockerBoundary(target, db, { ...network, ...changed }, route), /annual_http_internal_network_required/u);
  }
  assert.throws(() => validateDockerBoundary(target, db, { ...network, Containers: {} }, route), /annual_http_network_membership_mismatch/u);
  assert.throws(() => validateDockerBoundary(target, db, { ...network, Containers: { ...network.Containers, extra: { Name: "unowned" } } }, route), /annual_http_network_membership_mismatch/u);
  for (const change of [
    fixture => { fixture.Name = "/supabase_db_existing"; },
    fixture => { fixture.Id = "malformed"; },
    fixture => { fixture.State.Running = false; },
    fixture => { fixture.NetworkSettings.Networks.bridge = { NetworkID: "b".repeat(64), IPAddress: "172.19.0.3" }; },
    fixture => { fixture.HostConfig.NetworkMode = "host"; },
    fixture => { fixture.NetworkSettings.Ports["5432/tcp"][0].HostIp = "0.0.0.0"; },
    fixture => { fixture.NetworkSettings.Ports["3000/tcp"] = [{ HostIp: "127.0.0.1", HostPort: "3000" }]; },
    fixture => { fixture.HostConfig.PortBindings["5432/tcp"][0].HostPort = "5432"; },
    fixture => { fixture.NetworkSettings.Ports = null; },
  ]) {
    const changed = structuredClone(db);
    change(changed);
    assert.throws(() => validateDockerBoundary(target, changed, network, route), /^Error: annual_http_/u);
  }
  assert.throws(() => validateDockerBoundary(target, db, network, `${route}eth0 00000000 010011AC 0003 0 0 0 00000000 0 0 0\n`), /annual_http_default_route_forbidden/u);
  assert.throws(() => validateDockerBoundary(target, db, network, "missing"), /annual_http_route_invalid/u);
  const unpublished = structuredClone(db);
  unpublished.NetworkSettings.Ports = {};
  assert.equal(validateDockerBoundary(target, unpublished, network, route).dbIp, "172.18.0.2");
  unpublished.NetworkSettings.Ports = { "5432/tcp": [] };
  assert.equal(validateDockerBoundary(target, unpublished, network, route).dbIp, "172.18.0.2");
  for (const mutate of [
    value => { value.HostConfig.PortBindings = {}; },
    value => { value.HostConfig.PortBindings["5432/tcp"] = []; },
    value => { value.HostConfig.PortBindings["5432/tcp"][0].HostIp = "0.0.0.0"; },
    value => { value.HostConfig.PortBindings["5432/tcp"][0].HostPort = "5432"; },
    value => { value.NetworkSettings.Ports = { "5432/tcp": undefined }; },
    value => { value.NetworkSettings.Ports = { "5432/tcp": [], "3000/tcp": [] }; },
  ]) {
    const changed = structuredClone(unpublished);
    mutate(changed);
    assert.throws(() => validateDockerBoundary(target, changed, network, route), /annual_http_db_ports_invalid/u);
  }
  assert.throws(() => validateDockerBoundary(target, unpublished, { ...network, Internal: false }, route), /annual_http_internal_network_required/u);
  assert.throws(() => validateDockerBoundary(target, unpublished, network, `${route}eth0 00000000 010011AC 0003 0 0 0 00000000 0 0 0\n`), /annual_http_default_route_forbidden/u);
});

test("HTTP probe accepts only the exact owned DB null publication without changing transport identity", () => {
  const { target, db, network } = boundary();
  db.NetworkSettings.Ports = { "5432/tcp": null };
  const before = structuredClone({ db, network });
  assert.deepEqual(validateDockerBoundary(target, db, network, route), { networkId: network.Id, dbIp: "172.18.0.2" });
  assert.deepEqual({ db, network }, before, "validation must not normalize null or alter inspect evidence");
});

test("null DB publication rejects missing, malformed, extra, public or mismatched bindings", () => {
  const { target, db, network } = boundary();
  db.NetworkSettings.Ports = { "5432/tcp": null };
  assert.doesNotThrow(() => validateDockerBoundary(target, db, network, route));
  for (const [name, mutate] of [
    ["missing requested map", value => { delete value.HostConfig.PortBindings; }],
    ["null requested map", value => { value.HostConfig.PortBindings = null; }],
    ["array requested map", value => { value.HostConfig.PortBindings = []; }],
    ["missing requested port", value => { value.HostConfig.PortBindings = {}; }],
    ["null requested bindings", value => { value.HostConfig.PortBindings["5432/tcp"] = null; }],
    ["empty requested bindings", value => { value.HostConfig.PortBindings["5432/tcp"] = []; }],
    ["malformed binding", value => { value.HostConfig.PortBindings["5432/tcp"] = [null]; }],
    ["public requested IP", value => { value.HostConfig.PortBindings["5432/tcp"][0].HostIp = "0.0.0.0"; }],
    ["public IPv6", value => { value.HostConfig.PortBindings["5432/tcp"][0].HostIp = "::"; }],
    ["wrong requested port", value => { value.HostConfig.PortBindings["5432/tcp"][0].HostPort = "55556"; }],
    ["extra requested port", value => { value.HostConfig.PortBindings["3000/tcp"] = []; }],
    ["missing publication map", value => { delete value.NetworkSettings.Ports; }],
    ["null publication map", value => { value.NetworkSettings.Ports = null; }],
    ["array publication map", value => { value.NetworkSettings.Ports = []; }],
    ["scalar publication map", value => { value.NetworkSettings.Ports = "5432/tcp"; }],
    ["malformed publication", value => { value.NetworkSettings.Ports["5432/tcp"] = {}; }],
    ["missing publication entry", value => { value.NetworkSettings.Ports["5432/tcp"] = undefined; }],
    ["extra unpublished port", value => { value.NetworkSettings.Ports["3000/tcp"] = null; }],
    ["unexpected unpublished port", value => { value.NetworkSettings.Ports = { "3000/tcp": null }; }],
    ["public publication", value => { value.NetworkSettings.Ports["5432/tcp"] = [{ HostIp: "0.0.0.0", HostPort: "55555" }]; }],
    ["wrong publication port", value => { value.NetworkSettings.Ports["5432/tcp"] = [{ HostIp: "127.0.0.1", HostPort: "55556" }]; }],
    ["malformed published binding", value => { value.NetworkSettings.Ports["5432/tcp"] = [null]; }],
  ]) {
    const changed = structuredClone(db);
    mutate(changed);
    assert.throws(() => validateDockerBoundary(target, changed, network, route), /annual_http_db_ports_invalid/u, name);
  }
  const wrongTarget = { ...target, url: new URL(target.url) };
  wrongTarget.url.port = "55556";
  assert.throws(() => validateDockerBoundary(wrongTarget, db, network, route), /annual_http_db_ports_invalid/u);
});

test("null publication never reuses a prior valid ownership or network snapshot", () => {
  const { target, db, network } = boundary();
  db.NetworkSettings.Ports = { "5432/tcp": null };
  assert.doesNotThrow(() => validateDockerBoundary(target, db, network, route));
  for (const mutate of [
    value => { value.db.Id = "c".repeat(64); },
    value => { value.db.Name = "/supabase_db_other"; },
    value => { value.db.State.Running = false; },
    value => { value.db.HostConfig.NetworkMode = "host"; },
    value => { value.db.NetworkSettings.Networks.bridge = { NetworkID: "c".repeat(64), IPAddress: "172.19.0.2" }; },
    value => { value.network.Internal = false; },
    value => { value.network.EnableIPv6 = true; },
    value => { value.network.Labels = {}; },
    value => { value.network.Containers.extra = { Name: "foreign" }; },
    value => { value.network.Id = "c".repeat(64); },
    value => { value.db.NetworkSettings.Networks[network.Name].IPAddress = "invalid"; },
  ]) {
    const changed = structuredClone({ db, network });
    mutate(changed);
    assert.throws(() => validateDockerBoundary(target, changed.db, changed.network, route), /^Error: annual_http_/u);
  }
  assert.throws(() => validateDockerBoundary(target, db, network, `${route}eth0 00000000 010011AC 0003 0 0 0 00000000 0 0 0\n`), /annual_http_default_route_forbidden/u);
  assert.throws(() => validateDockerBoundary(target, db, network, "missing"), /annual_http_route_invalid/u);
});

test("PostgREST sidecar rejects missing publication metadata, foreign members and mounts", () => {
  const { target, db, network } = boundary();
  const sidecarId = "c".repeat(64), sidecarName = "tips_annual_http_fixture", imageId = `sha256:${"d".repeat(64)}`;
  const sidecar = { Id: sidecarId, Name: `/${sidecarName}`, Image: imageId, State: { Running: true },
    Config: { Labels: { "tips.isolated-db-qa": project, "tips.annual-http-owner": createHash("sha256").update(localEnv.TASK_LOCAL_DB_NONCE).digest("hex") } },
    HostConfig: { ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"], Privileged: false,
      PortBindings: {}, Binds: null, NetworkMode: network.Id }, Mounts: [],
    NetworkSettings: { Ports: { "3000/tcp": null }, Networks: { [network.Name]: { NetworkID: network.Id, IPAddress: "172.18.0.3" } } } };
  const sidecarNetwork = { ...network, Containers: { ...network.Containers, [sidecarId]: { Name: sidecarName } } };
  const facts = { sidecarId, sidecarName, imageId, networkId: network.Id, dbId: db.Id, network: sidecarNetwork };
  assert.equal(validateSidecarBoundary(target, sidecar, facts), "172.18.0.3");
  for (const mutate of [
    value => { delete value.NetworkSettings.Ports; },
    value => { value.HostConfig.PortBindings = null; },
    value => { value.NetworkSettings.Ports["3000/tcp"] = [{ HostIp: "127.0.0.1", HostPort: "3000" }]; },
    value => { value.HostConfig.CapDrop = []; },
    value => { value.HostConfig.SecurityOpt = []; },
    value => { value.HostConfig.Privileged = true; },
    value => { value.Mounts = [{ Type: "bind", Destination: "/tmp" }]; },
    value => { value.Image = `sha256:${"e".repeat(64)}`; },
    value => { value.Config.Labels["tips.annual-http-owner"] = "foreign"; },
  ]) {
    const changed = structuredClone(sidecar);
    mutate(changed);
    assert.throws(() => validateSidecarBoundary(target, changed, facts), /annual_http_sidecar_boundary_invalid/u);
  }
  assert.throws(() => validateSidecarBoundary(target, sidecar, { ...facts, network: { ...sidecarNetwork, Containers: network.Containers } }), /annual_http_sidecar_network_membership_mismatch/u);
});

test("uncertain-create cleanup can recover only the exact newly owned ID and never a foreign container", () => {
  const { target } = boundary();
  const sidecarName = "tips_annual_http_owned", imageId = `sha256:${"d".repeat(64)}`;
  const owned = { Id: "c".repeat(64), Name: `/${sidecarName}`, Image: imageId, Config: { Labels: {
    "tips.isolated-db-qa": project, "tips.annual-http-owner": createHash("sha256").update(localEnv.TASK_LOCAL_DB_NONCE).digest("hex") } } };
  assert.equal(ownedSidecarId(owned, target, sidecarName, imageId), owned.Id);
  for (const changed of [{ ...owned, Name: "/existing" }, { ...owned, Image: "other" }, { ...owned, Config: { Labels: {} } }, { ...owned, Id: "short" }]) {
    assert.throws(() => ownedSidecarId(changed, target, sidecarName, imageId), /annual_http_sidecar_cleanup_owner_mismatch/u);
  }
});

test("synthetic JWT uses ephemeral nonce for HS256 and cannot accept a short signing key", () => {
  const claims = { role: "authenticated", sub: HTTP_ACTORS[0].id, exp: 1234 };
  const token = signSyntheticJwt(localEnv.TASK_LOCAL_DB_NONCE, claims);
  const [header, payload, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "HS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), claims);
  assert.equal(signature, createHmac("sha256", localEnv.TASK_LOCAL_DB_NONCE).update(`${header}.${payload}`).digest("base64url"));
  assert.throws(() => signSyntheticJwt("short", claims), /annual_http_nonce_required/u);
});

test("committed HTTP fixture only creates fresh synthetic rows and never changes schema/RLS/ACL", () => {
  const sql = buildFixtureSql();
  assert.match(sql, /annual_http_fixture_collision/u);
  assert.match(sql, /insert into auth\.users\(id\)/u);
  assert.match(sql, /commit;/u);
  assert.ok(HTTP_CASES.every(entry => sql.includes(entry.id)));
  assert.ok(HTTP_ACTORS.every(actor => sql.includes(actor.id)));
  assert.doesNotMatch(sql, /\b(?:create|alter|drop|grant|revoke|delete|truncate)\b/iu);
  assert.doesNotMatch(sql, /password|email|provider/iu);
  assert.match(sql, /academic_event_exam_details/u);
  assert.ok(!sql.includes("9299"), "HTTP fixtures do not collide with the pgTAP suite");
});

test("HTTP response contract rejects exclusive-end or metadata/date regressions and keeps independent detail", () => {
  const entries = HTTP_CASES.map(entry => ({ id: entry.id, start: entry.start, end: entry.end,
    dateLabel: entry.start === entry.end ? entry.start : `${entry.start} ~ ${entry.end}`,
    displayMeta: entry.meta.rangeEnd == null ? {} : { rangeEnd: String(entry.meta.rangeEnd) } }));
  entries.push({ id: `exam-detail:${HTTP_DETAIL_ID}`, start: "2198-10-07", end: "2198-10-07", dateLabel: "2198-10-07", examDateLabel: "2198-10-07", displayMeta: { rangeEnd: "2198-10-08" } });
  const body = { ok: true, data: { academicYear: HTTP_YEAR, rows: [{ schoolId: HTTP_SCHOOL_ID, typeBuckets: { 시험기간: entries } }] } };
  assert.equal(assertAnnualContract(body).dates[0].end, "2198-10-08");
  for (const mutate of [
    value => { value.data.rows[0].typeBuckets.시험기간[0].end = "2198-10-09"; },
    value => { value.data.rows[0].typeBuckets.시험기간[0].dateLabel = "2198-10-06"; },
    value => { delete value.data.rows[0].typeBuckets.시험기간[0].displayMeta.rangeEnd; },
    value => { value.data.rows[0].typeBuckets.시험기간.at(-1).end = "2198-10-08"; },
    value => { value.data.rows[0].typeBuckets.시험기간.at(-1).dateLabel = "2198-10-06 ~ 2198-10-08"; },
  ]) {
    const changed = structuredClone(body);
    mutate(changed);
    assert.throws(() => assertAnnualContract(changed), /^Error: annual_http_/u);
  }
});


test("assistant annual HTTP scope accepts an explicit empty response and rejects leaks or malformed counts", () => {
  const empty = { ok: true, data: { academicYear: HTTP_YEAR, rows: [],
    summary: { eventCount: 0, schoolCount: 0, activeTypeCount: 0 } } };
  assert.equal(assertAnnualRoleContract(empty, "assistant"), null);
  for (const mutate of [
    value => { value.ok = false; },
    value => { value.data.academicYear += 1; },
    value => { delete value.data.rows; },
    value => { value.data.rows.push({ schoolId: HTTP_SCHOOL_ID, typeBuckets: {} }); },
    value => { value.data.rows.push({ schoolId: "another-school", typeBuckets: {} }); },
    value => { value.data.summary.eventCount = 1; },
    value => { value.data.summary.schoolCount = 1; },
    value => { value.data.summary.activeTypeCount = 1; },
    value => { value.data.summary.eventCount = "0"; },
    value => { delete value.data.summary; },
  ]) {
    const changed = structuredClone(empty);
    mutate(changed);
    assert.throws(() => assertAnnualRoleContract(changed, "assistant"), /^Error: annual_http_/u);
  }
  for (const role of ["viewer", "teacher", "staff", "admin"]) {
    assert.throws(() => assertAnnualRoleContract(empty, role), /annual_http_entry_count_mismatch/u,
      `${role} must not inherit assistant empty-scope expectations`);
  }
  assert.throws(() => assertAnnualRoleContract(empty, "unknown"), /annual_http_role_scope_invalid/u);
});

test("all four existing full-read roles keep the unchanged strict annual date and metadata oracle", () => {
  const entries = HTTP_CASES.map(entry => ({ id: entry.id, start: entry.start, end: entry.end,
    dateLabel: entry.start === entry.end ? entry.start : `${entry.start} ~ ${entry.end}`,
    displayMeta: entry.meta.rangeEnd == null ? {} : { rangeEnd: String(entry.meta.rangeEnd) } }));
  entries.push({ id: `exam-detail:${HTTP_DETAIL_ID}`, start: "2198-10-07", end: "2198-10-07", dateLabel: "2198-10-07",
    examDateLabel: "2198-10-07", displayMeta: { rangeEnd: "2198-10-08" } });
  const body = { ok: true, data: { academicYear: HTTP_YEAR,
    rows: [{ schoolId: HTTP_SCHOOL_ID, typeBuckets: { examination: entries } }] } };
  for (const role of ["viewer", "teacher", "staff", "admin"]) {
    assert.deepEqual(assertAnnualRoleContract(body, role), assertAnnualContract(body));
    const changed = structuredClone(body);
    changed.data.rows[0].typeBuckets.examination[0].end = "2198-10-09";
    assert.throws(() => assertAnnualRoleContract(changed, role), /annual_http_inclusive_period_mismatch/u);
  }
  assert.throws(() => assertAnnualRoleContract(body, "assistant"), /annual_http_assistant_scope_mismatch/u);
});

test("runtime source keeps transport secrets off arguments/output and exact owned cleanup", async () => {
  const source = await readFile(new URL("probe-operations-annual-board-http.mjs", import.meta.url), "utf8");
  assert.match(source, /assertAnnualRoleContract\(response\.body, actor\.role\)/u);
  assert.match(source, /"assistant_raw_rls_mismatch"/u);
  assert.match(source, /"--pull=never"/u);
  assert.match(source, /"--read-only"/u);
  assert.match(source, /"--env", "PGRST_DB_URI", "--env", "PGRST_JWT_SECRET"/u);
  assert.match(source, /dbUri\.username = "authenticator"/u);
  assert.match(source, /"curl", "--config", "-"/u);
  assert.match(source, /execute\(\["rm", "--force", sidecarId\]/u);
  assert.match(source, /"tips\.annual-http-owner"/u);
  assert.doesNotMatch(source, /--label.*target\.nonce/u);
  assert.doesNotMatch(source, /console\.(?:log|error)|fetch\(|https:\/\/|docker.*pull\b/u);
});
