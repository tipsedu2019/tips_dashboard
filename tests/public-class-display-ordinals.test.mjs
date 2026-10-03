import assert from "node:assert/strict";
import test from "node:test";
import { publicClassSchedule } from "../src/lib/public-class-schedule.js";
import { normalizePublicClassesFullPayload } from "../src/server/public-classes-payload.js";
import { createPublicClassDetailLoader, normalizePublicClassDetail } from "../src/server/public-class-detail.ts";

const CLASS_ID = "b6b5da5a-b000-4b46-bc7a-dabea5b53e12";
const PRIVATE = "PRIVATE_DISPLAY_ORDINAL_CANARY";
const dates = ["01", "06", "08", "13", "15", "20", "22", "27", "29"];
function plan() {
  return {
    version: 2, selectedDays: [2, 4], globalSessionCount: 8,
    history: [{ summary: PRIVATE }], studentIds: [PRIVATE],
    billingPeriods: [{ id: "october", label: "10월", startDate: "2026-10-01", endDate: "2026-10-29", totalSessions: 0, internalState: PRIVATE }],
    textbooks: [{ textbookId: "book", role: "main", privateNote: PRIVATE }],
    sessions: dates.map((day, index) => ({
      id: `stored:${day}:${index === 0 ? "skipped" : index === 8 ? "exception" : "active"}`,
      sessionKey: `stable:${day}`, date: `2026-10-${day}`, billingId: "october",
      state: index === 1 ? "exception" : "active", scheduleState: index === 1 ? "exception" : "active",
      sessionNumber: index < 2 ? null : index - 1, isForced: false,
      startTime: "17:00", endTime: "19:00", teacherName: "가상 선생님", classroomName: "가상 강의실",
      teacherNote: PRIVATE, studentIds: [PRIVATE],
      textbookEntries: [{ textbookId: "book", plan: { label: "공개 범위", teacherNote: PRIVATE }, actual: { status: "done", publicNote: "공개 진도", privateNote: PRIVATE } }],
    })),
  };
}
const numbers = value => value.sessions.map(row => row.displaySessionNumber);
const expected = [1, null, 2, 3, 4, 5, 6, 7, 8];
function payload(schedulePlan, raw = true) {
  return { generatedAt: "2026-10-03T01:00:00.000Z", source: "supabase", textbooks: [], progressLogs: [],
    classes: [{ id: CLASS_ID, name: "가상 수업", status: "수강", student_ids: [PRIVATE], [raw ? "schedule_plan" : "schedulePlan"]: schedulePlan }] };
}
function deepFreeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

test("corrected materialized October displays 1..8 while preserving every raw booking number and identity", () => {
  const saved = plan(), before = structuredClone(saved), result = publicClassSchedule(deepFreeze(saved));
  assert.deepEqual(numbers(result), expected);
  assert.equal(result.sessions[0].sessionNumber, undefined);
  assert.equal(result.sessions[1].sessionNumber, undefined);
  assert.deepEqual(result.sessions.slice(2).map(row => row.sessionNumber), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(`${result.sessions[2].date}:${result.sessions[2].sessionNumber}`, "2026-10-08:1", "registration/progress identity remains stored");
  assert.deepEqual(result.sessions.map(row => [row.id, row.sessionKey, row.date]), saved.sessions.map(row => [row.id, row.sessionKey, row.date]));
  assert.deepEqual(saved, before); assert.equal(result.billingPeriods[0].sessionCount, 8);
});

test("display metadata adds one scalar to the public whitelist without disclosing staff/history/guard fields", () => {
  const result = publicClassSchedule(plan());
  assert.ok(!JSON.stringify(result).includes(PRIVATE));
  assert.deepEqual(Object.keys(result.sessions[0]).sort(), ["billingId", "classroomName", "date", "displaySessionNumber", "endTime", "id", "scheduleState", "sessionKey", "startTime", "teacherName", "textbookEntries"].sort());
  assert.deepEqual(result.sessions[0].textbookEntries, [{ textbookId: "book", plan: { label: "공개 범위" }, actual: { status: "done", publicNote: "공개 진도" } }]);
  assert.ok(!Object.hasOwn(result, "history")); assert.ok(!Object.hasOwn(result.sessions[0], "isForced"));
});

test("an existing in-period linked makeup counts while its canceled source retains explicit null", () => {
  const saved = plan(); saved.sessions[1].makeupDate = "2026-10-07";
  saved.sessions.splice(2, 0, { ...saved.sessions[2], id: "makeup:7", sessionKey: "stable:7", date: "2026-10-07", state: "makeup", scheduleState: "makeup", originalDate: "2026-10-06", sessionNumber: 99, isForced: true });
  const result = publicClassSchedule(saved);
  assert.deepEqual(numbers(result), [1, null, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(result.sessions[2].sessionNumber, 99); assert.equal(result.sessions[2].originalDate, "2026-10-06");
});

test("weekly configuration and period bounds never generate absent public sessions", () => {
  const saved = plan(); saved.sessions = [saved.sessions[0], saved.sessions.at(-1)];
  const result = publicClassSchedule(saved);
  assert.deepEqual(result.sessions.map(row => row.date), ["2026-10-01", "2026-10-29"]);
  assert.deepEqual(numbers(result), [1, 2]); assert.equal(result.sessions.length, 2);
});

test("a row before its explicit period boundary never expands the period or receives a guessed display ordinal", () => {
  const saved = plan(); saved.billingPeriods[0].startDate = "2026-10-02";
  const before = structuredClone(saved), result = publicClassSchedule(saved);
  assert.deepEqual(numbers(result), Array(9).fill(null));
  assert.equal(result.billingPeriods[0].startDate, "2026-10-02");
  assert.equal(result.sessions[0].date, "2026-10-01"); assert.equal(result.sessions[2].sessionNumber, 1);
  assert.deepEqual(saved, before);
});

test("filtering a malformed public row cannot hide ambiguity from the ordinal guard", () => {
  const saved = plan(); saved.sessions.splice(2, 0, null);
  const result = publicClassSchedule(saved);
  assert.equal(result.sessions.length, 9); assert.deepEqual(numbers(result), Array(9).fill(null));
  assert.equal(result.sessions[2].sessionNumber, 1);
});

test("raw source display metadata is ignored and never written back to the saved plan", () => {
  const saved = plan(); saved.sessions.forEach(row => { row.displaySessionNumber = 123; });
  saved.sessions[0].displaySessionNumber = null;
  const before = structuredClone(saved), result = publicClassSchedule(saved);
  assert.deepEqual(numbers(result), expected); assert.deepEqual(saved, before);
});

test("explicit unknown survives repeated cache projection after private ambiguity guards are removed", () => {
  for (const change of [
    saved => { saved.sessions[0].isForced = "false"; },
    saved => { saved.sessions[0].state = "skipped"; },
    saved => { saved.sessions[0].billing_id = "conflicting-period"; },
  ]) {
    const saved = plan(); change(saved);
    const first = publicClassSchedule(saved);
    assert.deepEqual(numbers(first), Array(9).fill(null));
    const second = publicClassSchedule(first, { projected: true });
    assert.deepEqual(second, first);
    assert.deepEqual(publicClassSchedule(second, { projected: true }), first);
  }
});

test("payload normalization distinguishes spoofed raw metadata from an already-public cached unknown", () => {
  const saved = plan(); saved.sessions[0].displaySessionNumber = null;
  const raw = normalizePublicClassesFullPayload(payload(saved));
  assert.deepEqual(numbers(raw.classes[0].schedulePlan), expected, "snake-case DB source always derives afresh");
  saved.sessions[0].isForced = "false";
  const unknown = normalizePublicClassesFullPayload(payload(saved));
  assert.deepEqual(numbers(unknown.classes[0].schedulePlan), Array(9).fill(null));
  assert.deepEqual(normalizePublicClassesFullPayload(unknown), unknown);
  assert.deepEqual(normalizePublicClassesFullPayload(normalizePublicClassesFullPayload(unknown)), unknown);
  assert.ok(!JSON.stringify(unknown).includes(PRIVATE));
});

test("cached positives must exactly match a safely derived current counted ordinal", () => {
  const cached = publicClassSchedule(plan());
  cached.sessions[0].displaySessionNumber = 99;
  cached.sessions[1].displaySessionNumber = 1;
  cached.sessions[2].displaySessionNumber = "2";
  cached.sessions[3].displaySessionNumber = 3.5;
  cached.sessions[4].displaySessionNumber = 0;
  const result = publicClassSchedule(cached, { projected: true });
  assert.deepEqual(numbers(result), [null, null, null, null, null, 5, 6, 7, 8]);
  assert.equal(result.sessions[2].sessionNumber, 1);
  assert.deepEqual(publicClassSchedule(result, { projected: true }), result);
});

test("valid cached public DTOs and selected detail normalization preserve raw numbers and projected labels", () => {
  const first = normalizePublicClassesFullPayload(payload(plan()));
  assert.deepEqual(normalizePublicClassesFullPayload(first), first);
  const detail = normalizePublicClassDetail(first, CLASS_ID, "snapshot");
  assert.ok(detail); assert.deepEqual(numbers(detail.classItem.schedulePlan), expected);
  assert.equal(detail.classItem.schedulePlan.sessions[2].sessionNumber, 1);
  assert.equal(detail.availability, "snapshot");
});

test("old public caches without the additive property derive only from their existing validated rows", () => {
  const old = publicClassSchedule(plan()); old.sessions.forEach(row => { delete row.displaySessionNumber; });
  assert.deepEqual(numbers(publicClassSchedule(old, { projected: true })), expected);
  old.sessions[0].scheduleState = "unknown";
  assert.deepEqual(numbers(publicClassSchedule(old, { projected: true })), Array(9).fill(null));
});

test("a DOM consumer respects explicit null instead of falling back to a stored counted number", () => {
  const displayNumber = row => Object.hasOwn(row, "displaySessionNumber") ? row.displaySessionNumber : row.sessionNumber;
  const saved = plan(); saved.sessions[1].sessionNumber = 42;
  const result = publicClassSchedule(saved);
  assert.equal(displayNumber(result.sessions[1]), null); assert.equal(result.sessions[1].sessionNumber, 42);
  assert.equal(displayNumber(result.sessions[2]), 2); assert.equal(displayNumber({ sessionNumber: 4 }), 4);
});

test("a synthetic detail cache hit retains display values, stored identity and staff-field privacy", async () => {
  const detail = normalizePublicClassDetail(payload(plan()), CLASS_ID, "live");
  let liveCalls = 0;
  const load = createPublicClassDetailLoader({
    loadLive: async () => { liveCalls += 1; return detail; },
    now: () => Date.parse("2026-10-03T01:00:10.000Z"),
    cache: loader => {
      const entries = new Map();
      return async key => { if (!entries.has(key)) entries.set(key, await loader(key)); return structuredClone(entries.get(key)); };
    },
  });
  const first = await load(CLASS_ID), hit = await load(CLASS_ID);
  assert.equal(liveCalls, 1); assert.deepEqual(hit, first); assert.equal(hit.status, "success");
  assert.deepEqual(numbers(hit.detail.classItem.schedulePlan), expected);
  assert.equal(hit.detail.classItem.schedulePlan.sessions[2].sessionNumber, 1);
  assert.ok(!JSON.stringify(hit).includes(PRIVATE));
});
