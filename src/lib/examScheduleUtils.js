import { parseSchedule } from '../data/sampleData';

function text(value) {
  return String(value || '').trim();
}

function normalizeSchoolKey(value) {
  return text(value).replace(/\s+/g, '').toLowerCase();
}

function normalizeSubject(value) {
  const next = text(value);
  if (next === '영어' || next === '수학') {
    return next;
  }
  return next;
}

function parseDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    return null;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDateString(dateString, amount) {
  const base = parseDateString(dateString);
  if (!base) return '';
  const next = new Date(base);
  next.setDate(next.getDate() + amount);
  return toDateString(next);
}

function todayString() {
  return toDateString(new Date());
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

function buildExamDetailRows(academicEventExamDetails = [], academicEvents = []) {
  const eventMap = new Map((academicEvents || []).map((event) => [event.id, event]));
  return (academicEventExamDetails || []).map((detail) => {
    const event = eventMap.get(detail.academicEventId);
    return {
      schoolId: detail.schoolId || event?.schoolId || '',
      school: event?.school || '',
      grade: detail.grade || event?.grade || 'all',
      subject: normalizeSubject(detail.subject),
      examDate: text(detail.examDate),
      label: text(event?.title || detail.label || '시험'),
      note: text(detail.note),
    };
  }).filter((row) => row.subject && row.examDate);
}

function getRelevantExamRows(student, academicSchools = [], detailRows = [], legacyExamDays = []) {
  const school = resolveSchool(academicSchools, student);
  const schoolId = school?.id || null;
  const schoolName = school?.name || text(student.school);
  const studentGrade = text(student.grade);

  const modernRows = (detailRows || []).filter((item) => {
    const sameSchool =
      (schoolId && item.schoolId === schoolId) ||
      normalizeSchoolKey(item.school) === normalizeSchoolKey(schoolName);
    if (!sameSchool) return false;
    if (!studentGrade) return true;
    return item.grade === studentGrade || item.grade === 'all' || !item.grade;
  });

  if (modernRows.length > 0) {
    return {
      schoolName,
      grade: studentGrade || 'all',
      rows: modernRows,
    };
  }

  const legacyRows = (legacyExamDays || []).filter((item) => {
    const sameSchool =
      (schoolId && item.schoolId === schoolId) ||
      normalizeSchoolKey(item.school) === normalizeSchoolKey(schoolName);
    if (!sameSchool) return false;
    if (!studentGrade) return true;
    return item.grade === studentGrade || item.grade === 'all' || !item.grade;
  });

  return {
    schoolName,
    grade: studentGrade || 'all',
    rows: legacyRows.map((item) => ({
      schoolId: item.schoolId,
      school: item.school,
      grade: item.grade,
      subject: normalizeSubject(item.subject),
      examDate: text(item.examDate || item.exam_date),
      label: text(item.label),
      note: text(item.note),
    })),
  };
}

function buildStudentExamLookup(student, academicSchools = [], detailRows = [], legacyExamDays = []) {
  const examInfo = getRelevantExamRows(student, academicSchools, detailRows, legacyExamDays);
  const lookup = new Map();

  examInfo.rows.forEach((item) => {
    const date = text(item.examDate);
    const subject = normalizeSubject(item.subject);
    if (!date || !subject) return;
    if (!lookup.has(date)) {
      lookup.set(date, new Set());
    }
    lookup.get(date).add(subject);
  });

  return {
    schoolName: examInfo.schoolName,
    grade: examInfo.grade,
    rows: examInfo.rows,
    lookup,
  };
}

function getEnrolledStudentsForClass(classItem, students = []) {
  const enrolledIds = new Set(classItem?.studentIds || []);
  return (students || []).filter((student) => enrolledIds.has(student.id));
}

function getSchedulePlanSessionDates(classItem) {
  const sessions = classItem?.schedulePlan?.sessions;
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return [];
  }
  return sessions
    .filter((session) => ['active', 'makeup'].includes(session.state))
    .map((session) => text(session.date))
    .filter(Boolean);
}

function dayLabelToIndex(day) {
  return ['일', '월', '화', '수', '목', '금', '토'].indexOf(text(day));
}

function getFallbackScheduleDates(classItem) {
  const start = parseDateString(classItem?.startDate);
  const end = parseDateString(classItem?.endDate);
  if (!start || !end || start > end) {
    return [];
  }

  const slots = parseSchedule(classItem?.schedule || '', classItem);
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

function getRelevantRowsForStudent(student, academicSchools = [], academicExamDays = [], academicEventExamDetails = [], academicEvents = []) {
  const detailRows = buildExamDetailRows(academicEventExamDetails, academicEvents);
  return getRelevantExamRows(student, academicSchools, detailRows, academicExamDays).rows;
}

export function getClassExamConflictsForDates(
  classItem,
  sessionDatesInput = [],
  students = [],
  academicSchools = [],
  academicExamDays = [],
  academicEventExamDetails = [],
  academicEvents = []
) {
  const subject = normalizeSubject(classItem?.subject);
  if (!subject) return [];

  const enrolledStudents = getEnrolledStudentsForClass(classItem, students);
  if (enrolledStudents.length === 0) return [];

  const sessionDates = [...new Set((sessionDatesInput || []).filter(Boolean))].sort();
  if (sessionDates.length === 0) return [];

  const detailRows = buildExamDetailRows(academicEventExamDetails, academicEvents);
  const conflictMap = new Map();

  enrolledStudents.forEach((student) => {
    const examInfo = buildStudentExamLookup(student, academicSchools, detailRows, academicExamDays);

    sessionDates.forEach((sessionDate) => {
      const sameDaySubjects = examInfo.lookup.get(sessionDate);
      if (sameDaySubjects?.has(subject)) {
        const key = `same-day:${sessionDate}:${subject}`;
        if (!conflictMap.has(key)) {
          conflictMap.set(key, {
            rule: 'same-day-subject',
            subject,
            examDate: sessionDate,
            sessionDate,
            label: `${subject} 시험`,
            note: '',
            students: [],
            schoolName: examInfo.schoolName,
            grade: examInfo.grade,
            message: `${subject} 시험 당일에는 ${subject} 수업이 있으면 안 됩니다.`,
          });
        }
        const entry = conflictMap.get(key);
        if (!entry.students.includes(student.name)) {
          entry.students.push(student.name);
        }
      }

      const nextDate = shiftDateString(sessionDate, 1);
      const nextDaySubjects = examInfo.lookup.get(nextDate);
      if (nextDaySubjects && nextDaySubjects.size > 0 && !nextDaySubjects.has(subject)) {
        const nextSubjects = [...nextDaySubjects].sort();
        const key = `day-before:${sessionDate}:${nextSubjects.join('+')}`;
        if (!conflictMap.has(key)) {
          conflictMap.set(key, {
            rule: 'day-before-other-subject',
            subject,
            examDate: nextDate,
            sessionDate,
            label: `${nextSubjects.join(', ')} 시험 전날`,
            note: '',
            students: [],
            schoolName: examInfo.schoolName,
            grade: examInfo.grade,
            message: `다음 날 ${nextSubjects.join(', ')} 시험이 있어 ${subject} 수업이 전날에 배치되었습니다.`,
          });
        }
        const entry = conflictMap.get(key);
        if (!entry.students.includes(student.name)) {
          entry.students.push(student.name);
        }
      }
    });
  });

  return [...conflictMap.values()].sort((left, right) => {
    const dateDiff = String(left.sessionDate).localeCompare(String(right.sessionDate));
    return dateDiff !== 0 ? dateDiff : String(left.rule).localeCompare(String(right.rule));
  });
}

export function getClassExamConflicts(
  classItem,
  students = [],
  academicSchools = [],
  academicExamDays = [],
  academicEventExamDetails = [],
  academicEvents = []
) {
  return getClassExamConflictsForDates(
    classItem,
    getClassSessionDates(classItem),
    students,
    academicSchools,
    academicExamDays,
    academicEventExamDetails,
    academicEvents
  );
}

export function findExamConflictsForClasses(
  classes = [],
  students = [],
  academicSchools = [],
  academicExamDays = [],
  academicEventExamDetails = [],
  academicEvents = []
) {
  return (classes || [])
    .map((classItem) => ({
      classId: classItem.id,
      className: classItem.className,
      subject: classItem.subject,
      conflicts: getClassExamConflicts(
        classItem,
        students,
        academicSchools,
        academicExamDays,
        academicEventExamDetails,
        academicEvents
      ),
    }))
    .filter((entry) => entry.conflicts.length > 0);
}

export function getStudentExamCountdowns(
  student,
  academicSchools = [],
  academicExamDays = [],
  academicEventExamDetails = [],
  academicEvents = []
) {
  if (!student) {
    return ['영어', '수학'].map((subject) => ({
      subject,
      label: '',
      dDay: null,
      examDate: '',
    }));
  }

  const rows = getRelevantRowsForStudent(
    student,
    academicSchools,
    academicExamDays,
    academicEventExamDetails,
    academicEvents
  );
  const today = todayString();

  return ['영어', '수학'].map((subject) => {
    const match = rows
      .filter((row) => normalizeSubject(row.subject) === subject && row.examDate >= today)
      .sort((left, right) => left.examDate.localeCompare(right.examDate))[0];

    if (!match) {
      return {
        subject,
        label: '',
        dDay: null,
        examDate: '',
      };
    }

    const diff = diffDays(today, match.examDate);
    return {
      subject,
      label: match.label || `${subject} 시험`,
      dDay: diff === 0 ? 'D-day' : `D-${diff}`,
      examDate: match.examDate,
    };
  });
}
