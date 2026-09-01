import { validatePageSize } from '../../lib/numbered-pagination.ts';

/**
 * @typedef {{periodId:string|null, search:string, status:string|null, subject:string|null, grade:string|null, teacher:string|null, classroom:string|null, viewMode:string}} CurriculumNumberedFilters
 * @typedef {Omit<import('./records').CurriculumRow, 'nextSession'> & {nextSession:(NonNullable<import('./records').CurriculumRow['nextSession']> & {sessionKey:string})|null}} CurriculumNumberedRow
 * @typedef {Record<'total'|'managedClassCount'|'totalSessions'|'completedSessions'|'pendingSessions'|'linkedTextbooks'|'unlinkedClassCount'|'noScheduleClassCount'|'updateNeededClassCount'|'completedClassCount',number> & {viewModeCounts:Record<'all'|'unlinked'|'unscheduled'|'update'|'done',number>}} CurriculumNumberedStats
 * @typedef {{periods:Array<{value:string,label:string,isDefault:boolean}>,statuses:string[],subjects:string[],grades:string[],teachers:string[],classrooms:string[]}} CurriculumNumberedFilterOptions
 * @typedef {import('../../lib/numbered-pagination').NumberedPage<CurriculumNumberedRow> & {resolvedPeriodId:string|null} & ({stats:CurriculumNumberedStats,filterOptions:CurriculumNumberedFilterOptions}|{stats:null,filterOptions:null})} CurriculumNumberedPage
 */
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

const NUMBERED_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CURRICULUM_STRING_FIELDS = ['id','title','fullTitle','subject','subjectAreaKey','grade','term','teacherSummary','classroomSummary','schedule','status','statusFilter','classGroupLabel','textbookSummary','lastUpdatedAt','stateLabel','latestNoteSummary','latestNoteSessionLabel','searchText'];
const CURRICULUM_COUNT_FIELDS = ['textbookCount','textbookOverflowCount','totalSessions','completedSessions','updatedSessions','delayedSessions','plannedSessions','progressTargetSessions','delayedProgressSessions','plannedProgressSessions','progressPercent','progressTargetPercent'];
const CURRICULUM_ARRAY_FIELDS = ['teacherNames','classroomNames','classGroupIds','classGroupNames'];
const CURRICULUM_EMPTY_FIELDS = ['textbookCatalog','textbookTitles','textbookScopeLabels','pendingSessionLabels','sessionSummaries'];
const CURRICULUM_STATS_FIELDS = ['total','managedClassCount','totalSessions','completedSessions','pendingSessions','linkedTextbooks','unlinkedClassCount','noScheduleClassCount','updateNeededClassCount','completedClassCount'];
const CURRICULUM_VIEWS = ['all','unlinked','unscheduled','update','done'];
const CURRICULUM_STATUSES = ['수강','개강 준비','종강'];

function exactAcademicKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function academicCount(value) { return Number.isSafeInteger(value) && value >= 0; }
function academicStrings(value) { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }

function assertCurriculumNumberedFilters(filters) {
  if (!exactAcademicKeys(filters, CURRICULUM_FILTER_KEYS) || typeof filters.search !== 'string'
    || CURRICULUM_FILTER_KEYS.some((key) => key !== 'search' && filters[key] !== null && typeof filters[key] !== 'string')) {
    throw academicError('academic_numbered_filters_invalid');
  }
  const normalized = normalizeCurriculumFilters(filters);
  if (!CURRICULUM_VIEWS.includes(normalized.viewMode)
    || (normalized.status !== null && !CURRICULUM_STATUSES.includes(normalized.status))) {
    throw academicError('academic_numbered_filters_invalid');
  }
  return normalized;
}

function validCurriculumNumberedRow(row) {
  if (!exactAcademicKeys(row, [...CURRICULUM_STRING_FIELDS, ...CURRICULUM_COUNT_FIELDS, ...CURRICULUM_ARRAY_FIELDS, ...CURRICULUM_EMPTY_FIELDS, 'nextSession'])
    || !CURRICULUM_STRING_FIELDS.every((key) => typeof row[key] === 'string') || !NUMBERED_UUID.test(row.id)
    || !CURRICULUM_COUNT_FIELDS.every((key) => academicCount(row[key]))
    || !CURRICULUM_ARRAY_FIELDS.every((key) => academicStrings(row[key])) || !row.classGroupIds.every((id) => NUMBERED_UUID.test(id))
    || !CURRICULUM_EMPTY_FIELDS.every((key) => Array.isArray(row[key]) && row[key].length === 0)
    || row.textbookOverflowCount !== 0 || !CURRICULUM_STATUSES.includes(row.status) || !CURRICULUM_STATUSES.includes(row.statusFilter)
    || !['회차 미생성','교재 미연결','진도 미배정','계획 완료'].includes(row.stateLabel)) return false;
  if (row.nextSession === null) return true;
  const next = row.nextSession;
  const strings = ['sessionId','sessionKey','label','progressStatus','updatedAt','noteSummary','dateValue','dateLabel','periodLabel','scheduleState','scheduleMemo','makeupMemo','makeupDate','planSummary'];
  return exactAcademicKeys(next, [...strings,'sessionOrder','hasActualContent','hasPlanContent','textbookEntryCount','textbookEntries'])
    && strings.every((key) => typeof next[key] === 'string') && NUMBERED_UUID.test(next.sessionId) && next.sessionKey.length > 0
    && DATE_KEY.test(next.dateValue) && DATE_KEY.test(next.dateLabel) && DATE_KEY.test(next.label)
    && ['active','exception','makeup','tbd'].includes(next.scheduleState)
    && next.sessionOrder === 0 && next.progressStatus === 'pending' && next.hasActualContent === false && next.hasPlanContent === false
    && next.textbookEntryCount === 0 && Array.isArray(next.textbookEntries) && next.textbookEntries.length === 0
    && ['updatedAt','noteSummary','scheduleMemo','makeupMemo','makeupDate','planSummary'].every((key) => next[key] === '');
}

function assertCurriculumNumberedResponse(response, { filters, page, pageSize, includeScopeMetadata }) {
  const fail = () => { throw academicError('academic_numbered_response_invalid'); };
  if (!exactAcademicKeys(response, ['rows','page','pageSize','totalCount','stats','filterOptions','resolvedPeriodId'])
    || response.page !== page || response.pageSize !== pageSize || !academicCount(response.totalCount)
    || !Array.isArray(response.rows) || response.rows.length > pageSize
    || response.rows.length > Math.max(0, response.totalCount - (page - 1) * pageSize)
    || !(response.resolvedPeriodId === null || (typeof response.resolvedPeriodId === 'string' && response.resolvedPeriodId.trim() !== ''))
    || (filters.periodId === null && response.resolvedPeriodId !== null && !NUMBERED_UUID.test(response.resolvedPeriodId))
    || (filters.periodId !== null && response.resolvedPeriodId !== filters.periodId)) fail();
  const rows = response.rows.map((entry) => {
    if (exactAcademicKeys(entry, ['id','sort_key','row_data'])) {
      if (typeof entry.sort_key !== 'string' || entry.id !== entry.row_data?.id) fail();
      return entry.row_data;
    }
    return entry;
  });
  if (!rows.every(validCurriculumNumberedRow) || new Set(rows.map((row) => row.id)).size !== rows.length) fail();
  if (!includeScopeMetadata) {
    if (response.stats !== null || response.filterOptions !== null) fail();
  } else {
    const stats = response.stats;
    const options = response.filterOptions;
    if (!exactAcademicKeys(stats, [...CURRICULUM_STATS_FIELDS, 'viewModeCounts'])
      || !CURRICULUM_STATS_FIELDS.every((key) => academicCount(stats[key])) || stats.total !== response.totalCount
      || !exactAcademicKeys(stats.viewModeCounts, CURRICULUM_VIEWS) || !CURRICULUM_VIEWS.every((key) => academicCount(stats.viewModeCounts[key]))
      || !exactAcademicKeys(options, ['periods','statuses','subjects','grades','teachers','classrooms'])
      || !['statuses','subjects','grades','teachers','classrooms'].every((key) => academicStrings(options[key]) && options[key].length <= 500)
      || !Array.isArray(options.periods) || options.periods.length > 500
      || !options.periods.every((option) => exactAcademicKeys(option, ['value','label','isDefault']) && typeof option.value === 'string' && NUMBERED_UUID.test(option.value) && typeof option.label === 'string' && typeof option.isDefault === 'boolean')) fail();
  }
  return { ...response, rows };
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
    /**
     * Scope metadata is deliberately not cached here; the accepted-page owner may reuse
     * it only for the same actor + resolved filters, and must refresh it after mutation.
     * @param {{filters:CurriculumNumberedFilters,page:number,pageSize:import('../../lib/numbered-pagination').DataTablePageSize,includeScopeMetadata?:boolean,signal?:AbortSignal}} request
     * @returns {Promise<CurriculumNumberedPage>}
     */
    async readCurriculumNumberedPage({ filters: rawFilters, page, pageSize, includeScopeMetadata = true, signal }) {
      validatePageSize(pageSize);
      if (!Number.isInteger(page) || page < 1 || page > 2147483647 || typeof includeScopeMetadata !== 'boolean') throw academicError('academic_numbered_request_invalid');
      const filters = assertCurriculumNumberedFilters(rawFilters);
      const { data, error } = await client.rpc('get_academic_curriculum_numbered_page_v1', {
        p_filters: filters, p_page: page, p_page_size: pageSize, p_include_scope_metadata: includeScopeMetadata,
      }).abortSignal(signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000)).retry(false);
      if (error) throw error;
      return assertCurriculumNumberedResponse(data, { filters, page, pageSize, includeScopeMetadata });
    },
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
