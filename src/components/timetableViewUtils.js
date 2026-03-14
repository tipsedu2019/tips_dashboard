import {
  CLASS_COLORS,
  getClassroomCanonicalKey,
  getClassroomDisplayName,
  getTeacherCanonicalKey,
  parseSchedule,
  parseScheduleMeta,
  splitClassroomList,
  splitTeacherList,
  stripClassPrefix,
} from '../data/sampleData';
import { sortSubjectOptions } from '../lib/subjectUtils';

function registerEntry(map, key, label) {
  if (!key) {
    return;
  }

  const safeLabel = String(label || '').trim();
  const existing = map.get(key);
  if (!existing) {
    map.set(key, { key, label: safeLabel || key });
    return;
  }

  if (!existing.label && safeLabel) {
    map.set(key, { key, label: safeLabel });
  }
}

export function collectClassroomEntries(classes) {
  const classroomMap = new Map();

  (classes || []).forEach((cls) => {
    splitClassroomList(cls.classroom || cls.room).forEach((classroom) => {
      registerEntry(
        classroomMap,
        getClassroomCanonicalKey(classroom),
        getClassroomDisplayName(classroom)
      );
    });

    parseSchedule(cls.schedule, cls).forEach((slot) => {
      const classroom = resolveSlotClassroom(cls, slot);
      registerEntry(
        classroomMap,
        getClassroomCanonicalKey(classroom),
        getClassroomDisplayName(classroom)
      );
    });
  });

  return [...classroomMap.values()].sort((left, right) => left.label.localeCompare(right.label, 'ko'));
}

export function collectTeacherEntries(classes) {
  const teacherMap = new Map();

  (classes || []).forEach((cls) => {
    splitTeacherList(cls.teacher).forEach((teacher) => {
      registerEntry(teacherMap, getTeacherCanonicalKey(teacher), teacher);
    });

    parseSchedule(cls.schedule, cls).forEach((slot) => {
      resolveSlotTeachers(cls, slot).forEach((teacher) => {
        registerEntry(teacherMap, getTeacherCanonicalKey(teacher), teacher);
      });
    });
  });

  return [...teacherMap.values()].sort((left, right) => left.label.localeCompare(right.label, 'ko'));
}

export function collectSubjectOptions(classes) {
  return sortSubjectOptions((classes || []).map((classItem) => classItem.subject));
}

export function collectGradeOptions(classes) {
  const items = new Set(['중1', '중2', '중3', '고1', '고2', '고3']);
  (classes || []).forEach((classItem) => {
    if (classItem.grade) {
      items.add(String(classItem.grade).trim());
    }
  });
  return [...items].filter(Boolean).sort((left, right) => left.localeCompare(right, 'ko'));
}

export function resolveSlotClassroom(cls, slot) {
  return getClassroomDisplayName(slot?.classroom || cls?.classroom || cls?.room || '');
}

export function resolveSlotTeachers(cls, slot) {
  const overrideTeachers = splitTeacherList(slot?.teacher);
  if (overrideTeachers.length > 0) {
    return overrideTeachers;
  }

  return splitTeacherList(cls?.teacher);
}

export function buildTimetableTooltip({ cls, teacher, classroom, meta }) {
  return [
    stripClassPrefix(cls.className),
    teacher ? `선생님 ${teacher}` : null,
    classroom ? `강의실 ${classroom}` : null,
    '',
    meta?.hasVariants ? `시간표 변형 정보\n${meta.rawNote}` : cls.schedule,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

export function getClassColor(index) {
  return CLASS_COLORS[index % CLASS_COLORS.length];
}

export function getClassMeta(cls) {
  return parseScheduleMeta(cls.schedule);
}

export function canTeacherOpenClass({ isStaff, isTeacher, user, teacherNames }) {
  if (isStaff) {
    return true;
  }

  if (!isTeacher) {
    return false;
  }

  if (user?.isFallbackRole) {
    return true;
  }

  const userKey = getTeacherCanonicalKey(user?.name || user?.email || '');
  if (!userKey) {
    return false;
  }

  return (teacherNames || []).some((teacherName) => {
    const teacherKey = getTeacherCanonicalKey(teacherName);
    return (
      teacherKey === userKey ||
      teacherKey.includes(userKey) ||
      userKey.includes(teacherKey)
    );
  });
}
