export type StudentClassPickerScope = "same-grade" | "all-grades";

export type StudentClassPickerOptions = {
  studentGrade: unknown;
  scope: StudentClassPickerScope;
  query: unknown;
  subject?: unknown;
  grade?: unknown;
};

export type StudentClassPickerFilters = {
  subject: string;
  grade: string;
};

export type ClassStudentPickerFilters = {
  grade: string;
  school: string;
};

function text(value: unknown) {
  return String(value || "").trim();
}

function normalizeGrade(value: unknown) {
  return text(value).replace(/\s+/g, "");
}

function uniqueSorted(values: unknown[]) {
  return [...new Set(values.map(text).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "ko"));
}

export function getDefaultStudentClassPickerScope(
  student: Record<string, unknown>,
): StudentClassPickerScope {
  return normalizeGrade(student.grade) ? "same-grade" : "all-grades";
}

export function getDefaultStudentClassPickerFilters(
  student: Record<string, unknown>,
): StudentClassPickerFilters {
  return { subject: "", grade: normalizeGrade(student.grade) };
}

export function getStudentClassSubjectOptions(
  classes: Record<string, unknown>[],
) {
  return uniqueSorted(classes.map((classRecord) => classRecord.subject));
}

export function getStudentClassGradeOptions(
  classes: Record<string, unknown>[],
  subject: unknown,
) {
  const normalizedSubject = text(subject);
  return uniqueSorted(classes
    .filter((classRecord) => !normalizedSubject || text(classRecord.subject) === normalizedSubject)
    .map((classRecord) => normalizeGrade(classRecord.grade)));
}

export function filterStudentClassCandidates<T extends Record<string, unknown>>(
  classes: T[],
  options: StudentClassPickerOptions,
): T[] {
  const studentGrade = normalizeGrade(options.studentGrade);
  const selectedSubject = text(options.subject);
  const selectedGrade = normalizeGrade(options.grade)
    || (options.scope === "same-grade" ? studentGrade : "");
  const query = text(options.query).toLowerCase();

  return classes.filter((classRecord) => {
    if (selectedSubject && text(classRecord.subject) !== selectedSubject) {
      return false;
    }
    if (selectedGrade && normalizeGrade(classRecord.grade) !== selectedGrade) {
      return false;
    }

    if (!query) return true;
    const haystack = [
      classRecord.name,
      classRecord.className,
      classRecord.class_name,
      classRecord.subject,
      classRecord.grade,
      classRecord.teacher,
      classRecord.teacher_name,
      classRecord.schedule,
      classRecord.classroom,
      classRecord.room,
    ].filter(Boolean).join(" ").toLowerCase();

    return haystack.includes(query);
  });
}


export function getDefaultClassStudentPickerFilters(
  classRecord: Record<string, unknown>,
): ClassStudentPickerFilters {
  return { grade: normalizeGrade(classRecord.grade), school: "" };
}

export function getClassStudentGradeOptions(
  students: Record<string, unknown>[],
) {
  return uniqueSorted(students.map((student) => normalizeGrade(student.grade)));
}

export function getClassStudentSchoolOptions(
  students: Record<string, unknown>[],
  grade: unknown,
) {
  const normalizedGrade = normalizeGrade(grade);
  return uniqueSorted(students
    .filter((student) => !normalizedGrade || normalizeGrade(student.grade) === normalizedGrade)
    .map((student) => student.school));
}

export function filterClassStudentCandidates<T extends Record<string, unknown>>(
  students: T[],
  options: ClassStudentPickerFilters & { query: unknown },
): T[] {
  const selectedGrade = normalizeGrade(options.grade);
  const selectedSchool = text(options.school);
  const query = text(options.query).toLowerCase();

  return students.filter((student) => {
    if (selectedGrade && normalizeGrade(student.grade) !== selectedGrade) return false;
    if (selectedSchool && text(student.school) !== selectedSchool) return false;
    if (!query) return true;

    return [student.name, student.school, student.grade, student.contact, student.parent_contact]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}
