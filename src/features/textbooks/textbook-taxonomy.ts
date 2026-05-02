type Row = Record<string, unknown>;

function text(value: unknown) {
  return String(value || "").trim();
}

export const TEXTBOOK_SUBJECT_OPTIONS = [
  { value: "english", label: "영어" },
  { value: "math", label: "수학" },
  { value: "other", label: "기타" },
];

export const TEXTBOOK_SUBJECT_ALIASES: Record<string, string> = {
  english: "english",
  영어: "english",
  math: "math",
  수학: "math",
  other: "other",
  기타: "other",
};

export const TEXTBOOK_SCHOOL_LEVEL_OPTIONS = [
  { value: "elementary", label: "초등" },
  { value: "middle", label: "중등" },
  { value: "high", label: "고등" },
];

export const TEXTBOOK_GRADE_OPTIONS = [
  { value: "e1", label: "초1", schoolLevel: "elementary" },
  { value: "e2", label: "초2", schoolLevel: "elementary" },
  { value: "e3", label: "초3", schoolLevel: "elementary" },
  { value: "e4", label: "초4", schoolLevel: "elementary" },
  { value: "e5", label: "초5", schoolLevel: "elementary" },
  { value: "e6", label: "초6", schoolLevel: "elementary" },
  { value: "m1", label: "중1", schoolLevel: "middle" },
  { value: "m2", label: "중2", schoolLevel: "middle" },
  { value: "m3", label: "중3", schoolLevel: "middle" },
  { value: "h1", label: "고1", schoolLevel: "high" },
  { value: "h2", label: "고2", schoolLevel: "high" },
  { value: "h3", label: "고3", schoolLevel: "high" },
];

export const DEFAULT_TEXTBOOK_SUB_SUBJECTS: Record<string, string[]> = {
  english: ["단어", "독해", "듣기", "문법", "모고", "내신"],
  math: ["공통수학1", "공통수학2", "대수", "미적분", "확률과 통계", "기하", "수1", "수2", "내신"],
  other: ["기타"],
};

export type TextbookSubSubjectSettingRecord = {
  id: string;
  subject: string;
  name: string;
  sortOrder: number;
  isVisible: boolean;
  isNew?: boolean;
};

export function normalizeTextbookSubject(value: unknown) {
  const raw = text(value);
  return TEXTBOOK_SUBJECT_ALIASES[raw] || TEXTBOOK_SUBJECT_ALIASES[raw.toLowerCase()] || "other";
}

export function getTextbookSubjectLabel(value: unknown) {
  const raw = text(value);
  const normalized = normalizeTextbookSubject(raw);
  return TEXTBOOK_SUBJECT_OPTIONS.find((option) => option.value === normalized)?.label || raw || "-";
}

export function normalizeTextbookSchoolLevel(value: unknown) {
  const raw = text(value);
  const lower = raw.toLowerCase();
  if (["elementary", "초등", "초"].includes(lower) || raw.includes("초등")) return "elementary";
  if (["middle", "중등", "중"].includes(lower) || raw.includes("중등")) return "middle";
  if (["high", "고등", "고"].includes(lower) || raw.includes("고등")) return "high";
  return "";
}

export function getTextbookSchoolLevel(row: Row) {
  const explicit = normalizeTextbookSchoolLevel(row.school_level || row.schoolLevel || row.school_category || row.schoolCategory);
  if (explicit) return explicit;
  const source = `${text(row.category)} ${text(row.title || row.name)}`;
  return normalizeTextbookSchoolLevel(source);
}

export function getTextbookSchoolLevelLabel(value: unknown) {
  const normalized = normalizeTextbookSchoolLevel(value);
  return TEXTBOOK_SCHOOL_LEVEL_OPTIONS.find((option) => option.value === normalized)?.label || "";
}

export function normalizeTextbookGradeLevel(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const direct = TEXTBOOK_GRADE_OPTIONS.find((option) => option.value === raw || option.label === raw);
  if (direct) return direct.value;
  const gradeMatch = raw.match(/(초|중|고)\s*([1-6])/);
  if (!gradeMatch) return "";
  const prefix = gradeMatch[1] === "초" ? "e" : gradeMatch[1] === "중" ? "m" : "h";
  return `${prefix}${gradeMatch[2]}`;
}

export function getTextbookGradeLevel(row: Row) {
  const explicit = normalizeTextbookGradeLevel(row.grade_level || row.gradeLevel || row.grade);
  if (explicit) return explicit;
  return normalizeTextbookGradeLevel(`${text(row.category)} ${text(row.title || row.name)}`);
}

export function getTextbookGradeLabel(value: unknown) {
  const normalized = normalizeTextbookGradeLevel(value);
  return TEXTBOOK_GRADE_OPTIONS.find((option) => option.value === normalized)?.label || "";
}

export function getTextbookSubSubject(row: Row) {
  const explicit = text(row.sub_subject || row.subSubject);
  if (explicit) return explicit;
  const category = text(row.category);
  if (!category) return "";
  return category
    .replace(/^(초등|중등|고등)\s*/u, "")
    .replace(/^(초|중|고)\s*[1-6]\s*/u, "")
    .trim();
}

export function getTextbookCategoryLabel(row: Row) {
  const parts = [
    getTextbookSchoolLevelLabel(getTextbookSchoolLevel(row)),
    getTextbookGradeLabel(getTextbookGradeLevel(row)),
    getTextbookSubSubject(row),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : text(row.category) || "미분류";
}

export function buildTextbookCategoryValue(record: Row) {
  return [
    getTextbookSchoolLevelLabel(record.schoolLevel || record.school_level),
    getTextbookGradeLabel(record.gradeLevel || record.grade_level),
    text(record.subSubject || record.sub_subject),
  ]
    .filter(Boolean)
    .join(" ");
}

export function getGradeOptionsForSchoolLevel(schoolLevel: string) {
  return TEXTBOOK_GRADE_OPTIONS.filter((option) => !schoolLevel || option.schoolLevel === schoolLevel);
}

export function createDefaultSubSubjectSettings() {
  return Object.entries(DEFAULT_TEXTBOOK_SUB_SUBJECTS).flatMap(([subject, names]) =>
    names.map((name, index) => ({
      id: `${subject}-${name}`,
      subject,
      name,
      sortOrder: (index + 1) * 10,
      isVisible: true,
      isNew: true,
    })),
  );
}

export function toTextbookSubSubjectSettingRecord(row: Row): TextbookSubSubjectSettingRecord {
  return {
    id: text(row.id) || `${normalizeTextbookSubject(row.subject)}-${text(row.name)}`,
    subject: normalizeTextbookSubject(row.subject),
    name: text(row.name),
    sortOrder: Number(row.sort_order || row.sortOrder || 0),
    isVisible: row.is_visible === false || row.isVisible === false ? false : true,
  };
}

export function mergeTextbookSubSubjectSettings(rows: Row[] = []) {
  const records = rows.map(toTextbookSubSubjectSettingRecord).filter((row) => row.name);
  const keySet = new Set(records.map((row) => `${row.subject}:${row.name}`));
  const defaults = createDefaultSubSubjectSettings().filter((row) => !keySet.has(`${row.subject}:${row.name}`));
  return [...records, ...defaults].sort((left, right) => {
    const subjectDiff =
      TEXTBOOK_SUBJECT_OPTIONS.findIndex((option) => option.value === left.subject) -
      TEXTBOOK_SUBJECT_OPTIONS.findIndex((option) => option.value === right.subject);
    if (subjectDiff !== 0) return subjectDiff;
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.name.localeCompare(right.name, "ko", { numeric: true });
  });
}

export function getSubSubjectOptionsForSubject(settings: TextbookSubSubjectSettingRecord[], subject: string) {
  const normalizedSubject = subject === "all" ? "" : normalizeTextbookSubject(subject);
  return settings
    .filter((row) => row.isVisible && (!normalizedSubject || row.subject === normalizedSubject))
    .map((row) => row.name)
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right, "ko", { numeric: true }));
}

export function compareTextbookCategoryLabels(left: string, right: string) {
  const schoolOrder = TEXTBOOK_SCHOOL_LEVEL_OPTIONS.map((option) => option.label);
  const leftSchoolIndex = schoolOrder.findIndex((label) => left.startsWith(label));
  const rightSchoolIndex = schoolOrder.findIndex((label) => right.startsWith(label));
  const safeLeftSchool = leftSchoolIndex === -1 ? schoolOrder.length : leftSchoolIndex;
  const safeRightSchool = rightSchoolIndex === -1 ? schoolOrder.length : rightSchoolIndex;
  if (safeLeftSchool !== safeRightSchool) return safeLeftSchool - safeRightSchool;
  return left.localeCompare(right, "ko", { numeric: true });
}
