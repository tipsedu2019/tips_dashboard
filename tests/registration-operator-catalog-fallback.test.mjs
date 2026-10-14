import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

import { getRoleCapabilities } from "../src/lib/auth-utils.ts";
import { getRegistrationActionPermissions } from "../src/features/tasks/registration-track-model.js";

const serviceSource = await readFile(new URL("../src/features/tasks/registration-track-service.ts", import.meta.url), "utf8");
const actionsSource = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8");

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `source boundaries: ${start}, ${end}`);
  return source.slice(startIndex, endIndex);
}

function compile(source, globals = {}) {
  const loadedModule = { exports: {} };
  vm.runInNewContext(stripTypeScriptTypes(source, { mode: "strip" }).replace(/^export /gm, ""), {
    module: loadedModule, exports: loadedModule.exports, ...globals,
  });
  return loadedModule.exports;
}

const { createRegistrationTrackService } = compile(`${sourceBetween(
  serviceSource,
  "// registration-track-service-factory:start",
  "// registration-track-service-factory:end",
)}\nmodule.exports = { createRegistrationTrackService };`);

// Execute the real selector's producer/consumer contract without rendering JSX.
const directorSelectorSource = sourceBetween(actionsSource,
  "  const activeDirectorProfileIds = useMemo(",
  "  const [directorDraft, setDirectorDraft] = useState({",
);
function availableDirectors(options, subject = "영어", subjectCapabilities = []) {
  return compile(`${directorSelectorSource}\nmodule.exports = availableDirectors;`, {
    teacherOptions: options.teachers,
    directorOptions: options.profiles,
    track: { subject },
    subjectCapabilities,
    useMemo: (selector) => selector(),
  });
}

function fixtureRows() {
  return {
    profiles: [
      { id: "profile-operator", name: "Synthetic Operator", role: "admin", email: "operator@example.test", login_id: "operator" },
      { id: "profile-teacher", name: "Synthetic Teacher", role: "teacher", email: "teacher@example.test", login_id: "teacher" },
    ],
    teacher_catalogs: [
      { id: "catalog-operator", name: "Synthetic Operator", subjects: ["영어"], is_visible: true, sort_order: 1, profile_id: "profile-operator", account_email: "operator@example.test", dashboard_role: "teacher" },
      { id: "catalog-teacher", name: "Synthetic Teacher", subjects: ["영어"], is_visible: true, sort_order: 2, profile_id: "profile-teacher", account_email: "teacher@example.test", dashboard_role: "admin" },
    ],
    classes: [], textbooks: [], academic_schools: [],
  };
}

function harness({ missing = {}, deniedTable = "", deniedError = { code: "42501", message: "permission denied" }, rows = fixtureRows(), code = "42703" } = {}) {
  const queries = [];
  let mutationCalls = 0;
  const client = {
    from(table) {
      return {
        async select(projection) {
          queries.push({ table, projection });
          if (table === deniedTable) return { data: null, error: deniedError };
          const selected = projection.split(",");
          const absent = (missing[table] || []).find((column) => selected.includes(column));
          if (absent) return { data: null, error: { code, message: `column ${table}.${absent} does not exist` } };
          return { data: rows[table].map((row) => Object.fromEntries(selected.filter((column) => column in row).map((column) => [column, row[column]]))), error: null };
        },
      };
    },
    async rpc() { mutationCalls += 1; throw new Error("unexpected RPC"); },
  };
  const service = createRegistrationTrackService(client, {
    probeRuntime: async () => ({ mode: "ready", version: 1 }),
    probeIntakeRuntime: async () => ({ available: true, version: 1 }),
    invalidatePublicClassesCacheAfterMutation: () => {},
  });
  return { service, queries, getMutationCalls: () => mutationCalls };
}

test("optional account display columns preserve operator role and linked director choices", async (t) => {
  for (const [label, missing] of [
    ["profile login id", { profiles: ["login_id"] }],
    ["profile email", { profiles: ["email"] }],
    ["both profile display identities", { profiles: ["email", "login_id"] }],
    ["teacher account email", { teacher_catalogs: ["account_email"] }],
    ["combined optional columns", { profiles: ["login_id"], teacher_catalogs: ["account_email"] }],
  ]) {
    await t.test(label, async () => {
      const io = harness({ missing });
      const result = await io.service.loadWorkspaceOptionData({ viewerId: "profile-operator" });
      assert.equal(result.schemaReady, true);
      assert.equal(result.directorCatalogStatus, "partial");
      assert.equal(result.profiles.find((profile) => profile.id === "profile-operator").role, "admin");
      assert.equal(result.teachers.find((teacher) => teacher.id === "catalog-operator").profileId, "profile-operator");
      assert.deepEqual(Array.from(availableDirectors(result), (profile) => profile.id), ["profile-operator"]);
      assert.equal(getRegistrationActionPermissions({ viewerRole: "admin", viewerId: "profile-operator", track: { directorProfileId: null } }).canManage, true);
      assert.equal(io.getMutationCalls(), 0);
    });
  }
});

test("missing authority or linkage never grants role or guesses an account from a matching name", async (t) => {
  for (const [label, missing] of [
    ["profile role", { profiles: ["role"] }],
    ["teacher profile link", { teacher_catalogs: ["profile_id"] }],
  ]) {
    await t.test(label, async () => {
      const io = harness({ missing });
      const result = await io.service.loadWorkspaceOptionData({ viewerId: "profile-operator" });
      assert.equal(result.directorCatalogStatus, "partial");
      assert.equal(availableDirectors(result).length, 0);
      if (missing.profiles) assert.ok(result.profiles.every((profile) => profile.role === ""));
      if (missing.teacher_catalogs) assert.ok(result.teachers.every((teacher) => teacher.profileId === ""));
      assert.equal(io.getMutationCalls(), 0);
    });
  }
});

test("permission denials surface directly without attempting a schema fallback", async () => {
  const io = harness({ deniedTable: "profiles" });
  const result = await io.service.loadWorkspaceOptionData({ viewerId: "profile-operator" });
  assert.equal(result.schemaReady, false);
  assert.equal(result.directorCatalogStatus, "error");
  assert.match(result.error, /permission denied/);
  assert.equal(io.queries.filter((query) => query.table === "profiles").length, 1);
  assert.equal(availableDirectors(result).length, 0);
  assert.equal(io.getMutationCalls(), 0);
});

test("an authorization denial mentioning a missing column never triggers fallback", async (t) => {
  for (const table of ["profiles", "teacher_catalogs"]) {
    await t.test(table, async () => {
      const io = harness({ deniedTable: table, deniedError: { code: "42501", message: `column ${table}.account_identity does not exist in schema cache; permission denied` } });
      const result = await io.service.loadWorkspaceOptionData({ viewerId: "profile-operator" });
      assert.equal(result.schemaReady, false);
      assert.equal(result.directorCatalogStatus, "error");
      assert.equal(io.queries.filter((query) => query.table === table).length, 1);
      assert.equal(availableDirectors(result).length, 0);
      assert.equal(io.getMutationCalls(), 0);
    });
  }
});

test("PostgREST schema-cache fallback preserves the same operator contract", async () => {
  const io = harness({ missing: { profiles: ["login_id"], teacher_catalogs: ["account_email"] }, code: "PGRST204" });
  const result = await io.service.loadWorkspaceOptionData({ viewerId: "profile-operator" });
  assert.deepEqual(Array.from(availableDirectors(result), (profile) => profile.id), ["profile-operator"]);
  assert.equal(result.directorCatalogStatus, "partial");
});

test("profile authority remains distinct from teacher-catalog display role", async () => {
  const io = harness();
  const result = await io.service.loadWorkspaceOptionData({ viewerId: "profile-operator" });
  assert.equal(result.directorCatalogStatus, "authoritative");
  assert.deepEqual(Array.from(availableDirectors(result), (profile) => profile.id), ["profile-operator"]);
  for (const role of ["admin", "staff", "teacher", "assistant", "viewer", ""]) {
    const expected = ["admin", "staff"].includes(role);
    assert.equal(getRoleCapabilities(role).canManageAll, expected);
    assert.equal(getRegistrationActionPermissions({ viewerRole: role, viewerId: "profile-teacher", track: { directorProfileId: "profile-teacher" } }).canManage, expected);
  }
  assert.equal(io.queries.length, 5, "current schemas retain the original five concurrent catalog reads");
  assert.equal(io.getMutationCalls(), 0);
});
