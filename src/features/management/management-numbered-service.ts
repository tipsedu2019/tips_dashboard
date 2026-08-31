import type { SupabaseClient } from "@supabase/supabase-js";
import { validatePageSize, type DataTablePageSize, type NumberedPage } from "../../lib/numbered-pagination.ts";
import type { ManagementListFilters } from "./use-management-records";

export type ManagementNumberedKind = ManagementListFilters["kind"];
export type ManagementNumberedSort = readonly { id: string; desc: boolean }[];

// The controller/table must use this allow-list for manual server sorting.
// Derived enrollmentStatus/weeklyHours have no parent-key projection and stay disabled.
export const MANAGEMENT_NUMBERED_SORT_COLUMNS: Record<ManagementNumberedKind, readonly string[]> = {
  students: ["title", "status", "school", "grade", "contact", "parentContact"],
  classes: ["title", "status", "subject", "grade", "schedule", "teacher", "classroom", "capacity", "tuition"],
  textbooks: ["title", "status", "subject", "publisher", "price", "updatedAt"],
};

type RowBase = { id: string; status: string; sortKey: string; updatedAt: string };
export type ManagementNumberedStudent = RowBase & {
  kind: "students"; name: string; grade: string | null; school: string | null;
  contact: string | null; parentContact: string | null;
};
export type ManagementNumberedClass = RowBase & {
  kind: "classes"; name: string; subject: string; grade: string | null;
  schedule: string | null; teacherName: string | null; classroom: string | null;
  capacity: number | null; weeklyMinutes: number | null; fee: number | null; studentCount: number;
};
export type ManagementNumberedTextbook = RowBase & {
  kind: "textbooks"; title: string; subject: string; publisher: string | null;
  price: number | null; activeClassCount: number;
};
export type ManagementNumberedRow = ManagementNumberedStudent | ManagementNumberedClass | ManagementNumberedTextbook;
type RowFor<K extends ManagementNumberedKind> = Extract<ManagementNumberedRow, { kind: K }>;

export type ManagementNumberedRequest<K extends ManagementNumberedKind = ManagementNumberedKind> = {
  kind: K;
  filters: Extract<ManagementListFilters, { kind: K }>;
  page: number;
  pageSize: DataTablePageSize;
  sort: ManagementNumberedSort;
  signal?: AbortSignal;
};

const FILTER_KEYS: Record<ManagementNumberedKind, readonly string[]> = {
  students: ["grade", "kind", "school", "schoolCategory", "search", "status"],
  classes: ["classroom", "grade", "kind", "periodId", "search", "status", "subject", "teacher"],
  textbooks: ["kind", "publisher", "search", "status", "subject"],
};

function readError(code: string) {
  return Object.assign(new Error(code), { code });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeManagementNumberedSort(kind: ManagementNumberedKind, saved: unknown): ManagementNumberedSort {
  if (!Array.isArray(saved)) return [];
  const result: { id: string; desc: boolean }[] = [];
  for (const item of saved) {
    if (isObject(item) && typeof item.id === "string" && typeof item.desc === "boolean"
      && MANAGEMENT_NUMBERED_SORT_COLUMNS[kind].includes(item.id) && !result.some((sort) => sort.id === item.id)) {
      result.push({ id: item.id, desc: item.desc });
      if (result.length === 2) break;
    }
  }
  return result;
}

function validateRequest<K extends ManagementNumberedKind>(request: ManagementNumberedRequest<K>) {
  const { kind, filters, page, pageSize, sort } = request;
  const invalid = () => { throw readError("management_numbered_request_invalid"); };
  if (!Object.prototype.hasOwnProperty.call(FILTER_KEYS, kind) || !Number.isInteger(page) || page < 1 || page > 2147483647) invalid();
  try { validatePageSize(pageSize); } catch { invalid(); }
  const keys = FILTER_KEYS[kind];
  if (!isObject(filters) || filters.kind !== kind || Object.keys(filters).sort().join("|") !== keys.join("|")) invalid();
  const values = filters as unknown as Record<string, unknown>;
  if (typeof values.search !== "string" || keys.some((key) => key !== "kind" && key !== "search" && values[key] !== null && typeof values[key] !== "string")) invalid();
  if (!Array.isArray(sort) || sort.length > 2) invalid();
  const seen = new Set<string>();
  for (const item of sort) {
    if (!isObject(item) || Object.keys(item).sort().join("|") !== "desc|id" || typeof item.id !== "string"
      || typeof item.desc !== "boolean" || !MANAGEMENT_NUMBERED_SORT_COLUMNS[kind].includes(item.id) || seen.has(item.id)) invalid();
    seen.add(item.id);
  }
}

function isNullableText(value: unknown) { return value === null || typeof value === "string"; }
function isNullableNumber(value: unknown) { return value === null || (typeof value === "number" && Number.isFinite(value)); }
function isCount(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }

function isRow<K extends ManagementNumberedKind>(value: unknown, kind: K): value is RowFor<K> {
  if (!isObject(value) || value.kind !== kind || typeof value.id !== "string" || !value.id.trim()
    || !["status", "sortKey", "updatedAt"].every((key) => typeof value[key] === "string")) return false;
  if (kind === "students") return typeof value.name === "string"
    && ["grade", "school", "contact", "parentContact"].every((key) => isNullableText(value[key]));
  if (kind === "classes") return typeof value.name === "string" && typeof value.subject === "string"
    && ["grade", "schedule", "teacherName", "classroom"].every((key) => isNullableText(value[key]))
    && ["capacity", "weeklyMinutes", "fee"].every((key) => isNullableNumber(value[key])) && isCount(value.studentCount);
  return typeof value.title === "string" && typeof value.subject === "string" && isNullableText(value.publisher)
    && isNullableNumber(value.price) && isCount(value.activeClassCount);
}

function parsePage<K extends ManagementNumberedKind>(data: unknown, request: ManagementNumberedRequest<K>): NumberedPage<RowFor<K>> {
  if (!isObject(data) || data.page !== request.page || data.pageSize !== request.pageSize || !isCount(data.totalCount)
    || !Array.isArray(data.rows) || !data.rows.every((row) => isRow(row, request.kind))) {
    throw readError("management_numbered_response_invalid");
  }
  const expectedLength = Math.min(request.pageSize, Math.max(0, data.totalCount - (request.page - 1) * request.pageSize));
  if (data.rows.length !== expectedLength || new Set(data.rows.map((row) => row.id)).size !== data.rows.length) {
    throw readError("management_numbered_response_invalid");
  }
  return { rows: data.rows, page: request.page, pageSize: request.pageSize, totalCount: data.totalCount };
}

export function createManagementNumberedReadService({ supabase }: { supabase: Pick<SupabaseClient, "rpc"> }) {
  return {
    // Class default-period resolution is intentionally caller-owned, using the existing
    // get_management_default_class_period_v1 resolver at the hook boundary.
    async readPage<K extends ManagementNumberedKind>(request: ManagementNumberedRequest<K>): Promise<NumberedPage<RowFor<K>>> {
      validateRequest(request);
      request.signal?.throwIfAborted();
      const deadline = AbortSignal.timeout(8_000);
      const signal = request.signal ? AbortSignal.any([request.signal, deadline]) : deadline;
      const { data, error } = await supabase.rpc("list_management_numbered_page_v1", {
        p_kind: request.kind, p_filters: request.filters, p_page: request.page, p_page_size: request.pageSize, p_sort: request.sort,
      }).abortSignal(signal).retry(false);
      signal.throwIfAborted();
      if (error) {
        if (error.code === "PGRST202" || error.code === "42883") {
          throw Object.assign(readError("management_numbered_rpc_unavailable"), { cause: error });
        }
        throw error;
      }
      return parsePage(data, request);
    },
  };
}
