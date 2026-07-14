import {
  TEXTBOOK_GRADE_OPTIONS,
  getTextbookGradeSummary,
  getTextbookSchoolLevelSummary,
  getTextbookSubjectLabel,
  getTextbookSubSubject,
  matchesTextbookTaxonomy,
  normalizeTextbookGradeLevel,
  normalizeTextbookSchoolLevel,
  normalizeTextbookSubject,
} from "../textbooks/textbook-taxonomy.ts";

export type ClassTextbookPickerFilters = {
  subject: string;
  schoolLevel: string;
  gradeLevel: string;
  subSubject: string;
};

export type ClassTextbookRecord = {
  id: string;
  title: string;
  subject: string;
  schoolLevel: string;
  gradeLevel: string;
  schoolLevels: string[];
  gradeLevels: string[];
  subSubject: string;
  publisher: string;
};

function text(value: unknown) {
  return String(value || "").trim();
}

export function getDefaultClassTextbookFilters(
  classRecord: Record<string, unknown>,
): ClassTextbookPickerFilters {
  const rawSubject = text(classRecord.subject);
  const gradeLevel = normalizeTextbookGradeLevel(classRecord.grade || classRecord.gradeLevel || classRecord.grade_level);
  const derivedSchool = TEXTBOOK_GRADE_OPTIONS.find((option) => option.value === gradeLevel)?.schoolLevel || "";

  return {
    subject: rawSubject ? normalizeTextbookSubject(rawSubject) : "",
    schoolLevel: derivedSchool || normalizeTextbookSchoolLevel(classRecord.schoolLevel || classRecord.school_level),
    gradeLevel,
    subSubject: text(classRecord.subSubject || classRecord.sub_subject),
  };
}

export function filterClassTextbookCandidates<T extends Record<string, unknown>>(
  textbooks: T[],
  filters: ClassTextbookPickerFilters,
  query: string,
): T[] {
  const keyword = text(query).toLowerCase();

  return textbooks.filter((textbook) => {
    if (!matchesTextbookTaxonomy(textbook, filters)) return false;
    if (!keyword) return true;

    const haystack = [
      textbook.title || textbook.name,
      getTextbookSubjectLabel(textbook.subject),
      getTextbookSchoolLevelSummary(textbook),
      getTextbookGradeSummary(textbook),
      getTextbookSubSubject(textbook),
      textbook.publisher,
    ].map(text).join(" ").toLowerCase();
    return haystack.includes(keyword);
  });
}
