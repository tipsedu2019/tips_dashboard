import {
  getClassroomCanonicalKey as getCanonicalClassroomKey,
  isClassroomAlias,
  normalizeClassroomText,
  normalizeSingleClassroomLabel,
} from '../lib/classroomUtils.js';

const DAY_SET = new Set(['월', '화', '수', '목', '금', '토', '일']);

export const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];

export const CLASS_COLORS = [
  { bg: 'var(--color-1-bg)', border: 'var(--color-1-border)', text: 'var(--color-1-text)' },
  { bg: 'var(--color-2-bg)', border: 'var(--color-2-border)', text: 'var(--color-2-text)' },
  { bg: 'var(--color-3-bg)', border: 'var(--color-3-border)', text: 'var(--color-3-text)' },
  { bg: 'var(--color-4-bg)', border: 'var(--color-4-border)', text: 'var(--color-4-text)' },
  { bg: 'var(--color-5-bg)', border: 'var(--color-5-border)', text: 'var(--color-5-text)' },
  { bg: 'var(--color-6-bg)', border: 'var(--color-6-border)', text: 'var(--color-6-text)' },
];

export const sampleClasses = [
  {
    period: '2026년 1학기',
    startDate: '2026-03-01',
    endDate: '2026-06-30',
    status: '수업 진행 중',
    subject: '영어',
    grade: '중2',
    className: '[중2 영어 김다인] 중2 A',
    schedule: '화목 17:00-19:00\n토 13:30-15:30',
    teacher: '김다인',
    classroom: '본1',
    capacity: 8,
    textbook: '중학 영문법 3800제 2학년',
  },
  {
    period: '2026년 1학기',
    startDate: '2026-03-01',
    endDate: '2026-06-30',
    status: '수업 진행 중',
    subject: '수학',
    grade: '중3',
    className: '[중3 수학 이정민] 중3 B1',
    schedule: '월수 17:30-19:30',
    teacher: '이정민',
    classroom: '본2',
    capacity: 10,
    textbook: '개념원리 중학수학 3-1',
  },
];

export const sampleTextbooks = [
  {
    id: 'tb-101',
    title: '중학 영문법 3800제 2학년',
    publisher: '마더텅',
    totalChapters: 8,
    lessons: [
      { id: 'ch1', title: 'Chapter 1: 문장의 형식' },
      { id: 'ch2', title: 'Chapter 2: 시제' },
      { id: 'ch3', title: 'Chapter 3: 조동사' },
    ],
  },
];

export const sampleProgressLogs = [
  {
    id: 'log-1',
    classId: 'class-0',
    textbookId: 'tb-101',
    completedLessonIds: ['ch1', 'ch2'],
    date: '2026-03-10',
    notes: '시제까지 진도를 마무리했습니다.',
  },
];

function safeText(value) {
  return String(value || '').trim();
}

function collapseWhitespace(value) {
  return safeText(value).replace(/\s+/g, ' ');
}

function normalizeLooseText(value) {
  return collapseWhitespace(value).replace(/\s+/g, '').toLowerCase();
}

function createDayMap() {
  return Object.fromEntries(DAY_LABELS.map((day) => [day, null]));
}

function toMonthEnd(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0);
}

function parseDateRange(marker) {
  const text = safeText(marker).replace(/^\[|\]$/g, '');
  const year = new Date().getFullYear();

  const monthRange = text.match(/^(\d{1,2})월?\s*~\s*(\d{1,2})월?$/);
  if (monthRange) {
    const fromMonth = Number(monthRange[1]) - 1;
    const toMonth = Number(monthRange[2]) - 1;
    return {
      from: new Date(year, fromMonth, 1),
      to: toMonthEnd(year, toMonth),
    };
  }

  const fromDate = text.match(/^(\d{1,2})\/(\d{1,2})\s*~$/);
  if (fromDate) {
    return {
      from: new Date(year, Number(fromDate[1]) - 1, Number(fromDate[2])),
      to: null,
    };
  }

  const toDate = text.match(/^~\s*(\d{1,2})\/(\d{1,2})$/);
  if (toDate) {
    return {
      from: null,
      to: new Date(year, Number(toDate[1]) - 1, Number(toDate[2])),
    };
  }

  const fullDate = text.match(/^(\d{1,2})\/(\d{1,2})\s*~\s*(\d{1,2})\/(\d{1,2})$/);
  if (fullDate) {
    return {
      from: new Date(year, Number(fullDate[1]) - 1, Number(fullDate[2])),
      to: new Date(year, Number(fullDate[3]) - 1, Number(fullDate[4])),
    };
  }

  return null;
}

function isDateInRange(range, target = new Date()) {
  if (!range) return true;
  if (range.from && target < range.from) return false;
  if (range.to) {
    const endOfDay = new Date(range.to);
    endOfDay.setHours(23, 59, 59, 999);
    if (target > endOfDay) {
      return false;
    }
  }
  return true;
}

export function getClassroomDisplayName(value) {
  return normalizeSingleClassroomLabel(value);
}

export function getClassroomCanonicalKey(value) {
  return getCanonicalClassroomKey(value);
}

export function getTeacherCanonicalKey(value) {
  return normalizeLooseText(value);
}

export function splitTeacherList(value) {
  return safeText(value)
    .split(/[,/\n·]+/)
    .map((item) => collapseWhitespace(item))
    .filter(Boolean);
}

export function splitClassroomList(value) {
  const text = normalizeClassroomText(value);
  if (!text) return [];

  const dayAssignments = parseDaySpecificClassrooms(text);
  const assignedRooms = Object.values(dayAssignments).filter(Boolean);
  if (assignedRooms.length > 0) {
    return [...new Set(assignedRooms)];
  }

  return text
    .split(/[,/\n·]+/)
    .map((item) => getClassroomDisplayName(item))
    .filter(Boolean);
}

export function parseDaySpecificClassrooms(value) {
  const text = normalizeClassroomText(collapseWhitespace(value));
  const assignments = createDayMap();
  let found = false;
  const regex = /([가-힣A-Za-z0-9\s]+?)\s*\(([월화수목금토일]+)\)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const roomLabel = getClassroomDisplayName(match[1]);
    if (!roomLabel) continue;
    for (const day of match[2]) {
      if (DAY_SET.has(day)) {
        assignments[day] = roomLabel;
        found = true;
      }
    }
  }

  return found ? assignments : createDayMap();
}

function matchCanonicalCandidate(candidates, token, keyFn) {
  const tokenKey = keyFn(token);
  if (!tokenKey) return null;

  return candidates.find((candidate) => {
    const candidateKey = keyFn(candidate);
    return candidateKey === tokenKey || candidateKey.includes(tokenKey) || tokenKey.includes(candidateKey);
  }) || null;
}

function resolveOverride(slot, contextObj) {
  const override = safeText(slot.override);
  if (!override) return slot;

  const teacherList = splitTeacherList(contextObj?.teacher);
  const classroomList = splitClassroomList(contextObj?.classroom || contextObj?.room);
  const parts = override.split(/[,/·]+/).map((part) => collapseWhitespace(part)).filter(Boolean);
  let teacher = null;
  let classroom = null;

  for (const part of parts) {
    if (!teacher) {
      teacher = matchCanonicalCandidate(teacherList, part, getTeacherCanonicalKey);
      if (!teacher && !isClassroomAlias(part)) {
        teacher = part;
      }
    }

    if (!classroom) {
      const matchedRoom = matchCanonicalCandidate(classroomList, part, getClassroomCanonicalKey);
      if (matchedRoom) {
        classroom = matchedRoom;
      } else if (isClassroomAlias(part)) {
        classroom = getClassroomDisplayName(part);
      }
    }
  }

  if (!classroom && parts.length === 1 && isClassroomAlias(parts[0])) {
    classroom = getClassroomDisplayName(parts[0]);
  }

  return {
    ...slot,
    teacher: teacher || slot.teacher || null,
    classroom: classroom || slot.classroom || null,
  };
}

function parseOneSectionSlots(text) {
  const normalized = safeText(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const slots = [];
  const regex = /([월화수목금토일]+)\s*([0-9]{1,2}:\d{2})\s*-\s*([0-9]{1,2}:\d{2})(?:\s*\(([^)]+)\))?/g;
  let match;

  while ((match = regex.exec(normalized)) !== null) {
    const days = safeText(match[1]);
    const start = safeText(match[2]);
    const end = safeText(match[3]);
    const override = safeText(match[4]);

    for (const day of days) {
      if (!DAY_SET.has(day)) continue;
      slots.push({
        day,
        start,
        end,
        override: override || null,
      });
    }
  }

  return slots;
}

export function parseScheduleMeta(scheduleStr) {
  if (!safeText(scheduleStr)) {
    return { activeSections: [], allSections: [], hasVariants: false, rawNote: '' };
  }

  const normalized = safeText(scheduleStr).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const markerRegex = /(\[[^\]]+\])/g;
  const parts = normalized.split(markerRegex).filter((part) => safeText(part));
  const sections = [];
  let index = 0;

  if (parts.length > 0 && !/^\[[^\]]+\]$/.test(parts[0])) {
    const slots = parseOneSectionSlots(parts[0]);
    if (slots.length > 0) {
      sections.push({ label: null, dateRange: null, slots });
    }
    index = 1;
  }

  while (index < parts.length) {
    const marker = parts[index];
    if (!/^\[[^\]]+\]$/.test(marker)) {
      index += 1;
      continue;
    }

    const slots = parseOneSectionSlots(parts[index + 1] || '');
    if (slots.length > 0) {
      sections.push({
        label: marker.replace(/^\[|\]$/g, ''),
        dateRange: parseDateRange(marker),
        slots,
      });
    }
    index += 2;
  }

  const dated = sections.filter((section) => section.dateRange);
  const undated = sections.filter((section) => !section.dateRange);
  const activeSections = dated.length > 0
    ? dated.filter((section) => isDateInRange(section.dateRange))
    : undated;

  return {
    activeSections: activeSections.length > 0 ? activeSections : undated,
    allSections: sections,
    hasVariants: sections.length > 1,
    rawNote: normalized,
  };
}

export function parseSchedule(scheduleStr, contextObj = null) {
  const meta = parseScheduleMeta(scheduleStr);
  const classroomByDay = parseDaySpecificClassrooms(contextObj?.classroom || contextObj?.room);
  const classroomList = splitClassroomList(contextObj?.classroom || contextObj?.room);
  const singleClassroom = classroomList.length === 1 ? classroomList[0] : '';
  const teacherList = splitTeacherList(contextObj?.teacher);

  return meta.activeSections.flatMap((section) =>
    section.slots.map((rawSlot) => {
      let slot = {
        ...rawSlot,
        teacher: null,
        classroom: null,
      };

      if (contextObj) {
        slot = resolveOverride(slot, contextObj);
      } else if (slot.override && isClassroomAlias(slot.override)) {
        slot.classroom = getClassroomDisplayName(slot.override);
      }

      if (!slot.classroom && classroomByDay[slot.day]) {
        slot.classroom = classroomByDay[slot.day];
      }

      if (!slot.classroom && singleClassroom) {
        slot.classroom = singleClassroom;
      }

      if (slot.classroom) {
        slot.classroom = getClassroomDisplayName(slot.classroom);
        slot.classroomKey = getClassroomCanonicalKey(slot.classroom);
      } else {
        slot.classroomKey = '';
      }

      if (slot.teacher) {
        slot.teacherKey = getTeacherCanonicalKey(slot.teacher);
      } else if (teacherList.length === 1) {
        slot.teacher = teacherList[0];
        slot.teacherKey = getTeacherCanonicalKey(slot.teacher);
      } else {
        slot.teacherKey = '';
      }

      return slot;
    })
  );
}

export function generateTimeSlots(startHour = 9, endHour = 24) {
  const slots = [];
  for (let hour = startHour; hour < endHour; hour += 1) {
    const nextHour = hour + 1;
    slots.push(`${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:30`);
    slots.push(`${String(hour).padStart(2, '0')}:30-${String(nextHour).padStart(2, '0')}:00`);
  }
  return slots;
}

export function timeToSlotIndex(timeStr, baseHour = 9) {
  const [hour, minute] = safeText(timeStr).split(':').map(Number);
  return (hour - baseHour) * 2 + (minute >= 30 ? 1 : 0);
}

export function stripClassPrefix(className) {
  return safeText(className).replace(/^\[[^\]]+\]\s*/, '');
}

export function normalizeClassNameForMatching(className) {
  return stripClassPrefix(className)
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[\s\-_,/]/g, '')
    .toLowerCase();
}

export function parseClassPrefix(className) {
  const match = safeText(className).match(/^\[(.*?)\]/);
  if (!match) {
    return null;
  }

  const parts = collapseWhitespace(match[1]).split(' ').filter(Boolean);
  if (parts.length < 3) {
    return null;
  }

  return {
    grade: parts[0],
    subject: parts[1],
    teacher: parts.slice(2).join(' '),
  };
}

export function computeWeeklyMinutes(scheduleStr, contextObj = null) {
  return parseSchedule(scheduleStr, contextObj).reduce((total, slot) => {
    const [startHour, startMinute] = slot.start.split(':').map(Number);
    const [endHour, endMinute] = slot.end.split(':').map(Number);
    return total + ((endHour * 60 + endMinute) - (startHour * 60 + startMinute));
  }, 0);
}

export function formatHours(minutes) {
  const safeMinutes = Number(minutes || 0);
  if (!safeMinutes) {
    return '0시간';
  }

  const hours = Math.floor(safeMinutes / 60);
  const remain = safeMinutes % 60;
  if (hours === 0) {
    return `${remain}분`;
  }
  if (remain === 0) {
    return `${hours}시간`;
  }
  return `${hours}시간 ${remain}분`;
}
