import {
  normalizeTimetableClassroomName,
  parseAcademicSchedule,
  splitClassroomList,
} from "../academic/records.js";
import {
  buildSchedulePlanForSave,
  deriveSelectedDaysFromSchedule,
  parseDateValue,
} from "../../lib/class-schedule-planner.js";

export const MAKEUP_REQUEST_STATUSES = [
  "approval_pending",
  "revision_requested",
  "rejected",
  "manager_pending",
  "completed",
  "canceled",
];

export const MAKEUP_REQUEST_STATUS_LABELS = {
  approval_pending: "결재자 승인 대기",
  revision_requested: "보완 요청",
  rejected: "반려",
  manager_pending: "관리팀 전달",
  completed: "처리 완료",
  canceled: "취소",
};

export const ACTIVE_ROOM_RESERVATION_STATUSES = new Set([
  "approval_pending",
  "manager_pending",
  "completed",
]);

export const APPROVER_NAMES_BY_GROUP = {
  math_middle: ["강정은"],
  math_high: ["양소윤"],
  english: ["강부희", "김민경", "정보영"],
  unknown: [],
};

export const MAKEUP_CALENDAR_NOTE_MARKER = "[[TIPS_MAKEUP]]";

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function text(value) {
  return String(value || "").trim();
}

function firstValue(...values) {
  return values.map(text).find(Boolean) || "";
}

function toDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }

  const raw = text(value);
  if (!raw) {
    return null;
  }

  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function toDateKey(value) {
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) {
    return match[1];
  }

  const date = toDate(value);
  if (!date) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toTimeLabel(value) {
  const date = toDate(value);
  if (!date) {
    const match = text(value).match(/\b(\d{1,2}:\d{2})\b/);
    return match ? match[1].padStart(5, "0") : "";
  }

  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function toDateTimeLabel(value) {
  const dateKey = toDateKey(value);
  const time = toTimeLabel(value);
  return [dateKey, time].filter(Boolean).join(" ");
}

function minutesFromTimeLabel(value) {
  const [hour, minute] = text(value).split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return 0;
  }

  return hour * 60 + minute;
}

function minutesFromDateTime(value) {
  const date = toDate(value);
  if (date) {
    return date.getHours() * 60 + date.getMinutes();
  }

  return minutesFromTimeLabel(toTimeLabel(value));
}

function dayLabelFromDate(value) {
  const date = toDate(value);
  return date ? DAY_LABELS[date.getDay()] : "";
}

function normalizeSubject(value) {
  const raw = text(value);
  if (raw.includes("영")) {
    return "영어";
  }
  if (raw.includes("수")) {
    return "수학";
  }
  return raw;
}

function normalizeApprovalGroup(value) {
  const group = text(value);
  return Object.prototype.hasOwnProperty.call(APPROVER_NAMES_BY_GROUP, group)
    ? group
    : "unknown";
}

export function resolveMakeupApprovalGroup(classRecord = {}) {
  const subject = normalizeSubject(
    firstValue(classRecord.subject, classRecord.subjectName, classRecord.subject_name),
  );
  const gradeHint = firstValue(
    classRecord.grade,
    classRecord.gradeName,
    classRecord.grade_name,
    classRecord.name,
    classRecord.className,
    classRecord.class_name,
  );

  if (subject === "영어") {
    return "english";
  }

  if (subject === "수학") {
    if (/고|high/i.test(gradeHint)) {
      return "math_high";
    }

    if (/초|elementary|중|middle/i.test(gradeHint)) {
      return "math_middle";
    }
  }

  return "unknown";
}

export function getAllowedApproverNames(classRecordOrGroup = {}) {
  const group =
    typeof classRecordOrGroup === "string"
      ? normalizeApprovalGroup(classRecordOrGroup)
      : resolveMakeupApprovalGroup(classRecordOrGroup);
  return [...(APPROVER_NAMES_BY_GROUP[group] || [])];
}

export function canTransitionMakeupRequest(status, nextStatus, context = {}) {
  const current = text(status);
  const next = text(nextStatus);
  const isRequester = context.isRequester === true;
  const isApprover = context.isApprover === true;
  const isManager = context.isManager === true;

  if (!MAKEUP_REQUEST_STATUSES.includes(current) || !MAKEUP_REQUEST_STATUSES.includes(next)) {
    return false;
  }

  if (current === "approval_pending") {
    return (
      (next === "manager_pending" && isApprover) ||
      (next === "revision_requested" && isApprover) ||
      (next === "rejected" && isApprover) ||
      (next === "canceled" && (isRequester || isManager))
    );
  }

  if (current === "revision_requested") {
    return (
      (next === "approval_pending" && isRequester) ||
      (next === "canceled" && (isRequester || isManager))
    );
  }

  if (current === "manager_pending") {
    return (
      (next === "completed" && isManager) ||
      (next === "revision_requested" && isManager) ||
      (next === "rejected" && isManager) ||
      (next === "canceled" && isManager)
    );
  }

  if (current === "completed") {
    return next === "canceled" && isManager;
  }

  return false;
}

export function timeRangesOverlap(startA, endA, startB, endB) {
  const leftStart = toDate(startA)?.getTime();
  const leftEnd = toDate(endA)?.getTime();
  const rightStart = toDate(startB)?.getTime();
  const rightEnd = toDate(endB)?.getTime();

  if (![leftStart, leftEnd, rightStart, rightEnd].every(Number.isFinite)) {
    return false;
  }

  return leftStart < rightEnd && rightStart < leftEnd;
}

function timeMinuteRangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function normalizeRoomName(value) {
  return normalizeTimetableClassroomName(text(value));
}

function getClassDisplayName(classItem = {}) {
  return firstValue(classItem.name, classItem.className, classItem.class_name, classItem.title, classItem.id);
}

function getRequestDisplayName(request = {}) {
  return firstValue(request.className, request.class_name, request.title, request.id);
}

function getRequestStatus(request = {}) {
  return firstValue(request.status);
}

function getRequestStartAt(request = {}) {
  return firstValue(request.makeupStartAt, request.makeup_start_at);
}

function getRequestEndAt(request = {}) {
  return firstValue(request.makeupEndAt, request.makeup_end_at);
}

function getRequestClassroom(request = {}) {
  return firstValue(request.makeupClassroom, request.makeup_classroom);
}

function readMakeupSlots(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function buildZonedDateTime(date, time) {
  const dateKey = toDateKey(date);
  const timeValue = text(time);
  if (!dateKey || !/^\d{1,2}:\d{2}$/.test(timeValue)) {
    return "";
  }
  return `${dateKey}T${timeValue.padStart(5, "0")}:00+09:00`;
}

export function normalizeMakeupSlots(source = {}, fallbackClassroom = "") {
  const rawSlots = readMakeupSlots(
    source.makeupSlots || source.makeup_slots || source.slots,
  );
  const slots = rawSlots
    .map((slot, index) => {
      const startAt = firstValue(
        slot?.startAt,
        slot?.start_at,
        buildZonedDateTime(slot?.date, slot?.startTime || slot?.start_time),
      );
      const endAt = firstValue(
        slot?.endAt,
        slot?.end_at,
        buildZonedDateTime(slot?.date, slot?.endTime || slot?.end_time),
      );
      const classroom = firstValue(slot?.classroom, fallbackClassroom);
      if (!startAt || !endAt) {
        return null;
      }
      return {
        id: firstValue(slot?.id, `slot-${index + 1}`),
        startAt,
        endAt,
        classroom,
      };
    })
    .filter(Boolean);

  if (slots.length > 0) {
    return slots;
  }

  const startAt = getRequestStartAt(source);
  const endAt = getRequestEndAt(source);
  if (!startAt || !endAt) {
    return [];
  }

  return [{
    id: "slot-1",
    startAt,
    endAt,
    classroom: firstValue(fallbackClassroom, getRequestClassroom(source)),
  }];
}

function addRoom(rooms, value) {
  const room = normalizeRoomName(value);
  if (room) {
    rooms.set(room, room);
  }
}

function addRoomName(roomNames, value) {
  const room = normalizeRoomName(value);
  if (room && !roomNames.includes(room)) {
    roomNames.push(room);
  }
}

function subjectMatches(value, subject) {
  const target = text(subject);
  if (!target) {
    return true;
  }
  const values = Array.isArray(value)
    ? value
    : text(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  if (values.length === 0) {
    return true;
  }
  return values.some((item) => text(item) === target);
}

export function buildRoomOptions(classrooms = [], classes = [], options = {}) {
  const subject = text(options.subject);
  const rooms = new Map();

  for (const room of classrooms || []) {
    if (typeof room === "string") {
      addRoom(rooms, room);
    } else {
      if (!subjectMatches(room?.subjects || room?.subject, subject)) {
        continue;
      }
      addRoom(rooms, room?.name || room?.label || room?.room);
    }
  }

  for (const classItem of classes || []) {
    if (subject && text(classItem?.subject) !== subject) {
      continue;
    }
    for (const room of splitClassroomList(classItem?.classroom || classItem?.room || "")) {
      addRoom(rooms, room);
    }
    for (const slot of parseAcademicSchedule(classItem?.schedule, classItem)) {
      addRoom(rooms, slot.classroom);
    }
  }

  return [...rooms.values()];
}

function buildRegularClassCollisions(classes, targetSlots) {
  const collisions = [];

  for (const targetSlot of targetSlots) {
    const targetDay = dayLabelFromDate(targetSlot.startAt);
    const targetStart = minutesFromDateTime(targetSlot.startAt);
    const targetEnd = minutesFromDateTime(targetSlot.endAt);

    for (const classItem of classes || []) {
      for (const slot of parseAcademicSchedule(classItem?.schedule, classItem)) {
        const classroom = normalizeRoomName(slot.classroom);
        if (!classroom || slot.day !== targetDay) {
          continue;
        }

        if (!timeMinuteRangesOverlap(targetStart, targetEnd, minutesFromTimeLabel(slot.start), minutesFromTimeLabel(slot.end))) {
          continue;
        }

        collisions.push({
          id: text(classItem?.id),
          source: "regular_class",
          title: getClassDisplayName(classItem),
          classroom,
          startLabel: slot.start,
          endLabel: slot.end,
          detail: `${slot.day} ${slot.start}-${slot.end}`,
        });
      }
    }
  }

  return collisions;
}

function buildMakeupRequestCollisions(requests, targetSlots, currentRequestId) {
  const collisions = [];

  for (const request of requests || []) {
    const id = text(request?.id);
    if (id && id === text(currentRequestId)) {
      continue;
    }
    if (!ACTIVE_ROOM_RESERVATION_STATUSES.has(getRequestStatus(request))) {
      continue;
    }

    for (const requestSlot of normalizeMakeupSlots(request, getRequestClassroom(request))) {
      const classroom = normalizeRoomName(requestSlot.classroom);
      if (!classroom) {
        continue;
      }

      const overlapsTargetSlot = targetSlots.some((targetSlot) =>
        timeRangesOverlap(targetSlot.startAt, targetSlot.endAt, requestSlot.startAt, requestSlot.endAt),
      );
      if (!overlapsTargetSlot) {
        continue;
      }

      collisions.push({
        id,
        source: "makeup_request",
        title: getRequestDisplayName(request),
        classroom,
        startAt: requestSlot.startAt,
        endAt: requestSlot.endAt,
        detail: `${toDateTimeLabel(requestSlot.startAt)}-${toTimeLabel(requestSlot.endAt)}`,
      });
    }
  }

  return collisions;
}

export function extractMakeupCalendarMeta(note) {
  const raw = text(note);
  const markerIndex = raw.indexOf(MAKEUP_CALENDAR_NOTE_MARKER);
  if (markerIndex < 0) {
    return null;
  }

  const jsonText = raw.slice(markerIndex + MAKEUP_CALENDAR_NOTE_MARKER.length).trim();
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function buildAcademicEventCollisions(academicEvents, targetSlots, currentRequestId) {
  const collisions = [];

  for (const event of academicEvents || []) {
    const meta = extractMakeupCalendarMeta(event?.note);
    if (!meta || meta.kind !== "makeup") {
      continue;
    }
    if (text(meta.requestId) && text(meta.requestId) === text(currentRequestId)) {
      continue;
    }

    const classroom = normalizeRoomName(meta.classroom);
    const eventStartAt = firstValue(meta.startAt, event?.start_at);
    const eventEndAt = firstValue(meta.endAt, event?.end_at);
    const overlapsTargetSlot = targetSlots.some((targetSlot) =>
      timeRangesOverlap(targetSlot.startAt, targetSlot.endAt, eventStartAt, eventEndAt),
    );
    if (!classroom || !overlapsTargetSlot) {
      continue;
    }

    collisions.push({
      id: text(event?.id),
      source: "academic_event",
      title: firstValue(event?.title, "캘린더 일정"),
      classroom,
      startAt: eventStartAt,
      endAt: eventEndAt,
      detail: `${toDateTimeLabel(eventStartAt)}-${toTimeLabel(eventEndAt)}`,
    });
  }

  return collisions;
}

export function buildRoomAvailability({
  classrooms = [],
  classes = [],
  requests = [],
  academicEvents = [],
  startAt = "",
  endAt = "",
  slots = [],
  currentRequestId = "",
  subject = "",
} = {}) {
  const selectedSubject = text(subject);
  const roomNames = buildRoomOptions(classrooms, classes, { subject: selectedSubject });
  const targetSlots = normalizeMakeupSlots({ makeupSlots: slots, makeupStartAt: startAt, makeupEndAt: endAt });
  for (const slot of targetSlots) {
    addRoomName(roomNames, slot.classroom);
  }
  const collisions = [
    ...buildRegularClassCollisions(classes, targetSlots),
    ...buildMakeupRequestCollisions(requests, targetSlots, currentRequestId),
    ...buildAcademicEventCollisions(academicEvents, targetSlots, currentRequestId),
  ];
  const collisionsByRoom = new Map();

  for (const collision of collisions) {
    const room = normalizeRoomName(collision.classroom);
    if (!room) {
      continue;
    }
    if (!collisionsByRoom.has(room)) {
      collisionsByRoom.set(room, []);
    }
    collisionsByRoom.get(room).push(collision);
    if (!selectedSubject && !roomNames.includes(room)) {
      roomNames.push(room);
    }
  }

  return roomNames
    .map((name) => {
      const roomCollisions = collisionsByRoom.get(name) || [];
      return {
        name,
        available: roomCollisions.length === 0,
        collisions: roomCollisions,
      };
    });
}

export function getDefaultMakeupEndAt(startAt, classItem = {}) {
  const start = toDate(startAt);
  if (!start) {
    return "";
  }

  const firstSlot = parseAcademicSchedule(classItem?.schedule, classItem)[0];
  const durationMinutes = firstSlot
    ? Math.max(minutesFromTimeLabel(firstSlot.end) - minutesFromTimeLabel(firstSlot.start), 30)
    : 120;
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const offset = -end.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
  const dateKey = toDateKey(end);
  const time = toTimeLabel(end);

  return `${dateKey}T${time}:00${sign}${hours}:${minutes}`;
}

function buildSchedulePlanDefaults(rawPlan = {}, classRecord = {}) {
  return {
    subject: firstValue(classRecord.subject, rawPlan.subject),
    className: firstValue(classRecord.name, classRecord.className, classRecord.class_name, rawPlan.className),
    schedule: firstValue(classRecord.schedule, rawPlan.schedule),
    selectedDays: Array.isArray(rawPlan.selectedDays)
      ? rawPlan.selectedDays
      : deriveSelectedDaysFromSchedule(firstValue(classRecord.schedule, rawPlan.schedule)),
    textbookIds: Array.isArray(classRecord.textbookIds)
      ? classRecord.textbookIds
      : Array.isArray(classRecord.textbook_ids)
        ? classRecord.textbook_ids
        : [],
    textbooks: Array.isArray(classRecord.textbooks) ? classRecord.textbooks : [],
  };
}

export function applyMakeupRequestToSchedulePlan(rawPlan = {}, classRecord = {}, request = {}) {
  const cancelDate = firstValue(request.cancelDate, request.cancel_date);
  const reason = firstValue(request.reason);
  const classroom = firstValue(request.makeupClassroom, request.makeup_classroom);
  const makeupSlots = normalizeMakeupSlots(request, classroom);
  const makeupDate = toDateKey(makeupSlots[0]?.startAt);
  const defaults = buildSchedulePlanDefaults(rawPlan, classRecord);
  const previousState = rawPlan?.sessionStates?.[cancelDate] || {};
  const makeupMemo = makeupSlots
    .map((slot) => {
      const slotClassroom = firstValue(slot.classroom, classroom);
      return `보강 ${toDateTimeLabel(slot.startAt)}-${toTimeLabel(slot.endAt)}${slotClassroom ? ` · ${slotClassroom}` : ""}`;
    })
    .join(" · ");
  const makeupStateEntries = Object.fromEntries(
    [...new Set(makeupSlots.map((slot) => toDateKey(slot.startAt)).filter(Boolean))]
      .map((slotDate) => {
        const slotRooms = [...new Set(
          makeupSlots
            .filter((slot) => toDateKey(slot.startAt) === slotDate)
            .map((slot) => firstValue(slot.classroom, classroom))
            .filter(Boolean),
        )];
        return [
          slotDate,
          {
            ...(rawPlan?.sessionStates?.[slotDate] || {}),
            state: "makeup",
            memo: [
              `보강: ${firstValue(request.className, request.class_name, defaults.className)}`,
              slotRooms.join(", "),
            ].filter(Boolean).join(" · "),
          },
        ];
      }),
  );
  const nextPlan = {
    ...rawPlan,
    subject: firstValue(rawPlan.subject, defaults.subject),
    className: firstValue(rawPlan.className, defaults.className),
    selectedDays: Array.isArray(rawPlan.selectedDays) && rawPlan.selectedDays.length > 0
      ? rawPlan.selectedDays
      : defaults.selectedDays,
    sessionStates: {
      ...(rawPlan?.sessionStates || {}),
      [cancelDate]: {
        ...previousState,
        state: "exception",
        memo: reason ? `휴강: ${reason}` : firstValue(previousState.memo, "휴강"),
        makeupMemo,
        makeupDate,
      },
      ...makeupStateEntries,
    },
  };

  if (!parseDateValue(cancelDate) || !parseDateValue(makeupDate)) {
    return buildSchedulePlanForSave(rawPlan || {}, defaults);
  }

  return buildSchedulePlanForSave(nextPlan, defaults);
}

function buildMakeupCalendarNote(meta, reason) {
  const body = [
    reason ? `사유: ${reason}` : "",
    `${MAKEUP_CALENDAR_NOTE_MARKER} ${JSON.stringify(meta)}`,
  ].filter(Boolean);
  return body.join("\n");
}

export function buildMakeupCalendarDrafts(request = {}) {
  const requestId = text(request.id);
  const className = firstValue(request.className, request.class_name, request.title);
  const subject = firstValue(request.subject);
  const reason = firstValue(request.reason);
  const classroom = firstValue(request.makeupClassroom, request.makeup_classroom);
  const cancelDate = firstValue(request.cancelDate, request.cancel_date);
  const makeupStartAt = firstValue(request.makeupStartAt, request.makeup_start_at);
  const makeupEndAt = firstValue(request.makeupEndAt, request.makeup_end_at);
  const makeupSlots = normalizeMakeupSlots(request, classroom);
  const cancelEventId = firstValue(request.cancelAcademicEventId, request.cancel_academic_event_id);
  const makeupEventId = firstValue(request.makeupAcademicEventId, request.makeup_academic_event_id);
  const makeupEventIds = readMakeupSlots(request.makeupAcademicEventIds || request.makeup_academic_event_ids);

  return [
    {
      id: cancelEventId,
      title: `[휴강] ${className}`,
      type: "팁스",
      start: cancelDate,
      end: cancelDate,
      grade: "all",
      category: "all",
      note: buildMakeupCalendarNote({
        kind: "cancel",
        requestId,
        className,
        subject,
        cancelDate,
        reason,
      }, reason),
    },
    ...makeupSlots.map((slot, index) => {
      const slotClassroom = firstValue(slot.classroom, classroom);
      return {
        id: firstValue(makeupEventIds[index], index === 0 ? makeupEventId : ""),
        title: `[보강] ${className}${slotClassroom ? ` · ${slotClassroom}` : ""}`,
        type: "팁스",
        start: toDateKey(slot.startAt),
        end: toDateKey(slot.startAt),
        grade: "all",
        category: "all",
        note: buildMakeupCalendarNote({
          kind: "makeup",
          requestId,
          className,
          subject,
          classroom: slotClassroom,
          startAt: firstValue(slot.startAt, makeupStartAt),
          endAt: firstValue(slot.endAt, makeupEndAt),
          slotIndex: index,
          reason,
        }, reason),
      };
    }),
  ];
}
