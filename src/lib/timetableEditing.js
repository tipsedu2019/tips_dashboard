import {
  DAY_LABELS,
  parseSchedule,
  parseScheduleMeta,
  splitClassroomList,
  splitTeacherList,
  stripClassPrefix,
} from '../data/sampleData';

function compareTime(left, right) {
  return left.localeCompare(right);
}

function toMinutes(time) {
  const [hour, minute] = String(time || '00:00').split(':').map(Number);
  return hour * 60 + minute;
}

function overlaps(left, right) {
  return Math.max(toMinutes(left.start), toMinutes(right.start)) < Math.min(toMinutes(left.end), toMinutes(right.end));
}

function serializeSlot(slot) {
  return `${slot.day} ${slot.start}-${slot.end}${slot.override ? `(${slot.override})` : ''}`;
}

export function isEditableScheduleClass(cls) {
  const meta = parseScheduleMeta(cls?.schedule || '');
  const slots = parseSchedule(cls?.schedule || '', cls);

  if (!cls?.schedule || slots.length === 0) {
    return { editable: false, reason: '시간표 정보가 없는 수업입니다.' };
  }
  if (meta.hasVariants) {
    return { editable: false, reason: '날짜 구간이 있는 변형 시간표는 드래그 편집을 지원하지 않습니다.' };
  }
  if (slots.some((slot) => slot.override)) {
    return { editable: false, reason: '개별 override가 있는 수업은 수업 편집기에서 수정해 주세요.' };
  }

  return { editable: true, reason: '' };
}

export function buildEditableSlots(cls) {
  return parseSchedule(cls?.schedule || '', cls).map((slot, index) => ({
    ...slot,
    slotId: `${index}:${slot.day}:${slot.start}:${slot.end}`,
    override: slot.override || null,
  }));
}

export function serializeEditableSlots(slots) {
  return [...slots]
    .sort((left, right) => {
      const dayDiff = DAY_LABELS.indexOf(left.day) - DAY_LABELS.indexOf(right.day);
      if (dayDiff !== 0) {
        return dayDiff;
      }
      return compareTime(left.start, right.start);
    })
    .map(serializeSlot)
    .join('\n');
}

export function applySlotMove({
  cls,
  slotId,
  nextDay,
  nextStart,
  nextEnd,
  nextTeacher,
  nextClassroom,
}) {
  const slots = buildEditableSlots(cls);
  const slotIndex = slots.findIndex((slot) => slot.slotId === slotId);
  if (slotIndex === -1) {
    throw new Error('수정할 시간표 슬롯을 찾지 못했습니다.');
  }

  const baseTeacher = splitTeacherList(cls.teacher)[0] || '';
  const baseClassroom = splitClassroomList(cls.classroom || cls.room)[0] || '';
  const nextSlots = [...slots];
  const nextSlot = { ...nextSlots[slotIndex], day: nextDay, start: nextStart, end: nextEnd };
  const overrideParts = [];

  const shouldPromoteTeacher = nextTeacher && slots.length === 1;
  const shouldPromoteClassroom = nextClassroom && slots.length === 1;

  if (nextTeacher && !shouldPromoteTeacher && nextTeacher !== baseTeacher) {
    overrideParts.push(nextTeacher);
  }
  if (nextClassroom && !shouldPromoteClassroom && nextClassroom !== baseClassroom) {
    overrideParts.push(nextClassroom);
  }

  nextSlot.override = overrideParts.length > 0 ? overrideParts.join('/') : null;
  nextSlots[slotIndex] = nextSlot;

  const updates = {
    schedule: serializeEditableSlots(nextSlots),
  };

  if (shouldPromoteTeacher) {
    updates.teacher = nextTeacher;
  }
  if (shouldPromoteClassroom) {
    updates.classroom = nextClassroom;
  }

  return {
    updates,
    nextSlot,
  };
}

export function findScheduleConflicts({
  classes,
  ignoreClassId,
  slot,
  teacher,
  classroom,
}) {
  const warnings = [];

  (classes || []).forEach((classItem) => {
    if (classItem.id === ignoreClassId) {
      return;
    }

    parseSchedule(classItem.schedule, classItem).forEach((existingSlot) => {
      if (existingSlot.day !== slot.day || !overlaps(existingSlot, slot)) {
        return;
      }

      if (teacher && splitTeacherList(existingSlot.teacher || classItem.teacher).includes(teacher)) {
        warnings.push({
          id: `teacher:${teacher}:${classItem.id}`,
          type: 'teacher',
          label: '선생님 충돌',
          message: `같은 시간에 ${teacher} 선생님 수업이 다른 수업과 겹칩니다: ${stripClassPrefix(classItem.className)}`,
        });
      }

      const roomList = splitClassroomList(existingSlot.classroom || classItem.classroom || classItem.room);
      if (classroom && roomList.includes(classroom)) {
        warnings.push({
          id: `classroom:${classroom}:${classItem.id}`,
          type: 'classroom',
          label: '강의실 충돌',
          message: `같은 시간에 ${classroom} 강의실이 다른 수업과 겹칩니다: ${stripClassPrefix(classItem.className)}`,
        });
      }
    });
  });

  return [...new Map(warnings.map((warning) => [warning.id, warning])).values()];
}

export function findQuickCreateConflicts({
  classes,
  ignoreClassId,
  scheduleLines = [],
  teacher,
}) {
  const warnings = (scheduleLines || []).flatMap((line) => findScheduleConflicts({
    classes,
    ignoreClassId,
    slot: {
      day: line.day,
      start: line.start,
      end: line.end,
    },
    teacher,
    classroom: line.classroom,
  }));

  return [...new Map(warnings.map((warning) => [warning.id, warning])).values()];
}
