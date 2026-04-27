import test from "node:test";
import assert from "node:assert/strict";

import {
  buildClassManagementStats,
  buildStudentManagementStats,
  buildTextbookManagementStats,
  normalizeClassManagementRecord,
  normalizeStudentManagementRecord,
  normalizeTextbookManagementRecord,
} from "../v2/src/features/management/records.js";

test("normalizeStudentManagementRecord maps enrollment and school summary", () => {
  const record = normalizeStudentManagementRecord({
    id: "student-1",
    name: "홍길동",
    school: "중앙고",
    grade: "고2",
    class_ids: ["class-1", "class-2"],
    waitlist_class_ids: ["class-3"],
    contact: "010-1111-2222",
    parent_contact: "010-3333-4444",
    enroll_date: "2026-03-01",
  });

  assert.equal(record.title, "홍길동");
  assert.equal(record.badge, "고2");
  assert.equal(record.status, "수강 2개");
  assert.match(record.subtitle, /중앙고/);
  assert.match(record.metaSummary, /학부모/);
});

test("normalizeClassManagementRecord derives class status, enrollment, and weekly summary", () => {
  const record = normalizeClassManagementRecord({
    id: "class-1",
    name: "중앙고1A",
    subject: "영어",
    teacher: "한지현",
    grade: "고1",
    room: "별관 6강",
    schedule: "수 17:00-19:00 / 금 17:00-19:00",
    capacity: 13,
    student_ids: ["s1", "s2"],
    waitlist_student_ids: ["w1"],
    textbook_ids: ["t1", "t2"],
    start_date: "2026-03-01",
    end_date: "2026-12-31",
    tuition: 190000,
  });

  assert.equal(record.title, "중앙고1A");
  assert.equal(record.badge, "영어");
  assert.equal(record.status, "수업 진행 중");
  assert.match(record.metaSummary, /정원 2\/13/);
  assert.match(record.metaSummary, /교재 2권/);
  assert.equal(record.metrics.waitlistCount, 1);
  assert.equal(record.metrics.weeklyHoursLabel, "4시간");
  assert.equal(record.raw.weeklyHoursLabel, "4시간");
  assert.equal(record.raw.registeredCount, 2);
  assert.equal(record.raw.waitlistCount, 1);
  assert.equal(record.raw.capacityStatus, "2/13");
  assert.equal(record.raw.tuitionLabel, "190,000원");
  assert.deepEqual(record.raw.scheduleLines, ["수 17:00-19:00", "금 17:00-19:00"]);
});

test("normalizeTextbookManagementRecord preserves publisher and lesson counts", () => {
  const record = normalizeTextbookManagementRecord({
    id: "book-1",
    title: "수학의 힘",
    publisher: "좋은책",
    price: 24000,
    tags: ["고등", "심화"],
    lessons: [{ id: 1 }, { id: 2 }, { id: 3 }],
  });

  assert.equal(record.title, "수학의 힘");
  assert.equal(record.badge, "좋은책");
  assert.equal(record.status, "단원 3개");
  assert.match(record.metaSummary, /24,000원/);
  assert.match(record.metaSummary, /고등/);
});

test("management stats summarize each domain correctly", () => {
  const studentStats = buildStudentManagementStats([
    normalizeStudentManagementRecord({
      id: "s1",
      name: "가",
      school: "A고",
      grade: "고1",
      class_ids: ["c1"],
      waitlist_class_ids: [],
    }),
    normalizeStudentManagementRecord({
      id: "s2",
      name: "나",
      school: "B고",
      grade: "고2",
      class_ids: [],
      waitlist_class_ids: ["c2"],
    }),
  ]);
  const classStats = buildClassManagementStats([
    normalizeClassManagementRecord({
      id: "c1",
      name: "A",
      subject: "수학",
      status: "수업 진행 중",
      student_ids: ["s1"],
      capacity: 10,
    }),
    normalizeClassManagementRecord({
      id: "c2",
      name: "B",
      subject: "영어",
      status: "개강 준비 중",
      student_ids: [],
      capacity: 12,
    }),
  ]);
  const textbookStats = buildTextbookManagementStats([
    normalizeTextbookManagementRecord({
      id: "t1",
      title: "책1",
      publisher: "좋은책",
      tags: ["내신"],
      lessons: [{ id: 1 }, { id: 2 }],
    }),
    normalizeTextbookManagementRecord({
      id: "t2",
      title: "책2",
      publisher: "천재",
      tags: [],
      lessons: [{ id: 3 }],
    }),
  ]);

  assert.deepEqual(
    studentStats.map((item) => item.value),
    ["2", "1", "1", "2"],
  );
  assert.deepEqual(
    classStats.map((item) => item.value),
    ["2", "1", "1", "22"],
  );
  assert.deepEqual(
    textbookStats.map((item) => item.value),
    ["2", "2", "1", "3"],
  );
});
