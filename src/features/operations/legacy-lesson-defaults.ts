import { parseClassScheduleSlots } from '../management/class-schedule-slots.ts';

type Plan = Record<string, unknown>;
type Row = Record<string, unknown>;
type Details = { startTime: string; endTime: string; teacherCatalogId: string; classroomCatalogId: string };
type LegacyLessonDefaults = {
  schedule: string;
  teacher: string;
  room: string;
  teacherCatalogs: unknown[];
  classroomCatalogs: unknown[];
};

const occupancyFields = ['startTime', 'endTime', 'teacherCatalogId', 'classroomCatalogId', 'teacherName', 'classroomName'];
const hasOwn = (value: Row, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const hasWireOverride = (value: Row) => occupancyFields.some(field => hasOwn(value, field) && value[field] !== undefined);
const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
const scheduleGroups = /([월화수목금토일]+)\s*(\d{1,2}:\d{2})\s*[-~–]\s*(\d{1,2}:\d{2})(?:\s*\(([^)]*)\))?/g;
const text = (value: unknown) => String(value ?? '').trim();
const record = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter(item => item !== null && typeof item === 'object' && !Array.isArray(item)) : [];
const identity = (row: Row) => text(row.id) || text(row.sessionKey) || text(row.session_key);
const rowDate = (row: Row) => text(row.date || row.session_date);
const emptyDetails = (): Details => ({ startTime: '', endTime: '', teacherCatalogId: '', classroomCatalogId: '' });

function weekday(date: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return undefined;
  return dayNames[parsed.getUTCDay()];
}

function time(value: string): string {
  const padded = /^\d:\d{2}$/.test(value) ? `0${value}` : value;
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(padded) ? padded : '';
}

// A shared resource or an explicit weekday tag is evidence. The management
// parser's positional fallback for multiple resources is not such evidence.
function resourceForDay(raw: string, day: string): string {
  const options = text(raw).split(/[,，/]+/).map(text).filter(Boolean);
  const tagged = options.map(option => option.match(/^(.+?)\s*\(([월화수목금토일]+)\)$/));
  const matches = tagged.filter(match => match && match[2].includes(day));
  if (matches.length === 1) return text(matches[0]?.[1]);
  if (matches.length > 1 || tagged.some(Boolean)) return '';
  return options.length === 1 && !/[()]/.test(options[0]) ? options[0] : '';
}

function catalogId(catalogs: unknown[], name: string): string {
  if (!name) return '';
  const visible = rows(catalogs).filter(row => row.isVisible !== false && row.is_visible !== false);
  const normalizedName = name.replace(/\s+/g, '');
  const matches = visible.filter(row => text(row.name).replace(/\s+/g, '') === normalizedName);
  const id = matches.length === 1 ? text(matches[0].id) : '';
  return id && visible.filter(row => text(row.id) === id).length === 1 ? id : '';
}

function weekdayDefaults(defaults: LegacyLessonDefaults): Map<string, Details | null> {
  const result = new Map<string, Details | null>();
  const matches = [...text(defaults.schedule).matchAll(scheduleGroups)];
  // Reject a partly parsed schedule instead of silently ignoring another slot.
  if (text(defaults.schedule).replace(scheduleGroups, '').replace(/[\s,，;·/]+/g, '')) return result;
  for (const match of matches) {
    const slots = parseClassScheduleSlots(match[0], '', '');
    const hasPair = /[,，/]/.test(match[4] ?? '');
    const emptyExplicitDetail = match[4] !== undefined && !text(match[4]);
    for (const slot of slots) {
      if (result.has(slot.day)) { result.set(slot.day, null); continue; }
      const startTime = time(slot.startTime), endTime = time(slot.endTime);
      const teacherName = slot.teacher || (!hasPair && !emptyExplicitDetail ? resourceForDay(defaults.teacher, slot.day) : '');
      const classroomName = slot.classroom || (!hasPair && !emptyExplicitDetail ? resourceForDay(defaults.room, slot.day) : '');
      const teacherCatalogId = catalogId(defaults.teacherCatalogs, teacherName);
      const classroomCatalogId = catalogId(defaults.classroomCatalogs, classroomName);
      result.set(slot.day, startTime && endTime && startTime < endTime && teacherCatalogId && classroomCatalogId
        ? { startTime, endTime, teacherCatalogId, classroomCatalogId } : null);
    }
  }
  return result;
}

// Called only after an operator generates a draft. This is a creation-time
// snapshot, never a reader that infers historical resources from today's class.
export function snapshotNewLegacyLessonDetails(
  plan: Plan,
  previousPlan: Plan,
  defaults: LegacyLessonDefaults,
): Plan {
  const previous = rows(previousPlan.sessions), sessions = rows(plan.sessions);
  const previousIds = new Set(previous.map(identity).filter(Boolean));
  const previousDates = new Set(previous.map(rowDate).filter(Boolean));
  const dateCounts = new Map<string, number>();
  sessions.forEach(row => dateCounts.set(rowDate(row), (dateCounts.get(rowDate(row)) || 0) + 1));
  const byDay = weekdayDefaults(defaults);
  const explicitSchedules = record(plan.sessionSchedules);
  const sessionSchedules = { ...explicitSchedules };
  let changed = false;
  const nextSessions = sessions.map(row => {
    const date = rowDate(row);
    const state = text(row.scheduleState) || text(row.state) || 'active';
    if (previousIds.has(identity(row)) || previousDates.has(date) || state !== 'active' || row.isForced || row.originalDate) return row;
    if (hasWireOverride(row) || hasWireOverride(record(explicitSchedules[date]))) return row;
    const uniqueDate = dateCounts.get(date) === 1;
    const day = weekday(date);
    const details = (uniqueDate && day && byDay.get(day)) || emptyDetails();
    changed = true;
    if (uniqueDate && day) sessionSchedules[date] = { ...record(explicitSchedules[date]), ...details };
    return { ...row, ...details };
  });
  return changed ? { ...plan, sessions: nextSessions, sessionSchedules } : plan;
}
