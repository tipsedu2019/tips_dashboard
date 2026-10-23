export type ClassScheduleFormRow = {
  key: string;
  day: string;
  startTime: string;
  endTime: string;
  teacher: string;
  classroom: string;
};
export type ClassFormOption = { value: string; label: string; disabled?: boolean };

/** Shared presentation order; storage names and optional fields remain adapter-owned. */
export const CLASS_INFORMATION_FIELD_ORDER = [
  'name', 'status', 'grade', 'subject', 'subjectAreaKey', 'capacity', 'fee', 'tuition', 'publicMemo',
] as const;
export function orderClassInformationFields<T extends { name: string }>(fields: T[]): T[] {
  const index = new Map<string, number>(CLASS_INFORMATION_FIELD_ORDER.map((name, i) => [name, i]));
  return fields.map((field, i) => ({field, i})).sort((a, b) =>
    (index.get(a.field.name) ?? 100) - (index.get(b.field.name) ?? 100) || a.i - b.i,
  ).map(({field}) => field);
}
