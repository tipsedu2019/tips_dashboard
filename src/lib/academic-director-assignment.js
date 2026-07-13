const ENGLISH_DIRECTORS = ["강부희", "정보영", "김민경"];

const ENGLISH_PHASE_BY_GRADE = new Map([
  ["초4", 0],
  ["중1", 0],
  ["고1", 0],
  ["초5", 1],
  ["중2", 1],
  ["고2", 1],
  ["초6", 2],
  ["중3", 2],
  ["고3", 2],
]);

function text(value) {
  return String(value ?? "").trim();
}

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function normalizeSubject(value) {
  const subject = text(value);
  if (subject === "영어" || subject === "수학") {
    return subject;
  }
  return subject;
}

function normalizeSubjects(subjects) {
  const values = Array.isArray(subjects) ? subjects : [subjects];
  const normalized = [];

  for (const value of values) {
    const subject = normalizeSubject(value);
    if (subject && !normalized.includes(subject)) {
      normalized.push(subject);
    }
  }

  return normalized;
}

function normalizeGrade(value) {
  const grade = text(value).replace(/\s+/g, "");
  const match = grade.match(/^(초|중|고)(\d)$/);
  if (!match) return "";

  const gradeNumber = Number(match[2]);
  const maxGrade = match[1] === "초" ? 6 : 3;
  return gradeNumber >= 1 && gradeNumber <= maxGrade ? `${match[1]}${gradeNumber}` : "";
}

function buildResult({
  status,
  directorName = "",
  candidateNames = [],
  reason,
  normalizedGrade,
  normalizedSubjects,
}) {
  return {
    status,
    directorName,
    candidateNames,
    reason,
    normalizedGrade,
    normalizedSubjects,
  };
}

function resolveSubjectDirector(subject, grade, effectiveYear) {
  if (subject === "수학") {
    if (/^[초중]\d$/.test(grade)) return "강정은";
    if (/^고\d$/.test(grade)) return "양소윤";
    return "";
  }

  if (subject === "영어") {
    const phase = ENGLISH_PHASE_BY_GRADE.get(grade);
    if (phase === undefined) return "";
    const ownerIndex = modulo(phase - (effectiveYear - 2026), ENGLISH_DIRECTORS.length);
    return ENGLISH_DIRECTORS[ownerIndex];
  }

  return "";
}

export function resolveAcademicDirector({ subjects = [], grade = "", effectiveYear } = {}) {
  const normalizedSubjects = normalizeSubjects(subjects);
  const normalizedGrade = normalizeGrade(grade);
  const year = Number(effectiveYear);

  if (normalizedSubjects.length === 0) {
    return buildResult({
      status: "unsupported",
      reason: "missing_subject",
      normalizedGrade,
      normalizedSubjects,
    });
  }

  if (!normalizedGrade) {
    return buildResult({
      status: "unsupported",
      reason: "unsupported_grade",
      normalizedGrade,
      normalizedSubjects,
    });
  }

  if (!Number.isInteger(year)) {
    return buildResult({
      status: "unsupported",
      reason: "invalid_effective_year",
      normalizedGrade,
      normalizedSubjects,
    });
  }

  const resolvedNames = [];
  for (const subject of normalizedSubjects) {
    const directorName = resolveSubjectDirector(subject, normalizedGrade, year);
    if (!directorName) {
      return buildResult({
        status: "unsupported",
        reason: subject === "영어" || subject === "수학" ? "unsupported_grade" : "unsupported_subject",
        normalizedGrade,
        normalizedSubjects,
      });
    }
    if (!resolvedNames.includes(directorName)) {
      resolvedNames.push(directorName);
    }
  }

  if (resolvedNames.length > 1) {
    return buildResult({
      status: "ambiguous",
      candidateNames: resolvedNames,
      reason: "subject_directors_disagree",
      normalizedGrade,
      normalizedSubjects,
    });
  }

  return buildResult({
    status: "resolved",
    directorName: resolvedNames[0],
    candidateNames: resolvedNames,
    reason: "approved_rule",
    normalizedGrade,
    normalizedSubjects,
  });
}
