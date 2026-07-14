export type StudentClassPickerScope = "same-grade" | "all-grades";

export type StudentClassPickerOptions = {
  studentGrade: unknown;
  scope: StudentClassPickerScope;
  query: unknown;
};

function text(value: unknown) {
  return String(value || "").trim();
}

function normalizeGrade(value: unknown) {
  return text(value).replace(/\s+/g, "");
}

export function getDefaultStudentClassPickerScope(
  student: Record<string, unknown>,
): StudentClassPickerScope {
  return normalizeGrade(student.grade) ? "same-grade" : "all-grades";
}

export function filterStudentClassCandidates<T extends Record<string, unknown>>(
  classes: T[],
  options: StudentClassPickerOptions,
): T[] {
  const studentGrade = normalizeGrade(options.studentGrade);
  const query = text(options.query).toLowerCase();

  return classes.filter((classRecord) => {
    if (
      options.scope === "same-grade"
      && studentGrade
      && normalizeGrade(classRecord.grade) !== studentGrade
    ) {
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
    ].filter(Boolean).join(" ").toLowerCase();

    return haystack.includes(query);
  });
}
