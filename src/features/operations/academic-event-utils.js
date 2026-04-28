function text(value) {
  return String(value || "").trim();
}

const PERSISTED_ACADEMIC_EVENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getPersistedAcademicEventId(value) {
  const id = text(value);
  return PERSISTED_ACADEMIC_EVENT_ID_PATTERN.test(id) ? id : "";
}

function normalizeEndDate(start, end) {
  const startValue = text(start);
  const endValue = text(end);

  if (!startValue) {
    return endValue;
  }

  if (!endValue || endValue < startValue) {
    return startValue;
  }

  return endValue;
}

function generateId() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function findSchool(schoolId, schoolOptions = []) {
  const targetId = text(schoolId);
  if (!targetId) {
    return null;
  }

  return (
    schoolOptions.find((school) => text(school.id) === targetId) ||
    schoolOptions.find((school) => text(school.value) === targetId) ||
    null
  );
}

function isTipsEventType(value) {
  return normalizeAcademicEventType(value) === "팁스";
}

export const DEFAULT_ACADEMIC_EVENT_TYPES = [
  "시험기간",
  "영어시험일",
  "수학시험일",
  "체험학습",
  "방학·휴일·기타",
  "팁스",
];

export const ACADEMIC_EVENT_TYPE_DISPLAY_LABELS = {
  영어시험일: "영어 시험일 및 시험범위",
  수학시험일: "수학 시험일 및 시험범위",
};

const DEFAULT_FALLBACK_EVENT_TYPE = "방학·휴일·기타";

const LEGACY_TYPE_ALIASES = {
  시험: "시험기간",
  모의고사: "시험기간",
  설명회: "팁스",
  특강: "팁스",
  학교행사: "체험학습",
  휴강: "방학·휴일·기타",
  방학: "방학·휴일·기타",
  기타: "방학·휴일·기타",
  "영어 시험일 및 시험범위": "영어시험일",
  "수학 시험일 및 시험범위": "수학시험일",
};

export function getAcademicEventTypeLabel(value) {
  const normalized = normalizeAcademicEventType(value);
  return ACADEMIC_EVENT_TYPE_DISPLAY_LABELS[normalized] || normalized;
}

export function isSubjectExamType(value) {
  const normalized = normalizeAcademicEventType(value);
  return normalized === "영어시험일" || normalized === "수학시험일";
}

export function isExamTypeWithTerm(value) {
  const normalized = normalizeAcademicEventType(value);
  return normalized === "시험기간" || isSubjectExamType(normalized);
}

export function normalizeAcademicEventType(value) {
  const raw = text(value);
  if (!raw) {
    return DEFAULT_FALLBACK_EVENT_TYPE;
  }

  const normalized = LEGACY_TYPE_ALIASES[raw] || raw;
  return DEFAULT_ACADEMIC_EVENT_TYPES.includes(normalized) ? normalized : DEFAULT_FALLBACK_EVENT_TYPE;
}

export function createAcademicEventDraft(event = {}, options = {}) {
  const schoolOptions = Array.isArray(options.schoolOptions) ? options.schoolOptions : [];
  const matchedSchool =
    findSchool(event.schoolId || event.school_id || options.defaultSchoolId, schoolOptions) || null;
  const start = text(event.start) || text(options.startDate);
  const end = normalizeEndDate(start, text(event.end) || text(options.endDate));

  return {
    id: text(event.id),
    title: text(event.title),
    schoolId: text(event.schoolId || event.school_id || matchedSchool?.id || options.defaultSchoolId),
    category: text(event.category || matchedSchool?.category || "all"),
    type: normalizeAcademicEventType(event.type),
    start,
    end,
    grade: text(event.grade) || "all",
    note: text(event.note),
  };
}

function buildEmbeddedNote(baseNote, extraMeta = {}) {
  const marker = "[[TIPS_META]]";
  const cleanedNote = text(baseNote);
  const filteredMeta = Object.fromEntries(
    Object.entries(extraMeta).filter(([, value]) => text(value)),
  );

  if (Object.keys(filteredMeta).length === 0) {
    return cleanedNote || null;
  }

  return `${cleanedNote}${cleanedNote ? "\n\n" : ""}${marker} ${JSON.stringify(filteredMeta)}`;
}

function normalizeLegacyScopeValue(value) {
  return text(value);
}

export function buildAcademicEventMutationPayload(draft = {}, schoolOptions = []) {
  const title = text(draft.title);
  const type = normalizeAcademicEventType(draft.type);
  const schoolId = text(draft.schoolId);
  const school = findSchool(schoolId, schoolOptions);
  const requiresSchool = !isTipsEventType(type);
  const start = text(draft.start);
  const end = normalizeEndDate(start, draft.end);
  const errors = {};

  if (!title) {
    errors.title = "제목을 입력해 주세요.";
  }

  if (requiresSchool && (!schoolId || !school)) {
    errors.schoolId = "학교를 선택해 주세요.";
  }

  if (!start) {
    errors.start = "시작일을 입력해 주세요.";
  }

  if (Object.keys(errors).length > 0) {
    return {
      isValid: false,
      errors,
      payload: null,
    };
  }

  const payload = {
    title,
    school_id: school ? schoolId : null,
    school: school ? text(school?.name || school?.label) : null,
    type,
    start,
    end,
    grade: text(draft.grade) || "all",
    category: text(school?.category || draft.category) || "all",
    note: buildEmbeddedNote(draft.note, {
      examTerm: draft.examTerm,
      textbookScope: normalizeLegacyScopeValue(draft.textbookScope),
      subtextbookScope: normalizeLegacyScopeValue(draft.subtextbookScope),
      textbookScopes: Array.isArray(draft.textbookScopes) ? draft.textbookScopes : [],
      subtextbookScopes: Array.isArray(draft.subtextbookScopes) ? draft.subtextbookScopes : [],
    }),
  };

  if (text(draft.id)) {
    payload.id = text(draft.id);
  }

  return {
    isValid: true,
    errors: {},
    payload,
  };
}

export function buildAcademicEventMutationPayloadCandidates(payload = {}) {
  const base = {
    id: text(payload.id) || generateId(),
    title: payload.title,
    school: payload.school,
    school_id: payload.school_id,
    type: payload.type,
    color: payload.color || null,
    grade: payload.grade || "all",
    note: payload.note || null,
    category: payload.category || "all",
  };
  const start = text(payload.start || payload.start_date || payload.date);
  const end = normalizeEndDate(start, payload.end || payload.end_date || start);

  return [
    {
      payload: {
        ...base,
        start,
        end,
        date: start,
      },
      optionalColumns: ["school_id", "school", "color", "grade", "note", "category", "start", "end", "date"],
    },
    {
      payload: {
        ...base,
        start_date: start,
        end_date: end,
        date: start,
      },
      optionalColumns: ["school_id", "school", "color", "grade", "note", "category", "start_date", "end_date", "date"],
    },
    {
      payload: {
        ...base,
        date: start,
      },
      optionalColumns: ["school_id", "school", "color", "grade", "note", "category", "date"],
    },
  ];
}

export function getAcademicEventMutationErrorMessage(error, fallback = "") {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (error && typeof error === "object") {
    const message = [error.message, error.details, error.hint, error.code]
      .map((value) => text(value))
      .filter(Boolean)
      .join(" · ");
    return message || fallback;
  }
  return text(error) || fallback;
}

function isMissingColumnError(error, columnName) {
  const message = getAcademicEventMutationErrorMessage(error, "").toLowerCase();
  const column = columnName.toLowerCase();
  return (
    message.includes(`'${column}'`) ||
    message.includes(`"${column}"`) ||
    message.includes(` ${column} `) ||
    message.includes(`column ${column}`) ||
    message.includes(`column '${column}'`) ||
    message.includes(`column "${column}"`)
  ) && (
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("could not find") ||
    message.includes("does not exist")
  );
}

function removeColumnFromPayload(payload, columnName) {
  const rows = Array.isArray(payload) ? payload : [payload];
  rows.forEach((row) => {
    delete row[columnName];
  });
}

export async function runAcademicEventMutation(payload = {}, execute) {
  let lastError = null;

  for (const candidate of buildAcademicEventMutationPayloadCandidates(payload)) {
    const row = { ...candidate.payload };
    const skippedColumns = [];
    let result = await execute(row);

    while (result.error) {
      const missingColumn = candidate.optionalColumns.find(
        (columnName) => !skippedColumns.includes(columnName) && isMissingColumnError(result.error, columnName),
      );
      if (!missingColumn) {
        break;
      }

      skippedColumns.push(missingColumn);
      removeColumnFromPayload(row, missingColumn);
      result = await execute(row);
    }

    if (!result.error) {
      return { error: null };
    }

    lastError = result.error;
  }

  return { error: lastError };
}
