export type ClassScheduleMonthSummary = {
  classId: string;
  year: number;
  authoritativeSource: "normalized" | "legacy";
  months: Array<{ month: number; count: number }>;
};

// A cancelled/exception row can occupy a calendar cell, but is not a lesson.
export function countNormalizedLessons(rows: Array<{ scheduleState?: unknown }>) {
  return rows.filter(row => row.scheduleState === "active" || row.scheduleState === "makeup").length;
}

export function classScheduleYearMonths(year: number) {
  if (!Number.isInteger(year) || year < 1 || year > 9998) return [];
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${String(year).padStart(4, "0")}-${String(index + 1).padStart(2, "0")}`;
    const end = new Date(`${month}-01T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    return { id: `read-month-${month}`, month, startDate: `${month}-01`, endDate: end.toISOString().slice(0, 10) };
  });
}

// Counts are authoritative only for an exact class/year and a complete response.
// A legacy fallback or a malformed payload must never fabricate twelve zeroes.
export function parseClassScheduleMonthSummary(value: unknown, classId: string, year: number): ClassScheduleMonthSummary {
  const fail = () => { throw new Error("operations_month_summary_invalid"); };
  if (!value || typeof value !== "object") return fail();
  const row = value as Record<string, unknown>;
  if (row.classId !== classId || row.year !== year || !classScheduleYearMonths(year).length) return fail();
  if (row.authoritativeSource === "legacy") return { classId, year, authoritativeSource: "legacy", months: [] };
  if (row.authoritativeSource !== "normalized" || !Array.isArray(row.months) || row.months.length !== 12) return fail();
  const seen = new Set<number>();
  const months = row.months.map((item: unknown) => {
    if (!item || typeof item !== "object") return fail();
    const { month, count } = item as Record<string, unknown>;
    if (typeof month !== "number" || !Number.isInteger(month) || month < 1 || month > 12 || seen.has(month)
      || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return fail();
    seen.add(month);
    return { month, count };
  }).sort((a, b) => a.month - b.month);
  return { classId, year, authoritativeSource: "normalized", months };
}
