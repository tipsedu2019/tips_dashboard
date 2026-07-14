import test from "node:test";
import assert from "node:assert/strict";

import {
  formatClassScheduleDisplayLines,
  formatClassScheduleSlots,
  parseClassScheduleSlots,
  splitClassResourceDisplayValues,
  stripSharedScheduleDetails,
} from "../src/features/management/class-schedule-slots.ts";

test("compact weekday groups expand without losing days", () => {
  const slots = parseClassScheduleSlots("화목 17:00-19:00", "권용재", "별관 2강");

  assert.deepEqual(
    slots.map(({ day, startTime, endTime }) => ({ day, startTime, endTime })),
    [
      { day: "화", startTime: "17:00", endTime: "19:00" },
      { day: "목", startTime: "17:00", endTime: "19:00" },
    ],
  );
  assert.deepEqual(slots.map(({ teacher, classroom }) => ({ teacher, classroom })), [
    { teacher: "권용재", classroom: "별관 2강" },
    { teacher: "권용재", classroom: "별관 2강" },
  ]);
});

test("three-day groups preserve weekday order", () => {
  assert.deepEqual(
    parseClassScheduleSlots("월수금 19:10-21:10", "강부희", "본관 4강").map((slot) => slot.day),
    ["월", "수", "금"],
  );
});

test("mixed compact and single-day schedules preserve every slot", () => {
  const slots = parseClassScheduleSlots(
    "화목 17:00-19:00\n토 12:30-14:00",
    "권용재",
    "별관 2강",
  );

  assert.deepEqual(slots.map((slot) => slot.day), ["화", "목", "토"]);
  assert.equal(formatClassScheduleSlots(slots).schedule, "화 17:00-19:00\n목 17:00-19:00\n토 12:30-14:00");
});

test("class list display combines weekdays that share the same time and details", () => {
  assert.deepEqual(
    formatClassScheduleDisplayLines(
      "화 19:30-21:30\n목 19:30-21:30\n토 15:00-16:30",
    ),
    ["화목 19:30-21:30", "토 15:00-16:30"],
  );
  assert.deepEqual(
    formatClassScheduleDisplayLines(
      "금 21:30-23:00 (양소윤, 별7)\n토 15:30-17:00 (김성은, 본2)",
    ),
    ["금 21:30-23:00 (양소윤, 별7)", "토 15:30-17:00 (김성은, 본2)"],
  );
});

test("class resource display splits multiple teachers and classrooms into rows", () => {
  assert.deepEqual(splitClassResourceDisplayValues("양소윤, 김성은"), ["양소윤", "김성은"]);
  assert.deepEqual(
    splitClassResourceDisplayValues("별관 7강(금), 본관 2강(토)"),
    ["별관 7강(금)", "본관 2강(토)"],
  );
});

test("parenthesized slot details are copied to every day in a group", () => {
  const slots = parseClassScheduleSlots(
    "화목 17:00-19:00 (정보영, 본관 7강)",
    "",
    "",
  );

  assert.deepEqual(slots.map(({ day, teacher, classroom }) => ({ day, teacher, classroom })), [
    { day: "화", teacher: "정보영", classroom: "본관 7강" },
    { day: "목", teacher: "정보영", classroom: "본관 7강" },
  ]);
});

test("shared candidate details are removed but different details stay", () => {
  assert.equal(
    stripSharedScheduleDetails(
      "월 19:20-21:20 (정보영, 본관 7강)\n수 19:20-21:20 (정보영, 본관 7강)",
      "정보영",
      "본관 7강",
    ),
    "월 19:20-21:20\n수 19:20-21:20",
  );
  assert.equal(
    stripSharedScheduleDetails(
      "금 21:30-23:00 (양소윤, 별7)\n토 15:30-17:00 (김성은, 본2)",
      "양소윤, 김성은",
      "별관 7강(금),본관 2강(토)",
    ),
    "금 21:30-23:00 (양소윤, 별7)\n토 15:30-17:00 (김성은, 본2)",
  );
});
