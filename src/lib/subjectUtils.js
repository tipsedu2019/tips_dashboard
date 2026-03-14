export const DEFAULT_SUBJECT_OPTIONS = ['영어', '수학'];

function normalizeSubject(value) {
  return String(value || '').trim();
}

export function compareSubjects(left, right) {
  const safeLeft = normalizeSubject(left);
  const safeRight = normalizeSubject(right);
  const leftIndex = DEFAULT_SUBJECT_OPTIONS.indexOf(safeLeft);
  const rightIndex = DEFAULT_SUBJECT_OPTIONS.indexOf(safeRight);

  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  }

  return safeLeft.localeCompare(safeRight, 'ko');
}

export function sortSubjectOptions(values = [], { includeDefaults = true } = {}) {
  const items = [
    ...(includeDefaults ? DEFAULT_SUBJECT_OPTIONS : []),
    ...values,
  ]
    .map(normalizeSubject)
    .filter(Boolean);

  return [...new Set(items)].sort(compareSubjects);
}
