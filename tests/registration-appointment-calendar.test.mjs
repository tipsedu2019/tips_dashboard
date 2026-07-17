import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const modelUrl = new URL(
  "../src/features/tasks/registration-appointment-calendar-model.ts",
  import.meta.url,
);
const migrationUrl = new URL(
  "../supabase/migrations/20260716120000_registration_appointment_calendar.sql",
  import.meta.url,
);
const pgTapUrl = new URL(
  "../supabase/tests/registration_subject_tracks_runtime_test.sql",
  import.meta.url,
);

async function loadModel() {
  return import(modelUrl.href);
}

function calendarRow(overrides = {}) {
  return {
    appointment_id: "appointment-shared",
    task_id: "task-shared",
    student_name: "공유학생",
    kind: "level_test",
    scheduled_at: "2026-07-15T10:30:00+09:00",
    place: "본관 3층",
    status: "scheduled",
    notification_revision: 3,
    track_ids: ["track-english", "track-math"],
    subjects: ["영어", "수학"],
    ...overrides,
  };
}

test("공유 예약을 정확한 시각과 과목 순서를 보존하는 하나의 안정된 항목으로 만든다", async () => {
  const { buildRegistrationAppointmentCalendarItems } = await loadModel();
  const rows = [
    calendarRow(),
    calendarRow({
      appointment_id: "appointment-completed",
      kind: "visit_consultation",
      scheduled_at: "2026-07-15T18:00:00+09:00",
      status: "completed",
      notification_revision: 1,
      track_ids: ["track-math"],
      subjects: ["수학"],
    }),
  ];

  const items = buildRegistrationAppointmentCalendarItems(rows);

  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    id: "registration-appointment:appointment-shared",
    appointmentId: "appointment-shared",
    taskId: "task-shared",
    studentName: "공유학생",
    kind: "level_test",
    scheduledAt: "2026-07-15T10:30:00+09:00",
    place: "본관 3층",
    status: "scheduled",
    notificationRevision: 3,
    trackIds: ["track-english", "track-math"],
    subjects: ["영어", "수학"],
    href: "/admin/registration?taskId=task-shared&appointmentId=appointment-shared&view=calendar",
  });
});

test("같은 날의 서로 다른 예약 ID를 합치지 않고 명시한 상태만 포함한다", async () => {
  const { buildRegistrationAppointmentCalendarItems } = await loadModel();
  const rows = [
    calendarRow(),
    calendarRow({
      appointment_id: "appointment-completed",
      kind: "visit_consultation",
      scheduled_at: "2026-07-15T10:30:00+09:00",
      status: "completed",
      notification_revision: 2,
      track_ids: ["track-math"],
      subjects: ["수학"],
    }),
    calendarRow({
      appointment_id: "appointment-canceled",
      scheduled_at: "2026-07-15T10:30:00+09:00",
      status: "canceled",
      notification_revision: 4,
      track_ids: ["track-english"],
      subjects: ["영어"],
    }),
  ];

  const items = buildRegistrationAppointmentCalendarItems(rows, {
    statuses: ["scheduled", "completed", "canceled"],
  });

  assert.deepEqual(
    items.map((item) => item.id),
    [
      "registration-appointment:appointment-shared",
      "registration-appointment:appointment-completed",
      "registration-appointment:appointment-canceled",
    ],
  );
  assert.equal(new Set(items.map((item) => item.id)).size, 3);
  assert.deepEqual(buildRegistrationAppointmentCalendarItems(rows, { statuses: [] }), []);
});

test("과목과 트랙을 영어 다음 수학 순서로 함께 정렬한다", async () => {
  const { buildRegistrationAppointmentCalendarItems } = await loadModel();
  const [item] = buildRegistrationAppointmentCalendarItems([
    calendarRow({
      track_ids: ["track-math", "track-english"],
      subjects: ["수학", "영어"],
    }),
  ]);

  assert.deepEqual(item.trackIds, ["track-english", "track-math"]);
  assert.deepEqual(item.subjects, ["영어", "수학"]);
});

test("종류·상태·알림 리비전·예약 시각이 잘못된 행은 조용히 숨기지 않고 거절한다", async () => {
  const { buildRegistrationAppointmentCalendarItems } = await loadModel();
  const invalidRows = [
    calendarRow({ kind: "phone" }),
    calendarRow({ status: "waiting" }),
    calendarRow({ notification_revision: "3" }),
    calendarRow({ notification_revision: 0 }),
    calendarRow({ notification_revision: 1.5 }),
    calendarRow({ scheduled_at: "2026-07-15" }),
    calendarRow({ scheduled_at: "2026-02-30T10:30:00+09:00" }),
    calendarRow({ scheduled_at: "2026-07-15T25:30:00+09:00" }),
    calendarRow({ scheduled_at: "2026-07-15T10:30:00+16:00" }),
  ];

  for (const row of invalidRows) {
    assert.throws(
      () => buildRegistrationAppointmentCalendarItems([row]),
      /registration_appointment_calendar_row_invalid/,
    );
  }

  const boundaryTimestamp = "2026-07-15T10:30:00+15:59";
  assert.equal(
    buildRegistrationAppointmentCalendarItems([
      calendarRow({ scheduled_at: boundaryTimestamp }),
    ])[0].scheduledAt,
    boundaryTimestamp,
  );
});

test("뷰의 appointment 단일 행 계약이 깨지면 중복을 숨기지 않고 거절한다", async () => {
  const { buildRegistrationAppointmentCalendarItems } = await loadModel();

  assert.throws(
    () => buildRegistrationAppointmentCalendarItems([
      calendarRow(),
      calendarRow({ subjects: ["영어"], track_ids: ["track-english"] }),
    ]),
    /registration_appointment_calendar_row_invalid:duplicate_appointment_id/,
  );
});

test("딥 링크는 taskId, appointmentId, view 순서를 고정하고 값을 인코딩한다", async () => {
  const { buildRegistrationAppointmentHref } = await loadModel();

  assert.equal(
    buildRegistrationAppointmentHref("task / 1", "appointment / 1"),
    "/admin/registration?taskId=task+%2F+1&appointmentId=appointment+%2F+1&view=calendar",
  );
});

test("서울 자정 경계와 연말을 기준으로 날짜 키를 계산한다", async () => {
  const { getSeoulRegistrationDateKey } = await loadModel();

  assert.equal(getSeoulRegistrationDateKey("2026-07-31T14:59:59.999Z"), "2026-07-31");
  assert.equal(getSeoulRegistrationDateKey("2026-07-31T15:00:00.000Z"), "2026-08-01");
  assert.equal(getSeoulRegistrationDateKey("2026-12-31T15:00:00.000Z"), "2027-01-01");
  assert.equal(getSeoulRegistrationDateKey(new Date("2024-02-29T14:59:59.999Z")), "2024-02-29");
  assert.equal(getSeoulRegistrationDateKey(new Date("2024-02-29T15:00:00.000Z")), "2024-03-01");
  assert.throws(
    () => getSeoulRegistrationDateKey("not-a-timestamp"),
    /registration_appointment_calendar_invalid_timestamp/,
  );
});

test("월 범위는 윤일과 연말을 넘겨도 서울 자정 반개방 구간을 만든다", async () => {
  const { getRegistrationAppointmentCalendarRange } = await loadModel();

  assert.deepEqual(getRegistrationAppointmentCalendarRange("month", "2024-02-29"), {
    startDateKey: "2024-02-01",
    endDateKey: "2024-03-01",
    rangeStart: "2024-02-01T00:00:00+09:00",
    rangeEnd: "2024-03-01T00:00:00+09:00",
  });
  assert.deepEqual(getRegistrationAppointmentCalendarRange("month", "2026-12-31"), {
    startDateKey: "2026-12-01",
    endDateKey: "2027-01-01",
    rangeStart: "2026-12-01T00:00:00+09:00",
    rangeEnd: "2027-01-01T00:00:00+09:00",
  });
});

test("주 범위는 월요일부터 다음 월요일 전까지이며 월말·연말을 안전하게 넘긴다", async () => {
  const { getRegistrationAppointmentCalendarRange } = await loadModel();

  assert.deepEqual(getRegistrationAppointmentCalendarRange("week", "2027-01-01"), {
    startDateKey: "2026-12-28",
    endDateKey: "2027-01-04",
    rangeStart: "2026-12-28T00:00:00+09:00",
    rangeEnd: "2027-01-04T00:00:00+09:00",
  });
  assert.deepEqual(getRegistrationAppointmentCalendarRange("week", "2024-02-29"), {
    startDateKey: "2024-02-26",
    endDateKey: "2024-03-04",
    rangeStart: "2024-02-26T00:00:00+09:00",
    rangeEnd: "2024-03-04T00:00:00+09:00",
  });
  assert.throws(
    () => getRegistrationAppointmentCalendarRange("month", "2026-02-30"),
    /registration_appointment_calendar_invalid_date_key/,
  );
  assert.throws(
    () => getRegistrationAppointmentCalendarRange("day", "2026-07-15"),
    /registration_appointment_calendar_invalid_view/,
  );
});

test("달력 뷰 SQL은 정규 예약·보안·권한·조회 인덱스 계약을 고정한다", async () => {
  const source = await readFile(migrationUrl, "utf8");
  const normalized = source.replace(/\s+/g, " ").trim();

  assert.match(
    normalized,
    /create or replace view public\.ops_registration_appointment_calendar with \(security_invoker = true\) as/i,
  );
  for (const column of [
    "appointment_id",
    "task_id",
    "student_name",
    "kind",
    "scheduled_at",
    "place",
    "status",
    "notification_revision",
    "track_ids",
    "subjects",
  ]) {
    assert.match(normalized, new RegExp(`\\b${column}\\b`, "i"));
  }
  assert.match(normalized, /from public\.ops_registration_level_tests level_test/i);
  assert.match(normalized, /from public\.ops_registration_consultations consultation/i);
  assert.match(normalized, /consultation\.mode = 'visit'/i);
  assert.match(normalized, /union/i);
  assert.doesNotMatch(normalized, /union all/i);
  assert.match(normalized, /array_agg\(\s*participant\.track_id\s+order by[\s\S]*participant\.subject[\s\S]*'영어'[\s\S]*'수학'/i);
  assert.match(normalized, /array_agg\(\s*participant\.subject\s+order by[\s\S]*participant\.subject[\s\S]*'영어'[\s\S]*'수학'/i);
  assert.match(
    normalized,
    /create index if not exists ops_registration_appointments_status_scheduled_id_idx on public\.ops_registration_appointments \(status, scheduled_at, id\)/i,
  );
  assert.match(normalized, /revoke all on table public\.ops_registration_appointment_calendar from public, anon, authenticated/i);
  assert.match(normalized, /grant select on table public\.ops_registration_appointment_calendar to authenticated/i);
  assert.doesNotMatch(normalized, /academic_events/i);
  assert.doesNotMatch(normalized, /ready_at|legacy|notification_revision\s*::/i);
});

test("pgTAP 달력 계약 수와 계획 수가 일치한다", async () => {
  const source = await readFile(pgTapUrl, "utf8");
  const planMatch = source.match(/select plan\((\d+)\);/);
  const assertionCount = (source.match(/^select ok\(/gm) || []).length;

  assert.ok(planMatch);
  assert.ok(Number(planMatch[1]) >= 168);
  assert.equal(Number(planMatch[1]), assertionCount);
  for (let assertion = 161; assertion <= 168; assertion += 1) {
    assert.match(source, new RegExp(`registration_contract\\(${assertion}\\)`));
  }
});
