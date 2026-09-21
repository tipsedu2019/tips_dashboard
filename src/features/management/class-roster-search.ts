/** Search only accepted roster rows; callers retain pagination and membership IDs. */
export function matchesClassRosterSearch(query: string, values: unknown[]) {
  const words = query.trim().toLocaleLowerCase('ko-KR').split(/\s+/).filter(Boolean);
  const text = values.filter(value => value != null).map(String).join(' ').toLocaleLowerCase('ko-KR');
  return words.every(word => text.includes(word)
    || (/^[\d-]+$/.test(word) && /\d/.test(word) && values.some(value =>
      String(value ?? '').replace(/[^\d]/g, '').includes(word.replace(/-/g, '')))));
}

export function buildClassRosterReturnPath(search: string, classId: string, tab: string, studentId?: string) {
  const params = new URLSearchParams(search);
  params.set('classId', classId);
  params.set('tab', tab);
  params.delete('studentId');
  params.delete('section');
  params.delete('sessionId');
  if (studentId) params.set('studentId', studentId);
  return `/admin/classes?${params.toString()}`;
}
