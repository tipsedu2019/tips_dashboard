/* eslint-disable @typescript-eslint/no-explicit-any -- strict transport checks narrow every RPC field. */
import { readTextbookPurpose, textbookPurposeValidation, type TextbookReadOptions } from "./textbook-read-service";
import { assertSubSubjectDraft, isDefaultTextbookSubSubjectId } from "./textbook-taxonomy";
import type {
  SubSubjectCounts,
  SubSubjectPageRequest,
  TextbookSettingsSubject,
  TextbookSubSubjectSettingRow,
  TextbookSubSubjectSettingsPage,
} from "./textbook-settings-types";

const v: typeof textbookPurposeValidation = textbookPurposeValidation;
type RecordValue = Record<string, any>;
const subjects: TextbookSettingsSubject[] = ["english", "math", "science", "other"];
const object = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function exact(value: unknown, keys: string[]) { v.exact(value, keys); return value as RecordValue; }

function assertRequest(request: unknown): asserts request is SubSubjectPageRequest {
  if (!object(request)
    || Object.keys(request).length !== 4
    || !["page", "pageSize", "filters", "draft"].every((key) => own(request, key))
    || !v.integer(request.page)
    || request.page < 1
    || request.page > 2147483647
    || ![10, 15, 20].includes(request.pageSize as number)) v.fail("input");
  if (!object(request.filters)
    || Object.keys(request.filters).length !== 2
    || !["subject", "search"].every((key) => own(request.filters, key))) v.fail("input");
  const filters = request.filters;
  if (!subjects.includes(filters.subject) || typeof filters.search !== "string") v.fail("input");
  if (request.draft !== null) assertSubSubjectDraft(request.draft);
}

function counts(value: unknown): SubSubjectCounts {
  const row = exact(value, subjects);
  for (const subject of subjects) if (!v.integer(row[subject]) || row[subject] < 0) v.fail();
  return row as SubSubjectCounts;
}

function parseRow(value: unknown, requestedSubject: TextbookSettingsSubject): TextbookSubSubjectSettingRow {
  const row = exact(value, ["id", "subject", "name", "sortOrder", "isVisible", "kind", "canMoveUp", "canMoveDown"]);
  if (typeof row.id !== "string"
    || row.subject !== requestedSubject
    || typeof row.name !== "string"
    || !v.integer(row.sortOrder)
    || typeof row.isVisible !== "boolean"
    || !["persisted", "default", "added"].includes(row.kind)
    || typeof row.canMoveUp !== "boolean"
    || typeof row.canMoveDown !== "boolean") v.fail();
  if (row.kind === "default") {
    if (!isDefaultTextbookSubSubjectId(row.id)) v.fail();
  } else if (!v.uuid(row.id) || row.id !== row.id.toLowerCase()) v.fail();
  return row as TextbookSubSubjectSettingRow;
}

function parse(value: unknown, request: SubSubjectPageRequest): TextbookSubSubjectSettingsPage {
  const result = exact(value, ["rows", "page", "pageSize", "totalCount", "baseRevision", "visibleCount", "subjectCounts"]);
  const subjectCounts = counts(result.subjectCounts);
  const projectedCount = subjects.reduce((total, subject) => total + subjectCounts[subject], 0);
  const expectedLength = Math.min(request.pageSize, Math.max(0, result.totalCount - (request.page - 1) * request.pageSize));
  if (result.page !== request.page
    || result.pageSize !== request.pageSize
    || !v.integer(result.totalCount)
    || result.totalCount < 0
    || result.totalCount > subjectCounts[request.filters.subject]
    || typeof result.baseRevision !== "string"
    || !/^[0-9a-f]{64}$/.test(result.baseRevision)
    || !v.integer(result.visibleCount)
    || result.visibleCount < 0
    || result.visibleCount > projectedCount
    || !Array.isArray(result.rows)
    || result.rows.length !== expectedLength) v.fail();
  const rows = result.rows.map((row: unknown) => parseRow(row, request.filters.subject));
  if (new Set(rows.map((row) => row.id.toLowerCase())).size !== rows.length) v.fail();
  if (subjectCounts[request.filters.subject] <= 1 && rows.some((row) => row.canMoveUp || row.canMoveDown)) v.fail();
  return {
    rows,
    page: result.page,
    pageSize: result.pageSize,
    totalCount: result.totalCount,
    baseRevision: result.baseRevision,
    visibleCount: result.visibleCount,
    subjectCounts,
  };
}

export function listTextbookSubSubjectPage(request: SubSubjectPageRequest, options: TextbookReadOptions = {}) {
  assertRequest(request);
  const deadline = AbortSignal.timeout(8000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose(
    { ...options, signal },
    (client) => client.rpc("list_textbook_sub_subject_numbered_page_v1", {
      p_filters: request.filters,
      p_draft: request.draft,
      p_page: request.page,
      p_page_size: request.pageSize,
    }).abortSignal(signal).retry(false),
    (data) => parse(data, request),
  );
}
