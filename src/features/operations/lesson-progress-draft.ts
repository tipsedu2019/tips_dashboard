export type LessonProgressDraftEntry = {
  id: string;
  planStart: string;
  planEnd: string;
  planLabel: string;
  planMemo: string;
};

export type LessonProgressDraftField = "planStart" | "planEnd" | "planLabel" | "planMemo";

export function createLessonProgressDraft(entries: LessonProgressDraftEntry[]) {
  return entries.map((entry) => ({ ...entry }));
}

export function updateLessonProgressDraftEntry(
  draft: LessonProgressDraftEntry[],
  entryId: string,
  field: LessonProgressDraftField,
  value: string,
) {
  return draft.map((entry) => (entry.id === entryId ? { ...entry, [field]: value } : entry));
}
