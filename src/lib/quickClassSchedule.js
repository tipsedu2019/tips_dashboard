import { DAY_LABELS } from '../data/sampleData';
import { CLASS_STATUS_OPTIONS, normalizeClassStatus } from './classStatus';
import { normalizeClassroomText } from './classroomUtils';

function createId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `quick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function unique(values = []) {
  return [...new Set(
    values
      .filter(Boolean)
      .map((value) => String(value).trim())
      .filter(Boolean)
  )];
}

function sortScheduleLines(lines = []) {
  return [...lines].sort((left, right) => {
    const dayDiff = DAY_LABELS.indexOf(left.day) - DAY_LABELS.indexOf(right.day);
    if (dayDiff !== 0) {
      return dayDiff;
    }
    return String(left.start || '').localeCompare(String(right.start || ''));
  });
}

export function createQuickScheduleLine(seed = {}) {
  return {
    id: seed.id || createId(),
    day: seed.day || DAY_LABELS[0],
    start: seed.start || '09:00',
    end: seed.end || '10:00',
    classroom: normalizeClassroomText(seed.classroom || ''),
  };
}

export function ensureQuickScheduleLines(lines = [], fallback = {}) {
  const nextLines = (lines || []).map((line) => createQuickScheduleLine(line));
  if (nextLines.length > 0) {
    return sortScheduleLines(nextLines);
  }
  return [createQuickScheduleLine(fallback)];
}

export function buildQuickCreateDraft({
  day,
  start,
  end,
  classroom = '',
  teacher = '',
  defaultStatus = CLASS_STATUS_OPTIONS[0],
  period = '',
}) {
  return {
    className: '',
    subject: '영어',
    grade: '',
    teacher: teacher || '',
    status: normalizeClassStatus(defaultStatus) || CLASS_STATUS_OPTIONS[0],
    period: period || '',
    scheduleLines: ensureQuickScheduleLines([{ day, start, end, classroom }], { day, start, end, classroom }),
  };
}

function isValidTimeRange(start, end) {
  return String(start || '').trim() && String(end || '').trim() && String(start) < String(end);
}

export function validateQuickCreateDraft(draft, { needsTeacher = false } = {}) {
  if (!String(draft?.className || '').trim()) {
    return '수업명을 입력해 주세요.';
  }
  if (!String(draft?.subject || '').trim()) {
    return '과목을 입력해 주세요.';
  }
  if (needsTeacher && !String(draft?.teacher || '').trim()) {
    return '선생님을 입력해 주세요.';
  }

  const lines = ensureQuickScheduleLines(draft?.scheduleLines || []);
  if (lines.length === 0) {
    return '수업 일정은 한 줄 이상 추가해 주세요.';
  }

  for (const line of lines) {
    if (!DAY_LABELS.includes(line.day)) {
      return '수업 일정의 요일을 다시 확인해 주세요.';
    }
    if (!isValidTimeRange(line.start, line.end)) {
      return '수업 일정의 시작/종료 시간을 다시 확인해 주세요.';
    }
    if (!String(line.classroom || '').trim()) {
      return '각 수업 일정에 강의실을 입력해 주세요.';
    }
  }

  return '';
}

export function buildQuickClassPayload(draft, { fallbackTeacher = '' } = {}) {
  const lines = ensureQuickScheduleLines(draft?.scheduleLines || []);
  const teacher = String(draft?.teacher || fallbackTeacher || '').trim();
  const classrooms = unique(lines.map((line) => normalizeClassroomText(line.classroom)));
  const baseClassroom = classrooms.length === 1 ? classrooms[0] : classrooms.join(', ');

  const schedule = sortScheduleLines(lines)
    .map((line) => {
      const room = normalizeClassroomText(line.classroom);
      const overrideParts = [];

      if (classrooms.length > 1 && room) {
        overrideParts.push(room);
      }

      return `${line.day} ${line.start}-${line.end}${overrideParts.length > 0 ? `(${overrideParts.join('/')})` : ''}`;
    })
    .join('\n');

  return {
    className: String(draft?.className || '').trim(),
    subject: String(draft?.subject || '').trim(),
    grade: String(draft?.grade || '').trim(),
    teacher,
    classroom: baseClassroom,
    schedule,
    status: normalizeClassStatus(draft?.status) || CLASS_STATUS_OPTIONS[0],
    period: String(draft?.period || '').trim(),
  };
}
