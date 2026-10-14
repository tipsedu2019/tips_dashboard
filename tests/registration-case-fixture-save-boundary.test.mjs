import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import vm from "node:vm";
import ts from "typescript";
import * as fixtureRuntime from "../src/features/tasks/registration-track-fixture-runtime.ts";

const serviceUrl = new URL("../src/features/tasks/registration-track-service.ts", import.meta.url);
const fixtureError = "registration_subject_track_fixture_explicit_client_required";
const fixtureMessage = "샘플 화면에서는 새 등록 정보를 저장할 수 없습니다.";
const parentCanary = "private-parent-phone-canary";
const studentCanary = "private-student-phone-canary";
const networkAttempts = [];
const denyNetwork = () => {
  networkAttempts.push("denied");
  throw new Error("registration_fixture_boundary_network_forbidden");
};

test.before(() => {
  for (const [target, name] of [
    [globalThis, "fetch"], [http, "request"], [http, "get"],
    [https, "request"], [https, "get"], [net, "connect"],
    [net, "createConnection"], [net.Socket.prototype, "connect"],
    [net.Server.prototype, "listen"], [tls, "connect"], [dgram, "createSocket"],
  ]) mock.method(target, name, denyNetwork);
});
test.after(() => mock.restoreAll());
test.beforeEach(() => { networkAttempts.length = 0; });
test.afterEach(() => assert.equal(networkAttempts.length, 0, "every network destination is forbidden"));

function browserState(t, state, nodeEnv = "test") {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousEnv = process.env.NODE_ENV;
  Object.defineProperty(globalThis, "window", { value: state, configurable: true });
  process.env.NODE_ENV = nodeEnv;
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  });
}

function installIncompleteFixture(t) {
  const release = fixtureRuntime.installRegistrationSubjectTrackFixtureRuntime(
    "test", fixtureRuntime.REGISTRATION_SUBJECT_TRACK_FIXTURE_QUERY_VALUE, {},
  );
  t.after(release);
}

function spoofDebugGlobal(t, value) {
  const key = fixtureRuntime.REGISTRATION_SUBJECT_TRACK_FIXTURE_DEBUG_GLOBAL;
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { value, configurable: true });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, key, previous);
    else Reflect.deleteProperty(globalThis, key);
  });
}

function input(extra = {}) {
  return {
    studentName: "synthetic student", schoolGrade: "", schoolName: "",
    parentPhone: parentCanary, studentPhone: studentCanary, campus: "",
    inquiryAt: "", subjects: ["math"], requestNote: "", priority: "normal",
    requestKey: "fixture-boundary-request", ...extra,
  };
}

function deliberateMockClient() {
  const calls = [];
  return {
    calls,
    client: {
      from: denyNetwork,
      async rpc(name, args) {
        calls.push({ name, args });
        return { data: { taskId: "synthetic-task", caseId: "synthetic-case", tracks: [] }, error: null };
      },
    },
  };
}

async function loadRealCreationBoundary(defaultClient) {
  const source = await readFile(serviceUrl, "utf8");
  const start = source.indexOf("// registration-track-service-factory:start");
  const end = source.indexOf("// registration-track-service-factory:end", start);
  assert.ok(start >= 0 && end > start);
  const parsed = ts.createSourceFile("registration-track-service.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(row => row.name.getText(parsed) === "defaultRegistrationTrackService"));
  const wrapper = parsed.statements.find(node => ts.isFunctionDeclaration(node)
    && node.name?.text === "createRegistrationCase");
  assert.ok(declaration && wrapper, "load the actual default-client constructor and canonical wrapper");
  const code = ts.transpileModule([
    source.slice(start, end), declaration.getText(parsed), wrapper.getText(parsed),
    "module.exports = { createRegistrationTrackService, createRegistrationCase };",
  ].join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const sandboxModule = { exports: {} };
  const ready = () => Promise.resolve({ mode: "ready", version: 1 });
  const context = {
    module: sandboxModule, exports: sandboxModule.exports, supabase: defaultClient,
    hasRegistrationSubjectTrackFixtureContext: fixtureRuntime.hasRegistrationSubjectTrackFixtureContext,
    probeRegistrationSubjectTrackRuntime: ready,
    probeRegistrationIntakeWorkflowRuntime: () => Promise.resolve({ available: true, version: 1 }),
    probeRegistrationObservationRuntime: ready,
    invalidateRegistrationSubjectTrackRuntimeAfterReadyFailure() {},
    invalidatePublicClassesCacheAfterMutation() {},
    registrationTrackMutationCacheInvalidator: null,
    performance: undefined, setTimeout, clearTimeout, AbortController, AbortSignal,
    fetch: denyNetwork, require: denyNetwork,
    WebSocket: class { constructor() { denyNetwork(); } },
    XMLHttpRequest: class { constructor() { denyNetwork(); } },
    console: { log: denyNetwork, warn: denyNetwork, error: denyNetwork, table: denyNetwork },
  };
  vm.runInNewContext(code, context, { timeout: 10_000 });
  return sandboxModule.exports;
}

async function assertBlocked(call) {
  const error = await call.then(() => null, value => value);
  assert.equal(error?.code, fixtureError);
  assert.equal(error?.message, fixtureMessage);
  assert.equal(String(error).includes(parentCanary), false);
  assert.equal(String(error).includes(studentCanary), false);
}

test("canonical creation refuses an installed incomplete fixture before default RPC or payload reads", async t => {
  browserState(t, { location: { search: "" } });
  installIncompleteFixture(t);
  let reads = 0;
  const payload = input();
  Object.defineProperty(payload, "parentPhone", { get() { reads += 1; return parentCanary; } });
  const service = await loadRealCreationBoundary({ rpc: denyNetwork, from: denyNetwork });
  await assertBlocked(service.createRegistrationCase(payload));
  assert.equal(reads, 0);
});

test("canonical creation refuses empty, duplicate, unknown and unreadable fixture browser state", async t => {
  browserState(t, { location: { search: "" } }, "production");
  const service = await loadRealCreationBoundary({ rpc: denyNetwork, from: denyNetwork });
  for (const state of [
    { location: { search: "?fixture=registration-subject-tracks" } },
    { location: { search: "?fixture=" } },
    { location: { search: "?fixture=unknown" } },
    { location: { search: "?fixture=unknown&fixture=registration-subject-tracks" } },
    { location: { search: "?fixture=registration-subject-tracks&fixture=" } },
    { location: {} }, {}, null,
    { get location() { throw new Error("browser_state_unreadable"); } },
  ]) {
    Object.defineProperty(globalThis, "window", { value: state, configurable: true });
    await assertBlocked(service.createRegistrationCase(input()));
  }
});

test("payload and debug-global fixture or mock flags cannot bypass the canonical fixture refusal", async t => {
  browserState(t, { location: { search: "?fixture=registration-subject-tracks" } });
  const injected = deliberateMockClient();
  spoofDebugGlobal(t, { fixture: false, mock: true, client: injected.client });
  const service = await loadRealCreationBoundary({ rpc: denyNetwork, from: denyNetwork });
  await assertBlocked(service.createRegistrationCase(input({ fixture: false, mock: true, client: injected.client })));
  assert.equal(injected.calls.length, 0);
});

test("deliberately injected factory client can create an isolated fixture without a default or network fallback", async t => {
  browserState(t, { location: { search: "?fixture=registration-subject-tracks" } });
  installIncompleteFixture(t);
  const boundary = await loadRealCreationBoundary({ rpc: denyNetwork, from: denyNetwork });
  const injected = deliberateMockClient();
  const service = boundary.createRegistrationTrackService(injected.client, {
    probeRuntime: () => Promise.resolve({ mode: "ready", version: 1 }),
    probeIntakeRuntime: () => Promise.resolve({ available: true, version: 1 }),
    invalidatePublicClassesCacheAfterMutation() {},
  });
  const result = await service.createRegistrationCase(input());
  assert.equal(result.taskId, "synthetic-task");
  assert.equal(injected.calls.length, 1);
  assert.equal(injected.calls[0].name, "create_registration_case");
  assert.equal(injected.calls[0].args.p_parent_phone === parentCanary, true);
  assert.equal(injected.calls[0].args.p_student_phone === studentCanary, true);
  assert.equal(JSON.stringify(result).includes(parentCanary), false);
  assert.equal(JSON.stringify(result).includes(studentCanary), false);
});

test("ordinary production canonical creation keeps the default-client RPC contract and ignores payload flags", async t => {
  browserState(t, { location: { search: "?view=registration" } }, "production");
  const inactiveRelease = fixtureRuntime.installRegistrationSubjectTrackFixtureRuntime(
    "production", fixtureRuntime.REGISTRATION_SUBJECT_TRACK_FIXTURE_QUERY_VALUE, {},
  );
  t.after(inactiveRelease);
  const spoofed = deliberateMockClient();
  spoofDebugGlobal(t, { fixture: true, mock: true, client: spoofed.client });
  const defaultClient = deliberateMockClient();
  const service = await loadRealCreationBoundary(defaultClient.client);
  const result = await service.createRegistrationCase(input({ fixture: true, mock: true }));
  assert.equal(result.taskId, "synthetic-task");
  assert.equal(defaultClient.calls.length, 1);
  assert.equal(defaultClient.calls[0].name, "create_registration_case");
  assert.equal(defaultClient.calls[0].args.p_parent_phone === parentCanary, true);
  assert.equal(defaultClient.calls[0].args.p_student_phone === studentCanary, true);
  assert.equal(spoofed.calls.length, 0);
});
