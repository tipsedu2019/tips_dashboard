import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

const serviceUrl = new URL(
  "../src/features/tasks/registration-track-service.ts",
  import.meta.url,
);

async function readServiceSource() {
  return readFile(serviceUrl, "utf8");
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
    `${factorySource}\nmodule.exports = { createRegistrationTrackService, createRegistrationMutationRequestKey, buildRegistrationMigrationLegacySnapshot, mapTrackEvent };`,
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
    crypto: { randomUUID: () => "uuid-from-crypto" },
    ...extraGlobals,
  });
  return sandboxModule.exports;
}

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
      select(columns, options) {
        query.columns = columns;
        query.options = options;
        return fluent;
      },
      eq(column, value) {
        query.filters.push(["eq", column, value]);
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
    getMaxActiveQueries: () => maxActiveQueries,
    client: {
      from: builder,
      async rpc(name, args) {
        rpcCalls.push([name, args]);
        return rpcHandler?.(name, args) ?? { data: { ok: true }, error: null };
      },
    },
  };
}

function readyOptions(overrides = {}) {
  return {
    probeRuntime: async () => ({ mode: "ready", version: 1 }),
    probeIntakeRuntime: async () => ({ available: true, version: 1 }),
    invalidateRuntimeAfterReadyFailure(error) {
      const integrityError = new Error("runtime integrity failure");
      integrityError.code = "REGISTRATION_RUNTIME_INTEGRITY_ERROR";
      integrityError.cause = error;
      throw integrityError;
    },
    now: () => 1,
    randomUUID: () => "uuid-from-options",
    ...overrides,
  };
}

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
  };

  const first = await service.loadRegistrationAppointmentCalendarRows(input);
  const second = await service.loadRegistrationAppointmentCalendarRows(input);

  assert.deepEqual(JSON.parse(JSON.stringify(first)), [row]);
  assert.deepEqual(JSON.parse(JSON.stringify(second)), [row]);
  assert.equal(harness.queries.length, 2, "calendar range results must not use a cross-viewer cache");
  for (const query of harness.queries) {
    assert.equal(
      query.columns,
      "appointment_id,task_id,student_name,kind,scheduled_at,place,status,notification_revision,track_ids,subjects",
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

test("calendar raw loader normalizes explicit statuses and skips an explicit empty selection", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient();
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const range = {
    rangeStart: "2026-07-01T00:00:00+09:00",
    rangeEnd: "2026-08-01T00:00:00+09:00",
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
    { rangeStart: "invalid", rangeEnd: "2026-08-01T00:00:00+09:00" },
    { rangeStart: "2026-08-01T00:00:00+09:00", rangeEnd: "2026-08-01T00:00:00+09:00" },
    { rangeStart: "2026-07-01T00:00:00+09:00", rangeEnd: "2026-08-01T00:00:00+09:00", statuses: ["waiting"] },
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

test("track summary loader uses the exact safe projection and skips profile lookup without directors", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      assert.equal(query.table, "ops_registration_subject_track_summaries");
      return { data: [{
        id: "track-1", task_id: "task-1", subject: "영어",
        pipeline_status: "visit_consultation_scheduled", director_profile_id: null,
        director_assignment_source: "", director_assignment_rule_key: "",
        waiting_kind: null, level_test_retake_decision: null,
        migration_review_required: false, stage_entered_at: "2026-07-12T01:00:00Z",
        phone_ready_at: null, phone_ready_source: null,
        visit_scheduled_at: "2026-07-13T01:00:00Z", visit_place: "상담실",
        updated_at: "2026-07-12T02:00:00Z",
      }], error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.loadTrackSummaries(["task-1"], "viewer-1");

  assert.equal(result.mode, "ready");
  assert.deepEqual({ ...result.tracks[0] }, {
    id: "track-1", taskId: "task-1", subject: "영어",
    status: "visit_consultation_scheduled", legacy: false, directorProfileId: null,
    directorName: "", directorAssignmentSource: "", directorAssignmentRuleKey: "",
    waitingKind: "", levelTestRetakeDecision: "", migrationReviewRequired: false,
    stageEnteredAt: "2026-07-12T01:00:00Z",
    phoneReadyAt: null, phoneReadySource: null,
    visitScheduledAt: "2026-07-13T01:00:00Z", visitPlace: "상담실",
  });
  assert.equal(harness.queries.length, 1);
  assert.equal(harness.queries[0].columns,
    "id,task_id,subject,pipeline_status,director_profile_id,director_assignment_source,director_assignment_rule_key,waiting_kind,level_test_retake_decision,migration_review_required,stage_entered_at,phone_ready_at,phone_ready_source,updated_at,visit_scheduled_at,visit_place");
  assert.deepEqual(harness.queries[0].filters, [["in", "task_id", ["task-1"]]]);
  assert.doesNotMatch(harness.queries[0].columns, /schedule_plan|textbook|student_ids|waitlist_ids/);
  assert.doesNotMatch(harness.queries[0].columns, /consultations|appointments|\*/);
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

test("track summary loader deduplicates directors into one narrow profile lookup", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      if (query.table === "profiles") {
        return { data: [{ id: "director-1", name: "강부희" }], error: null };
      }
      return { data: ["track-1", "track-2"].map((id) => ({
        id, task_id: "task-1", subject: id === "track-1" ? "영어" : "수학",
        pipeline_status: "inquiry", director_profile_id: "director-1",
        director_assignment_source: "default", director_assignment_rule_key: "rule",
        waiting_kind: null, level_test_retake_decision: null,
        migration_review_required: false, stage_entered_at: "2026-07-12T01:00:00Z",
      })), error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.loadTrackSummaries(["task-1"], "viewer-1");

  assert.deepEqual(result.tracks.map((track) => track.directorName), ["강부희", "강부희"]);
  assert.equal(harness.queries.length, 2);
  assert.equal(harness.queries[1].table, "profiles");
  assert.equal(harness.queries[1].columns, "id,name");
  assert.deepEqual(harness.queries[1].filters, [["in", "id", ["director-1"]]]);
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

test("detail loader performs nine scoped reads, maps rows, and shares same-viewer in-flight work", async () => {
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

  assert.equal(harness.queries.length, 9);
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
  assert.deepEqual(events.filters, [["eq", "task_id", "task-1"]]);
  assert.ok(!events.filters.some((filter) => filter[0] === "in" && filter[1] === "event_type"));
  const messages = harness.queries.find((query) => query.table === "ops_registration_messages");
  assert.deepEqual(messages.filters, [
    ["eq", "task_id", "task-1"],
    ["eq", "template_key", "admission_application"],
    ["eq", "claim_active", true],
  ]);
  assert.equal(messages.limit, 1);
  for (const query of harness.queries.filter((query) => [
    "ops_registration_level_tests", "ops_registration_consultations", "ops_registration_enrollments",
  ].includes(query.table))) {
    assert.deepEqual(query.filters, [["in", "track_id", ["track-1"]]]);
  }
  assert.deepEqual(measures, [{ name: "registration:case-detail", cacheHit: false, queryCount: 9, ok: true }]);
  assert.ok(performanceCalls.some((entry) => entry[0] === "measure" && entry[1] === "registration:case-detail"));

  const cached = await service.loadCaseDetail("task-1", "viewer-1");
  assert.strictEqual(cached, detail);
  assert.equal(harness.queries.length, 9);
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
  assert.equal(harness.queries.length, afterViewerOne + 9);

  service.clearCaches();
  await service.loadCaseDetail("task-1", "viewer-1");
  assert.equal(harness.queries.length, afterViewerOne + 18);
});

test("registration option loader starts only four reads, excludes students and inactive rows", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const gates = new Map(["profiles", "classes", "textbooks", "teacher_catalogs"].map((table) => [table, deferred()]));
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
  assert.equal(harness.getMaxActiveQueries(), 4);
  assert.deepEqual(harness.queries.map((query) => query.table).sort(), [
    "classes", "profiles", "teacher_catalogs", "textbooks",
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
  assert.deepEqual(measures, [{
    name: "registration:option-summary", cacheHit: false, queryCount: 4, ok: true,
  }]);
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
    name: "registration:option-summary", cacheHit: false, queryCount: 4, ok: true,
  }]);
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
  await service.updateRegistrationCaseCommon({ taskId: "task-1", studentName: "김다미", schoolGrade: "고1", schoolName: "", parentPhone: "01012345678", studentPhone: "", campus: "본관", inquiryAt: "2026-07-12T01:00:00Z", requestNote: "", priority: "normal", expectedCommonRevision: 3, requestKey: key });
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
  const saved = await service.saveRegistrationEnrollmentRows({ trackId: "track-1", rows: [{ id: "", classId: "class-1", textbookId: "", classStartDate: "", classStartSessionKey: "", classStartSession: "", sortOrder: 0 }], requestKey: key });
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
    "save_registration_shared_appointment", "cancel_registration_appointment",
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
  assert.equal(harness.rpcCalls[2][1].p_request_note, null);
  assert.equal(harness.rpcCalls[5][1].p_appointment_id, null);
  assert.equal(harness.rpcCalls[10][1].p_class_id, null);
  assert.equal(harness.rpcCalls[13][1].p_rows[0].id, null);
  assert.equal(harness.rpcCalls[13][1].p_rows[0].textbookId, null);
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
      legacy: false,
      directorProfileId: "director-1",
      directorName: "",
      directorAssignmentSource: "default",
      directorAssignmentRuleKey: "english:2026:high1",
      waitingKind: "",
      levelTestRetakeDecision: "",
      migrationReviewRequired: false,
      stageEnteredAt: "2026-07-12T01:00:00Z",
      phoneReadyAt: "2026-07-12T01:00:00Z",
      phoneReadySource: "inquiry",
    },
    {
      id: "track-math",
      taskId: "task-new",
      subject: "수학",
      status: "visit_consultation_scheduled",
      legacy: false,
      directorProfileId: "director-2",
      directorName: "",
      directorAssignmentSource: "manual",
      directorAssignmentRuleKey: "override",
      waitingKind: "current_term_opening",
      levelTestRetakeDecision: "required",
      migrationReviewRequired: false,
      stageEnteredAt: "2026-07-12T02:00:00Z",
      phoneReadyAt: null,
      phoneReadySource: null,
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
