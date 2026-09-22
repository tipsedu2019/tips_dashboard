export type ClassTextbookUsage = Record<string, { startDate: string; endDate: string; title: string }>;

export function readClassTextbookUsage(value: unknown): ClassTextbookUsage {
  let source = value;
  if (typeof source === "string") {
    try { source = JSON.parse(source); } catch { return {}; }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  return Object.fromEntries(Object.entries(source).map(([id, entry]) => {
    const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    return [id, {
      startDate: typeof row.startDate === "string" ? row.startDate : "",
      endDate: typeof row.endDate === "string" ? row.endDate : "",
      title: typeof row.title === "string" ? row.title : "",
    }];
  }));
}

function validDate(value: string): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function classTextbookUsageError(usage?: ClassTextbookUsage[string]): string {
  if (!usage) return "";
  if (!validDate(usage.startDate) || !validDate(usage.endDate)) return "사용기간에 올바른 날짜를 입력하세요.";
  if (usage.startDate && usage.endDate && usage.startDate > usage.endDate) return "종료일은 시작일 이후로 입력하세요.";
  return "";
}

export function buildClassTextbookUsage(value: unknown, selectedIds: string[]): ClassTextbookUsage {
  const usage = readClassTextbookUsage(value);
  const entries = selectedIds.filter((id) => Object.prototype.hasOwnProperty.call(usage, id)).map((id) => {
    const error = classTextbookUsageError(usage[id]);
    if (error) throw new Error(error);
    return [id, usage[id]];
  });
  return Object.fromEntries(entries);
}
