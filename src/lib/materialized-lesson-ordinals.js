const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const states = new Set(["active", "makeup", "exception", "skipped", "tbd"]);
const countedStates = new Set(["active", "makeup"]);

function exactText(row, keys) {
  const values = keys.map(key => row[key]).filter(value => value !== undefined && value !== null && value !== "");
  return values.length && values.every(value => typeof value === "string" && value.trim() === value && value === values[0])
    ? values[0] : null;
}

function dateValue(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === "0000") return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

// Display only: the returned copy is never a schedule save or booking payload.
// Existing materialized rows are the entire input; no planner/date prediction is
// used. Invalid period definitions or duplicate row IDs preserve the whole plan.
// Overlap, duplicate dates, unsupported/conflicting states, missing ownership,
// and out-of-period dates/links preserve the affected period's stored ordinals.
// The optional internal observer receives only validated source indices and
// derived numbers (including null), never a source row or mutable reference.
export function projectMaterializedLessonOrdinals(plan, { onDerived } = {}) {
  const projected = structuredClone(plan);
  if (!record(plan) || !Array.isArray(plan.sessions)) return projected;
  const periods = plan.billingPeriods ?? plan.billing_periods;
  if (!Array.isArray(periods) || periods.length === 0) return projected;
  const definitions = [];
  for (const period of periods) {
    if (!record(period)) return projected;
    const id = exactText(period, ["id", "period_id"]);
    const start = dateValue(exactText(period, ["startDate", "start_date"]));
    const end = dateValue(exactText(period, ["endDate", "end_date"]));
    if (!id || !start || !end || start > end || definitions.some(previous => previous.id === id)) return projected;
    definitions.push({ id, start, end });
  }
  const byId = new Map(definitions.map(period => [period.id, period]));
  const blocked = new Set();
  for (const left of definitions) for (const right of definitions) {
    if (left.id !== right.id && left.start <= right.end && right.start <= left.end) {
      blocked.add(left.id); blocked.add(right.id);
    }
  }
  const blockAtDate = date => {
    for (const period of definitions) if (!date || (date >= period.start && date <= period.end)) blocked.add(period.id);
  };
  const groups = new Map(definitions.map(period => [period.id, []]));
  const seenIds = new Set();
  const seenDates = new Set();
  for (const [index, row] of plan.sessions.entries()) {
    if (!record(row)) { blockAtDate(null); continue; }
    const id = exactText(row, ["id", "session_id"]);
    if (id && seenIds.has(id)) return projected;
    if (id) seenIds.add(id);
    const period = byId.get(exactText(row, ["billingId", "billing_id"]));
    const date = dateValue(exactText(row, ["date", "session_date"]));
    const state = exactText(row, ["scheduleState", "schedule_state", "state"]);
    if (!period) { blockAtDate(date); continue; }
    if (!id || !date || !states.has(state) || (row.isForced !== undefined && typeof row.isForced !== "boolean")) {
      blocked.add(period.id); continue;
    }
    if (date < period.start || date > period.end) {
      blocked.add(period.id); blockAtDate(date); continue;
    }
    const dateKey = `${period.id}:${date}`;
    if (seenDates.has(dateKey)) blocked.add(period.id);
    seenDates.add(dateKey);
    for (const [keys, linkedState] of [[["originalDate", "original_date"], "makeup"], [["makeupDate", "makeup_date"], "exception"]]) {
      if (!keys.some(key => row[key] !== undefined && row[key] !== null && row[key] !== "")) continue;
      const linkedDate = dateValue(exactText(row, keys));
      if (!linkedDate || linkedDate === date || linkedDate < period.start || linkedDate > period.end || state !== linkedState) blocked.add(period.id);
    }
    groups.get(period.id).push({ index, date, state });
  }
  for (const [periodId, rows] of groups) {
    if (blocked.has(periodId)) continue;
    let ordinal = 0;
    for (const row of rows.sort((left, right) => left.date.localeCompare(right.date))) {
      const number = countedStates.has(row.state) ? ++ordinal : null;
      projected.sessions[row.index].sessionNumber = number;
      if (typeof onDerived === "function") onDerived(row.index, number);
    }
  }
  return projected;
}
