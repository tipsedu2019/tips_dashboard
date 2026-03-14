import { deriveSelectedDaysFromSchedule, parseDateValue, toDateString } from './classSchedulePlanner';

const COUNTDOWN_SUBJECTS = ['영어', '수학'];

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  return normalizeText(value).replace(/\s+/g, '').toLowerCase();
}

function normalizeSubject(value) {
  const subject = normalizeText(value);
  if (subject.includes('영어')) {
    return '영어';
  }
  if (subject.includes('수학')) {
    return '수학';
  }
  return subject;
}

function resolveSchoolIdFromName(schoolName, academicSchools = []) {
  const targetKey = normalizeKey(schoolName);
  if (!targetKey) {
    return '';
  }

  return academicSchools.find((school) => normalizeKey(school.name) === targetKey)?.id || '';
}

function buildExamDayEntries(academicExamDays = [], academicSchools = []) {
  return (academicExamDays || []).map((item) => {
    const schoolId = item.schoolId || item.school_id || resolveSchoolIdFromName(item.schoolName || item.school, academicSchools);
    const schoolName = item.schoolName
      || item.school
      || academicSchools.find((school) => school.id === schoolId)?.name
      || '';

    return {
      ...item,
      id: item.id,
      schoolId,
      schoolName,
      grade: normalizeText(item.grade),
      subject: normalizeSubject(item.subject),
      examDate: item.examDate || item.exam_date || '',
      label: normalizeText(item.label),
      note: normalizeText(item.note),
    };
  }).filter((item) => item.examDate && item.subject);
}

export function getClassSessionDates(classItem) {
  const planSessions = classItem?.schedulePlan?.sessions
    || classItem?.schedule_plan?.sessions
    || [];

  const plannedDates = planSessions
    .filter((session) => ['active', 'makeup'].includes(session.state) && parseDateValue(session.date))
    .map((session) => session.date);

  if (plannedDates.length > 0) {
    return [...new Set(plannedDates)].sort();
  }

  const startDate = parseDateValue(classItem?.startDate || classItem?.start_date);
  const endDate = parseDateValue(classItem?.endDate || classItem?.end_date);
  const selectedDays = deriveSelectedDaysFromSchedule(classItem?.schedule || '');

  if (!startDate || !endDate || selectedDays.length === 0) {
    return [];
  }

  const dates = [];
  const cursor = new Date(startDate);

  while (cursor <= endDate) {
    if (selectedDays.includes(cursor.getDay())) {
      dates.push(toDateString(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function getEnrolledStudentsForClass(classItem, students = []) {
  const enrolledIds = new Set(classItem?.studentIds || classItem?.student_ids || []);
  if (enrolledIds.size === 0) {
    return [];
  }

  return (students || []).filter((student) => enrolledIds.has(student.id));
}

export function getClassExamConflicts(classItem, students = [], academicSchools = [], academicExamDays = []) {
  const subject = normalizeSubject(classItem?.subject);
  if (!COUNTDOWN_SUBJECTS.includes(subject)) {
    return [];
  }

  const sessionDates = new Set(getClassSessionDates(classItem));
  if (sessionDates.size === 0) {
    return [];
  }

  const examDayEntries = buildExamDayEntries(academicExamDays, academicSchools);
  const enrolledStudents = getEnrolledStudentsForClass(classItem, students);
  if (enrolledStudents.length === 0) {
    return [];
  }

  const conflictMap = new Map();

  enrolledStudents.forEach((student) => {
    const schoolName = normalizeText(student.school);
    const schoolId = resolveSchoolIdFromName(schoolName, academicSchools);
    const grade = normalizeText(student.grade);

    examDayEntries.forEach((examDay) => {
      const schoolMatches = schoolId
        ? examDay.schoolId === schoolId
        : normalizeKey(examDay.schoolName) === normalizeKey(schoolName);

      if (!schoolMatches || examDay.grade !== grade || examDay.subject !== subject) {
        return;
      }

      if (!sessionDates.has(examDay.examDate)) {
        return;
      }

      const key = `${examDay.subject}:${examDay.examDate}:${examDay.label}`;
      if (!conflictMap.has(key)) {
        conflictMap.set(key, {
          subject: examDay.subject,
          examDate: examDay.examDate,
          label: examDay.label || `${examDay.subject} 시험`,
          note: examDay.note || '',
          students: [],
          schoolName: examDay.schoolName || schoolName,
          grade,
        });
      }

      const entry = conflictMap.get(key);
      if (!entry.students.includes(student.name)) {
        entry.students.push(student.name);
      }
    });
  });

  return [...conflictMap.values()].sort((left, right) => left.examDate.localeCompare(right.examDate));
}

export function findExamConflictsForClasses(classes = [], students = [], academicSchools = [], academicExamDays = []) {
  return (classes || [])
    .map((classItem) => {
      const conflicts = getClassExamConflicts(classItem, students, academicSchools, academicExamDays);
      if (conflicts.length === 0) {
        return null;
      }

      return {
        classId: classItem.id,
        className: classItem.className || classItem.name || '',
        subject: normalizeSubject(classItem.subject),
        conflicts,
      };
    })
    .filter(Boolean);
}

function dayDiff(targetDate, baseDate) {
  const start = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const end = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

export function getStudentExamCountdowns(student, academicSchools = [], academicExamDays = [], baseDate = new Date()) {
  if (!student) {
    return [];
  }

  const schoolName = normalizeText(student.school);
  const schoolId = resolveSchoolIdFromName(schoolName, academicSchools);
  const grade = normalizeText(student.grade);
  const examDayEntries = buildExamDayEntries(academicExamDays, academicSchools);

  return COUNTDOWN_SUBJECTS.map((subject) => {
    const upcoming = examDayEntries
      .filter((examDay) => {
        const schoolMatches = schoolId
          ? examDay.schoolId === schoolId
          : normalizeKey(examDay.schoolName) === normalizeKey(schoolName);

        if (!schoolMatches || examDay.grade !== grade || examDay.subject !== subject) {
          return false;
        }

        const examDate = parseDateValue(examDay.examDate);
        return examDate && dayDiff(examDate, baseDate) >= 0;
      })
      .sort((left, right) => left.examDate.localeCompare(right.examDate))[0];

    if (!upcoming) {
      return {
        subject,
        examDate: '',
        label: '',
        ddayLabel: '미정',
      };
    }

    const diff = dayDiff(parseDateValue(upcoming.examDate), baseDate);
    return {
      subject,
      examDate: upcoming.examDate,
      label: upcoming.label || `${subject} 시험`,
      ddayLabel: diff === 0 ? 'D-Day' : `D-${diff}`,
    };
  });
}
