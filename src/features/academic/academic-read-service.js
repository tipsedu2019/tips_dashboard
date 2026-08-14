const PAGE_SIZE = 30;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CURRICULUM_FILTER_KEYS = [
  "classroom",
  "grade",
  "periodId",
  "search",
  "status",
  "subject",
  "teacher",
  "viewMode",
];
const TIMETABLE_COLLECTIONS = [
  "classSummaries",
  "classTerms",
  "classGroups",
  "classGroupMembers",
  "teacherCatalogs",
  "classroomCatalogs",
];
const TIMETABLE_DENSITY_COLLECTIONS = [
  "class_summaries",
  "class_terms",
  "class_groups",
  "class_group_members",
  "teacher_catalogs",
  "classroom_catalogs",
];

function text(value) {
  return typeof value === "string" ? value.trim() : String(value || "").trim();
}

function academicError(code) {
  return Object.assign(new Error(code), { code });
}

function unwrap(value) {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

function parseDateKey(value) {
  const normalized = text(value);
  if (!DATE_KEY.test(normalized)) throw academicError("academic_range_invalid");
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw academicError("academic_range_invalid");
  }
  return { normalized, date };
}

function assertRange(dateFrom, dateTo) {
  const from = parseDateKey(dateFrom);
  const to = parseDateKey(dateTo);
  const span = Math.floor((to.date.getTime() - from.date.getTime()) / 86_400_000) + 1;
  if (span < 1 || span > 14) throw academicError("academic_range_invalid");
  return { dateFrom: from.normalized, dateTo: to.normalized };
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function createAcademicExecutionContext({ userId, role, request }) {
  const actorScope = canonicalJson({
    userId: text(userId) || "anonymous",
    role: text(role) || "viewer",
  });
  return {
    actorScope,
    fingerprint: canonicalJson({ actorScope, request }),
  };
}

export function selectAcademicScopedValue(value, valueScope, currentScope) {
  return valueScope !== null && valueScope !== undefined && valueScope === currentScope
    ? value
    : null;
}

async function scopeHash(actorScope, filters) {
  const bytes = new TextEncoder().encode(canonicalJson({
    surface: "academic",
    mode: "curriculum",
    actorScope,
    filters,
  }));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeCurriculumFilters(request) {
  return {
    periodId: text(request.periodId) || null,
    search: text(request.search),
    status: text(request.status) || null,
    subject: text(request.subject) || null,
    grade: text(request.grade) || null,
    teacher: text(request.teacher) || null,
    classroom: text(request.classroom) || null,
    viewMode: text(request.viewMode) || "all",
  };
}

function assertCurriculumRequest(request) {
  if (!request || request.mode !== "curriculum") throw academicError("academic_request_invalid");
  const actual = Object.keys(normalizeCurriculumFilters(request)).sort();
  if (actual.length !== CURRICULUM_FILTER_KEYS.length
    || actual.some((key, index) => key !== CURRICULUM_FILTER_KEYS[index])) {
    throw academicError("academic_request_invalid");
  }
}

function assertTimetableResponse(value, range) {
  if (value?.ok === false && value.code === "visible_range_too_dense"
    && Array.isArray(value.rows) && value.rows.length === 0
    && value.observedRowsAtLeast === 2_001 && value.suggestedDays === 7
    && value.range?.dateFrom === range.dateFrom && value.range?.dateTo === range.dateTo) {
    return value;
  }
  if (value?.ok === false && value.code === "timetable_collection_too_dense"
    && TIMETABLE_DENSITY_COLLECTIONS.includes(value.collection)
    && value.observedItemsAtLeast === 501
    && value.action === "narrow_filters"
    && value.range?.dateFrom === range.dateFrom && value.range?.dateTo === range.dateTo
    && Array.isArray(value.rows) && value.rows.length === 0) {
    return value;
  }
  if (value?.ok !== true || value.complete !== true || !Array.isArray(value.rows)
    || value.rows.length > 2_000
    || value.range?.dateFrom !== range.dateFrom || value.range?.dateTo !== range.dateTo) {
    throw academicError("academic_timetable_response_invalid");
  }
  for (const collection of TIMETABLE_COLLECTIONS) {
    if (!Array.isArray(value[collection]) || value[collection].length > 500) {
      throw academicError("academic_timetable_response_invalid");
    }
  }
  if (!Array.isArray(value.statusOptions) || !Array.isArray(value.subjectOptions)) {
    throw academicError("academic_timetable_response_invalid");
  }
  return value;
}

export function appendAcademicCurriculumPageIfCurrent({
  current,
  next,
  expectedRevision,
  currentRevision,
  expectedFingerprint,
  currentFingerprint,
}) {
  if (expectedRevision !== currentRevision || expectedFingerprint !== currentFingerprint || !current) {
    return current;
  }
  const currentPage = current.page && typeof current.page === "object" ? current.page : {};
  const nextPage = next?.page && typeof next.page === "object" ? next.page : {};
  const existingRows = Array.isArray(currentPage.rows) ? currentPage.rows : [];
  const seen = new Set(existingRows.map((row) => text(row?.id)).filter(Boolean));
  const appended = (Array.isArray(nextPage.rows) ? nextPage.rows : []).filter((row) => {
    const id = text(row?.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return {
    ...current,
    ...next,
    stats: current.stats,
    filterOptions: current.filterOptions,
    page: { ...nextPage, rows: [...existingRows, ...appended] },
  };
}

export function isAcademicContinuationLoadingForScope(loadingFingerprint, currentFingerprint) {
  return Boolean(loadingFingerprint && loadingFingerprint === currentFingerprint);
}

export function selectAcademicDisplayRequest({ data, successfulRequest, currentRequest }) {
  return data && successfulRequest ? successfulRequest : currentRequest;
}

export function isAcademicResultCurrentForScope(
  dataFingerprint,
  currentFingerprint,
  displayFingerprint,
) {
  return Boolean(
    dataFingerprint
      && dataFingerprint === currentFingerprint
      && displayFingerprint === currentFingerprint,
  );
}

export function getCurriculumDesignAction(row = {}) {
  const nextSession = row.nextSession && typeof row.nextSession === "object"
    ? row.nextSession
    : {};
  const sessionId = text(nextSession.id || nextSession.sessionId);

  if (Number(row.totalSessions || 0) <= 0) {
    return {
      label: "일정",
      tab: "schedule",
      sectionId: "lesson-design-periods",
      sessionId: "",
      reason: "회차 생성 필요",
    };
  }
  if (Number(row.textbookCount || 0) <= 0) {
    return {
      label: "교재",
      tab: "curriculum",
      sectionId: "lesson-design-textbooks",
      sessionId: "",
      reason: "교재 연결 필요",
    };
  }
  if (Number(row.delayedProgressSessions || 0) > 0) {
    return {
      label: "진도",
      tab: "curriculum",
      sectionId: "lesson-design-board",
      sessionId,
      reason: `미배정 ${Number(row.delayedProgressSessions || 0)}회`,
    };
  }
  return {
    label: "보기",
    tab: "basic",
    sectionId: "",
    sessionId: "",
    reason: "기본 정보 확인",
  };
}

export function createAcademicReadService(options = {}) {
  const client = options.supabase;
  if (!client || typeof client.rpc !== "function") throw academicError("academic_client_missing");
  const actorScope = text(options.actorScope);
  if (!actorScope) throw academicError("academic_actor_scope_missing");
  const scopeMetadataCache = new Map();

  async function unwrapRpc(query) {
    const { data, error } = await query;
    if (error) throw error;
    return unwrap(data);
  }

  async function loadCurriculum(request) {
    assertCurriculumRequest(request);
    const requestedFilters = normalizeCurriculumFilters(request);
    const cursor = request.cursor;
    const cursorResolvedPeriodId = text(cursor?.resolvedPeriodId) || null;
    const filters = cursor !== null && requestedFilters.periodId === null && cursorResolvedPeriodId
      ? { ...requestedFilters, periodId: cursorResolvedPeriodId }
      : requestedFilters;
    const expectedScopeHash = cursor === null ? null : await scopeHash(actorScope, filters);
    if (cursor !== null && (!cursor || !Array.isArray(cursor.sortValues)
      || cursor.sortValues.length !== 1 || typeof cursor.sortValues[0] !== "string"
      || !UUID.test(text(cursor.id)) || cursor.scopeHash !== expectedScopeHash)) {
      throw academicError("academic_cursor_mismatch");
    }
    const response = await unwrapRpc(
      client.rpc("get_academic_curriculum_page_v1", {
        p_filters: filters,
        p_cursor_sort_key: cursor?.sortValues[0] || null,
        p_cursor_id: cursor?.id || null,
        p_limit: 30,
        p_include_scope_metadata: cursor === null,
      })
        .abortSignal(AbortSignal.timeout(8_000))
        .retry(false),
    );
    const received = Array.isArray(response?.rows) ? response.rows : [];
    if (received.length > PAGE_SIZE + 1) throw academicError("academic_curriculum_response_invalid");
    const responseResolvedPeriodId = text(response?.resolvedPeriodId) || filters.periodId;
    if (filters.periodId && responseResolvedPeriodId && responseResolvedPeriodId !== filters.periodId) {
      throw academicError("academic_curriculum_response_invalid");
    }
    const resolvedPeriodId = responseResolvedPeriodId || null;
    const canonicalFilters = resolvedPeriodId === filters.periodId
      ? filters
      : { ...filters, periodId: resolvedPeriodId };
    const canonicalScopeHash = await scopeHash(actorScope, canonicalFilters);
    if (cursor !== null && canonicalScopeHash !== expectedScopeHash) {
      throw academicError("academic_curriculum_response_invalid");
    }
    const boundary = received.length > PAGE_SIZE ? received[PAGE_SIZE - 1] : null;
    const receivedMetadata = response?.stats && typeof response.stats === "object"
      && response?.filterOptions && typeof response.filterOptions === "object"
      ? { stats: response.stats, filterOptions: response.filterOptions }
      : null;
    if (receivedMetadata) scopeMetadataCache.set(canonicalScopeHash, receivedMetadata);
    const metadata = receivedMetadata || scopeMetadataCache.get(canonicalScopeHash);
    if (!metadata) throw academicError("academic_curriculum_metadata_missing");
    return {
      page: {
        rows: received.slice(0, PAGE_SIZE).map((row) => row?.row_data || row),
        hasMore: received.length > PAGE_SIZE,
        nextCursor: boundary ? {
          sortValues: [text(boundary.sort_key)],
          id: text(boundary.id),
          scopeHash: canonicalScopeHash,
          resolvedPeriodId,
        } : null,
      },
      stats: metadata.stats,
      filterOptions: metadata.filterOptions,
    };
  }

  return {
    async load(request) {
      if (request?.mode === "timetable") {
        const range = assertRange(request.dateFrom, request.dateTo);
        const response = await unwrapRpc(
          client.rpc("get_academic_timetable_range_v1", {
            p_date_from: range.dateFrom,
            p_date_to: range.dateTo,
            p_class_group_id: text(request.filters?.classGroupId) || null,
            p_status: text(request.filters?.status) || null,
            p_subject: text(request.filters?.subject) || null,
          })
            .abortSignal(AbortSignal.timeout(8_000))
            .retry(false),
        );
        return assertTimetableResponse(response, range);
      }
      if (request?.mode === "curriculum") return loadCurriculum(request);
      throw academicError("academic_request_invalid");
    },
    async loadCurriculumDetail(classId) {
      const id = text(classId);
      if (!UUID.test(id)) throw academicError("academic_class_id_invalid");
      const detail = await unwrapRpc(
        client.rpc("get_academic_curriculum_detail_v1", { p_class_id: id })
          .abortSignal(AbortSignal.timeout(8_000))
          .retry(false),
      );
      if (!detail || text(detail.id) !== id
        || !Array.isArray(detail.scheduleRows)
        || !Array.isArray(detail.progressRows)
        || !Array.isArray(detail.textbookRows)) {
        throw academicError("academic_curriculum_detail_response_invalid");
      }
      return detail;
    },
  };
}
