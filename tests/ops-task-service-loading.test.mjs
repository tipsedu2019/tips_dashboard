import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

import { getRegistrationWorkflowStatusFromLegacyTrack } from "../src/features/tasks/registration-workflow-status.js";

const serviceSource = await readFile(
  new URL("../src/features/tasks/ops-task-service.ts", import.meta.url),
  "utf8",
);
const taskPageMigrationSource = await readFile(
  new URL("../supabase/migrations/20260813234824_ops_task_page_reads.sql", import.meta.url),
  "utf8",
);

function sourceBetween(start, end) {
  const startIndex = serviceSource.indexOf(start);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  const endIndex = serviceSource.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return serviceSource.slice(startIndex, endIndex);
}

test("word-retest expected time uses explicit Seoul conversion and the narrow cache-invalidating RPC", () => {
  const mapper = sourceBetween("function mapWordRetest", "function mapComment");
  const serializer = sourceBetween("function buildWordRetestRow", "type OpsTaskProducerResponse");
  const updater = sourceBetween(
    "export async function updateWordRetestExpectedAt",
    "export async function reportWordRetestResult",
  );
  const retry = sourceBetween(
    "export async function retryWordRetest",
    "export async function updateWordRetestExpectedAt",
  );

  assert.match(mapper, /expectedRetestAt: text\(row\.expected_retest_at\)/);
  assert.match(serializer, /expected_retest_at: seoulDateTimeInputToIso\(detail\.expectedRetestAt \|\| ""\) \|\| null/);
  assert.match(serviceSource, /timeZone: "Asia\/Seoul"/);
  assert.match(updater, /runIdempotentOpsTaskProducerRpc\("update_word_retest_expected_at_v1"/);
  assert.match(updater, /p_expected_retest_at: expectedRetestAt/);
  assert.match(updater, /p_expected_updated_at: expectedUpdatedAt/);
  assert.match(updater, /clearOpsTaskWorkspaceDataCache\(\)/);
  assert.doesNotMatch(updater, /dispatch|sourceEvent|notification/i);
  assert.match(retry, /expectedRetestAt: ""/);
});

function transpileAndLoad(source, exports, mocks = {}) {
  const compiled = ts.transpileModule(
    `${source}\nmodule.exports = { ${exports.join(", ")} }`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const sandboxModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    setRegistrationTrackMutationCacheInvalidator: () => {},
    ...mocks,
  });
  return sandboxModule.exports;
}

function loadClassReaderWithMocks(mocks) {
  const classColumnsSource = sourceBetween(
    "const OPS_TASK_WORKSPACE_CACHE_TTL_MS",
    "const OPS_REGISTRATION_OPTIONAL_DETAIL_COLUMNS",
  );
  const classReaderSource = sourceBetween(
    "async function readOpsClassRows",
    "async function readTaskScopedTable",
  );
  return transpileAndLoad(
    `${classColumnsSource}\n${classReaderSource}`,
    ["readOpsClassRows"],
    mocks,
  ).readOpsClassRows;
}

function loadSelectedRegistrationClassDetailWithMocks(mocks) {
  const cacheSource = sourceBetween(
    "const OPS_TASK_WORKSPACE_CACHE_TTL_MS",
    "function text(value: unknown)",
  );
  const detailSource = sourceBetween(
    "async function readOpsRegistrationClassDetail",
    "async function readTaskScopedTable",
  );
  return transpileAndLoad(
    `${cacheSource}\n${detailSource}`,
    ["loadOpsRegistrationClassDetail"],
    mocks,
  ).loadOpsRegistrationClassDetail;
}

function loadSelectedRegistrationClassDetailsWithMocks(mocks) {
  const source = sourceBetween(
    "export async function loadOpsRegistrationClassDetails",
    "async function readTaskScopedTable",
  );
  return transpileAndLoad(
    source,
    ["loadOpsRegistrationClassDetails"],
    {
      loadRegistrationSubjectTrackFixtureClassDetails: () => null,
      ...mocks,
    },
  ).loadOpsRegistrationClassDetails;
}

function loadRegistrationTrackParentResolver() {
  const source = sourceBetween(
    "function getLegacyRegistrationTrackStatus",
    "async function readOpsTaskWorkspaceData",
  );
  return transpileAndLoad(
    source,
    ["resolveRegistrationTrackSummariesForParents"],
    {
      text: (value) => String(value || "").trim(),
      parseRegistrationSubjects: (value) => String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean),
      getRegistrationViewKey: () => "inquiry",
      getRegistrationWorkflowStatusFromLegacyTrack,
    },
  ).resolveRegistrationTrackSummariesForParents;
}

function loadWithdrawalStudentStatusPolicy() {
  const source = sourceBetween(
    "function getWithdrawalStudentStatusAfterClassRemoval",
    "function hasOpsStudentClassRosterLink",
  );
  return transpileAndLoad(
    source,
    ["getWithdrawalStudentStatusAfterClassRemoval"],
    {
      ACTIVE_STUDENT_STATUS: "재원",
      WITHDRAWN_STUDENT_STATUS: "퇴원",
      normalizeIdList(value) {
        return Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : [];
      },
      text: (value) => String(value || "").trim(),
    },
  ).getWithdrawalStudentStatusAfterClassRemoval;
}

function loadDashboardConflictTaskLinkReader(mocks) {
  const source = sourceBetween(
    "const DASHBOARD_CONFLICT_TASK_LINK_TIMEOUT_MS",
    "export async function createDashboardConflictTask",
  );
  return transpileAndLoad(
    source,
    ["listDashboardConflictTaskLinks"],
    mocks,
  ).listDashboardConflictTaskLinks;
}

function loadOpsTaskPageWithMocks(mocks) {
  const source = sourceBetween(
    "export async function loadOpsTaskPage",
    "export async function loadOpsTaskWorkspaceData",
  );
  return transpileAndLoad(
    source,
    ["loadOpsTaskPage"],
    {
      OPS_TASK_PAGE_SIZE: 30,
      assertOpsTaskPageFilters: () => {},
      getOpsTaskPageScope: async () => "scope-a",
      mapOpsTaskPageRow: (row) => row.row_data,
      probeRegistrationSubjectTrackRuntime: async () => null,
      text: (value) => String(value || "").trim(),
      AbortSignal: { timeout: (milliseconds) => ({ milliseconds }) },
      ...mocks,
    },
  ).loadOpsTaskPage;
}

function taskPageRpcResult(data, error = null) {
  const result = {
    data,
    error,
    abortSignal() { return result; },
    retry() { return result; },
    then(resolve, reject) { return Promise.resolve({ data, error }).then(resolve, reject); },
  };
  return result;
}

test("task continuation pages skip aggregate RPCs and a stats failure does not discard page rows", async () => {
  const calls = [];
  const loadPage = loadOpsTaskPageWithMocks({
    supabase: {
      rpc(name) {
        calls.push(name);
        if (name === "list_ops_task_page_v1") {
          return taskPageRpcResult([{ id: "task-a", row_data: { id: "task-a" }, sort_values: ["2026-08-14T00:00:00Z"] }]);
        }
        return taskPageRpcResult(null, new Error("stats unavailable"));
      },
    },
  });

  const firstPage = await loadPage({
    filters: { taskType: "general" },
    cursor: null,
    limit: 30,
    viewerId: "viewer-a",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(firstPage.page.rows)), [{ id: "task-a" }]);
  assert.equal(firstPage.stats, undefined);
  assert.deepEqual([...calls].sort(), ["get_ops_task_list_stats_v1", "list_ops_task_page_v1"]);

  calls.length = 0;
  const continuation = await loadPage({
    filters: { taskType: "general" },
    cursor: { id: "task-a", sortValues: ["2026-08-14T00:00:00Z"], scopeHash: "scope-a" },
    limit: 30,
    viewerId: "viewer-a",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(continuation.page.rows)), [{ id: "task-a" }]);
  assert.equal(continuation.stats, undefined);
  assert.deepEqual(calls, ["list_ops_task_page_v1"]);
});

test("dashboard conflict task link lookup aborts after eight seconds without automatic retry", async () => {
  const calls = [];
  const signal = { kind: "dashboard-conflict-timeout" };
  const builder = {
    data: [{}],
    error: null,
    abortSignal(value) {
      calls.push(["abortSignal", value]);
      return builder;
    },
    retry(value) {
      calls.push(["retry", value]);
      return builder;
    },
  };
  const listDashboardConflictTaskLinks = loadDashboardConflictTaskLinkReader({
    AbortSignal: {
      timeout(value) {
        calls.push(["timeout", value]);
        return signal;
      },
    },
    supabase: {
      rpc(name, args) {
        calls.push(["rpc", name, args]);
        return builder;
      },
    },
    normalizeDashboardConflictInput: (value) => value,
    dashboardConflictKey: () => "teacher:one",
    normalizeDashboardConflictTaskLink: (_value, expectedKey) => ({
      conflictKey: expectedKey,
      linked: false,
      taskId: "",
      canOpen: false,
      alreadyExists: false,
    }),
  });

  assert.deepEqual(
    await listDashboardConflictTaskLinks([{ type: "teacher" }]),
    [{
      conflictKey: "teacher:one",
      linked: false,
      taskId: "",
      canOpen: false,
      alreadyExists: false,
    }],
  );
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["rpc", "list_dashboard_conflict_task_links_v1", { p_conflicts: [{ type: "teacher" }] }],
    ["timeout", 8_000],
    ["abortSignal", signal],
    ["retry", false],
  ]);
});

test("withdrawal status changes only after the selected class is the student's final live roster", () => {
  const getStatus = loadWithdrawalStudentStatusPolicy();

  assert.equal(getStatus({ class_ids: ["english"] }, "english"), "퇴원");
  assert.equal(getStatus({ class_ids: ["english", "math"] }, "english"), "재원");
  assert.equal(
    getStatus({ class_ids: ["english"], waitlist_class_ids: ["science"] }, "english"),
    "재원",
  );
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function loadOpsTaskReadMeasureRunner() {
  const source = sourceBetween(
    "// ops-task-read-measure:start",
    "// ops-task-read-measure:end",
  );
  return transpileAndLoad(
    source,
    ["createOpsTaskReadMeasureRunner"],
  ).createOpsTaskReadMeasureRunner;
}

test("registration parent and exact class reads expose named cache/query-count measures", async () => {
  const createRunner = loadOpsTaskReadMeasureRunner();
  const calls = [];
  const records = [];
  const run = createRunner({
    performance: {
      mark(name) { calls.push(["mark", name]); },
      measure(name, start, end) { calls.push(["measure", name, start, end]); },
    },
    recordMeasure(record) { records.push(record); },
  });

  const result = await run("registration:parent-list", false, async (metrics) => {
    metrics.queryCount += 1;
    return "loaded";
  });
  await run("registration:class-detail:class-a", true, async () => "cached");

  assert.equal(result, "loaded");
  assert.deepEqual(JSON.parse(JSON.stringify(records)), [
    { name: "registration:parent-list", cacheHit: false, queryCount: 1, ok: true },
    { name: "registration:class-detail:class-a", cacheHit: true, queryCount: 0, ok: true },
  ]);
  assert.equal(calls.filter((call) => call[0] === "measure").length, 2);
  assert.match(serviceSource, /registration:parent-list/);
  assert.match(serviceSource, /`registration:class-detail:\$\{safeClassId\}`/);
});

function createSessionStorageMock() {
  const values = new Map();
  let setCount = 0;
  const storage = {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      setCount += 1;
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };

  return {
    storage,
    getSetCount: () => setCount,
  };
}

function registrationSummaryTrack(taskId, id, subject, status) {
  return {
    id,
    taskId,
    subject,
    status,
    legacy: false,
    directorProfileId: null,
    directorName: "",
    directorAssignmentSource: "",
    directorAssignmentRuleKey: "",
    waitingKind: "",
    levelTestRetakeDecision: "",
    migrationReviewRequired: false,
    stageEnteredAt: "2026-07-12T00:00:00Z",
    phoneReadyAt: null,
    phoneReadySource: null,
  }
}

function createWorkspaceLoaderHarness({
  taskGatesByType = {},
  windowMock,
  registrationRuntimeProbe = async () => ({ mode: "ready", version: 1 }),
  registrationTrackSummaryFactory = (taskIds) => taskIds.map((taskId) => (
    registrationSummaryTrack(taskId, `track:${taskId}`, "영어", "inquiry")
  )),
  registrationWorkspaceTrackSummaryLoader = async () => ({ mode: "ready", tracks: [] }),
} = {}) {
  const defaultTaskGate = deferred();
  const explicitTaskGates = new Map(
    Object.entries(taskGatesByType).map(([taskType, gates]) => [taskType, [...gates]]),
  );
  const counts = {
    taskQueries: 0,
    classQueries: 0,
    taskSelects: [],
    scopedReads: [],
    trackSummaryCalls: [],
    workspaceTrackSummaryCalls: [],
    registrationRuntimeProbeCalls: 0,
    clearedTrackCaches: 0,
  };
  const taskQueryTypes = [];
  const classTaskTypes = [];
  let registrationMutationInvalidator = null;

  function takeTaskGate(taskType) {
    const gates = explicitTaskGates.get(taskType);
    if (gates?.length) return gates.shift();
    assert.equal(
      explicitTaskGates.size,
      0,
      `unexpected extra ${taskType} task query without a deferred gate`,
    );
    return defaultTaskGate;
  }

  const cacheSource = sourceBetween(
    "const OPS_TASK_WORKSPACE_CACHE_TTL_MS",
    "function text(value: unknown)",
  );
  const loaderSource = sourceBetween(
    "export async function loadOpsTaskWorkspaceData",
    "export async function loadOpsTaskById",
  );

  const supabase = {
    from(table) {
      assert.equal(table, "ops_tasks");
      return {
        select(columns) {
          assert.ok(
            columns === "*" || columns.includes("ops_registration_details(task_id,pipeline_status,school_grade,school_name,parent_phone,student_phone,inquiry_at,level_test_at,level_test_completed_at,level_test_result,level_test_place,level_test_material_link,counselor,phone_consultation_at,visit_consultation_at,consultation_at,class_start_date,class_start_session,textbook_preparation,visit_consultation_place,admission_notice_sent,payment_checked,makeedu_registered,makeedu_invoice_sent,request_note)"),
            `unexpected ops task projection: ${columns}`,
          );
          counts.taskSelects.push(columns);
          let taskType = "all";
          const query = {
            eq(column, value) {
              assert.equal(column, "type");
              assert.ok(value === "registration" || value === "transfer");
              taskType = value;
              return query;
            },
            then(onFulfilled, onRejected) {
              counts.taskQueries += 1;
              taskQueryTypes.push(taskType);
              return takeTaskGate(taskType).promise.then(onFulfilled, onRejected);
            },
          };
          return query;
        },
      };
    },
  };

  const emptyWorkspaceData = {
    tasks: [],
    profiles: [],
    students: [],
    classes: [],
    textbooks: [],
    teachers: [],
    schemaReady: true,
    error: null,
  };
  const emptyMap = () => new Map();
  const groupByTaskId = (items) => items.reduce((grouped, item) => {
    const taskId = String(item?.taskId || "")
    if (!taskId) return grouped
    const current = grouped.get(taskId) || []
    current.push(item)
    grouped.set(taskId, current)
    return grouped
  }, new Map())
  const emptyRows = async () => [];

  const {
    loadOpsTaskWorkspaceData,
    clearOpsTaskWorkspaceDataCache,
    getCachedOpsTaskWorkspaceData,
    getPersistedOpsTaskWorkspaceData,
  } = transpileAndLoad(
    `${cacheSource}\n${loaderSource}`,
    [
      "loadOpsTaskWorkspaceData",
      "clearOpsTaskWorkspaceDataCache",
      "getCachedOpsTaskWorkspaceData",
      "getPersistedOpsTaskWorkspaceData",
    ],
    {
      supabase,
      ...(windowMock ? { window: windowMock } : {}),
      emptyOpsTaskWorkspaceData: emptyWorkspaceData,
      OPS_TASK_PAGE_SIZE: 30,
      canonicalJson: (value) => JSON.stringify(value, Object.keys(value || {}).sort()),
      createDefaultOpsTaskPageFilters: (taskType) => ({ taskType: taskType || "general" }),
      async loadOpsTaskPage(options) {
        counts.taskQueries += 1;
        taskQueryTypes.push(options.filters.taskType);
        const runtimePromise = options.filters.taskType === "registration"
          ? (counts.registrationRuntimeProbeCalls += 1, registrationRuntimeProbe())
          : Promise.resolve(null);
        const [result, registrationRuntime] = await Promise.all([
          takeTaskGate(options.filters.taskType).promise,
          runtimePromise,
        ]);
        if (result.error) throw result.error;
        const rows = result.data || [];
        return {
          page: { rows, nextCursor: null, hasMore: false },
          stats: { total: rows.length, byStatus: {} },
          registrationRuntime,
        };
      },
      readTable: emptyRows,
      readTableWithFallback: emptyRows,
      async readOpsClassRows(taskType) {
        counts.classQueries += 1;
        classTaskTypes.push(taskType);
        return [];
      },
      async readTaskScopedTable(table) {
        counts.scopedReads.push(table);
        return [];
      },
      async loadRegistrationTrackSummaries(taskIds, viewerId, options = {}) {
        counts.trackSummaryCalls.push({ taskIds: [...taskIds], viewerId, force: options.force });
        return {
          mode: "ready",
          tracks: registrationTrackSummaryFactory(taskIds),
        };
      },
      clearRegistrationTrackServiceCaches() {
        counts.clearedTrackCaches += 1;
      },
      setRegistrationTrackMutationCacheInvalidator(listener) {
        registrationMutationInvalidator = listener;
      },
      parseRegistrationSubjects: (value) => String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean),
      getRegistrationViewKey: () => "inquiry",
      embeddedTaskRows(taskRows, key) {
        return taskRows.flatMap((row) => {
          const embedded = row[key];
          if (Array.isArray(embedded)) return embedded;
          return embedded && typeof embedded === "object" ? [embedded] : [];
        });
      },
      buildProfileLookup: emptyMap,
      byTaskId: groupByTaskId,
      singleByTaskId: emptyMap,
      mapComment: (row) => row,
      mapAttachment: (row) => row,
      mapEvent: (row) => row,
      mapRegistration: () => null,
      mapWithdrawal: () => null,
      mapTransfer: () => null,
      mapWordRetest: () => null,
      mapTask: (row) => row,
      buildOpsTaskWorkspaceOptionData: () => ({
        profiles: [],
        students: [],
        classes: [],
        textbooks: [],
        teachers: [],
      }),
      profileLabel: () => "",
      profileOptionLabel: () => "",
      optionMeta: () => "",
      normalizeIdList: () => [],
      numberValue: () => 0,
      recordValue: () => null,
      text: (value) => String(value || "").trim(),
      isMissingRelationError: () => false,
    },
  );

  return {
    loadOpsTaskWorkspaceData,
    clearOpsTaskWorkspaceDataCache,
    getCachedOpsTaskWorkspaceData,
    getPersistedOpsTaskWorkspaceData,
    counts,
    taskQueryTypes,
    classTaskTypes,
    releaseTasks(data = []) {
      defaultTaskGate.resolve({ data, error: null });
    },
    triggerRegistrationMutation() {
      assert.equal(typeof registrationMutationInvalidator, "function");
      registrationMutationInvalidator();
    },
  };
}

function createOptionLoaderHarness({ failProfileReads = 0 } = {}) {
  const calls = [];
  let activeReads = 0;
  let maxActiveReads = 0;
  let remainingProfileFailures = failProfileReads;

  async function read(name) {
    calls.push(name);
    activeReads += 1;
    maxActiveReads = Math.max(maxActiveReads, activeReads);
    await Promise.resolve();
    activeReads -= 1;
    if (name === "profiles" && remainingProfileFailures > 0) {
      remainingProfileFailures -= 1;
      throw new Error("profile read failed");
    }
    return [];
  }

  const cacheSource = sourceBetween(
    "const OPS_TASK_WORKSPACE_CACHE_TTL_MS",
    "function text(value: unknown)",
  );
  const optionLoaderSource = sourceBetween(
    "async function readOpsTaskWorkspaceOptionData",
    "export async function loadOpsTaskWorkspaceData",
  );
  const emptyOptions = {
    profiles: [],
    students: [],
    classes: [],
    textbooks: [],
    teachers: [],
    schemaReady: true,
    error: null,
  };

  const { loadOpsTaskWorkspaceOptionData } = transpileAndLoad(
    `${cacheSource}\n${optionLoaderSource}`,
    ["loadOpsTaskWorkspaceOptionData"],
    {
      supabase: {},
      emptyOpsTaskWorkspaceOptionData: emptyOptions,
      text: (value) => String(value || "").trim(),
      readTable(table) {
        return read(table);
      },
      readTableWithFallback(table) {
        return read(table);
      },
      readOpsClassRows() {
        return read("classes");
      },
      async loadRegistrationWorkspaceOptionData() {
        try {
          await Promise.all([
            read("profiles"),
            read("classes"),
            read("textbooks"),
            read("teacher_catalogs"),
          ]);
          return {
            ...emptyOptions,
            directorCatalogStatus: "authoritative",
          };
        } catch (error) {
          return {
            ...emptyOptions,
            schemaReady: false,
            error: error instanceof Error ? error.message : "failed",
            directorCatalogStatus: "error",
          };
        }
      },
      buildOpsTaskWorkspaceOptionData: () => ({
        profiles: [],
        students: [],
        classes: [],
        textbooks: [],
        teachers: [],
      }),
      isMissingRelationError: () => false,
    },
  );

  return {
    loadOpsTaskWorkspaceOptionData,
    calls,
    getMaxActiveReads: () => maxActiveReads,
  };
}

test("registration class reads use the lightweight registration projection", async () => {
  const selections = [];
  const readOpsClassRows = loadClassReaderWithMocks({
    supabase: {
      from(table) {
        assert.equal(table, "classes");
        return {
          async select(columns) {
            selections.push(columns);
            return { data: [], error: null };
          },
        };
      },
    },
    isMissingColumnError: () => false,
  });

  await readOpsClassRows("registration");

  assert.equal(
    selections[0],
    "id,name,subject,grade,teacher,room,textbook_ids",
  );
  for (const forbiddenColumn of [
    "schedule",
    "schedule_plan",
    "fee",
    "tuition",
    "student_ids",
    "waitlist_ids",
  ]) {
    assert.equal(
      selections[0].split(",").includes(forbiddenColumn),
      false,
      `registration projection must exclude ${forbiddenColumn}`,
    );
  }
});

test("registration class reads retry once without textbook_ids when that column is missing", async () => {
  const selections = [];
  const missingColumnError = { code: "42703" };
  const fallbackRows = [{ id: "class-legacy", name: "Legacy class" }];
  const readOpsClassRows = loadClassReaderWithMocks({
    supabase: {
      from(table) {
        assert.equal(table, "classes");
        return {
          async select(columns) {
            selections.push(columns);
            if (selections.length === 1) {
              return { data: null, error: missingColumnError };
            }
            return { data: fallbackRows, error: null };
          },
        };
      },
    },
    isMissingColumnError: (error) => error === missingColumnError,
  });

  const rows = await readOpsClassRows("registration");

  assert.deepEqual(selections, [
    "id,name,subject,grade,teacher,room,textbook_ids",
    "id,name,subject,grade,teacher,room",
  ]);
  assert.strictEqual(rows, fallbackRows);
});

test("non-registration class reads retain the full class projection", async () => {
  const selections = [];
  const readOpsClassRows = loadClassReaderWithMocks({
    supabase: {
      from(table) {
        assert.equal(table, "classes");
        return {
          async select(columns) {
            selections.push(columns);
            return { data: [], error: null };
          },
        };
      },
    },
    isMissingColumnError: () => false,
  });

  await readOpsClassRows("transfer");

  assert.equal(
    selections[0],
    "id,name,subject,grade,teacher,room,schedule,schedule_plan,fee,student_ids,waitlist_ids,textbook_ids,status",
  );
});

test("selected registration class detail is an exact-id query isolated from the all-class projection", () => {
  const detailSource = sourceBetween(
    "const OPS_REGISTRATION_CLASS_DETAIL_COLUMN_CANDIDATES",
    "async function readTaskScopedTable",
  );

  assert.match(detailSource, /id,name,subject,grade,teacher,room,schedule,schedule_plan,textbook_ids/);
  assert.match(detailSource, /\.eq\("id", safeClassId\)/);
  assert.match(detailSource, /\.limit\(1\)/);
  assert.match(detailSource, /options\.viewerId/);
  assert.match(detailSource, /opsRegistrationClassDetailDataInFlight/);
  assert.doesNotMatch(
    sourceBetween("const OPS_REGISTRATION_CLASS_COLUMN_CANDIDATES", "const OPS_REGISTRATION_CLASS_DETAIL_COLUMN_CANDIDATES"),
    /schedule_plan|schedule,/,
  );
});

test("selected registration class detail shares only the same viewer and class request and retries failures", async () => {
  const reads = [];
  let failOnce = true;
  const loadDetail = loadSelectedRegistrationClassDetailWithMocks({
    supabase: {
      from(table) {
        assert.equal(table, "classes");
        return {
          select(columns) {
            let selectedId = "";
            return {
              eq(column, value) {
                assert.equal(column, "id");
                selectedId = value;
                return this;
              },
              async limit(count) {
                assert.equal(count, 1);
                reads.push({ columns, id: selectedId });
                await Promise.resolve();
                if (selectedId === "class-error" && failOnce) {
                  failOnce = false;
                  return { data: null, error: new Error("detail unavailable") };
                }
                return { data: [{ id: selectedId, name: selectedId }], error: null };
              },
            };
          },
        };
      },
    },
    text: (value) => String(value || "").trim(),
    isMissingColumnError: () => false,
    mapOpsClassOption: (row) => ({ id: row.id, label: row.name }),
  });

  const options = { viewerId: "viewer-a" };
  await assert.rejects(
    loadDetail("class-no-viewer"),
    /인증된 사용자/,
  );
  assert.equal(reads.length, 0);
  const [first, concurrent] = await Promise.all([
    loadDetail("class-a", options),
    loadDetail("class-a", options),
  ]);
  const cached = await loadDetail("class-a", options);
  await loadDetail("class-a", { viewerId: "viewer-b" });
  await loadDetail("class-b", options);
  await assert.rejects(loadDetail("class-error", options), /detail unavailable/);
  const retried = await loadDetail("class-error", options);

  assert.strictEqual(first, concurrent);
  assert.strictEqual(first, cached);
  assert.equal(retried.id, "class-error");
  assert.deepEqual(reads.map(({ id }) => id), ["class-a", "class-a", "class-b", "class-error", "class-error"]);
  assert.ok(reads.every(({ columns }) => columns.includes("schedule_plan")));
});

test("three enrollment rows with two class IDs hydrate exactly two selected details", async () => {
  const calls = [];
  const loadDetails = loadSelectedRegistrationClassDetailsWithMocks({
    text: (value) => String(value || "").trim(),
    async loadOpsRegistrationClassDetail(classId, options) {
      calls.push({ classId, viewerId: options.viewerId });
      return { id: classId, label: classId };
    },
  });

  const result = await loadDetails(["class-a", "class-b", "class-a"], { viewerId: "viewer-a" });

  assert.deepEqual(calls, [
    { classId: "class-a", viewerId: "viewer-a" },
    { classId: "class-b", viewerId: "viewer-a" },
  ]);
  assert.deepEqual(Object.keys(result), ["class-a", "class-b"]);
  assert.equal(result["class-a"].id, "class-a");
});

test("registration option enrichment delegates to the focused four-read loader without re-reading tasks", () => {
  const optionLoaderSource = sourceBetween(
    "export async function loadOpsRegistrationWorkspaceOptionData",
    "export async function loadOpsTaskWorkspaceOptionData",
  );

  assert.doesNotMatch(optionLoaderSource, /from\("ops_tasks"\)/);
  assert.match(optionLoaderSource, /loadRegistrationWorkspaceOptionData/);
  assert.match(optionLoaderSource, /const safeViewerId = text\(options\.viewerId\)/);
  assert.match(optionLoaderSource, /if \(!safeViewerId\) throw/);
  assert.match(optionLoaderSource, /viewerId:\s*safeViewerId/);
  assert.match(optionLoaderSource, /force:\s*options\.force/);
});

test("registration option enrichment uses four concurrent reads and never reads students", async () => {
  const harness = createOptionLoaderHarness();

  await harness.loadOpsTaskWorkspaceOptionData({
    taskType: "registration",
    viewerId: "viewer-a",
  });

  assert.deepEqual(harness.calls, [
    "profiles",
    "classes",
    "textbooks",
    "teacher_catalogs",
  ]);
  assert.equal(harness.getMaxActiveReads(), 4);
});

test("generic option cache remains shared per viewer, isolated across viewers, and retries failures", async () => {
  const cachedHarness = createOptionLoaderHarness();
  const viewerAOptions = { taskType: "transfer", viewerId: "viewer-a" };
  const [firstData, concurrentData] = await Promise.all([
    cachedHarness.loadOpsTaskWorkspaceOptionData(viewerAOptions),
    cachedHarness.loadOpsTaskWorkspaceOptionData(viewerAOptions),
  ]);
  const cachedData = await cachedHarness.loadOpsTaskWorkspaceOptionData(viewerAOptions);
  await cachedHarness.loadOpsTaskWorkspaceOptionData({
    taskType: "transfer",
    viewerId: "viewer-b",
  });

  assert.strictEqual(firstData, concurrentData);
  assert.strictEqual(firstData, cachedData);
  assert.equal(cachedHarness.calls.filter((name) => name === "profiles").length, 2);
  assert.equal(cachedHarness.getMaxActiveReads(), 5, "generic options must retain one parallel query wave");

  const retryHarness = createOptionLoaderHarness({ failProfileReads: 1 });
  const failedData = await retryHarness.loadOpsTaskWorkspaceOptionData(viewerAOptions);
  const retriedData = await retryHarness.loadOpsTaskWorkspaceOptionData(viewerAOptions);

  assert.equal(failedData.schemaReady, false);
  assert.equal(retriedData.schemaReady, true);
  assert.equal(retryHarness.calls.filter((name) => name === "profiles").length, 2);
});

test("same-key concurrent workspace loads share one in-flight query wave", async () => {
  const harness = createWorkspaceLoaderHarness();
  const options = {
    taskType: "registration",
    viewerId: "viewer-a",
    includeManagementOptions: true,
    includeTeacherOptions: true,
  };

  const firstLoad = harness.loadOpsTaskWorkspaceData(options);
  const secondLoad = harness.loadOpsTaskWorkspaceData(options);
  harness.releaseTasks();
  const [firstData, secondData] = await Promise.all([firstLoad, secondLoad]);

  assert.equal(harness.counts.taskQueries, 1);
  assert.equal(harness.counts.classQueries, 0);
  assert.deepEqual(harness.classTaskTypes, []);
  assert.strictEqual(firstData, secondData);
});

test("registration cold load keeps track summaries inside the page row", async () => {
  const harness = createWorkspaceLoaderHarness();
  const load = harness.loadOpsTaskWorkspaceData({
    taskType: "registration",
    viewerId: "viewer-a",
    force: true,
    includeManagementOptions: true,
    includeTeacherOptions: true,
  });
  harness.releaseTasks([{
    id: "registration-embedded",
    ops_registration_details: { task_id: "registration-embedded" },
    ops_task_comments: [],
    ops_task_attachments: [],
    ops_task_events: [],
  }]);
  await load;

  assert.equal(harness.counts.taskQueries, 1);
  assert.deepEqual(harness.counts.taskSelects, []);
  assert.deepEqual(harness.counts.scopedReads, []);
  assert.deepEqual(harness.counts.trackSummaryCalls, []);
  assert.deepEqual(harness.counts.workspaceTrackSummaryCalls, []);
  assert.equal(serviceSource.includes("'registrationTracks', coalesce(track_page.tracks"), false);
  assert.match(serviceSource, /payload\.registrationTracks/);
});

test("registration cold load starts the runtime probe while parent rows are still loading", async () => {
  const runtimeGate = deferred();
  const harness = createWorkspaceLoaderHarness({
    registrationRuntimeProbe: () => runtimeGate.promise,
  });
  const load = harness.loadOpsTaskWorkspaceData({
    taskType: "registration",
    viewerId: "viewer-a",
    force: true,
  });

  await Promise.resolve();
  const startedBeforeEitherResponse = {
    taskQueries: harness.counts.taskQueries,
    runtimeProbes: harness.counts.registrationRuntimeProbeCalls,
  };
  harness.releaseTasks([]);
  runtimeGate.resolve({ mode: "ready", version: 1 });
  await load;

  assert.deepEqual(startedBeforeEitherResponse, {
    taskQueries: 1,
    runtimeProbes: 1,
  });
});

test("registration cold load does not start a second workspace track-summary read", async () => {
  const harness = createWorkspaceLoaderHarness();
  const load = harness.loadOpsTaskWorkspaceData({
    taskType: "registration",
    viewerId: "viewer-a",
    force: true,
  });

  await Promise.resolve();
  harness.releaseTasks([{
    id: "case-1",
    type: "registration",
    ops_registration_details: { task_id: "case-1" },
    registrationTracks: [registrationSummaryTrack("case-1", "track-1", "영어", "inquiry")],
  }]);
  const data = await load;

  assert.equal(harness.counts.workspaceTrackSummaryCalls.length, 0);
  assert.deepEqual(
    JSON.parse(JSON.stringify(data.tasks[0].registrationTracks.map(({ id }) => id))),
    ["track-1"],
  );
});

test("registration parent loading preserves one page row with every embedded subject track", async () => {
  const harness = createWorkspaceLoaderHarness()
  const load = harness.loadOpsTaskWorkspaceData({
    taskType: "registration",
    viewerId: "viewer-a",
    force: true,
  })
  harness.releaseTasks([{
    id: "case-1",
    type: "registration",
    ops_registration_details: { task_id: "case-1" },
    registrationTracks: [
      registrationSummaryTrack("case-1", "eng", "영어", "consultation_waiting"),
      registrationSummaryTrack("case-1", "math", "수학", "level_test_scheduled"),
    ],
  }])
  const data = await load

  assert.equal(data.tasks.length, 1)
  assert.deepEqual(
    JSON.parse(JSON.stringify(
      data.tasks[0].registrationTracks.map(({ id, subject }) => [id, subject]),
    )),
    [["eng", "영어"], ["math", "수학"]],
  )
  assert.equal(harness.counts.taskQueries, 1)
})

test("ready registration summaries use child rows per parent and fall back only for a parent with zero children", () => {
  const resolveRegistrationTrackSummariesForParents = loadRegistrationTrackParentResolver();
  const parentTasks = [
    {
      id: "child-backed",
      subject: "영어, 수학",
      status: "pending",
      createdAt: "2026-07-12T00:00:00Z",
      registration: { pipelineStatus: "1. 문의", inquiryAt: "2026-07-12T00:00:00Z" },
    },
    {
      id: "legacy-only",
      subject: "영어, 수학",
      status: "pending",
      createdAt: "2026-07-12T01:00:00Z",
      registration: { pipelineStatus: "1. 문의", inquiryAt: "2026-07-12T01:00:00Z" },
    },
  ];
  const childTrack = {
    id: "track:child-backed:영어",
    taskId: "child-backed",
    subject: "영어",
    status: "consultation_waiting",
    legacy: false,
  };

  const resolved = resolveRegistrationTrackSummariesForParents(parentTasks, {
    mode: "ready",
    tracks: [childTrack],
  });

  assert.deepEqual(resolved.filter((track) => track.taskId === "child-backed"), [childTrack]);
  assert.deepEqual(
    resolved.filter((track) => track.taskId === "legacy-only").map((track) => [track.subject, track.legacy]),
    [["영어", true], ["수학", true]],
  );
  assert.equal(resolved.some((track) => track.id === "legacy:child-backed:수학"), false);
});

test("registration task shape and selected detail use explicit observation-aware read boundaries", () => {
  assert.match(serviceSource, /type OpsRegistrationTrackSummary,/);
  assert.match(serviceSource, /type OpsRegistrationObservationTrackSummary,/);
  assert.match(serviceSource, /registrationTracks\?: OpsRegistrationTrackSummary\[\] \| OpsRegistrationObservationTrackSummary\[\]/);
  assert.match(serviceSource, /directorCatalogStatus\?: "authoritative" \| "partial" \| "error"/);
  assert.match(serviceSource, /export function loadOpsRegistrationCaseDetail/);
  assert.match(serviceSource, /return loadRegistrationCaseDetail\(safeTaskId, safeViewerId, \{[\s\S]*observationAware: true/);
  assert.match(serviceSource, /function clearOpsTaskWorkspaceDataCache\(\)[\s\S]*clearRegistrationTrackServiceCaches\(\)/);
  assert.match(serviceSource, /setRegistrationTrackMutationCacheInvalidator\(clearOpsTaskWorkspaceDataCache\)/);
  const parentSource = sourceBetween(
    "export async function loadOpsTaskPage",
    "export async function loadOpsTaskWorkspaceData",
  );
  assert.match(parentSource, /const viewerId = text\(options\.viewerId\)/);
  assert.match(parentSource, /if \(!viewerId\)/);
  assert.doesNotMatch(parentSource, /loadRegistrationWorkspaceTrackSummaries/);
});

test("different registration and transfer cache keys use independent query waves", async () => {
  const registrationGate = deferred();
  const transferGate = deferred();
  const harness = createWorkspaceLoaderHarness({
    taskGatesByType: {
      registration: [registrationGate],
      transfer: [transferGate],
    },
  });
  const sharedOptions = {
    includeManagementOptions: true,
    includeTeacherOptions: true,
  };

  const registrationLoad = harness.loadOpsTaskWorkspaceData({
    ...sharedOptions,
    taskType: "registration",
    viewerId: "viewer-a",
  });
  const transferLoad = harness.loadOpsTaskWorkspaceData({
    ...sharedOptions,
    taskType: "transfer",
  });
  let transferSettled = false;
  void transferLoad.then(() => {
    transferSettled = true;
  });

  assert.equal(harness.counts.taskQueries, 2);
  assert.equal(harness.counts.classQueries, 0);
  assert.deepEqual(harness.taskQueryTypes, ["registration", "transfer"]);
  assert.deepEqual(harness.classTaskTypes, []);

  registrationGate.resolve({
    data: [{ id: "registration-task", updatedAt: "2026-07-11T10:00:00.000Z" }],
    error: null,
  });
  const registrationData = await registrationLoad;
  assert.equal(registrationData.tasks[0].id, "registration-task");
  assert.equal(transferSettled, false);

  transferGate.resolve({
    data: [{ id: "transfer-task", updatedAt: "2026-07-11T10:01:00.000Z" }],
    error: null,
  });
  const transferData = await transferLoad;
  assert.equal(transferData.tasks[0].id, "transfer-task");
});

test("workspace task caches are isolated by viewer identity", async () => {
  const viewerAGate = deferred();
  const viewerBGate = deferred();
  const harness = createWorkspaceLoaderHarness({
    taskGatesByType: {
      registration: [viewerAGate, viewerBGate],
    },
  });
  const sharedOptions = {
    taskType: "registration",
    includeManagementOptions: false,
    includeTeacherOptions: false,
    includeProfileOptions: false,
  };

  const viewerALoad = harness.loadOpsTaskWorkspaceData({
    ...sharedOptions,
    viewerId: "viewer-a",
  });
  const viewerBLoad = harness.loadOpsTaskWorkspaceData({
    ...sharedOptions,
    viewerId: "viewer-b",
  });

  assert.equal(harness.counts.taskQueries, 2);
  viewerAGate.resolve({ data: [{ id: "viewer-a-task" }], error: null });
  viewerBGate.resolve({ data: [{ id: "viewer-b-task" }], error: null });
  const [viewerAData, viewerBData] = await Promise.all([viewerALoad, viewerBLoad]);

  assert.equal(viewerAData.tasks[0].id, "viewer-a-task");
  assert.equal(viewerBData.tasks[0].id, "viewer-b-task");
  assert.notStrictEqual(viewerAData, viewerBData);
});

test("registration core data uses a viewer-scoped session cache for instant reloads", async () => {
  const workspaceSource = await readFile(
    new URL("../src/features/tasks/ops-task-workspace.tsx", import.meta.url),
    "utf8",
  );

  assert.match(serviceSource, /OPS_REGISTRATION_SESSION_CACHE_TTL_MS = 60_000/);
  assert.match(serviceSource, /getPersistedOpsTaskWorkspaceData/);
  assert.match(serviceSource, /options\.viewerId/);
  assert.match(serviceSource, /window\.sessionStorage\.getItem/);
  assert.match(serviceSource, /window\.sessionStorage\.setItem/);
  assert.match(workspaceSource, /getPersistedOpsTaskWorkspaceData\(loadOptions\)/);
  assert.match(workspaceSource, /setData\(\(current\) => current \|\| cachedData\)/);
});

test("persisted registration data renders immediately but still revalidates and invalidates after mutations", async () => {
  const session = createSessionStorageMock();
  const windowMock = { sessionStorage: session.storage };
  const options = {
    taskType: "registration",
    viewerId: "viewer-a",
    includeManagementOptions: false,
    includeTeacherOptions: false,
    includeProfileOptions: false,
  };

  const seedHarness = createWorkspaceLoaderHarness({ windowMock });
  const seedLoad = seedHarness.loadOpsTaskWorkspaceData(options);
  seedHarness.releaseTasks([{ id: "persisted-registration-task" }]);
  await seedLoad;
  assert.equal(session.getSetCount(), 1);

  const reloadHarness = createWorkspaceLoaderHarness({ windowMock });
  const persisted = reloadHarness.getPersistedOpsTaskWorkspaceData(options);
  assert.equal(persisted.tasks[0].id, "persisted-registration-task");
  assert.equal(reloadHarness.getCachedOpsTaskWorkspaceData(options), null);
  assert.equal(session.getSetCount(), 1, "hydrating must not extend the persisted TTL");

  const revalidation = reloadHarness.loadOpsTaskWorkspaceData(options);
  assert.equal(reloadHarness.counts.taskQueries, 1, "persisted data must not suppress revalidation");
  assert.equal(session.getSetCount(), 1, "only a successful network read may refresh the TTL");
  reloadHarness.releaseTasks([{ id: "fresh-registration-task" }]);
  const fresh = await revalidation;
  assert.equal(fresh.tasks[0].id, "fresh-registration-task");
  assert.equal(session.getSetCount(), 2);

  reloadHarness.triggerRegistrationMutation();
  assert.equal(session.storage.length, 0, "mutations must discard persisted registration snapshots");
});

test("successful settle reuses the same-key TTL cache on a third load", async () => {
  const harness = createWorkspaceLoaderHarness();
  const options = {
    taskType: "registration",
    viewerId: "viewer-a",
    includeManagementOptions: true,
    includeTeacherOptions: true,
  };

  const firstLoad = harness.loadOpsTaskWorkspaceData(options);
  const secondLoad = harness.loadOpsTaskWorkspaceData(options);
  harness.releaseTasks([
    { id: "cached-registration-task", updatedAt: "2026-07-11T10:02:00.000Z" },
  ]);
  const [firstData, secondData] = await Promise.all([firstLoad, secondLoad]);
  const thirdData = await harness.loadOpsTaskWorkspaceData(options);

  assert.equal(harness.counts.taskQueries, 1);
  assert.equal(harness.counts.classQueries, 0);
  assert.strictEqual(firstData, secondData);
  assert.strictEqual(firstData, thirdData);
  assert.equal(thirdData.tasks[0].id, "cached-registration-task");
});

test("an invalidated old promise cannot overwrite or delete its replacement cache state", async () => {
  const oldGate = deferred();
  const replacementGate = deferred();
  const harness = createWorkspaceLoaderHarness({
    taskGatesByType: {
      registration: [oldGate, replacementGate],
    },
  });
  const options = {
    taskType: "registration",
    viewerId: "viewer-a",
    includeManagementOptions: true,
    includeTeacherOptions: true,
  };

  const oldLoad = harness.loadOpsTaskWorkspaceData(options);
  harness.clearOpsTaskWorkspaceDataCache();
  const replacementLoad = harness.loadOpsTaskWorkspaceData(options);
  assert.equal(harness.counts.taskQueries, 2);
  assert.equal(harness.counts.classQueries, 0);

  oldGate.resolve({
    data: [{ id: "old-registration-task", updatedAt: "2026-07-11T10:03:00.000Z" }],
    error: null,
  });
  const oldData = await oldLoad;
  assert.equal(oldData.tasks[0].id, "old-registration-task");

  const followerLoad = harness.loadOpsTaskWorkspaceData(options);
  let followerSettled = false;
  void followerLoad.then(() => {
    followerSettled = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.counts.taskQueries, 2);
  assert.equal(followerSettled, false);

  replacementGate.resolve({
    data: [{ id: "replacement-registration-task", updatedAt: "2026-07-11T10:04:00.000Z" }],
    error: null,
  });
  const [replacementData, followerData] = await Promise.all([replacementLoad, followerLoad]);
  const cachedData = await harness.loadOpsTaskWorkspaceData(options);

  assert.strictEqual(followerData, replacementData);
  assert.strictEqual(cachedData, replacementData);
  assert.equal(cachedData.tasks[0].id, "replacement-registration-task");
  assert.equal(harness.counts.taskQueries, 2);
  assert.equal(harness.counts.classQueries, 0);
});

test("a forced replacement keeps cache ownership after the old promise settles", async () => {
  const oldGate = deferred();
  const replacementGate = deferred();
  const harness = createWorkspaceLoaderHarness({
    taskGatesByType: {
      registration: [oldGate, replacementGate],
    },
  });
  const options = {
    taskType: "registration",
    viewerId: "viewer-a",
    includeManagementOptions: true,
    includeTeacherOptions: true,
  };

  const oldLoad = harness.loadOpsTaskWorkspaceData(options);
  const replacementLoad = harness.loadOpsTaskWorkspaceData({
    ...options,
    force: true,
  });
  assert.equal(harness.counts.taskQueries, 2);
  assert.equal(harness.counts.classQueries, 0);

  oldGate.resolve({
    data: [{ id: "old-forced-task", updatedAt: "2026-07-11T10:05:00.000Z" }],
    error: null,
  });
  const oldData = await oldLoad;
  assert.equal(oldData.tasks[0].id, "old-forced-task");

  const followerLoad = harness.loadOpsTaskWorkspaceData(options);
  let followerSettled = false;
  void followerLoad.then(() => {
    followerSettled = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.counts.taskQueries, 2);
  assert.equal(followerSettled, false);

  replacementGate.resolve({
    data: [{ id: "forced-replacement-task", updatedAt: "2026-07-11T10:06:00.000Z" }],
    error: null,
  });
  const [replacementData, followerData] = await Promise.all([replacementLoad, followerLoad]);
  const cachedData = await harness.loadOpsTaskWorkspaceData(options);

  assert.strictEqual(followerData, replacementData);
  assert.strictEqual(cachedData, replacementData);
  assert.equal(cachedData.tasks[0].id, "forced-replacement-task");
  assert.equal(harness.counts.taskQueries, 2);
  assert.equal(harness.counts.classQueries, 0);
});

test("task list reads use a bounded RPC page and selected detail stays exact-id scoped", () => {
  assert.match(serviceSource, /export type OpsTaskPageFilters =/);
  assert.match(serviceSource, /export type OpsTaskPageResponse =/);
  assert.match(serviceSource, /export type OpsTaskPageLoadOptions =/);
  assert.match(serviceSource, /export async function loadOpsTaskPage/);

  const pageReader = sourceBetween(
    "export async function loadOpsTaskPage",
    "export async function loadOpsTaskWorkspaceData",
  );
  assert.match(pageReader, /rpc\("list_ops_task_page_v1"/);
  assert.match(pageReader, /rpc\("get_ops_task_list_stats_v1"/);
  assert.match(pageReader, /p_limit: 30/);
  assert.match(pageReader, /AbortSignal\.timeout\(8_000\)/);
  assert.match(pageReader, /\.retry\(false\)/);
  assert.match(pageReader, /rawRows\.slice\(0, OPS_TASK_PAGE_SIZE\)/);
  assert.match(pageReader, /rawRows\.length > OPS_TASK_PAGE_SIZE/);
  assert.match(pageReader, /nextCursor/);

  const workspaceReader = sourceBetween(
    "async function readOpsTaskWorkspaceData",
    "export async function loadOpsTaskById",
  );
  assert.match(workspaceReader, /loadOpsTaskPage\(/);
  assert.doesNotMatch(workspaceReader, /readTaskScopedTable|ops_task_comments|ops_task_attachments|ops_task_events/);

  const detailReader = sourceBetween(
    "export async function loadOpsTaskById",
    "export function loadOpsRegistrationCaseDetail",
  );
  assert.match(detailReader, /\.eq\("id", taskId\)[\s\S]*?\.single\(\)/);
  assert.match(detailReader, /\.eq\("task_id", taskId\)[\s\S]*?\.single\(\)/);
  assert.doesNotMatch(detailReader, /\.in\("task_id"|select\("\*"\)|readTable\("profiles"/);
});

test("task page SQL embeds only the selected subtype and registration track summary", () => {
  assert.match(taskPageMigrationSource, /security invoker/g);
  assert.match(taskPageMigrationSource, /limit p_limit \+ 1/);
  assert.match(taskPageMigrationSource, /projected\.id asc/);
  assert.match(taskPageMigrationSource, /'registrationTracks', coalesce\(track_page\.tracks/);
  assert.match(taskPageMigrationSource, /from public\.ops_registration_subject_track_summaries summary/);
  assert.match(taskPageMigrationSource, /join public\.ops_withdrawal_details detail/);
  assert.match(taskPageMigrationSource, /join public\.ops_transfer_details detail/);
  assert.match(taskPageMigrationSource, /join public\.ops_word_retests detail/);
  assert.doesNotMatch(taskPageMigrationSource, /ops_task_comments|ops_task_attachments|ops_task_events/);
  assert.match(taskPageMigrationSource, /set timezone = 'Asia\/Seoul'/);
  assert.match(taskPageMigrationSource, /create index if not exists ops_tasks_general_page_sort_idx/);
});

test("task page stats expose authoritative sibling counts metrics and bounded filter facets", () => {
  assert.match(
    serviceSource,
    /export type OpsTaskPageStats = \{[\s\S]*?byView: Record<string, number>[\s\S]*?metrics: Record<string, number>[\s\S]*?facets: Record<string, OpsTaskFacetOption\[]>/,
  );
  const pageReader = sourceBetween(
    "export async function loadOpsTaskPage",
    "export async function loadOpsTaskWorkspaceData",
  );
  assert.match(pageReader, /byView:/);
  assert.match(pageReader, /metrics:/);
  assert.match(pageReader, /facets:/);
  assert.match(taskPageMigrationSource, /'byView'/);
  assert.match(taskPageMigrationSource, /'metrics'/);
  assert.match(taskPageMigrationSource, /'facets'/);
  assert.match(taskPageMigrationSource, /limit 100/);
});

test("registration page membership owner search and representative order come from matching track summaries", () => {
  const registrationBranch = taskPageMigrationSource.slice(
    taskPageMigrationSource.indexOf("'registrationTracks'"),
    taskPageMigrationSource.indexOf("join public.ops_withdrawal_details detail"),
  );
  assert.match(registrationBranch, /summary\.workflow_status/);
  assert.match(registrationBranch, /summary\.director_profile_id/);
  assert.match(registrationBranch, /matching_track/);
  assert.match(registrationBranch, /registration_representative_at/);
  assert.match(registrationBranch, /pg_catalog\.regexp_replace/);
  assert.doesNotMatch(registrationBranch, /detail\.pipeline_status[^\n]*~/);
  assert.doesNotMatch(registrationBranch, /common\.assignee_id::text = p_filters ->> 'consultationOwnerId'/);
});

test("registration all-track search stays inside the selected workflow and consultation owner", () => {
  const searchTrackStart = taskPageMigrationSource.indexOf("from public.ops_registration_subject_track_summaries search_track");
  const searchTrackEnd = taskPageMigrationSource.indexOf("\n          )", searchTrackStart);
  const searchTrack = taskPageMigrationSource.slice(searchTrackStart, searchTrackEnd);

  assert.match(searchTrack, /search_track\.workflow_status/);
  assert.match(searchTrack, /search_track\.director_profile_id::text = p_filters ->> 'consultationOwnerId'/);
});

test("task facets emit filterable manual word-retest values and include secondary assignees", () => {
  const statsSource = taskPageMigrationSource.slice(
    taskPageMigrationSource.indexOf("create or replace function public.get_ops_task_list_stats_v1"),
  );
  assert.match(statsSource, /secondaryAssigneeId/);
  assert.match(statsSource, /secondaryAssigneeLabel/);
  assert.match(statsSource, /'teacher_name:' \|\| pg_catalog\.btrim/);
  assert.match(statsSource, /'class_name:' \|\| coalesce/);
  assert.match(taskPageMigrationSource, /p_filters ->> 'teacherId' like 'teacher_name:%'/);
  assert.match(taskPageMigrationSource, /p_filters ->> 'classId' like 'class_name:%'/);
});
