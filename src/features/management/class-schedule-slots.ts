export type ClassScheduleSlot = {
  id: string | null;
  day: string;
  startTime: string;
  endTime: string;
  teacher: string;
  teacherCatalogId: string | null;
  classroom: string;
  classroomCatalogId: string | null;
  sortOrder: number;
};

const CLASS_SCHEDULE_DAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;
type ClassScheduleDay = (typeof CLASS_SCHEDULE_DAYS)[number];
const CLASS_SCHEDULE_DAY_SET = new Set<string>(CLASS_SCHEDULE_DAYS);
const CLASS_SCHEDULE_DAY_INDEX = new Map<string, number>(CLASS_SCHEDULE_DAYS.map((day, index) => [day, index === 6 ? 0 : index + 1]));
const CLASS_SCHEDULE_DAY_BY_INDEX = new Map([...CLASS_SCHEDULE_DAY_INDEX].map(([day, index]) => [index, day]));
const DAY_GROUP_PATTERN = /([월화수목금토일]+)\s*(\d{1,2}:\d{2})\s*[-~–]\s*(\d{1,2}:\d{2})(?:\s*\(([^)]*)\))?/g;

function text(value: unknown) {
  return String(value || "").trim();
}

function splitOptionValues(value: unknown) {
  return text(value)
    .split(/[,，/]+/)
    .map((part) => part.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function uniqueTextValues(values: unknown[]) {
  const seen = new Set<string>();
  const nextValues: string[] = [];
  for (const value of values) {
    const normalized = text(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    nextValues.push(normalized);
  }
  return nextValues;
}

function getClassroomValuesByDay(value: unknown) {
  const classroomsByDay = new Map<string, string>();
  const raw = text(value);
  if (!raw) return classroomsByDay;

  for (const match of raw.matchAll(/([^,，/()]+?)\s*\(([월화수목금토일])\)/g)) {
    const classroom = text(match[1]);
    const day = text(match[2]);
    if (classroom && day) classroomsByDay.set(day, classroom);
  }
  return classroomsByDay;
}

function looksLikeClassroomAlias(value: unknown) {
  const normalized = text(value).replace(/\s+/g, "");
  return /(?:본관|별관|강의실|교실|본\d|별\d|강$|실$)/.test(normalized);
}

function getFallbackValue(values: string[], slotIndex: number) {
  if (values.length === 1) return values[0];
  return values[slotIndex] || values[0] || "";
}

function createEmptyClassScheduleSlot(): ClassScheduleSlot {
  return {
    id: null,
    day: "",
    startTime: "",
    endTime: "",
    teacher: "",
    teacherCatalogId: null,
    classroom: "",
    classroomCatalogId: null,
    sortOrder: 0,
  };
}

function optionalId(value: unknown): string | null {
  return text(value) || null;
}

function numeric(value: unknown, fallback: number): number {
  return Number.isInteger(value) ? Number(value) : fallback;
}

export function fromContinuousClassScheduleDefaults(rows: unknown[]): ClassScheduleSlot[] {
  return (Array.isArray(rows) ? rows : []).flatMap((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const weekday = numeric(row.weekday, -1);
    const day = CLASS_SCHEDULE_DAY_BY_INDEX.get(weekday);
    if (!day) return [];
    return [{
      id: optionalId(row.id),
      day,
      startTime: text(row.startTime || row.start_time),
      endTime: text(row.endTime || row.end_time),
      teacher: text(row.teacherName || row.teacher_name),
      teacherCatalogId: optionalId(row.teacherCatalogId || row.teacher_catalog_id),
      classroom: text(row.classroomName || row.classroom_name),
      classroomCatalogId: optionalId(row.classroomCatalogId || row.classroom_catalog_id),
      sortOrder: numeric(row.sortOrder ?? row.sort_order, index),
    }];
  });
}

export function toContinuousClassScheduleSlots(slots: ClassScheduleSlot[]) {
  return slots.map((slot, index) => ({
    id: slot.id,
    weekday: CLASS_SCHEDULE_DAY_INDEX.get(text(slot.day)) ?? -1,
    startTime: text(slot.startTime),
    endTime: text(slot.endTime),
    teacherCatalogId: optionalId(slot.teacherCatalogId),
    classroomCatalogId: optionalId(slot.classroomCatalogId),
    sortOrder: numeric(slot.sortOrder, index),
  }));
}

export function parseClassScheduleSlots(
  scheduleValue: unknown,
  teacherValue: unknown,
  classroomValue: unknown,
): ClassScheduleSlot[] {
  const schedule = text(scheduleValue);
  const teachers = splitOptionValues(teacherValue);
  const classrooms = splitOptionValues(classroomValue);
  const classroomsByDay = getClassroomValuesByDay(classroomValue);
  const slots: ClassScheduleSlot[] = [];

  for (const match of schedule.matchAll(DAY_GROUP_PATTERN)) {
    const days = [...text(match[1])].filter((day): day is ClassScheduleDay => CLASS_SCHEDULE_DAY_SET.has(day));
    const startTime = text(match[2]);
    const endTime = text(match[3]);
    const detailParts = text(match[4]).split(/[,，/]+/).map(text).filter(Boolean);
    const firstDetail = detailParts[0] || "";
    const firstDetailIsTeacher = Boolean(firstDetail && !looksLikeClassroomAlias(firstDetail));

    for (const day of days) {
      const slotIndex = slots.length;
      slots.push({
        id: null,
        day,
        startTime,
        endTime,
        teacher: firstDetailIsTeacher ? firstDetail : getFallbackValue(teachers, slotIndex),
        teacherCatalogId: null,
        classroom: firstDetailIsTeacher
          ? detailParts.slice(1).join(", ") || classroomsByDay.get(day) || getFallbackValue(classrooms, slotIndex)
          : detailParts[detailParts.length - 1] || classroomsByDay.get(day) || getFallbackValue(classrooms, slotIndex),
        classroomCatalogId: null,
        sortOrder: slotIndex,
      });
    }
  }

  if (slots.length > 0) return slots;

  const day = text(schedule.match(/[월화수목금토일]/)?.[0]);
  const timeMatch = schedule.match(/(\d{1,2}:\d{2})\s*[-~–]\s*(\d{1,2}:\d{2})/);
  const fallbackSlot = {
    id: null,
    day,
    startTime: text(timeMatch?.[1]),
    endTime: text(timeMatch?.[2]),
    teacher: teachers[0] || "",
    teacherCatalogId: null,
    classroom: classrooms[0] || "",
    classroomCatalogId: null,
    sortOrder: 0,
  };

  return Object.values(fallbackSlot).some(Boolean)
    ? [fallbackSlot]
    : [createEmptyClassScheduleSlot()];
}

export function formatClassScheduleSlots(slots: ClassScheduleSlot[]) {
  const normalizedSlots = slots
    .map((slot) => ({
      day: text(slot.day),
      startTime: text(slot.startTime),
      endTime: text(slot.endTime),
      teacher: text(slot.teacher),
      classroom: text(slot.classroom),
    }))
    .filter((slot) => Object.values(slot).some(Boolean));
  const uniqueTeachers = uniqueTextValues(normalizedSlots.map((slot) => slot.teacher));
  const uniqueClassrooms = uniqueTextValues(normalizedSlots.map((slot) => slot.classroom));
  const hasSharedScheduleDetails = uniqueTeachers.length <= 1 && uniqueClassrooms.length <= 1;

  const schedule = normalizedSlots.filter((slot) => slot.day || slot.startTime || slot.endTime).map((slot) => {
    const timeRange = slot.startTime && slot.endTime
      ? `${slot.startTime}-${slot.endTime}`
      : [slot.startTime, slot.endTime].filter(Boolean).join("-");
    const summary = [slot.day, timeRange].filter(Boolean).join(" ");
    const details = hasSharedScheduleDetails ? "" : [slot.teacher, slot.classroom].filter(Boolean).join(", ");
    return [summary, details ? `(${details})` : ""].filter(Boolean).join(" ").trim();
  }).join("\n");
  const teacher = uniqueTeachers.join(", ");
  const classroom = uniqueClassrooms.length <= 1
    ? uniqueClassrooms[0] || ""
    : normalizedSlots
        .filter((slot) => slot.classroom)
        .map((slot) => slot.day ? `${slot.classroom}(${slot.day})` : slot.classroom)
        .join(", ");

  return { schedule, teacher, classroom };
}

export function formatClassScheduleDisplayLines(scheduleValue: unknown) {
  const schedule = text(scheduleValue);
  if (!schedule) return [];

  const matches = [...schedule.matchAll(DAY_GROUP_PATTERN)];
  if (matches.length === 0) {
    return schedule.split(/\n+/).map(text).filter(Boolean);
  }

  let cursor = 0;
  for (const match of matches) {
    const matchIndex = match.index ?? cursor;
    const separator = schedule.slice(cursor, matchIndex);
    if (separator.replace(/[\s,，;·/]+/g, "")) {
      return schedule.split(/\n+/).map(text).filter(Boolean);
    }
    cursor = matchIndex + match[0].length;
  }
  if (schedule.slice(cursor).replace(/[\s,，;·/]+/g, "")) {
    return schedule.split(/\n+/).map(text).filter(Boolean);
  }

  const groups = new Map<string, { days: string[]; startTime: string; endTime: string; detail: string }>();
  for (const match of matches) {
    const startTime = text(match[2]);
    const endTime = text(match[3]);
    const detail = text(match[4]).replace(/\s+/g, " ");
    const key = `${startTime}|${endTime}|${detail}`;
    const group = groups.get(key) || { days: [], startTime, endTime, detail };
    for (const day of [...text(match[1])].filter((value) => CLASS_SCHEDULE_DAY_SET.has(value))) {
      if (!group.days.includes(day)) group.days.push(day);
    }
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const summary = `${group.days.join("")} ${group.startTime}-${group.endTime}`.trim();
    return group.detail ? `${summary} (${group.detail})` : summary;
  });
}

export function splitClassResourceDisplayValues(value: unknown) {
  return text(value)
    .split(/[,，/]+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function normalizeDetailToken(value: unknown) {
  return text(value).replace(/\s+/g, "").toLowerCase();
}

export function stripSharedScheduleDetails(
  scheduleValue: unknown,
  teacherValue: unknown,
  classroomValue: unknown,
) {
  const schedule = text(scheduleValue);
  const detailGroups = [...schedule.matchAll(/\(([^)]*)\)/g)]
    .map((match) => text(match[1]).split(/[,，/]+/).map(normalizeDetailToken).filter(Boolean));
  if (detailGroups.length === 0) return schedule;

  const teachers = uniqueTextValues(splitOptionValues(teacherValue).map(normalizeDetailToken));
  const classrooms = uniqueTextValues(splitOptionValues(classroomValue).map(normalizeDetailToken));
  const allowedDetails = new Set([...teachers, ...classrooms]);
  const signatures = uniqueTextValues(detailGroups.map((group) => group.join("|")));
  const isSharedDetail = signatures.length === 1
    && teachers.length <= 1
    && classrooms.length <= 1
    && detailGroups[0].length > 0
    && detailGroups[0].every((detail) => allowedDetails.has(detail));

  return isSharedDetail
    ? schedule.replace(/[ \t]*\([^)]*\)/g, "").replace(/[ \t]+\n/g, "\n").trim()
    : schedule;
}
