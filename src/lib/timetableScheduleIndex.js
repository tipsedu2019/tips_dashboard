import {
  getClassroomCanonicalKey,
  getTeacherCanonicalKey,
  parseSchedule,
  stripClassPrefix,
  timeToSlotIndex,
  DAY_LABELS,
} from '../data/sampleData';
import {
  buildTimetableTooltip,
  canTeacherOpenClass,
  getClassColor,
  getClassMeta,
  resolveSlotClassroom,
  resolveSlotTeachers,
} from '../components/timetableViewUtils';
import {
  buildEditableSlots,
  isEditableScheduleClass,
} from './timetableEditing';

function createBlock(entry, {
  key,
  columnIndex,
  detailLabel,
  detailValue,
  teacher,
  classroom,
  sourceDay,
  onOpenClass,
}) {
  return {
    key,
    columnIndex,
    startSlot: entry.startSlot,
    endSlot: entry.endSlot,
    backgroundColor: entry.palette.bg,
    borderColor: entry.palette.border,
    textColor: entry.palette.text,
    clickable: entry.canOpen,
    editable: entry.editable,
    editableReason: entry.editableReason,
    editData: entry.editSlot ? { classItem: entry.cls, slotId: entry.editSlot.slotId, teacher, classroom } : null,
    onClick: () => {
      if (entry.canOpen) {
        onOpenClass?.(entry.cls);
      }
    },
    variantDot: entry.variantDot,
    variantDotTitle: entry.variantDotTitle,
    header: entry.header,
    title: entry.title,
    detailLines: [{ label: detailLabel, value: detailValue }],
    tooltip: buildTimetableTooltip({ cls: entry.cls, teacher, classroom, meta: entry.meta }),
    ...(sourceDay ? { sourceDay } : {}),
  };
}

export function buildTimetableScheduleIndex(classes, {
  canEditTimetable = false,
  isStaff = false,
  isTeacher = false,
  user = null,
  timeSlotCount = 0,
  startHour = 11,
} = {}) {
  return (classes || []).flatMap((cls, colorIndex) => {
    const meta = getClassMeta(cls);
    const editableState = isEditableScheduleClass(cls);
    const editableSlots = buildEditableSlots(cls);
    const palette = getClassColor(colorIndex);

    return parseSchedule(cls.schedule, cls).flatMap((slot, slotIndex) => {
      const dayIndex = DAY_LABELS.indexOf(slot.day);
      if (dayIndex === -1) {
        return [];
      }

      const teacherNames = resolveSlotTeachers(cls, slot);
      const teacherKeys = teacherNames.map((teacherName) => getTeacherCanonicalKey(teacherName)).filter(Boolean);
      const classroom = resolveSlotClassroom(cls, slot);
      const classroomKey = getClassroomCanonicalKey(classroom);
      const primaryTeacher = teacherNames[0] || cls.teacher || '-';
      const canOpen = canTeacherOpenClass({ isStaff, isTeacher, user, teacherNames });
      const startSlot = Math.max(0, timeToSlotIndex(slot.start, startHour));
      const endSlot = Math.max(Math.min(timeToSlotIndex(slot.end, startHour), timeSlotCount), startSlot + 1);
      const editSlot = editableSlots[slotIndex];

      return [{
        cls,
        meta,
        day: slot.day,
        dayIndex,
        teacherNames,
        teacherKeys,
        primaryTeacher,
        classroom,
        classroomKey,
        startSlot,
        endSlot,
        palette,
        canOpen,
        editable: canEditTimetable && editableState.editable,
        editableReason: editableState.reason,
        editSlot,
        variantDot: Boolean(meta.hasVariants),
        variantDotTitle: editableState.editable ? '드래그로 이동할 수 있습니다.' : editableState.reason,
        header: cls.subject ? `[${cls.subject}]` : '',
        title: stripClassPrefix(cls.className),
      }];
    });
  });
}

export function buildWeeklyClassroomBlocks(indexEntries, targetClassroomKey, onOpenClass) {
  return (indexEntries || [])
    .filter((entry) => entry.classroomKey && entry.classroomKey === targetClassroomKey)
    .map((entry) => createBlock(entry, {
      key: `${entry.cls.id}-${targetClassroomKey}-${entry.day}-${entry.startSlot}-${entry.endSlot}-${entry.primaryTeacher}`,
      columnIndex: entry.dayIndex,
      detailLabel: '선생님',
      detailValue: entry.primaryTeacher,
      teacher: entry.primaryTeacher,
      classroom: entry.classroom,
      onOpenClass,
    }));
}

export function buildWeeklyTeacherBlocks(indexEntries, targetTeacherKey, onOpenClass) {
  return (indexEntries || [])
    .flatMap((entry) => {
      const matchedIndex = entry.teacherKeys.findIndex((teacherKey) => teacherKey === targetTeacherKey);
      if (matchedIndex === -1) {
        return [];
      }

      const matchedTeacher = entry.teacherNames[matchedIndex] || entry.primaryTeacher;
      return [createBlock(entry, {
        key: `${entry.cls.id}-${targetTeacherKey}-${entry.day}-${entry.startSlot}-${entry.endSlot}-${entry.classroom}`,
        columnIndex: entry.dayIndex,
        detailLabel: '강의실',
        detailValue: entry.classroom || '-',
        teacher: matchedTeacher,
        classroom: entry.classroom || '-',
        onOpenClass,
      })];
    });
}

export function buildDailyClassroomBlocks(indexEntries, targetDay, classroomIndexMap, onOpenClass) {
  return (indexEntries || [])
    .flatMap((entry) => {
      if (entry.day !== targetDay) {
        return [];
      }

      const columnIndex = classroomIndexMap.get(entry.classroomKey);
      if (columnIndex === undefined) {
        return [];
      }

      return [createBlock(entry, {
        key: `${entry.cls.id}-${targetDay}-${entry.classroomKey}-${entry.startSlot}-${entry.endSlot}`,
        columnIndex,
        detailLabel: '선생님',
        detailValue: entry.primaryTeacher,
        teacher: entry.primaryTeacher,
        classroom: entry.classroom,
        sourceDay: entry.day,
        onOpenClass,
      })];
    });
}

export function buildDailyTeacherBlocks(indexEntries, targetDay, teacherIndexMap, onOpenClass) {
  return (indexEntries || [])
    .flatMap((entry) => {
      if (entry.day !== targetDay || entry.teacherNames.length === 0) {
        return [];
      }

      return entry.teacherNames.flatMap((teacherName, teacherIndex) => {
        const teacherKey = entry.teacherKeys[teacherIndex];
        const columnIndex = teacherIndexMap.get(teacherKey);
        if (!teacherKey || columnIndex === undefined) {
          return [];
        }

        return [createBlock(entry, {
          key: `${entry.cls.id}-${targetDay}-${teacherKey}-${entry.startSlot}-${entry.endSlot}`,
          columnIndex,
          detailLabel: '강의실',
          detailValue: entry.classroom || '-',
          teacher: teacherName,
          classroom: entry.classroom || '-',
          sourceDay: entry.day,
          onOpenClass,
        })];
      });
    });
}
