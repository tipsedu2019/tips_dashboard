import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  buildDashboardMetrics,
  buildScheduleCollisionSummary,
  findExamConflictsForClasses,
} from "../src/features/dashboard/metrics.js";

test("detects teacher and classroom schedule overlaps", () => {
  const classes = [
    {
      id: "class-a",
      name: "A 수업",
      status: "수업 진행 중",
      schedule: "월 10:00-11:00",
      teacher: "김선생",
      classroom: "본관 1강",
      student_ids: [],
    },
    {
      id: "class-b",
      name: "B 수업",
      status: "수업 진행 중",
      schedule: "월 10:30-11:30",
      teacher: "김선생",
      classroom: "본관 1강",
      student_ids: [],
    },
  ];

  const summary = buildScheduleCollisionSummary(classes, []);

  assert.equal(summary.teacher.length, 1);
  assert.equal(summary.classroom.length, 1);
  assert.equal(summary.teacher[0].overlaps[0].start, "10:30");
  assert.equal(summary.teacher[0].overlaps[0].end, "11:00");
});

test("builds ascending student breakdowns from registered enrollments", () => {
  const metrics = buildDashboardMetrics({
    classes: [
      {
        id: "math-a",
        name: "수학 A",
        subject: "수학",
        status: "수업 진행 중",
        schedule: "월 10:00-11:00",
        teacher: "김선생",
        classroom: "본관 1강",
        student_ids: ["student-1"],
      },
      {
        id: "math-b",
        name: "수학 B",
        subject: "수학",
        status: "수업 진행 중",
        schedule: "화 10:00-11:00",
        teacher: "김선생",
        classroom: "본관 2강",
        student_ids: ["student-1"],
      },
      {
        id: "english-a",
        name: "영어 A",
        subject: "영어",
        status: "수업 진행 중",
        schedule: "수 10:00-11:00",
        teacher: "이선생",
        classroom: "별관 1강",
        student_ids: ["student-2"],
      },
    ],
    students: [
      { id: "student-1", name: "가학생", school: "대기고", grade: "고1" },
      { id: "student-2", name: "나학생", school: "중앙여고", grade: "고2" },
    ],
  });

  assert.deepEqual(metrics.studentBreakdowns.bySubject.map((row) => row.label), ["영어", "수학"]);
  assert.equal(metrics.studentBreakdowns.bySubject[0].enrollmentCount, 1);
  assert.equal(metrics.studentBreakdowns.bySubject[1].enrollmentCount, 2);
  assert.equal(metrics.studentBreakdowns.bySubject[1].studentCount, 1);
});

test("builds subject analytics buckets and orders resource load by busiest first", () => {
  const metrics = buildDashboardMetrics({
    classes: [
      {
        id: "math-a",
        name: "수학 A",
        subject: "수학",
        status: "수업 진행 중",
        schedule: "월 10:00-12:00",
        teacher: "장선생",
        classroom: "본관 1강",
        student_ids: ["student-1", "student-2"],
        waitlist_student_ids: ["student-4"],
      },
      {
        id: "math-b",
        name: "수학 B",
        subject: "수학",
        status: "수업 진행 중",
        schedule: "화 10:00-11:00",
        teacher: "김선생",
        classroom: "본관 2강",
        student_ids: ["student-1"],
      },
      {
        id: "english-a",
        name: "영어 A",
        subject: "영어",
        status: "수업 진행 중",
        schedule: "수 10:00-11:30",
        teacher: "이선생",
        classroom: "별관 1강",
        student_ids: ["student-3"],
      },
    ],
    students: [
      { id: "student-1", name: "가학생", school: "대기고", grade: "고1" },
      { id: "student-2", name: "나학생", school: "대기고", grade: "고1" },
      { id: "student-3", name: "다학생", school: "중앙여고", grade: "고2" },
      { id: "student-4", name: "라학생", school: "중앙여고", grade: "고2" },
    ],
  });

  assert.equal(metrics.analyticsBySubject.math.studentBreakdowns.byGrade[0].label, "고1");
  assert.equal(metrics.analyticsBySubject.math.studentBreakdowns.byGrade[0].enrollmentCount, 3);
  assert.equal(metrics.analyticsBySubject.math.studentBreakdowns.byGrade[0].studentCount, 2);
  assert.equal(metrics.analyticsBySubject.english.studentBreakdowns.bySchool[0].label, "중앙여고");
  assert.equal(metrics.analyticsBySubject.all.teacherLoad[0].name, "장선생");
  assert.equal(metrics.analyticsBySubject.all.teacherLoad[0].minutes, 120);
  assert.equal(metrics.analyticsBySubject.all.teacherLoad[0].enrollmentCount, 2);
  assert.equal(metrics.analyticsBySubject.all.teacherLoad[0].waitlistCount, 1);
  assert.deepEqual(metrics.analyticsBySubject.all.teacherLoad[0].classes[0].registeredStudents, ["가학생", "나학생"]);
  assert.deepEqual(metrics.analyticsBySubject.all.teacherLoad[0].classes[0].waitlistStudents, ["라학생"]);
  assert.equal(metrics.analyticsBySubject.all.teacherLoad[0].classes[0].scheduleLabel, "월 10:00-12:00");
});

test("orders grade breakdowns by student count and attaches school counts per grade", () => {
  const metrics = buildDashboardMetrics({
    classes: [
      {
        id: "class-a",
        name: "A",
        subject: "math",
        status: "수강",
        schedule: "월 10:00-11:00",
        student_ids: ["student-1", "student-2", "student-3"],
      },
      {
        id: "class-b",
        name: "B",
        subject: "math",
        status: "수강",
        schedule: "화 10:00-11:00",
        student_ids: ["student-1"],
      },
      {
        id: "class-c",
        name: "C",
        subject: "english",
        status: "수강",
        schedule: "수 10:00-11:00",
        student_ids: ["student-4"],
      },
    ],
    students: [
      { id: "student-1", name: "A", school: "School B", grade: "Grade 1" },
      { id: "student-2", name: "B", school: "School A", grade: "Grade 1" },
      { id: "student-3", name: "C", school: "School A", grade: "Grade 1" },
      { id: "student-4", name: "D", school: "School C", grade: "Grade 2" },
    ],
  });

  assert.deepEqual(metrics.studentBreakdowns.byGrade.map((row) => row.label), ["Grade 1", "Grade 2"]);
  assert.equal(metrics.studentBreakdowns.byGrade[0].studentCount, 3);
  assert.deepEqual(
    metrics.studentBreakdowns.byGrade[0].schools.map((row) => row.label),
    ["School A", "School B"],
  );
  assert.equal(metrics.studentBreakdowns.byGrade[0].schools[0].studentCount, 2);
});

test("detects same-day and previous-day exam conflicts", () => {
  const classes = [
    {
      id: "math-a",
      name: "수학 A",
      subject: "수학",
      status: "수업 진행 중",
      schedule: "월 10:00-11:00",
      schedule_plan: {
        sessions: [{ state: "active", date: "2026-04-27" }],
      },
      student_ids: ["student-1"],
    },
  ];
  const students = [
    { id: "student-1", name: "가학생", school: "대기고", grade: "고1" },
  ];
  const academicSchools = [{ id: "school-1", name: "대기고" }];
  const academicEvents = [{ id: "event-1", title: "중간고사", school_id: "school-1" }];
  const academicEventExamDetails = [
    {
      academic_event_id: "event-1",
      school_id: "school-1",
      grade: "고1",
      subject: "수학",
      exam_date: "2026-04-27",
    },
    {
      academic_event_id: "event-1",
      school_id: "school-1",
      grade: "고1",
      subject: "영어",
      exam_date: "2026-04-28",
    },
  ];

  const conflicts = findExamConflictsForClasses(
    classes,
    students,
    academicSchools,
    [],
    academicEventExamDetails,
    academicEvents,
  );

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].conflicts.length, 2);
  assert.deepEqual(
    conflicts[0].conflicts.map((conflict) => conflict.rule).sort(),
    ["day-before-other-subject", "same-day-subject"],
  );
});

test("ignores blank modern exam dates instead of falling back to legacy exam days", () => {
  const classes = [
    {
      id: "math-a",
      name: "Math A",
      subject: "Math",
      schedule_plan: {
        sessions: [{ state: "active", date: "2026-04-28" }],
      },
      student_ids: ["student-1"],
    },
  ];
  const students = [
    { id: "student-1", name: "Student A", school: "Daegee High", grade: "G1" },
  ];
  const academicSchools = [{ id: "school-1", name: "Daegee High" }];
  const academicEvents = [{ id: "event-1", title: "Midterm", school_id: "school-1" }];
  const academicExamDays = [
    {
      school_id: "school-1",
      grade: "G1",
      subject: "English",
      exam_date: "2026-04-29",
    },
  ];
  const academicEventExamDetails = [
    {
      academic_event_id: "event-1",
      school_id: "school-1",
      grade: "G1",
      subject: "English",
      exam_date: "",
    },
  ];

  const conflicts = findExamConflictsForClasses(
    classes,
    students,
    academicSchools,
    academicExamDays,
    academicEventExamDetails,
    academicEvents,
  );

  assert.equal(conflicts.length, 0);
});

test("does not use legacy exam days when annual board has modern exam coverage without subject date", () => {
  const classes = [
    {
      id: "math-a",
      name: "Math A",
      subject: "Math",
      schedule_plan: {
        sessions: [{ state: "active", date: "2026-04-28" }],
      },
      student_ids: ["student-1"],
    },
  ];
  const students = [
    { id: "student-1", name: "Student A", school: "Daegee High", grade: "G1" },
  ];
  const academicSchools = [{ id: "school-1", name: "Daegee High" }];
  const academicEvents = [
    {
      id: "event-1",
      title: "Midterm",
      school_id: "school-1",
      grade: "G1",
      type: "시험기간",
      start: "2026-04-28",
      end: "2026-04-30",
    },
  ];
  const academicExamDays = [
    {
      school_id: "school-1",
      grade: "G1",
      subject: "English",
      exam_date: "2026-04-29",
    },
  ];

  const conflicts = findExamConflictsForClasses(
    classes,
    students,
    academicSchools,
    academicExamDays,
    [],
    academicEvents,
  );

  assert.equal(conflicts.length, 0);
});

test("detects subject exam events saved directly on the annual board", () => {
  const classes = [
    {
      id: "english-high-3",
      name: "중앙여고3",
      subject: "영어",
      schedule_plan: {
        sessions: [{ state: "active", date: "2026-04-29" }],
      },
      student_ids: ["student-1", "student-2"],
    },
  ];
  const students = [
    { id: "student-1", name: "김학생", school: "중앙여고", grade: "고3" },
    { id: "student-2", name: "이학생", school: "중앙여고", grade: "고3" },
  ];
  const academicSchools = [{ id: "school-1", name: "중앙여고" }];
  const academicEvents = [
    {
      id: "event-english-exam",
      title: "영어 시험",
      school_id: "school-1",
      grade: "고3",
      type: "영어시험일",
      start: "2026-04-29",
      end: "2026-04-29",
    },
  ];

  const conflicts = findExamConflictsForClasses(
    classes,
    students,
    academicSchools,
    [],
    [],
    academicEvents,
  );

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].title, "중앙여고3");
  assert.equal(conflicts[0].conflicts.length, 1);
  assert.equal(conflicts[0].conflicts[0].rule, "same-day-subject");
  assert.equal(conflicts[0].conflicts[0].examDate, "2026-04-29");
  assert.deepEqual(conflicts[0].conflicts[0].students, ["김학생", "이학생"]);
});

test("attaches class summaries to grade class breakdowns", () => {
  const metrics = buildDashboardMetrics({
    classes: [
      {
        id: "grade-class-large",
        name: "Large class",
        subject: "math",
        schedule: "Mon 10:00-11:00",
        teacher: "Teacher A",
        classroom: "Room 1",
        student_ids: ["student-1", "student-2", "student-3"],
      },
      {
        id: "grade-class-small",
        name: "Small class",
        subject: "english",
        schedule: "Tue 11:00-12:00",
        teacher: "Teacher B",
        classroom: "Room 2",
        student_ids: ["student-4"],
      },
    ],
    students: [
      { id: "student-1", name: "A", school: "School A", grade: "Grade 1" },
      { id: "student-2", name: "B", school: "School A", grade: "Grade 1" },
      { id: "student-3", name: "C", school: "School B", grade: "Grade 1" },
      { id: "student-4", name: "D", school: "School B", grade: "Grade 1" },
    ],
  });

  const summaries = metrics.classBreakdowns.byGrade[0].classSummaries;

  assert.equal(summaries[0].id, "grade-class-large");
  assert.equal(summaries[0].studentCount, 3);
  assert.equal(summaries[0].subject, "math");
  assert.equal(summaries[0].scheduleLabel, "Mon 10:00-11:00");
  assert.equal(summaries[0].weeklyMinutes, 60);
  assert.equal(summaries[0].weeklyHoursLabel, "1시간");
  assert.equal(summaries[0].teacherLabel, "Teacher A");
  assert.equal(summaries[0].classroomLabel, "Room 1");
  assert.equal(metrics.classBreakdowns.byGrade[0].weeklyMinutes, 120);
  assert.equal(metrics.classBreakdowns.byGrade[0].weeklyHoursLabel, "2시간");
  assert.deepEqual(metrics.classBreakdowns.byTeacher.map((row) => row.label), ["Teacher A", "Teacher B"]);
  assert.equal(metrics.classBreakdowns.byTeacher[0].classSummaries[0].id, "grade-class-large");
  assert.deepEqual(metrics.classBreakdowns.byClassroom.map((row) => row.label), ["Room 1", "Room 2"]);
  assert.equal(metrics.classBreakdowns.byClassroom[0].classSummaries[0].id, "grade-class-large");
});

test("normalizes day-specific classroom labels in dashboard operations", () => {
  const metrics = buildDashboardMetrics({
    classes: [
      {
        id: "room-saturday",
        name: "토요 수업",
        subject: "math",
        schedule: "토 10:00-11:00",
        teacher: "Teacher A",
        classroom: "본관 2강(토)",
        student_ids: ["student-1", "student-2"],
      },
      {
        id: "room-weekday",
        name: "평일 수업",
        subject: "math",
        schedule: "월 10:00-11:00",
        teacher: "Teacher B",
        classroom: "본관 2강",
        student_ids: ["student-3"],
      },
    ],
    students: [
      { id: "student-1", name: "A", grade: "고1" },
      { id: "student-2", name: "B", grade: "고1" },
      { id: "student-3", name: "C", grade: "고1" },
    ],
  });

  assert.deepEqual(metrics.classBreakdowns.byClassroom.map((row) => row.label), ["본관 2강"]);
  assert.equal(metrics.classBreakdowns.byClassroom[0].classCount, 2);
  assert.equal(metrics.classBreakdowns.byClassroom[0].studentCount, 3);
  assert.deepEqual(
    metrics.classBreakdowns.byClassroom[0].classSummaries.map((row) => row.classroomLabel),
    ["본관 2강", "본관 2강"],
  );
});

test("uses class management grade before enrolled student grades for class breakdowns", () => {
  const metrics = buildDashboardMetrics({
    classes: [
      {
        id: "managed-grade-class",
        name: "Managed Grade Class",
        subject: "math",
        grade: "고1",
        schedule: "Mon 10:00-11:00",
        student_ids: ["student-1", "student-2"],
      },
    ],
    students: [
      { id: "student-1", name: "A", school: "School A", grade: "고2" },
      { id: "student-2", name: "B", school: "School B", grade: "고3" },
    ],
  });

  assert.deepEqual(metrics.classBreakdowns.byGrade.map((row) => row.label), ["고1"]);
  assert.equal(metrics.classBreakdowns.byGrade[0].classCount, 1);
  assert.equal(metrics.classBreakdowns.byGrade[0].studentCount, 2);
});

test("builds registration and withdrawal operation process stats for the dashboard", () => {
  const metrics = buildDashboardMetrics({
    classes: [],
    students: [],
    opsTasks: [
      {
        id: "reg-done",
        type: "registration",
        status: "done",
        subject: "영어",
        createdAt: "2026-05-01T09:00:00+09:00",
        completedAt: "2026-05-08T09:00:00+09:00",
        registration: {
          pipelineStatus: "7. 등록 완료",
          classStartDate: "2026-05-10",
        },
      },
      {
        id: "reg-open",
        type: "registration",
        status: "in_progress",
        subject: "수학",
        createdAt: "2026-05-03T09:00:00+09:00",
        registration: {
          pipelineStatus: "5. 등록 신청",
        },
      },
      {
        id: "reg-canceled",
        type: "registration",
        status: "canceled",
        subject: "영어",
        createdAt: "2026-04-20T09:00:00+09:00",
        registration: {
          pipelineStatus: "8. 미등록",
        },
      },
      {
        id: "withdrawal-done",
        type: "withdrawal",
        status: "done",
        subject: "수학",
        createdAt: "2026-05-05T09:00:00+09:00",
        withdrawal: {
          withdrawalDate: "2026-05-31",
        },
      },
      {
        id: "withdrawal-open",
        type: "withdrawal",
        status: "in_progress",
        subject: "영어",
        createdAt: "2026-04-05T09:00:00+09:00",
        withdrawal: {
          withdrawalDate: "2026-04-30",
        },
      },
    ],
  });

  assert.equal(metrics.operationProcessStats.registration.total, 3);
  assert.equal(metrics.operationProcessStats.registration.completed, 1);
  assert.equal(metrics.operationProcessStats.registration.canceled, 1);
  assert.equal(metrics.operationProcessStats.registration.open, 1);
  assert.equal(metrics.operationProcessStats.registration.conversionRate, 33.3);

  const registrationMay = metrics.operationProcessStats.registration.byPeriod.find((row) => row.label === "2026-05");
  assert.equal(registrationMay.total, 2);
  assert.equal(registrationMay.completed, 1);

  const registrationEnglish = metrics.operationProcessStats.registration.byDepartment.find((row) => row.label === "영어");
  assert.equal(registrationEnglish.total, 2);
  assert.equal(registrationEnglish.completed, 1);
  assert.equal(registrationEnglish.canceled, 1);

  assert.equal(metrics.operationProcessStats.withdrawal.total, 2);
  assert.equal(metrics.operationProcessStats.withdrawal.completed, 1);
  assert.equal(metrics.operationProcessStats.withdrawal.open, 1);
  assert.equal(metrics.operationProcessStats.withdrawal.completionRate, 50);

  const withdrawalMay = metrics.operationProcessStats.withdrawal.byPeriod.find((row) => row.label === "2026-05");
  assert.equal(withdrawalMay.total, 1);
  assert.equal(withdrawalMay.completed, 1);

  const withdrawalMath = metrics.operationProcessStats.withdrawal.byDepartment.find((row) => row.label === "수학");
  assert.equal(withdrawalMath.total, 1);
  assert.equal(withdrawalMath.completed, 1);
});

test("dashboard loads and renders registration withdrawal operation stats", async () => {
  const root = new URL("../", import.meta.url);
  const [hookSource, sectionCardsSource] = await Promise.all([
    readFile(new URL("src/hooks/use-tips-dashboard-metrics.ts", root), "utf8"),
    readFile(new URL("src/app/admin/dashboard/components/section-cards.tsx", root), "utf8"),
  ]);

  for (const value of [
    'readTable("ops_tasks"',
    'readTable("ops_registration_details"',
    'readTable("ops_withdrawal_details"',
    "buildDashboardOpsTasks",
  ]) {
    assert.ok(hookSource.includes(value), value);
  }

  for (const value of [
    "operationProcessStats",
    "OperationProcessPanel",
    "등록/퇴원 운영",
    "기간별",
    "부서별",
    "전환율",
  ]) {
    assert.ok(sectionCardsSource.includes(value), value);
  }
});
