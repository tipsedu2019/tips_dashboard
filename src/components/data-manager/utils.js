import {
  computeWeeklyMinutes,
  formatHours,
  parseSchedule,
  stripClassPrefix,
} from '../../data/sampleData';
import { computeClassStatus } from '../../lib/classStatus';
import { sortSubjectOptions } from '../../lib/subjectUtils';

export const ALL_OPTION = '전체';

export const DEFAULT_CLASS_COLUMNS = {
  status: true,
  subject: true,
  grade: true,
  className: true,
  schedule: true,
  teacher: true,
  classroom: true,
  studentCount: true,
  textbook: true,
  weeklyHours: true,
  fee: true,
};

export const CLASS_COLUMN_LABELS = {
  status: '운영 상태',
  subject: '과목',
  grade: '학년',
  className: '수업명',
  schedule: '요일/시간',
  teacher: '선생님',
  classroom: '강의실',
  studentCount: '수강 인원',
  textbook: '교재',
  weeklyHours: '주간 수업시간',
  fee: '수업료',
};

export function createId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean).map((value) => String(value).trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'ko'));
}

export function createEmptyStudent() {
  return {
    id: createId(),
    name: '',
    grade: '',
    school: '',
    contact: '',
    parentContact: '',
    enrollDate: new Date().toISOString().split('T')[0],
    classIds: [],
    waitlistClassIds: [],
  };
}

export function createEmptyClass() {
  return {
    id: createId(),
    className: '',
    status: '수업 진행 중',
    subject: '',
    grade: '',
    teacher: '',
    classroom: '',
    schedule: '',
    studentIds: [],
    waitlistIds: [],
    lessons: [],
    schedulePlan: null,
    textbookIds: [],
    textbookInfo: '',
    capacity: 0,
    fee: 0,
    period: '',
    startDate: '',
    endDate: '',
  };
}

export function createEmptyTextbook() {
  return {
    id: createId(),
    title: '',
    publisher: '',
    price: 0,
    tags: [],
    lessons: [],
  };
}

export function parseListInput(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value || '')
    .split(/[\n,;/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getClassDisplayName(classItem) {
  return stripClassPrefix(classItem?.className || classItem?.name || '');
}

export function getClassSearchText(classItem) {
  return [
    classItem?.className,
    getClassDisplayName(classItem),
    computeClassStatus(classItem),
    classItem?.subject,
    classItem?.grade,
    classItem?.teacher,
    classItem?.classroom,
    classItem?.schedule,
    classItem?.textbookInfo,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function getNormalizedClassStatus(classItem) {
  return computeClassStatus(classItem);
}

export function getStudentSearchText(student) {
  return [
    student?.name,
    student?.grade,
    student?.school,
    student?.contact,
    student?.parentContact,
    student?.uid,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function getTextbookSearchText(textbook) {
  return [
    textbook?.title,
    textbook?.publisher,
    ...(textbook?.tags || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function getClassSubjectOptions(classes) {
  return sortSubjectOptions((classes || []).map((item) => item.subject));
}

export function getTextbookTagOptions(textbooks) {
  return uniqueSorted((textbooks || []).flatMap((item) => item.tags || []));
}

export function matchClassByName(classes, name) {
  if (!name) return null;

  const target = String(name).trim();
  const normalizedTarget = stripClassPrefix(target);

  return (classes || []).find((classItem) => {
    const className = classItem?.className || classItem?.name || '';
    return className === target || stripClassPrefix(className) === normalizedTarget;
  }) || null;
}

export function formatCurrency(value) {
  const amount = Number(value || 0);
  if (!amount) {
    return '-';
  }

  return `${amount.toLocaleString('ko-KR')}원`;
}

export function getWeeklyHoursLabel(schedule) {
  const minutes = computeWeeklyMinutes(schedule);
  if (!minutes) {
    return '-';
  }

  return formatHours(minutes);
}

export function getScheduleSummary(schedule) {
  const parsed = parseSchedule(schedule);
  if (parsed.length === 0) {
    return schedule || '-';
  }

  return parsed.map((item) => `${item.day} ${item.start}-${item.end}`).join('\n');
}

export function getClassTextbookLabel(classItem, textbooks) {
  if ((classItem?.textbookIds || []).length > 0) {
    const names = classItem.textbookIds
      .map((id) => textbooks?.find((item) => item.id === id)?.title)
      .filter(Boolean);

    if (names.length > 0) {
      return names.join(', ');
    }
  }

  return classItem?.textbookInfo || classItem?.textbook || '-';
}

export function mergeUniqueIds(...groups) {
  return [...new Set(groups.flat().filter(Boolean))];
}
