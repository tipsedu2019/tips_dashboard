import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildDashboardConflictRows,
  buildDashboardMetrics,
  buildScheduleCollisionSummary,
  findExamConflictsForClasses,
} from "../src/features/dashboard/metrics.js";
import * as dashboardMetricsModule from "../src/features/dashboard/metrics.js";

const metricsSource = readFileSync(
  new URL("../src/features/dashboard/metrics.js", import.meta.url),
  "utf8",
);

test("dashboard statistics overview slice preserves the legacy subject and division summary", () => {
  const input = {
    classes: [
      {
        id: "math-high",
        name: "수학 고등",
        subject: "수학",
        grade: "고1",
        status: "수업 진행 중",
        schedule: "월 10:00-12:00",
        student_ids: ["student-1", "student-2"],
        waitlist_student_ids: ["student-3"],
      },
      {
        id: "english-middle",
        name: "영어 중등",
        subject: "영어",
        grade: "중2",
        status: "수업 진행 중",
        schedule: "화 10:00-11:00",
        student_ids: ["student-3"],
      },
    ],
    students: [
      { id: "student-1", name: "가학생", grade: "고1", school: "대기고" },
      { id: "student-2", name: "나학생", grade: "고2", school: "중앙고" },
      { id: "student-3", name: "다학생", grade: "중2", school: "중앙중" },
    ],
  };

  const legacy = buildDashboardMetrics(input);
  const slice = dashboardMetricsModule.buildDashboardMetricsSlice(input, {
    tab: "overview",
    subject: "math",
    division: "high",
  });

  assert.deepEqual(slice, {
    summary: legacy.analyticsByView.math.high.summary,
  });
});

test("dashboard statistics students/classes and conflict slices retain aggregate meaning without roster payloads", () => {
  const input = {
    classes: [
      { id: "math-high", name: "수학 고등", subject: "수학", grade: "고1", status: "수업 진행 중", schedule: "월 10:00-12:00", teacher: "김선생", classroom: "1강", student_ids: ["student-1", "student-2"] },
      { id: "math-high-2", name: "수학 고등2", subject: "수학", grade: "고1", status: "수업 진행 중", schedule: "월 11:00-13:00", teacher: "김선생", classroom: "1강", student_ids: ["student-1"] },
    ],
    students: [
      { id: "student-1", name: "가학생", grade: "고1", school: "대기고" },
      { id: "student-2", name: "나학생", grade: "고1", school: "중앙고" },
    ],
    now: new Date("2026-08-14T00:00:00.000Z"),
  };
  const studentsClasses = dashboardMetricsModule.buildDashboardMetricsSlice(input, {
    tab: "students_classes", subject: "math", division: "high",
  });
  const conflicts = dashboardMetricsModule.buildDashboardMetricsSlice(input, {
    tab: "schedule_conflicts", dateFrom: "2026-08-14", dateTo: "2026-11-12",
  });

  assert.equal(studentsClasses.summary.registeredEnrollmentCount, 3);
  assert.deepEqual(studentsClasses.studentBreakdowns.byGrade[0], {
    key: "고1", label: "고1", enrollmentCount: 3, studentCount: 2,
    children: [
      { key: "대기고", label: "대기고", enrollmentCount: 2, studentCount: 1 },
      { key: "중앙고", label: "중앙고", enrollmentCount: 1, studentCount: 1 },
    ],
  });
  assert.equal("studentRoster" in studentsClasses.studentBreakdowns.byGrade[0], false);
  assert.equal("classSummaries" in studentsClasses.classGroups.byTeacher[0], false);
  assert.equal(conflicts.teacherConflicts.length, 1);
  assert.equal(conflicts.classroomConflicts.length, 1);
  assert.deepEqual(conflicts.examConflicts, []);
});

test("dashboard statistics textbook slice counts only the requested period and active-class assignment", () => {
  const slice = dashboardMetricsModule.buildDashboardMetricsSlice({
    classes: [
      { id: "assigned", subject: "수학", status: "수업 진행 중", textbook_id: "book-1" },
      { id: "unassigned", subject: "수학", status: "수업 진행 중" },
      { id: "english", subject: "영어", status: "수업 진행 중", textbook_id: "book-2" },
    ],
    textbooks: [{ id: "book-1", subject: "수학" }, { id: "book-2", subject: "영어" }],
    progressLogs: [
      { status: "pending", updated_at: "2026-07-01T10:00:00.000Z" },
      { status: "partial", updated_at: "2026-07-15T10:00:00.000Z" },
      { status: "done", updated_at: "2026-08-01T10:00:00.000Z" },
      { status: "done", updated_at: "2026-06-01T10:00:00.000Z" },
    ],
  }, {
    tab: "textbooks", subject: "math", dateFrom: "2026-07-01", dateTo: "2026-07-31",
  });

  assert.deepEqual(slice, {
    range: { dateFrom: "2026-07-01", dateTo: "2026-07-31" },
    activeTitles: 1,
    activeClassesWithTextbook: 1,
    activeClassesWithoutTextbook: 1,
    progressSessions: { pending: 1, partial: 1, done: 0 },
    updatedProgressSessions: 2,
  });
});

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

test("uses the legacy exam day when a modern detail has no subject date", () => {
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

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].conflicts[0].rule, "day-before-other-subject");
  assert.equal(conflicts[0].conflicts[0].examDate, "2026-04-29");
});

test("uses the legacy exam day when annual board coverage has no subject detail for that date", () => {
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

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].conflicts[0].rule, "day-before-other-subject");
  assert.equal(conflicts[0].conflicts[0].examDate, "2026-04-29");
});

test("prefers modern subject detail over legacy subjects on the same exam date", () => {
  const classes = [
    {
      id: "science-a",
      name: "Science A",
      subject: "Science",
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
    { id: "event-1", title: "Midterm", school_id: "school-1" },
  ];
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
      id: "detail-1",
      academic_event_id: "event-1",
      school_id: "school-1",
      grade: "G1",
      subject: "Math",
      exam_date: "2026-04-29",
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

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].conflicts[0].rule, "day-before-other-subject");
  assert.equal(conflicts[0].conflicts[0].label, "수학 시험 전날");
  assert.deepEqual(conflicts[0].conflicts[0].examEventIds, ["event-1"]);
  assert.deepEqual(conflicts[0].conflicts[0].examDetailIds, ["detail-1"]);
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

test("detects science exam events saved directly on the annual board", () => {
  const classes = [
    {
      id: "science-high-1",
      name: "대기고1 과학",
      subject: "과학",
      schedule_plan: {
        sessions: [{ state: "active", date: "2026-04-29" }],
      },
      student_ids: ["student-1"],
    },
  ];
  const students = [{ id: "student-1", name: "김과학", school: "대기고", grade: "고1" }];
  const academicSchools = [{ id: "school-1", name: "대기고" }];
  const academicEvents = [
    {
      id: "event-science-exam",
      title: "통합과학 시험",
      school_id: "school-1",
      grade: "고1",
      type: "과학시험일",
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
  assert.equal(conflicts[0].conflicts[0].rule, "same-day-subject");
  assert.equal(conflicts[0].conflicts[0].subject, "과학");
  assert.equal(conflicts[0].conflicts[0].examDate, "2026-04-29");
  assert.deepEqual(conflicts[0].conflicts[0].students, ["김과학"]);
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

test("deduplicates normalized classroom labels in the math high dashboard bucket", () => {
  const metrics = buildDashboardMetrics({
    classes: [
      {
        id: "repeated-room-class",
        name: "고1 공통수학",
        subject: "수학",
        grade: "고1",
        status: "수업 진행 중",
        schedule: "월 19:00-20:00\n수 19:00-20:00\n금 19:00-20:00",
        teacher: "김성은",
        classroom: "별관 5강(월), 별관 5강(수), 본관 2강(금)",
        student_ids: ["student-1"],
      },
    ],
    students: [{ id: "student-1", name: "A", grade: "고1" }],
  });

  const bucket = metrics.analyticsByView.math.high;
  assert.equal(
    bucket.classBreakdowns.byGrade[0].classSummaries[0].classroomLabel,
    "별관 5강, 본관 2강",
  );
  assert.equal(
    bucket.classBreakdowns.byClassroom.find((row) => row.label === "별관 5강").enrollmentCount,
    1,
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

test("builds independent science buckets and sorted dashboard rosters", () => {
  const metrics = buildDashboardMetrics({
    classes: [
      {
        id: "science-high-1",
        name: "고1 통합과학2",
        subject: "science",
        grade: "고1",
        status: "수업 진행 중",
        teacher: "김과학",
        classroom: "별관 4강",
        student_ids: ["student-2", "student-1", "student-2"],
      },
      {
        id: "english-high-1",
        name: "고1 영어",
        subject: "english",
        grade: "고1",
        status: "수업 진행 중",
        student_ids: ["student-3"],
      },
    ],
    students: [
      { id: "student-1", name: "가학생", school: "대기고", grade: "고1" },
      { id: "student-2", name: "나학생", school: "대기고", grade: "고1" },
      { id: "student-3", name: "영학생", school: "중앙여고", grade: "고1" },
    ],
  });

  const science = metrics.analyticsByView.science.high;
  assert.equal(science.summary.activeClassesCount, 1);
  assert.equal(science.summary.uniqueRegisteredStudentCount, 2);
  assert.deepEqual(
    science.studentBreakdowns.byGrade[0].schools[0].studentRoster,
    [
      { id: "student-1", name: "가학생", school: "대기고", grade: "고1" },
      { id: "student-2", name: "나학생", school: "대기고", grade: "고1" },
    ],
  );
  assert.deepEqual(
    science.studentBreakdowns.bySchool[0].grades[0].studentRoster.map((student) => student.name),
    ["가학생", "나학생"],
  );
  assert.deepEqual(
    science.classBreakdowns.byGrade[0].classSummaries[0].studentRoster.map((student) => student.name),
    ["가학생", "나학생"],
  );
  assert.equal(metrics.analyticsByView.english.high.summary.activeClassesCount, 1);
});

test("builds student breakdowns once per dashboard analytics bucket", () => {
  const summaryStart = metricsSource.indexOf("function buildDashboardBucketSummary");
  const bucketStart = metricsSource.indexOf("function buildDashboardAnalyticsBucket");
  const nextFunctionStart = metricsSource.indexOf(
    "function buildDashboardAnalyticsBySubject",
    bucketStart,
  );
  const summarySource = metricsSource.slice(summaryStart, bucketStart);
  const bucketSource = metricsSource.slice(bucketStart, nextFunctionStart);

  assert.equal(
    [...bucketSource.matchAll(/buildStudentBreakdowns\(classes, students\)/g)].length,
    1,
  );
  assert.doesNotMatch(summarySource, /buildStudentBreakdowns\(/);
  assert.match(
    bucketSource,
    /summary: buildDashboardBucketSummary\(classes, studentBreakdowns\)/,
  );
  assert.equal(
    [...summarySource.matchAll(/getWeeklyMinutesForClasses\(classes\)/g)].length,
    1,
  );
});

function buildWeeklyConflictFixture({
  now = "2026-07-23T09:00:00+09:00",
  reverse = false,
  teacher = "김과학",
  classroom = "별관 4강",
  secondStart = "10:30",
} = {}) {
  const classes = [
    {
      id: "class-a",
      name: "고1 통합과학 A",
      subject: "과학",
      grade: "고1",
      status: "수업 진행 중",
      schedule: "월 10:00-11:00",
      teacher,
      classroom,
      student_ids: ["student-registered"],
      waitlist_student_ids: ["student-waitlist"],
    },
    {
      id: "class-b",
      name: "고1 통합과학 B",
      subject: "science",
      grade: "고1",
      status: "수업 진행 중",
      schedule: `월 ${secondStart}-11:30`,
      teacher,
      classroom,
      student_ids: ["student-registered"],
      waitlist_student_ids: ["student-waitlist"],
    },
  ];

  return buildDashboardMetrics({
    classes: reverse ? [...classes].reverse() : classes,
    students: [
      {
        id: "student-registered",
        name: "등록학생",
        class_ids: ["class-b", "class-a", "class-a"],
      },
      {
        id: "student-waitlist",
        name: "대기학생",
        waitlist_class_ids: ["class-a", "class-b"],
      },
    ],
    teacherCatalogs: [
      {
        id: "teacher-catalog-science",
        name: teacher,
        profile_id: "profile-science",
      },
    ],
    classroomCatalogs: [
      {
        id: "classroom-catalog-annex-4",
        name: classroom,
      },
    ],
    now,
  });
}

test("normalizes weekly conflicts with stable source-based keys and registered rosters", () => {
  const metrics = buildWeeklyConflictFixture();
  const weeklyRows = metrics.conflictRows.filter((row) => row.occurrenceKind === "weekly");

  assert.deepEqual(
    [...new Set(weeklyRows.map((row) => row.type))].sort(),
    ["classroom", "student", "teacher"],
  );
  assert.equal(metrics.riskCount, metrics.conflictRows.length);
  assert.equal(weeklyRows.filter((row) => row.type === "student").length, 1);
  assert.equal(
    weeklyRows.find((row) => row.type === "teacher").key,
    "weekly:v1:teacher:월:10:30-11:00:class-a:class-b",
  );
  assert.equal(
    weeklyRows.find((row) => row.type === "student").key,
    "weekly:v1:student:월:10:30-11:00:class-a:class-b:student-registered",
  );
  assert.deepEqual(
    weeklyRows.find((row) => row.type === "student").affectedStudentIds,
    ["student-registered"],
  );
  assert.ok(weeklyRows.every((row) => !row.affectedStudentIds.includes("student-waitlist")));
  assert.deepEqual(
    weeklyRows.find((row) => row.type === "teacher").source.teacherCatalogIds,
    ["teacher-catalog-science"],
  );
  assert.deepEqual(
    weeklyRows.find((row) => row.type === "classroom").source.classroomCatalogIds,
    ["classroom-catalog-annex-4"],
  );
  assert.equal(
    weeklyRows.find((row) => row.type === "teacher").primaryAssigneeProfileId,
    "profile-science",
  );
  assert.ok(weeklyRows.every((row) => row.subject === "과학"));
});

test("weekly keys ignore pair order and mutable resource names but include overlap time", () => {
  const first = buildWeeklyConflictFixture();
  const reversed = buildWeeklyConflictFixture({ reverse: true });
  const renamed = buildWeeklyConflictFixture({
    teacher: "새 과학 선생님",
    classroom: "별관 과학실",
  });
  const shifted = buildWeeklyConflictFixture({ secondStart: "10:45" });
  const nextWeek = buildWeeklyConflictFixture({ now: "2026-07-30T09:00:00+09:00" });

  for (const type of ["teacher", "classroom", "student"]) {
    const firstRow = first.conflictRows.find((row) => row.type === type);
    const reversedRow = reversed.conflictRows.find((row) => row.type === type);
    const renamedRow = renamed.conflictRows.find((row) => row.type === type);
    const shiftedRow = shifted.conflictRows.find((row) => row.type === type);
    const nextWeekRow = nextWeek.conflictRows.find((row) => row.type === type);

    assert.equal(reversedRow.key, firstRow.key, `${type} reversed pair`);
    assert.equal(renamedRow.key, firstRow.key, `${type} renamed resource`);
    assert.notEqual(shiftedRow.key, firstRow.key, `${type} shifted overlap`);
    assert.equal(nextWeekRow.key, firstRow.key, `${type} next week`);
    assert.notEqual(nextWeekRow.nextOccurrenceAt, firstRow.nextOccurrenceAt, `${type} occurrence`);
  }
});

test("normalizes future science exam conflicts and preserves event, detail, and student IDs", () => {
  const metrics = buildDashboardMetrics({
    classes: [
      {
        id: "science-exam-class",
        name: "고1 통합과학2",
        subject: "science",
        status: "수업 진행 중",
        schedule: "목 10:00-11:00",
        schedule_plan: {
          sessions: [{ state: "active", date: "2026-07-23" }],
        },
        teacher: "김과학",
        classroom: "별관 4강",
        student_ids: ["student-1"],
      },
    ],
    students: [{ id: "student-1", name: "과학학생", school: "대기고", grade: "고1" }],
    academicSchools: [{ id: "school-1", name: "대기고" }],
    academicEvents: [
      {
        id: "event-science",
        title: "통합과학 시험",
        school_id: "school-1",
        grade: "고1",
        type: "시험기간",
      },
    ],
    academicEventExamDetails: [
      {
        id: "detail-science",
        academic_event_id: "event-science",
        school_id: "school-1",
        grade: "고1",
        subject: "과학",
        exam_date: "2026-07-23",
      },
    ],
    teacherCatalogs: [
      {
        id: "teacher-catalog-science",
        name: "김과학",
        profile_id: "profile-science",
      },
    ],
    now: "2026-07-23T09:00:00+09:00",
  });

  const row = metrics.conflictRows.find((item) => item.type === "exam");
  assert.ok(row);
  assert.equal(row.key, "exam:v1:science-exam-class:2026-07-23:same-day-subject");
  assert.equal(row.subject, "과학");
  assert.deepEqual(row.affectedStudentIds, ["student-1"]);
  assert.deepEqual(row.source.studentIds, ["student-1"]);
  assert.deepEqual(row.source.examEventIds, ["event-science"]);
  assert.deepEqual(row.source.examDetailIds, ["detail-science"]);
  assert.equal(row.source.examRule, "same-day-subject");
  assert.equal(metrics.riskCount, metrics.conflictRows.length);
});

test("omits past dated conflicts and applies the mixed next-day subject rule", () => {
  const base = {
    classes: [
      {
        id: "science-class",
        name: "과학 수업",
        subject: "과학",
        status: "수업 진행 중",
        schedule: "수금 10:00-11:00",
        schedule_plan: {
          sessions: [
            { state: "active", date: "2026-07-22" },
            { state: "active", date: "2026-07-24" },
          ],
        },
        student_ids: ["student-1"],
      },
    ],
    students: [{ id: "student-1", name: "학생", school: "대기고", grade: "고1" }],
    academicSchools: [{ id: "school-1", name: "대기고" }],
    academicEvents: [{ id: "event-1", school_id: "school-1", grade: "고1", type: "시험기간" }],
    now: "2026-07-23T09:00:00+09:00",
  };

  const mixedSubjects = buildDashboardConflictRows({
    ...base,
    academicEventExamDetails: [
      {
        id: "detail-past",
        academic_event_id: "event-1",
        school_id: "school-1",
        grade: "고1",
        subject: "과학",
        exam_date: "2026-07-22",
      },
      {
        id: "detail-science",
        academic_event_id: "event-1",
        school_id: "school-1",
        grade: "고1",
        subject: "과학",
        exam_date: "2026-07-25",
      },
      {
        id: "detail-math",
        academic_event_id: "event-1",
        school_id: "school-1",
        grade: "고1",
        subject: "수학",
        exam_date: "2026-07-25",
      },
    ],
  });

  assert.equal(mixedSubjects.filter((row) => row.type === "exam").length, 0);

  const otherSubjects = buildDashboardConflictRows({
    ...base,
    academicEventExamDetails: [
      {
        id: "detail-math",
        academic_event_id: "event-1",
        school_id: "school-1",
        grade: "고1",
        subject: "수학",
        exam_date: "2026-07-25",
      },
      {
        id: "detail-english",
        academic_event_id: "event-1",
        school_id: "school-1",
        grade: "고1",
        subject: "영어",
        exam_date: "2026-07-25",
      },
    ],
  });

  assert.equal(otherSubjects.filter((row) => row.type === "exam").length, 1);
  assert.equal(
    otherSubjects.find((row) => row.type === "exam").source.examRule,
    "day-before-other-subject",
  );
});
