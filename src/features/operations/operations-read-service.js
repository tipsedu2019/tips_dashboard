const PAGE_SIZE = 30;
const CATALOG_TTL_MS = 30 * 60 * 1_000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CLASS_FILTER_KEYS = ["grade", "search", "subject", "syncGroupId", "teacher", "termId"];
const catalogCacheByActorScope = new Map();

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
    examTerm: text(detail.examTerm || embeddedNoteMeta.examTerm),
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
    async loadCatalogs() {
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
      catalogCacheByActorScope.set(actorScope, { actorScope, expiresAt: timestamp + CATALOG_TTL_MS, value });
      return value;
    },
  };
}
