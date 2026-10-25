import { TEXTBOOK_GRADE_OPTIONS, TEXTBOOK_SUBJECT_OPTIONS } from "./textbook-taxonomy.ts";
import type { SearchSelectFilterGroup } from "./textbook-read-types";

// Browsing choices are narrower than the stored taxonomy and write contracts.
export function isRetiredTextbookSubjectFilter(value: string) {
  return ["other", "기타"].includes(value.trim().toLowerCase());
}

export function isRetiredTextbookGradeFilter(value: string) {
  return /^(?:e[1-4]|초[1-4])$/.test(value.trim().toLowerCase());
}

export const TEXTBOOK_FILTER_SUBJECT_OPTIONS = TEXTBOOK_SUBJECT_OPTIONS.filter(
  (option) => !isRetiredTextbookSubjectFilter(option.value),
);

export const TEXTBOOK_FILTER_GRADE_OPTIONS = TEXTBOOK_GRADE_OPTIONS.filter(
  (option) => !isRetiredTextbookGradeFilter(option.value),
);

export function getTextbookFilterGradeOptions(schoolLevel: string) {
  return TEXTBOOK_FILTER_GRADE_OPTIONS.filter(
    (option) => !schoolLevel || schoolLevel === "all" || option.schoolLevel === schoolLevel,
  );
}

export function normalizeTextbookCatalogFilters<T extends { subject: string; gradeLevel: string; subSubject: string }>(
  filters: T,
  emptyValue: "all" | "" = "all",
): T {
  const retireSubject = isRetiredTextbookSubjectFilter(filters.subject);
  const retireGrade = isRetiredTextbookGradeFilter(filters.gradeLevel);
  if (!retireSubject && !retireGrade) return filters;
  return {
    ...filters,
    subject: retireSubject ? emptyValue : filters.subject,
    gradeLevel: retireGrade ? emptyValue : filters.gradeLevel,
    subSubject: retireSubject ? emptyValue : filters.subSubject,
  };
}

export function normalizeTextbookPickerFilters(filters: Record<string, string[]>) {
  const subjects = filters.subject?.filter((value) => !isRetiredTextbookSubjectFilter(value));
  const grades = filters.grade?.filter((value) => !isRetiredTextbookGradeFilter(value));
  const subjectChanged = subjects?.length !== filters.subject?.length;
  const gradeChanged = grades?.length !== filters.grade?.length;
  if (!subjectChanged && !gradeChanged) return filters;
  const next = { ...filters };
  if (subjectChanged) {
    if (subjects?.length) next.subject = subjects;
    else {
      delete next.subject;
      delete next.subSubject;
    }
  }
  if (gradeChanged) {
    if (grades?.length) next.grade = grades;
    else delete next.grade;
  }
  return next;
}

export function filterTextbookPickerGroups(groups: SearchSelectFilterGroup[]) {
  return groups.map((group) => {
    const retired = group.key === "subject" ? isRetiredTextbookSubjectFilter
      : group.key === "grade" ? isRetiredTextbookGradeFilter : null;
    if (!retired) return group;
    const options = group.options.filter((option) => !retired(option.value) && !retired(option.label));
    return options.length === group.options.length ? group : { ...group, options };
  }).filter((group) => group.options.length > 0);
}
