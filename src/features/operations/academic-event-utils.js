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
  "과학시험일",
  "체험학습",
  "방학·휴일·기타",
  "팁스",
];

export const ACADEMIC_EVENT_TYPE_DISPLAY_LABELS = {
  영어시험일: "영어 시험일 및 시험범위",
  수학시험일: "수학 시험일 및 시험범위",
  과학시험일: "과학 시험일 및 시험범위",
};

export const SCIENCE_SUBJECT_AREA_OPTIONS = [
  { areaKey: "integrated_science", label: "통합과학", sortOrder: 10 },
  { areaKey: "physics", label: "물리학", sortOrder: 20 },
  { areaKey: "chemistry", label: "화학", sortOrder: 30 },
  { areaKey: "life_science", label: "생명과학", sortOrder: 40 },
  { areaKey: "earth_science", label: "지구과학", sortOrder: 50 },
];

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
  "과학 시험일 및 시험범위": "과학시험일",
};

export function getAcademicEventTypeLabel(value) {
  const normalized = normalizeAcademicEventType(value);
  return ACADEMIC_EVENT_TYPE_DISPLAY_LABELS[normalized] || normalized;
}

export function isSubjectExamType(value) {
  const normalized = normalizeAcademicEventType(value);
  return normalized === "영어시험일" || normalized === "수학시험일" || normalized === "과학시험일";
}

export function getScienceSubjectAreaLabel(value, scienceSubjectAreas = []) {
  const areaKey = text(value);
  const currentArea = parseActiveScienceSubjectAreas(scienceSubjectAreas)
    .find((area) => area.areaKey === areaKey);
  if (currentArea) return currentArea.label;
  return SCIENCE_SUBJECT_AREA_OPTIONS.find((option) => option.areaKey === areaKey)?.label || "";
}

function getScienceAreaKey(value) {
  if (typeof value === "string") {
    return text(value);
  }
  return text(value?.area_key || value?.areaKey || value?.key || value?.value);
}

export function parseActiveScienceSubjectAreas(value) {
  if (!Array.isArray(value)) return [];

  const knownAreas = new Map(
    SCIENCE_SUBJECT_AREA_OPTIONS.map((area) => [area.areaKey, area]),
  );
  return value
    .map((row) => {
      const areaKey = getScienceAreaKey(row);
      const knownArea = knownAreas.get(areaKey);
      const label = text(row?.label);
      const isActive = (row?.is_active ?? row?.isActive) === true;
      if (!knownArea || !label || !isActive) return null;
      const rawSortOrder = row?.sort_order ?? row?.sortOrder;
      const parsedSortOrder = rawSortOrder === null || rawSortOrder === ""
        ? Number.NaN
        : Number(rawSortOrder);
      return {
        areaKey,
        label,
        sortOrder: Number.isFinite(parsedSortOrder) ? parsedSortOrder : knownArea.sortOrder,
        isActive: true,
      };
    })
    .filter((area) => area !== null)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.areaKey.localeCompare(right.areaKey));
}

function parseDraftGrades(value) {
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean);
  }
  return text(value).split(/[\s,|/]+/).map(text).filter(Boolean);
}

export function validateScienceExamDraft(draft = {}, activeScienceAreas = []) {
  if (normalizeAcademicEventType(draft.type || draft.typeLabel) !== "과학시험일") {
    return { isValid: true, errors: {} };
  }

  const errors = {};
  const grades = parseDraftGrades(draft.grade);
  if (grades.length === 0 || grades.some((grade) => !["고1", "고2", "고3"].includes(grade))) {
    errors.grade = "과학 시험일은 고1~고3만 선택할 수 있습니다.";
  }

  const scienceAreaKey = text(draft.scienceAreaKey || draft.science_area_key);
  const isActiveArea = parseActiveScienceSubjectAreas(activeScienceAreas).some(
    (area) => area.areaKey === scienceAreaKey,
  );
  if (!scienceAreaKey || !isActiveArea) {
    errors.scienceAreaKey = "활성 과학 영역을 선택해 주세요.";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export function isExamTypeWithTerm(value) {
  const normalized = normalizeAcademicEventType(value);
  return normalized === "시험기간" || isSubjectExamType(normalized);
}

export function parseAcademicEventType(value) {
  const raw = text(value);
  if (!raw) return null;

  const normalized = LEGACY_TYPE_ALIASES[raw] || raw;
  return DEFAULT_ACADEMIC_EVENT_TYPES.includes(normalized) ? normalized : null;
}

export function normalizeAcademicEventType(value) {
  return parseAcademicEventType(value) || DEFAULT_FALLBACK_EVENT_TYPE;
}

export function getAcademicEventFilterTypeKey(value) {
  return `type:${normalizeAcademicEventType(value)}`;
}

export function createAcademicEventDraft(event = {}, options = {}) {
  const schoolOptions = Array.isArray(options.schoolOptions) ? options.schoolOptions : [];
  const matchedSchool =
    findSchool(event.schoolId || event.school_id || options.defaultSchoolId, schoolOptions) || null;
  const start = text(event.start) || text(options.startDate);
  const end = normalizeEndDate(start, text(event.end) || text(options.endDate));

  const embeddedNoteMeta = extractAcademicEventNoteMetadata(event.note);

  return {
    id: text(event.id),
    title: text(event.title),
    schoolId: text(event.schoolId || event.school_id || matchedSchool?.id || options.defaultSchoolId),
    category: text(event.category || matchedSchool?.category || "all"),
    type: normalizeAcademicEventType(event.type),
    start,
    end,
    grade: text(event.grade) || "all",
    scienceAreaKey: text(event.scienceAreaKey || embeddedNoteMeta.scienceAreaKey),
    embeddedNoteMeta,
    note: stripAcademicEventNoteMetadata(event.note),
  };
}

export function extractAcademicEventNoteMetadata(note) {
  const marker = "[[TIPS_META]]";
  const raw = String(note || "");
  const markerIndex = raw.indexOf(marker);
  if (markerIndex < 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw.slice(markerIndex + marker.length).trim());
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function stripAcademicEventNoteMetadata(note) {
  const marker = "[[TIPS_META]]";
  const raw = String(note || "");
  const markerIndex = raw.indexOf(marker);
  return (markerIndex < 0 ? raw : raw.slice(0, markerIndex)).trim();
}

function hasEmbeddedMetaValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "string") {
    return Boolean(value.trim());
  }
  return value !== null && value !== undefined;
}

export function buildAcademicEventNote(baseNote, extraMeta = {}) {
  const marker = "[[TIPS_META]]";
  const cleanedNote = stripAcademicEventNoteMetadata(baseNote);
  const mergedMeta = { ...extractAcademicEventNoteMetadata(baseNote) };

  Object.entries(extraMeta).forEach(([key, value]) => {
    if (hasEmbeddedMetaValue(value)) {
      mergedMeta[key] = value;
    } else {
      delete mergedMeta[key];
    }
  });

  if (Object.keys(mergedMeta).length === 0) {
    return cleanedNote || null;
  }

  return `${cleanedNote}${cleanedNote ? "\n\n" : ""}${marker} ${JSON.stringify(mergedMeta)}`;
}

export function prepareAcademicEventMetadataForWrite(eventData = {}, activeScienceAreas = []) {
  const embeddedNoteMeta = eventData.embeddedNoteMeta
    && typeof eventData.embeddedNoteMeta === "object"
    && !Array.isArray(eventData.embeddedNoteMeta)
    ? eventData.embeddedNoteMeta
    : {};
  const scienceAreaKey = text(eventData.scienceAreaKey || embeddedNoteMeta.scienceAreaKey);
  const validation = validateScienceExamDraft(
    {
      type: eventData.typeLabel || eventData.type,
      grade: eventData.grade,
      scienceAreaKey,
    },
    activeScienceAreas,
  );

  return {
    ...validation,
    scienceAreaKey,
    note: buildAcademicEventNote(
      eventData.note || eventData.description,
      {
        ...embeddedNoteMeta,
        ...(normalizeAcademicEventType(eventData.typeLabel || eventData.type) === "과학시험일"
          ? { scienceAreaKey }
          : {}),
      },
    ),
  };
}

function normalizeLegacyScopeValue(value) {
  return text(value);
}

export function buildAcademicEventMutationPayload(draft = {}, schoolOptions = []) {
  const title = text(draft.title);
  const parsedType = parseAcademicEventType(draft.type);
  const type = parsedType || DEFAULT_FALLBACK_EVENT_TYPE;
  const schoolId = text(draft.schoolId);
  const school = findSchool(schoolId, schoolOptions);
  const requiresSchool = !isTipsEventType(type);
  const start = text(draft.start);
  const end = normalizeEndDate(start, draft.end);
  const errors = {};

  if (!parsedType) {
    errors.type = "지원하는 일정 유형을 선택해 주세요.";
  }

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
    note: buildAcademicEventNote(draft.note, {
      examTerm: draft.examTerm,
      rangeEnd: end !== start ? end : "",
      scienceAreaKey:
        type === "과학시험일"
          ? draft.scienceAreaKey || extractAcademicEventNoteMetadata(draft.note).scienceAreaKey
          : "",
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
      optionalColumns: ["school_id", "school", "color", "grade", "note", "category", "date"],
    },
    {
      payload: {
        ...base,
        start_date: start,
        end_date: end,
        date: start,
      },
      optionalColumns: ["school_id", "school", "color", "grade", "note", "category", "date"],
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
