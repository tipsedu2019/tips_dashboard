import assert from "node:assert/strict";
import test from "node:test";

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
  assert.equal(summaries[0].teacherLabel, "Teacher A");
  assert.equal(summaries[0].classroomLabel, "Room 1");
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
