import { validatePageSize } from '../../lib/numbered-pagination.ts';

/**
 * @typedef {{termId:string|null,search:string,subject:string|null,grade:string|null,teacher:string|null,syncGroupId:string|null}} ClassScheduleNumberedFilters
 * @typedef {{id:string,name:string,subject:string,grade:string,schedule:string,termId:string|null,teacherName:string|null,termName:string|null,syncGroupId:string|null,syncGroupName:string|null,status:string,updatedAt:string|null}} ClassScheduleNumberedRow
 * @typedef {{total:number,active:number,draft:number}} ClassScheduleNumberedStats
 * @typedef {{terms:Array<{value:string,label:string}>,subjects:string[],grades:string[],teachers:string[],syncGroups:Array<{value:string,label:string}>}} ClassScheduleNumberedFilterOptions
 * @typedef {{groupId:string,memberCount:number,representativeClassId:string}} ClassScheduleSyncGroupCount
 * @typedef {import('../../lib/numbered-pagination').NumberedPage<ClassScheduleNumberedRow> & {stats:ClassScheduleNumberedStats,filterOptions:ClassScheduleNumberedFilterOptions,syncGroupCounts:ClassScheduleSyncGroupCount[]}} ClassScheduleNumberedPage
 */
const PAGE_SIZE = 30;
const CATALOG_TTL_MS = 30 * 60 * 1_000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CLASS_FILTER_KEYS = ["grade", "search", "subject", "syncGroupId", "teacher", "termId"];
const catalogCacheByActorScope = new Map();
const catalogGenerationByActorScope = new Map();

export function invalidateOperationsCatalogCache(actorScope) {
  catalogCacheByActorScope.delete(actorScope);
  catalogGenerationByActorScope.set(actorScope, (catalogGenerationByActorScope.get(actorScope) || 0) + 1);
}

function text(value) {
  return typeof value === "string" ? value.trim() : String(value || "").trim();
}

function operationsError(code) {
  return Object.assign(new Error(code), { code });
}

function parseDateKey(value) {
  const normalized = text(value);
  if (!DATE_KEY.test(normalized)) throw operationsError("operations_range_invalid");
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw operationsError("operations_range_invalid");
  }
  return { normalized, date };
}

function assertRange(dateFrom, dateTo, maxDays) {
  const from = parseDateKey(dateFrom);
  const to = parseDateKey(dateTo);
  const span = Math.floor((to.date.getTime() - from.date.getTime()) / 86_400_000) + 1;
  if (span < 1 || span > maxDays) throw operationsError("operations_range_invalid");
  return { dateFrom: from.normalized, dateTo: to.normalized };
}

function unwrap(value) {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

function embeddedNoteParts(value) {
  const marker = "[[TIPS_META]]";
  const raw = typeof value === "string" ? value : "";
  const markerIndex = raw.indexOf(marker);
  if (markerIndex < 0) return { note: raw.trim(), meta: {} };
  let meta = {};
  try {
    const parsed = JSON.parse(raw.slice(markerIndex + marker.length).trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) meta = parsed;
  } catch {
    meta = {};
  }
  return { note: raw.slice(0, markerIndex).trim(), meta };
}

export function inferAcademicExamTerm(title, startsAt) {
  const normalizedTitle = text(title);
  const kind = normalizedTitle.includes("기말")
    ? "기말"
    : normalizedTitle.includes("중간") ? "중간" : "";
  if (!kind) return "";
  const explicitSemester = normalizedTitle.includes("2학기")
    ? 2
    : normalizedTitle.includes("1학기") ? 1 : 0;
  const monthMatch = text(startsAt).match(/^\d{4}-(\d{2})-\d{2}/u);
  const inferredSemester = Number(monthMatch?.[1] || 0) >= 8 ? 2 : 1;
  return `${explicitSemester || inferredSemester}학기 ${kind}`;
}

export function normalizeAcademicEventDetail(value) {
  const detail = value && typeof value === "object" ? value : {};
  const stored = embeddedNoteParts(detail.storedNote ?? detail.note);
  const suppliedMeta = detail.embeddedNoteMeta && typeof detail.embeddedNoteMeta === "object"
    && !Array.isArray(detail.embeddedNoteMeta) ? detail.embeddedNoteMeta : {};
  const embeddedNoteMeta = { ...suppliedMeta, ...stored.meta };
  return {
    ...detail,
    note: stored.note,
    embeddedNoteMeta,
    examTerm: text(
      detail.examTerm
      || embeddedNoteMeta.examTerm
      || inferAcademicExamTerm(detail.title, detail.startsAt || detail.start),
    ),
    scienceAreaKey: text(detail.scienceAreaKey || embeddedNoteMeta.scienceAreaKey),
    textbookScope: text(detail.textbookScope || embeddedNoteMeta.textbookScope),
    subtextbookScope: text(detail.subtextbookScope || embeddedNoteMeta.subtextbookScope),
    textbookScopes: Array.isArray(embeddedNoteMeta.textbookScopes)
      ? embeddedNoteMeta.textbookScopes
      : Array.isArray(detail.textbookScopes) ? detail.textbookScopes : [],
    subtextbookScopes: Array.isArray(embeddedNoteMeta.subtextbookScopes)
      ? embeddedNoteMeta.subtextbookScopes
      : Array.isArray(detail.subtextbookScopes) ? detail.subtextbookScopes : [],
  };
}

export function resolveAnnualBoardEntryParentId(entry) {
  return text(entry?.parentEventId || entry?.parent_event_id || entry?.id);
}

function normalizeAnnualScopeItems(items, fallbackName) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const publisher = text(item?.publisher);
      const scope = text(item?.scope);
      return {
        name: text(item?.name) || ((publisher || scope) ? fallbackName : ""),
        publisher,
        scope,
      };
    })
    .filter((item) => item.name || item.publisher || item.scope)
    .slice(0, 4);
}

function uniqueAnnualScopeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = [item.name, item.publisher, item.scope].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

function annualScopeItemsFromSections(entry, labels, fallbackName) {
  const sections = [
    ...(Array.isArray(entry?.materialSections) ? entry.materialSections : []),
    ...(Array.isArray(entry?.displaySections) ? entry.displaySections : []),
  ];
  const compatibleLabels = new Set(labels);
  return uniqueAnnualScopeItems(sections
    .filter((candidate) => compatibleLabels.has(text(candidate?.label)))
    .flatMap((section) => Array.isArray(section?.items) ? section.items : [])
    .map((item) => text(item))
    .filter(Boolean)
    .map((scope) => ({ name: fallbackName, publisher: "", scope })));
}

export function resolveAnnualBoardStructuredScopes(entry) {
  const directTextbookScopes = normalizeAnnualScopeItems(entry?.textbookScopes, "교재");
  const directSubtextbookScopes = uniqueAnnualScopeItems([
    ...normalizeAnnualScopeItems(entry?.subtextbookScopes, "부교재"),
    ...normalizeAnnualScopeItems(entry?.supplementScopes || entry?.supplement_scopes, "부교재"),
  ]);
  const textbookScope = text(entry?.textbookScope || entry?.textbook_scope);
  const subtextbookScope = text(
    entry?.subtextbookScope
    || entry?.subtextbook_scope
    || entry?.supplementScope
    || entry?.supplement_scope,
  );
  const textbookScopes = uniqueAnnualScopeItems([
    ...directTextbookScopes,
    ...(textbookScope ? [{ name: "교재", publisher: "", scope: textbookScope }] : []),
  ]);
  const subtextbookScopes = uniqueAnnualScopeItems([
    ...directSubtextbookScopes,
    ...(subtextbookScope ? [{ name: "부교재", publisher: "", scope: subtextbookScope }] : []),
  ]);
  return {
    textbookScopes: textbookScopes.length > 0
      ? textbookScopes
      : annualScopeItemsFromSections(entry, ["교과서", "본교재", "교재"], "교재"),
    subtextbookScopes: subtextbookScopes.length > 0
      ? subtextbookScopes
      : annualScopeItemsFromSections(entry, ["부교재", "보충교재", "보조교재"], "부교재"),
  };
}

export function getAnnualBoardEntryMissingItems(entry) {
  if (!entry || typeof entry !== "object") return [];
  const isSubjectExam = ["영어시험일", "수학시험일", "과학시험일"].includes(text(entry.type));
  if (!isSubjectExam) return [];
  const { textbookScopes, subtextbookScopes } = resolveAnnualBoardStructuredScopes(entry);
  const scopeItems = [...textbookScopes, ...subtextbookScopes];
  const hasScope = scopeItems.some((item) => Boolean(text(item?.scope)));
  const hasPartialScope = scopeItems.some((item) => {
    const hasAnyValue = text(item?.name) || text(item?.publisher) || text(item?.scope);
    return Boolean(hasAnyValue) && (!text(item?.name) || !text(item?.scope));
  });

  return [
    (!text(entry.examDateLabel) || text(entry.examDateLabel) === "시험일 미입력") ? "시험일 미입력" : null,
    !hasScope ? "시험범위 미입력" : null,
    text(entry.type) === "과학시험일" && !text(entry.scienceAreaKey) ? "과학 영역 미입력" : null,
    hasPartialScope ? "시험범위 일부 미입력" : null,
  ].filter(Boolean);
}

export function buildClassLessonDesignRow(detail) {
  const source = detail && typeof detail === "object" ? detail : {};
  const rawClass = source.classItem && typeof source.classItem === "object" ? source.classItem : {};
  const classItem = {
    ...rawClass,
    className: text(rawClass.className || rawClass.name),
    teacher: text(rawClass.teacherName || rawClass.teacher),
    term_id: rawClass.termId || rawClass.term_id || null,
    textbook_ids: Array.isArray(rawClass.textbookIds) ? rawClass.textbookIds : rawClass.textbook_ids || [],
    schedulePlan: rawClass.schedulePlan || rawClass.schedule_plan || {},
  };
  const id = text(classItem.id);
  if (!id) return null;
  return {
    id,
    title: text(classItem.className || classItem.name),
    subject: text(classItem.subject),
    grade: text(classItem.grade),
    teacher: text(classItem.teacher),
    termName: text(classItem.termName),
    scheduleLabel: text(classItem.schedule),
    sessionCount: 0,
    completedSessions: 0,
    raw: {
      classItem,
      term: classItem.termId ? { id: classItem.termId, name: classItem.termName } : null,
      sessions: [],
      syncGroupId: text(classItem.syncGroupId),
      syncGroup: classItem.syncGroupId ? { id: classItem.syncGroupId, name: classItem.syncGroupName } : null,
      warningSummary: { planDrift: null, syncGap: null },
    },
  };
}

export function resolveRequestedClassRow({ requestedClassId, pageRows, exactRow }) {
  const id = text(requestedClassId);
  if (!id) return null;
  if (exactRow && text(exactRow.id) === id) return exactRow;
  return (Array.isArray(pageRows) ? pageRows : []).find((row) => text(row?.id) === id) || null;
}

export function isCurrentClassMutationRefresh({
  expectedRevision,
  currentRevision,
  requestedClassId,
  currentRequestedClassId,
  detailClassId,
} = {}) {
  const expectedClassId = text(requestedClassId);
  return Number.isInteger(expectedRevision)
    && expectedRevision > 0
    && expectedRevision === currentRevision
    && Boolean(expectedClassId)
    && expectedClassId === text(currentRequestedClassId)
    && expectedClassId === text(detailClassId);
}

export function captureClassMutationLifecycleToken({ currentRevision, classId } = {}) {
  const normalizedClassId = text(classId);
  if (!Number.isInteger(currentRevision) || currentRevision <= 0 || !normalizedClassId) return null;
  return { revision: currentRevision, classId: normalizedClassId };
}

export function createClassMutationLifecycle() {
  let revision = 0;
  let requestedClassId = "";
  return {
    get revision() {
      return revision;
    },
    get requestedClassId() {
      return requestedClassId;
    },
    enter(classId) {
      revision += 1;
      requestedClassId = text(classId);
      return revision;
    },
    revoke() {
      revision += 1;
      requestedClassId = "";
      return revision;
    },
    capture(classId = requestedClassId) {
      const normalizedClassId = text(classId);
      if (!normalizedClassId || normalizedClassId !== requestedClassId) return null;
      return captureClassMutationLifecycleToken({ currentRevision: revision, classId: normalizedClassId });
    },
    isCurrent(token, detailClassId = token?.classId) {
      return isCurrentClassMutationRefresh({
        expectedRevision: token?.revision,
        currentRevision: revision,
        requestedClassId: token?.classId,
        currentRequestedClassId: requestedClassId,
        detailClassId,
      });
    },
  };
}

export async function runClassMutationWithLifecycle({
  token,
  isCurrent,
  mutate,
  afterCommit,
  onSuccess,
  onError,
  onSettled,
} = {}) {
  try {
    const value = await mutate?.();
    const receipt = await afterCommit?.(value);
    if (!isCurrent?.(token)) return { status: "stale", phase: "success" };
    await onSuccess?.(value, receipt);
    return { status: "success" };
  } catch (error) {
    if (!isCurrent?.(token)) return { status: "stale", phase: "error" };
    await onError?.(error);
    return { status: "error" };
  } finally {
    if (isCurrent?.(token)) await onSettled?.();
  }
}

export async function refreshClassMutationIfCurrent({
  token,
  getCurrentRevision,
  getCurrentRequestedClassId,
  loadDetail,
  commitDetail,
} = {}) {
  const tokenRevision = token?.revision;
  const tokenClassId = text(token?.classId);
  const isCurrent = (detailClassId = tokenClassId) => isCurrentClassMutationRefresh({
    expectedRevision: tokenRevision,
    currentRevision: getCurrentRevision?.(),
    requestedClassId: tokenClassId,
    currentRequestedClassId: getCurrentRequestedClassId?.(),
    detailClassId,
  });
  if (!isCurrent() || typeof loadDetail !== "function" || typeof commitDetail !== "function") {
    return { status: "stale" };
  }
  const detail = await loadDetail(tokenClassId);
  const detailClassId = text(detail?.classItem?.id || detail?.classId || detail?.id);
  if (!isCurrent(detailClassId)) return { status: "stale" };
  await commitDetail(detail);
  return { status: "committed" };
}

export function appendOperationsPageIfCurrent({
  current,
  next,
  expectedRevision,
  currentRevision,
  expectedFingerprint,
  currentFingerprint,
}) {
  if (expectedRevision !== currentRevision || expectedFingerprint !== currentFingerprint || !current) return current;
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
  return { ...current, page: { ...nextPage, rows: [...existingRows, ...appended] } };
}

export function buildSevenDayRangeKeys(dateFrom) {
  const start = parseDateKey(dateFrom).date;
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

async function scopeHash(filters) {
  const bytes = new TextEncoder().encode(canonicalJson({ surface: "operations", mode: "class_schedule", filters }));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeClassFilters(request) {
  return {
    termId: text(request.termId) || null,
    search: text(request.search),
    subject: text(request.subject) || null,
    grade: text(request.grade) || null,
    teacher: text(request.teacher) || null,
    syncGroupId: text(request.syncGroupId) || null,
  };
}

function assertClassRequest(request) {
  if (!request || request.mode !== "class_schedule") throw operationsError("operations_request_invalid");
  const actual = Object.keys(normalizeClassFilters(request)).sort();
  if (actual.length !== CLASS_FILTER_KEYS.length || actual.some((key, index) => key !== CLASS_FILTER_KEYS[index])) {
    throw operationsError("operations_request_invalid");
  }
}

function assertCalendarResponse(value, requestedRange) {
  if (value?.ok === true && value.complete === true && Array.isArray(value.rows)
    && value.range?.dateFrom === requestedRange.dateFrom && value.range?.dateTo === requestedRange.dateTo
    && value.rows.length <= 2_000) return value;
  if (value?.ok === false && value.code === "visible_range_too_dense" && Array.isArray(value.rows)
    && value.rows.length === 0 && value.observedRowsAtLeast === 2_001 && value.suggestedDays === 7
    && value.range?.dateFrom === requestedRange.dateFrom && value.range?.dateTo === requestedRange.dateTo) return value;
  throw operationsError("operations_calendar_response_invalid");
}

function assertAnnualResponse(value, academicYear) {
  if (value?.ok === false && value.code === "annual_board_too_dense") return value;
  if (value?.ok === true && value.data && Number(value.data.academicYear) === academicYear
    && Array.isArray(value.data.rows)) return value;
  throw operationsError("operations_annual_response_invalid");
}

const NUMBERED_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function exactOperationsKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function operationsCount(value) { return Number.isSafeInteger(value) && value >= 0; }
function operationsStrings(value) { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }

function assertClassScheduleNumberedFilters(filters) {
  if (!exactOperationsKeys(filters, CLASS_FILTER_KEYS) || typeof filters.search !== 'string'
    || CLASS_FILTER_KEYS.some((key) => key !== 'search' && filters[key] !== null && typeof filters[key] !== 'string')) throw operationsError('operations_numbered_filters_invalid');
  const normalized = normalizeClassFilters(filters);
  if (['termId','syncGroupId'].some((key) => normalized[key] !== null && !NUMBERED_UUID.test(normalized[key]))) throw operationsError('operations_numbered_filters_invalid');
  return normalized;
}

function assertClassScheduleNumberedResponse(response, { page, pageSize }) {
  const fail = () => { throw operationsError('operations_numbered_response_invalid'); };
  if (!exactOperationsKeys(response, ['rows','page','pageSize','totalCount','stats','filterOptions','syncGroupCounts'])
    || response.page !== page || response.pageSize !== pageSize || !operationsCount(response.totalCount)
    || !Array.isArray(response.rows) || response.rows.length > pageSize
    || response.rows.length > Math.max(0, response.totalCount - (page - 1) * pageSize)) fail();
  const rows = response.rows.map((entry) => {
    if (exactOperationsKeys(entry, ['id','sort_key','row_data'])) {
      if (typeof entry.sort_key !== 'string' || entry.id !== entry.row_data?.id) fail();
      return entry.row_data;
    }
    return entry;
  });
  const strings = ['id','name','subject','grade','schedule','status'];
  const nullable = ['termId','teacherName','termName','syncGroupId','syncGroupName','updatedAt'];
  if (!rows.every((row) => exactOperationsKeys(row, [...strings,...nullable]) && strings.every((key) => typeof row[key] === 'string')
    && nullable.every((key) => row[key] === null || typeof row[key] === 'string') && NUMBERED_UUID.test(row.id)
    && ['termId','syncGroupId'].every((key) => row[key] === null || NUMBERED_UUID.test(row[key]))
    && (row.updatedAt === null || (row.updatedAt.trim() !== '' && Number.isFinite(Date.parse(row.updatedAt)))))
    || new Set(rows.map((row) => row.id)).size !== rows.length) fail();
  const stats = response.stats;
  const options = response.filterOptions;
  if (!exactOperationsKeys(stats, ['total','active','draft']) || !Object.values(stats).every(operationsCount)
    || stats.total !== response.totalCount || stats.active + stats.draft > stats.total
    || !exactOperationsKeys(options, ['terms','subjects','grades','teachers','syncGroups'])
    || !['subjects','grades','teachers'].every((key) => operationsStrings(options[key]) && options[key].length <= 200)
    || !['terms','syncGroups'].every((key) => Array.isArray(options[key]) && options[key].length <= 200
      && options[key].every((item) => exactOperationsKeys(item, ['value','label']) && typeof item.value === 'string' && NUMBERED_UUID.test(item.value) && typeof item.label === 'string'))) fail();
  const groups = response.syncGroupCounts;
  if (!Array.isArray(groups) || groups.length > 200
    || !groups.every((group) => exactOperationsKeys(group, ['groupId','memberCount','representativeClassId'])
      && typeof group.groupId === 'string' && NUMBERED_UUID.test(group.groupId)
      && typeof group.representativeClassId === 'string' && NUMBERED_UUID.test(group.representativeClassId)
      && operationsCount(group.memberCount) && group.memberCount > 0 && group.memberCount <= response.totalCount
      && options.syncGroups.some((option) => option.value === group.groupId))
    || new Set(groups.map((group) => group.groupId)).size !== groups.length) fail();
  return { ...response, rows };
}

export function createOperationsReadService(options = {}) {
  const client = options.supabase;
  if (!client || typeof client.rpc !== "function") throw operationsError("operations_client_missing");
  const actorScope = text(options.actorScope);
  if (!actorScope) throw operationsError("operations_actor_scope_missing");
  const now = typeof options.now === "function" ? options.now : Date.now;

  async function unwrapRpc(query) {
    const { data, error } = await query;
    if (error) throw error;
    return unwrap(data);
  }

  async function loadClassSchedule(request) {
    assertClassRequest(request);
    const filters = normalizeClassFilters(request);
    const expectedScopeHash = await scopeHash(filters);
    const cursor = request.cursor;
    if (cursor !== null && (!cursor || !Array.isArray(cursor.sortValues) || cursor.sortValues.length !== 1
      || typeof cursor.sortValues[0] !== "string" || !UUID.test(text(cursor.id))
      || cursor.scopeHash !== expectedScopeHash)) {
      throw operationsError("operations_cursor_mismatch");
    }
    const response = await unwrapRpc(
      client.rpc("get_operations_class_schedule_page_v1", {
        p_filters: filters,
        p_cursor_sort_key: cursor?.sortValues[0] || null,
        p_cursor_id: cursor?.id || null,
        p_limit: 30,
      })
        .abortSignal(AbortSignal.timeout(8_000))
        .retry(false),
    );
    const received = Array.isArray(response?.rows) ? response.rows : [];
    const boundary = received.length > PAGE_SIZE ? received[PAGE_SIZE - 1] : null;
    return {
      page: {
        rows: received.slice(0, PAGE_SIZE).map((row) => row?.row_data || row),
        hasMore: received.length > PAGE_SIZE,
        nextCursor: boundary ? {
          sortValues: [text(boundary.sort_key)],
          id: text(boundary.id),
          scopeHash: expectedScopeHash,
        } : null,
      },
      stats: response?.stats && typeof response.stats === "object" ? response.stats : { total: 0, active: 0, draft: 0 },
      filterOptions: response?.filterOptions && typeof response.filterOptions === "object" ? response.filterOptions : {},
    };
  }

  return {
    /**
     * @param {{filters:ClassScheduleNumberedFilters,page:number,pageSize:import('../../lib/numbered-pagination').DataTablePageSize,signal?:AbortSignal}} request
     * @returns {Promise<ClassScheduleNumberedPage>}
     */
    async readClassScheduleNumberedPage({ filters: rawFilters, page, pageSize, signal }) {
      validatePageSize(pageSize);
      if (!Number.isInteger(page) || page < 1 || page > 2147483647) throw operationsError('operations_numbered_request_invalid');
      const filters = assertClassScheduleNumberedFilters(rawFilters);
      const { data, error } = await client.rpc('get_operations_class_schedule_numbered_page_v1', {
        p_filters: filters, p_page: page, p_page_size: pageSize,
      }).abortSignal(signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000)).retry(false);
      if (error) throw error;
      return assertClassScheduleNumberedResponse(data, { page, pageSize });
    },
    async load(request) {
      if (request?.mode === "calendar") {
        const range = assertRange(request.dateFrom, request.dateTo, 42);
        const response = await unwrapRpc(
          client.rpc("get_operations_calendar_range_v1", {
            p_date_from: range.dateFrom,
            p_date_to: range.dateTo,
          })
            .abortSignal(AbortSignal.timeout(8_000))
            .retry(false),
        );
        return assertCalendarResponse(response, range);
      }
      if (request?.mode === "annual") {
        const academicYear = Number(request.academicYear);
        if (!Number.isInteger(academicYear) || academicYear < 2000 || academicYear > 2200) {
          throw operationsError("operations_year_invalid");
        }
        return assertAnnualResponse(
          await unwrapRpc(
            client.rpc("get_operations_annual_board_v1", { p_academic_year: academicYear })
              .abortSignal(AbortSignal.timeout(8_000))
              .retry(false),
          ),
          academicYear,
        );
      }
      if (request?.mode === "class_schedule") return loadClassSchedule(request);
      throw operationsError("operations_request_invalid");
    },
    async loadEventDetail(eventId) {
      const id = text(eventId);
      if (!UUID.test(id)) throw operationsError("operations_event_id_invalid");
      const detail = await unwrapRpc(
        client.rpc("get_academic_event_detail_v1", { p_event_id: id })
          .abortSignal(AbortSignal.timeout(8_000))
          .retry(false),
      );
      if (!detail || text(detail.id) !== id) throw operationsError("operations_event_detail_invalid");
      return normalizeAcademicEventDetail(detail);
    },
    async loadClassScheduleDetail({ classId, dateFrom, dateTo }) {
      const id = text(classId);
      if (!UUID.test(id)) throw operationsError("operations_class_id_invalid");
      const range = assertRange(dateFrom, dateTo, 42);
      return unwrapRpc(
        client.rpc("get_class_schedule_v1", {
          p_class_id: id,
          p_date_from: range.dateFrom,
          p_date_to: range.dateTo,
        })
          .abortSignal(AbortSignal.timeout(8_000))
          .retry(false),
      );
    },
    async loadClassLessonDesignDetail(classId) {
      const id = text(classId);
      if (!UUID.test(id)) throw operationsError("operations_class_id_invalid");
      const detail = await unwrapRpc(
        client.rpc("get_operations_class_lesson_design_detail_v1", { p_class_id: id })
          .abortSignal(AbortSignal.timeout(8_000))
          .retry(false),
      );
      if (!detail || text(detail.classItem?.id) !== id) throw operationsError("operations_class_detail_invalid");
      return detail;
    },
    /** @param {{ classId: string, search?: string, cursor?: { title: string, id: string } | null }} request */
    async loadLessonTextbookCandidates({ classId, search = "", cursor = null }) {
      const id = text(classId);
      if (!UUID.test(id)) throw operationsError("operations_class_id_invalid");
      if (cursor !== null && (!cursor || !text(cursor.title) || !UUID.test(text(cursor.id)))) {
        throw operationsError("operations_textbook_cursor_invalid");
      }
      const response = await unwrapRpc(
        client.rpc("get_operations_lesson_textbook_candidate_page_v1", {
          p_class_id: id,
          p_search: text(search).slice(0, 100),
          p_cursor_title: cursor?.title || null,
          p_cursor_id: cursor?.id || null,
          p_limit: 30,
        })
          .abortSignal(AbortSignal.timeout(8_000))
          .retry(false),
      );
      const rows = Array.isArray(response?.rows) ? response.rows.slice(0, PAGE_SIZE) : [];
      const hasMore = response?.hasMore === true;
      const boundary = hasMore ? rows.at(-1) : null;
      return {
        rows,
        hasMore,
        nextCursor: boundary ? {
          title: text(boundary.sortTitle || boundary.title || boundary.name),
          id: text(boundary.id),
        } : null,
      };
    },
    async loadCatalogs() {
      const generation = catalogGenerationByActorScope.get(actorScope) || 0;
      const timestamp = Number(now());
      const catalogCache = catalogCacheByActorScope.get(actorScope);
      if (catalogCache && catalogCache.actorScope === actorScope && timestamp < catalogCache.expiresAt) {
        return catalogCache.value;
      }
      const value = await unwrapRpc(
        client.rpc("list_operations_catalogs_v1", {})
          .abortSignal(AbortSignal.timeout(8_000))
          .retry(false),
      );
      if (generation === (catalogGenerationByActorScope.get(actorScope) || 0)) {
        catalogCacheByActorScope.set(actorScope, { actorScope, expiresAt: timestamp + CATALOG_TTL_MS, value });
      }
      return value;
    },
  };
}
