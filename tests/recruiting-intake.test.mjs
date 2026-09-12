import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { createRecruitingApplicationHandler, createRecruitingAdminHandlers, createRecruitingProxyProbeHandler, allowedOrigins } from "../src/features/recruiting/server/recruiting-routes.ts";
import { parseApplication, readBoundedJson } from "../src/features/recruiting/server/recruiting-validation.ts";
import { createIntakeStore, authenticateRecruitingAdmin } from "../src/features/recruiting/server/recruiting-store.ts";
import { RECRUITING_CONSENT_VERSION, RECRUITING_RETENTION_DAYS } from "../src/features/recruiting/recruiting-policy.ts";

const env = { NEXT_PUBLIC_SUPABASE_URL: "https://recruiting-fixture.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-public-key", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key", RECRUITING_APPLICATIONS_ENABLED: "true", RECRUITING_RATE_LIMIT_SECRET: "fixture-secret-never-used-remotely-123456", RECRUITING_ALLOWED_ORIGINS: "https://tips.example,http://127.0.0.1:3189" };
const body = () => ({ requestId: randomUUID(), name: "모의 지원자", phone: "010-0000-0000", subject: "과학", experience: "모의 경력", motivation: "실제 지원서가 아닌 테스트 데이터입니다.", portfolioUrl: "https://example.org/portfolio", talentPoolConsent: true, consentVersion: RECRUITING_CONSENT_VERSION, website: "" });
const request = (data = body(), headers = {}, url = "https://tips.example/api/recruiting/applications") => new Request(url, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://tips.example", ...headers }, body: JSON.stringify(data) });
const receipt = { status: "accepted", applicationId: randomUUID(), receivedAt: "2026-09-11T12:00:00Z" };

const probeSecret = "one-off-proxy-probe-fixture-key-1234567890";
const probeRequest = (headers = {}, method = "GET", search = "") => new Request(`https://tips.example/api/recruiting/applications${search}`, {
  method, headers: { Authorization: `Bearer ${probeSecret}`, ...headers },
});

test("IP parity probe is closed for missing/short configuration, wrong auth and non-GET methods", async () => {
  for (const secret of [undefined, "", " ", "s".repeat(31)]) {
    const handler = createRecruitingProxyProbeHandler({ env: { VERCEL: "1", RECRUITING_PROXY_PROBE_SECRET: secret } });
    const result = await handler(probeRequest());
    assert.equal(result.status, 405);
    assert.deepEqual(await result.json(), { ok: false, code: "method_not_allowed" });
  }
  const handler = createRecruitingProxyProbeHandler({ env: { VERCEL: "1", RECRUITING_PROXY_PROBE_SECRET: probeSecret } });
  for (const authorization of ["", "Bearer wrong", `Bearer ${"x".repeat(probeSecret.length)}`, `Basic ${probeSecret}`]) {
    const result = await handler(probeRequest({ Authorization: authorization }));
    assert.equal(result.status, 405);
    assert.equal(result.headers.get("Allow"), "POST");
    assert.match(result.headers.get("Cache-Control"), /no-store, private/);
    assert.deepEqual(await result.json(), { ok: false, code: "method_not_allowed" });
  }
  for (const method of ["HEAD", "POST", "DELETE", "OPTIONS"]) assert.equal((await handler(probeRequest({}, method))).status, 405);
  assert.equal((await handler(probeRequest({}, "GET", "?probe=1"))).status, 405);
});

test("IP parity probe uses only its separate key and resolved address without DB, auth, writes or logging", async (t) => {
  const remote = t.mock.method(globalThis, "fetch", () => assert.fail("Probe must not make any network or persistence request"));
  const logs = ["log", "warn", "error"].map(method => t.mock.method(console, method, () => assert.fail("Probe must not log metadata")));
  const onlyProbeEnv = new Proxy({ VERCEL: "1", RECRUITING_PROXY_PROBE_SECRET: probeSecret }, {
    get(target, key) {
      assert.ok(["VERCEL", "RECRUITING_PROXY_PROBE_SECRET"].includes(key), "Probe must not access Supabase, admin or quota configuration");
      return target[key];
    },
  });
  const response = await createRecruitingProxyProbeHandler({ env: onlyProbeEnv })(probeRequest({ "x-vercel-forwarded-for": "192.0.2.10" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store, private");
  const output = await response.json();
  assert.deepEqual(output, { addressHash: createHmac("sha256", probeSecret).update("192.0.2.10").digest("hex"), resolved: true });
  assert.equal(JSON.stringify(output).includes("192.0.2.10"), false);
  assert.equal(JSON.stringify(output).includes(probeSecret), false);
  assert.equal(remote.mock.callCount(), 0);
  for (const log of logs) assert.equal(log.mock.callCount(), 0);
});

test("IP parity probe ignores forged XFF and follows the exact existing trusted-header address rules", async () => {
  const handler = createRecruitingProxyProbeHandler({ env: { VERCEL: "1", RECRUITING_PROXY_PROBE_SECRET: probeSecret } });
  const trusted = { "x-vercel-forwarded-for": "192.0.2.10" };
  const first = await (await handler(probeRequest({ ...trusted, "x-forwarded-for": "192.0.2.20" }))).json();
  const forged = await (await handler(probeRequest({ ...trusted, "x-forwarded-for": "192.0.2.30", "x-real-ip": "192.0.2.30" }))).json();
  assert.deepEqual(first, forged);
  const second = await (await handler(probeRequest({ "x-vercel-forwarded-for": "192.0.2.11" }))).json();
  assert.notEqual(first.addressHash, second.addressHash);
  const ipv6 = await (await handler(probeRequest({ "x-vercel-forwarded-for": " 2001:db8::1, 192.0.2.10 " }))).json();
  assert.deepEqual(ipv6, { addressHash: createHmac("sha256", probeSecret).update("2001:db8::1").digest("hex"), resolved: true });
  for (const headers of [{}, { "x-forwarded-for": "192.0.2.10" }, { "x-vercel-forwarded-for": "invalid", "x-forwarded-for": "192.0.2.10" }]) {
    assert.deepEqual(await (await handler(probeRequest(headers))).json(), { addressHash: createHmac("sha256", probeSecret).update("unresolved").digest("hex"), resolved: false });
  }
  const local = createRecruitingProxyProbeHandler({ env: { RECRUITING_PROXY_PROBE_SECRET: probeSecret } });
  assert.equal((await (await local(probeRequest(trusted))).json()).resolved, false);
});

test("clearing the one-off probe key closes GET while leaving intake configuration separate", async () => {
  const probeEnv = { VERCEL: "1", RECRUITING_PROXY_PROBE_SECRET: probeSecret, RECRUITING_RATE_LIMIT_SECRET: env.RECRUITING_RATE_LIMIT_SECRET };
  const handler = createRecruitingProxyProbeHandler({ env: probeEnv });
  assert.equal((await handler(probeRequest())).status, 200);
  delete probeEnv.RECRUITING_PROXY_PROBE_SECRET;
  assert.equal((await handler(probeRequest())).status, 405);
  assert.equal(probeEnv.RECRUITING_RATE_LIMIT_SECRET, env.RECRUITING_RATE_LIMIT_SECRET);
});

test("approved two-year policy requires fresh v2 consent for new intake", async () => {
  assert.equal(RECRUITING_CONSENT_VERSION, "talent-pool-v2");
  assert.equal(RECRUITING_RETENTION_DAYS, 730);
  let writes = 0;
  const handler = createRecruitingApplicationHandler({ env, store: { async submit() { writes++; return receipt; } } });
  const stale = await handler(request({ ...body(), consentVersion: "talent-pool-v1" }));
  assert.equal(stale.status, 400);
  assert.ok((await stale.json()).fieldErrors.consentVersion);
  assert.equal(writes, 0, "old consent cannot silently authorize longer retention");
  assert.equal((await handler(request())).status, 201);
  assert.equal(writes, 1);
});

test("public intake closes with 503 for each missing setting without invoking storage", async () => {
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RECRUITING_APPLICATIONS_ENABLED", "RECRUITING_RATE_LIMIT_SECRET", "RECRUITING_ALLOWED_ORIGINS"]) {
    const handler = createRecruitingApplicationHandler({ env: { ...env, [key]: "" }, store: { submit() { assert.fail("No persistence without complete configuration"); } } });
    assert.equal((await handler(request())).status, 503);
  }
});
test("strict origin allowlist rejects wildcard, paths, insecure remote origins and unsolicited requests", async () => {
  for (const value of ["*", "https://tips.example/path", "http://tips.example", "garbage"]) assert.equal(allowedOrigins({ RECRUITING_ALLOWED_ORIGINS: value }), null);
  const handler = createRecruitingApplicationHandler({ env, store: { submit() { assert.fail(); } } });
  assert.equal((await handler(request(body(), { Origin: "https://evil.example" }))).status, 403);
  assert.equal((await handler(request(body(), { Origin: "" }))).status, 403);
  assert.equal((await handler(request(body(), {}, "https://tips.example/api/recruiting/applications?phone=private"))).status, 400);
});
test("normalization is stable across duplicate-click retries; receipt contains no submitted content", async () => {
  const submissions = [];
  const handler = createRecruitingApplicationHandler({ env, store: { async submit(data, signal) { submissions.push(data); assert.ok(signal instanceof AbortSignal); return receipt; } } });
  const input = body();
  for (let count = 0; count < 2; count++) {
    const response = await handler(request(input));
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { ok: true, applicationId: receipt.applicationId, receivedAt: receipt.receivedAt });
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  assert.equal(submissions[0].phone, "01000000000");
  assert.equal(submissions[0].requestHash, submissions[1].requestHash);
  assert.match(submissions[0].contactFingerprint, /^[0-9a-f]{64}$/);
  assert.notEqual(submissions[0].ipFingerprint, submissions[0].globalFingerprint);
});
test("arbitrary forwarded IP headers cannot expand local/fallback rate budgets", async () => {
  const seen = [];
  const handler = createRecruitingApplicationHandler({ env, store: { async submit(input) { seen.push(input.ipFingerprint); return receipt; } } });
  await handler(request(body(), { "x-forwarded-for": "192.0.2.1", "x-vercel-forwarded-for": "192.0.2.1" }));
  await handler(request(body(), { "x-forwarded-for": "192.0.2.2", "x-vercel-forwarded-for": "192.0.2.2" }));
  assert.equal(seen[0], seen[1]);
});
test("validation bounds consent, types, text, subject, honeypot and safe optional URLs", async () => {
  const cases = [ ["name", ""], ["name", "A".repeat(81)], ["phone", "wrong"], ["subject", "국어"], ["experience", "a".repeat(2001)], ["motivation", "short"], ["talentPoolConsent", false], ["consentVersion", "stale"], ["requestId", "invalid"], ["portfolioUrl", "javascript:alert(1)"], ["portfolioUrl", "https://user:pass@example.org"], ["portfolioUrl", "http://example.org"], ["website", "bot"], ["name", "name\u0000"] ];
  const handler = createRecruitingApplicationHandler({ env, store: { submit() { assert.fail("Invalid input reached persistence"); } } });
  for (const [key, value] of cases) {
    const response = await handler(request({ ...body(), [key]: value }));
    assert.equal(response.status, 400, key);
    const result = await response.json(); assert.ok(result.fieldErrors); assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes("모의 지원자"), false);
  }
  assert.ok(parseApplication({ ...body(), portfolioUrl: "" }).data);
  assert.ok(parseApplication({ ...body(), extra: "private" }).fields);
});
test("body limit applies to actual UTF-8 bytes, including a false Content-Length", async () => {
  const handler = createRecruitingApplicationHandler({ env, store: { submit() { assert.fail(); } } });
  assert.equal((await handler(request({ ...body(), motivation: "가".repeat(6000) }, { "Content-Length": "1" }))).status, 413);
  assert.equal((await handler(request(body(), { "Content-Length": "999999" }))).status, 413);
  assert.equal((await handler(request(body(), { "Content-Type": "text/plain" }))).status, 415);
  const malformed = new Request("https://tips.example", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  await assert.rejects(readBoundedJson(malformed), { code: "invalid_request", status: 400 });
});
test("slow streamed bodies time out and cancel before persistence", async () => {
  let cancelled = false;
  const slow = new Request("https://tips.example", { method: "POST", headers: { "Content-Type": "application/json" }, body: new ReadableStream({ cancel() { cancelled = true; } }), duplex: "half" });
  await assert.rejects(readBoundedJson(slow), { code: "request_timeout", status: 408 });
  assert.ok(cancelled);
});
test("persistence status maps honestly to retry, conflict, gone and unavailable responses", async () => {
  for (const [result, status, code] of [[{ status: "rate_limited", retryAfter: 120 }, 429, "rate_limited"], [{ status: "conflict" }, 409, "request_id_reused"], [{ status: "gone" }, 410, "application_no_longer_retained"], [{ status: "unavailable" }, 503, "recruiting_unavailable"]]) {
    const response = await createRecruitingApplicationHandler({ env, store: { async submit() { return result; } } })(request());
    assert.equal(response.status, status); assert.equal((await response.json()).code, code);
    if (status === 429) assert.equal(response.headers.get("Retry-After"), "120");
  }
});
test("provider errors and malformed receipts never leak private content or become success", async () => {
  for (const store of [{ async submit() { throw new Error("private phone/name/service key"); } }, { async submit() { return { ...receipt, applicationId: "private-data" }; } }]) {
    const response = await createRecruitingApplicationHandler({ env, store })(request());
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, code: "recruiting_unavailable" });
  }
});

test("admin list/detail/delete require server-authenticated admin role", async () => {
  for (const identity of [{ status: 401 }, { status: 503 }, ...["staff", "teacher", "viewer", ""].map((role) => ({ role, store: { list() { assert.fail(); }, detail() { assert.fail(); }, remove() { assert.fail(); } } }))]) {
    const handlers = createRecruitingAdminHandlers({ env, authenticate: async () => identity });
    const expected = identity.status || 403;
    assert.equal((await handlers.list(new Request("https://tips.example/api/admin/recruiting/applications"))).status, expected);
    assert.equal((await handlers.detail(new Request("https://tips.example/detail"), receipt.applicationId)).status, expected);
    assert.equal((await handlers.detail(new Request("https://tips.example/detail", { method: "DELETE" }), receipt.applicationId)).status, expected);
  }
});
test("admin pagination is bounded and supports the existing 10/15/20-row contract", async () => {
  const seen = [];
  const handlers = createRecruitingAdminHandlers({ env, authenticate: async () => ({ role: "admin", store: { async list(page, size) { seen.push([page, size]); return { applications: [], totalCount: 0, retentionLastSucceededAt: null }; } } }) });
  for (const size of [10, 15, 20]) assert.equal((await handlers.list(new Request(`https://tips.example/list?page=2&pageSize=${size}`))).status, 200);
  assert.deepEqual(seen, [[2, 10], [2, 15], [2, 20]]);
  for (const query of ["page=0", "page=10000", "pageSize=1000", "page=1&page=2", "search=private"]) assert.equal((await handlers.list(new Request(`https://tips.example/list?${query}`))).status, 400);
});
test("admin deletion requires an exact ID, trusted origin and explicit confirm=true", async () => {
  const removed = [];
  const handlers = createRecruitingAdminHandlers({ env, authenticate: async () => ({ role: "admin", store: { async remove(id) { removed.push(id); return true; }, async detail() { return null; } } }) });
  const del = (data, origin = "https://tips.example") => new Request("https://tips.example/detail", { method: "DELETE", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(data) });
  for (const data of [{}, { confirm: false }, { confirm: true, id: "other" }]) assert.equal((await handlers.detail(del(data), receipt.applicationId)).status, 400);
  assert.equal((await handlers.detail(del({ confirm: true }, "https://evil.example"), receipt.applicationId)).status, 403);
  assert.equal((await handlers.detail(del({ confirm: true }), "not-an-id")).status, 400);
  assert.equal((await handlers.detail(del({ confirm: true }), receipt.applicationId)).status, 200);
  assert.deepEqual(removed, [receipt.applicationId]);
  assert.equal((await handlers.detail(new Request("https://tips.example/detail"), receipt.applicationId)).status, 404);
});
test("real Supabase intake adapter emits only the expected RPC contract and retention pair", async (t) => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  let sent;
  globalThis.fetch = async (url, init) => { assert.equal(new URL(url).pathname, "/rest/v1/rpc/submit_recruiting_application_v1"); sent = JSON.parse(init.body); return Response.json(receipt); };
  const data = parseApplication(body()).data;
  const result = await createIntakeStore(env).submit({ ...data, requestHash: "a".repeat(64), ipFingerprint: "b".repeat(64), contactFingerprint: "c".repeat(64), globalFingerprint: "d".repeat(64) }, new AbortController().signal);
  assert.deepEqual(result, receipt); assert.equal(sent.p_consent_version, RECRUITING_CONSENT_VERSION); assert.equal(sent.p_retention_days, RECRUITING_RETENTION_DAYS); assert.equal(sent.p_phone, "01000000000");
});
test("admin adapter verifies user and role using the bearer client, and never the service key", async (t) => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const urls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname; urls.push(path);
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture-admin-token");
    assert.equal(new Headers(init.headers).get("apikey"), env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    if (path === "/auth/v1/user") return Response.json({ id: randomUUID() });
    if (path.endsWith("current_dashboard_role")) return Response.json("admin");
    if (path.endsWith("recruiting_retention_status")) return Response.json({ last_succeeded_at: receipt.receivedAt });
    assert.equal(path, "/rest/v1/recruiting_applications");
    const query = new URL(url).searchParams;
    assert.equal(query.get("limit"), "15"); assert.equal(query.get("offset"), "15");
    assert.equal(query.get("select").includes("request_hash"), false);
    assert.ok(query.get("expires_at").startsWith("gt."));
    return Response.json([], { headers: { "Content-Range": "*/0" } });
  };
  const identity = await authenticateRecruitingAdmin(new Request("https://tips.example/list", { headers: { Authorization: "Bearer fixture-admin-token" } }), env);
  assert.equal(identity.role, "admin");
  assert.deepEqual(await identity.store.list(2, 15), { applications: [], totalCount: 0, retentionLastSucceededAt: receipt.receivedAt });
  assert.ok(urls.includes("/auth/v1/user")); assert.ok(urls.includes("/rest/v1/rpc/current_dashboard_role"));
});
