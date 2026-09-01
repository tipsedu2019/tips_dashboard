import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import ts from "typescript";

import { parseAcademicSubject } from "../src/lib/academic-subject-registry.ts";
import { normalizeRegistrationLevelTestPlace } from "../src/features/tasks/registration-level-test-place.ts";
import {
  EMPTY_REGISTRATION_OBSERVATION_SUMMARY,
  normalizeRegistrationObservationSummary,
} from "../src/features/tasks/registration-observation-model.ts";
import {
  loadRegistrationObservationFeedback,
  loadRegistrationObservationManagerDetail,
} from "../src/features/tasks/registration-observation-service.ts";
import {
  REGISTRATION_WORKFLOW_STATUSES,
  getRegistrationWorkflowStatusFromLegacyTrack,
} from "../src/features/tasks/registration-workflow-status.js";

const serviceUrl = new URL(
  "../src/features/tasks/registration-track-service.ts",
  import.meta.url,
);

async function readServiceSource() {
  return readFile(serviceUrl, "utf8");
}

async function compileRegistrationTrackTypeContract(source) {
  const directory = await mkdtemp(join(tmpdir(), "registration-track-types-"));
  const fixturePath = join(directory, "contract.ts");
  const configPath = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
  const projectPath = fileURLToPath(new URL("..", import.meta.url));
  try {
    await writeFile(fixturePath, source);
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    assert.equal(config.error, undefined);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, projectPath);
    const program = ts.createProgram({
      rootNames: [fixturePath],
      options: { ...parsed.options, incremental: false, noEmit: true },
    });
    return ts.getPreEmitDiagnostics(program).map((diagnostic) => (
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
    ));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function loadFactory(extraGlobals = {}) {
  const source = await readServiceSource();
  const startMarker = "// registration-track-service-factory:start";
  const endMarker = "// registration-track-service-factory:end";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);

  const factorySource = source.slice(start + startMarker.length, end);
  const compiled = ts.transpileModule(
    `${factorySource}\nmodule.exports = { createRegistrationTrackService, createRegistrationMutationRequestKey, buildRegistrationMigrationLegacySnapshot, mapTrack, mapTrackEvent };`,
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
    AbortController,
    clearTimeout,
    crypto: { randomUUID: () => "uuid-from-crypto" },
    normalizeRegistrationLevelTestPlace,
    EMPTY_REGISTRATION_OBSERVATION_SUMMARY,
    normalizeRegistrationObservationSummary,
    loadRegistrationObservationFeedback,
    loadRegistrationObservationManagerDetail,
    parseAcademicSubject,
    REGISTRATION_WORKFLOW_STATUSES,
    getRegistrationWorkflowStatusFromLegacyTrack,
    setTimeout,
    ...extraGlobals,
  });
  return sandboxModule.exports;
}

test("track rows preserve science and fail closed for unsupported subjects", async () => {
  const { mapTrack } = await loadFactory();

  assert.equal(mapTrack({ id: "science-track", subject: "과학" }).subject, "과학");
  assert.throws(
    () => mapTrack({ id: "unsupported-track", subject: "unknown" }),
    /registration_subject_unsupported/,
  );
});

test("observation summary types are broad while generic mutations stay narrow", async () => {
  const servicePath = fileURLToPath(serviceUrl);
  const modelPath = fileURLToPath(new URL(
    "../src/features/tasks/registration-observation-model.ts",
    import.meta.url,
  ));
  const diagnostics = await compileRegistrationTrackTypeContract(`
    import {
      createRegistrationTrackService,
      loadRegistrationCaseDetail,
      loadRegistrationTrackSummaries,
      type OpsRegistrationObservationCaseDetail,
      type OpsRegistrationObservationTrackSummary,
      type OpsRegistrationTrackSummary,
      type OpsRegistrationWorkflowStatus,
      type RegistrationObservationTrackSummaryLoadResult,
    } from ${JSON.stringify(servicePath)};
    import type {
      RegistrationObservationTrackWorkflowStatus,
    } from ${JSON.stringify(modelPath)};

    type Equal<Left, Right> =
      (<Value>() => Value extends Left ? 1 : 2) extends
      (<Value>() => Value extends Right ? 1 : 2) ? true : false;
    type Assert<Value extends true> = Value;
    type ObservationReadStatus =
      RegistrationObservationTrackSummaryLoadResult["tracks"][number]["workflowStatus"];
    type GenericMutationStatus = Parameters<
      ReturnType<typeof createRegistrationTrackService>["setRegistrationWorkflowStatus"]
    >[0]["workflowStatus"];
    const observationRead = loadRegistrationTrackSummaries([], "viewer", {
      observationAware: true,
    });
    const genericRead = loadRegistrationTrackSummaries([], "viewer");
    const observationDetail = loadRegistrationCaseDetail("task", "viewer", {
      observationAware: true,
    });
    const genericDetail = loadRegistrationCaseDetail("task", "viewer");
    type PublicObservationReadStatus =
      Awaited<typeof observationRead>["tracks"][number]["workflowStatus"];
    type PublicGenericReadStatus =
      Awaited<typeof genericRead>["tracks"][number]["workflowStatus"];
    type PublicObservationDetailStatus =
      Awaited<typeof observationDetail>["tracks"][number]["workflowStatus"];
    type PublicGenericDetailStatus =
      Awaited<typeof genericDetail>["tracks"][number]["workflowStatus"];
    type ObservationSummaryKey =
      | "observationAttemptCount"
      | "observationCurrentId"
      | "observationCurrentStatus"
      | "observationCurrentAppointmentId"
      | "observationNearestScheduledAt"
      | "observationNearestPlace"
      | "observationNotificationRevision"
      | "observationRevision"
      | "observationFeedbackRevision"
      | "observationSummaryVisible";
    type PublicGenericReadObservationKeys = Extract<
      ObservationSummaryKey,
      keyof Awaited<typeof genericRead>["tracks"][number]
    >;

    type ObservationReadIsExact = Assert<Equal<
      ObservationReadStatus,
      RegistrationObservationTrackWorkflowStatus
    >>;
    type ObservationTrackIsExact = Assert<Equal<
      OpsRegistrationObservationTrackSummary["workflowStatus"],
      RegistrationObservationTrackWorkflowStatus
    >>;
    type PublicObservationReadIsExact = Assert<Equal<
      PublicObservationReadStatus,
      RegistrationObservationTrackWorkflowStatus
    >>;
    type PublicGenericReadIsNarrow = Assert<Equal<
      PublicGenericReadStatus,
      OpsRegistrationWorkflowStatus
    >>;
    type PublicGenericReadHasNoObservationKeys = Assert<Equal<
      PublicGenericReadObservationKeys,
      never
    >>;
    type GenericTrackIsNarrow = Assert<Equal<
      OpsRegistrationTrackSummary["workflowStatus"],
      OpsRegistrationWorkflowStatus
    >>;
    type GenericMutationIsNarrow = Assert<Equal<
      GenericMutationStatus,
      OpsRegistrationWorkflowStatus
    >>;
    type PublicObservationDetailIsExact = Assert<Equal<
      PublicObservationDetailStatus,
      RegistrationObservationTrackWorkflowStatus
    >>;
    type ObservationDetailAliasIsExact = Assert<Equal<
      OpsRegistrationObservationCaseDetail["tracks"][number]["workflowStatus"],
      RegistrationObservationTrackWorkflowStatus
    >>;
    type PublicGenericDetailIsNarrow = Assert<Equal<
      PublicGenericDetailStatus,
      OpsRegistrationWorkflowStatus
    >>;
    type ObservationStatusCannotUseGenericMutation = Assert<Equal<
      Extract<"observation_requested", GenericMutationStatus>,
      never
    >>;
  `);

  assert.deepEqual(diagnostics, []);
});

test("track summaries prefer the manual workflow status and preserve its revision", async () => {
  const { mapTrack } = await loadFactory();

  const explicit = mapTrack({
    id: "track-1",
    task_id: "task-1",
    subject: "영어",
    pipeline_status: "waiting",
    workflow_status: "waiting_next_opening",
    workflow_revision: 4,
    workflow_status_entered_at: "2026-08-01T01:00:00.000Z",
  });
  const legacy = mapTrack({
    id: "track-2",
    task_id: "task-1",
    subject: "수학",
    pipeline_status: "waiting",
    waiting_kind: "current_class",
  });

  assert.equal(explicit.workflowStatus, "waiting_next_opening");
  assert.equal(explicit.workflowRevision, 4);
  assert.equal(explicit.workflowStatusEnteredAt, "2026-08-01T01:00:00.000Z");
  assert.equal(legacy.workflowStatus, "waiting_current_class");
  assert.equal(legacy.workflowRevision, 1);
});

test("version-2 event parser preserves explicit user, system, and migration actors", async () => {
  const { mapTrackEvent } = await loadFactory();
  const actorFixtures = [
    {
      actorKind: "user",
      actorProfileId: "profile-user",
      systemSource: null,
    },
    {
      actorKind: "system",
      actorProfileId: null,
      systemSource: "registration_reminder_materializer",
    },
    {
      actorKind: "migration",
      actorProfileId: null,
      systemSource: "registration_history_v2_backfill",
    },
  ];

  const mapped = actorFixtures.map((fixture, index) => mapTrackEvent({
    id: `event-v2-${index + 1}`,
    task_id: "task-1",
    actor_id: fixture.actorProfileId,
    event_type: "registration_track_event",
    field_name: "registration_track:track-1",
    before_value: null,
    after_value: JSON.stringify({
      version: 2,
      event_type: "consultation_completed",
      actor_profile_id: fixture.actorProfileId,
      actor_kind: fixture.actorKind,
      system_source: fixture.systemSource,
      track_id: "track-1",
      subject: "영어",
      source: "consultation_waiting",
      destination: "enrollment_decided",
      reason_code: "consultation_approved",
      metadata: { consultationId: "consultation-1" },
      occurred_at: "2026-07-16T01:02:03Z",
    }),
    created_at: "2026-07-16T01:02:04Z",
  }));

  assert.deepEqual(
    mapped.map((event) => ({
      payloadVersion: event.payloadVersion,
      eventType: event.eventType,
      actorId: event.actorId,
      actorKind: event.actorKind,
      systemSource: event.systemSource,
      reasonCode: event.reasonCode,
      trackId: event.trackId,
      occurredAt: event.occurredAt,
    })),
    actorFixtures.map((fixture) => ({
      payloadVersion: 2,
      eventType: "consultation_completed",
      actorId: fixture.actorProfileId,
      actorKind: fixture.actorKind,
      systemSource: fixture.systemSource,
      reasonCode: "consultation_approved",
      trackId: "track-1",
      occurredAt: "2026-07-16T01:02:03Z",
    })),
  );
  assert.deepEqual({ ...mapped[0].metadata }, { consultationId: "consultation-1" });
});

test("historical version-1 null actor stays unknown without current-owner inference", async () => {
  const { mapTrackEvent } = await loadFactory();
  const event = mapTrackEvent({
    id: "event-v1-unknown",
    task_id: "task-1",
    actor_id: "current-owner-must-not-be-inferred",
    event_type: "registration_track_event",
    field_name: "registration_track:track-1",
    before_value: null,
    after_value: JSON.stringify({
      version: 1,
      eventType: "waiting_transitioned",
      actorId: null,
      trackId: "track-1",
      subject: "수학",
      source: "consultation_waiting",
      destination: "waiting",
      reason: "guardian_requested_delay",
      metadata: {},
      occurredAt: "2026-07-15T09:00:00Z",
    }),
    created_at: "2026-07-15T09:00:01Z",
  });

  assert.equal(event.payloadVersion, 1);
  assert.equal(event.actorId, null);
  assert.equal(event.actorKind, null);
  assert.equal(event.systemSource, null);
  assert.equal(event.reasonCode, "guardian_requested_delay");
});

test("migration legacy snapshot follows H2 evidence and ignores unrelated detail text", async () => {
  const { buildRegistrationMigrationLegacySnapshot } = await loadFactory();
  const result = buildRegistrationMigrationLegacySnapshot(
    { student_id: "current-student", class_id: "current-class", textbook_id: "current-textbook" },
    {
      request_note: "방문 희망",
      textbook_preparation: "준비",
      counselor: "원장",
      level_test_place: "",
      level_test_material_link: "",
      level_test_result: "",
      visit_consultation_place: "",
    },
    [{
      event_type: "legacy_registration_imported",
      before_value: JSON.stringify({
        pipelineStatus: "5. 등록 결정",
        studentId: "legacy-student",
        classId: "legacy-class",
        textbookId: "legacy-textbook",
      }),
      after_value: JSON.stringify({
        version: 1,
        eventType: "legacy_registration_imported",
        timestamps: {},
        legacyBooleans: {},
      }),
    }],
  );

  assert.equal(result.studentId, "legacy-student");
  assert.equal(result.classId, "legacy-class");
  assert.equal(result.textbookId, "legacy-textbook");
  assert.equal(result.currentStudentId, "current-student");
  assert.equal(result.groups.levelTest, false);
  assert.equal(result.groups.consultation, false);
  assert.equal(result.groups.placement, true);
});

test("migration legacy snapshot uses immutable timestamps plus only H2 detail evidence", async () => {
  const { buildRegistrationMigrationLegacySnapshot } = await loadFactory();
  const result = buildRegistrationMigrationLegacySnapshot(
    {},
    {
      level_test_place: "본관",
      level_test_material_link: "https://drive.test/result",
      level_test_result: "통과",
      visit_consultation_place: "상담실",
    },
    [{
      event_type: "legacy_registration_imported",
      before_value: JSON.stringify({ pipelineStatus: "2. 상담" }),
      after_value: JSON.stringify({
        version: 1,
        eventType: "legacy_registration_imported",
        timestamps: {
          levelTestAt: "2026-07-12T01:00:00Z",
          phoneConsultationAt: "2026-07-13T01:00:00Z",
        },
        legacyBooleans: {},
      }),
    }],
  );

  assert.equal(result.groups.levelTest, true);
  assert.equal(result.groups.consultation, true);
  assert.equal(result.groups.placement, false);
  assert.equal(result.levelTestAt, "2026-07-12T01:00:00Z");
  assert.equal(result.phoneConsultationAt, "2026-07-13T01:00:00Z");
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

function createClient({ queryHandler, rpcHandler } = {}) {
  const queries = [];
  const rpcCalls = [];
  let activeQueries = 0;
  let maxActiveQueries = 0;
  let abortedQueries = 0;

  function execute(query) {
    queries.push({
      ...query,
      filters: query.filters.map((filter) => [...filter]),
    });
    activeQueries += 1;
    maxActiveQueries = Math.max(maxActiveQueries, activeQueries);
    return Promise.resolve(queryHandler?.(query) ?? { data: [], error: null })
      .finally(() => {
        activeQueries -= 1;
      });
  }

  function builder(table) {
    const query = {
      table,
      columns: "",
      options: undefined,
      filters: [],
      order: [],
      limit: null,
      single: false,
    };
    const fluent = {
      abortSignal(signal) {
        if (signal.aborted) {
          abortedQueries += 1;
        } else {
          signal.addEventListener("abort", () => { abortedQueries += 1; }, { once: true });
        }
        return fluent;
      },
      select(columns, options) {
        query.columns = columns;
        query.options = options;
        return fluent;
      },
      eq(column, value) {
        query.filters.push(["eq", column, value]);
        return fluent;
      },
      is(column, value) {
        query.filters.push(["is", column, value]);
        return fluent;
      },
      neq(column, value) {
        query.filters.push(["neq", column, value]);
        return fluent;
      },
      not(column, operator, value) {
        query.filters.push(["not", column, operator, value]);
        return fluent;
      },
      or(filters) {
        query.filters.push(["or", filters]);
        return fluent;
      },
      gte(column, value) {
        query.filters.push(["gte", column, value]);
        return fluent;
      },
      lt(column, value) {
        query.filters.push(["lt", column, value]);
        return fluent;
      },
      in(column, values) {
        query.filters.push(["in", column, [...values]]);
        return fluent;
      },
      order(column, options) {
        query.order.push([column, options]);
        return fluent;
      },
      limit(value) {
        query.limit = value;
        return fluent;
      },
      single() {
        query.single = true;
        return fluent;
      },
      then(resolve, reject) {
        return execute(query).then(resolve, reject);
      },
    };
    return fluent;
  }

  return {
    queries,
    rpcCalls,
    getAbortedQueryCount: () => abortedQueries,
    getMaxActiveQueries: () => maxActiveQueries,
    client: {
      from: builder,
      async rpc(name, args) {
        rpcCalls.push([name, args]);
        if (rpcHandler) return rpcHandler(name, args);
        if (name === "get_registration_customer_reminder_summaries_v1") {
          return {
            data: [{
              appointment_id: "appointment-1",
              state: "scheduled",
              scheduled_for: "2026-07-13T01:00:00.000Z",
              sent_at: null,
              updated_at: "2026-07-12T02:00:00.000Z",
            }],
            error: null,
          };
        }
        return { data: { ok: true }, error: null };
      },
    },
  };
}

function readyOptions(overrides = {}) {
  return {
    probeRuntime: async () => ({ mode: "ready", version: 1 }),
    probeIntakeRuntime: async () => ({ available: true, version: 1 }),
    probeObservationRuntime: async () => ({ available: true, runtimeVersion: 1 }),
    invalidateRuntimeAfterReadyFailure(error) {
      const integrityError = new Error("runtime integrity failure");
      integrityError.code = "REGISTRATION_RUNTIME_INTEGRITY_ERROR";
      integrityError.cause = error;
      throw integrityError;
    },
    now: () => 1,
    randomUUID: () => "uuid-from-options",
    invalidatePublicClassesCacheAfterMutation: async (_client, reason) => ({
      status: "refreshed",
      reason,
      requestId: "public-cache-refresh",
    }),
    ...overrides,
  };
}

const inertObservationSummaryRow = {
  observation_attempt_count: 0,
  observation_current_id: null,
  observation_current_status: null,
  observation_current_appointment_id: null,
  observation_nearest_scheduled_at: null,
  observation_nearest_place: null,
  observation_notification_revision: null,
  observation_revision: null,
  observation_feedback_revision: null,
};

const observationSummaryObjectKeys = [
  "observationAttemptCount",
  "observationCurrentId",
  "observationCurrentStatus",
  "observationCurrentAppointmentId",
  "observationNearestScheduledAt",
  "observationNearestPlace",
  "observationNotificationRevision",
  "observationRevision",
  "observationFeedbackRevision",
  "observationSummaryVisible",
];

function summaryRowForProjection(columns) {
  return {
    id: "track-1",
    task_id: "task-1",
    subject: "영어",
    pipeline_status: "consultation_waiting",
    workflow_status: "consultation_completed",
    workflow_revision: 3,
    director_profile_id: null,
    ...(columns.includes("observation_attempt_count")
      ? inertObservationSummaryRow
      : {}),
  };
}

test("generic summary never probes observation runtime and survives a rejected probe", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  let observationProbeCalls = 0;
  const harness = createClient({
    queryHandler: (query) => ({ data: [summaryRowForProjection(query.columns)], error: null }),
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    probeObservationRuntime: async () => {
      observationProbeCalls += 1;
      throw new Error("observation probe rejected");
    },
  }));

  const result = await service.loadLegacyCompatibleTrackSummaries(
    ["task-1"],
    "shared-viewer",
  );

  assert.equal(result.mode, "ready");
  assert.equal(result.tracks[0].id, "track-1");
  assert.equal(observationProbeCalls, 0);
  assert.doesNotMatch(harness.queries[0].columns, /observation_attempt_count/);
  for (const key of observationSummaryObjectKeys) {
    assert.equal(
      Object.hasOwn(result.tracks[0], key),
      false,
      `generic summary must not own ${key}`,
    );
  }
});

test("a rejected observation probe cannot poison a later generic or observation summary read", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  let rejectObservationProbe = true;
  let observationProbeCalls = 0;
  const harness = createClient({
    queryHandler: (query) => ({ data: [summaryRowForProjection(query.columns)], error: null }),
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    probeObservationRuntime: async () => {
      observationProbeCalls += 1;
      if (rejectObservationProbe) throw new Error("observation probe rejected");
      return { available: true, runtimeVersion: 1 };
    },
  }));

  await assert.rejects(
    service.loadTrackSummaries(["task-1"], "same-viewer"),
    /observation probe rejected/,
  );
  const generic = await service.loadLegacyCompatibleTrackSummaries(
    ["task-1"],
    "same-viewer",
  );
  rejectObservationProbe = false;
  const observation = await service.loadTrackSummaries(["task-1"], "same-viewer");

  assert.equal(observationProbeCalls, 2);
  assert.equal(harness.queries.length, 2);
  assert.doesNotMatch(harness.queries[0].columns, /observation_attempt_count/);
  assert.match(harness.queries[1].columns, /observation_attempt_count/);
  for (const key of observationSummaryObjectKeys) {
    assert.equal(Object.hasOwn(generic.tracks[0], key), false);
  }
  assert.equal(observation.tracks[0].observationSummaryVisible, true);
});

test("observation summary refreshes an unforced same-viewer cache when runtime changes from 0 to 1", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  let observationRuntimeVersion = 0;
  let observationProbeCalls = 0;
  const measures = [];
  const harness = createClient({
    queryHandler: (query) => ({ data: [summaryRowForProjection(query.columns)], error: null }),
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    probeObservationRuntime: async () => {
      observationProbeCalls += 1;
      return {
        available: observationRuntimeVersion === 1,
        runtimeVersion: observationRuntimeVersion,
      };
    },
    recordMeasure: (measure) => measures.push({ ...measure }),
  }));

  const unavailable = await service.loadTrackSummaries(["task-1"], "same-viewer");
  observationRuntimeVersion = 1;
  const available = await service.loadTrackSummaries(["task-1"], "same-viewer");

  assert.equal(unavailable.tracks[0].observationSummaryVisible, false);
  assert.equal(available.tracks[0].observationSummaryVisible, true);
  assert.equal(observationProbeCalls, 2);
  assert.equal(harness.queries.length, 2);
  assert.doesNotMatch(harness.queries[0].columns, /observation_attempt_count/);
  assert.match(harness.queries[1].columns, /observation_attempt_count/);
  assert.deepEqual(
    measures.map(({ name, cacheHit, queryCount }) => ({ name, cacheHit, queryCount })),
    [
      { name: "registration:track-summary:observation", cacheHit: false, queryCount: 1 },
      { name: "registration:track-summary:observation", cacheHit: false, queryCount: 1 },
    ],
  );
});

test("observation runtime identity separates an unavailable in-flight read from a newly available read", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const unavailableQueryStarted = deferred();
  const unavailableQueryGate = deferred();
  let observationRuntimeVersion = 0;
  let observationProbeCalls = 0;
  const harness = createClient({
    queryHandler(query) {
      const result = { data: [summaryRowForProjection(query.columns)], error: null };
      if (!query.columns.includes("observation_attempt_count")) {
        unavailableQueryStarted.resolve();
        return unavailableQueryGate.promise.then(() => result);
      }
      return result;
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    probeObservationRuntime: async () => {
      observationProbeCalls += 1;
      return {
        available: observationRuntimeVersion === 1,
        runtimeVersion: observationRuntimeVersion,
      };
    },
  }));

  const unavailable = service.loadTrackSummaries(["task-1"], "same-viewer");
  await unavailableQueryStarted.promise;
  observationRuntimeVersion = 1;
  const available = service.loadTrackSummaries(["task-1"], "same-viewer");
  const probeCallsBeforeRelease = observationProbeCalls;
  unavailableQueryGate.resolve();
  const [unavailableResult, availableResult] = await Promise.all([unavailable, available]);

  assert.equal(probeCallsBeforeRelease, 2);
  assert.equal(harness.queries.length, 2);
  assert.equal(unavailableResult.tracks[0].observationSummaryVisible, false);
  assert.equal(availableResult.tracks[0].observationSummaryVisible, true);
  assert.doesNotMatch(harness.queries[0].columns, /observation_attempt_count/);
  assert.match(harness.queries[1].columns, /observation_attempt_count/);
});

test("generic and observation summary modes isolate projection cache inflight epoch and measurement identity", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  for (const order of [["generic", "observation"], ["observation", "generic"]]) {
    let observationRuntimeVersion = 0;
    let observationProbeCalls = 0;
    const measures = [];
    const harness = createClient({
      queryHandler: (query) => ({ data: [summaryRowForProjection(query.columns)], error: null }),
    });
    const service = createRegistrationTrackService(harness.client, readyOptions({
      probeObservationRuntime: async () => {
        observationProbeCalls += 1;
        return {
          available: observationRuntimeVersion === 1,
          runtimeVersion: observationRuntimeVersion,
        };
      },
      recordMeasure: (measure) => measures.push({ ...measure }),
    }));
    const invoke = (mode, force = false) => mode === "generic"
      ? service.loadLegacyCompatibleTrackSummaries(["task-1"], "shared-viewer", { force })
      : service.loadTrackSummaries(["task-1"], "shared-viewer", { force });

    await invoke(order[0]);
    if (order[0] === "generic") observationRuntimeVersion = 1;
    await invoke(order[1]);
    if (order[0] === "observation") {
      observationRuntimeVersion = 1;
      await invoke("observation", true);
    }

    const queryCountBeforeGenericForce = order[0] === "observation" ? 3 : 2;
    assert.equal(
      harness.queries.length,
      queryCountBeforeGenericForce,
      `separate queries and runtime 0 -> 1 refresh for ${order.join(" -> ")}`,
    );
    const genericQuery = harness.queries.find(
      (query) => !query.columns.includes("observation_attempt_count"),
    );
    const observationQuery = harness.queries.find(
      (query) => query.columns.includes("observation_attempt_count"),
    );
    assert.ok(genericQuery, `generic projection for ${order.join(" -> ")}`);
    assert.ok(observationQuery, `observation projection for ${order.join(" -> ")}`);
    const observationProbeCallsBeforeGenericForce = order[0] === "observation" ? 2 : 1;
    assert.equal(observationProbeCalls, observationProbeCallsBeforeGenericForce);
    assert.deepEqual(new Set(measures.map((measure) => measure.name)), new Set([
      "registration:track-summary:generic",
      "registration:track-summary:observation",
    ]));

    await invoke("generic", true);
    assert.equal(
      observationProbeCalls,
      observationProbeCallsBeforeGenericForce,
      "generic force advances only the generic epoch",
    );
    await invoke("observation");
    assert.equal(
      harness.queries.length,
      queryCountBeforeGenericForce + 1,
      "observation cache survives a generic force refresh",
    );
  }
});

function initialWorkflowCreateInput() {
  return {
    studentName: "김다미",
    schoolGrade: "고1",
    schoolName: "중앙고",
    parentPhone: "01012345678",
    studentPhone: "",
    campus: "본관",
    inquiryAt: "2026-07-16T01:00:00Z",
    subjects: ["영어"],
    requestNote: "",
    priority: "normal",
    subjectPlans: { 영어: "inquiry" },
    levelTestAppointment: null,
    visitAppointment: null,
    directorOverrides: {},
    requestKey: "runtime-guard-request",
  };
}

test("manual workflow status uses only its dedicated revisioned RPC", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name, args) {
      assert.equal(name, "set_registration_workflow_status_v1");
      assert.deepEqual({ ...args }, {
        p_track_id: "track-1",
        p_workflow_status: "payment_in_progress",
        p_expected_workflow_revision: 3,
        p_request_key: "workflow-request",
      });
      return {
        data: {
          trackId: "track-1",
          workflowStatus: "payment_in_progress",
          workflowRevision: 4,
          workflowStatusEnteredAt: "2026-08-01T03:00:00.000Z",
        },
        error: null,
      };
    },
  });
  let invalidations = 0;
  const service = createRegistrationTrackService(harness.client, readyOptions({
    onMutationSuccess: () => { invalidations += 1; },
  }));

  const result = await service.setRegistrationWorkflowStatus({
    trackId: "track-1",
    workflowStatus: "payment_in_progress",
    expectedWorkflowRevision: 3,
    requestKey: "workflow-request",
  });

  assert.equal(result.trackId, "track-1");
  assert.equal(result.workflowStatus, "payment_in_progress");
  assert.equal(result.workflowRevision, 4);
  assert.equal(result.workflowStatusEnteredAt, "2026-08-01T03:00:00.000Z");
  assert.equal(result.enrollmentFinalization, null);
  assert.equal(invalidations, 1);
});

test("registered workflow remains a status-only response without enrollment finalization", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name) {
      assert.equal(name, "set_registration_workflow_status_v1");
      return {
        data: {
          trackId: "track-registered",
          workflowStatus: "registered",
          workflowRevision: 2,
          workflowStatusEnteredAt: "2026-08-26T03:00:00.000Z",
          enrollmentFinalization: null,
        },
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.setRegistrationWorkflowStatus({
    trackId: "track-registered",
    workflowStatus: "registered",
    expectedWorkflowRevision: 1,
    requestKey: "workflow-register-receipt",
  });

  assert.equal(result.enrollmentFinalization, null);
});

test("admission checklist saves one independent item through its dedicated RPC", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name, args) {
      assert.equal(name, "set_registration_admission_checklist_item_v1");
      assert.deepEqual({ ...args }, {
        p_task_id: "task-1",
        p_item: "registrationCompleted",
        p_checked: true,
        p_request_key: "checklist-request",
      });
      return {
        data: {
          taskId: "task-1",
          checklist: {
            applicationSent: false,
            makeeduRegistered: false,
            invoiceSent: false,
            paymentConfirmed: false,
            registrationCompleted: true,
          },
        },
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.setRegistrationAdmissionChecklistItem({
    taskId: "task-1",
    item: "registrationCompleted",
    checked: true,
    requestKey: "checklist-request",
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    taskId: "task-1",
    checklist: {
      applicationSent: false,
      makeeduRegistered: false,
      invoiceSent: false,
      paymentConfirmed: false,
      registrationCompleted: true,
    },
  });
  assert.equal(harness.queries.length, 0);
});

test("registration management notification uses only the explicit v2 producer with one request key", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name, args) {
      assert.equal(name, "ensure_registration_workflow_notification_v2");
      assert.deepEqual({ ...args }, {
        p_track_id: "track-1",
        p_workflow_revision: 4,
        p_request_key: "99710000-0000-4000-8000-000000000901",
        p_intent: "send_registration_management_notification",
      });
      return {
        data: { source_event_ids: ["workflow-event", "workflow-event", null] },
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  assert.equal("ensureRegistrationCaseCreatedNotificationSourceIds" in service, false);
  assert.deepEqual(
    Array.from(await service.ensureRegistrationWorkflowNotificationSourceIds({
      trackId: "track-1",
      workflowRevision: 4,
      requestKey: "99710000-0000-4000-8000-000000000901",
    })),
    ["workflow-event"],
  );
  assert.equal(harness.queries.length, 0);
});

test("phone consultation save materializes and maps the persisted consultation", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name, args) {
      assert.equal(name, "save_registration_phone_consultation_v1");
      assert.deepEqual({ ...args }, {
        p_track_id: "track-phone",
        p_request_key: "phone-request",
      });
      return {
        data: {
          id: "consultation-phone",
          trackId: "track-phone",
          appointmentId: null,
          mode: "phone",
          status: "waiting",
          directorProfileId: "director-1",
          readyAt: "2026-08-03T01:00:00.000Z",
          readySource: "director_resolved",
          completedAt: null,
          outcome: null,
          createdAt: "2026-08-03T01:00:00.000Z",
          updatedAt: "2026-08-03T01:00:00.000Z",
        },
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const consultation = await service.saveRegistrationPhoneConsultation({
    trackId: "track-phone",
    requestKey: "phone-request",
  });

  assert.equal(consultation.id, "consultation-phone");
  assert.equal(consultation.mode, "phone");
  assert.equal(consultation.status, "waiting");
  assert.equal(consultation.readySource, "director_resolved");
});

test("calendar raw loader uses the canonical half-open scheduled query without caching", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const row = {
    appointment_id: "appointment-calendar-1",
    task_id: "task-calendar-1",
    student_name: "김다미",
    kind: "level_test",
    scheduled_at: "2026-07-15T10:00:00+09:00",
    place: "본관 201호",
    status: "scheduled",
    notification_revision: 2,
    track_ids: ["track-calendar-english", "track-calendar-math"],
    subjects: ["영어", "수학"],
  };
  const harness = createClient({
    queryHandler(query) {
      assert.equal(query.table, "ops_registration_appointment_calendar");
      return { data: [row], error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const input = {
    rangeStart: "2026-07-01T00:00:00+09:00",
    rangeEnd: "2026-08-01T00:00:00+09:00",
    observationRuntimeVersion: 1,
  };

  const first = await service.loadRegistrationAppointmentCalendarRows(input);
  const second = await service.loadRegistrationAppointmentCalendarRows(input);

  assert.deepEqual(JSON.parse(JSON.stringify(first)), [row]);
  assert.deepEqual(JSON.parse(JSON.stringify(second)), [row]);
  assert.equal(harness.queries.length, 2, "calendar range results must not use a cross-viewer cache");
  for (const query of harness.queries) {
    assert.equal(
      query.columns,
      "appointment_id,task_id,student_name,kind,scheduled_at,place,status,notification_revision,track_ids,subjects,observation_id,observation_track_id,observation_class_id,observation_class_name,observation_ends_at,observation_teacher_name,observation_classroom_name",
    );
    assert.deepEqual(query.filters, [
      ["gte", "scheduled_at", input.rangeStart],
      ["lt", "scheduled_at", input.rangeEnd],
      ["in", "status", ["scheduled"]],
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(query.order)), [
      ["scheduled_at", { ascending: true }],
      ["appointment_id", { ascending: true }],
    ]);
  }
});

test("calendar raw loader selects observation snapshots and excludes them at runtime zero", async () => {
  // Production break caught: the direct view DTO omits a bounded snapshot or a
  // disabled runtime sends observation rows to the browser before model gating.
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient();
  const service = createRegistrationTrackService(harness.client, readyOptions());
  await service.loadRegistrationAppointmentCalendarRows({
    rangeStart: "2026-08-01T00:00:00+09:00",
    rangeEnd: "2026-09-01T00:00:00+09:00",
    observationRuntimeVersion: 0,
  });

  assert.equal(harness.queries.length, 1);
  assert.equal(
    harness.queries[0].columns,
    "appointment_id,task_id,student_name,kind,scheduled_at,place,status,notification_revision,track_ids,subjects,observation_id,observation_track_id,observation_class_id,observation_class_name,observation_ends_at,observation_teacher_name,observation_classroom_name",
  );
  assert.deepEqual(harness.queries[0].filters, [
    ["neq", "kind", "observation_class"],
    ["gte", "scheduled_at", "2026-08-01T00:00:00+09:00"],
    ["lt", "scheduled_at", "2026-09-01T00:00:00+09:00"],
    ["in", "status", ["scheduled"]],
  ]);
});

test("calendar raw loader normalizes explicit statuses and skips an explicit empty selection", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient();
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const range = {
    rangeStart: "2026-07-01T00:00:00+09:00",
    rangeEnd: "2026-08-01T00:00:00+09:00",
    observationRuntimeVersion: 1,
  };

  await service.loadRegistrationAppointmentCalendarRows({
    ...range,
    statuses: ["canceled", "completed", "canceled"],
  });
  const empty = await service.loadRegistrationAppointmentCalendarRows({ ...range, statuses: [] });

  assert.deepEqual(harness.queries[0].filters.at(-1), ["in", "status", ["completed", "canceled"]]);
  assert.deepEqual(JSON.parse(JSON.stringify(empty)), []);
  assert.equal(harness.queries.length, 1, "an explicit empty status selection must not query PostgREST");
});

test("calendar raw loader rejects invalid ranges and unsupported statuses before querying", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient();
  const service = createRegistrationTrackService(harness.client, readyOptions());

  for (const input of [
    { rangeStart: "invalid", rangeEnd: "2026-08-01T00:00:00+09:00", observationRuntimeVersion: 1 },
    { rangeStart: "2026-08-01T00:00:00+09:00", rangeEnd: "2026-08-01T00:00:00+09:00", observationRuntimeVersion: 1 },
    { rangeStart: "2026-07-01T00:00:00+09:00", rangeEnd: "2026-08-01T00:00:00+09:00", statuses: ["waiting"], observationRuntimeVersion: 1 },
  ]) {
    await assert.rejects(
      Promise.resolve().then(() => service.loadRegistrationAppointmentCalendarRows(input)),
      /registration_calendar_(range|status)_invalid/,
    );
  }
  assert.equal(harness.queries.length, 0);
});

function detailRows(table) {
  if (table === "ops_tasks") {
    return {
      data: {
        id: "task-1",
        title: "김다미 등록",
        type: "registration",
        status: "in_progress",
        priority: "normal",
        student_name: "김다미",
        campus: "본관",
        subject: "영어, 수학",
        created_at: "2026-07-12T01:00:00Z",
        updated_at: "2026-07-12T02:00:00Z",
        ops_registration_details: {
          task_id: "task-1",
          common_revision: 3,
          pipeline_status: "2. 상담",
          school_grade: "고1",
          school_name: "중앙여고",
          inquiry_at: "2026-07-12T01:00:00Z",
          parent_phone: "01012345678",
          student_phone: "",
          request_note: "방문 희망",
        },
        ops_task_comments: [{
          id: "comment-1",
          task_id: "task-1",
          author_id: "profile-1",
          body: "확인",
          created_at: "2026-07-12T01:10:00Z",
        }],
        ops_task_attachments: [{
          id: "attachment-1",
          task_id: "task-1",
          file_name: "성적표.pdf",
          file_kind: "pdf",
          drive_file_id: "drive-1",
          drive_link: "https://drive.test/1",
          uploaded_by: "profile-1",
          uploaded_at: "2026-07-12T01:20:00Z",
        }],
      },
      error: null,
    };
  }
  if (table === "ops_registration_subject_tracks") {
    return {
      data: [{
        id: "track-1",
        task_id: "task-1",
        subject: "영어",
        pipeline_status: "consultation_waiting",
        observation_attempt_count: 0,
        director_profile_id: "director-1",
        director_assignment_source: "default",
        director_assignment_rule_key: "english:2026:high1",
        waiting_kind: null,
        level_test_retake_decision: null,
        migration_review_required: false,
        stage_entered_at: "2026-07-12T01:30:00Z",
        phone_ready_at: "2026-07-12T01:00:00Z",
        phone_ready_source: "inquiry",
        director: { id: "director-1", name: "강부희" },
        level_tests: [{
          id: "test-1", track_id: "track-1", appointment_id: "appointment-1",
          attempt_number: 1, status: "completed", started_at: "2026-07-13T01:00:00Z",
          completed_at: "2026-07-13T02:00:00Z", material_link: "https://drive.test/test",
        }],
        consultations: [{
          id: "consultation-1", track_id: "track-1", appointment_id: null,
          mode: "phone", status: "waiting", director_profile_id: "director-1",
          ready_at: "2026-07-12T01:00:00Z", ready_source: "level_test_completion",
          completed_at: null, outcome: null,
          created_at: "2026-07-12T01:00:00Z", updated_at: "2026-07-12T02:00:00Z",
        }],
        enrollments: [{
          id: "enrollment-1", track_id: "track-1", student_id: null,
          admission_batch_id: null, class_id: "class-1", textbook_id: null,
          class_start_date: null, class_start_session_key: null,
          class_start_session: null, status: "planned", makeedu_registered: false,
          roster_active: false, roster_released_at: null, roster_release_reason: null,
          roster_release_source_task_id: null, roster_release_kind: null, sort_order: 0,
        }],
      }],
      error: null,
    };
  }
  if (table === "ops_registration_appointments") {
    return { data: [{
      id: "appointment-1",
      task_id: "task-1",
      kind: "visit_consultation",
      scheduled_at: "2026-07-13T01:00:00Z",
      place: "상담실",
      status: "scheduled",
      notification_revision: 2,
      created_at: "2026-07-12T01:00:00Z",
      updated_at: "2026-07-12T02:00:00Z",
    }], error: null };
  }
  if (table === "ops_registration_admission_batches") {
    return { data: [{
      id: "batch-1", task_id: "task-1", revision_number: 1, status: "draft",
      invoice_sent_at: null, payment_confirmed_at: null,
      created_at: "2026-07-12T01:00:00Z", updated_at: "2026-07-12T02:00:00Z",
    }], error: null };
  }
  if (table === "ops_task_events") {
    return { data: [
      {
        id: "event-canonical", task_id: "task-1", actor_id: "profile-1",
        event_type: "registration_track_event", field_name: "registration_track:track-1",
        before_value: null,
        after_value: JSON.stringify({
          version: 1, eventType: "consultation_completed", actorId: "profile-1",
          trackId: "track-1", subject: "영어", source: "consultation_waiting",
          destination: "enrollment_decided", reason: null,
          metadata: { consultationId: "consultation-1" },
          occurredAt: "2026-07-12T01:59:00Z",
        }),
        created_at: "2026-07-12T01:59:00Z",
      },
      {
        id: "event-legacy", task_id: "task-1", actor_id: "profile-1",
        event_type: "future_event", field_name: "future", before_value: null,
        after_value: "plain future history", created_at: "2026-07-12T02:00:00Z",
      },
    ], error: null };
  }
  if (table === "ops_registration_messages") {
    return { data: [{
      id: "message-1", status: "failed", claim_active: true,
      template_key: "admission_application", request_key: "message-key",
      updated_at: "2026-07-12T02:00:00Z",
    }], error: null };
  }
  if (table === "ops_registration_level_tests") {
    return { data: [{
      id: "test-1", track_id: "track-1", appointment_id: "appointment-1",
      attempt_number: 1, status: "completed", started_at: "2026-07-13T01:00:00Z",
      completed_at: "2026-07-13T02:00:00Z", material_link: "https://drive.test/test",
    }], error: null };
  }
  if (table === "ops_registration_consultations") {
    return { data: [{
      id: "consultation-1", track_id: "track-1", appointment_id: null,
      mode: "phone", status: "waiting", director_profile_id: "director-1",
      ready_at: "2026-07-12T01:00:00Z", ready_source: "level_test_completion",
      completed_at: null, outcome: null,
      created_at: "2026-07-12T01:00:00Z", updated_at: "2026-07-12T02:00:00Z",
    }], error: null };
  }
  if (table === "ops_registration_enrollments") {
    return { data: [{
      id: "enrollment-1", track_id: "track-1", student_id: null,
      admission_batch_id: null, class_id: "class-1", textbook_id: null,
      class_start_date: null, class_start_session_key: null,
      class_start_session: null, status: "planned", makeedu_registered: false,
      roster_active: false, roster_released_at: null, roster_release_reason: null,
      roster_release_source_task_id: null, roster_release_kind: null, sort_order: 0,
    }], error: null };
  }
  throw new Error(`unexpected detail table: ${table}`);
}

const caseDetailObservationSecrets = {
  scheduledAt: "2026-08-14T09:37:00+09:00",
  place: "비공개 청강 교실 907호",
  reason: "보호자 요청: 다른 학생에게 알리지 말 것",
  afterValue: "private-observation-audit-after-value",
};

function toPostgresJsonbText(value) {
  return JSON.stringify(value).replaceAll('\":', '\": ');
}

function detailRowsWithObservationSecrets(query) {
  const result = detailRows(query.table);
  const hasExactFilter = (expected) => query.filters.some((filter) => (
    filter.length === expected.length
    && filter.every((value, index) => value === expected[index])
  ));
  const hidesObservationAppointments = hasExactFilter([
    "neq", "kind", "observation_class",
  ]);
  const usesSharedVisibilityComputedField = hasExactFilter([
    "eq", "registration_task_event_shared_visible", true,
  ]);
  const usesLegacyTextRegex = query.filters.some((filter) => filter[0] === "or");
  if (query.table === "ops_registration_subject_tracks") {
    return {
      ...result,
      data: result.data.map((row) => ({
        ...row,
        workflow_status: "consultation_requested",
        workflow_revision: 4,
        ...inertObservationSummaryRow,
      })),
    };
  }
  if (query.table === "ops_registration_appointments") {
    return {
      ...result,
      data: [
        ...result.data,
        {
          id: "appointment-observation-private",
          task_id: "task-1",
          kind: "observation_class",
          scheduled_at: caseDetailObservationSecrets.scheduledAt,
          place: caseDetailObservationSecrets.place,
          status: "scheduled",
          notification_revision: 7,
          created_at: "2026-08-10T01:00:00Z",
          updated_at: "2026-08-10T02:00:00Z",
        },
        {
          id: "appointment-observation-canceled",
          task_id: "task-1",
          kind: "observation_class",
          scheduled_at: "2026-08-13T08:00:00+09:00",
          place: "취소된 청강 교실",
          status: "canceled",
          notification_revision: 4,
          created_at: "2026-08-09T01:00:00Z",
          updated_at: "2026-08-09T02:00:00Z",
        },
      ].filter((row) => !hidesObservationAppointments || row.kind !== "observation_class"),
    };
  }
  if (query.table === "ops_task_events") {
    return {
      ...result,
      data: [
        ...result.data,
        {
          id: "event-observation-reason-private",
          task_id: "task-1",
          actor_id: "profile-1",
          event_type: "registration_track_event",
          field_name: "registration_observation:track-1",
          before_value: null,
          after_value: toPostgresJsonbText({
            version: 2,
            event_type: "registration_observation_withdrawn",
            actor_profile_id: "profile-1",
            actor_kind: "user",
            system_source: null,
            track_id: "track-1",
            subject: "영어",
            source: "observation_feedback_pending",
            destination: "consultation_completed",
            reason_code: "director_correction",
            metadata: {
              reason: caseDetailObservationSecrets.reason,
              afterValue: caseDetailObservationSecrets.afterValue,
            },
            occurred_at: "2026-08-14T10:00:00+09:00",
          }),
          created_at: "2026-08-14T01:00:00Z",
        },
        {
          id: "event-observation-legacy-private",
          task_id: "task-1",
          actor_id: "profile-1",
          event_type: "registration_observation_audit_payload",
          field_name: "registration_observation:track-1",
          before_value: null,
          after_value: caseDetailObservationSecrets.afterValue,
          created_at: "2026-08-14T01:01:00Z",
        },
        {
          id: "event-observation-v1-private",
          task_id: "task-1",
          actor_id: "profile-1",
          event_type: "registration_track_event",
          field_name: "registration_track:track-1",
          before_value: null,
          after_value: JSON.stringify({
            version: 1,
            eventType: "registration_observation_withdrawn",
            actorId: "profile-1",
            trackId: "track-1",
            subject: "영어",
            source: "observation_feedback_pending",
            destination: "consultation_completed",
            reason: caseDetailObservationSecrets.reason,
            metadata: { afterValue: caseDetailObservationSecrets.afterValue },
            occurredAt: "2026-08-14T10:01:00+09:00",
          }),
          created_at: "2026-08-14T01:01:30Z",
        },
        {
          id: "event-public-v2",
          task_id: "task-1",
          actor_id: "profile-1",
          event_type: "registration_track_event",
          field_name: "registration_track:track-1",
          before_value: null,
          after_value: toPostgresJsonbText({
            version: 2,
            event_type: "registration_consultation_completed",
            actor_profile_id: "profile-1",
            actor_kind: "user",
            system_source: null,
            track_id: "track-1",
            subject: "영어",
            source: "consultation_requested",
            destination: "consultation_completed",
            reason_code: null,
            metadata: {
              consultationId: "consultation-public",
              nestedAudit: {
                version: 2,
                event_type: "registration_observation_reference_only",
              },
            },
            occurred_at: "2026-08-14T10:02:00+09:00",
          }),
          created_at: "2026-08-14T01:02:00Z",
        },
        {
          id: "event-legacy-null",
          task_id: "task-1",
          actor_id: null,
          event_type: "legacy_history_marker",
          field_name: "legacy",
          before_value: null,
          after_value: null,
          created_at: "2026-08-14T01:03:00Z",
        },
        {
          id: "event-non-track-observation-shaped",
          task_id: "task-1",
          actor_id: null,
          event_type: "customer_message_sent",
          field_name: "customer_message",
          before_value: null,
          after_value: toPostgresJsonbText({
            version: 2,
            event_type: "registration_observation_reference_only",
          }),
          created_at: "2026-08-14T01:03:30Z",
        },
        {
          id: "event-outer-whitespace-observation-shaped",
          task_id: "task-1",
          actor_id: null,
          event_type: " registration_observation_reference_only",
          field_name: "legacy_whitespace",
          before_value: null,
          after_value: null,
          created_at: "2026-08-14T01:03:40Z",
        },
        {
          id: "event-inner-whitespace-observation-shaped",
          task_id: "task-1",
          actor_id: null,
          event_type: "registration_track_event",
          field_name: "registration_track:track-1",
          before_value: null,
          after_value: toPostgresJsonbText({
            version: 2,
            event_type: " registration_observation_reference_only",
          }),
          created_at: "2026-08-14T01:03:50Z",
        },
        {
          id: "event-inner-array-observation-shaped",
          task_id: "task-1",
          actor_id: null,
          event_type: "registration_track_event",
          field_name: "registration_track:track-1",
          before_value: null,
          after_value: toPostgresJsonbText({
            version: 2,
            event_type: ["registration_observation_reference_only"],
          }),
          created_at: "2026-08-14T01:03:55Z",
        },
        {
          id: "event-malformed-non-v2",
          task_id: "task-1",
          actor_id: null,
          event_type: "registration_track_event",
          field_name: "registration_track:track-1",
          before_value: null,
          after_value: '{malformed "version": 2 "event_type": "registration_observation_nested"',
          created_at: "2026-08-14T01:04:00Z",
        },
        {
          id: "event-json-non-v2",
          task_id: "task-1",
          actor_id: null,
          event_type: "registration_track_event",
          field_name: "registration_track:track-1",
          before_value: null,
          after_value: toPostgresJsonbText({
            version: 20,
            event_type: "registration_observation_future_shape",
            metadata: { note: "unknown payload version stays legacy" },
          }),
          created_at: "2026-08-14T01:05:00Z",
        },
        {
          id: "event-json-string-version-near-miss",
          task_id: "task-1",
          actor_id: null,
          event_type: "registration_track_event",
          field_name: "registration_track:track-1",
          before_value: null,
          after_value: toPostgresJsonbText({
            version: "2.0",
            event_type: "registration_observation_future_shape",
          }),
          created_at: "2026-08-14T01:06:00Z",
        },
      ].filter((row) => {
        if (usesSharedVisibilityComputedField) {
          return ![
            "event-observation-reason-private",
            "event-observation-legacy-private",
            "event-observation-v1-private",
          ].includes(row.id);
        }
        if (usesLegacyTextRegex) {
          if (row.event_type.startsWith("registration_observation_")) return false;
          const legacyText = String(row.after_value || "");
          if (
            row.event_type === "registration_track_event"
            && legacyText.includes('\"version\": 2')
            && legacyText.includes('\"event_type\": \"registration_observation_')
          ) return false;
        }
        return true;
      }),
    };
  }
  return result;
}

function assertCaseDetailOmitsObservationSecrets(detail) {
  const payload = JSON.stringify(detail);
  const publicV2 = detail.events.find((event) => event.id === "event-public-v2");
  const legacyNull = detail.events.find((event) => event.id === "event-legacy-null");
  const nonTrack = detail.events.find(
    (event) => event.id === "event-non-track-observation-shaped",
  );
  const malformed = detail.events.find((event) => event.id === "event-malformed-non-v2");
  const jsonNonV2 = detail.events.find((event) => event.id === "event-json-non-v2");
  const stringVersionNearMiss = detail.events.find(
    (event) => event.id === "event-json-string-version-near-miss",
  );
  assert.deepEqual({
    appointmentIds: Array.from(detail.appointments, (appointment) => appointment.id),
    eventIds: Array.from(detail.events, (event) => event.id),
    observationAppointmentKinds: Array.from(
      detail.appointments.filter((appointment) => appointment.kind === "observation_class"),
      (appointment) => appointment.kind,
    ),
    observationEventTypes: Array.from(
      detail.events.filter((event) => event.eventType.startsWith("registration_observation_")),
      (event) => event.eventType,
    ),
    preservedEventShapes: {
      publicV2: publicV2 ? {
        eventType: publicV2.eventType,
        metadata: JSON.parse(JSON.stringify(publicV2.metadata)),
      } : null,
      legacyNull: legacyNull ? {
        eventType: legacyNull.eventType,
        legacyText: legacyNull.legacyText,
      } : null,
      nonTrack: nonTrack ? {
        eventType: nonTrack.eventType,
        legacyText: nonTrack.legacyText,
      } : null,
      malformed: malformed ? {
        eventType: malformed.eventType,
        legacyText: malformed.legacyText,
      } : null,
      jsonNonV2: jsonNonV2 ? {
        eventType: jsonNonV2.eventType,
        legacyText: jsonNonV2.legacyText,
      } : null,
      stringVersionNearMiss: stringVersionNearMiss ? {
        eventType: stringVersionNearMiss.eventType,
        legacyText: stringVersionNearMiss.legacyText,
      } : null,
    },
    exposedSecrets: {
      scheduledAt: payload.includes(caseDetailObservationSecrets.scheduledAt),
      place: payload.includes(caseDetailObservationSecrets.place),
      reason: payload.includes(caseDetailObservationSecrets.reason),
      afterValue: payload.includes(caseDetailObservationSecrets.afterValue),
    },
  }, {
    appointmentIds: ["appointment-1"],
    eventIds: [
      "event-canonical",
      "event-legacy",
      "event-public-v2",
      "event-legacy-null",
      "event-non-track-observation-shaped",
      "event-outer-whitespace-observation-shaped",
      "event-inner-whitespace-observation-shaped",
      "event-inner-array-observation-shaped",
      "event-malformed-non-v2",
      "event-json-non-v2",
      "event-json-string-version-near-miss",
    ],
    observationAppointmentKinds: [],
    observationEventTypes: [],
    preservedEventShapes: {
      publicV2: {
        eventType: "registration_consultation_completed",
        metadata: {
          consultationId: "consultation-public",
          nestedAudit: {
            version: 2,
            event_type: "registration_observation_reference_only",
          },
        },
      },
      legacyNull: {
        eventType: "legacy_history_marker",
        legacyText: null,
      },
      nonTrack: {
        eventType: "customer_message_sent",
        legacyText: toPostgresJsonbText({
          version: 2,
          event_type: "registration_observation_reference_only",
        }),
      },
      malformed: {
        eventType: "registration_track_event",
        legacyText: '{malformed "version": 2 "event_type": "registration_observation_nested"',
      },
      jsonNonV2: {
        eventType: "registration_track_event",
        legacyText: toPostgresJsonbText({
          version: 20,
          event_type: "registration_observation_future_shape",
          metadata: { note: "unknown payload version stays legacy" },
        }),
      },
      stringVersionNearMiss: {
        eventType: "registration_track_event",
        legacyText: toPostgresJsonbText({
          version: "2.0",
          event_type: "registration_observation_future_shape",
        }),
      },
    },
    exposedSecrets: {
      scheduledAt: false,
      place: false,
      reason: false,
      afterValue: false,
    },
  });
}

function assertCaseDetailUsesServerPrivacyFilters(harness) {
  const appointmentQuery = harness.queries.find(
    (query) => query.table === "ops_registration_appointments",
  );
  const eventQuery = harness.queries.find((query) => query.table === "ops_task_events");
  assert.deepEqual({
    appointmentFilters: appointmentQuery.filters,
    eventFilters: eventQuery.filters,
  }, {
    appointmentFilters: [
      ["eq", "task_id", "task-1"],
      ["neq", "kind", "observation_class"],
    ],
    eventFilters: [
      ["eq", "task_id", "task-1"],
      ["eq", "registration_task_event_shared_visible", true],
    ],
  });
}

test("track summary loader uses the exact safe projection and skips profile lookup without directors", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      assert.equal(query.table, "ops_registration_subject_track_summaries");
      return { data: [{
        id: "track-1", task_id: "task-1", subject: "영어",
        pipeline_status: "visit_consultation_scheduled", director_profile_id: null,
        workflow_status: "observation_feedback_pending",
        observation_return_workflow_status: "consultation_completed",
        director_assignment_source: "", director_assignment_rule_key: "",
        waiting_kind: null, level_test_retake_decision: null,
        migration_review_required: false, stage_entered_at: "2026-07-12T01:00:00Z",
        phone_ready_at: null, phone_ready_source: null,
        level_test_scheduled_at: "2026-07-12T05:00:00Z", level_test_place: "본관",
        visit_scheduled_at: "2026-07-13T01:00:00Z", visit_place: "상담실",
        enrollment_detail_rows: [{
          classId: "class-1", textbookId: null, classStartDate: "2026-08-10",
          classStartSessionKey: null, classStartLessonSessionId: null,
          classStartSession: "청강 회차",
          classStartSourceObservationId: "75000000-0000-4000-8000-000000000001",
          sortOrder: 0,
        }],
        observation_attempt_count: 2,
        observation_current_id: "10000000-0000-4000-8000-000000000003",
        observation_current_status: "scheduled",
        observation_current_appointment_id: "10000000-0000-4000-8000-000000000004",
        observation_nearest_scheduled_at: "2026-08-12T09:00:00.000Z",
        observation_nearest_place: "본관",
        observation_notification_revision: 3,
        observation_revision: 4,
        observation_feedback_revision: 1,
        updated_at: "2026-07-12T02:00:00Z",
      }], error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.loadTrackSummaries(["task-1"], "viewer-1");

  assert.equal(result.mode, "ready");
  const { enrollmentDetailRows, ...track } = result.tracks[0];
  assert.deepEqual({ ...track }, {
    id: "track-1", taskId: "task-1", subject: "영어",
    status: "visit_consultation_scheduled", workflowStatus: "observation_feedback_pending",
    workflowRevision: 1, workflowStatusEnteredAt: "", observationReturnWorkflowStatus: "consultation_completed", legacy: false, directorProfileId: null,
    directorName: "", directorAssignmentSource: "", directorAssignmentRuleKey: "",
    waitingKind: "", waitingDetailKind: "", waitingDetailClassId: null, waitingDetailRetakeDecision: "", levelTestRetakeDecision: "", migrationReviewRequired: false,
    stageEnteredAt: "2026-07-12T01:00:00Z",
    phoneReadyAt: null, phoneReadySource: null,
    levelTestScheduledAt: "2026-07-12T05:00:00Z", levelTestPlace: "본관",
    visitScheduledAt: "2026-07-13T01:00:00Z", visitPlace: "상담실",
    observationAttemptCount: 2,
    observationCurrentId: "10000000-0000-4000-8000-000000000003",
    observationCurrentStatus: "scheduled",
    observationCurrentAppointmentId: "10000000-0000-4000-8000-000000000004",
    observationNearestScheduledAt: "2026-08-12T09:00:00.000Z",
    observationNearestPlace: "본관",
    observationNotificationRevision: 3,
    observationRevision: 4,
    observationFeedbackRevision: 1,
    observationSummaryVisible: true,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(enrollmentDetailRows)), [{
      classId: "class-1", textbookId: null, classStartDate: "2026-08-10",
      classStartSessionKey: null, classStartLessonSessionId: null,
      classStartSession: "청강 회차",
      classStartSourceObservationId: "75000000-0000-4000-8000-000000000001",
      sortOrder: 0,
  }]);
  assert.equal(harness.queries.length, 1);
  assert.equal(harness.queries[0].columns,
    "id,task_id,subject,pipeline_status,workflow_status,workflow_revision,workflow_status_entered_at,director_profile_id,director_assignment_source,director_assignment_rule_key,waiting_kind,waiting_detail_kind,waiting_detail_class_id,waiting_detail_retake_decision,level_test_retake_decision,migration_review_required,stage_entered_at,phone_ready_at,phone_ready_source,updated_at,level_test_scheduled_at,level_test_place,visit_scheduled_at,visit_place,enrollment_detail_rows,director:profiles!ops_registration_subject_tracks_director_profile_id_fkey(id,name),observation_return_workflow_status,observation_attempt_count,observation_current_id,observation_current_status,observation_current_appointment_id,observation_nearest_scheduled_at,observation_nearest_place,observation_notification_revision,observation_revision,observation_feedback_revision");
  assert.deepEqual(harness.queries[0].filters, [["in", "task_id", ["task-1"]]]);
  assert.doesNotMatch(harness.queries[0].columns, /schedule_plan|textbook|student_ids|waitlist_ids/);
  assert.doesNotMatch(harness.queries[0].columns, /consultations|appointments|\*/);
});

test("an exact all-null observation summary is concealed while partial null remains fail-closed", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  let partial = false;
  const harness = createClient({
    queryHandler: () => ({ data: [{
      id: "track-1", task_id: "task-1", subject: "영어",
      pipeline_status: "consultation_waiting",
      workflow_status: "observation_requested",
      observation_attempt_count: null,
      observation_current_id: partial ? "observation-without-count" : null,
      observation_current_status: null,
      observation_current_appointment_id: null,
      observation_nearest_scheduled_at: null,
      observation_nearest_place: null,
      observation_notification_revision: null,
      observation_revision: null,
      observation_feedback_revision: null,
    }], error: null }),
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const concealed = await service.loadTrackSummaries(["task-1"], "viewer-1", { force: true });
  assert.equal(concealed.tracks[0].observationSummaryVisible, false);
  assert.deepEqual(
    Object.fromEntries(Object.keys(EMPTY_REGISTRATION_OBSERVATION_SUMMARY).map((key) => [key, concealed.tracks[0][key]])),
    EMPTY_REGISTRATION_OBSERVATION_SUMMARY,
  );

  partial = true;
  await assert.rejects(
    service.loadTrackSummaries(["task-1"], "viewer-1", { force: true }),
    /registration_observation_summary_invalid/,
  );
});

test("generic summary reads fail closed before observation workflow states reach legacy UI", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler: () => ({ data: [{
      id: "track-1",
      task_id: "task-1",
      subject: "영어",
      pipeline_status: "visit_consultation_scheduled",
      workflow_status: "observation_requested",
      ...inertObservationSummaryRow,
    }], error: null }),
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  await assert.rejects(
    service.loadLegacyCompatibleTrackSummaries(["task-1"], "viewer-1"),
    /registration_observation_ui_not_ready/,
  );
});

test("track summary loader falls back to the pre-intake projection when only phone readiness columns are missing", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const missingPhoneReadinessColumn = {
    code: "42703",
    message: "column ops_registration_subject_track_summaries.phone_ready_at does not exist",
  };
  let invalidations = 0;
  const harness = createClient({
    queryHandler(query) {
      assert.equal(query.table, "ops_registration_subject_track_summaries");
      if (query.columns.includes("phone_ready_at")) {
        return { data: null, error: missingPhoneReadinessColumn };
      }
      return { data: [{
        id: "track-1", task_id: "task-1", subject: "영어",
        pipeline_status: "inquiry", director_profile_id: null,
        director_assignment_source: "", director_assignment_rule_key: "",
        waiting_kind: null, level_test_retake_decision: null,
        migration_review_required: false, stage_entered_at: "2026-07-12T01:00:00Z",
        updated_at: "2026-07-12T02:00:00Z",
        visit_scheduled_at: null, visit_place: null,
      }], error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    probeObservationRuntime: async () => ({ available: false, runtimeVersion: 0 }),
    invalidateRuntimeAfterReadyFailure(error) {
      invalidations += 1;
      const integrity = new Error("integrity");
      integrity.code = "REGISTRATION_RUNTIME_INTEGRITY_ERROR";
      integrity.cause = error;
      throw integrity;
    },
  }));

  const result = await service.loadTrackSummaries(["task-1"], "viewer-1");

  assert.equal(result.mode, "ready");
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0].id, "track-1");
  assert.equal(result.tracks[0].phoneReadyAt, null);
  assert.equal(result.tracks[0].phoneReadySource, null);
  assert.equal(invalidations, 0);
  assert.equal(harness.queries.length, 2);
  assert.match(harness.queries[0].columns, /phone_ready_at,phone_ready_source/);
  assert.doesNotMatch(harness.queries[1].columns, /phone_ready_at|phone_ready_source/);
  assert.deepEqual(harness.queries[1].filters, [["in", "task_id", ["task-1"]]]);
});

test("runtime-ready observation columns fail visibly instead of using an old projection", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const missingObservationColumn = {
    code: "42703",
    message: "column ops_registration_subject_track_summaries.observation_attempt_count does not exist",
  };
  let invalidations = 0;
  const harness = createClient({
    queryHandler: () => ({ data: null, error: missingObservationColumn }),
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    invalidateRuntimeAfterReadyFailure(error) {
      invalidations += 1;
      const integrity = new Error("integrity");
      integrity.code = "REGISTRATION_RUNTIME_INTEGRITY_ERROR";
      integrity.cause = error;
      throw integrity;
    },
  }));

  await assert.rejects(
    service.loadTrackSummaries(["task-1"], "viewer-1"),
    (error) => error.code === "REGISTRATION_RUNTIME_INTEGRITY_ERROR"
      && error.cause === missingObservationColumn,
  );
  assert.equal(invalidations, 1);
  assert.equal(harness.queries.length, 1);
  assert.match(harness.queries[0].columns, /observation_attempt_count/);
});

test("runtime-ready summary rows cannot omit the observation scalar payload", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler: () => ({ data: [{
      id: "track-1",
      task_id: "task-1",
      subject: "영어",
      pipeline_status: "inquiry",
      workflow_status: "observation_requested",
    }], error: null }),
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  await assert.rejects(
    service.loadTrackSummaries(["task-1"], "viewer-1"),
    /registration_observation_summary_invalid/,
  );
  assert.equal(harness.queries.length, 1);
  assert.match(harness.queries[0].columns, /observation_attempt_count/);
});

test("track summary loader does not fall back for an unrelated missing summary column", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const unrelatedMissingColumn = {
    code: "42703",
    message: "column ops_registration_subject_track_summaries.visit_place does not exist",
  };
  let invalidations = 0;
  const harness = createClient({
    queryHandler: () => ({ data: null, error: unrelatedMissingColumn }),
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    invalidateRuntimeAfterReadyFailure(error) {
      invalidations += 1;
      const integrity = new Error("integrity");
      integrity.code = "REGISTRATION_RUNTIME_INTEGRITY_ERROR";
      integrity.cause = error;
      throw integrity;
    },
  }));

  await assert.rejects(
    service.loadTrackSummaries(["task-1"], "viewer-1"),
    (error) => error.code === "REGISTRATION_RUNTIME_INTEGRITY_ERROR" && error.cause === unrelatedMissingColumn,
  );
  assert.equal(invalidations, 1);
  assert.equal(harness.queries.length, 1);
});

test("track summary loader embeds director names without a profile lookup waterfall", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      if (query.table === "profiles") {
        return { data: [{ id: "director-1", name: "강부희" }], error: null };
      }
      const embedsDirector = query.columns.includes(
        "director:profiles!ops_registration_subject_tracks_director_profile_id_fkey(id,name)",
      );
      return { data: ["track-1", "track-2"].map((id) => ({
        id, task_id: "task-1", subject: id === "track-1" ? "영어" : "수학",
        pipeline_status: "inquiry", director_profile_id: "director-1",
        director: embedsDirector ? { id: "director-1", name: "강부희" } : null,
        director_assignment_source: "default", director_assignment_rule_key: "rule",
        waiting_kind: null, level_test_retake_decision: null,
        migration_review_required: false, stage_entered_at: "2026-07-12T01:00:00Z",
        ...inertObservationSummaryRow,
      })), error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.loadTrackSummaries(["task-1"], "viewer-1");

  assert.deepEqual(result.tracks.map((track) => track.directorName), ["강부희", "강부희"]);
  assert.equal(harness.queries.length, 1);
  assert.match(
    harness.queries[0].columns,
    /director:profiles!ops_registration_subject_tracks_director_profile_id_fkey\(id,name\)/,
  );
});

test("workspace track summary loader reads all visible tracks without waiting for parent task ids", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      assert.equal(query.table, "ops_registration_subject_track_summaries");
      return { data: [{
        id: "track-1", task_id: "task-1", subject: "영어",
        pipeline_status: "inquiry", director_profile_id: null,
        director_assignment_source: "", director_assignment_rule_key: "",
        waiting_kind: null, level_test_retake_decision: null,
        migration_review_required: false, stage_entered_at: "2026-07-12T01:00:00Z",
        phone_ready_at: null, phone_ready_source: null,
        updated_at: "2026-07-12T01:00:00Z",
        visit_scheduled_at: null, visit_place: null,
        ...inertObservationSummaryRow,
      }], error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  assert.equal(typeof service.loadWorkspaceTrackSummaries, "function");
  const result = await service.loadWorkspaceTrackSummaries("viewer-1", { force: true });

  assert.deepEqual(result.tracks.map((track) => track.id), ["track-1"]);
  assert.equal(harness.queries.length, 1);
  assert.deepEqual(harness.queries[0].filters, []);
});

test("workspace track summary read overlaps a delayed runtime readiness check", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const runtimeGate = deferred();
  const harness = createClient({
    queryHandler(query) {
      assert.equal(query.table, "ops_registration_subject_track_summaries");
      return { data: [{
        id: "track-1", task_id: "task-1", subject: "영어",
        pipeline_status: "inquiry", director_profile_id: null,
        director_assignment_source: "", director_assignment_rule_key: "",
        waiting_kind: null, level_test_retake_decision: null,
        migration_review_required: false, stage_entered_at: "2026-07-12T01:00:00Z",
        phone_ready_at: null, phone_ready_source: null,
        updated_at: "2026-07-12T01:00:00Z",
        visit_scheduled_at: null, visit_place: null,
        ...inertObservationSummaryRow,
      }], error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    probeRuntime: () => runtimeGate.promise,
  }));

  const pending = service.loadWorkspaceTrackSummaries("viewer-1", { force: true });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.queries.length, 1);
  assert.deepEqual(harness.queries[0].filters, []);

  runtimeGate.resolve({ mode: "ready", version: 1 });
  const result = await pending;
  assert.deepEqual(result.tracks.map((track) => track.id), ["track-1"]);
});

test("legacy and maintenance are explicit and legacy summaries remain per subject", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  for (const state of [
    { mode: "legacy", version: 0 },
    { mode: "maintenance", version: 0 },
  ]) {
    const harness = createClient();
    const service = createRegistrationTrackService(harness.client, readyOptions({
      probeRuntime: async () => state,
    }));
    const result = await service.loadTrackSummaries(["task-1"], "viewer-1");
    assert.deepEqual({ mode: result.mode, tracks: [...result.tracks] }, { mode: state.mode, tracks: [] });
    assert.equal(harness.queries.length, 0);
  }

  const service = createRegistrationTrackService(createClient().client, readyOptions());
  const legacy = service.createLegacyTrackSummaries([{
    taskId: "task-1", subjects: ["영어", "수학"], status: "waiting",
    directorName: "강부희", stageEnteredAt: "2026-07-12T01:00:00Z",
  }]);
  assert.deepEqual(legacy.map((track) => [
    track.subject, track.legacy, track.phoneReadyAt, track.phoneReadySource,
  ]), [
    ["영어", true, null, null], ["수학", true, null, null],
  ]);
});

test("a missing child relation after ready invalidates and throws integrity instead of legacy fallback", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const missing = { code: "PGRST205", message: "relation disappeared" };
  let invalidations = 0;
  const harness = createClient({ queryHandler: () => ({ data: null, error: missing }) });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    invalidateRuntimeAfterReadyFailure(error) {
      invalidations += 1;
      const integrity = new Error("integrity");
      integrity.code = "REGISTRATION_RUNTIME_INTEGRITY_ERROR";
      integrity.cause = error;
      throw integrity;
    },
  }));

  await assert.rejects(
    service.loadTrackSummaries(["task-1"], "viewer-1"),
    (error) => error.code === "REGISTRATION_RUNTIME_INTEGRITY_ERROR" && error.cause === missing,
  );
  assert.equal(invalidations, 1);
});

test("case detail reads overlap a delayed runtime readiness check", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const runtimeGate = deferred();
  const harness = createClient({
    queryHandler(query) {
      return detailRows(query.table);
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    probeRuntime: () => runtimeGate.promise,
  }));

  const pending = service.loadCaseDetail("task-1", "viewer-1", { force: true });
  await Promise.resolve();

  try {
    assert.equal(harness.queries.length, 6);
    assert.deepEqual(harness.queries.map((query) => query.table).sort(), [
      "ops_registration_admission_batches",
      "ops_registration_appointments",
      "ops_registration_messages",
      "ops_registration_subject_tracks",
      "ops_task_events",
      "ops_tasks",
    ]);
  } finally {
    runtimeGate.resolve({ mode: "ready", version: 1 });
  }

  const detail = await pending;
  assert.equal(detail.task.id, "task-1");
  assert.deepEqual(detail.tracks.map((track) => track.id), ["track-1"]);
});

test("reminder summary is merged into the matching registration appointment", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      return detailRows(query.table);
    },
    rpcHandler(name, args) {
      assert.equal(name, "get_registration_customer_reminder_summaries_v1");
      assert.deepEqual({ ...args }, { p_task_id: "task-1" });
      return {
        data: [{
          appointment_id: "appointment-1",
          state: "scheduled",
          scheduled_for: "2026-07-13T01:00:00.000Z",
          sent_at: null,
          updated_at: "2026-07-12T02:00:00.000Z",
        }],
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const detail = await service.loadCaseDetail("task-1", "viewer-1", { force: true });

  assert.equal(harness.rpcCalls.length, 1);
  assert.deepEqual({ ...detail.appointments[0].customerReminder }, {
    state: "scheduled",
    scheduledFor: "2026-07-13T01:00:00.000Z",
    sentAt: null,
    updatedAt: "2026-07-12T02:00:00.000Z",
  });
});

test("case detail excludes observation rows at the server query boundary", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      return detailRowsWithObservationSecrets(query);
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  await service.loadCaseDetail("task-1", "viewer-1");

  assertCaseDetailUsesServerPrivacyFilters(harness);
});

test("generic case detail preserves nested observation-like and version20 history without booking secrets", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      return detailRowsWithObservationSecrets(query);
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const detail = await service.loadCaseDetail("task-1", "viewer-1");

  assertCaseDetailOmitsObservationSecrets(detail);
  assertCaseDetailUsesServerPrivacyFilters(harness);
});

test("observation-aware case detail preserves shared nested and malformed history behind manager detail", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      return detailRowsWithObservationSecrets(query);
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const detail = await service.loadCaseDetail("task-1", "viewer-1", {
    observationAware: true,
  });

  assert.equal(
    detail.tracks[0].observationSummaryVisible,
    true,
    "a visible manager summary remains available without embedding booking-only detail",
  );
  assertCaseDetailOmitsObservationSecrets(detail);
  assertCaseDetailUsesServerPrivacyFilters(harness);
});

test("dedicated manager detail preserves the observation schedule and place hidden from shared detail", async () => {
  const ids = {
    track: "71000000-0000-4000-8000-000000000001",
    task: "71000000-0000-4000-8000-000000000002",
    observation: "71000000-0000-4000-8000-000000000003",
    appointment: "71000000-0000-4000-8000-000000000004",
    class: "71000000-0000-4000-8000-000000000005",
    lesson: "71000000-0000-4000-8000-000000000006",
    teacherCatalog: "71000000-0000-4000-8000-000000000007",
    teacherProfile: "71000000-0000-4000-8000-000000000008",
    classroom: "71000000-0000-4000-8000-000000000009",
    director: "71000000-0000-4000-8000-000000000010",
  };
  const attempt = {
    observationId: ids.observation,
    taskId: ids.task,
    trackId: ids.track,
    appointmentId: ids.appointment,
    appointmentStatus: "scheduled",
    classId: ids.class,
    subject: "영어",
    className: "고1 영어 청강반",
    scheduleState: "active",
    sessionDate: "2026-08-14",
    startsAt: caseDetailObservationSecrets.scheduledAt,
    endsAt: "2026-08-14T10:37:00+09:00",
    teacherCatalogId: ids.teacherCatalog,
    teacherProfileId: ids.teacherProfile,
    teacherName: "강부희",
    classroomCatalogId: ids.classroom,
    classroomName: caseDetailObservationSecrets.place,
    campus: "본관",
    textbooks: [{ textbookId: null, title: "수업 자료", planLabel: "1과", memo: "" }],
    progress: "진도: 1과",
    bookingFactHash: "manager-detail-booking-fact",
    status: "scheduled",
    attendance: null,
    suitabilityResult: null,
    decisionKind: null,
    revision: 1,
    feedbackRevision: 0,
    appointmentNotificationRevision: 1,
    createdAt: "2026-08-10T02:00:00.000Z",
    updatedAt: "2026-08-10T02:00:00.000Z",
    sessionAuthority: "normalized",
    classLessonSessionId: ids.lesson,
    legacySessionKey: null,
    sessionKey: "2026-08-14:lesson-private",
    sessionSourceRevision: 3,
    legacySessionSourceHash: null,
    sourceRevision: {
      authority: "normalized",
      sessionId: ids.lesson,
      revision: 3,
    },
  };
  const payload = {
    track: {
      trackId: ids.track,
      taskId: ids.task,
      subject: "영어",
      workflowStatus: "observation_requested",
      workflowRevision: 4,
      observationReturnWorkflowStatus: "consultation_completed",
      directorProfileId: ids.director,
    },
    currentObservation: attempt,
    latestEnrollmentDecisionObservationId: null,
    latestDecisionObservation: null,
    attempts: [attempt],
    classes: [{ id: ids.class, name: "고1 영어 청강반", subject: "영어" }],
  };
  const calls = [];
  const client = {
    rpc(name, args) {
      calls.push({ name, args });
      const response = Promise.resolve({ data: payload, error: null });
      const request = {
        abortSignal() { return request; },
        retry() { return request; },
        then(resolve, reject) { return response.then(resolve, reject); },
      };
      return request;
    },
  };

  const detail = await loadRegistrationObservationManagerDetail(client, {
    trackId: ids.track,
  });

  assert.deepEqual(calls, [{
    name: "get_registration_observation_manager_detail_v1",
    args: { p_track_id: ids.track, p_attempt_limit: 20 },
  }]);
  assert.equal(detail.currentObservation.startsAt, caseDetailObservationSecrets.scheduledAt);
  assert.equal(detail.currentObservation.classroomName, caseDetailObservationSecrets.place);
  assert.equal(detail.attempts[0].startsAt, caseDetailObservationSecrets.scheduledAt);
  assert.equal(detail.attempts[0].classroomName, caseDetailObservationSecrets.place);
});

test("observation first lesson loader uses only the bounded enrollment-decision scalar and one correlated detail read", async () => {
  const trackId = "72000000-0000-4000-8000-000000000001";
  const observationId = "72000000-0000-4000-8000-000000000002";
  const decoyObservationId = "72000000-0000-4000-8000-000000000099";
  const managerCalls = [];
  const feedbackCalls = [];
  const detail = Object.freeze({ observationId, trackId, classId: "class-a" });
  const harness = createClient();
  const { createRegistrationTrackService } = await loadFactory({
    async loadRegistrationObservationManagerDetail(client, input) {
      managerCalls.push({ client, input });
      return {
        track: { trackId },
        latestEnrollmentDecisionObservationId: observationId,
        latestDecisionObservation: { observationId: decoyObservationId, decisionKind: "enrollment" },
        attempts: [{ observationId: decoyObservationId, decisionKind: "enrollment" }],
      };
    },
    async loadRegistrationObservationFeedback(client, requestedObservationId, options) {
      feedbackCalls.push({ client, requestedObservationId, options });
      return detail;
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({ requestTimeoutMs: 4321 }));

  const result = await service.loadRegistrationEnrollmentStartObservation({ trackId });

  assert.strictEqual(result, detail);
  assert.equal(managerCalls.length, 1);
  assert.strictEqual(managerCalls[0].client, harness.client);
  assert.deepEqual({ ...managerCalls[0].input }, { trackId, attemptLimit: 1 });
  assert.equal(feedbackCalls.length, 1);
  assert.strictEqual(feedbackCalls[0].client, harness.client);
  assert.equal(feedbackCalls[0].requestedObservationId, observationId);
  assert.deepEqual({ ...feedbackCalls[0].options }, { timeoutMs: 4321, force: true });
});

test("observation first lesson loader never scans attempts and fails closed on detail identity mismatch", async () => {
  const trackId = "73000000-0000-4000-8000-000000000001";
  const observationId = "73000000-0000-4000-8000-000000000002";
  const decoyObservationId = "73000000-0000-4000-8000-000000000003";
  let feedbackCalls = 0;
  const harness = createClient();

  const noScalarFactory = await loadFactory({
    async loadRegistrationObservationManagerDetail() {
      return {
        track: { trackId },
        latestEnrollmentDecisionObservationId: null,
        latestDecisionObservation: { observationId: decoyObservationId, decisionKind: "enrollment" },
        attempts: [{ observationId: decoyObservationId, decisionKind: "enrollment" }],
      };
    },
    async loadRegistrationObservationFeedback() {
      feedbackCalls += 1;
      return { observationId: decoyObservationId, trackId };
    },
  });
  const noScalarService = noScalarFactory.createRegistrationTrackService(harness.client, readyOptions());
  assert.equal(await noScalarService.loadRegistrationEnrollmentStartObservation({ trackId }), null);
  assert.equal(feedbackCalls, 0, "attempt rows cannot become the candidate identity");

  for (const mismatchedDetail of [
    { observationId: decoyObservationId, trackId },
    { observationId, trackId: "73000000-0000-4000-8000-000000000099" },
  ]) {
    const mismatchFactory = await loadFactory({
      async loadRegistrationObservationManagerDetail() {
        return {
          track: { trackId },
          latestEnrollmentDecisionObservationId: observationId,
          latestDecisionObservation: null,
          attempts: [],
        };
      },
      async loadRegistrationObservationFeedback() {
        feedbackCalls += 1;
        return mismatchedDetail;
      },
    });
    const mismatchService = mismatchFactory.createRegistrationTrackService(harness.client, readyOptions());
    assert.equal(await mismatchService.loadRegistrationEnrollmentStartObservation({ trackId }), null);
  }
  assert.equal(feedbackCalls, 2, "each non-null scalar performs exactly one dedicated detail read");
});

test("observation-aware detail is broad while default detail fails closed and cannot share its cache", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      if (query.table === "ops_registration_subject_track_summaries") {
        const track = detailRows("ops_registration_subject_tracks").data[0];
        return { data: [{
          ...track,
          workflow_status: "observation_requested",
          workflow_revision: 5,
          ...inertObservationSummaryRow,
        }], error: null };
      }
      const result = detailRows(query.table);
      if (query.table === "ops_registration_subject_tracks") {
        return {
          ...result,
          data: result.data.map((row) => ({
            ...row,
            workflow_status: "observation_requested",
            workflow_revision: 5,
            observation_attempt_count: 0,
          })),
        };
      }
      return result;
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const broad = await service.loadCaseDetail("task-1", "viewer-1", {
    observationAware: true,
  });
  assert.equal(broad.tracks[0].workflowStatus, "observation_requested");
  assert.equal(broad.tracks[0].workflowRevision, 5);
  assert.equal(broad.tracks[0].observationSummaryVisible, true);
  assert.equal(
    harness.queries.filter((query) => query.table === "ops_registration_subject_track_summaries").length,
    1,
    "the one persisted counter cannot stand in for the complete summary-view tuple",
  );

  await assert.rejects(
    service.loadCaseDetail("task-1", "viewer-1"),
    /registration_observation_ui_not_ready/,
  );
  assert.equal(
    harness.queries.filter((query) => query.table === "ops_registration_subject_tracks").length,
    2,
    "narrow and broad detail reads must have separate cache identities",
  );
});

test("observation-aware detail fails closed when its required summary row is missing", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      if (query.table === "ops_registration_subject_track_summaries") {
        return { data: [], error: null };
      }
      return detailRows(query.table);
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  await assert.rejects(
    service.loadCaseDetail("task-1", "viewer-1", { observationAware: true }),
    /registration_observation_summary_invalid/,
  );
  assert.equal(
    harness.queries.filter((query) => query.table === "ops_registration_subject_track_summaries").length,
    1,
  );
});

test("a stalled case-detail read times out and a forced retry can start fresh", async () => {
  const { createRegistrationTrackService } = await loadFactory({ setTimeout, clearTimeout });
  const stalledEvents = deferred();
  let shouldStallEvents = true;
  const harness = createClient({
    queryHandler(query) {
      if (query.table === "ops_task_events" && shouldStallEvents) return stalledEvents.promise;
      return detailRows(query.table);
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    requestTimeoutMs: 5,
  }));
  const firstDetail = service.loadCaseDetail("task-1", "viewer-1", { force: true });

  assert.strictEqual(service.loadCaseDetail("task-1", "viewer-1"), firstDetail);

  const outcome = await Promise.race([
    firstDetail.then(
      () => ({ kind: "resolved" }),
      (error) => ({ kind: "rejected", error }),
    ),
    new Promise((resolve) => setTimeout(() => resolve({ kind: "still_pending" }), 30)),
  ]);

  assert.equal(outcome.kind, "rejected");
  assert.equal(outcome.error?.code, "REGISTRATION_REQUEST_TIMEOUT");
  assert.match(outcome.error?.message || "", /registration_query_timeout/);

  shouldStallEvents = false;
  const detail = await service.loadCaseDetail("task-1", "viewer-1", { force: true });
  assert.equal(detail.task.id, "task-1");
  assert.equal(harness.queries.filter((query) => query.table === "ops_task_events").length, 2);
  stalledEvents.resolve(detailRows("ops_task_events"));
  await Promise.resolve();
  assert.strictEqual(await service.loadCaseDetail("task-1", "viewer-1"), detail);
  assert.equal(harness.queries.length, 12);
});

test("a stalled appointment cancellation returns control to the editor", async () => {
  const { createRegistrationTrackService } = await loadFactory({ setTimeout, clearTimeout });
  const stalledCancellation = deferred();
  const harness = createClient({
    rpcHandler(name) {
      if (name === "cancel_registration_appointment") return stalledCancellation.promise;
      return { data: { ok: true }, error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({ requestTimeoutMs: 5 }));

  const outcome = await Promise.race([
    service.cancelRegistrationAppointment({
      appointmentId: "appointment-1",
      expectedNotificationRevision: 1,
      reason: "예약 취소",
      requestKey: "cancel-request-key",
    }).then(
      () => ({ kind: "resolved" }),
      (error) => ({ kind: "rejected", error }),
    ),
    new Promise((resolve) => setTimeout(() => resolve({ kind: "still_pending" }), 30)),
  ]);

  assert.equal(outcome.kind, "rejected");
  assert.equal(outcome.error?.code, "REGISTRATION_REQUEST_TIMEOUT");
  assert.match(outcome.error?.message || "", /registration_mutation_timeout/);
  assert.deepEqual(harness.rpcCalls.map(([name]) => name), ["cancel_registration_appointment"]);
});

test("a runtime-probe failure aborts the parallel case-detail reads", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const stalledReads = deferred();
  const runtimeError = new Error("registration_runtime_probe_timeout");
  runtimeError.code = "REGISTRATION_REQUEST_TIMEOUT";
  const harness = createClient({
    queryHandler: () => stalledReads.promise,
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    probeRuntime: async () => { throw runtimeError; },
    requestTimeoutMs: 50,
  }));

  await assert.rejects(
    service.loadCaseDetail("task-1", "viewer-1", { force: true }),
    (error) => error === runtimeError,
  );
  assert.equal(harness.queries.length, 6);
  assert.equal(harness.getAbortedQueryCount(), 6);
});

test("detail loader embeds track children in six scoped reads, maps rows, and shares same-viewer in-flight work", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const gate = deferred();
  let first = true;
  const harness = createClient({
    queryHandler(query) {
      if (first) {
        first = false;
        return gate.promise.then(() => detailRows(query.table));
      }
      return detailRows(query.table);
    },
  });
  const measures = [];
  const performanceCalls = [];
  const service = createRegistrationTrackService(harness.client, readyOptions({
    performance: {
      mark: (name) => performanceCalls.push(["mark", name]),
      measure: (name, start, end) => performanceCalls.push(["measure", name, start, end]),
    },
    recordMeasure: (entry) => measures.push({ ...entry }),
  }));

  const left = service.loadCaseDetail("task-1", "viewer-1");
  const right = service.loadCaseDetail("task-1", "viewer-1");
  assert.strictEqual(left, right);
  gate.resolve();
  const detail = await left;

  assert.equal(harness.queries.length, 6);
  assert.equal(detail.commonRevision, 3);
  assert.equal(detail.tracks[0].directorName, "강부희");
  assert.equal(detail.tracks[0].phoneReadyAt, "2026-07-12T01:00:00Z");
  assert.equal(detail.tracks[0].phoneReadySource, "inquiry");
  assert.equal(detail.admissionApplicationMessageStatus, "failed_hold");
  assert.equal(detail.admissionApplicationMessageClaimActive, true);
  assert.equal(detail.admissionApplicationAccepted, false);
  assert.equal(detail.levelTests[0].materialLink, "https://drive.test/test");
  assert.equal(detail.consultations[0].appointmentId, null);
  assert.equal(detail.consultations[0].readyAt, "2026-07-12T01:00:00Z");
  assert.equal(detail.consultations[0].readySource, "level_test_completion");
  assert.equal(detail.enrollments[0].textbookId, null);
  assert.equal(detail.events[0].eventType, "consultation_completed");
  assert.equal(detail.events[0].trackId, "track-1");
  assert.deepEqual({ ...detail.events[0].metadata }, { consultationId: "consultation-1" });
  assert.equal(detail.events[1].eventType, "future_event");
  assert.equal(detail.events[1].legacyText, "plain future history");

  const events = harness.queries.find((query) => query.table === "ops_task_events");
  assert.deepEqual(events.filters, [
    ["eq", "task_id", "task-1"],
    ["eq", "registration_task_event_shared_visible", true],
  ]);
  assert.ok(!events.filters.some((filter) => filter[0] === "in" && filter[1] === "event_type"));
  const messages = harness.queries.find((query) => query.table === "ops_registration_messages");
  assert.deepEqual(messages.filters, [
    ["eq", "task_id", "task-1"],
    ["eq", "template_key", "admission_application"],
    ["eq", "claim_active", true],
  ]);
  assert.equal(messages.limit, 1);
  const tracks = harness.queries.find((query) => query.table === "ops_registration_subject_tracks");
  assert.deepEqual(tracks.filters, [
    ["eq", "task_id", "task-1"],
    ["is", "archived_at", null],
  ]);
  assert.match(tracks.columns, /level_tests:ops_registration_level_tests\(\*\)/);
  assert.match(tracks.columns, /consultations:ops_registration_consultations\(\*\)/);
  assert.match(tracks.columns, /enrollments:ops_registration_enrollments\(\*\)/);
  assert.equal(harness.queries.some((query) => [
    "ops_registration_level_tests", "ops_registration_consultations", "ops_registration_enrollments",
  ].includes(query.table)), false);
  assert.deepEqual(measures, [{ name: "registration:case-detail", cacheHit: false, queryCount: 7, ok: true }]);
  assert.ok(performanceCalls.some((entry) => entry[0] === "measure" && entry[1] === "registration:case-detail"));

  const cached = await service.loadCaseDetail("task-1", "viewer-1");
  assert.strictEqual(cached, detail);
  assert.equal(harness.queries.length, 6);
  assert.deepEqual(measures.at(-1), {
    name: "registration:case-detail", cacheHit: true, queryCount: 0, ok: true,
  });
  const detailPerformanceMeasures = performanceCalls.filter((entry) => entry[0] === "measure" && entry[1] === "registration:case-detail");
  assert.equal(detailPerformanceMeasures.length, 2);
  assert.notEqual(detailPerformanceMeasures[0][2], detailPerformanceMeasures[1][2]);
  assert.notEqual(detailPerformanceMeasures[0][3], detailPerformanceMeasures[1][3]);
});

test("detail caches are viewer-scoped, rejected reads are removed, and clear ignores stale completions", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  let fail = true;
  const harness = createClient({
    queryHandler(query) {
      if (fail) return { data: null, error: new Error("temporary") };
      return detailRows(query.table);
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  await assert.rejects(service.loadCaseDetail("task-1", "viewer-1"), /temporary/);
  fail = false;
  await service.loadCaseDetail("task-1", "viewer-1");
  const afterViewerOne = harness.queries.length;
  await service.loadCaseDetail("task-1", "viewer-2");
  assert.equal(harness.queries.length, afterViewerOne + 6);

  service.clearCaches();
  await service.loadCaseDetail("task-1", "viewer-1");
  assert.equal(harness.queries.length, afterViewerOne + 12);
});

test("registration option loader starts five reads, includes schools, excludes students and inactive rows", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const gates = new Map(["profiles", "classes", "textbooks", "teacher_catalogs", "academic_schools"].map((table) => [table, deferred()]));
  const rows = {
    profiles: [{ id: "director-1", name: "강부희", email: "director@test", role: "admin", login_id: "director" }],
    classes: [
      { id: "class-1", name: "고1 영어", subject: "영어", grade: "고1", teacher: "교사", room: "1", textbook_ids: ["book-1"], status: "운영" },
      { id: "class-2", name: "폐강", subject: "영어", grade: "고1", teacher: "교사", room: "2", textbook_ids: [], status: "폐강" },
    ],
    textbooks: [
      { id: "book-1", title: "교재", publisher: "출판사", subject: "영어", status: "사용" },
      { id: "book-2", title: "미사용", publisher: "출판사", subject: "영어", status: "미사용" },
    ],
    teacher_catalogs: [{ id: "teacher-1", name: "교사", subjects: ["영어"], is_visible: true, sort_order: 1, profile_id: "director-1", account_email: "director@test" }],
    academic_schools: [
      { id: "school-high-2", name: "한빛고", category: "highschool", sort_order: 2 },
      { id: "school-high-1", name: "가람고", category: "high", sort_order: 1 },
    ],
  };
  const harness = createClient({
    queryHandler(query) {
      return gates.get(query.table).promise.then(() => ({ data: rows[query.table], error: null }));
    },
  });
  const measures = [];
  const service = createRegistrationTrackService(harness.client, readyOptions({
    recordMeasure: (entry) => measures.push({ ...entry }),
  }));

  const load = service.loadWorkspaceOptionData({ viewerId: "viewer-1" });
  await Promise.resolve();
  assert.equal(harness.getMaxActiveQueries(), 5);
  assert.deepEqual(harness.queries.map((query) => query.table).sort(), [
    "academic_schools", "classes", "profiles", "teacher_catalogs", "textbooks",
  ]);
  assert.ok(!harness.queries.some((query) => query.table === "students"));
  for (const query of harness.queries) {
    assert.doesNotMatch(query.columns, /schedule_plan|student_ids|waitlist_ids/);
  }
  for (const gate of gates.values()) gate.resolve();
  const result = await load;

  assert.equal(result.directorCatalogStatus, "authoritative");
  assert.equal(result.students.length, 0);
  assert.deepEqual(Array.from(result.classes, (row) => row.id), ["class-1"]);
  assert.deepEqual(Array.from(result.textbooks, (row) => row.id), ["book-1"]);
  assert.deepEqual(Array.from(result.schools, (school) => ({ ...school })), [
    { id: "school-high-2", name: "한빛고", category: "highschool", sortOrder: 2 },
    { id: "school-high-1", name: "가람고", category: "high", sortOrder: 1 },
  ]);
  assert.equal(result.schoolCatalogStatus, "authoritative");
  assert.equal(result.schoolCatalogError, null);
  assert.equal(harness.queries.find((query) => query.table === "academic_schools").columns, "id,name,category,sort_order");
  assert.deepEqual(measures, [{
    name: "registration:option-summary", cacheHit: false, queryCount: 5, ok: true,
  }]);
});

test("assigned science consultation class loader filters canonical inactive rows and bounds its consultation cache", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  let now = 1_000;
  const harness = createClient({
    queryHandler(query) {
      assert.equal(query.table, "classes");
      return {
        data: [
          { id: "science-active", name: "고1 과학", subject: "과학", grade: "고1", teacher: "과학교사", room: "4", status: "운영" },
          { id: "science-ended", name: "종강 과학", subject: "과학", grade: "고2", teacher: "과학교사", room: "5", status: "종료" },
          { id: "science-archived", name: "보관 과학", subject: "과학", grade: "고3", teacher: "과학교사", room: "7", status: "종강" },
          { id: "math-leak", name: "수학", subject: "수학", grade: "고1", teacher: "수학교사", room: "6", status: "운영" },
        ],
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({ now: () => now }));

  const first = await service.loadAssignedScienceConsultationClassOptions({ viewerId: "science-teacher", consultationId: "consultation-1" });
  const cached = await service.loadAssignedScienceConsultationClassOptions({ viewerId: "science-teacher", consultationId: "consultation-1" });

  assert.strictEqual(cached, first);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), [{
    id: "science-active",
    label: "고1 과학",
    meta: "고1 · 과학교사",
    subject: "과학",
    grade: "고1",
    teacher: "과학교사",
    room: "4",
    schedule: "",
    studentIds: [],
    waitlistIds: [],
    textbookIds: [],
  }]);
  assert.equal(harness.queries.length, 1);
  assert.equal(harness.queries[0].columns, "id,name,subject,grade,teacher,room,status");
  assert.deepEqual(harness.queries[0].filters, [["eq", "subject", "과학"]]);
  assert.equal(harness.rpcCalls.length, 0);

  now += 60_001;
  await service.loadAssignedScienceConsultationClassOptions({ viewerId: "science-teacher", consultationId: "consultation-1" });
  assert.equal(harness.queries.length, 2);
  await service.loadAssignedScienceConsultationClassOptions({ viewerId: "science-teacher", consultationId: "consultation-2" });
  assert.equal(harness.queries.length, 3, "같은 viewer라도 다른 상담은 별도 cache key를 사용한다");
  await service.loadAssignedScienceConsultationClassOptions({ viewerId: "science-teacher", consultationId: "consultation-1", force: true });
  assert.equal(harness.queries.length, 4);
  await assert.rejects(
    async () => service.loadAssignedScienceConsultationClassOptions({ viewerId: "", consultationId: "consultation-1" }),
    /non-empty viewer ID/i,
  );
  await assert.rejects(
    async () => service.loadAssignedScienceConsultationClassOptions({ viewerId: "science-teacher", consultationId: "" }),
    /non-empty consultation ID/i,
  );
  assert.equal(harness.queries.length, 4, "viewer 또는 assigned 상담이 없으면 class request를 만들지 않는다");
});

test("option fallback is partial, option errors are explicit, and failed measures still close", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const measures = [];
  const missingColumn = { code: "42703", message: "column is missing" };
  const harness = createClient({
    queryHandler(query) {
      if (query.table === "teacher_catalogs" && query.columns.includes("profile_id")) {
        return { data: null, error: missingColumn };
      }
      return { data: [], error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    recordMeasure: (entry) => measures.push({ ...entry }),
  }));
  const partial = await service.loadWorkspaceOptionData({ viewerId: "viewer-1" });
  assert.equal(partial.directorCatalogStatus, "partial");
  assert.equal(partial.schemaReady, true);

  const denied = new Error("permission denied");
  const deniedHarness = createClient({
    queryHandler(query) {
      if (query.table === "profiles") return { data: null, error: denied };
      return { data: [], error: null };
    },
  });
  const deniedMeasures = [];
  const deniedService = createRegistrationTrackService(deniedHarness.client, readyOptions({
    recordMeasure: (entry) => deniedMeasures.push({ ...entry }),
  }));
  const result = await deniedService.loadWorkspaceOptionData({ viewerId: "viewer-2" });
  assert.equal(result.directorCatalogStatus, "error");
  assert.equal(result.schemaReady, false);
  assert.match(result.error, /permission denied/);
  assert.deepEqual(deniedMeasures, [{
    name: "registration:option-summary", cacheHit: false, queryCount: 5, ok: true,
  }]);
});

test("school catalog failure does not fail required registration options", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({ queryHandler(query) {
    if (query.table === "academic_schools") return { data: null, error: new Error("school denied") };
    return { data: [], error: null };
  } });
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const result = await service.loadWorkspaceOptionData({ viewerId: "viewer-1" });
  assert.equal(result.schemaReady, true);
  assert.equal(result.error, null);
  assert.equal(result.schoolCatalogStatus, "error");
  assert.match(result.schoolCatalogError, /school denied/);
  assert.deepEqual(Array.from(result.schools), []);
});

test("all authenticated Task 3 wrappers use exact RPC names, stable keys, and nullable UUIDs", async () => {
  const { createRegistrationTrackService, createRegistrationMutationRequestKey } = await loadFactory();
  const enrollmentRow = {
    id: "enrollment-1", track_id: "track-1", student_id: null,
    admission_batch_id: "batch-1", class_id: "class-1", textbook_id: null,
    class_start_date: null, class_start_session_key: null, class_start_session: null,
    status: "enrolled", makeedu_registered: true, roster_active: true,
    roster_released_at: null, roster_release_reason: null,
    roster_release_source_task_id: null, roster_release_kind: null, sort_order: 0,
  };
  const harness = createClient({
    rpcHandler(name) {
      if (name === "save_registration_enrollment_rows") {
        return { data: { track_id: "track-1", rows: [enrollmentRow] }, error: null };
      }
      if (name === "complete_registration_admission_batch") {
        return { data: {
          batch: { id: "batch-1", task_id: "task-1", revision_number: 1, status: "completed", invoice_sent_at: "i", payment_confirmed_at: "p", created_at: "c", updated_at: "u" },
          enrollments: [enrollmentRow],
        }, error: null };
      }
      if (name === "complete_registration_consultation") {
        return { data: {
          consultation: { id: "consultation-1", status: "completed", outcome: "waiting" },
          track: { id: "track-1", task_id: "task-1", subject: "영어", pipeline_status: "waiting" },
        }, error: null };
      }
      return { data: { ok: true }, error: null };
    },
  });
  let mutationInvalidations = 0;
  const service = createRegistrationTrackService(harness.client, readyOptions({
    onMutationSuccess: () => { mutationInvalidations += 1; },
  }));
  const key = "request-key";

  await service.createRegistrationCase({ studentName: "김다미", schoolGrade: "고1", schoolName: "중앙여고", parentPhone: "01012345678", studentPhone: "", campus: "본관", inquiryAt: "2026-07-12T01:00:00Z", subjects: ["영어", "수학"], requestNote: "", priority: "normal", requestKey: key });
  await service.syncRegistrationCaseSubjects({ taskId: "task-1", subjects: ["영어"], requestKey: key });
  await service.updateRegistrationCaseCommon({ taskId: "task-1", studentName: "김다미", schoolGrade: "고1", schoolName: "", parentPhone: "01012345678", studentPhone: "", campus: "본관", inquiryAt: "   ", requestNote: "", priority: "normal", expectedCommonRevision: 3, requestKey: key });
  await service.routeRegistrationInquiry({ trackId: "track-1", destination: "waiting", waitingKind: "current_term_opening", classId: "", requestKey: key });
  await service.assignRegistrationTrackDirector({ trackId: "track-1", directorProfileId: "", assignmentSource: "manual", ruleKey: "", expectedCommonRevision: 3, requestKey: key });
  await service.saveRegistrationSharedAppointment({ appointmentId: "", taskId: "task-1", kind: "level_test", scheduledAt: "2026-07-13T01:00:00Z", place: "본관", trackIds: ["track-1"], replaceRemaining: false, expectedNotificationRevision: 0, requestKey: key });
  await service.cancelRegistrationAppointment({ appointmentId: "appointment-1", expectedNotificationRevision: 1, reason: "변경", requestKey: key });
  await service.startRegistrationLevelTestAttempt({ attemptId: "attempt-1", requestKey: key });
  await service.completeRegistrationLevelTestAttempt({ attemptId: "attempt-1", status: "completed", materialLink: "https://drive.test", requestKey: key });
  await service.closeRegistrationLevelTestTrack({ trackId: "track-1", reason: "종료", requestKey: key });
  await service.completeRegistrationConsultation({ consultationId: "consultation-1", outcome: "waiting", waitingKind: "next_term_opening", classId: "", requestKey: key });
  await service.transitionRegistrationWaiting({ trackId: "track-1", action: "change_waiting_kind", waitingKind: "current_term_opening", classId: "", retakeDecision: "", reason: "", requestKey: key });
  await service.routeRegistrationEnrollmentDecision({ trackId: "track-1", destination: "waiting", waitingKind: "current_term_opening", classId: "", reason: "", requestKey: key });
  const saved = await service.saveRegistrationEnrollmentRows({ trackId: "track-1", rows: [{ id: "", classId: "class-1", textbookId: "", classStartDate: "", classStartSessionKey: "", classStartLessonSessionId: "10000000-0000-4000-8000-000000000011", classStartSession: "", sortOrder: 0 }], requestKey: key });
  await service.claimRegistrationAdmissionMessage({ taskId: "task-1", messageRequestKey: "message-key" });
  await service.reconcileRegistrationAdmissionMessage({ messageId: "message-1", resolution: "accepted", providerEvidence: { observedState: "accepted", providerMessageId: "provider-1" }, reason: "확인", requestKey: key });
  await service.releaseRegistrationAdmissionMessageRetry({ messageId: "message-1", providerEvidence: { observedState: "closed", lookupRequestKey: "message-key" }, reason: "재발송", requestKey: key });
  await service.markRegistrationAdmissionNoticeSent({ taskId: "task-1", messageRequestKey: "message-key", requestKey: key });
  await service.startRegistrationAdmissionBatch({ taskId: "task-1", trackIds: ["track-1"], enrollmentIds: ["enrollment-1"], requestKey: key });
  await service.setRegistrationEnrollmentMakeedu({ enrollmentId: "enrollment-1", registered: true, requestKey: key });
  await service.advanceRegistrationAdmissionBatch({ batchId: "batch-1", action: "invoice_sent", requestKey: key });
  await service.cancelRegistrationAdmissionBatch({ batchId: "batch-1", resolutions: [], reason: "취소", requestKey: key });
  const completed = await service.completeRegistrationAdmissionBatch({ batchId: "batch-1", requestKey: key });
  await service.cancelRegistrationEnrollment({ enrollmentId: "enrollment-1", destination: "", waitingKind: "", classId: "", reason: "취소", requestKey: key });
  await service.resolveRegistrationMigrationReview({ taskId: "task-1", assignments: [], trackStates: [], requestKey: key });
  await service.reopenRegistrationTrack({ trackId: "track-1", destination: "inquiry", reason: "재개", requestKey: key });
  await service.setStudentClassRosterMode({ studentId: "student-1", classId: "class-1", nextMode: "enrolled", expectedMode: "removed", memo: "등록" });

  assert.deepEqual(harness.rpcCalls.map(([name]) => name), [
    "create_registration_case", "sync_registration_case_subjects", "update_registration_case_common",
    "route_registration_inquiry", "assign_registration_track_director",
    "save_registration_appointment_details_v1", "cancel_registration_appointment",
    "start_registration_level_test_attempt", "complete_registration_level_test_attempt",
    "close_registration_level_test_track", "complete_registration_consultation",
    "transition_registration_waiting", "route_registration_enrollment_decision",
    "save_registration_enrollment_rows", "claim_registration_admission_message",
    "reconcile_registration_admission_message", "release_registration_admission_message_retry",
    "mark_registration_admission_notice_sent", "start_registration_admission_batch",
    "set_registration_enrollment_makeedu", "advance_registration_admission_batch",
    "cancel_registration_admission_batch", "complete_registration_admission_batch",
    "cancel_registration_enrollment", "resolve_registration_migration_review",
    "reopen_registration_track", "set_student_class_roster_mode",
  ]);
  assert.equal(harness.rpcCalls[4][1].p_director_profile_id, null);
  assert.equal(harness.rpcCalls[2][1].p_school_name, null);
  assert.equal(harness.rpcCalls[2][1].p_student_phone, null);
  assert.equal(harness.rpcCalls[2][1].p_inquiry_at, null);
  assert.equal(harness.rpcCalls[2][1].p_request_note, null);
  assert.equal(harness.rpcCalls[5][1].p_appointment_id, null);
  assert.equal(harness.rpcCalls[10][1].p_class_id, null);
  assert.equal(harness.rpcCalls[13][1].p_rows[0].id, null);
  assert.equal(harness.rpcCalls[13][1].p_rows[0].textbookId, null);
  assert.equal(harness.rpcCalls[13][1].p_rows[0].classStartLessonSessionId, "10000000-0000-4000-8000-000000000011");
  assert.equal(JSON.stringify(harness.rpcCalls[24][1].p_assignments), JSON.stringify({ assignments: [], trackStates: [] }));
  assert.equal("p_track_states" in harness.rpcCalls[24][1], false);
  assert.equal(harness.rpcCalls[23][1].p_destination, null);
  assert.equal(saved.rows[0].trackId, "track-1");
  assert.equal(saved.rows[0].textbookId, null);
  assert.equal(completed.batch.taskId, "task-1");
  assert.equal(completed.enrollments[0].makeeduRegistered, true);
  assert.equal(createRegistrationMutationRequestKey("save", "track-1"), "save:track-1:uuid-from-crypto");
  assert.equal(mutationInvalidations, 27, "every successful registration RPC must invalidate parent consumers");
});

test("enrollment save omits a legacy schedule identifier from the normalized lesson-session field", async () => {
  // Production break caught: a legacy schedule's non-UUID identifier reaches
  // the enrollment RPC and is rejected as registration_enrollment_rows_invalid.
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name) {
      assert.equal(name, "save_registration_enrollment_rows");
      return { data: { track_id: "track-1", rows: [] }, error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  await service.saveRegistrationEnrollmentRows({
    trackId: "track-1",
    rows: [{
      classId: "10000000-0000-4000-8000-000000000001",
      classStartDate: "2026-08-19",
      classStartSessionKey: "legacy:2026-08-19:1",
      classStartLessonSessionId: "legacy:2026-08-19:1",
      classStartSession: "1회차",
      sortOrder: 0,
    }],
    requestKey: "enrollment-legacy-session-id",
  });

  assert.equal(harness.rpcCalls[0][1].p_rows[0].classStartLessonSessionId, null);
});

test("admission completion uses the injected post-commit public cache invalidator", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const enrollment = {
    id: "enrollment-1", track_id: "track-1", student_id: null,
    admission_batch_id: "batch-1", class_id: "class-1", textbook_id: null,
    class_start_date: null, class_start_session_key: null, class_start_session: null,
    status: "enrolled", makeedu_registered: true, roster_active: true,
    roster_released_at: null, roster_release_reason: null,
    roster_release_source_task_id: null, roster_release_kind: null, sort_order: 0,
  };
  const harness = createClient({
    rpcHandler(name) {
      assert.equal(name, "complete_registration_admission_batch");
      return {
        data: {
          batch: { id: "batch-1", task_id: "task-1", revision_number: 1, status: "completed", invoice_sent_at: "i", payment_confirmed_at: "p", created_at: "c", updated_at: "u" },
          enrollments: [enrollment],
        },
        error: null,
      };
    },
  });
  const calls = [];
  const service = createRegistrationTrackService(harness.client, readyOptions({
    invalidatePublicClassesCacheAfterMutation: async (client, reason) => {
      calls.push([client, reason]);
      return { status: "pending", reason, requestId: "refresh-1" };
    },
  }));

  const result = await service.completeRegistrationAdmissionBatch({
    batchId: "batch-1",
    requestKey: "complete-batch",
  });

  assert.deepEqual(calls, [[harness.client, "class"]]);
  assert.deepEqual(result.publicClassesCacheRefresh, {
    status: "pending", reason: "class", requestId: "refresh-1",
  });
});

test("first lesson source serialization sends regular sentinel as null and maps the exact response key", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const sourceObservationId = "74000000-0000-4000-8000-000000000001";
  const persistedSourceObservationId = "74000000-0000-4000-8000-000000000002";
  const rows = [{
    classId: "74000000-0000-4000-8000-000000000010",
    textbookId: null,
    classStartDate: "2026-08-17",
    classStartSessionKey: "legacy:2026-08-17:1",
    classStartLessonSessionId: null,
    classStartSession: "청강 회차",
    classStartSourceObservationId: sourceObservationId,
    sortOrder: 0,
  }, {
    classId: "74000000-0000-4000-8000-000000000020",
    textbookId: null,
    classStartDate: "2026-08-24",
    classStartSessionKey: "regular:2026-08-24:2",
    classStartLessonSessionId: "74000000-0000-4000-8000-000000000021",
    classStartSession: "2회차",
    classStartSourceObservationId: "",
    sortOrder: 1,
  }];
  const harness = createClient({
    rpcHandler(name, args) {
      assert.equal(name, "save_registration_enrollment_details_v1");
      return { data: {
        trackId: "74000000-0000-4000-8000-000000000030",
        rows: args.p_rows.map((row, index) => index === 0
          ? { ...row, classStartSourceObservationId: persistedSourceObservationId }
          : row),
      }, error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.saveRegistrationEnrollmentDetails({
    trackId: "74000000-0000-4000-8000-000000000030",
    rows,
    requestKey: "first-lesson-source",
  });

  assert.equal(harness.rpcCalls[0][1].p_rows[0].classStartSourceObservationId, sourceObservationId);
  assert.equal(harness.rpcCalls[0][1].p_rows[1].classStartSourceObservationId, null);
  assert.equal(result.rows[0].classStartSourceObservationId, persistedSourceObservationId, "response hydration owns the reopened source id");
  assert.equal(result.rows[1].classStartSourceObservationId, null);
  assert.equal(result.rows[0].classStartSessionKey, "legacy:2026-08-17:1");
});

test("registration core legacy bridge reads only stable source event IDs", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name, args) {
      assert.equal(name, "list_registration_legacy_source_ids_v1");
      assert.deepEqual({ ...args }, { p_task_id: "task-1" });
      return {
        data: {
          taskId: "task-1",
          sourceEventIds: ["event-1", "event-2", "", null],
          title: "must-not-leak",
        },
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  assert.deepEqual(
    Array.from(await service.listRegistrationLegacySourceIds("task-1")),
    ["event-1", "event-2"],
  );
  assert.equal(harness.queries.length, 0);
});

test("consultation completion maps canonical readiness from camel-case RPC rows", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name) {
      assert.equal(name, "complete_registration_consultation");
      return {
        data: {
          consultation: {
            id: "consultation-1",
            trackId: "track-1",
            appointmentId: null,
            mode: "phone",
            status: "completed",
            directorProfileId: "director-1",
            readyAt: "2026-07-12T01:00:00Z",
            readySource: "track_reopened",
            completedAt: "2026-07-12T03:00:00Z",
            outcome: "enrollment",
            createdAt: "2026-07-12T01:30:00Z",
            updatedAt: "2026-07-12T03:00:00Z",
          },
          track: {
            id: "track-1",
            taskId: "task-1",
            subject: "영어",
            status: "enrollment_decided",
            directorProfileId: "director-1",
            directorAssignmentSource: "default",
            directorAssignmentRuleKey: "english:2026:high1",
            waitingKind: "",
            levelTestRetakeDecision: "",
            migrationReviewRequired: false,
            stageEnteredAt: "2026-07-12T03:00:00Z",
            phoneReadyAt: "2026-07-12T01:00:00Z",
            phoneReadySource: "director_resolved",
          },
        },
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.completeRegistrationConsultation({
    consultationId: "consultation-1",
    outcome: "enrollment",
    waitingKind: "",
    classId: "",
    requestKey: "consultation-key",
  });

  assert.equal(result.consultation.readyAt, "2026-07-12T01:00:00Z");
  assert.equal(result.consultation.readySource, "track_reopened");
  assert.equal(result.track.phoneReadyAt, "2026-07-12T01:00:00Z");
  assert.equal(result.track.phoneReadySource, "director_resolved");
});

test("initial workflow create uses the exact atomic payload and maps the complete response", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const notificationTargets = [{ appointmentId: "appointment-visit", notificationRevision: 1 }];
  const response = {
    taskId: "task-new",
    commonRevision: 1,
    subjects: ["영어", "수학"],
    tracks: [
      {
        id: "track-english",
        task_id: "task-new",
        subject: "영어",
        pipeline_status: "consultation_waiting",
        director_profile_id: "director-1",
        director_assignment_source: "default",
        director_assignment_rule_key: "english:2026:high1",
        waiting_kind: null,
        level_test_retake_decision: null,
        migration_review_required: false,
        stage_entered_at: "2026-07-12T01:00:00Z",
        phone_ready_at: "2026-07-12T01:00:00Z",
        phone_ready_source: "inquiry",
      },
      {
        id: "track-math",
        taskId: "task-new",
        subject: "수학",
        status: "visit_consultation_scheduled",
        directorProfileId: "director-2",
        directorAssignmentSource: "manual",
        directorAssignmentRuleKey: "override",
        waitingKind: "current_term_opening",
        levelTestRetakeDecision: "required",
        migrationReviewRequired: false,
        stageEnteredAt: "2026-07-12T02:00:00Z",
        phoneReadyAt: null,
        phoneReadySource: "future_source",
      },
    ],
    appointments: [
      {
        id: "appointment-level",
        task_id: "task-new",
        kind: "level_test",
        scheduled_at: "2026-07-14T01:00:00Z",
        place: "본관",
        status: "scheduled",
        notification_revision: 0,
        created_at: "2026-07-12T01:00:00Z",
        updated_at: "2026-07-12T01:00:00Z",
      },
      {
        id: "appointment-visit",
        taskId: "task-new",
        kind: "visit_consultation",
        scheduledAt: "2026-07-15T02:00:00Z",
        place: "상담실",
        status: "scheduled",
        notificationRevision: 1,
        createdAt: "2026-07-12T01:00:00Z",
        updatedAt: "2026-07-12T01:00:00Z",
      },
    ],
    notificationTargets,
  };
  const harness = createClient({
    rpcHandler(name) {
      assert.equal(name, "create_registration_case_with_initial_workflow_v1");
      return { data: response, error: null };
    },
  });
  let mutationInvalidations = 0;
  const service = createRegistrationTrackService(harness.client, readyOptions({
    onMutationSuccess: () => { mutationInvalidations += 1; },
  }));
  const input = {
    studentName: "김다미",
    schoolGrade: "고1",
    schoolName: "중앙여고",
    parentPhone: "01012345678",
    studentPhone: "01087654321",
    campus: "본관",
    inquiryAt: "2026-07-12T01:00:00Z",
    subjects: ["영어", "수학"],
    requestNote: "상담 요청",
    priority: "high",
    subjectPlans: { 영어: "level_test", 수학: "visit" },
    levelTestAppointment: {
      scheduledAt: "2026-07-14T01:00:00Z",
      place: "본관",
      subjects: ["영어"],
    },
    visitAppointment: {
      scheduledAt: "2026-07-15T02:00:00Z",
      place: "상담실",
      subjects: ["수학"],
    },
    directorOverrides: { 수학: "director-2" },
    requestKey: "  intake-request-key  ",
  };

  const result = await service.createRegistrationCaseWithInitialWorkflow(input);
  const [rpcName, rpcArgs] = harness.rpcCalls[0];

  assert.equal(rpcName, "create_registration_case_with_initial_workflow_v1");
  assert.deepEqual(Object.keys(rpcArgs), [
    "p_student_name",
    "p_school_grade",
    "p_school_name",
    "p_parent_phone",
    "p_student_phone",
    "p_campus",
    "p_inquiry_at",
    "p_subjects",
    "p_request_note",
    "p_priority",
    "p_subject_plans",
    "p_level_test_appointment",
    "p_visit_appointment",
    "p_director_overrides",
    "p_request_key",
  ]);
  assert.deepEqual({ ...rpcArgs }, {
    p_student_name: input.studentName,
    p_school_grade: input.schoolGrade,
    p_school_name: input.schoolName,
    p_parent_phone: input.parentPhone,
    p_student_phone: input.studentPhone,
    p_campus: input.campus,
    p_inquiry_at: input.inquiryAt,
    p_subjects: input.subjects,
    p_request_note: input.requestNote,
    p_priority: input.priority,
    p_subject_plans: input.subjectPlans,
    p_level_test_appointment: input.levelTestAppointment,
    p_visit_appointment: input.visitAppointment,
    p_director_overrides: input.directorOverrides,
    p_request_key: "intake-request-key",
  });
  assert.equal(result.taskId, "task-new");
  assert.equal(result.commonRevision, 1);
  assert.deepEqual(Array.from(result.subjects), ["영어", "수학"]);
  assert.deepEqual(Array.from(result.tracks, (track) => ({ ...track })), [
    {
      id: "track-english",
      taskId: "task-new",
      subject: "영어",
      status: "consultation_waiting",
      workflowStatus: "consultation_requested",
      workflowRevision: 1,
      workflowStatusEnteredAt: "",
      legacy: false,
      directorProfileId: "director-1",
      directorName: "",
      directorAssignmentSource: "default",
      directorAssignmentRuleKey: "english:2026:high1",
      waitingKind: "",
      waitingDetailKind: "",
      waitingDetailClassId: null,
      waitingDetailRetakeDecision: "",
      levelTestRetakeDecision: "",
      migrationReviewRequired: false,
      stageEnteredAt: "2026-07-12T01:00:00Z",
      phoneReadyAt: "2026-07-12T01:00:00Z",
      phoneReadySource: "inquiry",
      ...EMPTY_REGISTRATION_OBSERVATION_SUMMARY,
    },
    {
      id: "track-math",
      taskId: "task-new",
      subject: "수학",
      status: "visit_consultation_scheduled",
      workflowStatus: "consultation_requested",
      workflowRevision: 1,
      workflowStatusEnteredAt: "",
      legacy: false,
      directorProfileId: "director-2",
      directorName: "",
      directorAssignmentSource: "manual",
      directorAssignmentRuleKey: "override",
      waitingKind: "current_term_opening",
      waitingDetailKind: "",
      waitingDetailClassId: null,
      waitingDetailRetakeDecision: "",
      levelTestRetakeDecision: "required",
      migrationReviewRequired: false,
      stageEnteredAt: "2026-07-12T02:00:00Z",
      phoneReadyAt: null,
      phoneReadySource: null,
      ...EMPTY_REGISTRATION_OBSERVATION_SUMMARY,
    },
  ]);
  assert.deepEqual(Array.from(result.appointments, (appointment) => ({ ...appointment })), [
    {
      id: "appointment-level",
      taskId: "task-new",
      kind: "level_test",
      scheduledAt: "2026-07-14T01:00:00Z",
      place: "본관",
      status: "scheduled",
      notificationRevision: 0,
      createdAt: "2026-07-12T01:00:00Z",
      updatedAt: "2026-07-12T01:00:00Z",
    },
    {
      id: "appointment-visit",
      taskId: "task-new",
      kind: "visit_consultation",
      scheduledAt: "2026-07-15T02:00:00Z",
      place: "상담실",
      status: "scheduled",
      notificationRevision: 1,
      createdAt: "2026-07-12T01:00:00Z",
      updatedAt: "2026-07-12T01:00:00Z",
    },
  ]);
  assert.strictEqual(result.notificationTargets, notificationTargets);
  assert.equal(mutationInvalidations, 1);
});

test("atomic initial workflow create rechecks both exact runtime markers before the business RPC", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const cases = [
    {
      name: "subject version 2",
      options: { probeRuntime: async () => ({ mode: "ready", version: 2 }) },
    },
    {
      name: "intake version 2",
      options: { probeIntakeRuntime: async () => ({ available: true, version: 2 }) },
    },
    {
      name: "malformed intake marker",
      options: { probeIntakeRuntime: async () => ({ available: true, version: "1" }) },
    },
    {
      name: "contradictory intake marker",
      options: { probeIntakeRuntime: async () => ({ available: false, version: 1 }) },
    },
    {
      name: "rejected intake probe",
      options: { probeIntakeRuntime: async () => { throw new Error("permission denied") } },
    },
  ];

  for (const entry of cases) {
    const harness = createClient();
    const service = createRegistrationTrackService(harness.client, readyOptions(entry.options));
    await assert.rejects(
      service.createRegistrationCaseWithInitialWorkflow(initialWorkflowCreateInput()),
      undefined,
      entry.name,
    );
    assert.equal(harness.rpcCalls.length, 0, `${entry.name} must not call the business RPC`);
  }
});

test("atomic initial workflow create constrains only level-test places before RPC", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient();
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const levelTestInput = {
    ...initialWorkflowCreateInput(),
    subjectPlans: { 영어: "level_test" },
    levelTestAppointment: {
      scheduledAt: "2026-07-18T01:00:00Z",
      place: "본관 201호",
      subjects: ["영어"],
    },
  };

  await assert.rejects(
    service.createRegistrationCaseWithInitialWorkflow(levelTestInput),
    /registration_level_test_place_invalid/,
  );
  assert.equal(harness.rpcCalls.length, 0);

  await service.createRegistrationCaseWithInitialWorkflow({
    ...levelTestInput,
    levelTestAppointment: { ...levelTestInput.levelTestAppointment, place: "  별관  " },
  });
  assert.equal(harness.rpcCalls[0][1].p_level_test_appointment.place, "별관");

  await service.createRegistrationCaseWithInitialWorkflow({
    ...initialWorkflowCreateInput(),
    subjectPlans: { 영어: "visit" },
    levelTestAppointment: null,
    visitAppointment: {
      scheduledAt: "2026-07-18T02:00:00Z",
      place: "본관 201호",
      subjects: ["영어"],
    },
    requestKey: "visit-free-text",
  });
  assert.equal(harness.rpcCalls[1][1].p_visit_appointment.place, "본관 201호");
});

test("receipt keys are required and maintenance blocks every new mutation before RPC", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient();
  const ready = createRegistrationTrackService(harness.client, readyOptions());

  await assert.rejects(
    ready.updateRegistrationCaseCommon({ requestKey: "   " }),
    /request key/i,
  );
  await assert.rejects(
    ready.createRegistrationCaseWithInitialWorkflow({ requestKey: "   " }),
    /request key/i,
  );
  await assert.rejects(
    ready.claimRegistrationAdmissionMessage({ taskId: "task-1", messageRequestKey: "" }),
    /message request key/i,
  );
  assert.equal(harness.rpcCalls.length, 0);

  const maintenance = createRegistrationTrackService(harness.client, readyOptions({
    probeRuntime: async () => ({ mode: "maintenance", version: 0 }),
  }));
  await assert.rejects(
    maintenance.reopenRegistrationTrack({ trackId: "track-1", destination: "inquiry", reason: "재개", requestKey: "key" }),
    /데이터 전환 중/,
  );
  assert.equal(harness.rpcCalls.length, 0);
});

test("Notion-style fact mutations bypass runtime readiness while process mutations stay guarded", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  let runtimeProbeCalls = 0;
  const harness = createClient({
    rpcHandler(name) {
      if (name === "create_registration_case") {
        return { data: { taskId: "task-1", commonRevision: 1, tracks: [] }, error: null };
      }
      if (name === "sync_registration_case_subjects") {
        return { data: { taskId: "task-1", subjects: [], tracks: [] }, error: null };
      }
      if (name === "update_registration_case_common") {
        return { data: { taskId: "task-1", commonRevision: 2 }, error: null };
      }
      if (name === "set_registration_workflow_status_v1") {
        return { data: {
          trackId: "track-1",
          workflowStatus: "inquiry",
          workflowRevision: 2,
          workflowStatusEnteredAt: "2026-09-01T10:00:00Z",
          enrollmentFinalization: null,
        }, error: null };
      }
      return { data: {}, error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    probeRuntime: async () => {
      runtimeProbeCalls += 1;
      throw new Error("runtime probe unavailable");
    },
  }));

  await service.createRegistrationCase({
    studentName: "", schoolGrade: "", schoolName: "", parentPhone: "", studentPhone: "",
    campus: "", inquiryAt: "", subjects: [], requestNote: "", priority: "normal", requestKey: "fact-create",
  });
  await service.updateRegistrationCaseCommon({
    taskId: "task-1", studentName: "", schoolGrade: "", schoolName: "", parentPhone: "", studentPhone: "",
    campus: "", inquiryAt: "", requestNote: "", priority: "normal", expectedCommonRevision: 1, requestKey: "fact-common",
  });
  await service.syncRegistrationCaseSubjects({ taskId: "task-1", subjects: [], requestKey: "fact-subjects" });
  await service.setRegistrationWorkflowStatus({
    trackId: "track-1", workflowStatus: "inquiry", expectedWorkflowRevision: 1, requestKey: "fact-status",
  });

  assert.equal(runtimeProbeCalls, 0);
  assert.deepEqual(harness.rpcCalls.map(([name]) => name), [
    "create_registration_case",
    "update_registration_case_common",
    "sync_registration_case_subjects",
    "set_registration_workflow_status_v1",
  ]);
  assert.equal(harness.rpcCalls[0][1].p_inquiry_at, null, "blank create inquiryAt must be sent as SQL null");
  assert.equal(harness.rpcCalls[1][1].p_inquiry_at, null, "blank common inquiryAt must be sent as SQL null");

  await assert.rejects(
    service.reopenRegistrationTrack({ trackId: "track-1", destination: "inquiry", reason: "재개", requestKey: "process" }),
    /runtime probe unavailable/,
  );
  assert.equal(runtimeProbeCalls, 1);
});

test("inquiry datetime-local facts are serialized as Seoul instants", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name) {
      if (name === "create_registration_case") {
        return { data: { taskId: "task-1", commonRevision: 1, tracks: [] }, error: null };
      }
      return { data: { taskId: "task-1", commonRevision: 2 }, error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  await service.createRegistrationCase({
    studentName: "", schoolGrade: "", schoolName: "", parentPhone: "", studentPhone: "",
    campus: "", inquiryAt: "2026-09-01T18:49", subjects: [], requestNote: "", priority: "normal", requestKey: "create-local-time",
  });
  await service.updateRegistrationCaseCommon({
    taskId: "task-1", studentName: "", schoolGrade: "", schoolName: "", parentPhone: "", studentPhone: "",
    campus: "", inquiryAt: "2026-09-01T18:49", requestNote: "", priority: "normal", expectedCommonRevision: 1, requestKey: "update-local-time",
  });

  assert.equal(harness.rpcCalls[0][1].p_inquiry_at, "2026-09-01T09:49:00.000Z");
  assert.equal(harness.rpcCalls[1][1].p_inquiry_at, "2026-09-01T09:49:00.000Z");
});

test("all cached registration reads require an authenticated viewer id", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient();
  const service = createRegistrationTrackService(harness.client, readyOptions());

  assert.throws(
    () => service.loadTrackSummaries(["task-1"], ""),
    /viewer id/i,
  );
  assert.throws(
    () => service.loadCaseDetail("task-1", "   "),
    /viewer id/i,
  );
  assert.throws(
    () => service.loadWorkspaceOptionData({ viewerId: "" }),
    /viewer id/i,
  );
  assert.equal(harness.queries.length, 0);
});

test("appointment creation and director default clearing send nullable canonical values", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient();
  const service = createRegistrationTrackService(harness.client, readyOptions());

  await service.saveRegistrationSharedAppointment({
    appointmentId: null,
    taskId: "task-1",
    kind: "level_test",
    scheduledAt: "2026-07-13T01:00:00Z",
    place: "본관",
    trackIds: ["track-1"],
    replaceRemaining: false,
    expectedNotificationRevision: null,
    requestKey: "appointment-key",
  });
  await service.assignRegistrationTrackDirector({
    trackId: "track-1",
    directorProfileId: null,
    assignmentSource: "clear_default",
    ruleKey: null,
    expectedCommonRevision: 3,
    requestKey: "director-key",
  });

  assert.equal(harness.rpcCalls[0][1].p_appointment_id, null);
  assert.equal(harness.rpcCalls[0][1].p_expected_notification_revision, null);
  assert.deepEqual({ ...harness.rpcCalls[1][1] }, {
    p_track_id: "track-1",
    p_director_profile_id: null,
    p_assignment_source: "clear_default",
    p_rule_key: null,
    p_expected_common_revision: 3,
    p_request_key: "director-key",
  });

  const source = await readServiceSource();
  assert.match(source, /expectedNotificationRevision: number \| null/);
  assert.match(source, /appointmentId: string \| null/);
  assert.match(source, /assignmentSource: "default" \| "manual" \| "clear_default"/);
  assert.match(source, /directorProfileId: string \| null/);
  assert.match(source, /ruleKey: string \| null/);
});

test("registration mutations explicitly disable PostgREST automatic retries", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const retryArguments = [];
  const rpcCalls = [];
  const client = {
    from() {
      throw new Error("unexpected table read");
    },
    rpc(name, args) {
      rpcCalls.push([name, args]);
      const response = Promise.resolve({ data: { ok: true }, error: null });
      const builder = {
        retry(enabled) {
          retryArguments.push(enabled);
          return builder;
        },
        then(resolve, reject) {
          return response.then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const service = createRegistrationTrackService(client, readyOptions());

  await service.assignRegistrationTrackDirector({
    trackId: "track-1",
    directorProfileId: "profile-1",
    assignmentSource: "default",
    ruleKey: "academic-director-v1:2026:영어:중1",
    expectedCommonRevision: 2,
    requestKey: "director-default-key",
  });

  assert.deepEqual(rpcCalls.map(([name]) => name), ["assign_registration_track_director"]);
  assert.deepEqual(retryArguments, [false]);
});

test("appointment save constrains only level-test places", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient();
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const common = {
    appointmentId: null,
    taskId: "task-1",
    scheduledAt: "2026-07-13T01:00:00Z",
    trackIds: ["track-1"],
    replaceRemaining: false,
    expectedNotificationRevision: null,
    requestKey: "appointment-key",
  };

  await assert.rejects(
    service.saveRegistrationSharedAppointment({
      ...common,
      kind: "level_test",
      place: "본관 201호",
    }),
    /registration_level_test_place_invalid/,
  );
  assert.equal(harness.rpcCalls.length, 0);

  await service.saveRegistrationSharedAppointment({
    ...common,
    kind: "visit_consultation",
    place: "본관 201호",
  });
  assert.equal(harness.rpcCalls[0][1].p_place, "본관 201호");
});

test("incomplete profile or teacher identity makes the director catalog partial", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      if (query.table === "profiles") {
        return { data: [{ id: "profile-1", name: "강부희", email: "", role: "", login_id: "" }], error: null };
      }
      if (query.table === "teacher_catalogs") {
        return { data: [{
          id: "teacher-1", name: "교사", subjects: ["영어"], is_visible: true,
          sort_order: 1, profile_id: null, account_email: "",
        }], error: null };
      }
      return { data: [], error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.loadWorkspaceOptionData({ viewerId: "viewer-1" });

  assert.equal(result.directorCatalogStatus, "partial");
  assert.equal(result.schemaReady, true);
});

test("a forced detail refresh cannot be overwritten by the stale request it superseded", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const staleGate = deferred();
  const freshGate = deferred();
  let queryNumber = 0;
  const harness = createClient({
    queryHandler(query) {
      queryNumber += 1;
      const base = detailRows(query.table);
      const stalePhaseOne = queryNumber <= 6;
      const freshPhaseOne = queryNumber > 6 && queryNumber <= 12;
      const gate = stalePhaseOne ? staleGate : freshPhaseOne ? freshGate : null;
      const title = stalePhaseOne || queryNumber > 15 ? "stale title" : "fresh title";
      const result = query.table === "ops_tasks"
        ? { ...base, data: { ...base.data, title } }
        : base;
      return gate ? gate.promise.then(() => result) : result;
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const stale = service.loadCaseDetail("task-1", "viewer-1");
  await Promise.resolve();
  const fresh = service.loadCaseDetail("task-1", "viewer-1", { force: true });
  await Promise.resolve();
  freshGate.resolve();
  assert.equal((await fresh).task.title, "fresh title");
  staleGate.resolve();
  assert.equal((await stale).task.title, "stale title");

  const queryCount = harness.queries.length;
  const cached = await service.loadCaseDetail("task-1", "viewer-1");
  assert.equal(cached.task.title, "fresh title");
  assert.equal(harness.queries.length, queryCount);
});

test("public service source exposes typed aliases and excludes server-only or cross-workflow RPCs", async () => {
  const source = await readServiceSource();
  for (const typeName of [
    "OpsRegistrationTrackSummary", "OpsRegistrationCaseDetail", "OpsRegistrationAppointment",
    "OpsRegistrationLevelTest", "OpsRegistrationConsultation", "OpsRegistrationAdmissionBatch",
    "OpsRegistrationEnrollment", "OpsRegistrationTrackEvent", "RegistrationCommonUpdateResponse",
    "RegistrationAdmissionMessageClaimResponse", "RegistrationAdmissionProviderEvidence",
    "RegistrationAppointmentMutationResponse", "RegistrationEnrollmentRowsSaveResponse",
    "RegistrationConsultationCompletionResponse", "RegistrationAdmissionBatchCompletionResponse",
    "RegistrationPhoneReadySource", "RegistrationCaseCreateWithInitialWorkflowInput",
    "RegistrationCaseCreateWithInitialWorkflowResponse", "StudentClassRosterModeResponse",
  ]) {
    assert.match(source, new RegExp(`export type ${typeName}`));
  }
  assert.doesNotMatch(source, /FinalizationResponse|finalize_registration_admission_message/);
  assert.doesNotMatch(source, /complete_ops_withdrawal_roster_transition|complete_ops_transfer_roster_transition/);
  assert.match(source, /export \{ probeRegistrationSubjectTrackRuntime \}/);
  assert.match(source, /export \{\s*probeRegistrationIntakeWorkflowRuntime,\s*resetRegistrationIntakeWorkflowRuntimeProbe,?\s*\}/);
  assert.match(source, /export type \{ RegistrationIntakeRuntimeState \}/);
  assert.match(source, /phoneReadyAt: string \| null/);
  assert.match(source, /phoneReadySource: RegistrationPhoneReadySource \| null/);
  assert.match(source, /readyAt: string \| null/);
  assert.match(source, /readySource: RegistrationPhoneReadySource \| null/);
  assert.match(source, /export function createRegistrationCaseWithInitialWorkflow/);
});

test("science registration database contract preserves public RPC signatures and fail-closed capability writes", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260722100000_registration_science_subject.sql", import.meta.url),
    "utf8",
  );
  const pgTap = await readFile(
    new URL("../supabase/tests/registration_science_subject_test.sql", import.meta.url),
    "utf8",
  );

  assert.match(
    migration,
    /create or replace function public\.create_registration_case_with_initial_workflow_v1\(\s*p_student_name text,[\s\S]*?p_request_key text[\s\S]*?returns jsonb/,
  );
  assert.match(
    migration,
    /create or replace function public\.save_registration_shared_appointment\(\s*p_appointment_id uuid,\s*p_task_id uuid,[\s\S]*?p_request_key text[\s\S]*?returns jsonb/,
  );
  assert.match(
    migration,
    /create or replace function dashboard_private\.create_registration_case_impl\([\s\S]*?registration_subject_unsupported[\s\S]*?assert_registration_subject_enabled/,
  );
  assert.match(
    migration,
    /create or replace function dashboard_private\.sync_registration_case_subjects_impl\([\s\S]*?registration_subject_unsupported[\s\S]*?assert_registration_subject_enabled/,
  );
  assert.match(
    migration,
    /update_registration_case_common_impl[\s\S]*?exists \([\s\S]*?subject = '과학'[\s\S]*?registration_science_grade_invalid/,
  );
  assert.match(migration, /target_fingerprint/);
  assert.match(migration, /dashboard_private\.ops_registration_mutations/);
  assert.match(migration, /idempotency_key_reused/);
  assert.match(migration, /v_legacy_target_fingerprint jsonb/);
  assert.equal(
    [...migration.matchAll(/v_legacy_target_fingerprint jsonb/g)].length,
    2,
  );
  assert.equal(
    [...migration.matchAll(/v_legacy_target_fingerprint is not null/g)].length,
    2,
  );
  assert.match(
    migration,
    /mutation\.target_fingerprint = v_target_fingerprint[\s\S]*?mutation\.target_fingerprint = v_legacy_target_fingerprint/,
  );
  assert.match(pgTap, /science-legacy-create-replay/);
  assert.match(pgTap, /science-legacy-sync-replay/);
  assert.match(pgTap, /'subjects', '\["\uc218\ud559", "\uc601\uc5b4"\]'::jsonb/);
  assert.match(migration, /registration_subject_removed/);
  assert.match(migration, /write_registration_track_event_v2/);
});

test("unified inquiry save performs one sorted atomic RPC request", async () => {
  const { createRegistrationTrackService } = await loadFactory()
  const harness = createClient({
    rpcHandler(name) {
      assert.equal(name, "save_registration_case_inquiry_v1")
      return {
        data: {
          taskId: "task-1",
          commonRevision: 4,
          tracks: [
            { id: "track-english", task_id: "task-1", subject: "영어", pipeline_status: "inquiry" },
            { id: "track-math", task_id: "task-1", subject: "수학", pipeline_status: "inquiry" },
          ],
        },
        error: null,
      }
    },
  })
  const service = createRegistrationTrackService(harness.client, readyOptions())
  const subjects = ["수학", "영어"]
  const expectedSubjects = ["수학", "영어"]

  const result = await service.saveRegistrationCaseInquiry({
    taskId: "task-1",
    studentName: "김다미",
    schoolGrade: "고1",
    schoolName: "중앙여고",
    parentPhone: "01012345678",
    studentPhone: "",
    campus: "본관",
    inquiryAt: "2026-07-12T01:00:00Z",
    requestNote: "통합 저장",
    priority: "normal",
    subjects,
    expectedCommonRevision: 3,
    expectedSubjects,
    requestKey: "unified-inquiry-save",
  })

  assert.equal(harness.rpcCalls.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(harness.rpcCalls[0])), ["save_registration_case_inquiry_v1", {
    p_task_id: "task-1",
    p_student_name: "김다미",
    p_school_grade: "고1",
    p_school_name: "중앙여고",
    p_parent_phone: "01012345678",
    p_student_phone: null,
    p_campus: "본관",
    p_inquiry_at: "2026-07-12T01:00:00Z",
    p_request_note: "통합 저장",
    p_priority: "normal",
    p_expected_common_revision: 3,
    p_expected_subjects: ["영어", "수학"],
    p_subjects: ["영어", "수학"],
    p_request_key: "unified-inquiry-save",
  }])
  assert.deepEqual(subjects, ["수학", "영어"])
  assert.deepEqual(expectedSubjects, ["수학", "영어"])
  assert.deepEqual(result.tracks.map((track) => track.subject), ["영어", "수학"])
})

test("waiting details use their dedicated nullable data-only RPC", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name, args) {
      assert.equal(name, "save_registration_waiting_details_v2");
      assert.deepEqual({ ...args }, {
        p_track_id: "track-1",
        p_waiting_kind: "current_class",
        p_class_id: "10000000-0000-4000-8000-000000000010",
        p_retake_decision: "required",
        p_request_key: "waiting-details-request",
      });
      return { data: { trackId: "track-1", waitingKind: "current_class", classId: "10000000-0000-4000-8000-000000000010", retakeDecision: "required" }, error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.saveRegistrationWaitingDetails({
    trackId: "track-1",
    waitingKind: "current_class",
    classId: "10000000-0000-4000-8000-000000000010",
    retakeDecision: "required",
    requestKey: "waiting-details-request",
  });

  assert.deepEqual({ ...result }, {
    trackId: "track-1",
    waitingKind: "current_class",
    classId: "10000000-0000-4000-8000-000000000010",
    retakeDecision: "required",
  });
});

test("waiting details persist an explicit clear as nullable RPC input", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name, args) {
      assert.equal(name, "save_registration_waiting_details_v2");
      assert.deepEqual({ ...args }, {
        p_track_id: "track-1",
        p_waiting_kind: null,
        p_class_id: null,
        p_retake_decision: null,
        p_request_key: "waiting-clear-request",
      });
      return { data: { trackId: "track-1", waitingKind: null, classId: null, retakeDecision: null }, error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.saveRegistrationWaitingDetails({
    trackId: "track-1",
    waitingKind: "",
    classId: "",
    retakeDecision: "",
    requestKey: "waiting-clear-request",
  });

  assert.deepEqual({ ...result }, {
    trackId: "track-1",
    waitingKind: "",
    classId: "",
    retakeDecision: "",
  });
});

test("level-test results use their dedicated data-only RPC", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name, args) {
      assert.equal(name, "save_registration_level_test_result_v1");
      assert.deepEqual({ ...args }, {
        p_attempt_id: "attempt-1",
        p_status: "completed",
        p_material_link: "https://drive.test/result",
        p_request_key: "result-request",
      });
      return { data: { attemptId: "attempt-1", trackId: "track-1", status: "completed", materialLink: "https://drive.test/result" }, error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.saveRegistrationLevelTestResult({
    attemptId: "attempt-1",
    status: "completed",
    materialLink: "https://drive.test/result",
    requestKey: "result-request",
  });

  assert.deepEqual({ ...result }, {
    attemptId: "attempt-1",
    trackId: "track-1",
    status: "completed",
    materialLink: "https://drive.test/result",
  });
});

test("consultation records use their dedicated data-only RPC", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name, args) {
      assert.equal(name, "save_registration_consultation_details_v1");
      assert.deepEqual({ ...args }, {
        p_consultation_id: "consultation-1",
        p_status: "completed",
        p_outcome: "waiting",
        p_note: "보호자가 다음 학기 반을 요청함",
        p_request_key: "consultation-details-request",
      });
      return { data: { consultationId: "consultation-1", trackId: "track-1", status: "completed", outcome: "waiting", note: "보호자가 다음 학기 반을 요청함" }, error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.saveRegistrationConsultationDetails({
    consultationId: "consultation-1",
    status: "completed",
    outcome: "waiting",
    note: "보호자가 다음 학기 반을 요청함",
    requestKey: "consultation-details-request",
  });

  assert.deepEqual({ ...result }, {
    consultationId: "consultation-1",
    trackId: "track-1",
    status: "completed",
    outcome: "waiting",
    note: "보호자가 다음 학기 반을 요청함",
  });
});
