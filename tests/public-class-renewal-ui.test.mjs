import assert from "node:assert/strict";
import test from "node:test";
import {
  availability,
  conflicts,
  dateKey,
  filterClasses,
  minutes,
  monthCells,
  overlaps,
  layoutSlots,
  progressForSession,
  scheduleSlots,
  seoulToday,
  sessionDisplay,
  sessionState,
  storedIds,
  validIds,
} from "../src/components/public/classes/helpers.ts";
const ids = Array.from(
  { length: 8 },
  (_, i) => `b6b5da5a-b000-4b46-bc7a-dabea5b53e1${i}`,
);
const item = {
  id: ids[0],
  name: "초6 중등과정반1",
  schedule: "월수금 15:30-17:00",
  subject: "수학",
  grade: "초6",
  teacher: "김 선생님",
  room: "별관 2강",
  capacity: 10,
  enrolledCount: 8,
  waitlistCount: 0,
};
test("URL and storage IDs are bounded, known UUIDs only and deduplicated", () => {
  assert.deepEqual(
    validIds([...ids, ids[0], "<script>"], ids),
    ids.slice(0, 6),
  );
  assert.deepEqual(validIds(`${ids[0]},bad,${ids[0]},${ids[1]}`, [ids[0]]), [
    ids[0],
  ]);
  assert.deepEqual(storedIds("{oops", ids), []);
  assert.deepEqual(storedIds('{"id":"a"}', ids), []);
  assert.deepEqual(
    storedIds(JSON.stringify([ids[0], null, {}, ids[1]]), ids),
    ids.slice(0, 2),
  );
});
test("real multiline schedules preserve weekend and late slots without consuming staff annotations", () => {
  assert.deepEqual(
    scheduleSlots(item).map((s) => [s.day, s.start, s.end]),
    [
      [0, 930, 1020],
      [2, 930, 1020],
      [4, 930, 1020],
    ],
  );
  assert.deepEqual(
    scheduleSlots({
      ...item,
      schedule:
        "금 21:30-23:00 (양소윤, 별관 7강)\n토 14:30–16:00 (양소윤, 본관 2강)\n일 22:00~23:30",
    }).map((s) => [s.day, s.start, s.end]),
    [
      [4, 1290, 1380],
      [5, 870, 960],
      [6, 1320, 1410],
    ],
  );
  assert.deepEqual(
    scheduleSlots({
      ...item,
      schedule: "월 25:00-26:00\n목 17:00-15:00\n협의",
    }),
    [],
  );
  assert.equal(minutes("23:30"), 1410);
  assert.equal(minutes("12:60"), null);
});
test("overlap boundaries do not flag adjacent times, different weekdays or the same class", () => {
  const a = scheduleSlots(item)[0];
  assert.equal(
    overlaps(a, { ...a, classId: ids[1], start: 1020, end: 1100 }),
    false,
  );
  assert.equal(overlaps(a, { ...a, classId: ids[1], day: 1 }), false);
  assert.equal(overlaps(a, { ...a }), false);
  assert.equal(
    overlaps(a, { ...a, classId: ids[1], start: 1000, end: 1100 }),
    true,
  );
  assert.equal(
    conflicts([a, { ...a, classId: ids[1], start: 1000, end: 1100 }]).length,
    1,
  );
});
test("calendar uses UTC date components across leap years and timezone boundaries", () => {
  assert.equal(dateKey(2026, 8, 7), "2026-09-07");
  assert.equal(monthCells(2026, 8)[0], null);
  assert.equal(monthCells(2026, 8)[1], "2026-09-01");
  assert.equal(monthCells(2024, 1).filter(Boolean).length, 29);
  assert.equal(monthCells(2025, 1).filter(Boolean).length, 28);
  assert.equal(seoulToday(new Date("2026-09-06T15:01:00Z")), "2026-09-07");
});
test("recorded exception, makeup, pending and skipped remain distinct; IDs do not affect dates", () => {
  assert.deepEqual(
    sessionState({ scheduleState: "exception", makeupDate: "2026-07-21" }),
    { label: "휴강", cancelled: true },
  );
  assert.deepEqual(
    sessionState({ scheduleState: "makeup", originalDate: "2026-07-24" }),
    { label: "보강", cancelled: false },
  );
  assert.equal(
    sessionState({ scheduleState: "tbd", makeupDate: "2026-07-21" }).label,
    "일정 미정",
  );
  assert.equal(sessionState({ scheduleState: "skipped" }).label, "수업 제외");
  assert.equal(
    sessionState({
      scheduleState: "active",
      id: "old-2025-01-01",
      date: "2026-09-07",
    }).label,
    "정규 수업",
  );
});
test("overenrolled classes never advertise negative availability", () => {
  assert.deepEqual(availability({ ...item, enrolledCount: 14 }), {
    label: "마감",
    tone: "neutral",
    remaining: 0,
  });
  assert.equal(availability({ ...item, capacity: 0 }).label, "정원 문의");
  assert.equal(
    availability({ ...item, enrolledCount: 14, waitlistCount: 3 }).label,
    "대기 접수",
  );
});
test("subject, grade and search filters compose and include science", () => {
  const science = {
    ...item,
    id: ids[1],
    subject: "과학",
    grade: "고1",
    name: "고1 통합과학2",
  };
  assert.deepEqual(
    filterClasses(
      [item, science],
      new URLSearchParams("subject=과학&grade=고1&q=별관"),
    ),
    [science],
  );
  assert.deepEqual(
    filterClasses([item, science], new URLSearchParams("q=존재하지않는수업")),
    [],
  );
  assert.equal(filterClasses([item, science], new URLSearchParams()).length, 2);
});

test("regular dated sessions inherit only matching weekday slots and makeup remains explicit", () => {
  const regular = sessionDisplay(item, {
    date: "2026-09-07",
    scheduleState: "active",
  });
  assert.equal(regular.time, "15:30–17:00");
  assert.equal(regular.regularFallback, true);
  assert.equal(
    sessionDisplay(item, { date: "2026-09-08", scheduleState: "active" }).time,
    "시간 미정",
  );
  assert.equal(
    sessionDisplay(item, {
      date: "2026-09-07",
      scheduleState: "makeup",
      originalDate: "2026-09-04",
    }).time,
    "시간 미정",
  );
  assert.equal(
    sessionDisplay(item, {
      date: "2026-09-07",
      scheduleState: "makeup",
      startTime: "18:00",
      endTime: "19:00",
    }).time,
    "18:00–19:00",
  );
  const annotated = {
    ...item,
    schedule:
      "금 21:30-23:00 (양소윤, 별관 7강)\n토 14:30-16:00 (양소윤, 본관 2강)",
  };
  assert.equal(
    sessionDisplay(annotated, { date: "2026-09-12", scheduleState: "active" })
      .room,
    "본관 2강",
  );
});

test("staggered overlap groups use stable non-overlapping timetable lanes", () => {
  const base = { day: 0, classId: ids[0], name: "A" };
  const placed = layoutSlots([
    { ...base, start: 540, end: 600 },
    { ...base, classId: ids[1], start: 540, end: 720 },
    { ...base, classId: ids[2], start: 600, end: 660 },
    { ...base, classId: ids[3], start: 720, end: 780 },
  ]);
  assert.deepEqual(
    placed.slice(0, 3).map((slot) => slot.laneCount),
    [2, 2, 2],
  );
  assert.equal(placed.find((slot) => slot.classId === ids[3]).laneCount, 1);
  for (const a of placed)
    for (const b of placed) if (overlaps(a, b)) assert.notEqual(a.lane, b.lane);
});

function progressLog(overrides = {}) {
  return {
    id: "log-1",
    classId: ids[0],
    textbookId: "book-1",
    progressKey: "",
    sessionId: "",
    sessionOrder: 1,
    status: "pending",
    rangeStart: "",
    rangeEnd: "",
    rangeLabel: "",
    publicNote: "",
    updatedAt: null,
    completedLessonIds: [],
    ...overrides,
  };
}
test("actual progress never crosses repeated session numbers in different billing periods", () => {
  const september = {
    id: "session-september",
    sessionKey: "canonical-september",
    date: "2026-09-07",
    billingId: "period-september",
    sessionNumber: 1,
  };
  const october = {
    id: "session-october",
    sessionKey: "canonical-october",
    date: "2026-10-05",
    billingId: "period-october",
    sessionNumber: 1,
  };
  const sessions = [september, october];
  const logs = [
    progressLog({
      id: "oct-log",
      sessionId: october.id,
      sessionOrder: 7,
      rangeLabel: "October actual",
    }),
    progressLog({
      id: "sep-log",
      sessionId: september.id,
      sessionOrder: 3,
      rangeLabel: "September actual",
    }),
    progressLog({
      id: "unknown-log",
      sessionId: "unknown-session",
      sessionOrder: 1,
      rangeLabel: "Must not bleed",
    }),
    progressLog({
      id: "ambiguous-log",
      sessionOrder: 1,
      rangeLabel: "Ambiguous legacy content",
    }),
  ];
  for (const order of [logs, [...logs].reverse()]) {
    assert.equal(
      progressForSession(order, september, sessions).get("book-1").rangeLabel,
      "September actual",
    );
    assert.equal(
      progressForSession(order, october, sessions).get("book-1").rangeLabel,
      "October actual",
    );
  }
  assert.equal(progressForSession(logs.slice(2), september, sessions).size, 0);
  assert.equal(progressForSession(logs.slice(2), october, sessions).size, 0);
});
test("progress keys match only canonical identities and numeric fallback requires missing identities and a unique number", () => {
  const session = {
    id: "session-id",
    sessionKey: "canonical-key",
    sessionNumber: 2,
  };
  const keyLog = progressLog({
    progressKey: "canonical-key",
    sessionOrder: 99,
    rangeLabel: "Key actual",
  });
  assert.equal(
    progressForSession([keyLog], session, [session]).get("book-1"),
    keyLog,
  );
  assert.equal(
    progressForSession(
      [
        progressLog({
          sessionId: "unknown",
          progressKey: "canonical-key",
          sessionOrder: 2,
        }),
      ],
      session,
      [session],
    ).size,
    0,
  );
  assert.equal(
    progressForSession(
      [progressLog({ progressKey: "canonical-key::book-1", sessionOrder: 2 })],
      session,
      [session],
    ).size,
    0,
  );
  const legacy = progressLog({ sessionOrder: 2, rangeLabel: "Unique legacy" });
  assert.equal(
    progressForSession([legacy], session, [session]).get("book-1"),
    legacy,
  );
});
test("duplicate exact progress uses latest update deterministically and never replaces empty exact content with numeric content", () => {
  const session = {
    id: "session-id",
    sessionKey: "canonical-key",
    sessionNumber: 1,
  };
  const older = progressLog({
    id: "a",
    sessionId: session.id,
    updatedAt: "2026-09-07T00:00:00Z",
    rangeLabel: "Old",
  });
  const latest = progressLog({
    id: "b",
    sessionId: session.id,
    updatedAt: "2026-09-08T00:00:00Z",
    rangeLabel: "",
  });
  const fallback = progressLog({
    id: "z",
    updatedAt: "2026-09-09T00:00:00Z",
    rangeLabel: "Must not replace exact",
  });
  const key = progressLog({
    id: "key",
    progressKey: session.sessionKey,
    updatedAt: "2026-09-10T00:00:00Z",
    rangeLabel: "Weaker identity",
  });
  for (const logs of [
    [older, latest, fallback, key],
    [key, fallback, latest, older],
  ]) {
    assert.equal(
      progressForSession(logs, session, [session]).get("book-1"),
      latest,
    );
  }
  const tied = { ...latest, id: "c", rangeLabel: "Stable tie" };
  assert.equal(
    progressForSession([tied, latest], session, [session]).get("book-1"),
    tied,
  );
  assert.equal(
    progressForSession([latest, tied], session, [session]).get("book-1"),
    tied,
  );
});
