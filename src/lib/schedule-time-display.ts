/** Display separators only; schedule parsing and stored values are unchanged. */
export function formatScheduleTimeRange(value: string): string {
  return value.replace(/(\d{1,2}:\d{2})\s*[-~–]\s*(\d{1,2}:\d{2})/g, "$1–$2");
}
