const detailFields: Record<string, string> = {
  name: "name", class_type: "classType", subject: "subject", subject_area_key: "subjectAreaKey",
  grade: "grade", teacher: "teacher", schedule: "schedule", room: "classroom",
  capacity: "capacity", fee: "fee", status: "status", textbook_ids: "textbookIds", textbook_usage: "textbookUsage",
  public_memo: "publicMemo",
};

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && sameJson(a[key], b[key]));
}

export function matchesClosedClassDetail(detail: unknown, classId: string, patch: Record<string, unknown>): boolean {
  if (!detail || typeof detail !== "object" || patch.status !== "종강") return false;
  const value = detail as Record<string, unknown>;
  const record = value.record as Record<string, unknown> | undefined;
  if (value.kind !== "classes" || !record || record.id !== classId || record.status !== "종강") return false;
  if (value.registeredCount !== 0 || value.waitlistCount !== 0) return false;
  for (const key of ["registeredStudents", "waitlistedStudents"]) {
    const page = value[key] as { rows?: unknown[]; hasMore?: boolean; nextCursor?: unknown } | undefined;
    if (!page || !Array.isArray(page.rows) || page.rows.length || page.hasMore !== false || page.nextCursor !== null) return false;
  }
  return Object.entries(patch).every(([key, expected]) => {
    const field = detailFields[key];
    return Object.prototype.hasOwnProperty.call(detailFields, key) && Object.prototype.hasOwnProperty.call(record, field) && sameJson(expected, record[field]);
  });
}

export function isUncertainClassWrite(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, name, message } = error as { code?: string; name?: string; message?: string };
  if (code === "CLASS_OPERATIONAL_RECEIPT_INVALID") return true;
  // An explicit server rejection must never be promoted to a confirmed state.
  if (code) return false;
  return name === "AbortError" || name === "TimeoutError"
    || /^(AbortError|TimeoutError):/.test(message || "")
    || /^(TypeError: )?(Failed to fetch|fetch failed|NetworkError when attempting to fetch resource|Load failed)/i.test(message || "");
}

export type ClassCloseConfirmation = {
  id: string; status: "종강"; closeConfirmation: "current-state";
  publicClassesCacheRefresh?: { status: "complete" | "pending" };
};
export type ClassCloseConfirmationError = Error & { code: "CLASS_CLOSE_RESULT_UNCERTAIN"; confirm: () => Promise<ClassCloseConfirmation> };

export function isClassCloseConfirmationError(error: unknown): error is ClassCloseConfirmationError {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "CLASS_CLOSE_RESULT_UNCERTAIN"
    && "confirm" in error && typeof error.confirm === "function");
}

export function createClassCloseConfirmation(options: {
  classId: string;
  patch: Record<string, unknown>;
  readDetail: () => Promise<unknown>;
  isCurrent: () => boolean;
  onChecking?: () => void;
  onConfirmed?: () => Promise<{ status: "complete" | "pending" }>;
}): () => Promise<ClassCloseConfirmation> {
  const patch = structuredClone(options.patch);
  const confirm = async (): Promise<ClassCloseConfirmation> => {
    const uncertain = Object.assign(new Error("종강 반영 여부를 확인하지 못했습니다. 입력은 유지됩니다."), {
      code: "CLASS_CLOSE_RESULT_UNCERTAIN" as const, confirm,
    });
    if (!options.isCurrent()) throw uncertain;
    options.onChecking?.();
    let detail: unknown;
    try { detail = await options.readDetail(); } catch { throw uncertain; }
    if (!options.isCurrent() || !matchesClosedClassDetail(detail, options.classId, patch)) throw uncertain;
    const publicClassesCacheRefresh = await options.onConfirmed?.();
    // This is current state evidence, not a receipt attributing a commit to this request.
    return { id: options.classId, status: "종강", closeConfirmation: "current-state",
      ...(publicClassesCacheRefresh ? { publicClassesCacheRefresh } : {}) };
  };
  return confirm;
}
