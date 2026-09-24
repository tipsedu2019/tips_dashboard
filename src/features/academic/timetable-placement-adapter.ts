import type { DropTarget, GridTarget, PlanSlot, ShadowSlot, TimetableView } from "./timetable-plan-contract.ts";
import { assertWeekday } from "./timetable-plan-model.ts";

export type ProjectedTimetableSlot = {
  id: string;
  panelKey: string;
  columnKey: string;
  startMinute: number;
  endMinute: number;
};

export function projectTimetableSlot(slot: PlanSlot | ShadowSlot, view: TimetableView): ProjectedTimetableSlot {
  const weekly = view === "teacher-weekly" || view === "classroom-weekly";
  const teacher = view === "teacher-weekly" || view === "daily-teacher";
  const resourceId = teacher ? slot.teacherId : slot.classroomId;
  const weekdayKey = String(slot.weekday);
  return {
    id: slot.id,
    panelKey: weekly ? resourceId : weekdayKey,
    columnKey: weekly ? weekdayKey : resourceId,
    startMinute: slot.startMinute,
    endMinute: slot.endMinute,
  };
}

function gridCoordinates(input: GridTarget): { weekday: number; resourceId: string; rawMinute: number } {
  const weekly = input.view === "teacher-weekly" || input.view === "classroom-weekly";
  const weekdayKey = weekly ? input.columnKey : input.panelKey;
  if (!/^[0-6]$/.test(weekdayKey)) {
    throw new RangeError("grid weekday key must be 0 through 6");
  }
  const weekday = Number(weekdayKey);
  assertWeekday(weekday);
  const resourceId = weekly ? input.panelKey : input.columnKey;
  if (!resourceId) {
    throw new RangeError("grid resource key must not be empty");
  }
  if (!Number.isInteger(input.visibleStartMinute) || input.visibleStartMinute < 0
    || input.visibleStartMinute > 1440 || !Number.isFinite(input.rowPosition)
    || input.rowPosition < 0 || !Number.isFinite(input.slotMinutes)
    || input.slotMinutes <= 0) {
    throw new RangeError("invalid grid coordinate");
  }
  const rawMinute = input.visibleStartMinute + input.rowPosition * input.slotMinutes;
  if (!Number.isFinite(rawMinute) || rawMinute < 0 || rawMinute > 1440) {
    throw new RangeError("grid coordinate falls outside one day");
  }
  return { weekday, resourceId, rawMinute };
}

function targetResource(view: TimetableView, resourceId: string): Pick<DropTarget, "teacherId" | "classroomId"> {
  return view === "teacher-weekly" || view === "daily-teacher"
    ? { teacherId: resourceId }
    : { classroomId: resourceId };
}

export function resolveGridTarget(input: GridTarget): DropTarget {
  const { weekday, resourceId, rawMinute } = gridCoordinates(input);
  const startMinute = Math.round(rawMinute / 5) * 5;
  if (startMinute >= 1440) {
    throw new RangeError("a placement must start before midnight");
  }
  return { weekday, startMinute, ...targetResource(input.view, resourceId) };
}

export function resolveMovedGridTarget(slot: PlanSlot, origin: GridTarget, target: GridTarget): DropTarget {
  const originPosition = gridCoordinates(origin);
  const targetPosition = gridCoordinates(target);
  const minuteDelta = Math.round((targetPosition.rawMinute - originPosition.rawMinute) / 5) * 5;
  const startMinute = slot.startMinute + minuteDelta;
  if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute >= 1440) {
    throw new RangeError("moved slot starts outside one day");
  }
  return { weekday: targetPosition.weekday, startMinute,
    ...targetResource(target.view, targetPosition.resourceId) };
}
