import { ACTIVE_CLASS_STATUS, computeClassStatus } from "../../lib/class-status.js";
import {
  buildTimetableWorkspaceModel,
  parseAcademicSchedule,
  splitClassroomList,
  splitTeacherList,
  stripClassPrefix,
} from "../academic/records.js";
import { normalizeAcademicEventType } from "../operations/academic-event-utils.js";

function text(value) {
  return String(value || "").trim();
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // String arrays may also arrive as comma-separated values.
    }

    return trimmed.split(",").map(text).filter(Boolean);
  }

  return [];
}

function unique(values = []) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function sortedIds(values = []) {
  return unique(values).sort();
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function classNameOf(classItem = {}) {
  return (
    stripClassPrefix(classItem.className || classItem.class_name || classItem.name) ||
    text(classItem.name || classItem.className || classItem.class_name) ||
    "이름 없는 수업"
  );
}

function classFullNameOf(classItem = {}) {
  return text(classItem.className || classItem.class_name || classItem.name) || classNameOf(classItem);
}

function studentNameOf(student = {}) {
  return text(student.name) || text(student.id) || "이름 미정";
}

function buildStudentLookup(students = []) {
  return new Map(students.map((student) => [text(student.id), student]));
}

function getStudentIds(classItem = {}) {
  return unique(toArray(classItem.student_ids || classItem.studentIds));
}

function getWaitlistIds(classItem = {}) {
  return unique(
    toArray(
      classItem.waitlist_student_ids ||
        classItem.waitlistStudentIds ||
        classItem.waitlist_ids ||
        classItem.waitlistIds,
    ),
  );
}

function getStudentClassIds(student = {}, key) {
  if (key === "waitlist") {
    return unique(
      toArray(
        student.waitlist_class_ids ||
          student.waitlistClassIds ||
          student.waitlist_ids ||
          student.waitlistIds,
      ),
    );
  }

  return unique(toArray(student.class_ids || student.classIds));
}

function isActiveClass(classItem = {}) {
  return computeClassStatus(classItem) === ACTIVE_CLASS_STATUS;
}

function timeToMinutes(value) {
  const [hour, minute] = text(value).split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return 0;
  }

  return hour * 60 + minute;
}

function normalizeClockTime(value) {
  const [hour, minute] = text(value).split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return text(value);
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatDashboardHours(totalMinutes) {
  const safeMinutes = Math.max(0, Number(totalMinutes || 0));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}시간 ${minutes}분`;
  }
  if (hours > 0) {
    return `${hours}시간`;
  }
  return `${minutes}분`;
}

function createOverlap(left, right) {
  return {
    day: left.day,
    start: timeToMinutes(left.start) > timeToMinutes(right.start) ? left.start : right.start,
    end: timeToMinutes(left.end) < timeToMinutes(right.end) ? left.end : right.end,
    left,
    right,
  };
}

function dedupeOverlaps(items) {
  return items.filter((candidate, index, array) => (
    index === array.findIndex((item) => (
      item.day === candidate.day &&
      item.start === candidate.start &&
      item.end === candidate.end &&
      [item.left.classId, item.right.classId].sort().join("|") ===
        [candidate.left.classId, candidate.right.classId].sort().join("|")
    ))
  ));
}

function findOverlaps(slots) {
  const overlaps = [];

  for (let index = 0; index < slots.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < slots.length; compareIndex += 1) {
      const left = slots[index];
      const right = slots[compareIndex];

      if (left.day !== right.day || left.classId === right.classId) {
        continue;
      }

      if (
        Math.max(timeToMinutes(left.start), timeToMinutes(right.start)) <
        Math.min(timeToMinutes(left.end), timeToMinutes(right.end))
      ) {
        overlaps.push(createOverlap(left, right));
      }
    }
  }

  return dedupeOverlaps(overlaps);
}

function resolveSlotTeachers(slot, classItem = {}) {
  const classTeachers = splitTeacherList(classItem.teacher || classItem.teacher_name || classItem.teacherName);
  const slotTeacher = text(slot.teacher);
  if (slotTeacher && (!classTeachers.includes(slotTeacher) || classTeachers.length <= 1)) {
    return splitTeacherList(slotTeacher);
  }
  if (slotTeacher && classTeachers.length > 1 && slotTeacher === classTeachers[0]) {
    return classTeachers;
  }
  return splitTeacherList(slotTeacher || classTeachers.join(", "));
}

function resolveSlotClassrooms(slot, classItem = {}) {
  const classClassrooms = splitClassroomList(classItem.classroom || classItem.room);
  const slotClassroom = text(slot.classroom);
  if (slotClassroom && (!classClassrooms.includes(slotClassroom) || classClassrooms.length <= 1)) {
    return splitClassroomList(slotClassroom);
  }
  if (slotClassroom && classClassrooms.length > 1 && slotClassroom === classClassrooms[0]) {
    return classClassrooms;
  }
  return splitClassroomList(slotClassroom || classClassrooms.join(", "));
}

function buildScheduleSlots(classItem = {}) {
  return parseAcademicSchedule(classItem.schedule, classItem).map((slot) => ({
    ...slot,
    classId: text(classItem.id),
    className: classFullNameOf(classItem),
  }));
}

function studentNamesFromIds(ids = [], studentsById = new Map()) {
  return unique(
    ids.map((studentId) => {
      const id = text(studentId);
      return studentNameOf(studentsById.get(id) || { id });
    }),
  ).sort((left, right) => left.localeCompare(right, "ko", { numeric: true }));
}

function dashboardStudentRosterFromIds(ids = [], studentsById = new Map()) {
  return unique(ids.map((studentId) => text(studentId)))
    .filter(Boolean)
    .map((id) => {
      const student = studentsById.get(id);
      return {
        id,
        name: text(student?.name) || "학생 정보 확인 필요",
        school: text(student?.school),
        grade: text(student?.grade),
      };
    })
    .sort((left, right) => (
      left.name.localeCompare(right.name, "ko", { numeric: true }) ||
      left.id.localeCompare(right.id, "ko", { numeric: true })
    ));
}

function buildClassLoadSummary(classItem = {}, studentsById = new Map()) {
  const registeredIds = getStudentIds(classItem);
  const waitlistIds = getWaitlistIds(classItem);

  return {
    id: text(classItem.id) || classFullNameOf(classItem),
    title: classNameOf(classItem),
    scheduleLabel: text(classItem.schedule) || "시간 미정",
    teacherLabel: splitTeacherList(classItem.teacher || classItem.teacher_name || classItem.teacherName).join(", ") || "미정",
    classroomLabel: splitClassroomList(classItem.classroom || classItem.room).join(", ") || "미정",
    registeredCount: registeredIds.length,
    waitlistCount: waitlistIds.length,
    registeredStudents: studentNamesFromIds(registeredIds, studentsById),
    waitlistStudents: studentNamesFromIds(waitlistIds, studentsById),
  };
}

export function buildScheduleCollisionSummary(classes = [], students = []) {
  const teacherSlots = new Map();
  const classroomSlots = new Map();
  const slotsByClassId = new Map();

  classes.forEach((classItem) => {
    const classSlots = buildScheduleSlots(classItem);
    slotsByClassId.set(text(classItem.id), classSlots);

    classSlots.forEach((slot) => {
      resolveSlotTeachers(slot, classItem).forEach((teacher) => {
        if (!teacherSlots.has(teacher)) {
          teacherSlots.set(teacher, []);
        }
        teacherSlots.get(teacher).push(slot);
      });

      resolveSlotClassrooms(slot, classItem).forEach((classroom) => {
        if (!classroomSlots.has(classroom)) {
          classroomSlots.set(classroom, []);
        }
        classroomSlots.get(classroom).push(slot);
      });
    });
  });

  const classIdsByStudentId = new Map();
  classes.forEach((classItem) => {
    const classId = text(classItem.id);
    getStudentIds(classItem).forEach((studentId) => {
      const list = classIdsByStudentId.get(studentId) || [];
      list.push(classId);
      classIdsByStudentId.set(studentId, unique(list));
    });
  });

  const studentsById = new Map((students || []).map((studentItem) => [text(studentItem.id), studentItem]));
  const studentCandidates = [
    ...(students || []),
    ...[...classIdsByStudentId.keys()]
      .filter((studentId) => !studentsById.has(studentId))
      .map((studentId) => ({ id: studentId })),
  ];

  const student = studentCandidates
    .map((studentItem) => {
      const studentClassIds = unique([
        ...getStudentClassIds(studentItem, "registered"),
        ...(classIdsByStudentId.get(text(studentItem.id)) || []),
      ]);

      if (studentClassIds.length < 2) {
        return null;
      }

      const studentSlots = studentClassIds.flatMap((classId) => slotsByClassId.get(classId) || []);
      const overlaps = findOverlaps(studentSlots);
      if (overlaps.length === 0) {
        return null;
      }

      return {
        id: text(studentItem.id) || studentNameOf(studentItem),
        type: "student",
        label: studentNameOf(studentItem),
        meta: [text(studentItem.grade), text(studentItem.school)].filter(Boolean).join(" · "),
        overlaps,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.label.localeCompare(right.label, "ko", { numeric: true }));

  const teacher = [...teacherSlots.entries()]
    .map(([name, slots]) => {
      const overlaps = findOverlaps(slots);
      if (overlaps.length === 0) {
        return null;
      }

      return {
        id: `teacher:${name}`,
        type: "teacher",
        label: name,
        meta: "선생님 시간 충돌",
        overlaps,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.label.localeCompare(right.label, "ko", { numeric: true }));

  const classroom = [...classroomSlots.entries()]
    .map(([name, slots]) => {
      const overlaps = findOverlaps(slots);
      if (overlaps.length === 0) {
        return null;
      }

      return {
        id: `classroom:${name}`,
        type: "classroom",
        label: name,
        meta: "강의실 시간 충돌",
        overlaps,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.label.localeCompare(right.label, "ko", { numeric: true }));

  return {
    student,
    teacher,
    classroom,
    total: student.length + teacher.length + classroom.length,
  };
}

function normalizeSchoolKey(value) {
  return text(value).replace(/\s+/g, "").toLowerCase();
}

function normalizeSubject(value) {
  const raw = text(value);
  const normalized = raw.toLowerCase();
  if (normalized === "english") return "영어";
  if (normalized === "math") return "수학";
  if (normalized === "science") return "과학";
  return raw;
}

const DASHBOARD_SUBJECT_FILTERS = [
  { key: "all", label: "전체", subject: "" },
  { key: "english", label: "영어", subject: "영어" },
  { key: "math", label: "수학", subject: "수학" },
  { key: "science", label: "과학", subject: "과학" },
];

const DASHBOARD_DIVISION_FILTERS = [
  { key: "all", label: "전체" },
  { key: "middle", label: "초중등부" },
  { key: "high", label: "고등부" },
];

function matchesDashboardSubject(classItem = {}, subject = "") {
  const target = normalizeSubject(subject);
  if (!target) {
    return true;
  }
  const current = normalizeSubject(classItem.subject);
  if (target === "영어") {
    return current === target || current.toLowerCase() === "english";
  }
  if (target === "수학") {
    return current === target || current.toLowerCase() === "math";
  }
  return current === target;
}

function gradeText(value) {
  return text(value).replace(/\s+/g, "");
}

function isHighDivisionLabel(value) {
  const label = gradeText(value).toLowerCase();
  return (
    label.includes("고") ||
    label.includes("high") ||
    /^g?(10|11|12)$/.test(label) ||
    /^grade(10|11|12)$/.test(label)
  );
}

function isMiddleDivisionLabel(value) {
  const label = gradeText(value).toLowerCase();
  if (!label) return false;
  return (
    label.includes("초") ||
    label.includes("중") ||
    label.includes("elementary") ||
    label.includes("middle") ||
    /^g?[1-9]$/.test(label) ||
    /^grade[1-9]$/.test(label)
  );
}

function matchesDashboardDivisionLabel(value, divisionKey = "high") {
  if (divisionKey === "high") {
    return isHighDivisionLabel(value);
  }
  return isMiddleDivisionLabel(value);
}

function inferClassGradeLabels(classItem = {}, studentsById = new Map()) {
  const directGrades = [
    classItem.grade,
    classItem.gradeName,
    classItem.grade_name,
    classItem.targetGrade,
    classItem.target_grade,
  ].map(gradeText).filter(Boolean);
  const name = classFullNameOf(classItem);
  const nameGrades = unique([
    ...(name.match(/[고중초]\s*\d/g) || []).map((item) => item.replace(/\s+/g, "")),
    ...(name.match(/Grade\s*(?:[1-9]|10|11|12)/gi) || []).map((item) => item.replace(/\s+/g, "")),
  ]);
  const enrolledGrades = getStudentIds(classItem)
    .map((studentId) => gradeText(studentsById.get(studentId)?.grade))
    .filter(Boolean);

  return directGrades.length > 0 ? unique(directGrades) : unique([...nameGrades, ...enrolledGrades]);
}

function matchesDashboardDivision(classItem = {}, studentsById = new Map(), divisionKey = "high") {
  if (divisionKey === "all") {
    return true;
  }

  const gradeLabels = inferClassGradeLabels(classItem, studentsById);
  if (gradeLabels.length === 0) {
    return true;
  }
  return gradeLabels.some((grade) => matchesDashboardDivisionLabel(grade, divisionKey));
}

function parseDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDateString(dateString, amount) {
  const base = parseDateString(dateString);
  if (!base) return "";
  const next = new Date(base);
  next.setDate(next.getDate() + amount);
  return toDateString(next);
}

function resolveSchool(schools = [], student = {}) {
  const targetKey = normalizeSchoolKey(student.school);
  if (!targetKey) return null;
  return (
    schools.find((school) => normalizeSchoolKey(school.name) === targetKey) ||
    schools.find((school) => normalizeSchoolKey(school.school) === targetKey) ||
    null
  );
}

function gradeSelectionOf(value) {
  const raw = text(value || "all");
  if (!raw || raw === "전체" || raw === "all") {
    return ["all"];
  }
  return raw.split(",").map(text).filter(Boolean);
}

function matchesSchoolReference(item = {}, schoolId = "", schoolName = "") {
  return (
    (schoolId && text(item.schoolId || item.school_id) === schoolId) ||
    normalizeSchoolKey(item.school || item.schoolName || item.school_name) === normalizeSchoolKey(schoolName)
  );
}

function matchesGradeReference(item = {}, studentGrade = "") {
  if (!studentGrade) return true;
  const grades = gradeSelectionOf(item.grade || "all");
  return grades.includes("all") || grades.includes(studentGrade);
}

function subjectOfExamEventType(value) {
  const type = normalizeAcademicEventType(value);
  if (type === "영어시험일") return "영어";
  if (type === "수학시험일") return "수학";
  if (type === "과학시험일") return "과학";
  return "";
}

function buildExamDetailRows(academicEventExamDetails = [], academicEvents = []) {
  const eventMap = new Map((academicEvents || []).map((event) => [text(event.id), event]));
  const detailRows = (academicEventExamDetails || [])
    .map((detail) => {
      const event = eventMap.get(text(detail.academicEventId || detail.academic_event_id));
      return {
        detailId: text(detail.id),
        academicEventId: text(detail.academicEventId || detail.academic_event_id || event?.id),
        schoolId: text(detail.schoolId || detail.school_id || event?.schoolId || event?.school_id),
        school: text(detail.school || event?.school),
        grade: text(detail.grade || event?.grade || "all"),
        subject: normalizeSubject(detail.subject),
        examDate: text(detail.examDate || detail.exam_date),
        label: text(event?.title || detail.label || "시험"),
        note: text(detail.note),
      };
    })
    .filter((row) => row.subject);

  const subjectEventRows = (academicEvents || [])
    .map((event) => {
      const type = normalizeAcademicEventType(event.type || event.typeLabel || event.type_label);
      const subject = subjectOfExamEventType(type);
      if (!subject) return null;

      return {
        detailId: "",
        academicEventId: text(event.id),
        schoolId: text(event.schoolId || event.school_id),
        school: text(event.school || event.schoolName || event.school_name),
        grade: text(event.grade || "all"),
        subject,
        examDate: text(event.examDate || event.exam_date || event.start || event.start_date || event.date),
        label: text(event.title || type || "시험"),
        note: text(event.note),
      };
    })
    .filter(Boolean);

  return [...detailRows, ...subjectEventRows];
}

function getRelevantExamRows(student, academicSchools = [], detailRows = [], legacyExamDays = []) {
  const school = resolveSchool(academicSchools, student);
  const schoolId = school ? text(school.id) : "";
  const schoolName = text(school?.name || student.school);
  const studentGrade = text(student.grade);

  const modernRows = (detailRows || []).filter((item) => {
    if (!matchesSchoolReference(item, schoolId, schoolName)) return false;
    return matchesGradeReference(item, studentGrade);
  });

  const legacyRows = (legacyExamDays || []).filter((item) => {
    if (!matchesSchoolReference(item, schoolId, schoolName)) return false;
    return matchesGradeReference(item, studentGrade);
  });
  const modernDates = new Set(
    modernRows
      .map((item) => text(item.examDate))
      .filter(Boolean),
  );
  const fallbackRows = legacyRows
    .filter((item) => !modernDates.has(text(item.examDate || item.exam_date)))
    .map((item) => ({
      detailId: "",
      academicEventId: "",
      schoolId: text(item.schoolId || item.school_id),
      school: text(item.school),
      grade: text(item.grade || "all"),
      subject: normalizeSubject(item.subject),
      examDate: text(item.examDate || item.exam_date),
      label: text(item.label || "시험"),
      note: text(item.note),
    }));

  return {
    schoolName,
    grade: studentGrade || "all",
    rows: [...modernRows, ...fallbackRows],
  };
}

function buildStudentExamLookup(student, academicSchools = [], detailRows = [], legacyExamDays = []) {
  const examInfo = getRelevantExamRows(student, academicSchools, detailRows, legacyExamDays);
  const lookup = new Map();
  const rowsByDate = new Map();

  examInfo.rows.forEach((item) => {
    const date = text(item.examDate);
    const subject = normalizeSubject(item.subject);
    if (!date || !subject) return;
    if (!lookup.has(date)) {
      lookup.set(date, new Set());
    }
    lookup.get(date).add(subject);
    if (!rowsByDate.has(date)) {
      rowsByDate.set(date, []);
    }
    rowsByDate.get(date).push(item);
  });

  return {
    schoolName: examInfo.schoolName,
    grade: examInfo.grade,
    rows: examInfo.rows,
    rowsByDate,
    lookup,
  };
}

function getEnrolledStudentsForClass(classItem, students = []) {
  const enrolledIds = new Set(getStudentIds(classItem));
  return (students || []).filter((student) => enrolledIds.has(text(student.id)));
}

function getSchedulePlanSessionDates(classItem) {
  const plan = parseJsonObject(classItem.schedulePlan || classItem.schedule_plan);
  const sessions = plan?.sessions;
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return [];
  }

  return sessions
    .filter((session) => {
      const state = text(session.scheduleState || session.schedule_state || session.state) || "active";
      return ["active", "makeup"].includes(state);
    })
    .map((session) => text(session.date || session.dateValue || session.date_value))
    .filter(Boolean);
}

function dayLabelToIndex(day) {
  return ["일", "월", "화", "수", "목", "금", "토"].indexOf(text(day));
}

function getFallbackScheduleDates(classItem) {
  const start = parseDateString(text(classItem.startDate || classItem.start_date));
  const end = parseDateString(text(classItem.endDate || classItem.end_date));
  if (!start || !end || start > end) {
    return [];
  }

  const slots = parseAcademicSchedule(classItem.schedule || "", classItem);
  const dayIndexes = [...new Set(slots.map((slot) => dayLabelToIndex(slot.day)).filter((value) => value >= 0))];
  if (dayIndexes.length === 0) {
    return [];
  }

  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    if (dayIndexes.includes(cursor.getDay())) {
      dates.push(toDateString(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function getClassSessionDates(classItem) {
  const schedulePlanDates = getSchedulePlanSessionDates(classItem);
  return schedulePlanDates.length > 0 ? schedulePlanDates : getFallbackScheduleDates(classItem);
}

export function getClassExamConflictsForDates(
  classItem,
  sessionDatesInput = [],
  students = [],
  academicSchools = [],
  academicExamDays = [],
  academicEventExamDetails = [],
  academicEvents = [],
) {
  const subject = normalizeSubject(classItem?.subject);
  if (!subject) return [];

  const enrolledStudents = getEnrolledStudentsForClass(classItem, students);
  if (enrolledStudents.length === 0) return [];

  const sessionDates = unique(sessionDatesInput).sort();
  if (sessionDates.length === 0) return [];

  const detailRows = buildExamDetailRows(academicEventExamDetails, academicEvents);
  const conflictMap = new Map();

  enrolledStudents.forEach((student) => {
    const examInfo = buildStudentExamLookup(student, academicSchools, detailRows, academicExamDays);

    sessionDates.forEach((sessionDate) => {
      const sameDaySubjects = examInfo.lookup.get(sessionDate);
      if (sameDaySubjects?.has(subject)) {
        const key = `same-day:${sessionDate}`;
        if (!conflictMap.has(key)) {
          conflictMap.set(key, {
            rule: "same-day-subject",
            subject,
            examDate: sessionDate,
            sessionDate,
            label: `${subject} 시험`,
            note: "",
            students: [],
            studentIds: [],
            examEventIds: [],
            examDetailIds: [],
            schoolName: examInfo.schoolName,
            grade: examInfo.grade,
            message: `${subject} 시험 당일`,
          });
        }
        const entry = conflictMap.get(key);
        if (!entry.students.includes(studentNameOf(student))) {
          entry.students.push(studentNameOf(student));
        }
        entry.studentIds = unique([...entry.studentIds, text(student.id)]);
        const sameDayRows = (examInfo.rowsByDate.get(sessionDate) || [])
          .filter((row) => normalizeSubject(row.subject) === subject);
        entry.examEventIds = unique([
          ...entry.examEventIds,
          ...sameDayRows.map((row) => row.academicEventId),
        ]);
        entry.examDetailIds = unique([
          ...entry.examDetailIds,
          ...sameDayRows.map((row) => row.detailId),
        ]);
      }

      const nextDate = shiftDateString(sessionDate, 1);
      const nextDaySubjects = examInfo.lookup.get(nextDate);
      if (nextDaySubjects && nextDaySubjects.size > 0 && !nextDaySubjects.has(subject)) {
        const nextSubjects = [...nextDaySubjects].sort();
        const key = `day-before:${sessionDate}`;
        if (!conflictMap.has(key)) {
          conflictMap.set(key, {
            rule: "day-before-other-subject",
            subject,
            examDate: nextDate,
            sessionDate,
            label: `${nextSubjects.join(", ")} 시험 전날`,
            note: "",
            students: [],
            studentIds: [],
            examEventIds: [],
            examDetailIds: [],
            schoolName: examInfo.schoolName,
            grade: examInfo.grade,
            message: `${nextSubjects.join(", ")} 시험 전날`,
          });
        }
        const entry = conflictMap.get(key);
        if (!entry.students.includes(studentNameOf(student))) {
          entry.students.push(studentNameOf(student));
        }
        entry.studentIds = unique([...entry.studentIds, text(student.id)]);
        const nextDayRows = examInfo.rowsByDate.get(nextDate) || [];
        entry.examEventIds = unique([
          ...entry.examEventIds,
          ...nextDayRows.map((row) => row.academicEventId),
        ]);
        entry.examDetailIds = unique([
          ...entry.examDetailIds,
          ...nextDayRows.map((row) => row.detailId),
        ]);
      }
    });
  });

  return [...conflictMap.values()].sort((left, right) => {
    const dateDiff = String(left.sessionDate).localeCompare(String(right.sessionDate));
    return dateDiff !== 0 ? dateDiff : String(left.rule).localeCompare(String(right.rule));
  });
}

export function findExamConflictsForClasses(
  classes = [],
  students = [],
  academicSchools = [],
  academicExamDays = [],
  academicEventExamDetails = [],
  academicEvents = [],
) {
  return (classes || [])
    .map((classItem) => ({
      classId: text(classItem.id),
      className: classFullNameOf(classItem),
      title: classNameOf(classItem),
      subject: text(classItem.subject),
      teacherLabel: splitTeacherList(classItem.teacher || classItem.teacher_name || classItem.teacherName).join(", ") || "미정",
      conflicts: getClassExamConflictsForDates(
        classItem,
        getClassSessionDates(classItem),
        students,
        academicSchools,
        academicExamDays,
        academicEventExamDetails,
        academicEvents,
      ),
    }))
    .filter((entry) => entry.conflicts.length > 0)
    .sort((left, right) => left.title.localeCompare(right.title, "ko", { numeric: true }));
}

const SEOUL_TIME_ZONE = "Asia/Seoul";
const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function normalizedName(value) {
  return text(value).replace(/\s+/g, "").toLowerCase();
}

function dateStringToUtcDate(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(dateString))) {
    return null;
  }
  const [year, month, day] = text(dateString).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function shiftUtcDateString(dateString, amount) {
  const date = dateStringToUtcDate(dateString);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + amount);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function weekdayForDateString(dateString) {
  const date = dateStringToUtcDate(dateString);
  return date ? WEEKDAY_LABELS[date.getUTCDay()] : "";
}

function getSeoulClockParts(now) {
  const date = now instanceof Date ? now : new Date(now || Date.now());
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: SEOUL_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(safeDate)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const dateString = `${parts.year}-${parts.month}-${parts.day}`;

  return {
    dateString,
    weekday: weekdayForDateString(dateString),
    minutes: Number(parts.hour || 0) * 60 + Number(parts.minute || 0),
  };
}

function nextWeeklyOccurrenceAt(weekday, start, now) {
  const clock = getSeoulClockParts(now);
  const currentIndex = WEEKDAY_LABELS.indexOf(clock.weekday);
  const targetIndex = WEEKDAY_LABELS.indexOf(text(weekday));
  if (currentIndex < 0 || targetIndex < 0 || !text(start)) {
    return "";
  }

  let dayOffset = (targetIndex - currentIndex + 7) % 7;
  if (dayOffset === 0 && timeToMinutes(start) <= clock.minutes) {
    dayOffset = 7;
  }
  const nextDate = shiftUtcDateString(clock.dateString, dayOffset);
  return nextDate ? `${nextDate}T${text(start)}:00+09:00` : "";
}

function datedOccurrenceAt(classItem, sessionDate) {
  const weekday = weekdayForDateString(sessionDate);
  const matchingStarts = buildScheduleSlots(classItem)
    .filter((slot) => !weekday || slot.day === weekday)
    .map((slot) => text(slot.start))
    .filter(Boolean)
    .sort();
  const start = normalizeClockTime(matchingStarts[0] || "00:00");
  return `${sessionDate}T${start}:00+09:00`;
}

function weeklyConflictKey(
  type,
  { weekday, overlapStart, overlapEnd, classIds, studentId = "" },
) {
  const identity = [
    "weekly",
    "v1",
    type,
    text(weekday),
    `${normalizeClockTime(overlapStart)}-${normalizeClockTime(overlapEnd)}`,
    ...sortedIds(classIds),
  ];
  if (text(studentId)) {
    identity.push(text(studentId));
  }
  return identity.join(":");
}

function catalogRowsForClasses(classes, catalogs, kind, preferredNames = []) {
  const preferredKeys = new Set(preferredNames.map(normalizedName).filter(Boolean));
  const explicitIds = new Set(
    classes.flatMap((classItem) => {
      if (kind === "teacher") {
        return [
          ...toArray(classItem.teacher_catalog_ids || classItem.teacherCatalogIds),
          classItem.teacher_catalog_id,
          classItem.teacherCatalogId,
          classItem.teacher_id,
          classItem.teacherId,
        ];
      }
      return [
        ...toArray(classItem.classroom_catalog_ids || classItem.classroomCatalogIds),
        classItem.classroom_catalog_id,
        classItem.classroomCatalogId,
        classItem.classroom_id,
        classItem.classroomId,
      ];
    }).map(text).filter(Boolean),
  );
  const fallbackNames = kind === "teacher"
    ? classes.flatMap((classItem) => splitTeacherList(
      classItem.teacher || classItem.teacher_name || classItem.teacherName,
    ))
    : classes.flatMap((classItem) => splitClassroomList(classItem.classroom || classItem.room));
  const nameKeys = preferredKeys.size > 0
    ? preferredKeys
    : new Set(fallbackNames.map(normalizedName).filter(Boolean));

  return (catalogs || []).filter((catalog) => (
    nameKeys.has(normalizedName(catalog.name)) ||
    (preferredKeys.size === 0 && explicitIds.has(text(catalog.id)))
  ));
}

function resolveTeacherOwnership(classes, teacherCatalogs, preferredNames = []) {
  const catalogRows = catalogRowsForClasses(classes, teacherCatalogs, "teacher", preferredNames);
  const profileIds = unique(catalogRows.map((catalog) => catalog.profileId || catalog.profile_id));
  const teacherLabels = unique([
    ...preferredNames,
    ...classes.flatMap((classItem) => splitTeacherList(
      classItem.teacher || classItem.teacher_name || classItem.teacherName,
    )),
  ]);
  const fallbackLabel = teacherLabels.join(", ") || "담당선생님 미정";

  return {
    teacherCatalogIds: sortedIds(catalogRows.map((catalog) => catalog.id)),
    profileIds,
    ownerLabel: profileIds.length > 0 ? fallbackLabel : `관리팀 (담당 ${fallbackLabel})`,
    assigneeTeam: profileIds.length > 0 ? "" : "관리팀",
  };
}

function campusOfClass(classItem = {}) {
  const explicit = text(classItem.campus || classItem.branch);
  if (explicit) return explicit;
  const classroom = splitClassroomList(classItem.classroom || classItem.room)
    .find((label) => /^(본관|별관)/.test(label));
  return classroom?.match(/^(본관|별관)/)?.[1] || "";
}

function commonClassValue(classes, resolver) {
  const values = unique(classes.map(resolver));
  return values.length === 1 ? values[0] : "";
}

function affectedStudentsForClasses(classes) {
  return sortedIds(classes.flatMap(getStudentIds));
}

function createConflictSource({
  classIds = [],
  studentIds = [],
  examEventIds = [],
  examDetailIds = [],
  teacherCatalogIds = [],
  classroomCatalogIds = [],
  weekday = "",
  overlapStart = "",
  overlapEnd = "",
  examDate = "",
  examRule = "",
} = {}) {
  return {
    classIds: sortedIds(classIds),
    studentIds: sortedIds(studentIds),
    examEventIds: sortedIds(examEventIds),
    examDetailIds: sortedIds(examDetailIds),
    teacherCatalogIds: sortedIds(teacherCatalogIds),
    classroomCatalogIds: sortedIds(classroomCatalogIds),
    weekday: text(weekday),
    overlapStart: normalizeClockTime(overlapStart),
    overlapEnd: normalizeClockTime(overlapEnd),
    examDate: text(examDate),
    examRule: text(examRule),
  };
}

function mergeConflictRow(rowsByKey, row) {
  const current = rowsByKey.get(row.key);
  if (!current) {
    rowsByKey.set(row.key, row);
    return;
  }

  rowsByKey.set(row.key, {
    ...current,
    affectedStudentIds: sortedIds([
      ...current.affectedStudentIds,
      ...row.affectedStudentIds,
    ]),
    source: createConflictSource({
      ...current.source,
      studentIds: [...current.source.studentIds, ...row.source.studentIds],
      examEventIds: [...current.source.examEventIds, ...row.source.examEventIds],
      examDetailIds: [...current.source.examDetailIds, ...row.source.examDetailIds],
      teacherCatalogIds: [
        ...current.source.teacherCatalogIds,
        ...row.source.teacherCatalogIds,
      ],
      classroomCatalogIds: [
        ...current.source.classroomCatalogIds,
        ...row.source.classroomCatalogIds,
      ],
    }),
  });
}

function classesForOverlap(overlap, classesById) {
  return sortedIds([overlap.left.classId, overlap.right.classId])
    .map((classId) => classesById.get(classId))
    .filter(Boolean);
}

function weeklyConflictBase({
  type,
  overlap,
  involvedClasses,
  affectedStudentIds,
  now,
}) {
  const classIds = sortedIds(involvedClasses.map((classItem) => classItem.id));
  return {
    type,
    occurrenceKind: "weekly",
    nextOccurrenceAt: nextWeeklyOccurrenceAt(overlap.day, overlap.start, now),
    recurrenceDay: overlap.day,
    classIds,
    classNames: involvedClasses.map(classFullNameOf),
    affectedStudentIds: sortedIds(affectedStudentIds),
    subject: commonClassValue(involvedClasses, (classItem) => normalizeSubject(classItem.subject)),
    campus: commonClassValue(involvedClasses, campusOfClass),
  };
}

export function buildDashboardConflictRows({
  classes = [],
  students = [],
  academicSchools = [],
  academicExamDays = [],
  academicEventExamDetails = [],
  academicEvents = [],
  teacherCatalogs = [],
  classroomCatalogs = [],
  now = new Date(),
} = {}) {
  const activeClasses = (classes || []).filter(isActiveClass);
  const classesById = new Map(activeClasses.map((classItem) => [text(classItem.id), classItem]));
  const collisionSummary = buildScheduleCollisionSummary(activeClasses, students);
  const rowsByKey = new Map();
  const currentSeoulDate = getSeoulClockParts(now).dateString;

  findExamConflictsForClasses(
    activeClasses,
    students,
    academicSchools,
    academicExamDays,
    academicEventExamDetails,
    academicEvents,
  ).forEach((classConflict) => {
    const classItem = classesById.get(text(classConflict.classId));
    if (!classItem) return;
    const ownership = resolveTeacherOwnership(
      [classItem],
      teacherCatalogs,
      splitTeacherList(classConflict.teacherLabel),
    );

    classConflict.conflicts.forEach((conflict) => {
      const sessionDate = text(conflict.sessionDate);
      const examDate = text(conflict.examDate);
      const rule = text(conflict.rule);
      if (!sessionDate || sessionDate < currentSeoulDate) return;

      const classId = text(classConflict.classId);
      const key = `exam:v1:${classId}:${examDate}:${rule}`;
      const subject = normalizeSubject(classConflict.subject);
      const isSameDay = rule === "same-day-subject";
      mergeConflictRow(rowsByKey, {
        key,
        type: "exam",
        occurrenceKind: "dated",
        title: "시험 일정 충돌",
        nextOccurrenceAt: datedOccurrenceAt(classItem, sessionDate),
        recurrenceDay: "",
        problem: isSameDay
          ? `${classConflict.title} 수업이 ${subject || "해당 과목"} 시험일과 겹칩니다.`
          : `${classConflict.title} 수업 다음 날에 ${conflict.label || "타과목 시험"}이 있습니다.`,
        ownerLabel: ownership.ownerLabel,
        resolution: "수업일 변경 또는 휴강·보강 확정 후 학생·보호자 안내",
        classIds: [classId],
        classNames: [classFullNameOf(classItem)],
        affectedStudentIds: sortedIds(conflict.studentIds),
        subject,
        campus: campusOfClass(classItem),
        primaryAssigneeProfileId: ownership.profileIds[0] || "",
        secondaryAssigneeProfileId: "",
        assigneeTeam: ownership.assigneeTeam,
        source: createConflictSource({
          classIds: [classId],
          studentIds: conflict.studentIds,
          examEventIds: conflict.examEventIds,
          examDetailIds: conflict.examDetailIds,
          teacherCatalogIds: ownership.teacherCatalogIds,
          examDate,
          examRule: rule,
        }),
      });
    });
  });

  collisionSummary.teacher.forEach((collision) => {
    collision.overlaps.forEach((overlap) => {
      const involvedClasses = classesForOverlap(overlap, classesById);
      if (involvedClasses.length !== 2) return;
      const base = weeklyConflictBase({
        type: "teacher",
        overlap,
        involvedClasses,
        affectedStudentIds: affectedStudentsForClasses(involvedClasses),
        now,
      });
      const ownership = resolveTeacherOwnership(
        involvedClasses,
        teacherCatalogs,
        [collision.label],
      );
      const key = weeklyConflictKey("teacher", {
        weekday: overlap.day,
        overlapStart: overlap.start,
        overlapEnd: overlap.end,
        classIds: base.classIds,
      });
      mergeConflictRow(rowsByKey, {
        ...base,
        key,
        title: "선생님 일정 충돌",
        problem: `${collision.label} 선생님이 ${base.classNames.join(", ")} 수업을 동시에 담당합니다.`,
        ownerLabel: ownership.ownerLabel,
        resolution: "한 수업의 시간 또는 대체 선생님 확정",
        primaryAssigneeProfileId: ownership.profileIds[0] || "",
        secondaryAssigneeProfileId: "",
        assigneeTeam: ownership.assigneeTeam,
        source: createConflictSource({
          classIds: base.classIds,
          teacherCatalogIds: ownership.teacherCatalogIds,
          weekday: overlap.day,
          overlapStart: overlap.start,
          overlapEnd: overlap.end,
        }),
      });
    });
  });

  collisionSummary.classroom.forEach((collision) => {
    collision.overlaps.forEach((overlap) => {
      const involvedClasses = classesForOverlap(overlap, classesById);
      if (involvedClasses.length !== 2) return;
      const base = weeklyConflictBase({
        type: "classroom",
        overlap,
        involvedClasses,
        affectedStudentIds: affectedStudentsForClasses(involvedClasses),
        now,
      });
      const catalogRows = catalogRowsForClasses(
        involvedClasses,
        classroomCatalogs,
        "classroom",
        [collision.label],
      );
      const key = weeklyConflictKey("classroom", {
        weekday: overlap.day,
        overlapStart: overlap.start,
        overlapEnd: overlap.end,
        classIds: base.classIds,
      });
      mergeConflictRow(rowsByKey, {
        ...base,
        key,
        title: "강의실 일정 충돌",
        problem: `${collision.label}에 ${base.classNames.join(", ")} 수업이 동시에 배정되어 있습니다.`,
        ownerLabel: "관리팀",
        resolution: "한 수업의 강의실 또는 시간 변경",
        primaryAssigneeProfileId: "",
        secondaryAssigneeProfileId: "",
        assigneeTeam: "관리팀",
        source: createConflictSource({
          classIds: base.classIds,
          classroomCatalogIds: catalogRows.map((catalog) => catalog.id),
          weekday: overlap.day,
          overlapStart: overlap.start,
          overlapEnd: overlap.end,
        }),
      });
    });
  });

  collisionSummary.student.forEach((collision) => {
    collision.overlaps.forEach((overlap) => {
      const involvedClasses = classesForOverlap(overlap, classesById);
      if (involvedClasses.length !== 2) return;
      const studentId = text(collision.id);
      const base = weeklyConflictBase({
        type: "student",
        overlap,
        involvedClasses,
        affectedStudentIds: [studentId],
        now,
      });
      const slotTeacherNames = unique([
        ...resolveSlotTeachers(overlap.left, involvedClasses.find((item) => text(item.id) === text(overlap.left.classId))),
        ...resolveSlotTeachers(overlap.right, involvedClasses.find((item) => text(item.id) === text(overlap.right.classId))),
      ]);
      const ownership = resolveTeacherOwnership(
        involvedClasses,
        teacherCatalogs,
        slotTeacherNames,
      );
      const key = weeklyConflictKey("student", {
        weekday: overlap.day,
        overlapStart: overlap.start,
        overlapEnd: overlap.end,
        classIds: base.classIds,
        studentId,
      });
      mergeConflictRow(rowsByKey, {
        ...base,
        key,
        title: "학생 시간표 충돌",
        problem: `${collision.label} 학생의 ${base.classNames.join(", ")} 수업 시간이 겹칩니다.`,
        ownerLabel: ownership.ownerLabel,
        resolution: "두 담당선생님이 우선 수업과 보강 방안 확정",
        primaryAssigneeProfileId: ownership.profileIds[0] || "",
        secondaryAssigneeProfileId: ownership.profileIds[1] || "",
        assigneeTeam: ownership.assigneeTeam,
        source: createConflictSource({
          classIds: base.classIds,
          studentIds: [studentId],
          teacherCatalogIds: ownership.teacherCatalogIds,
          weekday: overlap.day,
          overlapStart: overlap.start,
          overlapEnd: overlap.end,
        }),
      });
    });
  });

  return [...rowsByKey.values()].sort((left, right) => (
    text(left.nextOccurrenceAt).localeCompare(text(right.nextOccurrenceAt)) ||
    ["exam", "teacher", "classroom", "student"].indexOf(left.type) -
      ["exam", "teacher", "classroom", "student"].indexOf(right.type) ||
    left.key.localeCompare(right.key)
  ));
}

function buildLoad(rows = [], key) {
  return Object.entries(
    rows.reduce((accumulator, row) => {
      const name = text(row[key]) || "미지정";
      const current = accumulator[name] || {
        name,
        minutes: 0,
        slotCount: 0,
        classIds: new Set(),
      };
      current.minutes += Number(row.durationMinutes || 0);
      current.slotCount += 1;
      current.classIds.add(row.classId);
      accumulator[name] = current;
      return accumulator;
    }, {}),
  )
    .map(([, value]) => ({
      name: value.name,
      minutes: value.minutes,
      slotCount: value.slotCount,
      classCount: value.classIds.size,
    }))
    .sort((left, right) => (
      right.minutes - left.minutes ||
      right.classCount - left.classCount ||
      left.name.localeCompare(right.name, "ko", { numeric: true })
    ));
}

function buildResourceLoadFromClasses(classes = [], kind, students = []) {
  const load = new Map();
  const studentsById = buildStudentLookup(students);

  classes.forEach((classItem) => {
    buildScheduleSlots(classItem).forEach((slot) => {
      const resources = kind === "teacher"
        ? resolveSlotTeachers(slot, classItem)
        : resolveSlotClassrooms(slot, classItem);
      const duration = Math.max(0, timeToMinutes(slot.end) - timeToMinutes(slot.start));

      resources.forEach((name) => {
        const key = text(name) || "미지정";
        const current = load.get(key) || {
          name: key,
          minutes: 0,
          slotCount: 0,
          classIds: new Set(),
          classesById: new Map(),
        };

        current.minutes += duration;
        current.slotCount += 1;
        current.classIds.add(slot.classId);
        current.classesById.set(
          text(slot.classId) || classFullNameOf(classItem),
          buildClassLoadSummary(classItem, studentsById),
        );
        load.set(key, current);
      });
    });
  });

  return [...load.values()]
    .map((item) => {
      const classes = [...item.classesById.values()].sort((left, right) => (
        right.registeredCount - left.registeredCount ||
        right.waitlistCount - left.waitlistCount ||
        left.title.localeCompare(right.title, "ko", { numeric: true })
      ));

      return {
        name: item.name,
        minutes: item.minutes,
        slotCount: item.slotCount,
        classCount: item.classIds.size,
        enrollmentCount: classes.reduce((sum, classItem) => sum + classItem.registeredCount, 0),
        waitlistCount: classes.reduce((sum, classItem) => sum + classItem.waitlistCount, 0),
        classes,
      };
    })
    .sort((left, right) => (
      right.minutes - left.minutes ||
      right.classCount - left.classCount ||
      left.name.localeCompare(right.name, "ko", { numeric: true })
    ));
}

function createBreakdownAccumulator() {
  return {
    enrollmentCount: 0,
    studentIds: new Set(),
  };
}

function pushBreakdown(map, label, studentId) {
  const key = text(label) || "미정";
  const current = map.get(key) || createBreakdownAccumulator();
  current.enrollmentCount += 1;
  if (studentId) {
    current.studentIds.add(studentId);
  }
  map.set(key, current);
}

function finalizeBreakdown(
  map,
  { order = "enrollment-asc", studentsById = new Map() } = {},
) {
  return [...map.entries()]
    .map(([label, payload]) => ({
      label,
      enrollmentCount: payload.enrollmentCount,
      studentCount: payload.studentIds.size,
      studentRoster: dashboardStudentRosterFromIds([...payload.studentIds], studentsById),
    }))
    .sort((left, right) => {
      if (order === "student-desc") {
        return (
          right.studentCount - left.studentCount ||
          right.enrollmentCount - left.enrollmentCount ||
          left.label.localeCompare(right.label, "ko", { numeric: true })
        );
      }

      return (
        left.enrollmentCount - right.enrollmentCount ||
        left.studentCount - right.studentCount ||
        left.label.localeCompare(right.label, "ko", { numeric: true })
      );
    });
}

function buildStudentBreakdowns(classes = [], students = []) {
  const studentsById = new Map(students.map((student) => [text(student.id), student]));
  const bySubject = new Map();
  const byGrade = new Map();
  const bySchool = new Map();
  const schoolsByGrade = new Map();
  const gradesBySchool = new Map();

  classes.forEach((classItem) => {
    getStudentIds(classItem).forEach((studentId) => {
      const student = studentsById.get(studentId);
      const gradeKey = text(student?.grade) || "미정";
      const schoolKey = text(student?.school) || "미정";
      const schoolBreakdownForGrade = schoolsByGrade.get(gradeKey) || new Map();
      const gradeBreakdownForSchool = gradesBySchool.get(schoolKey) || new Map();

      pushBreakdown(bySubject, classItem.subject, studentId);
      pushBreakdown(byGrade, student?.grade, studentId);
      pushBreakdown(bySchool, student?.school, studentId);
      pushBreakdown(schoolBreakdownForGrade, student?.school, studentId);
      pushBreakdown(gradeBreakdownForSchool, student?.grade, studentId);
      schoolsByGrade.set(gradeKey, schoolBreakdownForGrade);
      gradesBySchool.set(schoolKey, gradeBreakdownForSchool);
    });
  });

  const gradeRows = finalizeBreakdown(byGrade, { order: "student-desc", studentsById }).map((row) => ({
    ...row,
    schools: finalizeBreakdown(schoolsByGrade.get(row.label) || new Map(), { order: "student-desc", studentsById }),
  }));

  return {
    bySubject: finalizeBreakdown(bySubject, { studentsById }),
    byGrade: gradeRows,
    bySchool: finalizeBreakdown(bySchool, { order: "student-desc", studentsById }).map((row) => ({
      ...row,
      grades: finalizeBreakdown(gradesBySchool.get(row.label) || new Map(), { order: "student-desc", studentsById }),
    })),
  };
}

function createClassBreakdownAccumulator() {
  return {
    classIds: new Set(),
    enrollmentCount: 0,
    studentIds: new Set(),
    classSummaries: new Map(),
    weeklyMinutes: 0,
  };
}

function buildDashboardClassSummary(classItem = {}, studentIds = [], studentsById = new Map()) {
  const weeklyMinutes = getWeeklyMinutesForClass(classItem);

  return {
    id: text(classItem.id) || classFullNameOf(classItem),
    title: classNameOf(classItem),
    subject: text(classItem.subject) || "미정",
    scheduleLabel: text(classItem.schedule) || "시간 미정",
    teacherLabel: splitTeacherList(classItem.teacher || classItem.teacher_name || classItem.teacherName).join(", ") || "미정",
    classroomLabel: splitClassroomList(classItem.classroom || classItem.room).join(", ") || "미정",
    studentCount: unique(studentIds).length,
    enrollmentCount: studentIds.length,
    studentRoster: dashboardStudentRosterFromIds(studentIds, studentsById),
    weeklyMinutes,
    weeklyHoursLabel: formatDashboardHours(weeklyMinutes),
  };
}

function pushClassBreakdown(map, label, classId, studentIds = [], classSummary = null) {
  const key = text(label) || "미정";
  const current = map.get(key) || createClassBreakdownAccumulator();
  current.classIds.add(classId);
  current.enrollmentCount += studentIds.length;
  studentIds.forEach((studentId) => {
    if (studentId) {
      current.studentIds.add(studentId);
    }
  });
  if (classSummary) {
    current.classSummaries.set(classId, classSummary);
    current.weeklyMinutes += Number(classSummary.weeklyMinutes || 0);
  }
  map.set(key, current);
}

function finalizeClassBreakdown(map, { order = "class-desc" } = {}) {
  return [...map.entries()]
    .map(([label, payload]) => ({
      label,
      classCount: payload.classIds.size,
      enrollmentCount: payload.enrollmentCount,
      studentCount: payload.studentIds.size,
      weeklyMinutes: payload.weeklyMinutes,
      weeklyHoursLabel: formatDashboardHours(payload.weeklyMinutes),
      classSummaries: [...payload.classSummaries.values()].sort((left, right) => (
        right.studentCount - left.studentCount ||
        right.enrollmentCount - left.enrollmentCount ||
        right.weeklyMinutes - left.weeklyMinutes ||
        left.title.localeCompare(right.title, "ko", { numeric: true })
      )),
    }))
    .sort((left, right) => {
      if (order === "student-desc") {
        return (
          right.studentCount - left.studentCount ||
          right.enrollmentCount - left.enrollmentCount ||
          right.classCount - left.classCount ||
          left.label.localeCompare(right.label, "ko", { numeric: true })
        );
      }

      return (
        right.classCount - left.classCount ||
        right.enrollmentCount - left.enrollmentCount ||
        right.studentCount - left.studentCount ||
        left.label.localeCompare(right.label, "ko", { numeric: true })
      );
    });
}

function buildClassBreakdowns(classes = [], students = []) {
  const studentsById = new Map(students.map((student) => [text(student.id), student]));
  const byGrade = new Map();
  const bySubject = new Map();
  const bySchool = new Map();
  const byTeacher = new Map();
  const byClassroom = new Map();

  classes.forEach((classItem) => {
    const classId = text(classItem.id) || classFullNameOf(classItem);
    const registeredIds = getStudentIds(classItem);
    const gradeLabels = inferClassGradeLabels(classItem, studentsById);
    const subjectLabel = text(classItem.subject) || "미정";
    const classSummary = buildDashboardClassSummary(classItem, registeredIds, studentsById);
    const teacherLabels = splitTeacherList(classItem.teacher || classItem.teacher_name || classItem.teacherName);
    const classroomLabels = splitClassroomList(classItem.classroom || classItem.room);
    const schoolLabels = unique(
      registeredIds
        .map((studentId) => text(studentsById.get(studentId)?.school))
        .filter(Boolean),
    );

    pushClassBreakdown(bySubject, subjectLabel, classId, registeredIds, classSummary);
    (teacherLabels.length > 0 ? teacherLabels : ["미정"]).forEach((teacherLabel) => {
      pushClassBreakdown(byTeacher, teacherLabel, classId, registeredIds, classSummary);
    });
    (classroomLabels.length > 0 ? classroomLabels : ["미정"]).forEach((classroomLabel) => {
      pushClassBreakdown(byClassroom, classroomLabel, classId, registeredIds, classSummary);
    });

    (gradeLabels.length > 0 ? gradeLabels : ["미정"]).forEach((gradeLabel) => {
      const studentIdsForGrade = registeredIds.filter((studentId) => (
        gradeText(studentsById.get(studentId)?.grade) === gradeLabel
      ));
      pushClassBreakdown(
        byGrade,
        gradeLabel,
        classId,
        studentIdsForGrade.length > 0 ? studentIdsForGrade : registeredIds,
        buildDashboardClassSummary(
          classItem,
          studentIdsForGrade.length > 0 ? studentIdsForGrade : registeredIds,
          studentsById,
        ),
      );
    });

    (schoolLabels.length > 0 ? schoolLabels : ["미정"]).forEach((schoolLabel) => {
      const studentIdsForSchool = registeredIds.filter((studentId) => (
        text(studentsById.get(studentId)?.school) === schoolLabel
      ));
      pushClassBreakdown(
        bySchool,
        schoolLabel,
        classId,
        studentIdsForSchool.length > 0 ? studentIdsForSchool : registeredIds,
        buildDashboardClassSummary(
          classItem,
          studentIdsForSchool.length > 0 ? studentIdsForSchool : registeredIds,
          studentsById,
        ),
      );
    });
  });

  return {
    byGrade: finalizeClassBreakdown(byGrade, { order: "class-desc" }),
    bySubject: finalizeClassBreakdown(bySubject, { order: "class-desc" }),
    bySchool: finalizeClassBreakdown(bySchool, { order: "student-desc" }),
    byTeacher: finalizeClassBreakdown(byTeacher, { order: "class-desc" }),
    byClassroom: finalizeClassBreakdown(byClassroom, { order: "class-desc" }),
  };
}

function getScheduleRangeMinutesFallback(schedule) {
  return [...text(schedule).matchAll(/([0-9]{1,2}:\d{2})\s*-\s*([0-9]{1,2}:\d{2})/g)]
    .reduce((sum, match) => sum + Math.max(0, timeToMinutes(match[2]) - timeToMinutes(match[1])), 0);
}

function getWeeklyMinutesForClass(classItem = {}) {
  const slots = buildScheduleSlots(classItem);
  if (slots.length === 0) {
    return getScheduleRangeMinutesFallback(classItem.schedule);
  }

  return slots.reduce((slotSum, slot) => (
    slotSum + Math.max(0, timeToMinutes(slot.end) - timeToMinutes(slot.start))
  ), 0);
}

function getWeeklyMinutesForClasses(classes = []) {
  return classes.reduce((sum, classItem) => sum + getWeeklyMinutesForClass(classItem), 0);
}

function buildDashboardBucketSummary(
  classes = [],
  studentBreakdowns = { bySchool: [], byGrade: [] },
) {
  const registeredStudentIds = classes.flatMap(getStudentIds);
  const waitlistStudentIds = classes.flatMap(getWaitlistIds);
  const weeklyMinutes = getWeeklyMinutesForClasses(classes);

  return {
    activeClassesCount: classes.length,
    registeredEnrollmentCount: registeredStudentIds.length,
    waitlistEnrollmentCount: waitlistStudentIds.length,
    uniqueRegisteredStudentCount: unique(registeredStudentIds).length,
    uniqueWaitlistStudentCount: unique(waitlistStudentIds).length,
    schoolCount: studentBreakdowns.bySchool.filter((row) => row.studentCount > 0).length,
    gradeCount: studentBreakdowns.byGrade.filter((row) => row.studentCount > 0).length,
    weeklyMinutes,
    weeklyHoursLabel: formatDashboardHours(weeklyMinutes),
  };
}

function buildDashboardAnalyticsBucket(classes = [], students = []) {
  const studentBreakdowns = buildStudentBreakdowns(classes, students);

  return {
    studentBreakdowns,
    classBreakdowns: buildClassBreakdowns(classes, students),
    summary: buildDashboardBucketSummary(classes, studentBreakdowns),
    teacherLoad: buildResourceLoadFromClasses(classes, "teacher", students),
    classroomLoad: buildResourceLoadFromClasses(classes, "classroom", students),
  };
}

function buildDashboardAnalyticsBySubject(classes = [], students = []) {
  return Object.fromEntries(
    DASHBOARD_SUBJECT_FILTERS.map((filter) => {
      const filteredClasses = classes.filter((classItem) => matchesDashboardSubject(classItem, filter.subject));
      return [filter.key, buildDashboardAnalyticsBucket(filteredClasses, students)];
    }),
  );
}

function buildDashboardAnalyticsByView(classes = [], students = []) {
  const studentsById = new Map(students.map((student) => [text(student.id), student]));

  return Object.fromEntries(
    DASHBOARD_SUBJECT_FILTERS.map((subjectFilter) => [
      subjectFilter.key,
      Object.fromEntries(
        DASHBOARD_DIVISION_FILTERS.map((divisionFilter) => {
          const filteredClasses = classes.filter((classItem) => (
            matchesDashboardSubject(classItem, subjectFilter.subject) &&
            matchesDashboardDivision(classItem, studentsById, divisionFilter.key)
          ));
          return [divisionFilter.key, buildDashboardAnalyticsBucket(filteredClasses, students)];
        }),
      ),
    ]),
  );
}

function buildEmptyDashboardAnalyticsView() {
  return buildDashboardAnalyticsByView([], []);
}

export function createEmptyDashboardMetrics() {
  return {
    activeClassesCount: 0,
    classesCount: 0,
    studentsCount: 0,
    textbooksCount: 0,
    progressLogsCount: 0,
    registeredEnrollmentCount: 0,
    waitlistEnrollmentCount: 0,
    uniqueRegisteredStudentCount: 0,
    uniqueWaitlistStudentCount: 0,
    weeklyMinutes: 0,
    weeklyHoursLabel: "0분",
    teacherCount: 0,
    classroomCount: 0,
    collisionSummary: {
      student: [],
      teacher: [],
      classroom: [],
      total: 0,
    },
    examConflicts: [],
    conflictRows: [],
    studentBreakdowns: {
      bySubject: [],
      byGrade: [],
      bySchool: [],
    },
    classBreakdowns: {
      bySubject: [],
      byGrade: [],
      bySchool: [],
      byTeacher: [],
      byClassroom: [],
    },
    analyticsBySubject: buildDashboardAnalyticsBySubject([], []),
    analyticsByView: buildEmptyDashboardAnalyticsView(),
    teacherLoad: [],
    classroomLoad: [],
    riskCount: 0,
  };
}

export function buildDashboardMetrics({
  classes = [],
  students = [],
  textbooks = [],
  progressLogs = [],
  classTerms = [],
  classGroups = [],
  classGroupMembers = [],
  academicSchools = [],
  academicExamDays = [],
  academicEventExamDetails = [],
  academicEvents = [],
  teacherCatalogs = [],
  classroomCatalogs = [],
  now = new Date(),
} = {}) {
  const activeClasses = classes.filter(isActiveClass);
  const timetable = buildTimetableWorkspaceModel({
    classes: activeClasses,
    classTerms,
    classGroups,
    classGroupMembers,
    filters: { status: "수강" },
  });
  const registeredStudentIds = activeClasses.flatMap(getStudentIds);
  const waitlistStudentIds = activeClasses.flatMap(getWaitlistIds);
  const collisionSummary = buildScheduleCollisionSummary(activeClasses, students);
  const examConflicts = findExamConflictsForClasses(
    activeClasses,
    students,
    academicSchools,
    academicExamDays,
    academicEventExamDetails,
    academicEvents,
  );
  const conflictRows = buildDashboardConflictRows({
    classes: activeClasses,
    students,
    academicSchools,
    academicExamDays,
    academicEventExamDetails,
    academicEvents,
    teacherCatalogs,
    classroomCatalogs,
    now,
  });
  const teacherLoad = buildResourceLoadFromClasses(activeClasses, "teacher", students);
  const classroomLoad = buildResourceLoadFromClasses(activeClasses, "classroom", students);
  const analyticsBySubject = buildDashboardAnalyticsBySubject(activeClasses, students);
  const analyticsByView = buildDashboardAnalyticsByView(activeClasses, students);

  return {
    activeClassesCount: activeClasses.length,
    classesCount: classes.length,
    studentsCount: students.length,
    textbooksCount: textbooks.length,
    progressLogsCount: progressLogs.length,
    registeredEnrollmentCount: registeredStudentIds.length,
    waitlistEnrollmentCount: waitlistStudentIds.length,
    uniqueRegisteredStudentCount: unique(registeredStudentIds).length,
    uniqueWaitlistStudentCount: unique(waitlistStudentIds).length,
    weeklyMinutes: timetable.summary.weeklyMinutes,
    weeklyHoursLabel: formatDashboardHours(timetable.summary.weeklyMinutes),
    teacherCount: timetable.summary.teacherCount,
    classroomCount: timetable.summary.classroomCount,
    collisionSummary,
    examConflicts,
    conflictRows,
    studentBreakdowns: buildStudentBreakdowns(activeClasses, students),
    classBreakdowns: buildClassBreakdowns(activeClasses, students),
    analyticsBySubject,
    analyticsByView,
    teacherLoad: teacherLoad.length ? teacherLoad : buildLoad(timetable.rows, "teacher"),
    classroomLoad: classroomLoad.length ? classroomLoad : buildLoad(timetable.rows, "classroom"),
    riskCount: conflictRows.length,
  };
}
