import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildRegistrationAppointmentCalendarItems,
  buildRegistrationAppointmentHref,
} from "../src/features/tasks/registration-appointment-calendar-model.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const migrationPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260809104000_registration_observation_enrollment_source.sql",
);
const readinessPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260809100000_registration_observation_core_schema.sql",
);
const pgTapPath = path.join(
  repositoryRoot,
  "supabase/tests/registration_observation_enrollment_test.sql",
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function functionDefinition(sql, qualifiedName) {
  const match = sql.match(
    new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+${escapeRegExp(qualifiedName)}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  assert.ok(match, `missing function definition: ${qualifiedName}`);
  return match[0];
}

function assertInOrder(source, values) {
  let cursor = -1;
  for (const value of values) {
    const next = source.indexOf(value, cursor + 1);
    assert.notEqual(next, -1, `missing ordered calendar projection: ${value}`);
    assert.ok(next > cursor, `${value} must follow the prior projection`);
    cursor = next;
  }
}

const observationCalendarIds = Object.freeze({
  taskId: "10000000-0000-4000-8000-000000000001",
  trackId: "10000000-0000-4000-8000-000000000002",
  appointmentId: "10000000-0000-4000-8000-000000000003",
  observationId: "10000000-0000-4000-8000-000000000004",
  classId: "10000000-0000-4000-8000-000000000005",
});

function observationCalendarRow(overrides = {}) {
  return {
    appointment_id: observationCalendarIds.appointmentId,
    task_id: observationCalendarIds.taskId,
    student_name: "청강학생",
    kind: "observation_class",
    scheduled_at: "2026-08-12T16:00:00+09:00",
    place: "본관 301호",
    status: "scheduled",
    notification_revision: 3,
    track_ids: [observationCalendarIds.trackId],
    subjects: ["영어"],
    observation_id: observationCalendarIds.observationId,
    observation_track_id: observationCalendarIds.trackId,
    observation_class_id: observationCalendarIds.classId,
    observation_class_name: "영어 심화반",
    observation_ends_at: "2026-08-12T17:30:00+09:00",
    observation_teacher_name: "김선생",
    observation_classroom_name: "본관 301호",
    ...overrides,
  };
}

test("observation calendar counts one appointment once and emits the canonical five-key link", () => {
  // Production break caught: observation rows are duplicated, normalized as an
  // appointment kind, or emit a provider-incompatible query order.
  const items = buildRegistrationAppointmentCalendarItems(
    [observationCalendarRow()],
    { observationRuntimeVersion: 1 },
  );
  const observationItem = items.find((item) => item.kind === "observation");
  assert.ok(observationItem);
  assert.equal(items.filter((item) => item.kind === "observation").length, 1);
  const orderedTuple = [
    ["taskId", observationCalendarIds.taskId],
    ["trackId", observationCalendarIds.trackId],
    ["appointmentId", observationCalendarIds.appointmentId],
    ["observationId", observationCalendarIds.observationId],
    ["view", "calendar"],
  ];
  const expectedHref = `/admin/registration?${new URLSearchParams(orderedTuple).toString()}`;
  assert.equal(observationItem.href, expectedHref);
  assert.deepEqual(
    [...new URL(observationItem.href, "https://tips.invalid").searchParams.entries()],
    orderedTuple,
  );
  assert.equal(
    buildRegistrationAppointmentHref(
      observationCalendarIds.taskId,
      observationCalendarIds.appointmentId,
      { trackId: observationCalendarIds.trackId, observationId: observationCalendarIds.observationId },
    ),
    expectedHref,
  );
});

test("runtime zero drops observation rows before they can become calendar items", () => {
  // Production break caught: a disabled runtime still exposes observation
  // counts, filter entries, or navigable details in the browser payload.
  assert.deepEqual(
    buildRegistrationAppointmentCalendarItems(
      [observationCalendarRow()],
      { observationRuntimeVersion: 0 },
    ),
    [],
  );
});

test("runtime one rejects every observation cross-shape even outside the selected status", () => {
  // Production break caught: a malformed observation snapshot is hidden by a
  // client status filter and becomes visible later without revalidation.
  for (const overrides of [
    { observation_id: null },
    { observation_track_id: "40000000-0000-4000-8000-000000000001" },
    { observation_class_id: "not-a-uuid" },
    { observation_class_name: " " },
    { observation_ends_at: "2026-08-12T16:00:00+09:00" },
    { observation_teacher_name: "" },
    { observation_classroom_name: null },
    {
      track_ids: [observationCalendarIds.trackId, "40000000-0000-4000-8000-000000000002"],
      subjects: ["영어", "수학"],
    },
  ]) {
    assert.throws(
      () => buildRegistrationAppointmentCalendarItems(
        [observationCalendarRow(overrides)],
        { statuses: ["completed"], observationRuntimeVersion: 1 },
      ),
      /registration_appointment_calendar_row_invalid/,
    );
  }

  assert.throws(
    () => buildRegistrationAppointmentCalendarItems([{
      ...observationCalendarRow(),
      kind: "level_test",
    }], { statuses: ["completed"], observationRuntimeVersion: 1 }),
    /registration_appointment_calendar_row_invalid:observation_id/,
  );
});

test("calendar forward replacement preserves ten columns and appends seven bounded observation snapshots", async () => {
  // Production break caught: direct-view consumers see reordered legacy fields,
  // sensitive feedback facts, or a renamed observation kind.
  const sql = await readFile(migrationPath, "utf8");
  assert.match(
    sql,
    /create\s+or\s+replace\s+view\s+public\.ops_registration_appointment_calendar\s+with\s*\(\s*security_invoker\s*=\s*true\s*\)/i,
  );
  const viewStart = sql.search(
    /create\s+or\s+replace\s+view\s+public\.ops_registration_appointment_calendar/i,
  );
  const viewEnd = sql.indexOf(";", sql.indexOf("from public.ops_registration_appointments", viewStart));
  const view = sql.slice(viewStart, viewEnd);
  assertInOrder(view, [
    "appointment.id as appointment_id",
    "appointment.task_id",
    "task.student_name",
    "appointment.kind",
    "appointment.scheduled_at",
    "appointment.place",
    "appointment.status",
    "appointment.notification_revision",
    "participant.track_ids",
    "participant.subjects",
    "observation.id as observation_id",
    "observation.track_id as observation_track_id",
    "observation.class_id as observation_class_id",
    "observation.class_name_snapshot as observation_class_name",
    "observation.ends_at as observation_ends_at",
    "observation.teacher_name_snapshot as observation_teacher_name",
    "observation.classroom_name_snapshot as observation_classroom_name",
  ]);
  assert.match(view, /appointment\.kind\s*=\s*'observation_class'/i);
  assert.match(view, /ops_registration_observations/i);
  assert.doesNotMatch(
    view,
    /feedback_reason|suitability_result|attendance|parent_phone|student_phone|school_name|request_note|textbook_snapshot|progress_snapshot/i,
  );
});

test("calendar canonical participants add one exact observation branch without losing level-test or visit", async () => {
  // Production break caught: two joins duplicate a single appointment or the
  // observation union replaces either existing participant branch.
  const sql = await readFile(migrationPath, "utf8");
  const canonicalStart = sql.indexOf("with canonical_participants as (");
  const aggregateStart = sql.indexOf("appointment_participants as (", canonicalStart);
  const canonical = sql.slice(canonicalStart, aggregateStart);
  for (const relation of [
    "public.ops_registration_level_tests",
    "public.ops_registration_consultations",
    "public.ops_registration_observations",
  ]) assert.match(canonical, new RegExp(escapeRegExp(relation), "i"));
  assert.match(canonical, /appointment\.kind\s*=\s*'level_test'/i);
  assert.match(canonical, /appointment\.kind\s*=\s*'visit_consultation'/i);
  assert.match(canonical, /appointment\.kind\s*=\s*'observation_class'/i);
  assert.match(canonical, /observation\.appointment_id/i);
  assert.match(canonical, /observation\.track_id/i);
  assert.match(canonical, /\bunion\b/i);
});

test("private appointment track helper preserves both old branches and adds observation class", async () => {
  // Production break caught: notification/routing callers lose level-test or
  // visit participants when observation track IDs are added.
  const sql = await readFile(migrationPath, "utf8");
  const helper = functionDefinition(
    sql,
    "dashboard_private.registration_appointment_track_ids_v1",
  );
  assert.match(helper, /language\s+sql/i);
  assert.match(helper, /stable/i);
  assert.match(helper, /security\s+definer/i);
  assert.match(helper, /set\s+search_path\s*=\s*''/i);
  assert.match(helper, /ops_registration_level_tests/i);
  assert.match(helper, /status\s+in\s*\(\s*'scheduled'\s*,\s*'in_progress'\s*\)/i);
  assert.match(helper, /ops_registration_consultations/i);
  assert.match(helper, /mode\s*=\s*'visit'/i);
  assert.match(helper, /status\s*=\s*'scheduled'/i);
  assert.match(helper, /ops_registration_observations/i);
  assert.match(helper, /appointment\.kind\s*=\s*'observation_class'/i);
});

test("calendar and helper ACLs expose only authenticated RLS-invoker selection", async () => {
  // Production break caught: anon/service_role bypass observation RLS through
  // the view or any API role executes the private definer helper.
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /alter\s+view\s+public\.ops_registration_appointment_calendar\s+owner\s+to\s+postgres/i);
  assert.match(
    sql,
    /revoke\s+all\s+on\s+table\s+public\.ops_registration_appointment_calendar\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
  );
  assert.match(
    sql,
    /grant\s+select\s+on\s+table\s+public\.ops_registration_appointment_calendar\s+to\s+authenticated/i,
  );
  assert.match(
    sql,
    /revoke\s+all\s+on\s+function\s+dashboard_private\.registration_appointment_track_ids_v1\(uuid\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
  );
  assert.doesNotMatch(
    sql,
    /grant\s+execute\s+on\s+function\s+dashboard_private\.registration_appointment_track_ids_v1\(uuid\)/i,
  );
});

test("core readiness requires every Task 6 signature column helper body and invoker option", async () => {
  // Production break caught: runtime activation reports ready from only an old
  // helper signature or a definer calendar lacking the seven columns.
  const sql = await readFile(readinessPath, "utf8");
  for (const token of [
    "public.get_registration_observation_manager_attempt_v1(uuid,uuid)",
    "public.get_registration_observation_feedback_v1(uuid)",
    "public.record_registration_observation_attendance_v1(uuid,bigint,integer,text)",
    "public.submit_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,integer,text)",
    "public.correct_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,text,text)",
    "public.decide_registration_observation_v1(uuid,text,uuid,bigint,bigint,integer,text)",
    "dashboard_private.validate_registration_observation_class_start_source_v1(uuid,uuid,uuid,date,text,uuid)",
    "dashboard_private.normalize_registration_enrollment_rows_request_v1(jsonb)",
    "dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)",
    "dashboard_private.registration_appointment_track_ids_v1(uuid)",
    "public.ops_registration_appointment_calendar.observation_id",
    "public.ops_registration_appointment_calendar.observation_track_id",
    "public.ops_registration_appointment_calendar.observation_class_id",
    "public.ops_registration_appointment_calendar.observation_class_name",
    "public.ops_registration_appointment_calendar.observation_ends_at",
    "public.ops_registration_appointment_calendar.observation_teacher_name",
    "public.ops_registration_appointment_calendar.observation_classroom_name",
    "public.ops_registration_appointment_calendar.security_invoker",
  ]) assert.match(sql, new RegExp(escapeRegExp(token)));
  assert.match(sql, /pg_get_functiondef/i);
  assert.match(sql, /ops_registration_level_tests/i);
  assert.match(sql, /ops_registration_consultations/i);
  assert.match(sql, /ops_registration_observations/i);
  assert.match(sql, /observation_class/i);
  assert.match(sql, /reloptions/i);
});

test("calendar pgTAP covers legacy nulls observation cardinality RLS helper and readiness", async () => {
  // Production break caught: source tests pass while real view types, RLS
  // visibility, participant arrays, or readiness differ in Postgres.
  const sql = await readFile(pgTapPath, "utf8");
  for (const token of [
    "first ten calendar columns",
    "level-test appended observation columns are null",
    "visit appended observation columns are null",
    "one observation appointment yields exactly one row",
    "one-element track and subject arrays",
    "active admin",
    "active staff",
    "exact director",
    "assigned teacher",
    "unrelated actor",
    "registration_appointment_track_ids_v1",
    "security_invoker=true",
    "schemaReady",
    "missingObjects",
  ]) assert.match(sql, new RegExp(token, "i"));
});
