export const LEGACY_ACTIVE_CLASS_STATUS = '수강';
export const LEGACY_UPCOMING_CLASS_STATUS = '개강 예정';

export const ACTIVE_CLASS_STATUS = '수업 진행 중';
export const PREPARING_CLASS_STATUS = '개강 준비 중';
export const ENDED_CLASS_STATUS = '종강';

export const CLASS_STATUS_OPTIONS = [
  ACTIVE_CLASS_STATUS,
  PREPARING_CLASS_STATUS,
  ENDED_CLASS_STATUS,
];

export function normalizeClassStatus(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  if (text === LEGACY_ACTIVE_CLASS_STATUS) {
    return ACTIVE_CLASS_STATUS;
  }

  if (text === LEGACY_UPCOMING_CLASS_STATUS) {
    return PREPARING_CLASS_STATUS;
  }

  return CLASS_STATUS_OPTIONS.includes(text) ? text : '';
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function computeClassStatus(classItem, now = new Date()) {
  const explicit = normalizeClassStatus(classItem?.status);
  if (explicit) {
    return explicit;
  }

  const currentDate = parseDate(now);
  const startDate = parseDate(classItem?.startDate || classItem?.start_date);
  const endDate = parseDate(classItem?.endDate || classItem?.end_date);

  if (currentDate && startDate && startDate > currentDate) {
    return PREPARING_CLASS_STATUS;
  }

  if (currentDate && endDate) {
    const inclusiveEnd = new Date(endDate);
    inclusiveEnd.setHours(23, 59, 59, 999);
    if (inclusiveEnd < currentDate) {
      return ENDED_CLASS_STATUS;
    }
  }

  return ACTIVE_CLASS_STATUS;
}
