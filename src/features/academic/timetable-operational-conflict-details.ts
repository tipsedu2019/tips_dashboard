export type TimetableConfirmedConflict = {
  className: string;
  date?: string;
  weekday?: number;
  startMinute: number;
  endMinute: number;
  overlapStartMinute: number;
  overlapEndMinute: number;
  teacherName?: string;
  classroomName?: string;
  sameClass?: boolean;
};

export const TIMETABLE_MISSING_FIELD_LABELS = {
  date: "날짜",
  time: "시간",
  teacher: "선생님",
  classroom: "강의실",
  lesson_identity: "회차",
  schedule: "일정",
} as const;

export type TimetableUnresolvedOccupancy = {
  className?: string;
  date?: string;
  weekday?: number;
  missingFields: (keyof typeof TIMETABLE_MISSING_FIELD_LABELS)[];
};

export type TimetableOperationalConflictDetails = {
  confirmed: TimetableConfirmedConflict[];
  unresolved: TimetableUnresolvedOccupancy[];
  confirmedCount: number;
  unresolvedCount: number;
  truncated: boolean;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function label(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= 512
    ? value.trim() : undefined;
}

function minute(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 1440;
}

function when(value: Record<string, unknown>): { date?: string; weekday?: number } | null {
  if (value.date !== undefined && value.date !== null) {
    if (typeof value.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return null;
    const date = new Date(`${value.date}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.date) return null;
    return { date: value.date };
  }
  if (Number.isInteger(value.weekday) && Number(value.weekday) >= 0 && Number(value.weekday) <= 6) {
    return { weekday: Number(value.weekday) };
  }
  return {};
}

function confirmed(value: unknown): TimetableConfirmedConflict | null {
  const row = record(value);
  if (!row) return null;
  const className = label(row.className), teacherName = label(row.teacherName), classroomName = label(row.classroomName);
  const date = when(row);
  const sameClass = row.sameClass === true;
  if (!className || (!teacherName && !classroomName && !sameClass) || !date || (!date.date && date.weekday === undefined)) return null;
  const { startMinute, endMinute, overlapStartMinute, overlapEndMinute } = row;
  if (!minute(startMinute) || !minute(endMinute) || !minute(overlapStartMinute) || !minute(overlapEndMinute)
    || startMinute >= endMinute || overlapStartMinute >= overlapEndMinute
    || overlapStartMinute < startMinute || overlapEndMinute > endMinute) return null;
  return { className, ...date, startMinute, endMinute, overlapStartMinute, overlapEndMinute,
    ...(teacherName ? { teacherName } : {}), ...(classroomName ? { classroomName } : {}), ...(sameClass ? { sameClass: true } : {}) };
}

function unresolved(value: unknown): TimetableUnresolvedOccupancy | null {
  const row = record(value);
  if (!row) return null;
  const date = when(row);
  if (!date || !Array.isArray(row.missingFields) || !row.missingFields.length
    || row.missingFields.some(field => typeof field !== "string" || !Object.prototype.hasOwnProperty.call(TIMETABLE_MISSING_FIELD_LABELS, field))) return null;
  const className = label(row.className);
  return { ...(className ? { className } : {}), ...date,
    missingFields: [...new Set(row.missingFields)] as TimetableUnresolvedOccupancy["missingFields"] };
}

/** Only the authorized server's versioned conflict DETAIL is display evidence. */
export function parseTimetableOperationalConflictDetails(error: unknown): TimetableOperationalConflictDetails | null {
  const failure = record(error);
  if (failure?.code !== "23P01" || failure.message !== "timetable_resource_conflict"
    || typeof failure.details !== "string" || failure.details.length > 65_536) return null;
  try {
    const payload = record(JSON.parse(failure.details));
    if (payload?.version !== 1 || !Array.isArray(payload.confirmed) || !Array.isArray(payload.unresolved)
      || payload.confirmed.length > 50 || payload.unresolved.length > 50) return null;
    const confirmedRows = payload.confirmed.map(confirmed), unresolvedRows = payload.unresolved.map(unresolved);
    if (confirmedRows.some(row => !row) || unresolvedRows.some(row => !row)) return null;
    const { confirmedCount, unresolvedCount } = payload;
    if (!Number.isInteger(confirmedCount) || !Number.isInteger(unresolvedCount)
      || Number(confirmedCount) < confirmedRows.length || Number(unresolvedCount) < unresolvedRows.length
      || Number(confirmedCount) > 1_000_000 || Number(unresolvedCount) > 1_000_000
      || (!confirmedRows.length && confirmedCount !== 0) || (!unresolvedRows.length && unresolvedCount !== 0)
      || Number(confirmedCount) + Number(unresolvedCount) === 0) return null;
    return { confirmed: confirmedRows as TimetableConfirmedConflict[], unresolved: unresolvedRows as TimetableUnresolvedOccupancy[],
      confirmedCount: Number(confirmedCount), unresolvedCount: Number(unresolvedCount),
      truncated: payload.truncated === true || Number(confirmedCount) > confirmedRows.length || Number(unresolvedCount) > unresolvedRows.length };
  } catch {
    return null;
  }
}

export function timetableConflictSummary(details: TimetableOperationalConflictDetails | null): string {
  if (details?.confirmedCount && details.unresolvedCount) return "겹치는 일정과 정보가 부족한 일정이 있어 저장하지 못했습니다. 입력은 유지되었습니다.";
  if (details?.confirmedCount) return "겹치는 일정이 있어 저장하지 못했습니다. 입력은 유지되었습니다.";
  if (details?.unresolvedCount) return "정보가 부족한 일정이 있어 충돌 여부를 확인하지 못했습니다. 입력은 유지되었습니다.";
  return "일정 확인을 통과하지 못해 저장하지 못했습니다. 입력은 유지되었습니다. 일정 정보를 확인해 주세요.";
}
