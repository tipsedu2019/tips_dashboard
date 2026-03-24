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

export function toggleCompareSelection(currentItems = [], nextValue, maxCount = Number.MAX_SAFE_INTEGER) {
  const normalized = Array.isArray(currentItems) ? currentItems : [];
  if (normalized.includes(nextValue)) {
    return normalized.filter((item) => item !== nextValue);
  }

  const nextItems = [...normalized, nextValue];
  if (!Number.isFinite(maxCount) || maxCount >= nextItems.length) {
    return nextItems;
  }
  return nextItems.slice(-Math.max(1, maxCount));
}

export function computeTimetableWindow(blockGroups = [], totalSlotCount = 0, options = {}) {
  const { paddingSlots = 1, defaultVisibleSlots = 10, minVisibleSlots = 6 } = options;
  const allBlocks = blockGroups.flat().filter(Boolean);

  if (allBlocks.length === 0) {
    const endSlot = Math.min(Math.max(defaultVisibleSlots, minVisibleSlots), totalSlotCount);
    return {
      startSlot: 0,
      endSlot,
      hiddenBefore: false,
      hiddenAfter: endSlot < totalSlotCount,
      visibleSlotCount: endSlot,
    };
  }

  const minStart = Math.max(0, Math.min(...allBlocks.map((block) => Number(block.startSlot) || 0)));
  const maxEnd = Math.min(totalSlotCount, Math.max(...allBlocks.map((block) => Number(block.endSlot) || 0)));
  const requestedStart = Math.max(0, minStart - paddingSlots);
  const requestedEnd = Math.min(totalSlotCount, maxEnd + paddingSlots);
  let startSlot = requestedStart;
  let endSlot = requestedEnd;

  if (endSlot - startSlot < minVisibleSlots) {
    const deficit = minVisibleSlots - (endSlot - startSlot);
    const extendBefore = Math.min(startSlot, Math.ceil(deficit / 2));
    startSlot -= extendBefore;
    endSlot = Math.min(totalSlotCount, endSlot + (deficit - extendBefore));
  }

  return {
    startSlot,
    endSlot,
    hiddenBefore: startSlot > 0,
    hiddenAfter: endSlot < totalSlotCount,
    visibleSlotCount: Math.max(0, endSlot - startSlot),
  };
}

export function rebaseBlocksToWindow(blocks = [], startSlot = 0, endSlot = Number.MAX_SAFE_INTEGER) {
  return (blocks || [])
    .filter((block) => block.endSlot > startSlot && block.startSlot < endSlot)
    .map((block) => ({
      ...block,
      absoluteStartSlot: block.absoluteStartSlot ?? block.startSlot,
      absoluteEndSlot: block.absoluteEndSlot ?? block.endSlot,
      startSlot: Math.max(0, block.startSlot - startSlot),
      endSlot: Math.max(1, Math.min(endSlot, block.endSlot) - startSlot),
    }));
}

export function getTimetableDensity(compareCount = 1, visibleSlotCount = 10) {
  if (compareCount >= 2 || visibleSlotCount >= 9) {
    return 'compact';
  }
  return 'comfortable';
}

export function getTimetableSlotHeight(density = 'comfortable') {
  if (density === 'compact') return 30;
  return 38;
}

export function getTimetableLayoutMetrics({
  compareCount = 1,
  visibleSlotCount = 10,
  columnCount = 7,
} = {}) {
  const density = getTimetableDensity(compareCount, visibleSlotCount);

  if (density === 'compact') {
    return {
      density,
      slotHeight: 30,
      timeColumnWidth: 84,
      minColumnWidth: 68,
      cardPadding: 14,
      titleGap: 10,
      titleFontSize: 16,
    };
  }

  return {
    density,
    slotHeight: 38,
    timeColumnWidth: 108,
    minColumnWidth: 90,
    cardPadding: 14,
    titleGap: 10,
    titleFontSize: 16,
  };
}

export function getTimetableCompareGridStyle(compareCount = 1, preferredColumns = 2) {
  const requestedColumns = Math.min(4, Math.max(1, Number(preferredColumns) || 1));
  const columnCount = Math.max(1, Math.min(requestedColumns, Number(compareCount) || 1));
  return {
    gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
  };
}

export function formatCollapsedTimeHint(timeSlots = [], startSlot = 0, endSlot = 0) {
  const topLabel = startSlot > 0 ? `${timeSlots[startSlot]?.split('-')[0] || ''} 이전 공강 시간 숨김` : '';
  const bottomLabel = endSlot < timeSlots.length ? `${timeSlots[endSlot - 1]?.split('-')[1] || ''} 이후 공강 시간 숨김` : '';
  return {
    topLabel,
    bottomLabel,
  };
}

