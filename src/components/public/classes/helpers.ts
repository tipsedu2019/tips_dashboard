import type { PublicClassItem, PublicClassSession } from "./types";

export const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
export const MAX_SAVED = 6;
export const STORAGE_KEY = "tips-public-timetable-v1";
export function validIds(input: unknown, known: readonly string[]): string[] {
  const values =
    typeof input === "string"
      ? input.split(",")
      : Array.isArray(input)
        ? input
        : [];
  const allowed = new Set(known);
  return [
    ...new Set(
      values.filter(
        (id): id is string =>
          typeof id === "string" &&
          /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) &&
          allowed.has(id),
      ),
    ),
  ].slice(0, MAX_SAVED);
}
export function storedIds(raw: string, known: readonly string[]) {
  try {
    return validIds(JSON.parse(raw), known);
  } catch {
    return [];
  }
}
export function minutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match || +match[1] > 23 || +match[2] > 59) return null;
  return +match[1] * 60 + +match[2];
}
export type Slot = {
  day: number;
  start: number;
  end: number;
  classId: string;
  name: string;
};
export function scheduleSlots(
  item: Pick<PublicClassItem, "id" | "name" | "schedule">,
): Slot[] {
  const slots: Slot[] = [];
  const pattern =
    /([월화수목금토일][월화수목금토일\s·,/]*)\s*(\d{1,2}:\d{2})\s*[-–~]\s*(\d{1,2}:\d{2})/g;
  for (const match of item.schedule.matchAll(pattern)) {
    const start = minutes(match[2]);
    const end = minutes(match[3]);
    if (start === null || end === null || end <= start) continue;
    for (const day of new Set(match[1].match(/[월화수목금토일]/g))) {
      slots.push({
        day: DAYS.indexOf(day),
        start,
        end,
        classId: item.id,
        name: item.name,
      });
    }
  }
  return slots;
}
export function overlaps(a: Slot, b: Slot) {
  return (
    a.classId !== b.classId &&
    a.day === b.day &&
    a.start < b.end &&
    b.start < a.end
  );
}
export function conflicts(slots: Slot[]) {
  const results: { a: Slot; b: Slot }[] = [];
  slots.forEach((a, i) =>
    slots.slice(i + 1).forEach((b) => {
      if (overlaps(a, b)) results.push({ a, b });
    }),
  );
  return results;
}
export function clockLabel(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
export function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
export function monthCells(year: number, month: number) {
  const offset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, i) =>
    i < offset || i >= offset + count
      ? null
      : dateKey(year, month, i - offset + 1),
  );
}
export function seoulToday(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function sessionState(session: PublicClassSession) {
  const state = session.scheduleState;
  if (state === "exception" || state === "cancelled" || state === "canceled")
    return { label: "휴강", cancelled: true };
  if (state === "tbd") return { label: "일정 미정", cancelled: true };
  if (state === "skipped") return { label: "수업 제외", cancelled: true };
  if (state === "makeup" || session.originalDate)
    return { label: "보강", cancelled: false };
  if (state === "unplanned") return { label: "추가 수업", cancelled: false };
  if (
    !state ||
    state === "planned" ||
    state === "regular" ||
    state === "normal" ||
    state === "active"
  )
    return { label: "정규 수업", cancelled: false };
  return { label: "수업", cancelled: false };
}
export function availability(item: PublicClassItem) {
  const remaining = Math.max(0, item.capacity - item.enrolledCount);
  if (item.capacity <= 0)
    return { label: "정원 문의", tone: "neutral", remaining };
  if (!remaining)
    return {
      label: item.waitlistCount > 0 ? "대기 접수" : "마감",
      tone: "neutral",
      remaining,
    };
  return {
    label: remaining <= 2 ? "마감 임박" : "모집 중",
    tone: remaining <= 2 ? "amber" : "green",
    remaining,
  };
}
export function filterClasses(
  classes: PublicClassItem[],
  params: URLSearchParams,
) {
  const q = (params.get("q") || "").slice(0, 100).trim().toLocaleLowerCase();
  return classes.filter(
    (c) =>
      (!params.get("subject") || c.subject === params.get("subject")) &&
      (!params.get("grade") || c.grade === params.get("grade")) &&
      (!q ||
        [c.name, c.teacher, c.room, c.schedule, c.subject, c.grade]
          .join(" ")
          .toLocaleLowerCase()
          .includes(q)),
  );
}
export function sessionDisplay(
  item: PublicClassItem,
  session: PublicClassSession,
) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(session.date || "")
    ? new Date(`${session.date}T00:00:00Z`)
    : null;
  const day = date ? (date.getUTCDay() + 6) % 7 : -1;
  const regular =
    (!session.scheduleState ||
      ["active", "normal", "regular", "planned"].includes(
        session.scheduleState,
      )) &&
    !session.originalDate;
  const slots = regular
    ? scheduleSlots(item).filter((slot) => slot.day === day)
    : [];
  const annotation = regular
    ? item.schedule
        .split("\n")
        .find((line) =>
          scheduleSlots({ ...item, schedule: line }).some(
            (slot) => slot.day === day,
          ),
        )
        ?.match(/\(([^)]+)\)/)?.[1]
        .split(",")
        .map((part) => part.trim())
    : undefined;
  const time =
    session.startTime || session.endTime
      ? [session.startTime, session.endTime].filter(Boolean).join("–")
      : slots
          .map((slot) => `${clockLabel(slot.start)}–${clockLabel(slot.end)}`)
          .join(", ");
  return {
    time: time || "시간 미정",
    regularFallback: !session.startTime && !session.endTime && slots.length > 0,
    teacher: session.teacherName || annotation?.[0] || item.teacher,
    room:
      session.classroomName || annotation?.[1] || item.room || "강의실 문의",
  };
}

/** Give every connected overlap group a stable lane width, including staggered overlaps. */
export function layoutSlots(slots: Slot[]) {
  const result: (Slot & { lane: number; laneCount: number })[] = [];
  for (let day = 0; day < 7; day++) {
    const ordered = slots
      .filter((slot) => slot.day === day)
      .sort((a, b) => a.start - b.start || b.end - a.end);
    let group: Slot[] = [];
    let groupEnd = -1;
    function flush() {
      const laneEnds: number[] = [];
      const placed = group.map((slot) => {
        let lane = laneEnds.findIndex((end) => end <= slot.start);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = slot.end;
        return { ...slot, lane };
      });
      result.push(
        ...placed.map((slot) => ({ ...slot, laneCount: laneEnds.length })),
      );
      group = [];
    }
    for (const slot of ordered) {
      if (group.length && slot.start >= groupEnd) flush();
      if (!group.length) groupEnd = slot.end;
      group.push(slot);
      groupEnd = Math.max(groupEnd, slot.end);
    }
    flush();
  }
  return result;
}
