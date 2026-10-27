type Row = Record<string, unknown>;
type Range = { dateFrom: string; dateTo: string };

const knownStates = new Set(["active", "makeup", "exception", "skipped", "tbd"]);
const countedStates = new Set(["active", "makeup"]);
const text = (value: unknown) => typeof value === "string" ? value : "";
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// These are navigation hints, not totals or stored billing ownership. A legacy
// period can cross calendar months; a normalized read always covers one month.
export function normalizedLessonMonths(periods: Row[], requestedMonth: string, loadedMonth: string | null) {
  const months = new Set<string>();
  const add = (month: string) => { if (validDate(`${month}-01`)) months.add(month); };
  add(requestedMonth);
  if (loadedMonth) add(loadedMonth);
  for (const period of periods) {
    const start = text(period.startDate), end = text(period.endDate);
    if (!validDate(start) || !validDate(end) || start > end) continue;
    const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
    const last = new Date(`${end}T00:00:00Z`).getTime();
    while (cursor.getTime() <= last) {
      add(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  return [...months].sort().map(month => {
    const end = new Date(`${month}-01T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
    return { id: `read-month-${month}`, month, startDate: `${month}-01`, endDate: end.toISOString().slice(0, 10) };
  });
}

// Normalized lessons have stable UUIDs, not stored ordinals. The schedule read
// covers a complete calendar month. Derive labels from its actual rows only;
// never feed these numbers back into a schedule, booking, or content payload.
export function normalizedLessonDisplayOrdinals(sessions: Row[], range: Range | null) {
  const ordinals = new Map<string, number | null>();
  for (const row of sessions) if (text(row.id)) ordinals.set(text(row.id), null);
  if (!range || !validDate(range.dateFrom) || !validDate(range.dateTo)
    || range.dateFrom.slice(0, 7) !== range.dateTo.slice(0, 7) || !range.dateFrom.endsWith("-01")) return ordinals;
  const end = new Date(`${range.dateTo}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  if (!end.toISOString().slice(0, 10).endsWith("-01")) return ordinals;

  const ids = new Set<string>(), keys = new Set<string>();
  const rows = [];
  for (const row of sessions) {
    const id = text(row.id), key = text(row.sessionKey) || id;
    const date = text(row.date), state = text(row.scheduleState), time = text(row.startTime);
    if (!id || !key || ids.has(id) || keys.has(key) || !validDate(date)
      || date < range.dateFrom || date > range.dateTo || !knownStates.has(state)
      || (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) return ordinals;
    ids.add(id); keys.add(key);
    rows.push({ id, key, date, state, time: time || "99:99" });
  }
  rows.sort((a, b) => compare(a.date, b.date) || compare(a.time, b.time) || compare(a.key, b.key));
  let number = 0;
  for (const row of rows) ordinals.set(row.id, countedStates.has(row.state) ? ++number : null);
  return ordinals;
}
